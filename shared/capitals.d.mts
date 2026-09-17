export type CapitalRole = 'capital' | 'constitutional' | 'governmentSeat' | 'administrative' | 'legislative' | 'judicial' | 'royalLegislative' | 'governmentDistrict' | 'federalCity' | 'claimed' | 'declared' | 'official';
export const capitals: { id: string; countryCode: string; role: CapitalRole; names: Record<'en' | 'es' | 'fr' | 'de' | 'pt' | 'uk', string> }[];
export const countryCodes: string[];
