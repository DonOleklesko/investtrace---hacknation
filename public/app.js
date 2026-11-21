// InvestTrace – panel analityka
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');

// ——— Narzędzia ———
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' }) : '—');
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (iso) => {
  const d = (Date.now() - new Date(iso)) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min temu`;
  if (d < 86400) return `${Math.round(d / 3600)} godz. temu`;
  if (d < 86400 * 7) { const n = Math.round(d / 86400); return n === 1 ? 'wczoraj' : `${n} dni temu`; }
  return date(iso);
};
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

async function api(path, opts = {}) {
  const r = await fetch(`/api${path}`, { headers: { 'content-type': 'application/json', 'x-analyst': 'analityk.demo' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Błąd serwera (${r.status})`);
  return j;
}

const I = {
  alert: '<svg class="i" viewBox="0 0 24 24"><path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="9"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg class="i" viewBox="0 0 24 24"><path d="M12 11v6M12 7.5v.01"/></svg>',
  right: '<svg class="i" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  left: '<svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  file: '<svg class="i" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4v12M6 11l6 6 6-6M5 20h14"/></svg>',
  map: '<svg class="i" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="10" cy="18" r="2.5"/><path d="M8.3 7l7.4.6M7 8.2l2.3 7.6M16.6 10l-5 6.3"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = `toast${bad ? ' bad' : ''}`;
  t.innerHTML = `${bad ? I.alert : I.check}<span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3500);
}

function confirmDialog(title, text, okLabel = 'Tak, potwierdzam') {
  const d = $('#confirm');
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  $('#confirmOk').textContent = okLabel;
  d.returnValue = '';
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
}

// ——— Słownik: prosty język zamiast kodów ———
const LEVEL_TEXT = { Krytyczny: 'Ryzyko krytyczne', Wysoki: 'Ryzyko wysokie', 'Średni': 'Ryzyko średnie', Niski: 'Ryzyko niskie' };
const LEVEL_ADVICE = {
  Krytyczny: 'Sprawdź w pierwszej kolejności.',
  Wysoki: 'Wymaga sprawdzenia.',
  'Średni': 'Warto przejrzeć, gdy będzie czas.',
  Niski: 'Prawdopodobnie w porządku.',
};
const risk = (level, score) => `<span class="risk r-${esc(level || 'Niski')}" title="${esc(LEVEL_TEXT[level] || '')}"><b>${score ?? 0}</b>${esc(level || 'Niski')}</span>`;
const levelColor = (l) => ({ Niski: cssVar('--low'), 'Średni': cssVar('--mid'), Wysoki: cssVar('--high'), Krytyczny: cssVar('--crit') }[l] || cssVar('--muted'));

const TYPE = {
  ad: { label: 'Reklama', color: '#64748b', shape: 'sq' },
  account: { label: 'Konto reklamodawcy', color: '#6366f1' },
  influencer: { label: 'Influencer', color: '#a855f7' },
  domain: { label: 'Strona internetowa', color: '#0ea5e9', shape: 'dm' },
  phone: { label: 'Numer telefonu', color: '#14b8a6' },
  email: { label: 'Adres e-mail', color: '#06b6d4' },
  tracker: { label: 'Kod śledzący', color: '#f59e0b' },
  ip: { label: 'Serwer (IP)', color: '#94a3b8' },
  company: { label: 'Firma', color: '#a16207' },
  report: { label: 'Zgłoszenie / lista ostrzeżeń', color: '#ef4444' },
};
const REL = {
  PROMOTES: ['publikuje', 'publikowana przez'], LINKS_TO: ['prowadzi do', 'link z'], REDIRECTS_TO: ['przekierowuje do', 'przekierowanie z'],
  USES_PHONE: ['podaje numer', 'numer podany przez'], USES_EMAIL: ['podaje e-mail', 'e-mail podany przez'], USES_TRACKER: ['używa kodu', 'kod używany przez'],
  HOSTED_ON: ['działa na serwerze', 'serwer dla'], SIMILAR_TO: ['bardzo podobna do', 'bardzo podobna do'], OPERATED_BY: ['prowadzona przez', 'prowadzi'],
  MENTIONED_IN_WARNING_LIST: ['jest na liście', 'wymienia'], REPORTED_IN: ['dotyczy', 'zgłoszone w'],
};
const VIA = { start: 'pierwsza strona po kliknięciu', http_301: 'przekierowanie automatyczne (301)', http_302: 'przekierowanie automatyczne (302)', meta_refresh: 'automatyczne odświeżenie strony', js: 'przekierowanie skryptem', form_submit: 'po wysłaniu formularza' };
const KIND = { shortener: 'Skracacz linku', news_fake: 'Strona udająca artykuł', form: 'Formularz kontaktowy', landing: 'Strona reklamowa', platform: 'Platforma docelowa', other: 'Strona' };
const STATUS_TEXT = { Nowe: 'Nowe – nikt jeszcze nie sprawdzał', 'W analizie': 'W trakcie sprawdzania', 'Potwierdzone ryzyko': 'Ryzyko potwierdzone', 'Fałszywy alarm': 'Fałszywy alarm', Przekazane: 'Przekazane dalej' };
const DECISIONS = [
  { s: 'W analizie', t: 'Biorę do sprawdzenia', d: 'Inni zobaczą, że ktoś się tym zajmuje.' },
  { s: 'Potwierdzone ryzyko', t: 'Ryzyko potwierdzone', d: 'Dowody wskazują na nieuczciwą ofertę.', confirm: 'Oznaczyć jako potwierdzone ryzyko? Ta decyzja trafi do raportu z Twoim nazwiskiem.' },
  { s: 'Fałszywy alarm', t: 'Fałszywy alarm', d: 'Reklama jest w porządku. Zniknie z listy.', confirm: 'Oznaczyć jako fałszywy alarm? Reklama zniknie z listy „Do sprawdzenia”.' },
  { s: 'Przekazane', t: 'Przekaż dalej', d: 'Zgłoszone do KNF, CERT lub platformy reklamowej.', confirm: 'Oznaczyć jako przekazane do instytucji? Upewnij się, że raport został wysłany.' },
];

function adRow(a) {
  const meta = [a.advertiser || 'nieznane konto', a.platform, ago(a.detected_at)];
  return `<a class="row-item" href="#/ad/${a.id}">
    <span>${risk(a.level, a.score)}</span>
    <div style="min-width:0"><div class="t">${esc(a.text)}</div><div class="m">${meta.map(esc).join(' · ')}${a.status && a.status !== 'Nowe' ? ` · <span class="status">${esc(a.status)}</span>` : ''}</div></div>
    <span class="go small">Sprawdź ${I.right}</span></a>`;
}
const emptyState = (title, text) => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;

async function refreshCount() {
  try {
    const s = await api('/stats');
    const c = $('#navCount');
    c.hidden = !s.open_cases; c.textContent = s.open_cases;
  } catch { /* pomijamy */ }
}

// ——— START ———
async function vStart() {
  const [s, queue, camps, tl] = await Promise.all([api('/stats'), api('/queue'), api('/campaigns'), api('/timeline')]);
  const top = queue[0];
  const crit = queue.filter((a) => a.level === 'Krytyczny').length;
  view.innerHTML = `
  <section class="card hero">
    <div>
      <span class="eyebrow">Dzień dobry</span>
      <h1>${queue.length ? `${plural(queue.length, 'reklama czeka', 'reklamy czekają', 'reklam czeka')} na sprawdzenie` : 'Wszystko sprawdzone'}</h1>
      <p>${queue.length ? `W tym ${plural(crit, 'z ryzykiem krytycznym', 'z ryzykiem krytycznym', 'z ryzykiem krytycznym')}. Lista jest ułożona od najpilniejszych: zacznij od góry.` : 'Nie ma nowych reklam do przejrzenia. Możesz sprawdzić nową reklamę ręcznie.'}</p>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${top ? `<a class="btn btn-primary btn-lg" href="#/ad/${top.id}">Zacznij od najpilniejszej ${I.right}</a>` : ''}
      <a class="btn btn-lg" href="#/nowa">Sprawdź nową reklamę</a>
    </div>
  </section>

  <div class="grid cols-3 section" style="margin-top:16px">
    <a class="card stat" href="#/kolejka?f=Krytyczny"><div class="num" style="color:var(--crit)">${s.critical}</div><div class="lbl">reklam z ryzykiem krytycznym</div><div class="go">Pokaż listę →</div></a>
    <a class="card stat" href="#/kampanie"><div class="num">${s.campaigns}</div><div class="lbl">wykryte kampanie (grupy powiązanych reklam)</div><div class="go">Zobacz kampanie →</div></a>
    <a class="card stat" href="#/aktywnosc"><div class="num">${s.reports}</div><div class="lbl">zgłoszeń od osób poszkodowanych</div><div class="go">Zobacz zdarzenia →</div></a>
  </div>

  <section class="section">
    <div class="section-head"><h2>Najpilniejsze</h2><a href="#/kolejka">Wszystkie (${queue.length}) →</a></div>
    <div class="card"><div class="rows">${queue.slice(0, 5).map(adRow).join('') || emptyState('Pusto', 'Nic nie czeka na sprawdzenie.')}</div></div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Kampanie</h2><a href="#/kampanie">Wszystkie →</a></div>
    <div class="grid cols-3">${camps.slice(0, 3).map(campCard).join('')}</div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Ostatnie zdarzenia</h2><a href="#/aktywnosc">Cała historia →</a></div>
    <div class="card"><ul class="feed">${tl.slice(0, 5).map(feedItem).join('')}</ul></div>
  </section>`;
  bindFeed();
}

// ——— DO SPRAWDZENIA ———
async function vQueue(params) {
  const q = await api('/queue');
  const filters = [
    ['all', 'Wszystkie', () => true],
    ['Krytyczny', 'Krytyczne', (a) => a.level === 'Krytyczny'],
    ['Wysoki', 'Wysokie', (a) => a.level === 'Wysoki'],
    ['rest', 'Średnie i niskie', (a) => a.level === 'Średni' || a.level === 'Niski'],
    ['mine', 'W trakcie', (a) => a.status === 'W analizie'],
  ];
  let f = params.get('f') || 'all';
  const render = () => {
    const fn = (filters.find((x) => x[0] === f) || filters[0])[2];
    const list = q.filter(fn);
    $('#seg').innerHTML = filters.map(([k, l, fn2]) => `<button data-f="${k}" class="${k === f ? 'on' : ''}">${l}<span class="n">${q.filter(fn2).length}</span></button>`).join('');
    $('#list').innerHTML = list.map(adRow).join('') || emptyState('Brak reklam w tym widoku', 'Zmień filtr powyżej.');
    $$('#seg button').forEach((b) => b.addEventListener('click', () => { f = b.dataset.f; history.replaceState(null, '', `#/kolejka?f=${f}`); render(); }));
  };
  view.innerHTML = `
  <div class="page-head"><div><h1>Do sprawdzenia</h1><p>Reklamy, których nikt jeszcze nie zamknął. Najpilniejsze są na górze. Kliknij reklamę, aby zobaczyć, dlaczego dostała taki wynik.</p></div></div>
  <div class="seg" id="seg" role="tablist" aria-label="Filtr"></div>
  <div class="card" style="margin-top:14px"><div class="rows" id="list"></div></div>`;
  render();
}

// ——— REKLAMA ———
function highlight(text, scan) {
  let html = esc(text);
  const quotes = [...new Set((scan?.red_flags || []).map((f) => f.quote))].sort((a, b) => b.length - a.length);
  for (const q of quotes) { const e = esc(q); if (e && html.includes(e) && !html.includes(`>${e}</mark>`)) html = html.split(e).join(`<mark>${e}</mark>`); }
  return html;
}

function pathHtml(j) {
  if (!j) return `<div class="notice info">${I.info}<span>Nie znamy jeszcze ścieżki tej reklamy, bo nie podano linku. Ścieżka pojawi się, gdy dodasz reklamę z adresem strony.</span></div>`;
  const items = j.steps.map((s, i) => {
    const m = s.domain_meta || {};
    const last = i === j.steps.length - 1;
    const warns = [];
    if (m.warning_list) warns.push(['warn', `Na liście ostrzeżeń: ${m.warning_list}`]);
    if (m.registered_at && (new Date(j.created_at) - new Date(m.registered_at)) / 864e5 < 30) warns.push(['warn', `Strona założona niedawno (${date(m.registered_at)})`]);
    if (m.whois_hidden && m.offshore) warns.push(['warn', 'Właściciel ukryty, serwer za granicą']);
    if (s.forms.length && s.forms.some((f) => f.fields.some((x) => /tel|phone/i.test(x)))) warns.push(['warn', `Prosi o dane: ${s.forms.map((f) => f.fields.join(', ')).join(' | ')}`]);
    if (m.licensed) warns.push(['ok', `Ma licencję: ${m.licensed}`]);
    const ids = [...s.trackers.map((t) => ['tracker', t]), ...s.contacts.map((c) => [c.kind, c.value])];
    return `<li class="${last ? 'final' : ''}">
      <span class="dot">${i + 1}</span>
      <div class="kind">${esc(KIND[s.kind] || 'Strona')}${i ? ` · ${esc(VIA[s.via] || s.via)}` : ''}</div>
      <a href="#" class="dom" data-ent="domain:${esc(s.domain)}">${esc(s.domain)}</a>
      ${s.title ? `<div class="details">„${esc(s.title)}”</div>` : ''}
      ${warns.map(([k, t]) => `<div class="${k}">${k === 'ok' ? I.check : I.alert}<span>${esc(t)}</span></div>`).join('')}
      ${ids.length ? `<div>${ids.map(([k, v]) => `<a href="#" class="tag" data-ent="${esc(k)}:${esc(v)}" title="${esc(TYPE[k]?.label || k)}">${esc(v)}</a>`).join('')}</div>` : ''}
    </li>`;
  });
  return `${j.cloaking ? `<div class="notice bad">${I.alert}<span><b>Strona ukrywa się przed kontrolą.</b> Automat sprawdzający widzi inną stronę niż zwykły użytkownik (${esc(j.cloaking_note)}).</span></div>` : ''}
    <ol class="path">${items.join('')}</ol>`;
}

function signalsHtml(signals) {
  const pos = signals.filter((s) => s.weight > 0), neg = signals.filter((s) => s.weight < 0), prop = signals.filter((s) => s.code === 'PROPAGATED');
  const row = (s, cls, icon) => `<li><span class="ic ${cls}">${icon}</span><div><div class="lb">${esc(s.label)}</div><div class="dt">${esc(s.detail)}</div></div><span class="pt">${s.weight ? `${s.weight > 0 ? '+' : '−'}${Math.abs(s.weight)} pkt` : ''}</span></li>`;
  const all = [...pos.map((s) => row(s, '', I.alert)), ...neg.map((s) => row(s, 'good', I.check)), ...prop.map((s) => row(s, 'info', I.info))];
  return all.length ? `<ul class="signals">${all.join('')}</ul>` : '<p class="muted">Nie znaleźliśmy żadnych sygnałów ostrzegawczych.</p>';
}

function verdictText(a) {
  const pos = a.signals.filter((s) => s.weight > 0);
  const parts = [];
  if (!pos.length) parts.push('Nie znaleźliśmy sygnałów ostrzegawczych.');
  else parts.push(`Znaleźliśmy ${plural(pos.length, 'sygnał ostrzegawczy', 'sygnały ostrzegawcze', 'sygnałów ostrzegawczych')}. Najważniejsze: ${pos.slice(0, 2).map((s) => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join(' oraz ')}.`);
  if (a.signals.some((s) => s.code === 'LICENSED')) parts.push('Podmiot ma licencję regulatora, co obniża ryzyko.');
  if (a.propagated) parts.push(`Wynik podniesiony, bo reklama jest powiązana z reklamą #${a.propagated_from} o wysokim ryzyku.`);
  return parts.join(' ');
}

async function vAd(id) {
  const a = await api(`/ads/${id}`);
  let picked = null;
  const statusNow = a.case?.status || 'Nowe';
  view.innerHTML = `
  <a class="back" href="#/kolejka">${I.left} Wróć do listy</a>
  <div class="page-head" style="margin-bottom:20px"><div>
    <span class="eyebrow">Reklama #${a.id} · ${esc(a.platform)}</span>
    <h1>${esc(a.advertiser || 'Nieznane konto')}${a.is_influencer ? ' <span class="status">influencer</span>' : ''}</h1>
    <p>Wykryta ${dateTime(a.detected_at)}${a.campaign ? ` · należy do kampanii <a href="#/kampanie/${a.campaign_id}">${esc(a.campaign.replace('Kampania → ', ''))}</a>` : ''}</p>
  </div></div>

  <div class="ad-layout">
    <div class="stack">
      <section class="card step-card">
        <div class="step-title"><span class="step-num">1</span><div><h2>Co mówi reklama</h2><p>Podkreślone fragmenty to typowe chwyty nieuczciwych ofert.</p></div></div>
        <div class="quote">${highlight(a.text, a.scan)}</div>
      </section>

      <section class="card step-card">
        <div class="step-title"><span class="step-num">2</span><div><h2>Dokąd prowadzi</h2><p>Co zobaczy osoba, która kliknie reklamę, krok po kroku.</p></div></div>
        ${pathHtml(a.journey)}
      </section>

      <section class="card step-card">
        <div class="step-title"><span class="step-num">3</span><div><h2>Dlaczego taki wynik</h2><p>Każdy sygnał dodaje punkty. Sygnały na zielono obniżają ryzyko.</p></div></div>
        ${signalsHtml(a.signals)}
      </section>

      <details class="card more">
        <summary>Dowody i szczegóły techniczne</summary>
        <div class="inner">
          <dl class="kv">
            <dt>Suma punktów</dt><dd>${a.points} pkt → wynik ${a.base_score}/100 (im więcej punktów, tym wolniej rośnie wynik)</dd>
            ${a.propagated ? `<dt>Po powiązaniach</dt><dd>${a.propagated}/100 (z reklamy <a href="#/ad/${a.propagated_from}">#${a.propagated_from}</a>, osłabione o połowę na każdy krok)</dd>` : ''}
            <dt>Analiza treści</dt><dd>${esc(a.scan?.engine === 'rules' ? 'reguły (bez AI)' : a.scan?.engine || '—')}</dd>
            ${a.target_url ? `<dt>Link z reklamy</dt><dd class="mono">${esc(a.target_url)}</dd>` : ''}
          </dl>
          <h3 style="margin:20px 0 6px">Zapisane dowody (${a.evidence.length})</h3>
          <p class="muted small" style="margin-bottom:6px">Dowodów nie da się zmienić ani usunąć. Każdy ma odcisk SHA-256 do weryfikacji.</p>
          <ul class="log">${a.evidence.map((e) => `<li><b>#${e.id}</b> ${esc(e.reason || e.kind)} <span class="muted small">· ${dateTime(e.created_at)} · ${esc(e.source)}</span><div class="mono muted">${e.sha256}</div></li>`).join('')}</ul>
          <h3 style="margin:20px 0 6px">Historia decyzji</h3>
          <ul class="log">${a.actions.map((x) => `<li>${dateTime(x.created_at)} · <b>${esc(x.actor)}</b>: ${esc(x.from_status)} → ${esc(x.to_status)}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</li>`).join('') || '<li class="muted">Nikt jeszcze nie podjął decyzji.</li>'}</ul>
        </div>
      </details>
    </div>

    <aside class="aside-sticky stack">
      <section class="card verdict r-${esc(a.level)}">
        <span class="eyebrow">Ocena systemu</span>
        <div class="score"><b>${a.score}</b><span>/ 100</span></div>
        <div class="lvl">${esc(LEVEL_TEXT[a.level])}</div>
        <div class="meter"><i style="width:${a.score}%;background:${levelColor(a.level)}"></i></div>
        <p>${esc(verdictText(a))}</p>
        <p class="muted small">${esc(LEVEL_ADVICE[a.level])} To podpowiedź, nie wyrok: decyzja należy do Ciebie.</p>
      </section>

      <section class="card decide">
        <h2>Twoja decyzja</h2>
        <div class="current" style="margin-top:12px"><span class="muted">Obecny status</span><b>${esc(STATUS_TEXT[statusNow] || statusNow)}</b></div>
        <div class="choice" role="radiogroup" aria-label="Decyzja">
          ${DECISIONS.map((d) => `<button type="button" role="radio" aria-checked="false" data-s="${esc(d.s)}" class="${d.s === statusNow ? 'on' : ''}"><span class="rad"></span><b>${esc(d.t)}</b><small>${esc(d.d)}</small></button>`).join('')}
        </div>
        <div class="field" style="margin-bottom:12px"><label for="notes">Notatka <span class="opt">(opcjonalnie)</span></label><textarea id="notes" style="min-height:80px" placeholder="Np. sprawdziłem w rejestrze KNF…">${esc(a.case?.notes)}</textarea></div>
        <button class="btn btn-primary" id="save" style="width:100%" disabled>Wybierz decyzję powyżej</button>
        <div class="export">
          <a class="btn" href="/api/reports/${a.case_id}" target="_blank" rel="noopener">${I.file} Raport do druku / PDF</a>
          <a class="btn" href="/api/cases/${a.case_id}/evidence.json" target="_blank" rel="noopener" download="dowody-sprawa-${a.case_id}.json">${I.down} Pobierz paczkę dowodów</a>
          <a class="btn" href="#/mapa?center=ad:${a.id}">${I.map} Pokaż powiązania na mapie</a>
        </div>
      </section>
    </aside>
  </div>`;

  const save = $('#save');
  const notes = $('#notes');
  const original = notes.value;
  const sync = () => {
    const changedNote = notes.value !== original;
    if (picked && picked !== statusNow) { save.disabled = false; save.textContent = `Zapisz: ${DECISIONS.find((d) => d.s === picked).t}`; }
    else if (changedNote) { save.disabled = false; save.textContent = 'Zapisz notatkę'; }
    else { save.disabled = true; save.textContent = picked === statusNow ? 'To jest obecny status' : 'Wybierz decyzję powyżej'; }
  };
  $$('.choice button').forEach((b) => b.addEventListener('click', () => {
    picked = b.dataset.s;
    $$('.choice button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    sync();
  }));
  notes.addEventListener('input', sync);
  save.addEventListener('click', async () => {
    const d = DECISIONS.find((x) => x.s === picked);
    const changingStatus = picked && picked !== statusNow;
    if (changingStatus && d.confirm && !(await confirmDialog(d.t, d.confirm, 'Tak, zapisz'))) return;
    save.disabled = true; save.textContent = 'Zapisywanie…';
    try {
      await api(`/cases/${a.case_id}`, { method: 'PATCH', body: JSON.stringify({ ...(changingStatus ? { status: picked } : {}), notes: notes.value }) });
      toast(changingStatus ? `Zapisano: ${d.t}` : 'Zapisano notatkę');
      refreshCount();
      vAd(id);
    } catch (e) { toast(e.message, true); sync(); }
  });
  bindEntityLinks(view);
}

// ——— KAMPANIE ———
function campCard(c) {
  const lvl = c.max_score >= 75 ? 'Krytyczny' : c.max_score >= 50 ? 'Wysoki' : c.max_score >= 25 ? 'Średni' : 'Niski';
  return `<a class="card camp" href="#/kampanie/${c.id}">
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
      <div style="min-width:0"><span class="eyebrow">Prowadzi do</span><h3 style="overflow-wrap:anywhere">${esc(c.platforms.join(', ') || c.name)}</h3></div>${risk(lvl, c.max_score)}</div>
    <div class="nums"><div><b>${c.ads}</b><span>reklam</span></div><div><b>${c.accounts}</b><span>kont</span></div><div><b>${c.domains}</b><span>stron</span></div></div>
    <div class="foot">Aktywna od ${date(c.first_seen)} do ${date(c.last_seen)}</div></a>`;
}

async function vCampaigns(id) {
  if (id) {
    const c = await api(`/campaigns/${id}`);
    view.innerHTML = `<a class="back" href="#/kampanie">${I.left} Wszystkie kampanie</a>
      <div class="page-head"><div><span class="eyebrow">Kampania</span><h1>${esc(c.platforms.join(', ') || c.name)}</h1>
      <p>${plural(c.ads, 'reklama', 'reklamy', 'reklam')} z ${plural(c.accounts, 'konta', 'kont', 'kont')} prowadzi do tych samych miejsc. Łączą je wspólne strony, numery telefonów lub kody śledzące. Aktywna od ${date(c.first_seen)} do ${date(c.last_seen)}.</p></div>
      <a class="btn" href="#/mapa?campaign=${c.id}">${I.map} Pokaż na mapie</a></div>
      <div class="grid cols-3" style="margin-bottom:24px">
        <div class="card stat"><div class="num">${c.domains}</div><div class="lbl">stron internetowych</div></div>
        <div class="card stat"><div class="num">${c.phones}</div><div class="lbl">numerów telefonów</div></div>
        <div class="card stat"><div class="num">${c.trackers}</div><div class="lbl">kodów śledzących</div></div>
      </div>
      <h2 style="margin-bottom:12px">Reklamy w tej kampanii</h2>
      <div class="card"><div class="rows">${c.ads.map(adRow).join('')}</div></div>`;
    return;
  }
  const cs = await api('/campaigns');
  view.innerHTML = `<div class="page-head"><div><h1>Kampanie</h1><p>Kampania to grupa reklam, które wyglądają na niezależne, ale prowadzą do tych samych stron, podają ten sam numer telefonu lub mają ten sam kod śledzący.</p></div></div>
  <div class="grid cols-3">${cs.map(campCard).join('') || emptyState('Brak kampanii', 'Nie wykryto jeszcze powiązanych grup reklam.')}</div>`;
}

// ——— MAPA ———
let cy;
async function vMap(params) {
  const center = params.get('center');
  const camps = await api('/campaigns');
  let campaign = params.get('campaign') ?? (center ? '' : String(camps[0]?.id ?? ''));
  const hidden = new Set(['ip']);

  view.innerHTML = `
  <div class="page-head" style="margin-bottom:16px"><div><h1>Mapa powiązań</h1><p>Każda kropka to reklama, strona, numer telefonu albo konto. Linie pokazują, co jest z czym połączone. Kliknij kropkę, aby zobaczyć szczegóły.</p></div></div>
  <div class="map-bar">
    ${center ? `<div class="notice info" style="margin:0">${I.info}<span>Pokazuję otoczenie: <b class="mono">${esc(center)}</b>. <a href="#/mapa">Wróć do kampanii</a></span></div>`
    : `<div class="seg" id="campSeg">${camps.map((c) => `<button data-c="${c.id}">${esc(c.platforms[0] || c.name)}</button>`).join('')}<button data-c="">Cała sieć</button></div>`}
    <details class="filters"><summary>Co pokazywać?</summary><div class="filters-box">${Object.entries(TYPE).map(([k, t]) => `<label class="check"><input type="checkbox" data-type="${k}" ${hidden.has(k) ? '' : 'checked'}><span class="sw" style="background:${t.color}"></span>${t.label}</label>`).join('')}</div></details>
  </div>
  <div class="card map-shell">
    <div id="cy" role="img" aria-label="Mapa powiązań"></div>
    <div class="map-hint" id="mapHint">Kliknij kropkę, aby zobaczyć szczegóły · przeciągnij, aby przesunąć · kółko myszy przybliża</div>
    <div class="map-tools"><button class="btn" id="fit">Wyśrodkuj</button></div>
    <div class="map-legend">
      ${['ad', 'domain', 'phone', 'tracker', 'account', 'influencer', 'report'].map((k) => `<span><i class="sw ${TYPE[k].shape || ''}" style="background:${TYPE[k].color}"></i>${TYPE[k].label}</span>`).join('')}
      <span class="muted">Kolor obwódki = poziom ryzyka:</span>
      ${['Krytyczny', 'Wysoki', 'Średni', 'Niski'].map((l) => `<span><i class="sw" style="background:transparent;border:2.5px solid ${levelColor(l)}"></i>${l}</span>`).join('')}
    </div>
  </div>`;
  if (!window.cytoscape) { $('#cy').innerHTML = emptyState('Nie udało się wczytać mapy', 'Mapa wymaga połączenia z internetem przy pierwszym ładowaniu strony.'); return; }

  const load = async () => {
    $$('#campSeg button').forEach((b) => b.classList.toggle('on', b.dataset.c === campaign));
    const qs = new URLSearchParams({ depth: '2' });
    if (center) qs.set('center', center); else if (campaign) qs.set('campaign', campaign);
    const g = await api(`/graph?${qs}`);
    const nodes = g.nodes.filter((n) => !hidden.has(n.type));
    const ids = new Set(nodes.map((n) => n.id));
    const maxDeg = Math.max(...nodes.map((n) => n.degree), 1);
    const shortLabel = (n) => (n.type === 'ad' ? `#${n.id.slice(3)}` : n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label);
    cy?.destroy();
    cy = cytoscape({
      container: $('#cy'),
      elements: [
        ...nodes.map((n) => ({ data: { id: n.id, label: shortLabel(n), type: n.type, color: TYPE[n.type]?.color || '#888', border: n.type === 'ad' || n.risk ? levelColor(n.level) : TYPE[n.type]?.color, size: 16 + 30 * Math.sqrt(n.degree / maxDeg) } })),
        ...g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ data: { id: `e${e.id}`, source: e.source, target: e.target, rel: e.rel } })),
      ],
      wheelSensitivity: 0.2, minZoom: 0.2, maxZoom: 3,
      style: [
        { selector: 'node', style: { 'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', 'border-width': 3, 'border-color': 'data(border)', label: 'data(label)', 'font-family': 'Inter, system-ui, sans-serif', 'font-size': 10, color: cssVar('--ink-2'), 'text-valign': 'bottom', 'text-margin-y': 4, 'text-background-color': cssVar('--surface'), 'text-background-opacity': 0.85, 'text-background-padding': 2, 'text-background-shape': 'roundrectangle' } },
        { selector: 'node[type="ad"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[type="domain"]', style: { shape: 'diamond' } },
        { selector: 'node[type="report"]', style: { shape: 'triangle' } },
        { selector: 'edge', style: { width: 1.3, 'line-color': cssVar('--line-strong'), 'target-arrow-color': cssVar('--line-strong'), 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'curve-style': 'bezier' } },
        { selector: 'edge[rel="SIMILAR_TO"]', style: { 'line-style': 'dashed', 'target-arrow-shape': 'none' } },
        { selector: 'edge[rel="MENTIONED_IN_WARNING_LIST"]', style: { 'line-color': cssVar('--crit'), 'target-arrow-color': cssVar('--crit'), width: 2 } },
        { selector: '.dim', style: { opacity: 0.12 } },
        { selector: 'node:selected', style: { 'border-width': 5, 'border-color': cssVar('--accent') } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: 12000, idealEdgeLength: 80, padding: 30, randomize: false },
    });
    cy.on('tap', 'node', (ev) => {
      $('#mapHint')?.remove();
      cy.elements().addClass('dim'); ev.target.closedNeighborhood().removeClass('dim');
      openEntity(ev.target.id());
    });
    cy.on('tap', (ev) => { if (ev.target === cy) cy.elements().removeClass('dim'); });
    if (center) cy.$id(center).select();
  };
  $$('#campSeg button').forEach((b) => b.addEventListener('click', () => { campaign = b.dataset.c; load(); }));
  $$('[data-type]').forEach((c) => c.addEventListener('change', () => { c.checked ? hidden.delete(c.dataset.type) : hidden.add(c.dataset.type); load(); }));
  $('#fit').addEventListener('click', () => cy?.fit(undefined, 30));
  await load();
}

// ——— SZUFLADA ze szczegółami węzła ———
function openDrawer() { $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; cy?.elements().removeClass('dim'); }
$('#drawerClose').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

async function openEntity(id) {
  const body = $('#drawerBody');
  body.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:85%"></div>';
  openDrawer();
  try {
    if (id.startsWith('ad:')) {
      const a = await api(`/ads/${id.slice(3)}`);
      $('#drawerKind').textContent = 'Reklama';
      body.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2>#${a.id} · ${esc(a.advertiser)}</h2>${risk(a.level, a.score)}</div>
        <p class="muted small" style="margin:4px 0 14px">${esc(a.platform)} · ${dateTime(a.detected_at)}</p>
        <div class="quote" style="font-size:14.5px">${highlight(a.text, a.scan)}</div>
        <h3 style="margin:20px 0 10px">Najważniejsze sygnały</h3>${signalsHtml(a.signals.slice(0, 4))}
        <a class="btn btn-primary" style="width:100%;margin-top:18px" href="#/ad/${a.id}">Otwórz pełną analizę ${I.right}</a>`;
      return;
    }
    const e = await api(`/entities/${encodeURIComponent(id)}`);
    $('#drawerKind').textContent = TYPE[e.type]?.label || e.type;
    const m = e.meta;
    const facts = [];
    if (m.warning_list) facts.push(['warn', `Na liście ostrzeżeń: ${m.warning_list}`]);
    if (m.licensed) facts.push(['ok', `Licencja: ${m.licensed}`]);
    if (m.registered_at) facts.push([(Date.now() - new Date(m.registered_at)) / 864e5 < 60 ? 'warn' : 'muted', `Zarejestrowana: ${date(m.registered_at)}`]);
    if (m.whois_hidden) facts.push(['warn', 'Właściciel ukryty w rejestrze domen']);
    if (m.hosting) facts.push(['muted', `Serwer: ${m.hosting}`]);
    if (m.generic) facts.push(['muted', 'Publiczny skracacz linków: nie łączy kampanii']);
    if (m.regulator) facts.push(['ok', `Regulator: ${m.regulator} ${m.license_no || ''}`]);
    if (m.description) facts.push(['muted', m.description]);
    const groups = {};
    for (const r of e.relations) {
      const out = r.src === id; const other = out ? r.dst : r.src;
      const k = (REL[r.rel] || [r.rel, r.rel])[out ? 0 : 1];
      (groups[k] ||= []).push(other);
    }
    const nice = (eid) => (eid.startsWith('ad:') ? `Reklama #${eid.slice(3)}` : eid.slice(eid.indexOf(':') + 1).replace(/^(user|warning):/, ''));
    body.innerHTML = `<h2 class="${['phone', 'email', 'tracker', 'ip', 'domain'].includes(e.type) ? 'mono' : ''}" style="font-size:18px">${esc(e.label)}</h2>
      <p class="muted small" style="margin:4px 0 14px">Pierwszy raz: ${dateTime(e.first_seen)} · ostatnio: ${dateTime(e.last_seen)}</p>
      ${facts.map(([k, t]) => `<div class="${k === 'muted' ? 'muted small' : k}" style="${k === 'muted' ? 'margin-top:4px' : ''}">${k === 'warn' ? I.alert : k === 'ok' ? I.check : ''}<span>${esc(t)}</span></div>`).join('')}
      ${e.ads_using.length ? `<div class="notice info" style="margin-top:16px">${I.info}<span>Pojawia się w <b>${plural(e.ads_using.length, 'reklamie', 'reklamach', 'reklamach')}</b>. To znaczy, że te reklamy prawdopodobnie mają wspólnego nadawcę.</span></div>
        <div>${e.ads_using.map((x) => `<a class="tag" href="#/ad/${x}">#${x}</a>`).join('')}</div>` : ''}
      <h3 style="margin:22px 0 4px">Powiązania</h3>
      ${Object.entries(groups).map(([k, list]) => `<div style="margin-top:12px"><div class="eyebrow">${esc(k)} (${list.length})</div><div>${list.slice(0, 30).map((o) => `<a href="#" class="tag" data-ent="${esc(o)}">${esc(nice(o))}</a>`).join('')}</div></div>`).join('') || '<p class="muted">Brak.</p>'}
      ${e.snapshots.length ? `<h3 style="margin:22px 0 4px">Historia zmian</h3><ul class="log">${e.snapshots.map((s) => `<li>${dateTime(s.captured_at)} · <b>${esc(s.summary)}</b>${s.before_value || s.after_value ? `<div class="mono muted">${esc(s.before_value || '—')} → ${esc(s.after_value || '—')}</div>` : ''}</li>`).join('')}</ul>` : ''}
      <a class="btn" style="width:100%;margin-top:20px" href="#/mapa?center=${encodeURIComponent(id)}">${I.map} Pokaż otoczenie na mapie</a>`;
    bindEntityLinks(body);
  } catch (err) { body.innerHTML = emptyState('Nie udało się wczytać', err.message); }
}
function bindEntityLinks(root) {
  $$('[data-ent]', root).forEach((el) => el.addEventListener('click', (ev) => {
    ev.preventDefault();
    const id = el.dataset.ent;
    if (id.startsWith('ad:') && !$('#drawer').classList.contains('open')) location.hash = `#/ad/${id.slice(3)}`; else openEntity(id);
  }));
}

// ——— AKTYWNOŚĆ ———
const FEED_KIND = { snapshot: ['Zmiana na stronie', 'var(--high)'], ad: ['Nowa reklama', 'var(--accent)'], report: ['Zgłoszenie', 'var(--crit)'], action: ['Decyzja analityka', 'var(--low)'] };
function feedItem(e) {
  const [label, color] = FEED_KIND[e.kind];
  return `<li><span class="k" style="background:${color}"></span>
    <div style="min-width:0"><div><b>${label}:</b> ${esc(e.summary.replace(/^(Wykryto reklamę|Zgłoszenie użytkownika): /, ''))}</div>
      ${e.before_value || e.after_value ? `<div class="chg">${esc(e.before_value || '—')} → ${esc(e.after_value || '—')}</div>` : ''}
      <a href="#" class="small" data-feed="${esc(e.ref)}">${e.ref.startsWith('ad:') ? `Reklama #${e.ref.slice(3)}` : esc(e.ref.slice(e.ref.indexOf(':') + 1).replace(/^user:/, 'zgłoszenie #'))}</a></div>
    <span class="when">${ago(e.ts)}</span></li>`;
}
function bindFeed() {
  $$('[data-feed]').forEach((el) => el.addEventListener('click', (ev) => {
    ev.preventDefault();
    const r = el.dataset.feed;
    if (r.startsWith('ad:')) location.hash = `#/ad/${r.slice(3)}`; else openEntity(r);
  }));
}
async function vActivity() {
  const t = await api('/timeline');
  view.innerHTML = `<div class="page-head"><div><h1>Historia zdarzeń</h1><p>Nowe reklamy, zmiany na stronach, zgłoszenia od osób poszkodowanych i decyzje analityków, od najnowszych.</p></div></div>
  <div class="card"><ul class="feed">${t.map(feedItem).join('')}</ul></div>`;
  bindFeed();
}

// ——— NOWA REKLAMA / ZGŁOSZENIE ———
const EXAMPLE = 'Zainwestuj 500 zł i zarabiaj nawet 1000 zł tygodniowo! Program polecany przez znanego prezentera. Tylko dziś ostatnie miejsca!';
function vNew(params) {
  let mode = params.get('tryb') === 'zgloszenie' ? 'report' : 'ad';
  view.innerHTML = `<div class="narrow">
    <div class="page-head" style="margin-bottom:16px"><div><h1>Sprawdź reklamę</h1><p>Wklej treść reklamy, a system oceni ją i pokaże, z czym jest powiązana.</p></div></div>
    <div class="seg" style="margin-bottom:20px"><button data-m="ad">Reklama</button><button data-m="report">Zgłoszenie od osoby poszkodowanej</button></div>
    <div id="formBox"></div></div>`;
  const render = () => {
    $$('.seg button', view).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
    $('#formBox').innerHTML = mode === 'ad' ? `
      <div class="steps-hint"><span><b>1</b>Wklej treść</span><span><b>2</b>Dodaj link (jeśli masz)</span><span><b>3</b>Kliknij „Sprawdź”</span></div>
      <form class="card card-pad" id="adForm" novalidate>
        <div class="field" id="fT"><label for="t">Treść reklamy</label>
          <textarea id="t" placeholder="Skopiuj i wklej tutaj cały tekst reklamy…"></textarea>
          <div class="err">Wklej treść reklamy (co najmniej 15 znaków).</div>
          <div class="hint">Nie masz przykładu? <a href="#" id="example">Wstaw przykładową reklamę</a></div></div>
        <div class="field" id="fU"><label for="u">Link z reklamy <span class="opt">(opcjonalnie)</span></label>
          <input id="u" type="url" placeholder="https://…" inputmode="url">
          <div class="err">Link musi zaczynać się od http:// lub https://</div>
          <div class="hint">System bezpiecznie odwiedzi link i sprawdzi, dokąd prowadzi. Bez linku oceni tylko treść.</div></div>
        <div class="grid cols-2" style="gap:12px">
          <div class="field"><label for="p">Gdzie ją widziałeś?</label><select id="p"><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="google">Google</option><option value="inne">Inne</option></select></div>
          <div class="field"><label for="adv">Nazwa konta <span class="opt">(opcjonalnie)</span></label><input id="adv" type="text" placeholder="np. Finanse Na Luzie"></div>
        </div>
        <label class="check" style="margin-bottom:20px"><input type="checkbox" id="infl"> To konto influencera</label>
        <button class="btn btn-primary btn-lg" type="submit" id="go">Sprawdź reklamę</button>
        <ul class="progress" id="prog" hidden></ul>
        <div id="formErr"></div>
      </form>` : `
      <form class="card card-pad" id="repForm" novalidate>
        <div class="notice info">${I.info}<span>Nie podawaj imienia, nazwiska ani danych osoby zgłaszającej. Wystarczy opis i numer lub strona oszustów.</span></div>
        <div class="field" id="fD"><label for="rd">Co się wydarzyło?</label><textarea id="rd" placeholder="Np. Zadzwonił „doradca” i namawiał na wpłatę…"></textarea><div class="err">Opisz sytuację (co najmniej 10 znaków).</div></div>
        <div class="field" id="fP"><label for="rp">Numer, z którego dzwoniono <span class="opt">(opcjonalnie)</span></label><input id="rp" type="text" inputmode="tel" placeholder="+48 …"><div class="err">To nie wygląda na numer telefonu.</div></div>
        <div class="field" id="fR"><label for="ru">Adres strony <span class="opt">(opcjonalnie)</span></label><input id="ru" type="url" placeholder="https://…"><div class="err">Adres musi zaczynać się od http:// lub https://</div></div>
        <button class="btn btn-primary btn-lg" type="submit">Wyślij zgłoszenie</button>
      </form>`;
    (mode === 'ad' ? bindAdForm : bindReportForm)();
  };
  $$('.seg button', view).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; render(); }));
  render();
}
const isUrl = (v) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v);
function bindAdForm() {
  $('#example').addEventListener('click', (e) => { e.preventDefault(); $('#t').value = EXAMPLE; $('#fT').classList.remove('invalid'); $('#t').focus(); });
  $('#t').addEventListener('input', () => $('#fT').classList.remove('invalid'));
  $('#u').addEventListener('input', () => $('#fU').classList.remove('invalid'));
  $('#adForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#t').value.trim(), url = $('#u').value.trim();
    let ok = true;
    if (text.length < 15) { $('#fT').classList.add('invalid'); ok = false; }
    if (url && !isUrl(url)) { $('#fU').classList.add('invalid'); ok = false; }
    if (!ok) return $('.field.invalid textarea, .field.invalid input')?.focus();
    const go = $('#go'), prog = $('#prog');
    go.disabled = true; go.textContent = 'Sprawdzam…';
    $('#formErr').innerHTML = '';
    const steps = ['Czytam treść reklamy', ...(url ? ['Sprawdzam, dokąd prowadzi link', 'Sprawdzam właściciela strony'] : []), 'Szukam powiązań z innymi reklamami', 'Liczę ocenę ryzyka'];
    prog.hidden = false;
    let i = 0;
    const paint = () => { prog.innerHTML = steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'on' : ''}">${k < i ? '<span class="pip"></span>' : k === i ? '<span class="spinner"></span>' : '<span class="pip"></span>'}${s}</li>`).join(''); };
    paint();
    const timer = setInterval(() => { if (i < steps.length - 1) { i++; paint(); } }, 900);
    try {
      const r = await api('/ads', { method: 'POST', body: JSON.stringify({ text, target_url: url || null, platform: $('#p').value, advertiser_name: $('#adv').value.trim() || null, is_influencer: $('#infl').checked }) });
      clearInterval(timer); i = steps.length; paint();
      if (r.errors?.length) toast('Nie udało się otworzyć linku. Oceniono samą treść.', true);
      else toast('Gotowe');
      refreshCount();
      setTimeout(() => (location.hash = `#/ad/${r.id}`), 400);
    } catch (err) {
      clearInterval(timer); prog.hidden = true;
      go.disabled = false; go.textContent = 'Spróbuj ponownie';
      $('#formErr').innerHTML = `<div class="notice bad" style="margin-top:16px">${I.alert}<span>${esc(err.message)}</span></div>`;
    }
  });
}
function bindReportForm() {
  for (const [f, i] of [['fD', 'rd'], ['fP', 'rp'], ['fR', 'ru']]) $(`#${i}`).addEventListener('input', () => $(`#${f}`).classList.remove('invalid'));
  $('#repForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = $('#rd').value.trim(), url = $('#ru').value.trim();
    let phone = $('#rp').value.replace(/[^\d+]/g, '');
    let ok = true;
    if (d.length < 10) { $('#fD').classList.add('invalid'); ok = false; }
    if (phone && phone.replace('+', '').length < 9) { $('#fP').classList.add('invalid'); ok = false; }
    if (url && !isUrl(url)) { $('#fR').classList.add('invalid'); ok = false; }
    if (!ok) return;
    if (phone && !phone.startsWith('+')) phone = phone.startsWith('00') ? `+${phone.slice(2)}` : `+48${phone}`;
    try {
      await api('/user-reports', { method: 'POST', body: JSON.stringify({ description: d, phone: phone || null, url: url || null }) });
      toast('Dziękujemy, zgłoszenie zapisane');
      e.target.reset();
    } catch (err) { toast(err.message, true); }
  });
}

// ——— USTAWIENIA ———
function getTheme() { try { return localStorage.getItem('it-theme') || 'system'; } catch { return 'system'; } }
function applyTheme(t) {
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('it-theme', t); } catch { /* brak pamięci przeglądarki */ }
}
applyTheme(getTheme());

async function vSettings() {
  const w = await api('/weights');
  view.innerHTML = `<div class="narrow">
    <div class="page-head"><div><h1>Ustawienia</h1></div></div>
    <section class="card card-pad"><h2>Wygląd</h2><p class="muted small" style="margin:4px 0 14px">Ciemny motyw jest wygodniejszy wieczorem.</p>
      <div class="seg" id="theme"><button data-t="system">Jak w systemie</button><button data-t="light">Jasny</button><button data-t="dark">Ciemny</button></div></section>

    <section class="card card-pad section" style="margin-top:16px"><h2>Wagi sygnałów</h2>
      <p class="muted small" style="margin:4px 0 14px">Ile punktów dodaje każdy sygnał. Więcej punktów oznacza wyższą ocenę ryzyka. Wartość ujemna obniża ryzyko. Zmieniaj tylko, jeśli wiesz, co robisz.</p>
      <form id="wf"><table class="weights"><thead><tr><th>Sygnał</th><th>Punkty</th></tr></thead>
      <tbody>${w.map((x) => `<tr><td>${esc(x.label)}</td><td><input type="number" min="-100" max="100" step="5" value="${x.weight}" data-code="${esc(x.code)}" aria-label="${esc(x.label)}"></td></tr>`).join('')}</tbody></table>
      <button class="btn btn-primary" style="margin-top:16px" disabled id="wsave">Zapisz i przelicz oceny</button></form></section>

    <section class="card card-pad" style="margin-top:16px"><h2>Dane demonstracyjne</h2>
      <p class="muted small" style="margin:4px 0 14px">Przywraca przykładowy zestaw 33 fikcyjnych reklam. Wszystko, co dodano ręcznie, zostanie usunięte.</p>
      <button class="btn" id="reset" style="color:var(--crit)">Przywróć dane demo</button></section>
  </div>`;
  const paintTheme = () => $$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.t === getTheme()));
  $$('#theme button').forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.t); paintTheme(); }));
  paintTheme();
  $$('[data-code]').forEach((i) => i.addEventListener('input', () => ($('#wsave').disabled = false)));
  $('#wf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = $$('[data-code]').map((i) => ({ code: i.dataset.code, weight: Math.max(-100, Math.min(100, Math.round(+i.value || 0))) }));
    if (!(await confirmDialog('Przeliczyć oceny?', 'Zmiana wag zmieni ocenę wszystkich reklam.', 'Tak, przelicz'))) return;
    await api('/weights', { method: 'PUT', body: JSON.stringify(list) });
    toast('Zapisano. Oceny zostały przeliczone.'); $('#wsave').disabled = true;
  });
  $('#reset').addEventListener('click', async () => {
    if (!(await confirmDialog('Przywrócić dane demo?', 'Wszystkie ręcznie dodane reklamy, zgłoszenia i decyzje zostaną usunięte. Tego nie da się cofnąć.', 'Tak, przywróć'))) return;
    await api('/demo/reset', { method: 'POST' });
    toast('Przywrócono dane demo'); refreshCount(); location.hash = '#/start';
  });
}

// ——— WYSZUKIWANIE ———
async function vSearch(q) {
  const r = await api(`/search?q=${encodeURIComponent(q)}`);
  view.innerHTML = `<div class="page-head"><div><h1>Wyniki dla „${esc(q)}”</h1><p>${plural(r.entities.length + r.ads.length, 'wynik', 'wyniki', 'wyników')}</p></div></div>
  ${r.entities.length ? `<h2 style="margin-bottom:10px">Numery, strony, firmy</h2><div class="card card-pad" style="margin-bottom:24px">${r.entities.map((e) => `<a href="#" class="tag" data-ent="${esc(e.id)}" title="${esc(TYPE[e.type]?.label)}"><span class="sw" style="background:${TYPE[e.type]?.color}"></span>${esc(e.label)}</a>`).join('')}</div>` : ''}
  ${r.ads.length ? `<h2 style="margin-bottom:10px">Reklamy</h2><div class="card"><div class="rows">${r.ads.map(adRow).join('')}</div></div>` : ''}
  ${!r.entities.length && !r.ads.length ? `<div class="card">${emptyState('Nic nie znaleziono', 'Spróbuj wpisać fragment numeru telefonu, nazwę strony albo słowo z reklamy.')}</div>` : ''}`;
  bindEntityLinks(view);
}
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) location.hash = `#/szukaj?q=${encodeURIComponent(q)}`; });

// ——— Router ———
async function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const parts = (path || '/start').split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  const tab = parts[0] === 'ad' ? 'kolejka' : parts[0];
  $$('[data-v]').forEach((a) => a.classList.toggle('on', a.dataset.v === tab));
  closeDrawer();
  view.innerHTML = '<div class="skeleton" style="width:40%;height:28px"></div><div class="skeleton" style="width:65%"></div><div class="skeleton" style="height:180px;margin-top:24px"></div>';
  window.scrollTo(0, 0);
  try {
    switch (parts[0]) {
      case 'kolejka': await vQueue(params); break;
      case 'kampanie': await vCampaigns(parts[1]); break;
      case 'mapa': await vMap(params); break;
      case 'ad': await vAd(parts[1]); break;
      case 'nowa': vNew(params); break;
      case 'aktywnosc': await vActivity(); break;
      case 'ustawienia': await vSettings(); break;
      case 'szukaj': await vSearch(params.get('q') || ''); break;
      default: await vStart();
    }
  } catch (e) {
    view.innerHTML = `<div class="card">${emptyState('Coś poszło nie tak', `${e.message}. Odśwież stronę albo wróć na start.`)}<p style="text-align:center;padding-bottom:24px"><a class="btn" href="#/start">Wróć na start</a></p></div>`;
  }
}
window.addEventListener('hashchange', route);
route();
refreshCount();
