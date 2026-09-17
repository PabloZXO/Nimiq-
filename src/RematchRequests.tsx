import { currency } from './payment-network';
import { messages } from './i18n';
import type { Language, RematchRequest } from './types';

export function RematchRequests({ requests, lang, busy, act }: {
  requests: RematchRequest[]; lang: Language; busy: boolean;
  act: (request: RematchRequest, accept: boolean) => void;
}) {
  const t = messages[lang];
  return <div className="rematch-requests">{requests.map(r => <section className="rematch-request" key={r.code}>
    <h2>{t.rematchOffer} <strong>{r.from}</strong></h2>
    <p>{t[r.topic]}{r.topic !== 'chess' && ` · ${t[r.difficulty as 'easy' | 'normal' | 'hard']}`} · {r.capacity} {t.players.toLowerCase()} · {r.stakeLuna ? `${r.stakeLuna / 100000} ${currency(r.paymentNetwork)}` : t.freeEntry}</p>
    <p className="muted small">{t.rematchAcceptNote} · {t.invitationUntil} {new Date(r.expiresAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}</p>
    <div className="invitation-actions"><button className="button primary" disabled={busy} onClick={() => act(r, true)}>{t.acceptRematch}</button><button className="button secondary" disabled={busy} onClick={() => act(r, false)}>{t.declineRematch}</button></div>
  </section>)}</div>;
}
