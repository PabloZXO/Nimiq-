import { useEffect, useState } from 'react';
import { api } from './api';
import { messages, errorText } from './i18n';
import { Select } from './Select';
import type { Language, User } from './types';

type Standing = { nickname: string; rating: number; games: number; rank: number | null };
type Board = { players: Standing[]; me: Standing | null };
export function Leaderboard({ lang, user, play }: { lang: Language; user: User | null; play: () => void }) {
  const t = messages[lang], [category, setCategory] = useState('math');
  const [data, setData] = useState<Board | null>(null), [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError(null);
    void api<Board>(`/leaderboard?category=${category}`, undefined, controller.signal).then(setData)
      .catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [category, user?.id]);
  return <section className="panel leaderboard"><h1>{t.leaderboard}</h1><p className="muted">{t.ratingRules}</p>
    <Select label={t.topic} value={category} onChange={setCategory} options={['math', 'geography', 'chess'].map(value => ({ value, label: t[value as 'math' | 'geography' | 'chess'] }))} />
    {data?.me && <div className="my-rating"><span>@{data.me.nickname}<small>{t.yourRating}{data.me.rank ? ` · #${data.me.rank}` : ''}</small></span><strong>{data.me.rating}</strong></div>}
    {error ? <p role="alert">{errorText(error, lang)}</p> : !data ? <p role="status">{t.loading}</p> : data.players.length ?
      <table className="rating-table"><caption>{t.topPlayers}</caption><thead><tr><th scope="col">#</th><th scope="col">{t.nickname}</th><th scope="col">{t.rating}</th><th scope="col">{t.gamesPlayed}</th></tr></thead><tbody>{data.players.map(p =>
        <tr key={p.nickname} className={p.nickname === user?.nickname ? 'rating-own' : ''}><td>{p.rank}</td><th scope="row">@{p.nickname}</th><td>{p.rating}</td><td>{p.games}</td></tr>)}</tbody></table>
      : <p>{t.ratingEmpty}</p>}
    <p className="muted small">{t.ratingDetails}</p><button className="button primary" onClick={play}>{t.quickMatch}</button>
  </section>;
}
