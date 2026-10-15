import type { DgtAdapter, DgtEvent } from './dgt';

type SerialReader = { read: () => Promise<{ value?: Uint8Array; done: boolean }>; cancel: () => Promise<void> };
type SerialWriter = { write: (data: Uint8Array) => Promise<void> };
type SerialPortLike = { open: (options: { baudRate: number }) => Promise<void>; close: () => Promise<void>; readable?: { getReader: () => SerialReader }; writable?: { getWriter: () => SerialWriter } };

declare global { interface Navigator { serial?: { requestPort: (options?: unknown) => Promise<SerialPortLike> } } }

const pieces: Record<number, string> = { 1: 'P', 2: 'R', 3: 'N', 4: 'B', 5: 'K', 6: 'Q', 7: 'p', 8: 'r', 9: 'n', 10: 'b', 11: 'k', 12: 'q' };
function fenFromBoard(data: Uint8Array) { const ranks: string[] = []; for (let row = 0; row < 8; row += 1) { let rank = ''; let empty = 0; for (const value of data.slice(row * 8, row * 8 + 8)) { const piece = pieces[value & 0x0f]; if (!piece) empty += 1; else { if (empty) { rank += empty; empty = 0; } rank += piece; } } if (empty) rank += empty; ranks.push(rank); } return `${ranks.join('/')} w - - 0 1`; }

export class WebSerialDgtAdapter implements DgtAdapter {
  private port?: SerialPortLike; private writer?: SerialWriter; private reader?: SerialReader; private active = false; private buffer = new Uint8Array(); private timer?: number;
  async connect(onEvent: (event: DgtEvent) => void) {
    if (!navigator.serial) throw new Error('Este navegador no soporta Web Serial. Usa Chrome o Edge.');
    this.port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x045b, usbProductId: 0x8111 }] });
    await this.port.open({ baudRate: 9600 }); this.writer = this.port.writable?.getWriter(); this.active = true; onEvent({ fen: '', connected: true });
    await this.send(new Uint8Array([0x40, 0x4d])); this.timer = window.setInterval(() => void this.send(new Uint8Array([0x42])), 180);
    void this.readLoop(onEvent);
  }
  private async send(data: Uint8Array) { await this.writer?.write(data); }
  private async readLoop(onEvent: (event: DgtEvent) => void) { this.reader = this.port?.readable?.getReader(); if (!this.reader) return; try { while (this.active) { const chunk = await this.reader.read(); if (chunk.done || !chunk.value) break; const joined = new Uint8Array(this.buffer.length + chunk.value.length); joined.set(this.buffer); joined.set(chunk.value, this.buffer.length); this.buffer = joined; while (this.buffer.length >= 3) { const length = (this.buffer[1] << 7) | this.buffer[2]; if (length < 3 || this.buffer.length < length) break; const id = this.buffer[0]; const payload = this.buffer.slice(3, length); this.buffer = this.buffer.slice(length); if (id === 0x86 && payload.length === 64) onEvent({ fen: fenFromBoard(payload), connected: true }); } } } catch { onEvent({ fen: '', connected: false }); } }
  disconnect() { this.active = false; if (this.timer) window.clearInterval(this.timer); void this.reader?.cancel(); void this.port?.close(); this.writer = undefined; this.reader = undefined; this.port = undefined; }
}
