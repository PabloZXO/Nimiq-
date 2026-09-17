// Curated city names: ISO country | English | Spanish | French | German | Portuguese | Ukrainian.
// A blank translation means the city uses the same spelling as English.
const rows = `
AF|Kabul|Kabul|Kaboul||Cabul|Кабул
AL|Tirana|||||Тирана
DZ|Algiers|Argel|Alger|Algier|Argel|Алжир
AD|Andorra la Vella|Andorra la Vieja|Andorre-la-Vieille|||Андорра-ла-Велья
AO|Luanda|||||Луанда
AG|Saint John's|||||Сент-Джонс
AR|Buenos Aires|||||Буенос-Айрес
AM|Yerevan|Ereván|Erevan|Jerewan|Erevã|Єреван
AU|Canberra||||Camberra|Канберра
AT|Vienna|Viena|Vienne|Wien|Viena|Відень
AZ|Baku|Bakú|Bakou||Baku|Баку
BS|Nassau|||||Нассау
BH|Manama|||||Манама
BD|Dhaka|Daca|Dacca||Daca|Дакка
BB|Bridgetown|||||Бриджтаун
BY|Minsk|||||Мінськ
BE|Brussels|Bruselas|Bruxelles|Brüssel|Bruxelas|Брюссель
BZ|Belmopan|Belmopán||||Бельмопан
BJ|Porto-Novo|||||Порто-Ново
BT|Thimphu|Timbu|Thimphou||Timbu|Тхімпху
BO|Sucre|||||Сукре
BA|Sarajevo|||||Сараєво
BW|Gaborone|||||Габороне
BR|Brasília|Brasilia|Brasilia|Brasília||Бразиліа
BN|Bandar Seri Begawan|||||Бандар-Сері-Бегаван
BG|Sofia|Sofía||||Софія
BF|Ouagadougou|Uagadugú|||Uagadugu|Уагадугу
BI|Gitega|||||Гітега
CV|Praia|||||Прая
KH|Phnom Penh|Nom Pen||||Пномпень
CM|Yaoundé|Yaundé||Jaunde|Yaoundé|Яунде
CA|Ottawa|||||Оттава
CF|Bangui|||||Бангі
TD|N'Djamena|Yamena|N'Djaména|N’Djamena|N'Djamena|Нджамена
CL|Santiago|||||Сантьяго
CN|Beijing|Pekín|Pékin|Peking|Pequim|Пекін
CO|Bogotá||Bogota|Bogotá||Богота
KM|Moroni|||||Мороні
CG|Brazzaville|||||Браззавіль
CD|Kinshasa|||||Кіншаса
CR|San José|||||Сан-Хосе
CI|Yamoussoukro|Yamusukro|||Yamoussoukro|Ямусукро
HR|Zagreb|||||Загреб
CU|Havana|La Habana|La Havane|Havanna|Havana|Гавана
CY|Nicosia||Nicosie|Nikosia|Nicósia|Нікосія
CZ|Prague|Praga||Prag|Praga|Прага
DK|Copenhagen|Copenhague|Copenhague|Kopenhagen|Copenhaga|Копенгаген
DJ|Djibouti|Yibuti|||Djibuti|Джибуті
DM|Roseau|||||Розо
DO|Santo Domingo||Saint-Domingue|||Санто-Домінго
EC|Quito|||||Кіто
EG|Cairo|El Cairo|Le Caire|Kairo|Cairo|Каїр
SV|San Salvador|||||Сан-Сальвадор
GQ|Ciudad de la Paz|||||Сьюдад-де-ла-Пас
ER|Asmara|Asmara|Asmara||Asmara|Асмера
EE|Tallinn|||||Таллінн
SZ|Mbabane|||||Мбабане
ET|Addis Ababa|Adís Abeba|Addis-Abeba|Addis Abeba|Adis Abeba|Аддис-Абеба
FJ|Suva|||||Сува
FI|Helsinki||||Helsínquia|Гельсінкі
FR|Paris|París||||Париж
GA|Libreville|||||Лібревіль
GM|Banjul|||||Банжул
GE|Tbilisi|Tiflis|Tbilissi|Tiflis|Tbilisi|Тбілісі
DE|Berlin|Berlín|||Berlim|Берлін
GH|Accra|Acra|||Acra|Аккра
GR|Athens|Atenas|Athènes|Athen|Atenas|Афіни
GD|Saint George's|||||Сент-Джорджес
GT|Guatemala City|Ciudad de Guatemala|Guatemala|Guatemala-Stadt|Cidade da Guatemala|Гватемала
GN|Conakry|Conakri|||Conacri|Конакрі
GW|Bissau|Bisáu||||Бісау
GY|Georgetown|||||Джорджтаун
HT|Port-au-Prince|Puerto Príncipe|||Porto Príncipe|Порт-о-Пренс
HN|Tegucigalpa|||||Тегусігальпа
HU|Budapest|Budapest|Budapest||Budapeste|Будапешт
IS|Reykjavík|Reikiavik|Reykjavik|Reykjavík|Reiquiavique|Рейк'явік
IN|New Delhi|Nueva Delhi|New Delhi|Neu-Delhi|Nova Deli|Нью-Делі
ID|Jakarta|Yakarta|Jakarta|Jakarta|Jacarta|Джакарта
IR|Tehran|Teherán|Téhéran|Teheran|Teerão|Тегеран
IQ|Baghdad|Bagdad|Bagdad|Bagdad|Bagdade|Багдад
IE|Dublin|Dublín|||Dublim|Дублін
IL|Jerusalem|Jerusalén|Jérusalem|Jerusalem|Jerusalém|Єрусалим
IT|Rome|Roma||Rom|Roma|Рим
JM|Kingston|||||Кінгстон
JP|Tokyo|Tokio|Tokyo|Tokio|Tóquio|Токіо
JO|Amman|Amán|||Amã|Амман
KZ|Astana|Astaná|||Astana|Астана
KE|Nairobi|Nairobi|Nairobi||Nairóbi|Найробі
KI|South Tarawa|Tarawa Sur|Tarawa-Sud|South Tarawa|Tarawa do Sul|Південна Тарава
KP|Pyongyang|||||Пхеньян
KR|Seoul|Seúl|Séoul|Seoul|Seul|Сеул
KW|Kuwait City|Ciudad de Kuwait|Koweït|Kuwait-Stadt|Cidade do Kuwait|Ель-Кувейт
KG|Bishkek|Biskek|Bichkek|Bischkek|Bisqueque|Бішкек
LA|Vientiane|Vientián||||В'єнтьян
LV|Riga|||||Рига
LB|Beirut|Beirut|Beyrouth||Beirute|Бейрут
LS|Maseru|||||Масеру
LR|Monrovia||||Monróvia|Монровія
LY|Tripoli|Trípoli|||Trípoli|Триполі
LI|Vaduz|||||Вадуц
LT|Vilnius|Vilna|||Vílnius|Вільнюс
LU|Luxembourg|Luxemburgo||Luxemburg|Luxemburgo|Люксембург
MG|Antananarivo|||||Антананаріву
MW|Lilongwe|||||Лілонгве
MY|Kuala Lumpur|||||Куала-Лумпур
MV|Malé|||||Мале
ML|Bamako|||||Бамако
MT|Valletta|La Valeta|La Valette|Valletta|Valeta|Валлетта
MH|Majuro|||||Маджуро
MR|Nouakchott|Nuakchot|||Nouakchott|Нуакшот
MU|Port Louis||Port-Louis||Port Louis|Порт-Луї
MX|Mexico City|Ciudad de México|Mexico|Mexiko-Stadt|Cidade do México|Мехіко
FM|Palikir|||||Палікір
MD|Chișinău|Chisináu|Chișinău|Chișinău|Quixinau|Кишинів
MC|Monaco|Mónaco|||Mónaco|Монако
MN|Ulaanbaatar|Ulán Bator|Oulan-Bator|Ulaanbaatar|Ulã Bator|Улан-Батор
ME|Podgorica|||||Подгориця
MA|Rabat|||||Рабат
MZ|Maputo|||||Мапуту
MM|Naypyidaw|Naipyidó|Naypyidaw|Naypyidaw|Naypyidaw|Нейп'їдо
NA|Windhoek|||||Віндгук
NR|Yaren|||||Ярен
NP|Kathmandu|Katmandú|Katmandou|Kathmandu|Catmandu|Катманду
NL|Amsterdam|Ámsterdam|||Amesterdão|Амстердам
NZ|Wellington|||||Веллінгтон
NI|Managua|||||Манагуа
NE|Niamey|||||Ніамей
NG|Abuja|Abuya|||Abuja|Абуджа
MK|Skopje|Skopie|||Escópia|Скоп'є
NO|Oslo|||||Осло
OM|Muscat|Mascate|Mascate|Maskat|Mascate|Маскат
PK|Islamabad||||Islamabade|Ісламабад
PW|Ngerulmud|||||Нгерулмуд
PS|East Jerusalem|Jerusalén Oriental|Jérusalem-Est|Ostjerusalem|Jerusalém Oriental|Східний Єрусалим
PA|Panama City|Ciudad de Panamá|Panama|Panama-Stadt|Cidade do Panamá|Панама
PG|Port Moresby|||||Порт-Морсбі
PY|Asunción||Asuncion|Asunción|Assunção|Асунсьйон
PE|Lima|||||Ліма
PH|Manila|Manila|Manille||Manila|Маніла
PL|Warsaw|Varsovia|Varsovie|Warschau|Varsóvia|Варшава
PT|Lisbon|Lisboa|Lisbonne|Lissabon|Lisboa|Лісабон
QA|Doha|||||Доха
RO|Bucharest|Bucarest|Bucarest|Bukarest|Bucareste|Бухарест
RU|Moscow|Moscú|Moscou|Moskau|Moscovo|Москва
RW|Kigali|||||Кігалі
KN|Basseterre|||||Бастер
LC|Castries|||||Кастрі
VC|Kingstown|||||Кінгстаун
WS|Apia|||||Апіа
SM|San Marino|San Marino|Saint-Marin||São Marinho|Сан-Марино
ST|São Tomé|Santo Tomé|São Tomé|||Сан-Томе
SA|Riyadh|Riad|Riyad|Riad|Riade|Ер-Ріяд
SN|Dakar|||||Дакар
RS|Belgrade|Belgrado||Belgrad|Belgrado|Белград
SC|Victoria||||Vitória|Вікторія
SL|Freetown|||||Фрітаун
SG|Singapore|Singapur|Singapour|Singapur|Singapura|Сінгапур
SK|Bratislava|||||Братислава
SI|Ljubljana|Liubliana|||Liubliana|Любляна
SB|Honiara|||||Хоніара
SO|Mogadishu|Mogadiscio|Mogadiscio|Mogadischu|Mogadíscio|Могадішо
ZA|Pretoria|Pretoria|Pretoria||Pretória|Преторія
SS|Juba|Yuba|Djouba|Juba|Juba|Джуба
ES|Madrid||||Madrid|Мадрид
LK|Sri Jayawardenepura Kotte|Sri Jayawardenepura Kotte|Sri Jayewardenepura Kotte|Sri Jayewardenepura Kotte|Sri Jayawardenepura Kotte|Шрі-Джаяварденепура-Котте
SD|Khartoum|Jartum|Khartoum|Khartum|Cartum|Хартум
SR|Paramaribo|||||Парамарибо
SE|Stockholm|Estocolmo|||Estocolmo|Стокгольм
CH|Bern|Berna|Berne|Bern|Berna|Берн
SY|Damascus|Damasco|Damas|Damaskus|Damasco|Дамаск
TJ|Dushanbe|Dusambé|Douchanbé|Duschanbe|Duchambé|Душанбе
TZ|Dodoma|||||Додома
TH|Bangkok||||Banguecoque|Бангкок
TL|Dili|Dili|Dili||Díli|Ділі
TG|Lomé|||||Ломе
TO|Nukuʻalofa|||||Нукуалофа
TT|Port of Spain|Puerto España|Port-d'Espagne|Port of Spain|Porto de Espanha|Порт-оф-Спейн
TN|Tunis|Túnez|||Tunes|Туніс
TR|Ankara|Ankara|Ankara||Ancara|Анкара
TM|Ashgabat|Asjabad|Achgabat|Aschgabat|Asgabate|Ашгабат
TV|Funafuti|||||Фунафуті
UG|Kampala||||Campala|Кампала
UA|Kyiv|Kyiv|Kyiv|Kyjiw|Kyiv|Київ
AE|Abu Dhabi|Abu Dabi|Abou Dabi|Abu Dhabi|Abu Dhabi|Абу-Дабі
GB|London|Londres|Londres|London|Londres|Лондон
US|Washington, D.C.|Washington D. C.|Washington|Washington, D.C.|Washington, D.C.|Вашингтон
UY|Montevideo|Montevideo|Montevideo||Montevideu|Монтевідео
UZ|Tashkent|Taskent|Tachkent|Taschkent|Tasquente|Ташкент
VU|Port Vila|Port Vila|Port-Vila||Port Vila|Порт-Віла
VA|Vatican City|Ciudad del Vaticano|Cité du Vatican|Vatikanstadt|Cidade do Vaticano|Ватикан
VE|Caracas|||||Каракас
VN|Hanoi|Hanói|Hanoï|Hanoi|Hanói|Ханой
YE|Sana'a|Saná|Sanaa|Sanaa|Sana|Сана
ZM|Lusaka||||Lusaca|Лусака
ZW|Harare|||||Хараре
BO-seat|La Paz|||||Ла-Пас
ZA-legislative|Cape Town|Ciudad del Cabo|Le Cap|Kapstadt|Cidade do Cabo|Кейптаун
ZA-judicial|Bloemfontein|||||Блумфонтейн
SZ-legislative|Lobamba|||||Лобамба
`;
const languages = ['en', 'es', 'fr', 'de', 'pt', 'uk'];
const roles = {
  BO: 'constitutional', 'BO-seat': 'governmentSeat', ZA: 'administrative',
  'ZA-legislative': 'legislative', 'ZA-judicial': 'judicial',
  SZ: 'administrative', 'SZ-legislative': 'royalLegislative',
  NR: 'governmentDistrict', CH: 'federalCity', PS: 'claimed', IL: 'declared',
  LK: 'legislative', ID: 'governmentSeat', NL: 'constitutional',
  BJ: 'official', CI: 'official', MY: 'official', YE: 'constitutional', SD: 'official',
};
const entries = rows.trim().split('\n').map(row => {
  const [id, ...values] = row.split('|');
  if (values.length !== 6) throw new Error(`Invalid capital translations: ${id}`);
  return { id, countryCode: id.slice(0, 2), role: roles[id] ?? 'capital',
    names: Object.fromEntries(languages.map((lang, i) => [lang, values[i] || values[0]])) };
});
export const capitals = entries.filter(c => c.countryCode !== 'ZA');
export const countryCodes = entries.filter(c => c.id.length === 2).map(c => c.countryCode);
