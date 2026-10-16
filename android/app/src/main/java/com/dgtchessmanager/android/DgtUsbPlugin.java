package com.dgtchessmanager.android;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.PluginMethod;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/** USB-OTG transport for DGT e-Boards (VID 045b, PID 8111). */
@CapacitorPlugin(name = "DgtUsb")
public class DgtUsbPlugin extends Plugin {
  private static final int DGT_VENDOR_ID = 0x045b;
  private static final int DGT_PRODUCT_ID = 0x8111;
  private static final String PERMISSION_ACTION = "com.dgtchessmanager.android.DGT_USB_PERMISSION";
  private UsbManager manager;
  private UsbDeviceConnection connection;
  private UsbEndpoint input;
  private UsbEndpoint output;
  private Thread reader;
  private volatile boolean active;
  private final ByteArrayOutputStream buffer = new ByteArrayOutputStream();
  private PluginCall pendingConnect;

  private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
    @Override public void onReceive(Context context, Intent intent) {
      if (!PERMISSION_ACTION.equals(intent.getAction())) return;
      UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
      if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) open(device);
      else if (pendingConnect != null) { pendingConnect.reject("Android no autorizó el acceso USB al DGT"); pendingConnect = null; }
    }
  };

  @Override public void load() {
    manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    IntentFilter filter = new IntentFilter(PERMISSION_ACTION);
    ContextCompat.registerReceiver(getContext(), permissionReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
  }

  @Override protected void handleOnDestroy() { disconnect(); getContext().unregisterReceiver(permissionReceiver); }

  @PluginMethod public void list(PluginCall call) {
    JSArray devices = new JSArray();
    for (UsbDevice device : manager.getDeviceList().values()) {
      JSObject value = new JSObject(); value.put("name", device.getDeviceName()); value.put("vendorId", device.getVendorId()); value.put("productId", device.getProductId());
      value.put("isDgt", device.getVendorId() == DGT_VENDOR_ID && device.getProductId() == DGT_PRODUCT_ID); devices.put(value);
    }
    JSObject result = new JSObject(); result.put("devices", devices); call.resolve(result);
  }

  @PluginMethod public void connect(PluginCall call) {
    String requested = call.getString("name", ""); UsbDevice selected = null;
    for (UsbDevice device : manager.getDeviceList().values()) if ((requested.isEmpty() && device.getVendorId() == DGT_VENDOR_ID && device.getProductId() == DGT_PRODUCT_ID) || device.getDeviceName().equals(requested)) { selected = device; break; }
    if (selected == null) { call.reject("No se encontró un DGT USB (045b:8111)"); return; }
    pendingConnect = call;
    if (manager.hasPermission(selected)) open(selected);
    else {
      Intent intent = new Intent(PERMISSION_ACTION).setPackage(getContext().getPackageName());
      PendingIntent permission = PendingIntent.getBroadcast(getContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE);
      manager.requestPermission(selected, permission);
    }
  }

  @PluginMethod public void disconnect(PluginCall call) { disconnect(); call.resolve(); }

  private void open(UsbDevice device) {
    disconnect(); UsbInterface serialInterface = null;
    for (int index = 0; index < device.getInterfaceCount(); index++) {
      UsbInterface candidate = device.getInterface(index); UsbEndpoint in = null, out = null;
      for (int endpoint = 0; endpoint < candidate.getEndpointCount(); endpoint++) {
        UsbEndpoint value = candidate.getEndpoint(endpoint);
        if (value.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK) { if (value.getDirection() == UsbConstants.USB_DIR_IN) in = value; else out = value; }
      }
      if (in != null && out != null) { serialInterface = candidate; input = in; output = out; break; }
    }
    if (serialInterface == null) { rejectPending("El DGT no expone una interfaz serie USB compatible"); return; }
    connection = manager.openDevice(device);
    if (connection == null || !connection.claimInterface(serialInterface, true)) { disconnect(); rejectPending("No se pudo abrir el puerto USB del DGT"); return; }
    // CDC ACM line coding: 9600 baud, 8N1. DGT e-Boards use this serial speed.
    connection.controlTransfer(0x21, 0x20, 0, serialInterface.getId(), new byte[] {(byte) 0x80, 0x25, 0, 0, 0, 0, 8}, 7, 1000);
    active = true; write(new byte[] {0x40, 0x4d}); write(new byte[] {0x42}); write(new byte[] {0x44});
    JSObject state = new JSObject(); state.put("connected", true); state.put("name", device.getDeviceName()); notifyListeners("state", state);
    if (pendingConnect != null) { pendingConnect.resolve(state); pendingConnect = null; }
    reader = new Thread(this::readLoop, "dgt-usb-reader"); reader.start();
  }

  private void readLoop() {
    byte[] chunk = new byte[512];
    while (active && connection != null) {
      int length = connection.bulkTransfer(input, chunk, chunk.length, 250);
      if (length > 0) synchronized (buffer) { buffer.write(chunk, 0, length); parseMessages(); }
    }
  }

  private void parseMessages() {
    byte[] bytes = buffer.toByteArray(); int cursor = 0;
    while (bytes.length - cursor >= 3) {
      int length = ((bytes[cursor + 1] & 0x7f) << 7) | (bytes[cursor + 2] & 0x7f);
      if (length < 3 || length > 4096) { cursor++; continue; }
      if (bytes.length - cursor < length) break;
      if ((bytes[cursor] & 0xff) == 0x86 && length == 67) publishFen(Arrays.copyOfRange(bytes, cursor + 3, cursor + 67));
      cursor += length;
    }
    buffer.reset(); if (cursor < bytes.length) buffer.write(bytes, cursor, bytes.length - cursor);
  }

  private void publishFen(byte[] board) {
    Map<Integer, String> pieces = new HashMap<>(); String[] symbols = {"", "P", "R", "N", "B", "K", "Q", "p", "r", "n", "b", "k", "q"};
    for (int index = 1; index < symbols.length; index++) pieces.put(index, symbols[index]);
    StringBuilder fen = new StringBuilder();
    for (int rank = 0; rank < 8; rank++) { int empty = 0; for (int file = 0; file < 8; file++) { String piece = pieces.get(board[rank * 8 + file] & 0x0f); if (piece == null) empty++; else { if (empty > 0) { fen.append(empty); empty = 0; } fen.append(piece); } } if (empty > 0) fen.append(empty); if (rank < 7) fen.append('/'); }
    JSObject state = new JSObject(); state.put("connected", true); state.put("fen", fen + " w - - 0 1"); notifyListeners("state", state);
  }

  private void write(byte[] command) { if (connection != null && output != null) connection.bulkTransfer(output, command, command.length, 1000); }
  private void rejectPending(String message) { if (pendingConnect != null) { pendingConnect.reject(message); pendingConnect = null; } }
  private void disconnect() { active = false; if (connection != null) { connection.close(); connection = null; } input = null; output = null; JSObject state = new JSObject(); state.put("connected", false); notifyListeners("state", state); }
}
