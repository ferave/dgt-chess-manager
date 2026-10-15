import type { GameState } from '../domain/game';

export type DgtClock = { connected: boolean; model?: string; version?: string | null; left: string; right: string; running: boolean; turn: 'left' | 'right' | null; batteryLow: boolean };
export type DgtEvent = { fen: string; connected: boolean; clock?: DgtClock };
export interface DgtAdapter { connect(onEvent: (event: DgtEvent) => void): Promise<void>; disconnect(): void; }
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
export function isPhysicalDifferent(state: GameState) { return state.physical.fen !== state.confirmedFen; }
