import { Chess } from 'chess.js';

export type SyncStatus = 'synced' | 'pending' | 'desynced';
export type Orientation = 'white' | 'black';
export type MoveRecord = { ply: number; san: string; uci: string; fen: string; timestamp: string };
export type CorrectionRecord = { timestamp: string; fromPly: number; toPly: number; removedMoves: MoveRecord[] };
export type PhysicalState = { fen: string; status: SyncStatus; changedAt?: string };

export type GameState = {
  confirmedFen: string;
  moves: MoveRecord[];
  physical: PhysicalState;
  viewedPly: number;
  corrections: CorrectionRecord[];
};

export const initialFen = new Chess().fen();
export const emptyPhysical = (): PhysicalState => ({ fen: initialFen, status: 'synced' });
const placement = (fen: string) => fen.trim().split(/\s+/)[0];

export function applyConfirmedMove(state: GameState, from: string, to: string): GameState {
  const chess = new Chess(state.confirmedFen);
  const move = chess.move({ from, to, promotion: 'q' });
  if (!move) return state;
  const next = { ply: state.moves.length + 1, san: move.san, uci: `${from}${to}${move.promotion ?? ''}`, fen: chess.fen(), timestamp: new Date().toISOString() };
  return { ...state, confirmedFen: chess.fen(), moves: [...state.moves, next], viewedPly: next.ply, corrections: state.corrections ?? [],
    physical: { ...state.physical, status: placement(state.physical.fen) === placement(chess.fen()) ? 'synced' : state.physical.status } };
}

export function setPhysical(state: GameState, fen: string): GameState {
  const status: SyncStatus = placement(fen) === placement(state.confirmedFen) ? 'synced' : 'pending';
  return { ...state, physical: { fen, status, changedAt: new Date().toISOString() } };
}

export function markReconciled(state: GameState): GameState {
  return { ...state, physical: { ...state.physical, status: placement(state.physical.fen) === placement(state.confirmedFen) ? 'synced' : 'desynced' } };
}

export function fenAt(state: GameState, ply: number) { return ply === 0 ? initialFen : state.moves[ply - 1]?.fen ?? state.confirmedFen; }

export function toPgn(state: GameState) {
  const chess = new Chess();
  for (const move of state.moves) chess.move({ from: move.uci.slice(0, 2), to: move.uci.slice(2, 4), promotion: move.uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
  return chess.pgn({ maxWidth: 0, newline: '\n' });
}

export function toTimedPgn(state: GameState) {
  const tokens: string[] = [];
  state.moves.forEach((move, index) => {
    const previous = index === 0 ? Date.parse(move.timestamp) : Date.parse(state.moves[index - 1].timestamp);
    const elapsed = Math.max(0, Math.round((Date.parse(move.timestamp) - previous) / 1000));
    const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    tokens.push(index % 2 === 0 ? `${Math.floor(index / 2) + 1}.` : '...', move.san, `{[%elapsed ${clock}]}`);
  });
  return `${tokens.join(' ')} ${state.moves.length % 2 ? '*' : ''}`.trim();
}
