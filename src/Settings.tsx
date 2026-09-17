import { useEffect, useRef } from 'react';
import { LanguageFlag } from './LanguageFlag';
import { languages, messages } from './i18n';
import type { Language } from './types';

export function Settings({ lang, onLanguage, onClose }: {
  lang: Language; onLanguage: (language: Language) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = messages[lang];
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onClose={onClose}>
    <div className="settings-heading"><h1 id="settings-title">{t.language}</h1><button className="settings-close" onClick={() => dialog.current?.close()} aria-label={t.closeLanguage}>×</button></div>
    <p className="muted">{t.languageHelp}</p>
    <fieldset className="language-options" aria-label={t.language}>
      {(Object.entries(languages) as [Language, string][]).map(([code, name]) => <label key={code} className={`language-option ${lang === code ? 'selected' : ''}`}>
        <span className="language-option-name" lang={code}><LanguageFlag lang={code} />{name}</span><input type="radio" name="language" value={code} checked={lang === code} onChange={() => onLanguage(code)} />
      </label>)}
    </fieldset>
    <p className="muted small settings-saved" role="status">{t.languageSaved}</p>
  </dialog>;
}
