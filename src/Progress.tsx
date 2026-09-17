import { useEffect, useState } from 'react';
import { api } from './api';
import { errorText, messages } from './i18n';
import { Select } from './Select';
import type { Language, Progress as ProgressData, Topic, User } from './types';

export function Progress({ lang, user, busy, train, play }: {
  lang: Language; user: User | null; busy: boolean;
  train: (topic: Topic, difficulty: string) => void; play: () => void;
}) {
  const t = messages[lang];
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [topic, setTopic] = useState('all');
  const [difficulty, setDifficulty] = useState('all');
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    if (user) void api<ProgressData>('/progress', undefined, controller.signal).then(setData)
      .catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [user?.id]);
  const groups = data?.groups.filter(g => (topic === 'all' || g.topic === topic) && (difficulty === 'all' || g.difficulty === difficulty)) ?? [];
  const level = (value: string) => value === 'human' ? t.humanLevel : t[value as keyof typeof t];
  return <div className="progress-page">
    <section className="panel"><h1>{t.profile}</h1><p className="muted">{t.progressDesc}</p>
      <p className="muted small">{t.progressIdentity}</p>
      {error ? <p role="alert">{errorText(error, lang)}</p> : user && !data ? <p role="status">{t.loading}</p> : <>
        <div className="progress-total"><strong>{data?.games ?? 0}</strong><span>{t.gamesPlayed}</span></div>
        {!data?.games ? <><p>{t.noProgress}</p><button className="button primary" onClick={play}>{t.play}</button></> : <>
          <div className="progress-filters"><Select label={t.topic} value={topic} onChange={setTopic} options={[{ value: 'all', label: t.allGames }, ...(['math', 'flags', 'capitals', 'mixed', 'chess', 'puzzles'] as Topic[]).map(value => ({ value, label: t[value] }))]} />
            <Select label={t.difficulty} value={difficulty} onChange={setDifficulty} options={[{ value: 'all', label: t.allLevels }, ...['beginner', 'easy', 'normal', 'hard', 'expert', 'master', 'human'].map(value => ({ value, label: level(value) }))]} /></div>
          <div className="progress-groups">{groups.length ? groups.map(g => {
            const count = g.correct + g.wrong + g.skipped;
            return <article className="progress-group" key={`${g.topic}/${g.difficulty}/${g.mode}`}>
              <h2>{t[g.topic]} <span>{level(g.difficulty)}</span></h2>
              <p className="muted small">{g.mode === 'mistakes' ? t.mistakes : g.mode === 'friends' ? t.friends : g.topic === 'chess' ? t.chessPractice : g.topic === 'puzzles' ? t.puzzlePlay : t.practice}</p>
              <dl><div><dt>{t.gamesPlayed}</dt><dd>{g.games}</dd></div>
                {(g.mode === 'friends' || g.topic === 'chess') && <><div><dt>{t.statWins}</dt><dd>{g.wins}</dd></div><div><dt>{t.statDraws}</dt><dd>{g.draws}</dd></div><div><dt>{t.statLosses}</dt><dd>{g.losses}</dd></div></>}
                {g.topic !== 'chess' && <><div><dt>{g.topic === 'puzzles' ? t.puzzleAccuracy : t.accuracy}</dt><dd>{count ? `${Math.round(g.correct / count * 100)}%` : '—'}</dd></div>{g.topic !== 'puzzles' && <div><dt>{t.bestScore}</dt><dd>{g.bestScore ?? '—'}</dd></div>}</>}
              </dl>
            </article>;
          }) : <p className="muted">{t.noStatsFilter}</p>}</div><p className="muted small">{t.accuracyNote}</p>
        </>}
      </>}
    </section>
    {(!user || data) && <section className="panel"><h2>{t.mistakes} <span className="difficulty-badge">{data?.mistakes ?? 0}</span></h2><p className="muted">{t.mistakesDesc}</p>
      {data?.mistakeGroups.length ? <div className="mistake-list">{data.mistakeGroups.map(g => <button className="mistake-row" disabled={busy} onClick={() => train(g.topic, g.difficulty)} key={`${g.topic}/${g.difficulty}`}>
        <span><strong>{t[g.topic]}</strong><small>{level(g.difficulty)}</small></span><span>{g.count} <span aria-hidden="true">▷</span></span>
      </button>)}</div> : <p>{t.noMistakes}</p>}
    </section>}
  </div>;
}
