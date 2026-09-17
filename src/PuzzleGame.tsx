import { useEffect, useRef, useState } from 'react';
import { ChessPiece, boardPieces } from './ChessGame';
import { requestId } from './api';
import { messages } from './i18n';
import type { ChessMove, Language, Room } from './types';

export function PuzzleGame({ room, lang, busy, offline, action, next }: {
  room: Room; lang: Language; busy: boolean; offline: boolean;
  action: (kind: string, body?: object) => void; next: () => void;
}) {
  const t = messages[lang], state = room.chess!, puzzle = room.puzzle!;
  const [selected, setSelected] = useState<string | null>(null), [promotion, setPromotion] = useState<ChessMove[]>([]);
  const [focus, setFocus] = useState(0); const board = useRef<HTMLDivElement>(null);
  useEffect(() => { setSelected(null); setPromotion([]); }, [state.fen, puzzle.misses]);
  const pieces = boardPieces(state.fen), black = state.myColor === 'b', completed = room.status === 'completed';
  const files = (black ? 'hgfedcba' : 'abcdefgh').split(''), ranks = black ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
  const targets = state.legalMoves.filter(m => m.from === selected);
  const pieceName = (piece: string) => t[`chessPiece_${piece}` as keyof typeof t];
  function send(move: ChessMove) { action('move', { ...move, ply: puzzle.ply, requestId: requestId() }); }
  function select(square: string) {
    const options = targets.filter(m => m.to === square);
    if (options.length > 1) setPromotion(options);
    else if (options.length) send(options[0]);
    else setSelected(selected === square ? null : pieces.get(square)?.color === state.myColor ? square : null);
  }
  return <section className="chess-layout puzzle-layout">
    <div><div className="chess-heading"><h1>{completed ? room.me.score === 1 ? t.puzzleSolved : t.puzzleSolution : t.mateIn.replace('{n}', String(puzzle.mate))}</h1><span>{black ? t.chessBlack : t.chessWhite}</span></div>
      <div className="chess-board" ref={board} role="group" aria-label={t.chessBoard} onKeyDown={e => {
        const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
        if (delta !== undefined) { e.preventDefault(); const index = Math.max(0, Math.min(63, focus + delta)); setFocus(index); board.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus(); }
        if (e.key === 'Escape') setSelected(null);
      }}>
        {ranks.flatMap((rank, row) => files.map((file, col) => {
          const square = file + rank, piece = pieces.get(square), index = row * 8 + col, target = targets.some(m => m.to === square);
          return <button type="button" key={square} tabIndex={index === focus ? 0 : -1} onFocus={() => setFocus(index)} aria-disabled={busy || offline || completed}
            onClick={() => { if (!busy && !offline && !completed) select(square); }} aria-pressed={selected === square}
            aria-label={`${square}: ${piece ? `${piece.color === 'w' ? t.chessWhite : t.chessBlack} ${pieceName(piece.type)}` : t.chessEmpty}`}
            className={`chess-square ${(row + col) % 2 ? 'dark-square' : 'light-square'} ${selected === square ? 'selected-square' : ''} ${puzzle.hint?.from === square || puzzle.hint?.to === square ? 'puzzle-hint-square' : ''}`}>
            {col === 0 && <span className="rank-label" aria-hidden="true">{rank}</span>}{row === 7 && <span className="file-label" aria-hidden="true">{file}</span>}
            {piece && <ChessPiece piece={piece.type} color={piece.color} />}{target && <span className={piece ? 'capture-target' : 'move-target'} aria-hidden="true" />}
          </button>;
        }))}
      </div>
      {promotion.length > 0 && <div className="chess-promotion"><strong>{t.chessPromote}</strong><div>{promotion.map(move => <button key={move.promotion} disabled={busy || offline} onClick={() => send(move)}>{pieceName(move.promotion!)}</button>)}</div><button className="text-button" onClick={() => setPromotion([])}>{t.chessCancel}</button></div>}
      <p className="muted small chess-help">{t.chessHelp}</p>
    </div>
    <aside className="panel puzzle-sidebar"><h2>{t.puzzles}</h2><p className="muted small">{t.puzzleNote}</p>{puzzle.rating !== null && <p className="difficulty-badge">{t.puzzleRating}: {puzzle.rating}</p>}
      <p role="status" className={puzzle.feedback === 'wrong' ? 'puzzle-wrong' : 'correct'}>{!completed && (puzzle.feedback === 'wrong' ? t.puzzleWrong : puzzle.feedback === 'correct' ? t.puzzleCorrect : t.chessYourTurn)}</p>
      <p>{t.puzzleMisses}: <strong>{puzzle.misses}</strong></p>{puzzle.assisted && <p className="muted small">{t.puzzleAssisted}</p>}
      {!completed ? <div className="result-actions"><button className="button secondary" disabled={busy || offline} onClick={() => action('hint')}>{t.puzzleHint}</button>{puzzle.hint && <p>{puzzle.hint.from} → {puzzle.hint.to}</p>}<button className="text-button" disabled={busy || offline} onClick={() => action('finish')}>{t.puzzleReveal}</button></div>
        : <><h2>{t.puzzleSolution}</h2><p className="puzzle-line">{puzzle.solution.join(' · ')}</p><button className="button primary full" disabled={busy} onClick={next}>{t.puzzleNext}</button></>}
      {state.moves.length > 0 && <><h2>{t.chessMoves}</h2><p className="puzzle-line">{state.moves.map(m => m.san).join(' · ')}</p></>}
    </aside>
  </section>;
}
