// Editorial difficulty groups, independent of translations and payment rules.
export const familiarCountries = 'UA PL DE FR IT ES PT GB IE NL BE CH AT SE NO FI DK GR TR US CA MX BR AR AU NZ JP CN IN KR EG MA ZA KE TH VN ID AE IL HU'.split(' ');
const regions = [
  'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA',
  'AF AM AZ BH BD BT BN KH CN GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TJ TH TL TM AE UZ VN YE',
  'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
  'AG BS BB BZ CA CR CU DM DO SV GD GT HT HN JM MX NI PA KN LC VC TT US',
  'AR BO BR CL CO EC GY PY PE SR UY VE',
  'AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU',
].map(group => group.split(' '));
const similarFlags = [
  'RO TD MD AD BE', 'ID MC PL SG', 'IE CI IT NG', 'NL LU RU SI SK HR RS',
  'FR IT IE BE RO', 'HU BG IR TJ', 'DE BE UG', 'AT LV LB', 'UA GA RW',
  'EE BW', 'LT MM BO GH', 'DK NO IS FI SE', 'CH DK GE TO', 'AU NZ FJ TV',
  'GB AU NZ FJ', 'US MY LR', 'CU PR CZ PS JO SD', 'JO PS AE KW',
  'EG IQ YE SY', 'SY LY SD', 'OM AE BY', 'BH QA', 'SA PK DZ MR',
  'TR TN DZ PK', 'JP BD PW', 'CN VN MA', 'KR KP MN', 'CH VN TO',
  'SN ML GN CM', 'GN BJ BF GH', 'NE IN IE', 'TD RO GN', 'GA SL GM',
  'KE SS ZW MZ', 'UG AO ZM', 'AO PG TL', 'ET GH CM', 'ZA NA SC',
  'TZ CD RW', 'SO FM IL', 'IL FI GR', 'AR UY SV HN NI', 'CO EC VE',
  'CR TH', 'PE CA AT', 'BR GY SR', 'CL CU CZ', 'HT LI', 'DO GE',
  'BS BB LC VC', 'AG KN GD DM', 'TT ID', 'PA WS', 'BS SB VU',
  'KI MH NR', 'KH LA', 'BN BT LK', 'NP TL', 'KZ UZ TM AZ',
  'AM TJ', 'AF IR', 'MD ME ES', 'ES PT AD', 'SM VA', 'LU PY',
  'GQ KM', 'GW ST', 'MG NG', 'BI ER', 'LS SZ', 'MU SC', 'CY MT',
].map(group => group.split(' '));
export function regionOf(code) { return regions.findIndex(group => group.includes(code)); }
export function flagSimilarity(a, b) {
  return similarFlags.some(group => group.includes(a) && group.includes(b)) ? 2 : regionOf(a) === regionOf(b) ? 1 : 0;
}
