import type { GameState } from '../domain/game';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type DgtClock = { connected: boolean; model?: string; version?: string | null; left: string; right: string; running: boolean; turn: 'left' | 'right' | null; batteryLow: boolean };
export type DgtEvent = { fen: string; connected: boolean; clock?: DgtClock };
export interface DgtAdapter { connect(onEvent: (event: DgtEvent) => void): Promise<void>; disconnect(): void; }
type NativeUsbDevice = { name: string; vendorId: number; productId: number; isDgt: boolean };
type NativeDgtUsb = {
  list(): Promise<{ devices: NativeUsbDevice[] }>;
  connect(options: { name?: string }): Promise<void>;
  disconnect(): Promise<void>;
  addListener(eventName: 'state', listenerFunc: (event: DgtEvent) => void): Promise<PluginListenerHandle>;
};
const nativeDgt = registerPlugin<NativeDgtUsb>('DgtUsb');
const bridgeBase = typeof window !== 'undefined' && window.location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '';
/** Puerto de hardware: el transporte USB/serial se conecta aquí, nunca en el componente visual. */
export class HttpDgtAdapter implements DgtAdapter {
  private active = false;
  private onEvent?: (event: DgtEvent) => void;
  async connect(onEvent: (event: DgtEvent) => void) { this.onEvent = onEvent; this.active = true; void this.poll(); }
  disconnect() { this.active = false; this.onEvent = undefined; }
  private async poll() {
    while (this.active) {
      try {
        const response = await fetch(`${bridgeBase}/api/dgt/state`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`DGT HTTP ${response.status}`);
        const state = await response.json() as { fen: string; connected: boolean; clock?: DgtClock };
        this.onEvent?.(state);
      } catch { this.onEvent?.({ fen: '', connected: false }); }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
}
/** Transporte USB-OTG nativo de la APK Android; no depende de Web Serial ni del puente Python. */
export class AndroidUsbDgtAdapter implements DgtAdapter {
  private listener?: PluginListenerHandle;
  async connect(onEvent: (event: DgtEvent) => void) {
    this.listener = await nativeDgt.addListener('state', onEvent);
    const { devices } = await nativeDgt.list();
    const board = devices.find(device => device.isDgt);
    if (!board) { onEvent({ fen: '', connected: false }); throw new Error('No se encontró un DGT por USB-OTG (045b:8111).'); }
    await nativeDgt.connect({ name: board.name });
  }
  disconnect() { void this.listener?.remove(); this.listener = undefined; void nativeDgt.disconnect(); }
}
export const isNativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export function createDgtAdapter(): DgtAdapter { return isNativeAndroid() ? new AndroidUsbDgtAdapter() : new HttpDgtAdapter(); }
export function isPhysicalDifferent(state: GameState) { return state.physical.fen !== state.confirmedFen; }
