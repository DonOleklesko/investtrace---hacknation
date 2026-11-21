process.env.INVESTTRACE_DB = ':memory:';
process.env.INVESTTRACE_LLM = 'off';

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanRulesOnly, extractContacts, normalizePhone, mergeScans, ruleScan } from '../src/scanner.js';
import { pointsToScore, jaccard } from '../src/risk.js';
import { analyzeHtml, assertPublicUrl } from '../src/redirect.js';
import { levelFor, openDb, addEvidence } from '../src/db.js';
import { seed } from '../src/demo.js';
import * as api from '../src/api.js';

test('scanner wykrywa sygnały z dosłownymi cytatami', () => {
  const text = 'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo! Program polecany przez znanego prezentera. Tylko dziś!';
  const s = scanRulesOnly(text);
  assert.ok(s.profit_promises.length >= 1);
  assert.equal(s.urgency_pressure.length, 1);
  assert.equal(s.authority_abuse.length, 1);
  for (const f of s.red_flags) assert.ok(text.includes(f.quote), `cytat musi być dosłowny: ${f.quote}`);
});

test('neutralna reklama nie ma sygnałów', () => {
  const s = scanRulesOnly('Czym są fundusze ETF? Darmowy kurs dla początkujących.');
  assert.equal(s.red_flags.length, 0);
});

test('ekstrakcja i normalizacja kontaktów', () => {
  const c = extractContacts('Zadzwoń +48 000 000 101 lub napisz: Kontakt@Firma.test, WhatsApp');
  assert.deepEqual(c.find((x) => x.kind === 'phone'), { kind: 'phone', value: '+48000000101' });
  assert.equal(c.find((x) => x.kind === 'email').value, 'kontakt@firma.test');
  assert.ok(c.some((x) => x.kind === 'whatsapp'));
  assert.equal(normalizePhone('0048 000-000-101'), '+48000000101');
  assert.equal(normalizePhone('000 000 101'), '+48000000101');
});

test('wyniki LLM z cytatem spoza tekstu są odrzucane', () => {
  const text = 'Pewny zysk 25% miesięcznie.';
  const merged = mergeScans(text, ruleScan(text), {
    engine: 'llm:test', confidence: 0.9,
    profit_promises: [{ quote: 'zysk 25% miesięcznie', explanation: 'ok' }],
    urgency_pressure: [{ quote: 'tylko dziś', explanation: 'halucynacja' }],
    authority_abuse: [], fake_social_proof: [], crypto_or_forex_keywords: [], contact_data: [],
  });
  assert.equal(merged.urgency_pressure.length, 0);
  assert.ok(merged.profit_promises.some((p) => p.quote === 'zysk 25% miesięcznie'));
});

test('skala ryzyka: nasycenie i poziomy', () => {
  assert.equal(pointsToScore(0), 0);
  assert.equal(pointsToScore(-20), 0);
  assert.equal(pointsToScore(60), 63);
  assert.ok(pointsToScore(500) <= 100);
  assert.ok(pointsToScore(150) > pointsToScore(120));
  assert.equal(levelFor(80), 'Krytyczny'); assert.equal(levelFor(55), 'Wysoki'); assert.equal(levelFor(30), 'Średni'); assert.equal(levelFor(10), 'Niski');
});

test('podobieństwo Jaccarda', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1);
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0);
});

test('analiza HTML: trackery, formularze, meta refresh', () => {
  const html = `<title>Test</title><script>fbq('init','123456789012');gtag('config','G-ABC1234XY')</script>
    <form action="/lead"><input name="imie"><input name="telefon"></form>
    <meta http-equiv="refresh" content="0; url=/dalej">`;
  const a = analyzeHtml(html, 'https://a.test/x');
  assert.equal(a.title, 'Test');
  assert.ok(a.trackers.includes('FBPIXEL-123456789012'));
  assert.ok(a.trackers.includes('G-ABC1234XY'));
  assert.deepEqual(a.forms[0].fields, ['imie', 'telefon']);
  assert.equal(a.next, 'https://a.test/dalej');
  assert.equal(a.via, 'meta_refresh');
});

test('ochrona SSRF blokuje adresy lokalne', async () => {
  await assert.rejects(assertPublicUrl('http://127.0.0.1/'));
  await assert.rejects(assertPublicUrl('http://192.168.1.1/'));
  await assert.rejects(assertPublicUrl('file:///etc/passwd'));
  await assert.rejects(assertPublicUrl('http://localhost:3000/'));
});

test('pipeline na danych demo: kampanie, scenariusz, fałszywe alarmy, propagacja', () => {
  const ids = seed();
  const db = openDb();
  assert.ok(db.prepare('SELECT count(*) c FROM ads').get().c >= 30);
  assert.equal(api.campaigns().length, 3);
  const main = api.adDetail(ids.A[0]);
  assert.equal(main.level, 'Krytyczny');
  for (const code of ['PROFIT_PROMISE', 'AUTHORITY_ABUSE', 'URGENCY', 'YOUNG_DOMAIN', 'WARNING_LIST', 'SHARED_IDENTIFIER', 'USER_REPORTS'])
    assert.ok(main.signals.some((s) => s.code === code), `brak sygnału ${code}`);
  assert.equal(main.journey.steps.at(-1).domain, 'trade-pro-capital.test');
  for (const id of ids.legit) assert.equal(api.adDetail(id).level, 'Niski');
  const bridge = api.adDetail(ids.bridge);
  assert.ok(bridge.propagated > bridge.base_score, 'ryzyko powinno się propagować na powiązaną reklamę');
  assert.ok(bridge.signals.some((s) => s.code === 'PROPAGATED'));
});

test('dowody są niezmienne (append-only)', () => {
  const id = addEvidence({ kind: 'analyst_note', content: 'x' });
  assert.throws(() => openDb().prepare('UPDATE evidence SET content=? WHERE id=?').run('y', id));
  assert.throws(() => openDb().prepare('DELETE FROM evidence WHERE id=?').run(id));
});

test('zmiana statusu sprawy zapisuje akcję analityka', () => {
  const c = openDb().prepare('SELECT * FROM cases LIMIT 1').get();
  api.updateCase(c.id, { status: 'Potwierdzone ryzyko', notes: 'test' }, 'tester');
  const a = openDb().prepare('SELECT * FROM analyst_actions WHERE case_id=? ORDER BY id DESC').get(c.id);
  assert.equal(a.to_status, 'Potwierdzone ryzyko');
  assert.throws(() => api.updateCase(c.id, { status: 'Oszustwo' }));
});
