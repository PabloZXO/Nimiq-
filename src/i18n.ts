import { capitals, countryCodes } from '../shared/capitals.mjs';
import locales from '../shared/locales.json' with { type: 'json' };
import languageNames from '../shared/languages.json' with { type: 'json' };
import type { Language, Question } from './types';

export const languages = languageNames;
export const messages: Record<Language, typeof locales.en> = locales;
export function resolveLanguage(saved?: string | null, host?: string | null, browser?: string | null): Language {
  for (const value of [saved, host, browser]) {
    const code = value?.toLowerCase().split(/[-_]/)[0];
    if (code && Object.hasOwn(languages, code)) return code as Language;
  }
  return 'en';
}
export function errorText(error: unknown, lang: Language) {
  const key = `error_${error instanceof Error ? error.message : ''}`;
  return messages[lang][key as keyof typeof locales.en] ?? messages[lang].serverError;
}
const codes = countryCodes;
const names = new Map<Language, Intl.DisplayNames>();
const legacyCodes = new Map<string, string>();
for (const language of Object.keys(languages) as Language[]) {
  const display = new Intl.DisplayNames([language], { type: 'region' }); names.set(language, display);
  for (const code of codes) legacyCodes.set(display.of(code)!, code);
}
export function countryLabel(label: string, lang: Language, countryCode?: string) {
  const code = countryCode ?? legacyCodes.get(label);
  return code && codes.includes(code) ? names.get(lang)!.of(code) ?? label : label;
}

// Re-translate messages already on screen when the user changes language.
export function localizeText(text: string, lang: Language) {
  for (const locale of Object.values(messages)) {
    const key = Object.keys(locale).find(key => locale[key as keyof typeof locales.en] === text);
    if (key) return messages[lang][key as keyof typeof locales.en];
  }
  return text;
}

const capitalNames = new Map<string, typeof capitals[number]>();
for (const capital of capitals) {
  capitalNames.set(capital.id, capital);
  for (const name of Object.values(capital.names)) capitalNames.set(name, capital);
}
export function capitalLabel(label: string, lang: Language, capitalId?: string) {
  return capitalNames.get(capitalId ?? label)?.names[lang] ?? label;
}

export function capitalPrompt(question: Question, lang: Language) {
  return messages[lang][`capital_${question.capitalRole ?? 'capital'}`];
}
