import { useEffect, useMemo, useRef, useState } from 'react';
import { replayPositions } from './chessReplay';
import { messages } from './i18n';
import { requestId } from './api';
import type { ChessMove, Language, Room } from './types';

export function ChessPiece({ piece, color }: { piece: string; color: string }) {
  return <svg className={`chess-piece piece-${color}`} viewBox="0 0 48 48" aria-hidden="true">
    <g strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      {piece === 'p' && <><circle cx="24" cy="13" r="6" /><path d="M20 20h8l-1 8 7 9H14l7-9z" /></>}
      {piece === 'r' && <path d="M12 8h6v6h4V8h4v6h4V8h6v12l-6 4 2 13H16l2-13-6-4z" />}
      {piece === 'n' && <><path d="m15 37 3-10 10-7-7-2-6 5-6-6L21 7l1-4 7 6c9 4 10 16 7 28z" /><path className="piece-detail" d="m25 13 1 1M18 18l2-1" /></>}
      {piece === 'b' && <><path d="M24 6c-5 5-10 10-8 15l5 5-5 11h16l-5-11 5-5c2-5-3-10-8-15z" /><path className="piece-detail" d="m25 12-5 7M19 27h10" /></>}
      {piece === 'q' && <><path d="m11 15 7 6 6-10 6 10 7-6-5 16 2 6H14l2-6z" /><circle cx="10" cy="12" r="3" /><circle cx="24" cy="8" r="3" /><circle cx="38" cy="12" r="3" /><path className="piece-detail" d="M17 30h14" /></>}
      {piece === 'k' && <><path d="M24 5v9m-4-5h8" /><path d="M24 17c-7-9-17 0-11 8l5 5-3 7h18l-3-7 5-5c6-8-4-17-11-8z" /><path className="piece-detail" d="M18 30h12" /></>}
      <path d="M13 37h22l2 5H11z" />
    </g>
  </svg>;
}
export function boardPieces(fen: string) {
  const pieces = new Map<string, { type: string; color: string }>();
  fen.split(' ')[0].split('/').forEach((row, rank) => {
    let file = 0;
    for (const char of row) {
      if (/\d/.test(char)) file += Number(char);
      else { pieces.set(`${'abcdefgh'[file]}${8 - rank}`, { type: char.toLowerCase(), color: char === char.toUpperCase() ? 'w' : 'b' }); file++; }
    }
  });
  return pieces;
}
function clock(ms: number) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

export function ChessGame({ room, lang, busy, offline, now, action, onAgain }: {
  room: Room; lang: Language; busy: boolean; offline: boolean; now: number;
  action: (kind: string, body?: object) => void; onAgain: () => void;
}) {
  const t = messages[lang], state = room.chess!;
  const [selected, setSelected] = useState<string | null>(null), [promotion, setPromotion] = useState<ChessMove[]>([]);
  const [resigning, setResigning] = useState(false), [focusSquare, setFocusSquare] = useState(0);
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const board = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelected(null); setPromotion([]); }, [state.fen]);
  const completed = room.status === 'completed';
  const historyKey = completed ? state.moves.map(m => m.san).join(' ') : '';
  const positions = useMemo(() => completed ? replayPositions(state.moves) : [], [completed, historyKey]);
  const ply = completed ? Math.min(reviewPly ?? state.moves.length, state.moves.length) : state.moves.length;
  const pieces = boardPieces(completed ? positions[ply] : state.fen), flipped = state.myColor === 'b';
  const files = (flipped ? 'hgfedcba' : 'abcdefgh').split('');
  const ranks = flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const myTurn = room.status === 'playing' && state.turn === state.myColor;
  const targets = myTurn ? state.legalMoves.filter(m => m.from === selected) : [];
  const last = ply > 0 ? state.moves[ply - 1] : undefined;
  const hint = myTurn && state.hint?.status === 'ready' && state.hint.ply === state.moves.length ? state.hint.move : null;
  function review(next: number) { setSelected(null); setPromotion([]); setReviewPly(Math.max(0, Math.min(state.moves.length, next))); }
  const pieceName = (piece: string) => t[`chessPiece_${piece}` as keyof typeof t];
  function send(move: ChessMove) { action('move', { ...move, ply: state.moves.length, revision: state.revision, requestId: requestId() }); }
  function select(square: string) {
    if (!myTurn || busy || offline) return;
    const moves = targets.filter(m => m.to === square);
    if (moves.length > 1) { setPromotion(moves); return; }
    if (moves.length) { send(moves[0]); return; }
    setSelected(selected === square ? null : pieces.get(square)?.color === state.myColor ? square : null);
  }
  function playerBar(color: 'w' | 'b') {
    const player = room.players.find(p => p.id === (color === 'w' ? state.whiteId : state.blackId));
    const running = room.status === 'playing' && state.turn === color;
    const remaining = state.remaining[color] - (running ? Math.max(0, now - room.serverNow) : 0);
    return <div className={`chess-player ${running ? 'clock-running' : ''}`}>
      <span className={`chess-color ${color}`} aria-hidden="true" /><div><strong>{player?.name ?? '—'}{player?.nickname && <span className="identity-badge" aria-label={t.registeredNickname}>✓</span>}{player?.id === room.me.id ? ` ${t.you}` : ''}</strong><small>{color === 'w' ? t.chessWhite : t.chessBlack}</small></div>
      <time className={remaining < 30000 ? 'chess-time urgent' : 'chess-time'} aria-label={`${color === 'w' ? t.chessWhite : t.chessBlack}: ${clock(remaining)}`}>{clock(remaining)}</time>
    </div>;
  }
  return <section className="chess-layout">
    <div className="chess-board-panel">
      <div className="chess-heading" role="status"><h1>{completed ? room.winners.length === 2 ? t.chessDraw : room.winners.includes(room.me.id) ? t.won : t.chessLost : room.status === 'starting' ? t.chessWaitingStart : state.botThinking ? t.chessBotThinking : myTurn ? t.chessYourTurn : t.chessTheirTurn}</h1><span>{completed ? state.result : state.inCheck ? t.chessCheck : '10 + 0'}</span></div>
      {state.botThinking && <div className="chess-thinking" aria-hidden="true"><span /><span /><span /></div>}
      {playerBar(flipped ? 'w' : 'b')}
      <div ref={board} className="chess-board" role="group" aria-label={t.chessBoard} onKeyDown={e => {
        if (completed && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
          e.preventDefault(); review(e.key === 'Home' ? 0 : e.key === 'End' ? state.moves.length : ply + (e.key === 'ArrowRight' ? 1 : -1)); return;
        }
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
        if (delta !== undefined) { e.preventDefault(); const next = Math.max(0, Math.min(63, focusSquare + delta)); setFocusSquare(next); board.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus(); }
        if (e.key === 'Escape') setSelected(null);
      }}>
        {ranks.flatMap((rank, row) => files.map((file, col) => {
          const square = `${file}${rank}`, piece = pieces.get(square), index = row * 8 + col;
          const target = targets.some(m => m.to === square), recent = last?.from === square || last?.to === square;
          return <button key={square} type="button" tabIndex={focusSquare === index ? 0 : -1} onFocus={() => setFocusSquare(index)}
            className={`chess-square ${(row + col) % 2 ? 'dark-square' : 'light-square'} ${selected === square ? 'selected-square' : ''} ${recent ? 'last-move' : ''} ${target ? 'legal-target' : ''} ${hint?.from === square || hint?.to === square ? 'chess-hint-square' : ''}`}
            aria-label={`${square}: ${piece ? `${piece.color === 'w' ? t.chessWhite : t.chessBlack} ${pieceName(piece.type)}` : t.chessEmpty}${target ? `, ${t.chessLegalMove}` : ''}${hint?.from === square || hint?.to === square ? `, ${t.chessHint}` : ''}`}
            aria-pressed={selected === square} onClick={() => select(square)}>
            {col === 0 && <span className="rank-label" aria-hidden="true">{rank}</span>}{row === 7 && <span className="file-label" aria-hidden="true">{file}</span>}
            {piece && <ChessPiece piece={piece.type} color={piece.color} />}{target && <span className={piece ? 'capture-target' : 'move-target'} aria-hidden="true" />}
          </button>;
        }))}
      </div>
      {playerBar(flipped ? 'b' : 'w')}
      {completed && <div className="chess-replay" role="group" aria-label={t.chessReplay}>
        <div className="chess-replay-caption" role="status"><strong>{t.chessReplay}</strong><span>{ply === 0 ? t.chessInitialPosition : `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${last?.san}`} · {ply}/{state.moves.length}</span></div>
        <div className="chess-replay-controls">
          <button type="button" disabled={ply === 0} onClick={() => review(0)} aria-label={t.chessReplayFirst}>⏮</button>
          <button type="button" disabled={ply === 0} onClick={() => review(ply - 1)} aria-label={t.chessReplayPrevious}>←</button>
          <button type="button" disabled={ply === state.moves.length} onClick={() => review(ply + 1)} aria-label={t.chessReplayNext}>→</button>
          <button type="button" disabled={ply === state.moves.length} onClick={() => review(state.moves.length)} aria-label={t.chessReplayLast}>⏭</button>
        </div>
      </div>}
      {!completed && room.mode === 'practice' && room.status === 'playing' && <div className="chess-hint-control">
        <div className="chess-training-actions"><button className="button secondary" disabled={busy || offline || !myTurn || state.hint?.status === 'pending' || !!hint} onClick={() => action('hint', { ply: state.moves.length, revision: state.revision })}>{state.hint?.status === 'pending' ? t.chessHintThinking : t.chessHint}</button>
        <button className="button secondary" disabled={busy || offline || !state.canUndo} onClick={() => action('undo', { ply: state.moves.length, revision: state.revision, requestId: requestId() })} title={t.chessUndoNote}>{t.chessUndo}</button></div>
        <p className="muted small">{t.chessUndoNote}</p>
        <p className="muted small" role="status">{hint ? `${hint.from} → ${hint.to}${hint.promotion ? ` · ${pieceName(hint.promotion)}` : ''}` : state.hint?.status === 'error' ? t.chessHintFailed : t.chessHintNote}</p>
      </div>}
      {promotion.length > 0 && <div className="chess-promotion" role="group" aria-label={t.chessPromote}><strong>{t.chessPromote}</strong><div>{promotion.map(move => <button key={move.promotion} disabled={busy || offline} onClick={() => send(move)} aria-label={pieceName(move.promotion!)}><ChessPiece piece={move.promotion!} color={state.myColor!} /><span>{pieceName(move.promotion!)}</span></button>)}</div><button className="text-button" onClick={() => setPromotion([])}>{t.chessCancel}</button></div>}
      <p className="muted small chess-help">{completed ? t.chessReplayHelp : t.chessHelp}</p>
    </div>
    <aside className="chess-sidebar panel">
      {completed && <><h2>{state.result}</h2><p>{t[`reason_${room.reason}` as keyof typeof t] ?? t.allForfeit}</p><button className="button primary full" disabled={busy} onClick={onAgain}>{t.rematch}</button><p className="muted small">{t.rematchNote}</p></>}
      {!completed && room.status === 'playing' && <>
        {state.drawOffer && <div className="chess-draw-offer" role="status"><p>{state.drawOffer === room.me.id ? t.chessDrawSent : t.chessDrawReceived}</p>{state.drawOffer !== room.me.id && <div className="chess-actions"><button className="button secondary" disabled={busy || offline} onClick={() => action('acceptDraw')}>{t.chessAccept}</button><button className="text-button" disabled={busy || offline} onClick={() => action('declineDraw')}>{t.chessDecline}</button></div>}</div>}
        {resigning ? <div className="chess-resign-confirm"><p>{t.chessResignConfirm}</p><button className="button secondary" disabled={busy || offline} onClick={() => action('resign')}>{t.chessResign}</button><button className="text-button" onClick={() => setResigning(false)}>{t.chessCancel}</button></div> : <div className="chess-actions">{room.mode === 'friends' && <button className="text-button" disabled={busy || offline || !!state.drawOffer} onClick={() => action('offerDraw')}>{t.chessOfferDraw}</button>}<button className="text-button" disabled={busy || offline} onClick={() => setResigning(true)}>{t.chessResign}</button></div>}
      </>}
      <h2>{t.chessMoves}</h2>
      {state.moves.length ? <ol className="chess-moves">{state.moves.filter((_, i) => i % 2 === 0).map((_, i) => <li key={i}>{[0, 1].map(side => {
        const movePly = i * 2 + side + 1, move = state.moves[movePly - 1];
        return completed && move ? <button key={side} type="button" className={ply === movePly ? 'review-current' : ''} aria-current={ply === movePly ? 'step' : undefined} aria-label={`${i + 1}${side ? '…' : '.'} ${move.san}`} onClick={() => review(movePly)}>{move.san}</button> : <span key={side}>{move?.san ?? '…'}</span>;
      })}</li>)}</ol> : <p className="muted">{t.chessNoMoves}</p>}
    </aside>
  </section>;
}
