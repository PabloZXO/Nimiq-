import { useState, type FormEvent } from 'react';
import { api } from './api';
import { errorText, messages } from './i18n';
import type { Language, User } from './types';

export function Nickname({ user, lang, onUser }: { user: User; lang: Language; onUser: (user: User) => void }) {
  const t = messages[lang]; const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  async function claim(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    try { onUser((await api<{ user: User }>('/nickname', { nickname: value })).user); }
    catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <section className="nickname-section"><h2>{t.nickname}</h2>
    {user.nickname ? <><p className="nickname-value">@{user.nickname} <span className="identity-badge" aria-label={t.registeredNickname}>✓</span></p><p className="muted small">{t.nicknameSaved}</p></>
      : <form onSubmit={claim}><p className="muted">{t.nicknameIntro}</p><label className="field">{t.nickname}<input value={value} onChange={e => setValue(e.target.value)} placeholder="your_name" maxLength={21} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" disabled={busy} /></label><p className="muted small">{t.nicknameRules}</p><button className="button primary" disabled={busy || !value.trim()}>{busy ? t.loading : t.claimNickname}</button></form>}
    {Boolean(error) && <p role="alert" className="error-text">{errorText(error, lang)}</p>}
  </section>;
}
