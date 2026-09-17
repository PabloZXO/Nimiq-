import { currency, paymentMessages, type PaymentNetwork } from './payment-network';
import { useEffect, useRef } from 'react';
import { messages } from './i18n';
import type { Language } from './types';

export function About({ network, lang, onClose }: { network?: PaymentNetwork; lang: Language; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = paymentMessages(lang, network);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog about-dialog" aria-labelledby="about-title" onClose={onClose}>
    <div className="settings-heading"><h1 id="about-title">{t.about}</h1><button className="settings-close" onClick={() => dialog.current?.close()} aria-label={t.dismiss}>×</button></div>
    <p>{t.aboutGame}</p><h2>{t.aboutDataTitle}</h2><p>{t.aboutData}</p><p>{t.aboutPublic}</p><p>{t.aboutDevice}</p>
    <h2>{t.aboutWalletTitle}</h2><p>{t.aboutWallet}</p><p className="notice">{t.aboutTestnet}</p>
  </dialog>;
}
