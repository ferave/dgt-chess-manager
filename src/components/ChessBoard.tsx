import { useEffect, useRef } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Dests } from '@lichess-org/chessground/types';
import type { Key } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.brown.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';

export type Shape = { orig: string; dest?: string; brush?: 'green' | 'red' | 'blue' | 'yellow' };
type Props = { fen: string; orientation: 'white' | 'black'; disabled?: boolean; dests?: Dests; lastMove?: [string, string]; check?: 'white' | 'black'; shapes?: Shape[]; onMove: (from: string, to: string) => void };

export function ChessBoard({ fen, orientation, disabled, dests, lastMove, check, shapes = [], onMove }: Props) {
  const host = useRef<HTMLDivElement>(null); const api = useRef<Api | undefined>(undefined); const callback = useRef(onMove); callback.current = onMove;
  useEffect(() => { if (!host.current) return; api.current = Chessground(host.current, { fen, orientation, coordinates: true, animation: { enabled: true, duration: 180 }, highlight: { lastMove: true, check: true }, lastMove: lastMove as Key[] | undefined, check, drawable: { enabled: true, visible: true, shapes: shapes.map(s => ({ ...s, orig: s.orig as Key, dest: s.dest as Key | undefined })) }, movable: { free: false, color: disabled ? undefined : 'both', dests, showDests: true, events: { after: (from, to) => callback.current(from, to) } } }); return () => api.current?.destroy(); }, []);
  useEffect(() => { api.current?.set({ fen, orientation, lastMove: lastMove as Key[] | undefined, check, drawable: { enabled: true, visible: true, shapes: shapes.map(s => ({ ...s, orig: s.orig as Key, dest: s.dest as Key | undefined })) }, movable: { free: false, color: disabled ? undefined : 'both', dests, showDests: true } }); }, [fen, orientation, disabled, dests, lastMove, check, shapes]);
  return <div ref={host} className="chessground board-host" aria-label="Tablero de ajedrez interactivo" />;
}
