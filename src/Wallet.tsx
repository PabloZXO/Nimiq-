import { currency, paymentMessages, type PaymentNetwork } from './payment-network';
import { useEffect, useRef, useState } from 'react';
import { init, type NimiqProvider } from '@nimiq/mini-app-sdk';
import { errorText, localizeText, messages } from './i18n';
import { api, ApiError } from './api';
import type { Language, User } from './types';
import { Nickname } from './Nickname';

export function Wallet({ network, lang, user, name, onUser, onboarding = false }: {
  network?: PaymentNetwork; lang: Language; user: User | null; name: string; onUser: (user: User | null) => void; onboarding?: boolean;
}) {
  const t = paymentMessages(lang, network);
  const provider = useRef<NimiqProvider | null>(null);
  const [state, setState] = useState<'checking' | 'available' | 'outside'>('checking');
  const [address, setAddress] = useState(user?.wallet?.address ?? '');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [consensus, setConsensus] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(false);
  useEffect(() => {
    let mounted = true;
    init({ timeout: 3000 }).then(p => {
      if (!mounted) return;
      provider.current = p; setState('available');
      return p.isConsensusEstablished().then(value => { if (mounted) setConsensus(value); });
    }).catch(() => { if (mounted && !provider.current) setState('outside'); });
    return () => { mounted = false; };
  }, []);
  async function connect() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const p = provider.current ?? await init({ timeout: 3000 });
      provider.current = p; setState('available');
      const accounts = await p.listAccounts();
      if (!Array.isArray(accounts) || !accounts.length || typeof accounts[0] !== 'string') throw new Error('No accounts');
      setAccounts(accounts); setAddress(accounts[0]);
    } catch { setError(t.walletRejected); }
    finally { operation.current = false; setBusy(false); }
  }
  async function verify() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try {
      const p = provider.current ?? await init({ timeout: 3000 });
      if (!user) {
        const session = await api<{ user: User }>('/session', { name: name.trim() || t.playerDefault });
        onUser(session.user);
      }
      const challenge = await api<{ id: string; origin: string; message: string }>('/wallet/challenge', { address, language: lang });
      if (challenge.origin !== location.origin) throw new Error('Unexpected origin');
      const proof = await p.sign({ message: challenge.message, isHex: false });
      if (!proof || 'error' in proof || typeof proof.publicKey !== 'string' || typeof proof.signature !== 'string') {
        setError(t.signatureCancelled); return;
      }
      const verified = await api<{ user: User }>('/wallet/verify', { challengeId: challenge.id, publicKey: proof.publicKey, signature: proof.signature });
      onUser(verified.user); setAddress(verified.user.wallet!.address); setAccounts([]);
    } catch (e) { setError(e instanceof ApiError ? errorText(e, lang) : t.signatureCancelled); }
    finally { operation.current = false; setBusy(false); }
  }
  async function logout() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await api('/logout', {}); onUser(null); setAddress(''); setAccounts([]); }
    catch (e) { setError(errorText(e, lang)); }
    finally { operation.current = false; setBusy(false); }
  }
  return <section className="panel wallet-panel">
    <div className="wallet-art" aria-hidden="true">N</div>
    <h1>{onboarding ? t.welcomeTitle : t.walletTitle}</h1><p className="muted">{onboarding ? t.welcomeDescription : t.walletDesc}</p>
    {onboarding && <ol className="onboarding-steps" aria-label={t.welcomeTitle}>
      <li className={user?.wallet ? 'complete' : 'current'} aria-current={!user?.wallet ? 'step' : undefined}><span>{user?.wallet ? '✓' : '1'}</span>{t.wallet}</li>
      <li className={user?.wallet ? 'current' : ''} aria-current={user?.wallet ? 'step' : undefined}><span>2</span>{t.nickname}</li>
    </ol>}
    <div className="notice">{state === 'checking' ? t.checking : state === 'outside' ? t.walletOutside : t.walletReady}</div>
    {consensus !== null && <p className="muted">{consensus ? t.consensus : t.syncing}</p>}
    {address && <div className="address"><strong>{user?.wallet ? '✓ ' + t.walletVerified : t.walletConnected}</strong><p>{user?.wallet?.address ?? address}</p></div>}
    {!user?.wallet && accounts.length > 1 && <label className="field">{t.chooseAddress}<select value={address} onChange={e => setAddress(e.target.value)} disabled={busy}>{accounts.map(account => <option key={account} value={account}>{account}</option>)}</select></label>}
    {error && <p className="error-text" role="alert">{localizeText(error, lang)}</p>}
    {user?.wallet && <Nickname user={user} lang={lang} onUser={onUser} />}
    {user?.wallet ? <><p className="muted">{t.walletProfile}</p><button className="button secondary" onClick={logout} disabled={busy}>{t.logout}</button></> : address ? <><p className="muted">{t.signatureExplain}</p><button className="button primary" onClick={verify} disabled={busy || state !== 'available'}>{busy ? t.loading : t.verifyWallet}</button><button className="text-button wallet-change" onClick={connect} disabled={busy}>{t.chooseAddress}</button></> : <button className="button primary" onClick={connect} disabled={busy || state === 'checking'}>{busy ? t.loading : t.connect}</button>}
    <p className="muted small">{t.paymentsLater}</p>
  </section>;
}
