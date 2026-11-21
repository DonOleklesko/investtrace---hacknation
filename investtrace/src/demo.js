// Generator danych demo. WSZYSTKIE dane są fikcyjne: domeny w zarezerwowanej strefie .test,
// numery w nieistniejącej puli +48 000 000 xxx, osoby i firmy wymyślone.
import { openDb, resetDb, sha256, upsertEntity, STATUSES } from './db.js';
import { createAd, applyScan, applyJourney, applyEnrichment, addUserReport } from './pipeline.js';
import { scanRulesOnly } from './scanner.js';
import { recomputeAll } from './risk.js';
import { fileURLToPath } from 'node:url';

const BASE = new Date('2026-11-21T09:00:00Z');
const daysAgo = (d, h = 0) => new Date(BASE - d * 86400000 - h * 3600000).toISOString();

const PIXEL_A = 'FBPIXEL-401928374655';
const PHONE_A = '+48000000101';
const PHONE_B = '+48000000202';
const PHONE_C = '+48000000303';

const DOMAINS = {
  'sk.test': { registered_at: '2019-04-02', whois_hidden: false, hosting: 'CDN (skracacz linków)' },
  'zysk-dzis24.test': { registered_at: daysAgo(18), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (SC)' },
  'wiadomosci-finanse24.test': { registered_at: daysAgo(15), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (SC)' },
  'portal-inwestora.test': { registered_at: daysAgo(40), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (SC)' },
  'rejestracja-zysk.test': { registered_at: daysAgo(17), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (SC)' },
  'trade-pro-capital.test': { registered_at: daysAgo(210), whois_hidden: true, offshore: true, hosting: 'Bulletproof hosting (VC)' },
  'tpc-invest.test': { registered_at: daysAgo(6), whois_hidden: true, offshore: true, hosting: 'Bulletproof hosting (VC)' },
  'przepisy-kuchnia.test': { registered_at: daysAgo(16), whois_hidden: true, hosting: 'Offshore VPS (SC)' },
  'aibot-profit.test': { registered_at: daysAgo(12), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (PA)' },
  'crypto-news-daily.test': { registered_at: daysAgo(25), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (PA)' },
  'quantum-bit-trade.test': { registered_at: daysAgo(95), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (PA)' },
  'inwestycje-energia-gov.test': { registered_at: daysAgo(20), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (BZ)' },
  'green-energy-fund.test': { registered_at: daysAgo(22), whois_hidden: true, offshore: true, hosting: 'Offshore VPS (BZ)' },
  'nordia-invest.test': { registered_at: '2011-06-15', whois_hidden: false, hosting: 'Polska serwerownia (PL)' },
  'bank-przykladowy.test': { registered_at: '2004-02-10', whois_hidden: false, hosting: 'Polska serwerownia (PL)' },
  'akademia-etf.test': { registered_at: '2018-09-01', whois_hidden: false, hosting: 'Polska serwerownia (PL)' },
};

const ACC = {
  fnl: { platform: 'facebook', account_id: '100090001', name: 'Finanse Na Luzie' },
  imp: { platform: 'facebook', account_id: '100090002', name: 'Inwestuj Mądrze PL' },
  sk: { platform: 'instagram', account_id: 'szybki.kapital', name: 'Szybki Kapitał' },
  marek: { platform: 'instagram', account_id: 'marek.trader.life', name: '@marek.trader.life (fikcyjny influencer)', is_influencer: true },
  wd: { platform: 'facebook', account_id: '100090005', name: 'Wiadomości Dnia 24' },
  cab: { platform: 'tiktok', account_id: 'crypto.ai.bot', name: 'CryptoAI Bot Official' },
  kk: { platform: 'youtube', account_id: 'KryptoKrolowa', name: 'KryptoKrólowa (fikcyjna influencerka)', is_influencer: true },
  bt: { platform: 'facebook', account_id: '100090008', name: 'Bitcoin Trader PL' },
  ee: { platform: 'facebook', account_id: '100090009', name: 'Energia dla Emerytów' },
  oze: { platform: 'google', account_id: 'AR-77310', name: 'OZE Inwestycje' },
  nordia: { platform: 'facebook', account_id: '100090011', name: 'Nordia Invest DM (fikcyjny licencjonowany broker)' },
  bank: { platform: 'google', account_id: 'AR-11002', name: 'Bank Przykładowy (fikcyjny bank)' },
  etf: { platform: 'youtube', account_id: 'AkademiaETF', name: 'Akademia ETF' },
  porady: { platform: 'facebook', account_id: '100090014', name: 'Porady Finansowe 24h' },
};

// ——— Ścieżki (Investor Journey) ———
const step = (url, kind, title, extra = {}) => ({ url, kind, title, http_status: 200, html_sha256: sha256(url + title), ...extra });
const journeyA = (landing, final = 'trade-pro-capital.test', { cloak = false, short = true } = {}) => ({
  source: 'demo',
  cloaking: cloak,
  cloaking_note: cloak ? 'Bot (facebookexternalhit) trafia na przepisy-kuchnia.test, przeglądarka mobilna na ' + landing : null,
  steps: [
    ...(short ? [{ url: 'https://sk.test/a8F3k', via: 'start', http_status: 302, kind: 'shortener', title: null }] : []),
    step(`https://${landing}/artykul/znany-prezenter-zdradza-sekret`, 'news_fake', 'Znany prezenter zdradza, jak zarabia 1000 zł tygodniowo', { via: short ? 'http_302' : 'start', trackers: [PIXEL_A] }),
    step('https://rejestracja-zysk.test/form', 'form', 'Zarejestruj się – ostatnie miejsca!', { via: 'js', forms: [{ action: '/lead', fields: ['imie', 'telefon', 'email'] }], trackers: [PIXEL_A] }),
    step(`https://${final}/pl/start`, 'platform', 'Trade Pro Capital – Twoja platforma inwestycyjna', { via: 'form_submit', contacts: [{ kind: 'phone', value: PHONE_A }, { kind: 'email', value: `support@${final}` }], company: 'Trade Pro Capital Ltd. (fikcyjna)' }),
  ],
});
const journeyB = () => ({
  source: 'demo', cloaking: false,
  steps: [
    step('https://crypto-news-daily.test/bot-ai-zarabia', 'news_fake', 'Bot AI zarabia za Ciebie – recenzja', { via: 'start', trackers: ['GTM-K7Q2ZP9'] }),
    step('https://aibot-profit.test/register', 'form', 'Aktywuj swojego bota AI', { via: 'meta_refresh', forms: [{ action: '/api/lead', fields: ['name', 'phone', 'country'] }], trackers: ['GTM-K7Q2ZP9'] }),
    step('https://quantum-bit-trade.test/dashboard', 'platform', 'QuantumBit Trade', { via: 'form_submit', contacts: [{ kind: 'phone', value: PHONE_B }], company: 'QuantumBit Trade LLC (fikcyjna)' }),
  ],
});
const journeyC = () => ({
  source: 'demo', cloaking: false,
  steps: [
    step('https://inwestycje-energia-gov.test/program', 'landing', 'Rządowy program inwestycji w energię – zapisy', { via: 'start', trackers: ['G-ENRG55X1Q'], forms: [{ action: '/zapis', fields: ['imie', 'nazwisko', 'telefon'] }] }),
    step('https://green-energy-fund.test/konto', 'platform', 'Green Energy Fund – panel inwestora', { via: 'form_submit', contacts: [{ kind: 'phone', value: PHONE_C }, { kind: 'email', value: 'kontakt@green-energy-fund.test' }], company: 'Green Energy Fund S.A. (fikcyjna)' }),
  ],
});
const journeyLegit = (domain, title, company) => ({ source: 'demo', cloaking: false, steps: [step(`https://${domain}/`, 'platform', title, { via: 'start', company })] });

// ——— Reklamy ———
const A_TEXTS = [
  'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo! Program polecany przez znanego prezentera Adama Wzorcowego. Tylko dziś ostatnie miejsca!',
  'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo! Program polecany przez Adama Wzorcowego. Nie czekaj, zostało tylko 12 miejsc.',
  'Adam Wzorcowy w wywiadzie: „Ten sposób dał mi pasywny dochód 4000 zł miesięcznie”. Już 12 000 Polaków zarabia. Zarejestruj się!',
  'Gwarantowany zysk bez ryzyka! Wpłać 500 zł, odbierz 1000 zł tygodniowo. Oferta wygasa do północy.',
  'Polacy pokochali nową platformę: zarabiaj 300 zł dziennie bez wychodzenia z domu. Tysiące zadowolonych inwestorów. Kontakt: +48 000 000 101',
  'Ostatnia szansa! Pomnożysz kapitał nawet x10. Polecane przez Adama Wzorcowego. Zadzwoń: +48 000 000 101',
  'Hej, tu Marek 👋 Od pół roku zarabiam 1000 zł tygodniowo z tą platformą. Link w bio, tylko dziś bonus 100%!',
  'Mój sposób na pasywny dochód: 500 zł wpłaty i 1000 zł tygodniowo. Bez ryzyka, sprawdźcie zanim zamkną zapisy!',
  'PILNE: Adam Wzorcowy ujawnia sekret zarobków. Zarabiaj nawet 1000 zł tygodniowo. Tylko dziś!',
  'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo – program polecany przez znanego prezentera. Ostatnie miejsca!',
  'Nowa platforma inwestycyjna dla Polaków. Pewny zysk 25% miesięcznie. Napisz na WhatsApp, zostało tylko 5 miejsc.',
  'Gwarantowany zysk 1000 zł tygodniowo. Już 8 000 osób dołączyło. Zarejestruj się dzisiaj.',
  'Szokujące wyznanie prezentera w telewizji: zarabia 1000 zł tygodniowo od 500 zł. Nie czekaj!',
  'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo! Rejestracja tylko dziś.',
];
const A_ACC = ['fnl', 'fnl', 'wd', 'imp', 'imp', 'sk', 'marek', 'marek', 'wd', 'fnl', 'sk', 'imp', 'wd', 'sk'];
const A_LANDING = ['zysk-dzis24.test', 'zysk-dzis24.test', 'wiadomosci-finanse24.test', 'zysk-dzis24.test', 'portal-inwestora.test', 'portal-inwestora.test',
  'zysk-dzis24.test', 'zysk-dzis24.test', 'wiadomosci-finanse24.test', 'zysk-dzis24.test', 'portal-inwestora.test', 'wiadomosci-finanse24.test', 'zysk-dzis24.test', 'zysk-dzis24.test'];

const B_TEXTS = [
  'Bot AI do inwestowania w kryptowaluty zarabia za Ciebie nawet 2000 zł dziennie. Automatyczny trading 24/7. Dołącz na Telegram!',
  'Sztuczna inteligencja handluje Bitcoinem za Ciebie. Zysk 30% tygodniowo, bez ryzyka. Ostatnie miejsca w wersji beta.',
  'Mój bot AI zarobił 15 000 zł w miesiąc 😱 Link w opisie, kod tylko dziś aktywny.',
  'Kryptowaluty z algorytmem AI: wpłać 250 €, wypłacaj 500 € tygodniowo. Tysiące zadowolonych inwestorów.',
  'Automatyczny trading Bitcoin – gwarantowany zysk. Napisz na Telegram: @quantum_support',
  'KryptoKrólowa testuje bota AI: 1500 zł dziennie bez wiedzy o rynku! Ostatnia szansa na zapis.',
  'Bitcoin trader z sztuczną inteligencją – zarabiaj 2000 zł dziennie. Kontakt: +48 000 000 202',
  'Bot AI do inwestowania w kryptowaluty zarabia za Ciebie nawet 2000 zł dziennie. Dołącz dziś.',
];
const B_ACC = ['cab', 'cab', 'kk', 'bt', 'bt', 'kk', 'bt', 'cab'];

const C_TEXTS = [
  'Rządowy program inwestycji w energię odnawialną: zainwestuj 1000 zł i otrzymuj 3000 zł miesięcznie. Zapisy tylko do piątku!',
  'Program rządowy dla seniorów: zysk z farm fotowoltaicznych 3000 zł miesięcznie. Gwarantowane przez państwo.',
  'Ministerstwo uruchamia program dla Polaków – zarabiaj na energii nawet 500 zł dziennie. Ostatnie miejsca!',
  'Inwestuj w zieloną energię z gwarantowanym zyskiem 40% rocznie. Zadzwoń: +48 000 000 303',
  'Program rządowy: 1000 zł wpłaty, 3000 zł miesięcznie. Już 20 000 Polaków dołączyło.',
  'Energia dla każdego – rządowy program inwestycyjny. Nie czekaj, oferta wygasa jutro.',
];
const C_ACC = ['ee', 'ee', 'oze', 'oze', 'ee', 'oze'];

export function seed({ reset = true } = {}) {
  openDb();
  if (reset) resetDb();
  const db = openDb();

  db.prepare('INSERT INTO warning_list(name,domain,source,added_at) VALUES (?,?,?,?)').run('Trade Pro Capital Ltd.', 'trade-pro-capital.test', 'Lista ostrzeżeń publicznych KNF (DEMO)', daysAgo(60));
  db.prepare('INSERT INTO warning_list(name,domain,source,added_at) VALUES (?,?,?,?)').run('QuantumBit Trade', 'quantum-bit-trade.test', 'IOSCO I-SCAN (DEMO)', daysAgo(30));
  db.prepare('INSERT INTO licensed_entities(name,domain,regulator,license_no) VALUES (?,?,?,?)').run('Nordia Invest Dom Maklerski S.A. (fikcyjny)', 'nordia-invest.test', 'KNF (DEMO)', 'DM-0000-DEMO');
  db.prepare('INSERT INTO licensed_entities(name,domain,regulator,license_no) VALUES (?,?,?,?)').run('Bank Przykładowy S.A. (fikcyjny)', 'bank-przykladowy.test', 'KNF (DEMO)', 'BANK-0000-DEMO');

  const add = (accKey, text, journey, d, h = 0, target = journey?.steps[0]?.url) => {
    const acc = ACC[accKey];
    const ts = daysAgo(d, h);
    const id = createAd({ platform: acc.platform, advertiser: acc, text, target_url: target, source: 'demo', detected_at: ts });
    applyScan(id, scanRulesOnly(text), ts);
    if (journey) applyJourney(id, journey, ts);
    return id;
  };

  const ids = { A: [], B: [], C: [], legit: [] };
  A_TEXTS.forEach((t, i) => {
    const final = i >= 11 ? 'tpc-invest.test' : 'trade-pro-capital.test';
    ids.A.push(add(A_ACC[i], t, journeyA(A_LANDING[i], final, { cloak: i % 4 === 1, short: i % 3 !== 2 }), 9 - Math.floor(i / 2), i));
  });
  B_TEXTS.forEach((t, i) => ids.B.push(add(B_ACC[i], t, journeyB(), 12 - i, i)));
  C_TEXTS.forEach((t, i) => ids.C.push(add(C_ACC[i], t, journeyC(), 7 - i, i)));

  ids.legit.push(add('nordia', 'Inwestuj na rynkach globalnych z licencjonowanym domem maklerskim. CFD są złożonymi instrumentami i wiążą się z dużym ryzykiem szybkiej utraty środków. 74% rachunków inwestorów detalicznych traci pieniądze.', journeyLegit('nordia-invest.test', 'Nordia Invest DM', 'Nordia Invest Dom Maklerski S.A. (fikcyjny)'), 3));
  ids.legit.push(add('bank', 'Lokata 6% w skali roku na 3 miesiące dla nowych klientów. Szczegóły i regulamin na stronie banku.', journeyLegit('bank-przykladowy.test', 'Bank Przykładowy – lokaty', 'Bank Przykładowy S.A. (fikcyjny)'), 2));
  ids.legit.push(add('etf', 'Czym są fundusze ETF? Darmowy kurs dla początkujących – bez obietnic, sama wiedza o dywersyfikacji i ryzyku.', journeyLegit('akademia-etf.test', 'Akademia ETF – kurs', null), 4));
  ids.legit.push(add('nordia', 'Webinar: jak działa dźwignia finansowa i dlaczego większość inwestorów detalicznych na niej traci. Zapisy na stronie.', journeyLegit('nordia-invest.test', 'Nordia Invest DM – webinar', null), 1));
  // Reklama „neutralna” powiązana z siecią A wyłącznie numerem telefonu (demo propagacji ryzyka)
  ids.bridge = add('porady', 'Masz pytania o oszczędzanie? Nasi doradcy pomogą. Zadzwoń: +48 000 000 101', null, 0, 2, null);

  for (const [d, meta] of Object.entries(DOMAINS)) applyEnrichment(d, { source: 'demo-whois', ...meta }, daysAgo(0));

  addUserReport({ description: 'Dzwonił „doradca” z tego numeru, namawiał na wpłatę 5000 zł i instalację AnyDesk.', phone: PHONE_A, ts: daysAgo(5) });
  addUserReport({ description: 'Po rejestracji przez formularz dostaję codziennie telefony z tego numeru.', phone: PHONE_A, ts: daysAgo(4) });
  addUserReport({ description: 'Nie mogę wypłacić środków, platforma żąda „podatku” przed wypłatą.', phone: PHONE_A, url: 'https://trade-pro-capital.test/pl/start', ts: daysAgo(2) });
  addUserReport({ description: 'Bot AI pokazywał zyski, ale wypłata zablokowana.', url: 'https://quantum-bit-trade.test/dashboard', ts: daysAgo(3) });

  const snap = db.prepare('INSERT INTO snapshots(entity_id,captured_at,content_sha256,summary,change_type,before_value,after_value) VALUES (?,?,?,?,?,?,?)');
  const S = (e, d, summary, type, before = null, after = null) => snap.run(e, daysAgo(d), sha256(e + d + summary), summary, type, before, after);
  S('domain:zysk-dzis24.test', 9, 'Pierwszy zrzut strony', 'initial');
  S('domain:zysk-dzis24.test', 6, 'Zmiana nagłówka artykułu', 'content', 'Jak zarobić 500 zł dziennie', 'Znany prezenter zdradza, jak zarabia 1000 zł tygodniowo');
  S('domain:trade-pro-capital.test', 8, 'Zmiana numeru kontaktowego', 'phone', '+48000000099', PHONE_A);
  S('domain:rejestracja-zysk.test', 4, 'Formularz przekierowuje na nową domenę (lustro)', 'redirect', 'trade-pro-capital.test', 'tpc-invest.test');
  S('domain:tpc-invest.test', 4, 'Nowa domena pojawiła się w ścieżce (zarejestrowana 6 dni temu)', 'domain', null, 'tpc-invest.test');
  S('domain:green-energy-fund.test', 1, 'Strona przestała odpowiadać (HTTP 000)', 'offline', '200', 'brak odpowiedzi');
  S('domain:quantum-bit-trade.test', 3, 'Dodano żądanie „opłaty weryfikacyjnej” przed wypłatą', 'content', null, 'Opłata weryfikacyjna 15%');

  recomputeAll();

  const setCase = (adId, status, assignee, note) => {
    const c = db.prepare('SELECT * FROM cases WHERE ad_id=?').get(adId);
    db.prepare('UPDATE cases SET status=?, assignee=?, notes=?, updated_at=? WHERE id=?').run(status, assignee, note, daysAgo(0, 1), c.id);
    db.prepare('INSERT INTO analyst_actions(case_id,actor,action,from_status,to_status,note,created_at) VALUES (?,?,?,?,?,?,?)').run(c.id, assignee, 'status_change', c.status, status, note, daysAgo(0, 1));
  };
  setCase(ids.A[0], STATUSES[1], 'analityk.demo', 'Sprawdzam powiązania z tpc-invest.test.');
  setCase(ids.B[0], STATUSES[4], 'analityk.demo', 'Przekazano do CERT (demo).');
  setCase(ids.legit[1], STATUSES[3], 'analityk.demo', 'Licencjonowany bank, oprocentowanie realne – fałszywy alarm.');
  upsertEntity('company', 'Trade Pro Capital Ltd. (fikcyjna)', 'Trade Pro Capital Ltd. (fikcyjna)', { note: 'Spółka z listy ostrzeżeń (DEMO)' });

  return ids;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ids = seed({ reset: process.argv.includes('--reset') || true });
  const n = openDb().prepare('SELECT count(*) c FROM ads').get().c;
  console.log(`Załadowano dane demo: ${n} reklam. Scenariusz główny: reklama #${ids.A[0]}.`);
}
