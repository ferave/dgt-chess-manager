#!/usr/bin/env python3
"""Diagnóstico mínimo para DGT e-Board USB (protocolo 9600 8N1).

No confirma movimientos ni escribe historial: únicamente solicita y muestra
la posición física que responde el tablero.
"""
from __future__ import annotations

import argparse
import time

import serial
from serial.tools import list_ports

PIECE_BY_BYTE = {
    0x00: None,
    0x01: "P", 0x02: "R", 0x03: "N", 0x04: "B", 0x05: "K", 0x06: "Q",
    0x07: "p", 0x08: "r", 0x09: "n", 0x0A: "b", 0x0B: "k", 0x0C: "q",
}


def read_message(port: serial.Serial, timeout: float = 2.0):
    """Read one DGT message: id + 7-bit length header + payload."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        header = port.read(3)
        if len(header) != 3:
            continue
        message_id = header[0]
        length = (header[1] << 7) | header[2]
        if length < 3 or length > 4096:
            continue
        payload = port.read(length - 3)
        if len(payload) == length - 3:
            return message_id, payload
    return None


def board_fen(payload: bytes) -> str:
    if len(payload) != 64:
        raise ValueError(f"BOARD_DUMP inesperado: {len(payload)} bytes")
    ranks = []
    for start in range(0, 64, 8):
        rank = ""
        empty = 0
        for value in payload[start:start + 8]:
            piece = PIECE_BY_BYTE.get(value & 0x0F)
            if piece is None:
                empty += 1
            else:
                if empty:
                    rank += str(empty)
                    empty = 0
                rank += piece
        if empty:
            rank += str(empty)
        ranks.append(rank)
    # DGT sends A8..H1. Side-to-move is unknown until the game service confirms it.
    return "/".join(ranks) + " w - - 0 1"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="auto")
    parser.add_argument("--interval", type=float, default=1.0)
    args = parser.parse_args()

    device = args.port
    if device.lower() == "auto":
        candidates = [port.device for port in list_ports.comports() if port.vid == 0x045B and port.pid == 0x8111]
        if len(candidates) != 1:
            raise SystemExit(f"DGT encontrados: {candidates or 'ninguno'}. Indica --port explícitamente.")
        device = candidates[0]
    print(f"Abriendo {device} a 9600 8N1…")
    with serial.Serial(device, 9600, timeout=0.25) as port:
        # Reset and request the board version. The board dump command can be
        # polled safely for a first hardware-only diagnostic.
        port.write(bytes((0x40, 0x4D)))
        port.flush()
        print("Tablero conectado. Ctrl+C para salir.")
        while True:
            port.write(bytes((0x42,)))  # DGT_SEND_BRD
            port.flush()
            message = read_message(port)
            if message is None:
                print("Sin respuesta del tablero")
            else:
                message_id, payload = message
                if message_id == 0x86 and len(payload) == 64:
                    print(f"BOARD_DUMP  FEN física: {board_fen(payload)}")
                else:
                    print(f"Mensaje DGT id=0x{message_id:02x} bytes={len(payload)} {payload.hex()}")
            time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nDiagnóstico finalizado.")
