export type Language = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'uk';
import type { CapitalRole } from '../shared/capitals.mjs';
export type Topic = 'math' | 'flags' | 'capitals' | 'chess' | 'mixed' | 'puzzles';
export type User = { id: string; name: string; nickname?: string; wallet?: { address: string; verifiedAt: number } };
export type Visual = { type: string; colors?: string[]; weights?: number[]; src?: string };
export type Question = { id: string; kind: Topic; prompt?: string; countryCode?: string; capitalRole?: CapitalRole; visual?: Visual; options?: { id: string; label: string; countryCode?: string; capitalId?: string }[] };
export type ChessMove = { from: string; to: string; promotion?: string };
export type ChessState = {
  fen: string; turn: 'w' | 'b'; whiteId: string | null; blackId: string | null; myColor: 'w' | 'b' | null;
  remaining: { w: number; b: number }; inCheck: boolean; result: string | null; drawOffer: string | null;
  moves: (ChessMove & { san: string; color: 'w' | 'b' })[]; legalMoves: ChessMove[];
  botThinking: boolean;
  revision: number; canUndo: boolean;
  hint: { status: 'pending' | 'ready' | 'error'; ply: number; requestedAt: number; move: (ChessMove & { san: string }) | null } | null;
};
export type Room = {
  matchmaking: boolean; ranked: boolean;
  rating: { category: string; status: string; players: { id: string; before: number; after: number; delta: number }[] } | null;
  invitedNickname: string | null;
  puzzle?: { mate: number; rating: number | null; total: number; misses: number; assisted: boolean; feedback: string | null; hint: ChessMove | null; ply: number; solution: string[] };
  training: boolean; rematchCode: string | null; rematchOf: string | null;
  chess?: ChessState;
  code: string; topic: Topic; difficulty: string; language: Language; mode: string; capacity: number;
  rulesVersion: number; roundMs: number; startWindowMs: number; questionCount: number;
  stakeLuna: number; feeContributionLuna?: number; paymentNetwork?: 'testalbatross' | 'mainalbatross';
  status: 'lobby' | 'starting' | 'playing' | 'completed' | 'cancelled' | 'void';
  createdAt: number; startDeadline: number | null; lobbyDeadline: number; closedAt: number | null;
  reason: string | null; winners: string[]; serverNow: number;
  players: { id: string; name: string; nickname: string | null; ready: boolean; funded: boolean; status: string; score: number | null; answered: number | null }[];
  me: { id: string; status: string; startedAt: number | null; deadline: number | null; answered: number; score: number | null };
  question: Question | null;
  feedback: { correct: boolean; skipped: boolean; answer: string; kind: Topic } | null;
  review: { questionId: string; correct: boolean; skipped: boolean; question: Question; answer: string; submitted: string | null }[];
};
export type History = { code: string; topic: Topic; status: string; mode: string; createdAt: number; score: number | null; won: boolean; players: number };
export type Progress = {
  games: number; mistakes: number;
  groups: { topic: Topic; difficulty: string; mode: string; games: number; wins: number; draws: number; losses: number;
    correct: number; wrong: number; skipped: number; bestScore: number | null }[];
  mistakeGroups: { topic: Topic; difficulty: string; count: number }[];
};
export type SearchState = { status: 'idle' | 'searching' | 'matched'; ranked?: boolean; stakeLuna?: number; paymentNetwork?: 'testalbatross' | 'mainalbatross'; ticket?: string; topic?: Topic; difficulty?: string; expiresAt?: number; room?: Room };
export type Invitation = { id: string; from: string; to: string; incoming: boolean; status: string; topic: Topic; difficulty: string; stakeLuna: number; paymentNetwork?: 'testalbatross' | 'mainalbatross'; expiresAt: number; roomCode?: string };

export type RematchRequest = { code: string; previousCode: string; from: string; topic: Topic; difficulty: string; capacity: number; stakeLuna: number; paymentNetwork?: 'testalbatross' | 'mainalbatross'; expiresAt: number };
