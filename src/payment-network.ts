import mainnet from '../shared/mainnet-locales.json';
import { messages } from './i18n';
import type { Language } from './types';

export type PaymentNetwork = 'testalbatross' | 'mainalbatross';
export const currency = (network?: string) => network === 'mainalbatross' ? 'NIM' : 'Test NIM';
export const paymentMessages = (lang: Language, network?: string) => network === 'mainalbatross'
  ? { ...messages[lang], ...mainnet[lang] } : messages[lang];
