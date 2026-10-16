#!/usr/bin/env python3
"""Puente local DGT -> HTTP para la interfaz web."""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import serial
from serial.tools import list_ports

# The Windows embeddable Python does not automatically add the script folder
# to sys.path when its _pth file is present.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from dgt_probe import board_fen, read_message


class DgtReader:
    def __init__(self, device: str):
        self.device = device
        self.lock = threading.Lock()
        self.fen = ""
        self.connected = False
        self.last_error = ""
        self.active_port = ""
        self.selected_port = "" if device.lower() == "auto" else device
        self.serial_port = None
        self.clock = {"connected": False, "model": "DGT clock", "version": None, "left": "--:--", "right": "--:--", "running": False, "turn": None, "batteryLow": False}

    def state(self):
        with self.lock:
            return {"fen": self.fen, "connected": self.connected, "port": self.active_port, "selectedPort": self.selected_port, "error": self.last_error, "clock": self.clock}

    @staticmethod
    def _port_info(port):
        return {"port": port.device, "vid": port.vid, "pid": port.pid, "description": port.description or "Puerto serie", "hardwareId": port.hwid or "", "dgtHint": port.vid == 0x045B and port.pid == 0x8111}

    @classmethod
    def devices(cls):
        # Some Windows DGT drivers expose a valid COM port without USB metadata.
        return [cls._port_info(port) for port in list_ports.comports()]

    @classmethod
    def candidate_devices(cls):
        ports = list(list_ports.comports())
        known = [port for port in ports if port.vid == 0x045B and port.pid == 0x8111]
        return known or ports

    def select(self, port: str):
        if not any(item["port"] == port for item in self.devices()) and not re.fullmatch(r"COM\d+", port, re.IGNORECASE):
            raise ValueError(f"No se encontró el DGT en {port}")
        with self.lock:
            self.selected_port = port
            self.device = port
            if self.serial_port:
                self.serial_port.close()

    @staticmethod
    def decode_clock(payload):
        if len(payload) != 7:
            return None
        # A clock command acknowledgement also uses BWTIME framing. It is not
        # a time reading and must not be interpreted as disconnected clock.
        if (payload[0] & 0x0F) == 0x0A or (payload[3] & 0x0F) == 0x0A:
            # ACK layout: reconstruct the four-byte clock acknowledgement.
            ack0 = (payload[1] & 0x7F) | ((payload[3] << 3) & 0x80)
            ack1 = (payload[2] & 0x7F) | ((payload[3] << 2) & 0x80)
            ack2 = (payload[4] & 0x7F) | ((payload[0] << 3) & 0x80)
            ack3 = (payload[5] & 0x7F) | ((payload[0] << 2) & 0x80)
            version = f"{ack2 >> 4}.{ack2 & 0x0F}" if ack1 == 0x09 else None
            return {"connected": ack0 == 0x10, "model": "DGT clock", "version": version, "left": "--:--", "right": "--:--", "running": False, "turn": None, "batteryLow": False}
        bcd = lambda value: (value >> 4) * 10 + (value & 0x0F)
        left = f"{payload[3] & 0x0F}:{bcd(payload[4]):02d}:{bcd(payload[5]):02d}"
        right = f"{payload[0] & 0x0F}:{bcd(payload[1]):02d}:{bcd(payload[2]):02d}"
        status = payload[6]
        return {"connected": not bool(status & 0x20), "left": left[2:] if left.startswith('0:') else left, "right": right[2:] if right.startswith('0:') else right, "running": bool(status & 0x01), "turn": "right" if status & 0x08 else "left" if status & 0x10 else None, "batteryLow": bool(status & 0x04)}

    def find_port(self):
        if self.selected_port:
            return self.selected_port
        if self.device.lower() != "auto":
            return self.device
        candidates = [port.device for port in self.candidate_devices()]
        if len(candidates) == 1:
            return candidates[0]
        if len(candidates) > 1:
            raise RuntimeError(f"Hay varios DGT conectados: {', '.join(candidates)}. Usa --port para asignar uno.")
        return None

    def run(self):
        last_clock_poll = 0.0
        while True:
            try:
                device = self.find_port()
                if not device:
                    raise RuntimeError("No se encontró ningún DGT e-Board (VID 045b, PID 8111).")
                with serial.Serial(device, 9600, timeout=0.25) as port:
                    self.serial_port = port
                    with self.lock:
                        self.active_port = device
                    port.write(bytes((0x40, 0x4D)))
                    port.flush()
                    # Register the serial clock (DGT_CLOCK_MESSAGE / VERSION)
                    # before polling BWTIME. This is required by DGT3000/XL.
                    port.write(bytes((0x2B, 0x03, 0x03, 0x09, 0x00)))
                    port.flush()
                    read_message(port, timeout=0.5)  # consume version/ACK
                    board = bytearray(64)
                    port.write(bytes((0x42,)))  # initial full BOARD_DUMP
                    port.flush()
                    initial_message = read_message(port, timeout=0.5)
                    if initial_message and initial_message[0] == 0x86 and len(initial_message[1]) == 64:
                        board[:] = initial_message[1]
                        with self.lock:
                            self.fen = board_fen(board)
                    # From here the board sends only FIELD_UPDATE messages.
                    port.write(bytes((0x44,)))  # DGT_SEND_UPDATE_BRD
                    port.flush()
                    with self.lock:
                        self.connected = True
                        self.last_error = ""
                    last_change = 0.0
                    while True:
                        if self.selected_port and device != self.selected_port:
                            raise RuntimeError("Cambio de tablero solicitado")
                        message = read_message(port, timeout=0.12)
                        now = time.monotonic()
                        if message and message[0] == 0x8E and len(message[1]) == 2:
                            square, piece = message[1]
                            if square < 64:
                                board[square] = piece
                                with self.lock:
                                    self.fen = board_fen(board)
                                last_change = now
                        elif message and message[0] == 0x86 and len(message[1]) == 64:
                            board[:] = message[1]
                            with self.lock:
                                self.fen = board_fen(board)
                            last_change = now
                        if last_change and now - last_change >= 0.12:
                            with self.lock:
                                self.fen = board_fen(board)
                                self.connected = True
                            last_change = 0.0
                        # The board is authoritative. Clock polling is
                        # auxiliary and must never delay or invalidate a board
                        # dump, especially when a clock is absent or a button
                        # was pressed on the wrong side.
                        now = time.monotonic()
                        if now - last_clock_poll >= 2.0:
                            last_clock_poll = now
                            try:
                                port.write(bytes((0x41,)))  # DGT_SEND_CLK
                                port.flush()
                                clock_message = read_message(port, timeout=0.08)
                                if clock_message and clock_message[0] == 0x8D:
                                    decoded = self.decode_clock(clock_message[1])
                                    if decoded:
                                        with self.lock:
                                            # Preserve the last valid times
                                            # between clock messages.
                                            self.clock = {**self.clock, **decoded}
                            except (OSError, serial.SerialException):
                                pass
                        time.sleep(0.05)
            except (OSError, RuntimeError, serial.SerialException) as exc:
                with self.lock:
                    self.connected = False
                    self.last_error = str(exc)
                    self.active_port = ""
                    self.serial_port = None
                time.sleep(2)


class DgtFleet:
    """Maintains one independent reader thread per detected DGT board."""
    def __init__(self):
        self.readers = {}
        self.selected_port = ""
        self.lock = threading.Lock()
        threading.Thread(target=self.discover_forever, daemon=True).start()

    def discover_forever(self):
        while True:
            for item in DgtReader.candidate_devices():
                port = item.device
                if port not in self.readers:
                    reader = DgtReader(port)
                    self.readers[port] = reader
                    threading.Thread(target=reader.run, daemon=True).start()
            candidates = DgtReader.candidate_devices()
            if len(candidates) == 1 and not self.selected_port:
                self.selected_port = candidates[0].device
            time.sleep(2)

    def devices(self):
        result = []
        for item in DgtReader.devices():
            reader = self.readers.get(item["port"])
            result.append({**item, **(reader.state() if reader else {"connected": False, "fen": "", "clock": {}})})
        return result

    def state(self):
        reader = self.readers.get(self.selected_port)
        if reader:
            return {**reader.state(), "selectedPort": self.selected_port}
        return {"fen": "", "connected": False, "port": "", "selectedPort": self.selected_port, "error": "Selecciona un tablero", "clock": {}}

    def select(self, port: str):
        if port not in self.readers:
            # It may have appeared immediately before the discovery tick.
            if not any(item["port"] == port for item in DgtReader.devices()) and not re.fullmatch(r"COM\d+", port, re.IGNORECASE):
                raise ValueError(f"No se encontró el DGT en {port}")
            reader = DgtReader(port)
            self.readers[port] = reader
            threading.Thread(target=reader.run, daemon=True).start()
        self.selected_port = port


class Handler(BaseHTTPRequestHandler):
    reader: DgtReader

    def do_GET(self):  # noqa: N802
        if self.path == "/api/dgt/devices":
            payload = json.dumps(self.reader.devices()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if self.path not in ("/api/dgt/state", "/api/dgt/health"):
            self.send_error(404)
            return
        payload = json.dumps(self.reader.state()).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):  # noqa: N802
        if self.path != "/api/dgt/select":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
            self.reader.select(str(body["port"]))
            payload = json.dumps(self.reader.state()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (KeyError, ValueError) as exc:
            self.send_error(400, str(exc))

    def log_message(self, *_args):
        return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="auto", help="auto, /dev/ttyACM0, COM3 o /dev/cu.usbmodem...")
    parser.add_argument("--http-port", type=int, default=8787)
    args = parser.parse_args()
    reader = DgtFleet() if args.port.lower() == "auto" else DgtReader(args.port)
    if not isinstance(reader, DgtFleet):
        threading.Thread(target=reader.run, daemon=True).start()
    Handler.reader = reader
    print(f"DGT HTTP bridge: http://127.0.0.1:{args.http_port}/api/dgt/state")
    ThreadingHTTPServer(("0.0.0.0", args.http_port), Handler).serve_forever()


if __name__ == "__main__":
    main()
