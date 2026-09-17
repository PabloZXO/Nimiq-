import type { Language } from './types';

const flags: Record<Language, string> = {
  "en": "/flags/42f04826dd7a76e4ecdc.svg",
  "es": "/flags/d672868d51fc5b4f2d76.svg",
  "fr": "/flags/09645c97a47436337d63.svg",
  "de": "/flags/595d7718f6a22e5ea9de.svg",
  "pt": "/flags/f60337f226fba6b695f5.svg",
  "uk": "/flags/542eaacd659923163edf.svg"
};

export function LanguageFlag({ lang }: { lang: Language }) {
  return <img className="language-flag" src={flags[lang]} alt="" width={28} height={20} draggable={false} />;
}
