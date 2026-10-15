export type TournamentFormat = 'swiss' | 'round-robin' | 'knockout' | 'team' | 'custom';
export type PairingSource = 'chess-results' | 'csv' | 'json' | 'manual' | 'api';
export type BoardAvailability = 'offline' | 'available' | 'assigned' | 'playing';

export type TournamentPlayer = { id: string; name: string; fideId?: string; federation?: string; rating?: number };
export type Pairing = { id: string; round: number; table: number; white: TournamentPlayer; black: TournamentPlayer; result: '*' | '1-0' | '0-1' | '1/2-1/2'; boardId?: string; gameId?: string };
export type TournamentRound = { number: number; status: 'scheduled' | 'ready' | 'playing' | 'finished'; pairings: Pairing[] };
export type TournamentBoard = { id: string; label: string; devicePath?: string; status: BoardAvailability; pairingId?: string };
export type Tournament = { id: string; name: string; format: TournamentFormat; source: PairingSource; players: TournamentPlayer[]; rounds: TournamentRound[]; boards: TournamentBoard[]; createdAt: string };

const id = () => crypto.randomUUID();

export function createTournament(name: string, format: TournamentFormat = 'custom'): Tournament {
  return { id: id(), name, format, source: 'manual', players: [], rounds: [], boards: [], createdAt: new Date().toISOString() };
}

export function assignBoard(tournament: Tournament, pairingId: string, boardId: string): Tournament {
  return {
    ...tournament,
    rounds: tournament.rounds.map(round => ({ ...round, pairings: round.pairings.map(pairing => pairing.id === pairingId ? { ...pairing, boardId } : pairing) })),
    boards: tournament.boards.map(board => board.id === boardId ? { ...board, status: 'assigned', pairingId } : board),
  };
}

export function pairingsFromCsv(csv: string, players: TournamentPlayer[]): Pairing[] {
  const byId = new Map(players.map(player => [player.id, player]));
  return csv.trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
    const [round, table, whiteId, blackId] = line.split(',').map(value => value.trim());
    const white = byId.get(whiteId); const black = byId.get(blackId);
    if (!white || !black) throw new Error(`Jugador no encontrado en el CSV: ${whiteId}/${blackId}`);
    return { id: id(), round: Number(round), table: Number(table), white, black, result: '*' as const };
  });
}

export function pairingsFromJson(value: unknown, players: TournamentPlayer[]): Pairing[] {
  if (!Array.isArray(value)) throw new Error('El JSON de emparejamientos debe ser un array.');
  const byId = new Map(players.map(player => [player.id, player]));
  return value.map((item: any) => {
    const white = byId.get(String(item.whiteId)); const black = byId.get(String(item.blackId));
    if (!white || !black) throw new Error(`Jugador no encontrado en el JSON.`);
    return { id: id(), round: Number(item.round), table: Number(item.table), white, black, result: '*' as const };
  });
}

export function roundFromPairings(round: number, pairings: Pairing[]): TournamentRound {
  return { number: round, status: 'ready', pairings: pairings.filter(pairing => pairing.round === round).sort((a, b) => a.table - b.table) };
}
