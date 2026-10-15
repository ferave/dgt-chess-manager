import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Dests } from '@lichess-org/chessground/types';
import { ChessBoard, type Shape } from './components/ChessBoard';
import { applyConfirmedMove, emptyPhysical, fenAt, initialFen, markReconciled, setPhysical, toTimedPgn, type GameState, type Orientation, type SyncStatus } from './domain/game';
import { HttpDgtAdapter, type DgtClock } from './adapters/dgt';
import { WebSerialDgtAdapter } from './adapters/webSerialDgt';

const bridgeBase = typeof window !== 'undefined' && window.location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '';

const storage = 'dgt-chess-manager:game';
const libraryStorage = 'dgt-chess-manager:games';
type Players = { white: string; black: string };
type GameMeta = { event: string; site: string; round: string; result: string; date: string; time: string };
type DgtDevice = { port: string; description: string; vid?: number; pid?: number; hardwareId?: string; dgtHint?: boolean; connected?: boolean; fen?: string; selectedPort?: string };
type SavedGame = { id: string; savedAt: string; updatedAt: string; players: Players; meta: GameMeta; game: GameState };
const saved = localStorage.getItem(storage); const savedDocument = saved ? JSON.parse(saved) as SavedGame | GameState : undefined;
const initial: GameState = savedDocument && 'game' in savedDocument ? { ...savedDocument.game, corrections: savedDocument.game.corrections ?? [] } : savedDocument as GameState || { confirmedFen: initialFen, moves: [], physical: emptyPhysical(), viewedPly: 0, corrections: [] };
const initialPlayers: Players = savedDocument && 'game' in savedDocument ? savedDocument.players : { white: '', black: '' };
const now = new Date();
const initialMeta: GameMeta = savedDocument && 'game' in savedDocument && savedDocument.meta ? savedDocument.meta : { event: 'Partida DGT', site: 'DGT Chess Manager', round: '1', result: '*', date: now.toISOString().slice(0, 10).replace(/-/g, '.'), time: now.toTimeString().slice(0, 5) };
const initialId = savedDocument && 'game' in savedDocument ? savedDocument.id : crypto.randomUUID();
const placement = (fen: string) => fen.trim().split(/\s+/)[0];
const initialPlacement = placement(initialFen);
type BoardMove = { from: string; to: string };
function legalPathToPlacement(startFen: string, targetPlacement: string, maxDepth = 4): BoardMove[] | undefined {
  const expand = (board: string) => board.split('/').flatMap(rank => [...rank].flatMap(symbol => /\d/.test(symbol) ? Array(Number(symbol)).fill('.') : [symbol]));
  const startSquares = expand(startFen.split(' ')[0]);
  const targetSquares = expand(targetPlacement);
  const changedSquares = startSquares.reduce((count, value, index) => count + (value !== targetSquares[index] ? 1 : 0), 0);
  // Una pieza levantada suele cambiar solo una casilla; no es una secuencia
  // completa y no merece iniciar una búsqueda costosa.
  if (changedSquares < 2 || changedSquares > maxDepth * 2) return undefined;
  type Node = { fen: string; path: BoardMove[] };
  let frontier: Node[] = [{ fen: startFen, path: [] }];
  for (let depth = 0; depth < Math.min(maxDepth, 3); depth += 1) {
    const next: Node[] = [];
    for (const node of frontier) {
      for (const legal of new Chess(node.fen).moves({ verbose: true })) {
        const probe = new Chess(node.fen);
        probe.move({ from: legal.from, to: legal.to, promotion: 'q' });
        const path = [...node.path, { from: legal.from, to: legal.to }];
        if (placement(probe.fen()) === targetPlacement) return path;
        next.push({ fen: probe.fen(), path });
      }
    }
    frontier = next.slice(0, 2500);
  }
  return undefined;
}
function resultFromCenterKings(fen: string): GameMeta['result'] | undefined {
  const rows = fen.split(' ')[0].split('/'); const kings: Record<string, string> = {};
  rows.forEach((row, rankIndex) => { let file = 0; for (const symbol of row) { if (/\d/.test(symbol)) file += Number(symbol); else { if (symbol === 'K' || symbol === 'k') kings[symbol] = `${'abcdefgh'[file]}${8 - rankIndex}`; file += 1; } } });
  const squares = new Set([kings.K, kings.k]);
  if (squares.size !== 2) return undefined;
  if (squares.has('d5') && squares.has('e4')) return '1-0';
  if (squares.has('d4') && squares.has('e5')) return '0-1';
  if ((squares.has('d4') && squares.has('d5')) || (squares.has('e4') && squares.has('e5'))) return '1/2-1/2';
  return undefined;
}
const statusCopy: Record<SyncStatus, [string, string]> = { synced: ['Sincronizado', 'La posición física coincide con la partida confirmada.'], pending: ['Movimiento pendiente', 'Cambios físicos detectados; aún no se ha confirmado una jugada.'], desynced: ['Desincronizado', 'La posición física requiere reconciliación.'] };

export function App() {
  const [game, setGame] = useState(initial); const [players, setPlayers] = useState<Players>(initialPlayers); const [meta, setMeta] = useState<GameMeta>(initialMeta); const [positionFen, setPositionFen] = useState(game.confirmedFen); const [clock, setClock] = useState<DgtClock | undefined>(); const [devices, setDevices] = useState<DgtDevice[]>([]); const [activePort, setActivePort] = useState(''); const [bridgeError, setBridgeError] = useState(''); const [browserMode, setBrowserMode] = useState(false); const [saveNotice, setSaveNotice] = useState('Guardado automático activo'); const [gameId, setGameId] = useState(initialId); const [orientation, setOrientation] = useState<Orientation>('white'); const [connected, setConnected] = useState(false); const [theme, setTheme] = useState('brown'); const [pieceSize, setPieceSize] = useState('normal'); const [tab, setTab] = useState<'games' | 'boards' | 'diagnostics' | 'library'>('games'); const [portPickerOpen, setPortPickerOpen] = useState(false); const [manualPort, setManualPort] = useState(''); const [confirmationDelay, setConfirmationDelay] = useState(() => Number(localStorage.getItem('dgt-chess-manager:confirmation-delay')) || 300); const [savedGames, setSavedGames] = useState<SavedGame[]>(() => JSON.parse(localStorage.getItem(libraryStorage) || '[]'));
  const dgt = useMemo(() => new HttpDgtAdapter(), []); const webDgt = useMemo(() => new WebSerialDgtAdapter(), []); const viewedFen = fenAt(game, game.viewedPly); const viewingHistory = game.viewedPly !== game.moves.length; const last = game.moves[game.viewedPly - 1]; const chess = new Chess(viewedFen); const check = chess.inCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : undefined; const dests: Dests = new Map(); if (!viewingHistory) for (const legal of chess.moves({ verbose: true })) { const existing = dests.get(legal.from) ?? []; existing.push(legal.to); dests.set(legal.from, existing); } const physicalPending = !viewingHistory && game.physical.status !== 'synced'; const displayFen = physicalPending ? game.physical.fen : viewedFen; let pendingMove: { from: string; to: string } | undefined; if (physicalPending) for (const legal of new Chess(viewedFen).moves({ verbose: true })) { const probe = new Chess(viewedFen); probe.move({ from: legal.from, to: legal.to, promotion: 'q' }); if (placement(probe.fen()) === placement(game.physical.fen)) { pendingMove = legal; break; } } const physicalPath = physicalPending && !pendingMove ? legalPathToPlacement(viewedFen, placement(game.physical.fen)) : undefined; const physicalPathKey = physicalPath?.map(move => `${move.from}${move.to}`).join(',');
  useEffect(() => { const document: SavedGame = { id: gameId, savedAt: savedDocument && 'game' in savedDocument ? savedDocument.savedAt : new Date().toISOString(), updatedAt: new Date().toISOString(), players, meta, game }; localStorage.setItem(storage, JSON.stringify(document)); const library = JSON.parse(localStorage.getItem(libraryStorage) || '[]') as SavedGame[]; const index = library.findIndex(item => item.id === gameId); if (index >= 0) library[index] = document; else if (game.moves.length > 0 || meta.result !== '*') library.unshift(document); localStorage.setItem(libraryStorage, JSON.stringify(library)); setSavedGames(library); setSaveNotice(`Guardado automático · ${game.moves.length} jugadas · ${new Date().toLocaleTimeString()}`); }, [game, players, meta, gameId]);
  useEffect(() => { if (browserMode) { dgt.disconnect(); return; } dgt.connect(e => { setConnected(e.connected); if (e.clock) setClock(e.clock); if (e.connected && e.fen) setGame(s => s.physical.fen === e.fen ? s : setPhysical(s, e.fen)); }); return () => dgt.disconnect(); }, [dgt, browserMode]);
  async function connectFromBrowser() { try { setBrowserMode(true); await webDgt.connect(e => { setConnected(e.connected); if (e.connected && e.fen) setGame(s => s.physical.fen === e.fen ? s : setPhysical(s, e.fen)); }); setSaveNotice('DGT conectado desde el navegador'); } catch (error) { setBrowserMode(false); setSaveNotice(error instanceof Error ? error.message : 'No se pudo conectar el DGT'); openPortPicker(); } }
  useEffect(() => { let active = true; const refresh = async () => { try { const [devicesResponse, stateResponse] = await Promise.all([fetch(`${bridgeBase}/api/dgt/devices`, { cache: 'no-store' }), fetch(`${bridgeBase}/api/dgt/state`, { cache: 'no-store' })]); if (!devicesResponse.ok || !stateResponse.ok) throw new Error(`Puente DGT HTTP ${devicesResponse.status}/${stateResponse.status}`); if (active) { setDevices(await devicesResponse.json() as DgtDevice[]); const state = await stateResponse.json() as { selectedPort?: string; port?: string; error?: string }; setActivePort(state.selectedPort || state.port || ''); setBridgeError(state.error || ''); } } catch (error) { if (active) setBridgeError(error instanceof Error ? error.message : 'No se puede contactar con el puente DGT'); } }; void refresh(); const timer = window.setInterval(refresh, 700); return () => { active = false; window.clearInterval(timer); }; }, []);
  useEffect(() => {
    function navigate(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      setGame(state => ({ ...state, viewedPly: event.key === 'ArrowLeft' ? Math.max(0, state.viewedPly - 1) : event.key === 'ArrowRight' ? Math.min(state.moves.length, state.viewedPly + 1) : event.key === 'Home' ? 0 : state.moves.length }));
    }
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, []);
  useEffect(() => {
    if (viewingHistory || !game.physical.fen) return;
    const physicalPlacement = placement(game.physical.fen);
    const centerResult = resultFromCenterKings(game.physical.fen);
    if (centerResult && meta.result === '*') {
      setMeta(value => ({ ...value, result: centerResult }));
      setSaveNotice(`Resultado detectado: ${centerResult}`);
      return;
    }
    // A return to the standard setup starts a new recording. The previous
    // document is already persisted by the effect above.
    if (game.moves.length > 0 && physicalPlacement === initialPlacement && placement(game.confirmedFen) !== initialPlacement) {
      setGameId(crypto.randomUUID());
      setGame({ confirmedFen: initialFen, moves: [], physical: setPhysical({ confirmedFen: initialFen, moves: [], physical: emptyPhysical(), viewedPly: 0, corrections: [] }, game.physical.fen).physical, viewedPly: 0, corrections: [] });
      return;
    }
    // If the physical board returns to a previous confirmed position, treat it
    // as a correction/takeback and keep an audit record instead of adding an
    // impossible move to the notation.
     if (!pendingMove && game.physical.status === 'pending' && game.moves.length > 0) {
       const previous = game.moves.find(move => move.ply < game.moves.length && placement(move.fen) === physicalPlacement);
       if (previous) {
         const targetPly = previous.ply;
         // No registrar una rectificación durante el movimiento físico: el DGT
         // puede emitir varias posiciones intermedias mientras se recoloca una pieza.
         const timer = window.setTimeout(() => {
           setGame(current => {
             if (placement(current.physical.fen) !== physicalPlacement || current.physical.status !== 'pending') return current;
             return { ...current, confirmedFen: targetPly === 0 ? initialFen : current.moves[targetPly - 1].fen, moves: current.moves.slice(0, targetPly), viewedPly: targetPly, physical: { ...current.physical, status: 'synced' }, corrections: [...(current.corrections ?? []), { timestamp: new Date().toISOString(), fromPly: current.moves.length, toPly: targetPly, removedMoves: current.moves.slice(targetPly) }] };
           });
           setSaveNotice(`Corrección registrada: se volvió a la jugada ${targetPly}`);
         }, 700);
         return () => window.clearTimeout(timer);
       }
     }
     if (!pendingMove && !physicalPath?.length) return;
     const path = pendingMove ? [pendingMove] : physicalPath!;
     const timer = window.setTimeout(() => {
       setGame(current => {
         if (current.viewedPly !== current.moves.length || current.physical.fen !== game.physical.fen) return current;
         let next = current;
         for (const move of path) next = applyConfirmedMove(next, move.from, move.to);
         return next;
       });
      }, confirmationDelay);
     return () => window.clearTimeout(timer);
   }, [game.physical.fen, game.confirmedFen, game.moves.length, viewingHistory, pendingMove?.from, pendingMove?.to, physicalPathKey, confirmationDelay]);
  function move(from: string, to: string) { if (viewingHistory) return; setGame(s => applyConfirmedMove(s, from, to)); }
  function saveGame() { setSaveNotice('Partida guardada en la biblioteca'); const document: SavedGame = { id: gameId, savedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), players, meta, game }; const library = [document, ...savedGames.filter(item => item.id !== gameId)]; localStorage.setItem(libraryStorage, JSON.stringify(library)); setSavedGames(library); }
  async function downloadPgn() { const headers = [`[Event "${meta.event || '?'}"]`, `[Site "${meta.site || '?'}"]`, `[Date "${meta.date || '????.??.??'}"]`, `[Time "${meta.time || '??:??'}"]`, `[Round "${meta.round || '?'}"]`, `[White "${players.white || '?'}"]`, `[Black "${players.black || '?'}"]`, `[Result "${meta.result || '*'}"]`, '']; const content = [...headers, toTimedPgn(game), ''].join('\n'); const safeDate = `${meta.date || new Date().toISOString().slice(0, 10).replace(/-/g, '.')}_${(meta.time || '00:00').replace(':', '-')}`; const filename = `partida_${safeDate}.pgn`; const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker; if (picker) { try { const handle = await picker({ suggestedName: filename, types: [{ description: 'Partida PGN', accept: { 'application/x-chess-pgn': ['.pgn'] } }] }); const writable = await handle.createWritable(); await writable.write(content); await writable.close(); setSaveNotice('PGN guardado en la ubicación seleccionada'); return; } catch (error) { if ((error as DOMException).name === 'AbortError') return; } } const blob = new Blob([content], { type: 'application/x-chess-pgn' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); setSaveNotice(`PGN descargado: ${filename}`); }
  function downloadJson() { const content = JSON.stringify({ id: gameId, players, meta, game }, null, 2); const filename = `partida_${meta.date || new Date().toISOString().slice(0, 10)}.json`; const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); setSaveNotice(`Datos completos exportados: ${game.moves.length} jugadas`); }
  function loadGame(document: SavedGame) { setGameId(document.id); setGame(document.game); setPlayers(document.players); setMeta(document.meta ?? initialMeta); setTab('games'); }
  function newGame() { setGameId(crypto.randomUUID()); setGame({ confirmedFen: initialFen, moves: [], physical: emptyPhysical(), viewedPly: 0, corrections: [] }); setPlayers({ white: '', black: '' }); setMeta({ ...initialMeta, date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), time: new Date().toTimeString().slice(0, 5) }); setTab('games'); }
  async function selectBoard(port: string) { try { const response = await fetch(`${bridgeBase}/api/dgt/select`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ port }) }); if (!response.ok) throw new Error(`No se pudo seleccionar ${port} (HTTP ${response.status})`); setActivePort(port); setBridgeError(''); setSaveNotice(`Tablero seleccionado: ${port}`); setPortPickerOpen(false); } catch (error) { const message = error instanceof Error ? error.message : 'No se pudo seleccionar el puerto'; setBridgeError(message); setSaveNotice(message); } }
  function openPortPicker() { setManualPort(activePort || ''); setPortPickerOpen(true); }
  function loadPosition() { try { const position = new Chess(positionFen); setGameId(crypto.randomUUID()); setGame({ confirmedFen: position.fen(), moves: [], physical: setPhysical({ confirmedFen: position.fen(), moves: [], physical: emptyPhysical(), viewedPly: 0, corrections: [] }, game.physical.fen).physical, viewedPly: 0, corrections: [] }); setMeta(value => ({ ...value, result: '*' })); setSaveNotice('Continuación iniciada desde la posición FEN'); setTab('games'); } catch { setSaveNotice('FEN inválida: revisa la posición introducida'); } }
  const status = statusCopy[game.physical.status]; const shapes: Shape[] = [{ orig: 'e2', dest: 'e4', brush: 'blue' }];
  return <div className={`app theme-${theme} pieces-${pieceSize}`}>
     <header><div><div className="eyebrow">DGT CHESS MANAGER</div><h1>Partida de entrenamiento</h1></div><div className="connection"><i className={connected ? 'online' : ''}/><span>{connected ? 'DGT Smart Board conectado' : 'DGT desconectado'}</span></div><button className="connect-button" type="button" onClick={connectFromBrowser}>Conectar DGT</button><button className="connect-button" type="button" onClick={openPortPicker}>Elegir puerto DGT</button><button className="icon-button" onClick={() => { const next = orientation === 'white' ? 'black' : 'white'; setOrientation(next); }}>↻ <small>{orientation === 'white' ? 'Blancas' : 'Negras'}</small></button></header>
     <main><section className="game-meta"><div className="game-fields"><input value={meta.event} aria-label="Evento" onChange={e => setMeta(value => ({ ...value, event: e.target.value }))}/><span><input value={meta.site} aria-label="Lugar" onChange={e => setMeta(value => ({ ...value, site: e.target.value }))}/> · <input value={meta.round} aria-label="Ronda" onChange={e => setMeta(value => ({ ...value, round: e.target.value }))}/></span></div><div className={`sync sync-${game.physical.status}`}><strong>● {status[0]}</strong><span>{status[1]}</span><small className="save-notice">{saveNotice}</small></div></section>
       <div className="workspace"><section className="board-column"><div className="player top"><span className="avatar">♟</span><div className="player-info"><input className="player-name" value={players.black} placeholder="Jugador con negras" onChange={e => setPlayers(value => ({ ...value, black: e.target.value }))}/><small>Negras · DGT Smart Board</small></div><div className="clock-box clock-black"><b>Reloj negras</b>{clock?.connected ? <span>{clock.right}{clock.running && clock.turn === 'right' ? ' · ▶' : ''}</span> : <span>--:--</span>}</div></div><div className={`board-frame board-${theme}`}><ChessBoard fen={displayFen} orientation={orientation} disabled={viewingHistory || physicalPending} dests={dests} lastMove={last ? [last.uci.slice(0,2), last.uci.slice(2,4)] : undefined} check={check} shapes={shapes} onMove={move}/></div><div className="player bottom"><span className="avatar light-avatar">♙</span><div className="player-info"><input className="player-name" value={players.white} placeholder="Jugador con blancas" onChange={e => setPlayers(value => ({ ...value, white: e.target.value }))}/><small>{viewingHistory ? `Consultando jugada ${game.viewedPly}` : 'Blancas · tablero físico'}</small></div><div className="clock-box clock-white"><b>Reloj blancas</b>{clock?.connected ? <span>{clock.left}{clock.running && clock.turn === 'left' ? ' · ▶' : ''}</span> : <span>--:--</span>}</div></div></section>
      <aside className="side-panel"><div className="panel-tabs"><button className={tab === 'games' ? 'active' : ''} onClick={() => setTab('games')}>Movimientos</button><button className={tab === 'boards' ? 'active' : ''} onClick={() => setTab('boards')}>Tableros ({devices.length})</button><button className={tab === 'diagnostics' ? 'active' : ''} onClick={() => setTab('diagnostics')}>Diagnóstico</button><button className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')}>Partidas ({savedGames.length})</button></div>{tab === 'boards' ? <div className="board-list">{devices.length === 0 && <p className="muted">No hay tableros DGT conectados.</p>}{devices.map(device => { const selected = device.port === activePort; return <button type="button" className={`board-card ${selected ? 'board-card-selected' : ''}`} key={device.port} onClick={() => selectBoard(device.port)}><span className="board-card-head"><b>Mesa {devices.indexOf(device) + 1}</b><i className={selected && connected ? 'online' : ''}/></span><strong>{device.description}</strong><small>{device.port}</small><span>{device.connected ? (selected ? 'Transmitiendo posición' : 'Disponible · leyendo posición') : 'Desconectado'}</span><em>{device.fen ? placement(device.fen) : '—'}</em></button>; })}</div> : tab === 'games' ? <><div className="moves">{game.moves.length === 0 && <p className="muted">Las jugadas confirmadas aparecerán aquí.</p>}{game.moves.map((m, i) => <button className={game.viewedPly === m.ply ? 'move selected' : 'move'} key={m.ply} onClick={() => setGame(s => ({ ...s, viewedPly: m.ply }))}><span>{i % 2 === 0 ? `${i / 2 + 1}.` : ''}</span>{m.san}</button>)}</div><div className="history-controls"><button onClick={() => setGame(s => ({ ...s, viewedPly: Math.max(0, s.viewedPly - 1) }))}>‹</button><button onClick={() => setGame(s => ({ ...s, viewedPly: Math.min(s.moves.length, s.viewedPly + 1) }))}>›</button><button onClick={() => setGame(s => ({ ...s, viewedPly: s.moves.length }))}>Última</button></div></> : tab === 'diagnostics' ? <div className="diagnostics"><b>Continuar desde FEN</b><span>Introduce una posición para iniciar una continuación sin inventar el historial anterior.</span><textarea value={positionFen} aria-label="Posición FEN" onChange={e => setPositionFen(e.target.value)} rows={3}/><button type="button" onClick={loadPosition}>Cargar posición</button><b>Tableros conectados</b>{devices.length === 0 && <span>No se detectan tableros DGT.</span>}{devices.map(device => <button type="button" className="device-option" key={device.port} onClick={() => selectBoard(device.port)}>{device.port} · {device.description}</button>)}<b>Puerto DGT seleccionado</b><span>USB / Smart Board</span><b>Última lectura</b><span>{game.physical.changedAt ? new Date(game.physical.changedAt).toLocaleTimeString() : '—'}</span><b>Fuente de verdad</b><span>Backend · movimientos confirmados</span></div> : <div className="library">{savedGames.length === 0 && <p className="muted">Todavía no hay partidas guardadas.</p>}{savedGames.map(item => <button className="saved-game" key={item.id} onClick={() => loadGame(item)}><b>{item.players.white || 'Blancas'} — {item.players.black || 'Negras'}</b><small>{item.game.moves.length} jugadas · {new Date(item.updatedAt).toLocaleString()}</small></button>)}</div>}</aside></div>
       <footer><div className="toolbar"><label>Tema <select value={theme} onChange={e => setTheme(e.target.value)}><option value="brown">Madera</option><option value="blue">Azul</option><option value="green">Verde</option></select></label><label>Piezas <select value={pieceSize} onChange={e => setPieceSize(e.target.value)}><option value="small">Pequeñas</option><option value="normal">Normales</option><option value="large">Grandes</option></select></label><label className="delay-control">Confirmación <input type="range" min="100" max="1000" step="10" value={confirmationDelay} aria-label="Tiempo de confirmación" onChange={e => { const value = Number(e.target.value); setConfirmationDelay(value); localStorage.setItem('dgt-chess-manager:confirmation-delay', String(value)); }} /><output>{confirmationDelay} ms</output></label><button type="button" onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}>Invertir tablero</button></div><div className="actions"><button type="button" onClick={saveGame}>Guardar partida</button><button type="button" onClick={newGame}>Nueva partida</button><button type="button" onClick={downloadPgn}>Guardar PGN</button><button type="button" onClick={downloadJson}>Exportar datos</button>{pendingMove && <button type="button" className="primary" onClick={() => setGame(s => applyConfirmedMove(s, pendingMove!.from, pendingMove!.to))}>Confirmar jugada</button>}{game.physical.status === 'desynced' && <button type="button" onClick={() => setGame(s => markReconciled(s))}>Marcar desincronizada</button>}</div><small className="license-note">GPL-3.0-or-later · Sin garantía</small></footer>
     </main>{portPickerOpen && <div className="modal-backdrop" role="presentation" onClick={() => setPortPickerOpen(false)}><section className="port-picker" role="dialog" aria-modal="true" aria-labelledby="port-picker-title" onClick={event => event.stopPropagation()}><div className="port-picker-head"><h2 id="port-picker-title">Elegir puerto DGT</h2><button type="button" className="icon-button" onClick={() => setPortPickerOpen(false)}>×</button></div><p className="muted">Selecciona un puerto detectado o escribe uno manualmente.</p>{devices.length > 0 ? <div className="port-options">{devices.map(device => <button type="button" className={`port-option ${device.port === activePort ? 'selected' : ''}`} key={device.port} onClick={() => void selectBoard(device.port)}><strong>{device.port}</strong><span>{device.description}</span></button>)}</div> : <p className="picker-empty">No se detectan puertos DGT. Conecta el tablero y pulsa de nuevo.</p>}{bridgeError && <p className="picker-error">{bridgeError}</p>}<form className="manual-port" onSubmit={event => { event.preventDefault(); const port = manualPort.trim().toUpperCase(); if (port) void selectBoard(port); }}><input aria-label="Puerto manual" placeholder="Ejemplo: COM3" value={manualPort} onChange={event => setManualPort(event.target.value)} /><button type="submit">Usar puerto</button></form></section></div>}
  </div>;
}
