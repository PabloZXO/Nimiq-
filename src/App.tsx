import { currency, paymentMessages, type PaymentNetwork } from './payment-network';
import feeLocales from '../shared/fee-locales.json';
import { NavIcon } from './NavIcon';
import { Leaderboard } from './Leaderboard';
import { playSound, roomSound, setSoundEnabled, silence, soundEnabled, unlockSound } from './sound';
import { RematchRequests } from './RematchRequests';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { getHostLanguage } from '@nimiq/mini-app-sdk';
import { api, requestId } from './api';
import { capitalLabel, capitalPrompt, countryLabel, errorText, localizeText, messages, resolveLanguage } from './i18n';
import { People } from './People';
import { usePresence } from './usePresence';
import { RoomQr } from './RoomQr';
import chessLevels from '../shared/chess-levels.json';
import { PuzzleGame } from './PuzzleGame';
import { Progress } from './Progress';
import { Select } from './Select';
import { LanguageFlag } from './LanguageFlag';
import { Settings } from './Settings';
import { About } from './About';
import { ChessGame, ChessPiece } from './ChessGame';
import { Flag } from './Flag';
import { Wallet } from './Wallet';
import { Payments, PaymentRules } from './Payments';
import type { History, Language, Room, Topic, User, SearchState, Invitation, RematchRequest } from './types';

type Page = 'home' | 'game' | 'setup' | 'room' | 'history' | 'wallet' | 'profile' | 'search' | 'people' | 'leaderboard' | 'join';
const activeStatuses = ['lobby', 'starting', 'playing'];
function restoredRoom(rooms: History[]) {
  const requested = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase();
  return requested ? rooms.find(room => room.code === requested)?.code
    : rooms.find(room => activeStatuses.includes(room.status))?.code;
}
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* Preferences are optional. */ } }
function initialLanguage(): Language {
  return resolveLanguage(stored('nimduel-language'), getHostLanguage(), navigator.language);
}
function timeLeft(deadline: number | null, now: number) {
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function Mark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small-mark' : ''}`} aria-hidden="true">N<span /></span>;
}

export function App() {
  const [lang, setLang] = useState<Language>(initialLanguage);
  const [paymentNetwork, setPaymentNetwork] = useState<PaymentNetwork>('testalbatross');
  const [feeContributionLuna, setFeeContributionLuna] = useState(0);
  const t = paymentMessages(lang, paymentNetwork);
  const [page, setPage] = useState<Page>(() => /^[a-f0-9]{10}$/i.test(new URLSearchParams(location.search).get('room') ?? '') ? 'join' : 'home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [audioOn, setAudioOn] = useState(soundEnabled);
  useEffect(() => {
    const unlock = (event: Event) => { if (event.isTrusted) unlockSound(); };
    const hidden = () => { if (document.visibilityState !== 'visible') silence(); };
    const sync = (event: StorageEvent) => {
      if (event.key === 'nimduel-sound') { const value = event.newValue !== 'off'; setSoundEnabled(value); setAudioOn(value); }
    };
    document.addEventListener('pointerdown', unlock, true); document.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', hidden); window.addEventListener('storage', sync);
    return () => { document.removeEventListener('pointerdown', unlock, true); document.removeEventListener('keydown', unlock, true); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('storage', sync); silence(); };
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const identified = Boolean(user?.wallet && user?.nickname);
  usePresence(identified ? user : null);
  const [name, setName] = useState(stored('nimduel-name') ?? '');
  const [topic, setTopic] = useState<Topic>('math');
  const [difficulty, setDifficulty] = useState('normal');
  const [chessDifficulty, setChessDifficulty] = useState('normal');
  const [chessColor, setChessColor] = useState('w');
  const [capacity, setCapacity] = useState(2);
  const [stake, setStake] = useState(0);
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [code, setCode] = useState(() => (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().slice(0, 10));
  const [room, setRoom] = useState<Room | null>(null);
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [ranked, setRanked] = useState(false);
  const [rematchRequests, setRematchRequests] = useState<RematchRequest[]>([]);
  const [search, setSearch] = useState<SearchState>({ status: 'idle' });
  const [history, setHistory] = useState<History[]>([]);
  const [ready, setReady] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [answer, setAnswer] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const busyRef = useRef(false);
  const requestSequence = useRef(0);
  const lastApplied = useRef(0);
  const clock = useRef({ server: Date.now(), local: performance.now() });
  const roomRef = useRef<Room | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (page === 'game') mainRef.current?.querySelector<HTMLElement>('.game-launch h1')?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    let alive = true;
    const check = () => api<{ ready: boolean; network: PaymentNetwork; feeContributionLuna?: number }>('/payments').then(value => { if (alive) { setPaymentsReady(value.ready); setPaymentNetwork(value.network); setFeeContributionLuna(value.feeContributionLuna ?? 0); } }).catch(() => { if (alive) setPaymentsReady(false); });
    void check(); const timer = setInterval(check, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!user?.nickname) { setInvitations([]); return; }
    let alive = true;
    const controller = new AbortController();
    const refresh = () => api<{ invitations: Invitation[] }>('/invitations', undefined, controller.signal)
      .then(value => { if (alive) setInvitations(value.invitations); }).catch(() => {});
    void refresh(); const timer = setInterval(refresh, 5000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, [user?.id, user?.nickname]);
  useEffect(() => {
    if (!user?.wallet || !user.nickname) { setRematchRequests([]); return; }
    const controller = new AbortController(); let alive = true;
    const refresh = () => api<{ requests: RematchRequest[] }>('/rematches', undefined, controller.signal)
      .then(value => { if (alive) setRematchRequests(value.requests); }).catch(() => {});
    void refresh(); const timer = setInterval(refresh, 3000);
    return () => { alive = false; controller.abort(); clearInterval(timer); };
  }, [user?.id, user?.nickname]);
  function respondRematch(request: RematchRequest, accept: boolean) {
    void run(async () => {
      if (accept) enterRoom(await api<Room>(`/rooms/${request.previousCode}/rematch`, {}), ++requestSequence.current);
      else await api(`/rematches/${request.code}/decline`, {});
      setRematchRequests((await api<{ requests: RematchRequest[] }>('/rematches')).requests);
    });
  }
  function prepareInvite(nickname: string) {
    setInviteTarget(nickname); if (topic === 'puzzles') setTopic('math');
    setCapacity(2); setStake(0); navigate('setup');
  }
  function invitationAction(id: string, kind: string) {
    void run(async () => {
      const result = await api<{ room?: Room }>(`/invitations/${id}/${kind}`, {});
      if (result.room) enterRoom(result.room, ++requestSequence.current);
      const inbox = await api<{ invitations: Invitation[] }>('/invitations'); setInvitations(inbox.invitations);
    });
  }
  useEffect(() => { document.documentElement.lang = lang; document.title = `NimDuel — ${messages[lang].math} / ${messages[lang].flags} / ${messages[lang].capitals} / ${messages[lang].chess}`; }, [lang]);
  const updateRoom = useCallback((value: Room, sequence: number) => {
    if (sequence < lastApplied.current) return;
    lastApplied.current = sequence;
    clock.current = { server: value.serverNow, local: performance.now() };
    const sound = roomSound(roomRef.current, value); if (sound) playSound(sound);
    roomRef.current = value; setRoom(value); setNow(value.serverNow); setOffline(false);
  }, []);
  useEffect(() => {
    let mounted = true;
    let sessionChecked = false;
    const controller = new AbortController();
    setSessionFailed(false);
    api<{ user: User | null }>('/session', undefined, controller.signal).then(async data => {
      if (!mounted) return;
      setUser(data.user);
      // Only a successful response can establish that wallet authentication is missing.
      sessionChecked = true;
      if (data.user) setName(data.user.name);
      if (data.user?.wallet && data.user.nickname) {
        const result = await api<{ rooms: History[] }>('/rooms');
        if (mounted) {
          setHistory(result.rooms);
          const queued = await api<SearchState>('/search');
          if (mounted && queued.status === 'searching') { setSearch(queued); setPage('search'); return; }
          if (mounted && queued.status === 'matched' && queued.room && activeStatuses.includes(queued.room.status) && !location.search) {
            enterRoom(queued.room, ++requestSequence.current);
          }
          const requested = restoredRoom(result.rooms);
          if (requested) {
            const sequence = ++requestSequence.current;
            const current = await api<Room>(`/rooms/${requested}`);
            if (mounted) enterRoom(current, sequence);
          }
        }
      }
    }).catch(e => { if (mounted) { setError(errorText(e, lang)); setSessionFailed(true); } })
      .finally(() => { if (mounted && sessionChecked) setReady(true); });
    return () => { mounted = false; controller.abort(); };
  }, [sessionAttempt]);
  useEffect(() => {
    if (ready || !sessionFailed) return;
    const retry = () => { setError(''); setSessionAttempt(value => value + 1); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [ready, sessionFailed]);
  useEffect(() => {
    const timer = setInterval(() => setNow(clock.current.server + performance.now() - clock.current.local), 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setAnswer(''); }, [room?.question?.id]);
  useEffect(() => {
    if (!identified || page !== 'room' || !room) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const roomCode = room.code;
    const controller = new AbortController();
    async function poll() {
      try {
        if (!busyRef.current) {
          const sequence = ++requestSequence.current;
          const playing = roomRef.current?.me.status === 'playing' && roomRef.current?.status === 'playing';
          const next = playing
            ? await api<Room>(`/rooms/${roomCode}/heartbeat`, {}, controller.signal)
            : await api<Room>(`/rooms/${roomCode}`, undefined, controller.signal);
          if (!cancelled) updateRoom(next, sequence);
          if (!activeStatuses.includes(next.status)) return;
        }
      } catch { if (!cancelled) setOffline(true); }
      finally { if (!cancelled && activeStatuses.includes(roomRef.current?.status ?? '')) timeout = setTimeout(poll, 1500); }
    }
    timeout = setTimeout(poll, 1000);
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [identified, page, room?.code, updateRoom]);

  function walletUser(value: User | null) {
    if (value?.id !== user?.id) {
      roomRef.current = null; setRoom(null); setHistory([]); setSearch({ status: 'idle' });
      if (page === 'room' || page === 'search') setPage(/^[a-f0-9]{10}$/i.test(new URLSearchParams(location.search).get('room') ?? '') ? 'join' : 'home');
    }
    setUser(value);
    if (value) { setName(value.name); remember('nimduel-name', value.name); }
    if (value?.wallet && value.nickname) {
      void api<{ rooms: History[] }>('/rooms').then(async result => {
        setHistory(result.rooms);
        const requested = restoredRoom(result.rooms);
        if (requested) enterRoom(await api<Room>(`/rooms/${requested}`), ++requestSequence.current);
      }).catch(e => setError(errorText(e, lang)));
    }
  }
  useEffect(() => {
    let alive = true, refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try { const result = await api<{ user: User | null }>('/session'); if (alive) setUser(result.user); }
      // A failed request says nothing about whether the saved login is valid.
      catch (e) { if (alive) setError(errorText(e, lang)); }
      finally { refreshing = false; }
    };
    window.addEventListener('nimduel-auth-required', refresh);
    return () => { alive = false; window.removeEventListener('nimduel-auth-required', refresh); };
  }, []);

  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(errorText(e, lang)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function session() {
    const data = await api<{ user: User }>('/session', { name });
    setUser(data.user); remember('nimduel-name', data.user.name); return data.user;
  }
  async function loadHistory() {
    if (!identified) return;
    const result = await api<{ rooms: History[] }>('/rooms'); setHistory(result.rooms);
  }
  function navigate(next: Page) {
    if (next !== page) playSound('tap');
    if (next !== 'setup') setInviteTarget(null);
    if (page === 'search' && search.ticket) { cancelSearch(next); return; }
    setError(''); setCopyMessage(''); setPage(next);
    if (next === 'home' || next === 'history') void run(loadHistory);
  }
  function enterRoom(value: Room, sequence: number) {
    updateRoom(value, sequence); setPage('room');
    const url = new URL(location.href); url.searchParams.set('room', value.code); window.history.replaceState(null, '', url);
  }
  function create(mode: 'practice' | 'friends', selectedTopic = topic, selectedDifficulty = selectedTopic === 'chess' ? chessDifficulty : difficulty) {
    void run(async () => {
      await session();
      const sequence = ++requestSequence.current;
      enterRoom(await api<Room>('/rooms', { topic: selectedTopic, difficulty: selectedTopic === 'chess' && mode === 'friends' ? 'normal' : selectedDifficulty, language: lang, capacity: inviteTarget || selectedTopic === 'chess' ? 2 : capacity, mode, paymentNetwork, stake: mode === 'friends' ? stake : 0, ...(mode === 'friends' && inviteTarget ? { invite: inviteTarget } : {}), ...(selectedTopic === 'chess' && mode === 'practice' ? { chessColor } : {}) }), sequence);
      if (mode === 'practice') playSound('start');
    });
  }
  function findOpponent() {
    void run(async () => {
      await session();
      const result = await api<SearchState>('/search/start', { topic, difficulty: topic === 'chess' ? 'normal' : difficulty, language: lang, stake, paymentNetwork, ranked: ranked && topic !== 'mixed' && Boolean(user?.nickname) });
      setSearch(result);
      if (result.room) enterRoom(result.room, ++requestSequence.current);
      else { window.history.replaceState(null, '', location.pathname); setPage('search'); }
    });
  }
  function cancelSearch(next: Page = 'home') {
    void run(async () => {
      const result = await api<SearchState>('/search/cancel', { ticket: search.ticket });
      setSearch(result);
      if (result.room && ['starting', 'playing'].includes(result.room.status)) enterRoom(result.room, ++requestSequence.current);
      else { setPage(next); await loadHistory(); }
    });
  }
  useEffect(() => {
    if (!identified || page !== 'search' || search.status !== 'searching' || !search.ticket) return;
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        if (!busyRef.current) {
          const result = await api<SearchState>('/search/heartbeat', { ticket: search.ticket }, controller.signal);
          if (alive) {
            setSearch(result); setOffline(false);
            if (result.room) enterRoom(result.room, ++requestSequence.current);
          }
        }
      } catch { if (alive) setOffline(true); }
      finally { if (alive) timer = setTimeout(poll, 2500); }
    }
    timer = setTimeout(poll, 1000);
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [identified, page, search.ticket, search.status]);
  function rematch() {
    if (!room) return;
    void run(async () => {
      const sequence = ++requestSequence.current;
      enterRoom(await api<Room>(`/rooms/${room.code}/rematch`, {}), sequence);
    });
  }
  function trainMistakes(trainingTopic: Topic, trainingDifficulty: string) {
    void run(async () => {
      await session();
      const sequence = ++requestSequence.current;
      enterRoom(await api<Room>('/rooms', { topic: trainingTopic, difficulty: trainingDifficulty,
        language: lang, mode: 'practice', training: 'mistakes' }), sequence);
    });
  }
  function join(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await session();
      const sequence = ++requestSequence.current;
      enterRoom(await api<Room>(`/rooms/${code.trim().toUpperCase()}/join`, {}), sequence);
    });
  }
  function openRoom(roomCode: string) {
    void run(async () => {
      const sequence = ++requestSequence.current;
      enterRoom(await api<Room>(`/rooms/${roomCode}`), sequence);
    });
  }
  function action(kind: string, body = {}) {
    if (!room) return;
    void run(async () => {
      const sequence = ++requestSequence.current;
      updateRoom(await api<Room>(`/rooms/${room.code}/${kind}`, body), sequence);
    });
  }
  function submit(value: string | null) {
    if (!room?.question || busyRef.current) return;
    action('answer', { questionId: room.question.id, value, requestId: requestId() });
  }
  function leave() {
    if (!room) return;
    void run(async () => {
      await api(`/rooms/${room.code}/leave`, {});
      roomRef.current = null; setRoom(null); setPage('home'); await loadHistory();
      window.history.replaceState(null, '', location.pathname);
    });
  }
  async function copyInvite() {
    if (!room) return;
    const link = new URL(location.origin); link.searchParams.set('room', room.code);
    try { await navigator.clipboard.writeText(link.toString()); setCopyMessage(t.copied); }
    catch { setCopyMessage(t.copyFallback); }
  }

  const playing = identified && page === 'room' && room?.status === 'playing' && room.me.status === 'playing';
  useEffect(() => {
    if (!playing || settingsOpen || aboutOpen || room?.question?.kind !== 'math') return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || busyRef.current) return;
      const target = event.target;
      if (target instanceof HTMLElement && !target.classList.contains('answer-display') &&
        (target.isContentEditable || target.closest('input, textarea, select, button, a, [role="button"]'))) return;
      if (/^[0-9]$/.test(event.key)) { event.preventDefault(); setAnswer(current => (current + event.key).slice(0, 7)); }
      else if (event.key === 'Backspace') { event.preventDefault(); setAnswer(current => current.slice(0, -1)); }
      else if (event.key === 'Enter' && answer) { event.preventDefault(); submit(answer); }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [playing, room?.question?.id, answer, settingsOpen, aboutOpen]);

  function nameInput() {
    return <label className="field">{user?.nickname ? t.nickname : t.name}<input readOnly={Boolean(user?.nickname)} value={name} onChange={e => setName(e.target.value)} maxLength={24} autoComplete="nickname" placeholder={t.namePlaceholder} /></label>;
  }
  function topicPicker() {
    return <div className="topic-picker" role="group" aria-label={t.topic}>
      {(['math', 'flags', 'capitals', 'chess', 'mixed', 'puzzles'] as Topic[]).filter(item => page !== 'setup' || item !== 'puzzles').map(item => <button key={item} className={`topic-card ${item} ${page === 'setup' && topic === item ? 'selected' : ''}`} aria-pressed={page === 'setup' ? topic === item : undefined} onClick={() => { setTopic(item); if (page === 'home') navigate('game'); }}>
        <div className="topic-art" aria-hidden="true">{item === 'math' ? <><span className="math-expression">7 × 8</span><span className="math-answer">56</span><span className="tiny-plus">+</span></> : item === 'mixed' ? <span className="mixed-art">7 × 8 <span>⚑ ⌂</span></span> : item === 'chess' || item === 'puzzles' ? <ChessPiece piece="n" color="w" /> : item === 'capitals' ? <svg className="capital-art" viewBox="0 0 180 120"><path d="M25 103h130M35 94h110M44 50h92L90 24Z" /><path d="M51 57v30m26-30v30m26-30v30m26-30v30" /><circle cx="90" cy="39" r="3" /></svg> : <><div className="flag-swatch france"><i /><i /><i /></div><div className="flag-swatch japan"><i /></div><span className="globe-lines">◎</span></>}</div>
        <span className="topic-name">{t[item]}</span><span className="topic-description">{item === 'math' ? t.mathDesc : item === 'flags' ? t.flagsDesc : item === 'capitals' ? t.capitalsDesc : item === 'mixed' ? t.mixedDesc : item === 'puzzles' ? t.puzzlesDesc : t.chessDesc}</span>
        {page === 'setup' && <span className="selection-check" aria-hidden="true">{topic === item ? '✓' : '+'}</span>}
      </button>)}
    </div>;
  }
  function difficultyPicker() {
    return topic === 'chess' && page === 'setup' ? <p className="muted small">{t.chessHumanDifficulty}</p> : topic === 'chess' ? <Select compact label={t.difficulty} value={chessDifficulty} onChange={setChessDifficulty} options={Object.keys(chessLevels).map(value => ({ value, label: t[value as keyof typeof t] }))} /> : <Select compact label={t.difficulty} value={difficulty} onChange={setDifficulty} options={[{ value: 'easy', label: t.easy }, { value: 'normal', label: t.normal }, { value: 'hard', label: t.hard }]} />;
  }
  function difficultyHint() { return t[`${topic}Level_${topic === 'chess' ? chessDifficulty : difficulty}` as keyof typeof t]; }
  function colorPicker() {
    return topic === 'chess' && <fieldset className="chess-color-picker"><legend>{t.chessChooseColor}</legend>
      {[{ value: 'w', label: t.chessWhite }, { value: 'b', label: t.chessBlack }, { value: 'random', label: t.chessRandomColor }].map(option => <label key={option.value}>
        <input type="radio" name="chess-color" value={option.value} checked={chessColor === option.value} onChange={() => setChessColor(option.value)} />
        <span>{option.value === 'random' ? <span className="chess-random-color" aria-hidden="true">◐</span> : <span className={`chess-color ${option.value}`} aria-hidden="true" />}{option.label}</span>
      </label>)}
    </fieldset>;
  }
  function entryPicker() {
    return <div className="entry-choice"><Select label={t.entryPerPlayer} value={String(stake)} onChange={value => setStake(Number(value))}
      options={[{ value: '0', label: t.freeEntry }, ...[1,5,10].map(n => ({ value: String(n * 100000), label: `${n} ${currency(paymentNetwork)}`, disabled: !paymentsReady || !user?.wallet }))]} />
      {!paymentsReady && <p className="muted small">{t.entryUnavailable}</p>}
      {stake > 0 && feeContributionLuna > 0 && <p className="muted small">{feeLocales[lang].note}</p>}
    </div>;
  }
  function rules() {
    const rulesStake = page === 'room' ? room?.stakeLuna : stake;
    if ((page === 'room' ? room?.topic : topic) === 'puzzles') return <section className="rules"><h2>{t.puzzles}</h2><p>{t.puzzleNote}</p></section>;
    if ((page === 'room' ? room?.topic : topic) === 'chess') return <section className="rules"><h2>{t.rulesTitle}</h2><ol><li>{t.chessRule1}</li><li>{t.chessRule2}</li><li>{t.chessRule3}</li><li>{t.chessRule4}</li></ol>{rulesStake ? <PaymentRules lang={lang} network={page === 'room' ? room?.paymentNetwork : paymentNetwork} fee={page === 'room' ? room?.feeContributionLuna : feeContributionLuna} /> : <p className="muted small">{t.chessFree}</p>}</section>;
    return <section className="rules"><h2>{t.rulesTitle}</h2><ol><li>{t.rule1}</li><li>{t.rule2}</li><li>{t.rule3}</li><li>{t.rule4}</li></ol>{rulesStake ? <PaymentRules lang={lang} network={page === 'room' ? room?.paymentNetwork : paymentNetwork} fee={page === 'room' ? room?.feeContributionLuna : feeContributionLuna} /> : <p className="muted small">{t.freeRules}</p>}</section>;
  }
  function playerList(results = false) {
    if (!room) return null;
    const players = results ? [...room.players].sort((a, b) => (a.status === 'forfeit' ? 1 : 0) - (b.status === 'forfeit' ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0)) : room.players;
    return <div className="player-list">{players.map((p, i) => <div key={p.id} className={`player ${room.winners.includes(p.id) ? 'winner' : ''}`}>
      <span className={`avatar avatar-${i % 4}`}>{(p.nickname ?? p.name).slice(0, 1).toLocaleUpperCase()}</span><div className="player-name"><strong>{p.name}{p.nickname && <span className="identity-badge" aria-label={t.registeredNickname}>✓</span>}{p.id === user?.id && <span className="you">{t.you}</span>}</strong><span>{p.status === 'playing' ? t.statusPlaying : p.status === 'finished' ? t.statusFinished : p.status === 'forfeit' ? t.statusForfeit : p.ready ? '✓ ' + t.readyDone : t.statusWaiting}</span></div>
      {results && <strong className="player-score">{p.status === 'forfeit' ? '—' : p.score}</strong>}
      {!results && p.ready && <span className="ready-dot" aria-label={t.readyDone}>✓</span>}
    </div>)}{!results && Array.from({ length: Math.max(0, room.capacity - players.length) }, (_, i) => <div className="player empty-player" key={`empty-${i}`}><span className="avatar">+</span><span>{t.statusWaiting}</span></div>)}</div>;
  }

  return <div className="app-shell">
    {settingsOpen && <Settings lang={lang} onLanguage={value => { remember('nimduel-language', value); setLang(value); }} onClose={() => setSettingsOpen(false)} />}
    {aboutOpen && <About network={paymentNetwork} lang={lang} onClose={() => setAboutOpen(false)} />}
    <header className="topbar"><button className="brand" onClick={() => navigate('home')} aria-label="NimDuel"><Mark small /><span>NimDuel</span></button>
      <span className="free-tag">{t.free}</span><button className="language-button settings-button" onClick={() => setSettingsOpen(true)} aria-label={t.language} aria-haspopup="dialog"><svg className="language-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></svg><LanguageFlag lang={lang} /><span>{t.language}</span></button>
      <button className="sound-toggle" type="button" aria-label={t.sound} aria-pressed={audioOn} title={audioOn ? t.soundOff : t.soundOn} onClick={() => {
        const next = !audioOn; setSoundEnabled(next); setAudioOn(next); if (next) { unlockSound(); playSound('tap'); }
      }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{audioOn ? <path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}</svg></button>
    </header>
    <div className={`workspace ${identified ? '' : 'onboarding-workspace'}`}>{identified && <nav className="navigation" aria-label={t.navigation}>
      {(['home', 'history', 'profile', 'wallet'] as const).map((item, i) => <button key={item} className={(page === item || (item === 'profile' && ['people', 'leaderboard'].includes(page)) || (item === 'home' && ['game', 'setup', 'room', 'search', 'join'].includes(page))) ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item)}><NavIcon name={item} /><span className="nav-label">{[t.play, t.history, t.profile, t.wallet][i]}</span></button>)}
      <div className="nav-footer"><span className="connection-dot" />Nimiq Pay Mini App</div>
    </nav>}
    <main ref={mainRef} className={playing ? 'main game-main' : page === 'home' && identified ? 'main catalog-main' : 'main'}>
      {error && <div className="error-banner" role="alert"><span>{localizeText(error, lang)}</span><button onClick={() => setError('')} aria-label={t.dismiss}>×</button></div>}
      {identified && invitations.some(i => i.incoming && i.status === 'pending') && !playing && page !== 'people' && <button className="invitation-banner" onClick={() => navigate('people')}>{t.invitations} <strong>{invitations.filter(i => i.incoming && i.status === 'pending').length}</strong></button>}
      {identified && !playing && <RematchRequests requests={rematchRequests} lang={lang} busy={busy} act={respondRematch} />}
      {!ready ? <div className="panel empty"><Mark />{sessionFailed ? <button className="button primary" onClick={() => { setError(''); setSessionAttempt(value => value + 1); }}>{t.retry}</button> : <p role="status">{t.loading}</p>}</div> : !identified ? <Wallet network={paymentNetwork} lang={lang} user={user} name={name} onUser={walletUser} onboarding /> : <>
        {page === 'home' && <section className="game-catalog">
          <h1>{t.chooseGame}</h1>
          {topicPicker()}
          <details className="home-join"><summary>{t.joinByCode}</summary><form onSubmit={join}>
            <label className="field">{t.code}<input value={code} onChange={e => setCode(e.target.value.replace(/[^a-fA-F0-9]/g, '').toUpperCase().slice(0, 10))} placeholder={t.codePlaceholder} maxLength={10} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
            <button className="button secondary" disabled={busy || code.length !== 10}>{t.join}</button>
          </form></details>
          {history.filter(h => activeStatuses.includes(h.status)).map(h => <button className="resume-banner" key={h.code} onClick={() => openRoom(h.code)}>{t.resume}<strong>{t[h.topic]} · {h.code}</strong></button>)}
        </section>}
        {page === 'game' && <section className="game-launch panel">
          <button className="text-button launch-back" onClick={() => navigate('home')}>‹ {t.chooseGame}</button>
          <h1 tabIndex={-1}>{t[topic]}</h1>
          <p className="muted launch-description">{topic === 'chess' ? t.chessDesc : topic === 'math' ? t.mathDesc : topic === 'flags' ? t.flagsDesc : topic === 'capitals' ? t.capitalsDesc : topic === 'puzzles' ? t.puzzlesDesc : t.mixedDesc}</p>
          <div className="practice-controls">{difficultyPicker()}</div>
          {colorPicker()}
          <button className="button primary full launch-play" disabled={busy} onClick={() => create('practice')}>{busy ? t.loading : topic === 'chess' ? t.chessPractice : topic === 'puzzles' ? t.puzzlePlay : t.playSolo}</button>
          <p className="muted small solo-note">{t.soloAlwaysFree}</p>
          {topic !== 'puzzles' && <div className="game-mode-actions">
            {entryPicker()}
            <button className="button secondary full" disabled={busy || (stake > 0 && (!paymentsReady || !user?.wallet))} onClick={findOpponent}>{t.quickMatch}</button>
            {topic !== 'mixed' && <label className="ranked-toggle"><input type="checkbox" checked={ranked} onChange={e => setRanked(e.target.checked)} />{t.rankedMatch}</label>}
            <button className="button dark full" onClick={() => navigate('setup')}>{t.friends}</button>
          </div>}
          <details className="launch-rules"><summary>{t.rulesTitle}</summary><p className="difficulty-hint muted small">{difficultyHint()}</p>{rules()}</details>
        </section>}
        {page === 'search' && <section className="panel search-panel"><div className="round-symbol" aria-hidden="true">◎</div><h1>{search.status === 'searching' ? t.searching : t.searchExpired}</h1>
          {search.topic && <p><strong>{t[search.topic]}</strong>{search.topic !== 'chess' && ` · ${t[search.difficulty as 'easy' | 'normal' | 'hard']}`}</p>}
          <p className="search-entry">{search.stakeLuna ? `${t.entryPerPlayer}: ${search.stakeLuna / 100000} ${currency(search.paymentNetwork)}` : t.freeEntry}</p><p className="difficulty-badge">{search.ranked ? t.rankedMatch : t.casualMatch}</p><p className="muted">{t.searchWait}</p><p className="muted small">{t.searchNote}</p>{offline && <p role="status">{t.reconnecting}</p>}
          {search.status === 'searching' ? <button className="button secondary" disabled={busy} onClick={() => cancelSearch()}>{t.searchCancel}</button> : <button className="button primary" onClick={() => navigate('home')}>{t.back}</button>}
        </section>}
        {page === 'join' && <section className="panel setup-panel"><h1>{t.joinRoomTitle}</h1><p className="muted">{t.joinRoomNote}</p><p className="invite-code">{code}</p><form onSubmit={join}>{nameInput()}<button className="button primary full" disabled={busy || !name.trim() || code.length !== 10}>{busy ? t.loading : t.join}</button></form><button className="text-button" onClick={() => { window.history.replaceState(null, '', location.pathname); navigate('home'); }}>{t.back}</button></section>}
        {page === 'setup' && <section className="panel setup-panel"><button className="text-button" onClick={() => navigate('game')}>‹ {t.back}</button><h1>{inviteTarget ? t.inviteDuel : t.setup}</h1>{inviteTarget && <div className="invite-target"><strong>@{inviteTarget}</strong><p className="muted small">{t.inviteSetup}</p></div>}{nameInput()}{topicPicker()}<div className="setup-fields">{difficultyPicker()}{topic !== 'chess' && !inviteTarget && <Select label={t.players} value={String(capacity)} onChange={value => setCapacity(Number(value))} options={[2,3,4,5,6,7,8].map(n => ({ value: String(n), label: String(n) }))} />}</div>{entryPicker()}{rules()}<button className="button primary full" disabled={busy || !name.trim() || (stake > 0 && (!paymentsReady || !user?.wallet))} onClick={() => create('friends')}>{busy ? t.loading : inviteTarget ? t.sendInvitation : t.create}</button></section>}
        {page === 'leaderboard' && <Leaderboard lang={lang} user={user} play={() => { setRanked(true); if (topic === 'puzzles' || topic === 'mixed') setTopic('math'); navigate('game'); }} />}
        {page === 'people' && <People network={paymentNetwork} key={user?.id ?? "guest"} lang={lang} user={user} invitations={invitations} busy={busy} invite={prepareInvite} act={invitationAction} open={openRoom} wallet={() => navigate('wallet')} />}
        {page === 'profile' && <><section className="profile-identity panel"><strong>{user?.nickname ? '@' + user.nickname : t.nickname}</strong><button className="text-button" onClick={() => navigate(user?.nickname ? 'people' : 'wallet')}>{user?.nickname ? t.people : t.claimNickname}</button></section><button className="button secondary" onClick={() => navigate('leaderboard')}>{t.leaderboard}</button><Progress lang={lang} user={user} busy={busy} train={trainMistakes} play={() => navigate('home')} /></>}
        {page === 'wallet' && <Wallet network={paymentNetwork} lang={lang} user={user} name={name} onUser={walletUser} />}
        {page === 'history' && <section className="panel"><h1>{t.history}</h1>{history.length ? <div className="history-list">{history.map(h => <button key={h.code} className="history-row" disabled={busy} onClick={() => openRoom(h.code)}><span className={`history-icon ${h.topic}`}>{h.topic === 'math' ? '×' : h.topic === 'flags' ? '⚑' : h.topic === 'chess' || h.topic === 'puzzles' ? '♞' : h.topic === 'mixed' ? '◎' : '⌂'}</span><span className="history-detail"><strong>{t[h.topic]}</strong><span>{new Date(h.createdAt).toLocaleString(lang)} · {h.players} {t.players.toLowerCase()}</span></span><span className="history-score">{activeStatuses.includes(h.status) ? t.resume : h.status === 'completed' ? h.topic === 'puzzles' ? h.won ? t.puzzleSolved : t.puzzleSolution : h.topic === 'chess' ? h.score === 0.5 ? t.chessDraw : h.won ? t.won : t.chessLost : `${h.score} ${t.points.toLowerCase()}` : t.voidTitle}</span></button>)}</div> : <div className="empty"><span className="empty-symbol" aria-hidden="true">◷</span><h2>{t.noHistory}</h2><p className="muted">{t.noHistoryDesc}</p><button className="button primary" onClick={() => navigate('home')}>{t.play}</button></div>}</section>}
        {page === 'room' && room && <>
          <div className="room-heading"><span className={`topic-pill ${room.topic}`}>{t[room.topic]}</span>{!(room.topic === 'chess' && room.mode === 'friends') && <span className="difficulty-badge">{t[room.difficulty as keyof typeof t]}</span>}<span className="room-code">#{room.code}</span></div>
          {offline && <div className="connection-warning" role="status">{t.reconnecting}</div>}
          {room.training && <p className="training-note">{t.mistakes} · {room.questionCount} {t.question.toLowerCase()} · 90 s</p>}
          {room.invitedNickname && room.status === 'lobby' && <p className="invite-target">{t.invitationTo} <strong>@{room.invitedNickname}</strong> <button className="text-button" onClick={() => navigate('people')}>{t.invitations}</button></p>}
          {room.rematchOf && room.status === 'lobby' && <p className="muted">{t.rematchWaiting} · {timeLeft(room.lobbyDeadline, now)}</p>}
          {room.ranked && <p className="rating-result">{t.rankedMatch}{room.rating && (room.rating.status === 'rated' ? (() => { const r = room.rating.players.find(p => p.id === user?.id); return r ? ` · ${r.before} → ${r.after} (${r.delta > 0 ? '+' : ''}${r.delta})` : ''; })() : ` · ${room.rating.status === 'repeat_pair' ? t.ratingRepeat : t.ratingNoResult}`)}</p>}
          {room.stakeLuna > 0 && !['starting', 'playing'].includes(room.status) && <Payments key={room.code} room={room} lang={lang} />}
          {room.status === 'lobby' && <div className="room-grid"><section className="panel"><h1>{room.matchmaking ? t.searchFound : t.lobby}</h1>{room.matchmaking && <p className="muted">{t.ready} · {timeLeft(room.lobbyDeadline, now)}</p>}<p className="muted">{room.players.length} / {room.capacity} {t.players.toLowerCase()}</p>{playerList()}<button className="button primary full" disabled={busy || room.players.length !== room.capacity || room.players.find(p => p.id === user?.id)?.ready || (room.stakeLuna > 0 && !room.players.find(p => p.id === user?.id)?.funded)} onClick={() => action('ready', { rulesVersion: room.rulesVersion })}>{room.players.length !== room.capacity ? t.waitingPlayers : room.players.find(p => p.id === user?.id)?.ready ? t.waitingReady : t.ready}</button><p className="muted small">{t.readyNote}</p><button className="text-button" onClick={leave} disabled={busy}>{t.leave}</button></section><aside>{!room.matchmaking && !room.invitedNickname && !room.rematchOf && <section className="invite-panel"><h2>{t.invite}</h2><p className="invite-code">{room.code}</p><RoomQr code={room.code} lang={lang} /><input className="invite-link" aria-label={t.invite} value={`${location.origin}/?room=${room.code}`} readOnly onFocus={e => e.target.select()} /><button className="button secondary full" onClick={copyInvite}>{t.copy}</button>{copyMessage && <p role="status">{localizeText(copyMessage, lang)}</p>}</section>}{rules()}</aside></div>}
          {['starting', 'playing'].includes(room.status) && room.me.status === 'waiting' && <section className="panel start-panel"><div className="round-symbol" aria-hidden="true">▷</div><h1>{t.startTitle}</h1><p className="muted">{t.startWithin}</p><div className="large-timer">{timeLeft(room.startDeadline, now)}</div><button className="button primary full" onClick={() => action('start')} disabled={busy || offline || now >= (room.startDeadline ?? 0)}>{t.start}</button><p className="muted">{room.topic === 'chess' ? t.chessRule2 : t.rule2}</p>{playerList()}</section>}
          {playing && !['chess', 'puzzles'].includes(room.topic) && <section className="game-panel"><div className="game-status"><span>{t.question} <strong>{room.me.answered + 1} / {room.questionCount}</strong></span><span className={`timer ${(room.me.deadline ?? 0) - now < 15000 ? 'urgent' : ''}`} role="timer" aria-label={t.roundTime}>◷ {timeLeft(room.me.deadline, now)}</span></div><progress className="round-progress" max={room.roundMs} value={Math.max(0, (room.me.deadline ?? now) - now)} aria-label={t.roundTime} />
            <div className="question-stage" key={room.question?.id}>{room.question?.kind === 'math' ? <div className="expression">{room.question?.prompt}<span>= ?</span></div> : room.question?.kind === 'capitals' && room.question ? <div className="capital-question"><h2>{capitalPrompt(room.question, lang)}</h2><strong>{countryLabel('', lang, room.question.countryCode)}</strong></div> : <><h2>{t.identify}</h2>{room.question?.visual && <Flag visual={room.question.visual} label={t.flagAlt} />}</>}</div>
            {room.question?.kind === 'math' ? <div className="math-input"><input className="answer-display" aria-label={t.answer} value={answer} placeholder="?" readOnly inputMode="none" /><div className="keypad">{['1','2','3','4','5','6','7','8','9','⌫','0','✓'].map(key => <button key={key} className={key === '✓' ? 'key-submit' : ''} disabled={busy || offline || (key === '✓' && !answer)} aria-label={key === '⌫' ? (t.deleteDigit) : key === '✓' ? t.send : key} onClick={() => key === '✓' ? submit(answer) : key === '⌫' ? setAnswer(value => value.slice(0, -1)) : setAnswer(value => (value + key).slice(0, 7))}>{key}</button>)}</div></div> : <div className="flag-options">{room.question?.options?.map((option, i) => <button key={option.id} disabled={busy || offline} onClick={() => submit(option.id)}><span>{String.fromCharCode(65 + i)}</span>{room.question?.kind === 'capitals' ? capitalLabel(option.label, lang, option.capitalId) : countryLabel(option.label, lang, option.countryCode)}</button>)}</div>}
            <div className="game-actions"><button className="text-button" disabled={busy || offline} onClick={() => submit(null)}>{t.skip}</button><span>{room.mode === 'practice' && room.me.score !== null ? `${room.me.score} ${t.points.toLowerCase()}` : t.rule3}</span></div>
            <div className="feedback" role="status">{room.feedback && (room.feedback.correct ? <span className="correct">✓ {t.feedbackCorrect}</span> : <span>{room.feedback.skipped ? t.feedbackSkip : t.feedbackWrong} {room.feedback.kind === 'flags' ? countryLabel(room.feedback.answer, lang) : room.feedback.kind === 'capitals' ? capitalLabel(room.feedback.answer, lang) : room.feedback.answer}</span>)}</div>
            <button className="text-button finish-button" disabled={busy || offline} onClick={() => action('finish')}>{t.finish}</button>
          </section>}
          {!['chess', 'puzzles'].includes(room.topic) && ['starting', 'playing'].includes(room.status) && ['finished', 'forfeit'].includes(room.me.status) && <section className="panel waiting-panel"><div className="round-symbol" aria-hidden="true">{room.me.status === 'finished' ? '✓' : '◷'}</div><h1>{room.me.status === 'finished' ? t.waitingEnd : t.noShow}</h1><p className="muted">{room.me.status === 'finished' ? t.waitingEndDesc : t.noShowDesc}</p>{playerList()}</section>}
          {!['chess', 'puzzles'].includes(room.topic) && room.status === 'completed' && <div className="results-grid"><section className="panel result-panel"><div className="result-symbol" aria-hidden="true">{room.winners.includes(room.me.id) ? '✦' : '✓'}</div><h1>{room.mode === 'practice' ? t.practiceDone : room.winners.includes(room.me.id) ? room.winners.length > 1 ? t.tied : t.won : t.results}</h1>{room.reason === 'ALL_FORFEIT' && <p className="muted">{t.allForfeit}</p>}<div className="result-numbers"><div><strong>{room.me.status === 'forfeit' ? '—' : room.me.score}</strong><span>{room.me.status === 'forfeit' ? t.noShow : t.points}</span></div><div><strong>{room.me.answered}</strong><span>{t.answered}</span></div></div>{room.mode !== 'practice' && playerList(true)}<div className="result-actions">{!room.training && <button className="button primary full" disabled={busy} onClick={rematch}>{t.rematch}</button>}{room.review.some(item => !item.correct) && <button className="button secondary full" disabled={busy} onClick={() => trainMistakes(room.topic, room.difficulty)}>{t.mistakes}</button>}<button className="text-button" onClick={() => navigate('profile')}>{t.profile}</button><button className="text-button" onClick={() => navigate('home')}>{t.again}</button></div>{!room.training && <p className="muted small">{t.rematchNote}</p>}</section><section className="panel review-panel"><h2>{t.review}</h2>{room.review.length ? room.review.map((item, i) => <div className="review-item" key={item.questionId}><span className={`review-mark ${item.correct ? 'correct' : 'incorrect'}`}>{item.correct ? '✓' : item.skipped ? '−' : '×'}</span><div>{item.question.kind === 'math' ? <strong>{item.question.prompt}</strong> : item.question.kind === 'capitals' ? <strong>{countryLabel('', lang, item.question.countryCode)}<small className="review-capital-role">{capitalPrompt(item.question, lang)}</small></strong> : item.question.visual && <Flag visual={item.question.visual} label={`${t.question} ${i + 1}`} />}<p>{t.yourAnswer} {item.submitted === null ? t.skipped : item.question.kind === 'flags' ? countryLabel(item.submitted, lang) : item.question.kind === 'capitals' ? capitalLabel(item.submitted, lang) : item.submitted}</p>{!item.correct && <p className="correct-answer">{t.correctAnswer} {item.question.kind === 'flags' ? countryLabel(item.answer, lang) : item.question.kind === 'capitals' ? capitalLabel(item.answer, lang) : item.answer}</p>}</div></div>) : <p className="muted">{t.emptyReview}</p>}</section></div>}
          {room.topic === 'puzzles' && room.puzzle && ['playing', 'completed'].includes(room.status) && <PuzzleGame key={room.code} room={room} lang={lang} busy={busy} offline={offline} action={action} next={() => create('practice', 'puzzles', room.difficulty)} />}
          {room.topic === 'chess' && room.chess && (room.status === 'completed' || (['starting', 'playing'].includes(room.status) && room.me.status !== 'waiting')) && <ChessGame key={room.code} room={room} lang={lang} busy={busy} offline={offline} now={now} action={action} onAgain={rematch} />}
          {(room.status === 'void' || room.status === 'cancelled') && <section className="panel empty"><span className="empty-symbol" aria-hidden="true">↻</span><h1>{t.voidTitle}</h1><p className="muted">{room.rematchOf ? t.rematchClosed : room.invitedNickname ? t.invitationClosed : room.reason === 'CHESS_ENGINE_UNAVAILABLE' ? t.chessEngineUnavailable : room.reason === 'PUZZLE_EXPIRED' ? t.puzzleExpired : room.matchmaking ? t.searchCancelled : room.status === 'void' ? t.voidDesc : t.cancelledDesc}</p><button className="button primary" onClick={() => navigate('home')}>{t.again}</button></section>}
        </>}
      </>}
      {!playing && <footer className="app-footer"><button className="text-button" aria-haspopup="dialog" onClick={() => setAboutOpen(true)}>{t.about}</button></footer>}
    </main></div>
  </div>;
}
