import { currency, paymentMessages, type PaymentNetwork } from './payment-network';
import feeLocales from '../shared/fee-locales.json';
import { useEffect, useRef, useState } from 'react';
import { init } from '@nimiq/mini-app-sdk';
import { api, ApiError } from './api';
import { errorText, localizeText, messages } from './i18n';
import type { Language, Room } from './types';

type Intent = { network?: PaymentNetwork; feeContributionLuna?: number; id: string; sender: string; recipient: string; amountLuna: number; memo: string; expiresAt: number; fundedHash?: string | null };
type PaymentView = { intent: Intent | null; payouts: { kind: string; status: string; amountLuna: number; hash: string | null }[] };
export const nim = (luna: number, lang: Language) => (luna / 100_000).toLocaleString(lang, { maximumFractionDigits: 5 });

export function PaymentRules({ lang, network, fee = 0 }: { lang: Language; network?: PaymentNetwork; fee?: number }) {
  const t = paymentMessages(lang, network);
  return <p className="muted small">{t.paymentRules}{fee > 0 && <> {feeLocales[lang].rules}</>}</p>;
}

export function Payments({ room, lang }: { room: Room; lang: Language }) {
  const t = paymentMessages(lang, room.paymentNetwork);
  const fees = feeLocales[lang], fee = room.feeContributionLuna ?? 0;
  const [view, setView] = useState<PaymentView | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<'idle' | 'wallet' | 'submitted' | 'unknown'>('idle');
  const [error, setError] = useState('');
  const lock = useRef(false);
  const paid = room.players.find(p => p.id === room.me.id)?.funded || view?.intent?.fundedHash;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try { const value = await api<PaymentView>(`/rooms/${room.code}/payment`, undefined, controller.signal); if (alive) setView(value); }
      catch { /* Keep last known payment state during reconnect. */ }
      finally { if (alive) timer = setTimeout(poll, 4000); }
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [room.code]);
  async function prepare() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { const intent = await api<Intent>(`/rooms/${room.code}/payment`, { feeContributionLuna: fee }); setView(previous => ({ intent, payouts: previous?.payouts ?? [] })); }
    catch (e) { setError(errorText(e, lang)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function pay() {
    if (lock.current || !view?.intent || !checked || paid) return;
    lock.current = true; setBusy(true); setError('');
    let walletRequested = false;
    try {
      // Refresh the server-owned intent before opening the native payment approval.
      const intent = await api<Intent>(`/rooms/${room.code}/payment`, { feeContributionLuna: fee });
      if ((intent.network ?? 'testalbatross') !== (room.paymentNetwork ?? 'testalbatross')) throw new ApiError('PAYMENT_NETWORK_CHANGED');
      if ((intent.feeContributionLuna ?? 0) !== fee || intent.amountLuna !== room.stakeLuna + fee) throw new ApiError('PAYMENT_NETWORK_CHANGED');
      const provider = await init({ timeout: 3000 });
      walletRequested = true;
      setRequestState('wallet');
      const result = await provider.sendBasicTransactionWithData({ recipient: intent.recipient, value: intent.amountLuna, data: intent.memo });
      // Calling the bridge does not prove that a dialog opened or a payment was sent.
      if (typeof result === 'string' && /^[a-f0-9]{64}$/i.test(result)) setRequestState('submitted');
      else { setRequestState('unknown'); setError(t.paymentNotConfirmed); }
      // Neither this return value nor a browser-supplied hash credits a deposit.
    } catch (e) {
      if (walletRequested) setRequestState('unknown');
      setError(walletRequested ? t.paymentCheckHistory : e instanceof ApiError ? errorText(e, lang) : t.walletOutside);
    }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="panel payment-panel">
    <h2>{t.testPot} · {nim(room.stakeLuna * room.capacity, lang)} NIM</h2>
    <p>{t.yourEntry}: <strong>{nim(room.stakeLuna, lang)} {currency(room.paymentNetwork)}</strong></p>
    {fee > 0 && <><p>{fees.label}: <strong>{nim(fee, lang)} NIM</strong></p><p>{fees.total}: <strong>{nim(room.stakeLuna + fee, lang)} NIM</strong></p></>}
    {room.status === 'lobby' && <>
      <PaymentRules lang={lang} network={room.paymentNetwork} fee={fee} />
      {paid ? <p className="correct" role="status">✓ {t.entryConfirmed}</p> : <>
        {!view?.intent ? <button className="button secondary" onClick={prepare} disabled={busy || room.players.length !== room.capacity}>{t.prepareEntry}</button> : <>
          <div className="notice">{t.testnetInstructions}</div>
          <p className="payment-address">{t.paymentFrom}: {view.intent.sender}<br />{t.paymentTo}: {view.intent.recipient}</p>
          <label className="payment-check"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={busy} /><span>{t.acceptTestnet}</span></label>
          {requestState === 'idle' ? <button className="button primary" disabled={busy || !checked} onClick={pay}>{t.payTest}</button> : <>
            {requestState !== 'unknown' && <p role="status">{requestState === 'wallet' ? t.paymentWalletWaiting : t.paymentWaiting}</p>}
            {error && <p className="error-text" role="alert">{localizeText(error, lang)}</p>}
            {requestState !== 'wallet' && <button className="text-button" disabled={busy} onClick={() => { setRequestState('idle'); setChecked(false); setError(''); }}>{t.paymentRetry}</button>}
          </>}
        </>}
      </>}
      <p className="muted small">{t.leavePaid}</p>
    </>}
    {error && (requestState === 'idle' || paid || room.status !== 'lobby') && <p className="error-text" role="alert">{localizeText(error, lang)}</p>}
    {view?.payouts.map((p, index) => <div className="payment-receipt" key={p.hash ?? index}>
      <strong>{p.kind === 'refund' ? (t.refund) : (t.prize)}: {nim(p.amountLuna, lang)} {currency(room.paymentNetwork)}</strong>
      <p>{p.status === 'below_fee' ? fees.belowFee : p.status === 'confirmed' ? (t.payoutConfirmed) : p.status === 'review' ? (t.payoutReview) : (t.payoutPending)}</p>
      {p.hash && <small className="payment-address">{p.hash}</small>}
    </div>)}
    {room.status !== 'lobby' && !view?.payouts.length && <p className="muted">{t.payoutEmpty}</p>}
  </section>;
}
