// InvestTrace – panel analityka (vanilla JS + Cytoscape)
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const api = async (path, opts = {}) => {
  const r = await fetch(`/api${path}`, { headers: { 'content-type': 'application/json', 'x-analyst': 'analityk.demo' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2600); };
const badge = (level, score) => `<span class="badge lv-${esc(level || 'Niski')}"><span class="score">${score ?? 0}</span> ${esc(level || 'Niski')}</span>`;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const levelColor = (l) => ({ Niski: css('--r-low'), 'Średni': css('--r-mid'), Wysoki: css('--r-high'), Krytyczny: css('--r-crit') }[l] || css('--muted'));

const TYPE = {
  ad: { label: 'Reklama', color: '#5d6874' }, account: { label: 'Konto reklamodawcy', color: '#6b7bd6' },
  influencer: { label: 'Influencer', color: '#9b59b6' }, domain: { label: 'Domena', color: '#2f6fdd' },
  phone: { label: 'Telefon', color: '#16a085' }, email: { label: 'E-mail', color: '#0e9aa7' },
  tracker: { label: 'Tracker (Pixel/GA/GTM)', color: '#e8a33d' }, ip: { label: 'Adres IP', color: '#7f8c8d' },
  company: { label: 'Firma / podmiot', color: '#8e5a2b' }, report: { label: 'Zgłoszenie / lista ostrzeżeń', color: '#c0392b' },
};
const REL = { PROMOTES: 'promuje', LINKS_TO: 'linkuje do', REDIRECTS_TO: 'przekierowuje do', USES_PHONE: 'używa telefonu', USES_EMAIL: 'używa e-maila', USES_TRACKER: 'używa trackera', HOSTED_ON: 'hostowana na', SIMILAR_TO: 'podobna do', OPERATED_BY: 'prowadzona przez', MENTIONED_IN_WARNING_LIST: 'na liście ostrzeżeń', REPORTED_IN: 'zgłoszenie dot.' };
const VIA = { start: 'start', http_301: 'HTTP 301', http_302: 'HTTP 302', meta_refresh: 'meta refresh', js: 'przekierowanie JS', form_submit: 'wysłanie formularza' };
const KIND = { shortener: 'Skracacz linku', news_fake: 'Fałszywy artykuł', form: 'Formularz leadowy', landing: 'Strona lądowania', platform: 'Platforma docelowa', other: 'Strona' };

function adRow(a) {
  return `<li class="adrow" data-ad="${a.id}">
    <span>${badge(a.level, a.score)}</span>
    <div><div class="plat">${esc(a.platform)} · ${esc(a.advertiser || 'nieznane konto')} · ${fmt(a.detected_at)}</div>
      <div class="txt">${esc(a.text)}</div>
      <div>${(a.flags || []).map((f) => `<span class="chip">${esc(f.label)}</span>`).join('')}</div></div>
    <span class="muted">#${a.id}</span></li>`;
}
const bindAdClicks = (root = view) => root.querySelectorAll('[data-ad]').forEach((el) => el.addEventListener('click', () => (location.hash = `#/ad/${el.dataset.ad}`)));

// ——— Widoki ———
async function vPanel() {
  const [s, feed, queue] = await Promise.all([api('/stats'), api('/ads?limit=12'), api('/queue')]);
  view.innerHTML = `<h1>Panel główny</h1><p class="sub">Przegląd wykrytych reklam inwestycyjnych i materiałów wymagających weryfikacji.</p>
  <div class="kpis">
    <div class="kpi"><b>${s.ads}</b><span>wykrytych reklam</span></div>
    <div class="kpi"><b style="color:var(--r-crit)">${s.critical}</b><span>ryzyko krytyczne</span></div>
    <div class="kpi"><b style="color:var(--r-high)">${s.high}</b><span>ryzyko wysokie</span></div>
    <div class="kpi"><b>${s.campaigns}</b><span>wykrytych kampanii</span></div>
    <div class="kpi"><b>${s.domains}</b><span>domen w grafie</span></div>
    <div class="kpi"><b>${s.open_cases}</b><span>otwartych spraw</span></div>
    <div class="kpi"><b>${s.reports}</b><span>zgłoszeń użytkowników</span></div>
  </div>
  <div class="grid g2">
    <section class="card"><h2>Ranking do sprawdzenia</h2><ul class="list">${queue.slice(0, 7).map(adRow).join('')}</ul><a href="#/kolejka">Pełna kolejka →</a></section>
    <section class="card"><h2>Najnowsze reklamy</h2><ul class="list">${feed.slice(0, 7).map(adRow).join('')}</ul></section>
  </div>`;
  bindAdClicks();
}

async function vQueue() {
  const q = await api('/queue');
  view.innerHTML = `<h1>Do sprawdzenia</h1><p class="sub">Sortowanie: wynik ryzyka → suma punktów → świeżość. Status „Nowe” i „W analizie”.</p>
  <div class="card tablewrap"><table><thead><tr><th>Ryzyko</th><th>Reklama</th><th>Konto / platforma</th><th>Główne sygnały</th><th>Powiązania</th><th>Status</th><th>Wykryto</th></tr></thead>
  <tbody>${q.map((a) => `<tr class="click" data-ad="${a.id}"><td>${badge(a.level, a.score)}${a.propagated ? '<div class="muted" style="font-size:11px">przez propagację</div>' : ''}</td>
    <td style="max-width:340px"><div class="txt">#${a.id} ${esc(a.text)}</div></td><td>${esc(a.advertiser)}<div class="plat">${esc(a.platform)}</div></td>
    <td>${a.flags.map((f) => `<span class="chip">${esc(f.label)}</span>`).join('')}</td><td class="score">${a.connections}</td><td>${esc(a.status)}</td><td>${fmt(a.detected_at)}</td></tr>`).join('')}</tbody></table></div>`;
  bindAdClicks();
}

function highlight(text, scan) {
  let html = esc(text);
  const quotes = [...new Set((scan?.red_flags || []).map((f) => f.quote))].sort((a, b) => b.length - a.length);
  for (const q of quotes) { const e = esc(q); if (e && html.includes(e)) html = html.split(e).join(`<mark title="sygnał ryzyka">${e}</mark>`); }
  return html;
}

function journeyHtml(j) {
  if (!j) return '<p class="muted">Brak zarejestrowanej ścieżki. Dodaj URL docelowy i uruchom skan.</p>';
  const parts = [];
  j.steps.forEach((s, i) => {
    if (i) parts.push(`<div class="jarrow">${esc(VIA[s.via] || s.via)}</div>`);
    const m = s.domain_meta || {};
    const warn = [];
    if (m.warning_list) warn.push(`⚠ ${esc(m.warning_list)}`);
    if (m.registered_at && (Date.now() - new Date(m.registered_at)) / 864e5 < 45) warn.push(`młoda domena (${esc(m.registered_at.slice(0, 10))})`);
    if (m.whois_hidden) warn.push('ukryty WHOIS');
    if (m.licensed) warn.push(`✓ licencja: ${esc(m.licensed)}`);
    parts.push(`<div class="jstep">
      <div class="jshot"><div class="bar"></div><div class="ttl">${esc(s.title || s.domain)}</div>
        ${s.forms.length ? `<div class="frm">${s.forms[0].fields.map(() => '<i></i>').join('')}</div>` : ''}</div>
      <div class="jbody"><div class="kind k-${esc(s.kind)}">${i + 1}. ${esc(KIND[s.kind] || 'Strona')}</div>
        <div><a href="#" data-ent="domain:${esc(s.domain)}">${esc(s.domain)}</a> ${s.http_status ? `<span class="muted">HTTP ${s.http_status}</span>` : ''}</div>
        <div class="mono muted">${esc(s.url)}</div>
        ${s.forms.length ? `<div>Formularz zbiera: <b>${esc(s.forms.map((f) => f.fields.join(', ')).join(' | '))}</b></div>` : ''}
        ${s.trackers.map((t) => `<a class="chip" href="#" data-ent="tracker:${esc(t)}">${esc(t)}</a>`).join('')}
        ${s.contacts.map((c) => `<a class="chip" href="#" data-ent="${esc(c.kind)}:${esc(c.value)}">${esc(c.value)}</a>`).join('')}
        ${warn.map((w) => `<div class="${w.startsWith('✓') ? '' : 'flag'}" style="font-size:12px">${w}</div>`).join('')}</div></div>`);
  });
  return `${j.cloaking ? `<p class="flag">⚠ Wykryto cloaking: ${esc(j.cloaking_note)}</p>` : ''}<div class="journey">${parts.join('')}</div>`;
}

async function vAd(id) {
  const a = await api(`/ads/${id}`);
  const ringC = levelColor(a.level);
  view.innerHTML = `<p><a href="#/kolejka">← Do sprawdzenia</a></p>
  <h1>Reklama #${a.id}</h1><p class="sub">${esc(a.platform)} · ${esc(a.advertiser || 'nieznane konto')}${a.is_influencer ? ' (influencer)' : ''} · wykryta ${fmt(a.detected_at)}${a.campaign ? ` · <a href="#/kampanie/${a.campaign_id}">${esc(a.campaign)}</a>` : ''}</p>
  <div class="grid g2">
    <section class="card">
      <div class="bigscore"><div class="ring" style="--v:${a.score};--c:${ringC}"><b>${a.score}</b></div>
        <div><div>${badge(a.level, a.score)}</div><div class="muted" style="margin-top:6px">Suma wag: <b>${a.points}</b> pkt → wynik 100·(1−e<sup>−pkt/60</sup>) = ${a.base_score}${a.propagated ? `<br>Propagacja z reklamy <a href="#/ad/${a.propagated_from}">#${a.propagated_from}</a>: <b>${a.propagated}</b>` : ''}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">Silnik analizy treści: ${esc(a.scan?.engine || '—')}</div></div></div>
      <h2 style="margin-top:14px">Treść reklamy</h2><blockquote>${highlight(a.text, a.scan)}</blockquote>
      ${a.target_url ? `<div class="mono muted">URL: ${esc(a.target_url)}</div>` : ''}
    </section>
    <section class="card"><h2>Uzasadnienie oceny</h2>
      ${a.signals.map((s) => `<div class="sig"><span>${esc(s.label)}</span><span class="w ${s.weight < 0 ? 'neg' : ''}">${s.weight > 0 ? '+' : ''}${s.weight || '—'}</span><span class="d">${esc(s.detail)}</span></div>`).join('') || '<p class="muted">Brak sygnałów ryzyka.</p>'}
    </section>
  </div>
  <section class="card" style="margin-top:16px"><h2>Ścieżka inwestora</h2>${journeyHtml(a.journey)}</section>
  <div class="grid g2" style="margin-top:16px">
    <section class="card"><h2>Decyzja analityka</h2>
      <div class="row">${['W analizie', 'Potwierdzone ryzyko', 'Fałszywy alarm', 'Przekazane'].map((s) => `<button data-status="${s}" class="${a.case?.status === s ? 'primary' : ''}">${s}</button>`).join('')}</div>
      <label for="notes">Notatka</label><textarea id="notes">${esc(a.case?.notes)}</textarea>
      <div class="row" style="margin-top:8px"><button id="saveNote">Zapisz notatkę</button>
        <a class="btn" href="/api/reports/${a.case_id}" target="_blank" rel="noopener">Raport (PDF/HTML)</a>
        <a class="btn" href="/api/cases/${a.case_id}/evidence.json" target="_blank" rel="noopener">Paczka dowodowa (JSON)</a>
        <a class="btn" href="#/mapa?center=ad:${a.id}">Pokaż na mapie</a>
        ${a.target_url && a.source !== 'demo' ? '<button id="rescan">Skanuj ponownie</button>' : ''}</div>
      <h2 style="margin-top:16px">Historia działań</h2>
      <ul class="list">${a.actions.map((x) => `<li>${fmt(x.created_at)} · <b>${esc(x.actor)}</b>: ${esc(x.from_status)} → ${esc(x.to_status)} ${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</li>`).join('') || '<li class="muted">Brak działań.</li>'}</ul>
    </section>
    <section class="card"><h2>Dowody (append-only)</h2><ul class="list">${a.evidence.map((e) => `<li><b>#${e.id} ${esc(e.kind)}</b> · ${fmt(e.created_at)} · ${esc(e.source)}<div class="muted">${esc(e.reason)}</div><div class="mono muted">sha256: ${e.sha256}</div></li>`).join('')}</ul></section>
  </div>`;
  view.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', async () => {
    await api(`/cases/${a.case_id}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.status, notes: $('#notes').value }) });
    toast(`Status: ${b.dataset.status}`); vAd(id);
  }));
  $('#saveNote').addEventListener('click', async () => { await api(`/cases/${a.case_id}`, { method: 'PATCH', body: JSON.stringify({ notes: $('#notes').value }) }); toast('Zapisano notatkę'); vAd(id); });
  $('#rescan')?.addEventListener('click', async () => { toast('Skanowanie…'); const r = await api(`/ads/${id}/scan`, { method: 'POST' }); if (r.errors.length) toast(r.errors.join('; ')); vAd(id); });
  bindEntityLinks();
}

let cy;
async function vMap(params) {
  const center = params.get('center'), campaign = params.get('campaign') || '';
  const camps = await api('/campaigns');
  view.innerHTML = `<h1>Mapa powiązań</h1><p class="sub">Kolor = typ węzła, obramowanie = poziom ryzyka, rozmiar = liczba powiązań. Kliknij węzeł, aby zobaczyć szczegóły i dowody.</p>
  <div class="mapwrap">
    <div class="card">
      <label for="fCamp">Kampania</label><select id="fCamp" style="width:100%"><option value="">Wszystkie</option>${camps.map((c) => `<option value="${c.id}" ${String(c.id) === campaign ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label for="fRisk">Minimalne ryzyko: <b id="fRiskV">0</b></label><input id="fRisk" type="range" min="0" max="90" step="5" value="0" style="width:100%">
      <label>Typy węzłów</label><div class="legend">${Object.entries(TYPE).map(([k, t]) => `<div><input type="checkbox" data-type="${k}" checked id="t-${k}"><label for="t-${k}" style="margin:0;display:flex;gap:6px;align-items:center;color:var(--ink);font-size:13px"><span class="dot" style="background:${t.color}"></span>${t.label}</label></div>`).join('')}</div>
      <label>Ryzyko (obramowanie)</label><div class="legend">${['Niski', 'Średni', 'Wysoki', 'Krytyczny'].map((l) => `<div><span class="dot" style="background:transparent;border:3px solid ${levelColor(l)}"></span>${l}</div>`).join('')}</div>
      ${center ? `<p style="margin-top:12px">Widok wokół <b>${esc(center)}</b> · <a href="#/mapa">pokaż cały graf</a></p>` : ''}
      <button id="fit" style="margin-top:12px;width:100%">Dopasuj widok</button>
    </div>
    <div id="cy" role="img" aria-label="Graf powiązań"></div>
  </div>`;
  if (!window.cytoscape) { $('#cy').innerHTML = '<p style="padding:16px">Nie udało się wczytać biblioteki Cytoscape (wymaga internetu).</p>'; return; }
  const load = async () => {
    const qs = new URLSearchParams({ depth: '2', minRisk: $('#fRisk').value });
    if (center) qs.set('center', center);
    if ($('#fCamp').value) qs.set('campaign', $('#fCamp').value);
    const g = await api(`/graph?${qs}`);
    const hidden = new Set([...view.querySelectorAll('[data-type]')].filter((c) => !c.checked).map((c) => c.dataset.type));
    const nodes = g.nodes.filter((n) => !hidden.has(n.type));
    const ids = new Set(nodes.map((n) => n.id));
    const maxDeg = Math.max(...nodes.map((n) => n.degree), 1);
    const els = [
      ...nodes.map((n) => ({ data: { id: n.id, label: n.type === 'ad' ? `#${n.id.slice(3)}` : n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label, type: n.type, color: n.type === 'ad' ? levelColor(n.level) : TYPE[n.type]?.color || '#888', border: levelColor(n.level), size: 18 + 34 * Math.sqrt(n.degree / maxDeg) } })),
      ...g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ data: { id: `e${e.id}`, source: e.source, target: e.target, rel: e.rel } })),
    ];
    cy?.destroy();
    cy = cytoscape({
      container: $('#cy'), elements: els, wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: { 'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', 'border-width': 3, 'border-color': 'data(border)', label: 'data(label)', 'font-size': 9, color: css('--ink'), 'text-valign': 'bottom', 'text-margin-y': 3, 'text-outline-color': css('--panel'), 'text-outline-width': 2 } },
        { selector: 'node[type="ad"]', style: { shape: 'round-rectangle' } },
        { selector: 'node[type="domain"]', style: { shape: 'diamond' } },
        { selector: 'node[type="report"]', style: { shape: 'triangle' } },
        { selector: 'edge', style: { width: 1.2, 'line-color': css('--muted'), 'target-arrow-color': css('--muted'), 'line-opacity': 0.55, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, 'curve-style': 'bezier' } },
        { selector: 'edge[rel="SIMILAR_TO"]', style: { 'line-style': 'dashed', 'line-color': '#9b59b6', 'target-arrow-shape': 'none' } },
        { selector: 'edge[rel="MENTIONED_IN_WARNING_LIST"]', style: { 'line-color': css('--r-crit'), width: 2 } },
        { selector: '.dim', style: { opacity: 0.12 } },
        { selector: 'node:selected', style: { 'border-width': 5, 'border-color': css('--accent') } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: 9000, idealEdgeLength: 70, padding: 20, randomize: true },
    });
    cy.on('tap', 'node', (ev) => {
      const n = ev.target; const nb = n.closedNeighborhood();
      cy.elements().addClass('dim'); nb.removeClass('dim');
      openEntity(n.id());
    });
    cy.on('tap', (ev) => { if (ev.target === cy) cy.elements().removeClass('dim'); });
  };
  view.querySelectorAll('[data-type]').forEach((c) => c.addEventListener('change', load));
  $('#fRisk').addEventListener('input', (e) => ($('#fRiskV').textContent = e.target.value));
  $('#fRisk').addEventListener('change', load);
  $('#fCamp').addEventListener('change', load);
  $('#fit').addEventListener('click', () => cy?.fit(undefined, 20));
  await load();
}

async function openEntity(id) {
  const drawer = $('#drawer'), body = $('#drawerBody');
  if (id.startsWith('ad:')) {
    const a = await api(`/ads/${id.slice(3)}`);
    body.innerHTML = `<div class="plat">Reklama</div><h2>#${a.id} ${badge(a.level, a.score)}</h2><p class="muted">${esc(a.platform)} · ${esc(a.advertiser)}</p>
      <blockquote>${highlight(a.text, a.scan)}</blockquote>
      ${a.signals.slice(0, 6).map((s) => `<div class="sig"><span>${esc(s.label)}</span><span class="w ${s.weight < 0 ? 'neg' : ''}">${s.weight > 0 ? '+' : ''}${s.weight || '—'}</span><span class="d">${esc(s.detail)}</span></div>`).join('')}
      <p style="margin-top:12px"><a class="btn" href="#/ad/${a.id}">Pełna analiza i ścieżka →</a></p>`;
  } else {
    const e = await api(`/entities/${encodeURIComponent(id)}`);
    const meta = Object.entries(e.meta).filter(([k]) => !['snippet'].includes(k));
    body.innerHTML = `<div class="plat">${esc(TYPE[e.type]?.label || e.type)}</div><h2 class="mono" style="font-size:15px">${esc(e.label)}</h2>
      <p class="muted">Pierwsze wystąpienie ${fmt(e.first_seen)} · ostatnie ${fmt(e.last_seen)}</p>
      ${meta.length ? `<table>${meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</td></tr>`).join('')}</table>` : ''}
      <h2 style="margin-top:14px">Występuje w ścieżkach ${e.ads_using.length} reklam</h2>
      <div>${e.ads_using.map((id) => `<a class="chip" href="#/ad/${id}">#${id}</a>`).join('') || '<span class="muted">—</span>'}</div>
      <h2 style="margin-top:14px">Powiązania (${e.relations.length})</h2>
      <ul class="list">${e.relations.slice(0, 40).map((r) => { const other = r.src === id ? r.dst : r.src; const dir = r.src === id ? REL[r.rel] || r.rel : `← ${REL[r.rel] || r.rel}`; return `<li><span class="muted">${esc(dir)}</span> <a href="#" data-ent="${esc(other)}" class="mono">${esc(other)}</a><div class="muted" style="font-size:11.5px">źródło: ${esc(r.source)} · pewność ${r.confidence} · ${fmt(r.first_seen)}${r.evidence_id ? ` · dowód #${r.evidence_id}` : ''}</div></li>`; }).join('')}</ul>
      ${e.snapshots.length ? `<h2 style="margin-top:14px">Historia zmian</h2><ul class="list">${e.snapshots.map((s) => `<li>${fmt(s.captured_at)} · <b>${esc(s.summary)}</b>${s.before_value || s.after_value ? `<div class="mono muted">${esc(s.before_value || '∅')} → ${esc(s.after_value || '∅')}</div>` : ''}</li>`).join('')}</ul>` : ''}
      <p style="margin-top:12px"><a class="btn" href="#/mapa?center=${encodeURIComponent(id)}">Mapa wokół tego węzła</a></p>`;
  }
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  bindEntityLinks(body);
}
function bindEntityLinks(root = view) {
  root.querySelectorAll('[data-ent]').forEach((el) => el.addEventListener('click', (ev) => { ev.preventDefault(); openEntity(el.dataset.ent); }));
}
$('#drawerClose').addEventListener('click', () => { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); });

async function vCampaigns(id) {
  if (id) {
    const c = await api(`/campaigns/${id}`);
    view.innerHTML = `<p><a href="#/kampanie">← Kampanie</a></p><h1>${esc(c.name)}</h1>
      <p class="sub">${c.ads} reklam · ${c.accounts} kont · ${c.domains} domen · ${c.phones} telefonów · ${c.trackers} trackerów · aktywna ${fmt(c.first_seen)} – ${fmt(c.last_seen)}</p>
      <p><a class="btn" href="#/mapa?campaign=${c.id}">Pokaż kampanię na mapie</a></p>
      <section class="card"><ul class="list">${c.ads.map(adRow).join('')}</ul></section>`;
    return bindAdClicks();
  }
  const cs = await api('/campaigns');
  view.innerHTML = `<h1>Kampanie</h1><p class="sub">Grupy reklam połączone wspólnymi domenami, telefonami, e-mailami, trackerami lub bardzo podobną treścią.</p>
  <div class="grid g3">${cs.map((c) => `<a class="card" href="#/kampanie/${c.id}" style="color:inherit;text-decoration:none">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(c.name)}</h2>${badge(c.max_score >= 75 ? 'Krytyczny' : c.max_score >= 50 ? 'Wysoki' : c.max_score >= 25 ? 'Średni' : 'Niski', c.max_score)}</div>
    <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin:12px 0 6px">
      <div class="kpi"><b>${c.ads}</b><span>reklam</span></div><div class="kpi"><b>${c.accounts}</b><span>kont</span></div><div class="kpi"><b>${c.domains}</b><span>domen</span></div></div>
    <div class="muted">Platformy docelowe: ${c.platforms.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>
    <div class="muted" style="font-size:12px;margin-top:6px">Aktywność: ${fmt(c.first_seen)} – ${fmt(c.last_seen)} · śr. ryzyko ${c.avg_score}</div></a>`).join('')}</div>`;
}

async function vTimeline() {
  const t = await api('/timeline');
  const kc = { snapshot: 'var(--r-high)', ad: 'var(--accent)', report: 'var(--r-crit)', action: 'var(--r-low)' };
  const kl = { snapshot: 'Zmiana', ad: 'Reklama', report: 'Zgłoszenie', action: 'Analityk' };
  view.innerHTML = `<h1>Historia zmian</h1><p class="sub">Zmiany stron i reklam, nowe wykrycia, zgłoszenia użytkowników i decyzje analityków.</p>
  <section class="card"><ul class="list timeline">${t.map((e) => `<li><div><div class="tl-kind" style="color:${kc[e.kind]}">${kl[e.kind]}</div><div class="muted">${fmt(e.ts)}</div></div>
    <div><div>${esc(e.summary)}</div>${e.before_value || e.after_value ? `<div class="mono muted">${esc(e.before_value || '∅')} → ${esc(e.after_value || '∅')}</div>` : ''}
    <a href="#" data-ent="${esc(e.ref)}" class="mono muted" style="font-size:11.5px">${esc(e.ref)}</a></div></li>`).join('')}</ul></section>`;
  view.querySelectorAll('[data-ent]').forEach((el) => el.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (el.dataset.ent.startsWith('ad:')) location.hash = `#/ad/${el.dataset.ent.slice(3)}`; else openEntity(el.dataset.ent);
  }));
}

function vAdd() {
  view.innerHTML = `<h1>Dodaj reklamę / zgłoszenie</h1><p class="sub">Nowa reklama przechodzi przez cały pipeline: analiza treści → śledzenie przekierowań → wzbogacenie domen → graf → ocena ryzyka.</p>
  <div class="grid g2">
    <form class="card" id="adForm"><h2>Nowa reklama</h2>
      <label for="t">Treść reklamy *</label><textarea id="t" required placeholder="Np. Zainwestuj 500 zł i zarabiaj 1000 zł tygodniowo!"></textarea>
      <label for="u">URL docelowy (opcjonalnie – zostanie odwiedzony przez Redirect Tracker)</label><input id="u" type="url" style="width:100%" placeholder="https://…">
      <div class="row"><div><label for="p">Platforma</label><select id="p"><option>facebook</option><option>instagram</option><option>tiktok</option><option>youtube</option><option>google</option><option>inne</option></select></div>
      <div style="flex:1"><label for="adv">Konto reklamodawcy</label><input id="adv" style="width:100%" placeholder="nazwa konta"></div></div>
      <label><input type="checkbox" id="infl"> Konto to influencer</label>
      <div class="row" style="margin-top:12px"><button class="primary" type="submit">Analizuj</button><span id="adMsg" class="muted"></span></div>
    </form>
    <form class="card" id="repForm"><h2>Zgłoszenie użytkownika</h2>
      <label for="rd">Opis *</label><textarea id="rd" required placeholder="Co się wydarzyło?"></textarea>
      <label for="rp">Numer telefonu, z którego dzwoniono</label><input id="rp" style="width:100%" placeholder="+48 …">
      <label for="ru">Adres strony</label><input id="ru" type="url" style="width:100%" placeholder="https://…">
      <p class="muted" style="font-size:12px">Nie podawaj danych osobowych zgłaszającego. Zgłoszenie zostanie powiązane z grafem po numerze telefonu lub domenie.</p>
      <div class="row"><button class="primary" type="submit">Wyślij zgłoszenie</button></div>
    </form>
  </div>
  <section class="card" style="margin-top:16px"><h2>Dane demo</h2><p class="muted">Przywraca fikcyjny zestaw 33 reklam, 3 kampanii i 16 domen.</p><button id="reset">Przywróć dane demo</button></section>`;
  $('#adForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#adMsg').textContent = 'Analiza w toku…';
    try {
      const r = await api('/ads', { method: 'POST', body: JSON.stringify({ text: $('#t').value, target_url: $('#u').value || null, platform: $('#p').value, advertiser_name: $('#adv').value || null, is_influencer: $('#infl').checked }) });
      if (r.errors?.length) toast(r.errors.join('; '));
      location.hash = `#/ad/${r.id}`;
    } catch (err) { $('#adMsg').textContent = err.message; }
  });
  $('#repForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const phone = $('#rp').value.replace(/[^\d+]/g, '');
    await api('/user-reports', { method: 'POST', body: JSON.stringify({ description: $('#rd').value, phone: phone ? (phone.startsWith('+') ? phone : '+48' + phone) : null, url: $('#ru').value || null }) });
    toast('Zgłoszenie zapisane i powiązane z grafem'); e.target.reset();
  });
  $('#reset').addEventListener('click', async () => { if (!confirm('Przywrócić dane demo? Dodane reklamy zostaną usunięte.')) return; await api('/demo/reset', { method: 'POST' }); toast('Przywrócono dane demo'); location.hash = '#/panel'; });
}

async function vWeights() {
  const w = await api('/weights');
  view.innerHTML = `<h1>Wagi ryzyka</h1><p class="sub">Konfiguracja modelu ważonych sygnałów (administrator). Po zapisaniu wszystkie wyniki są przeliczane. Wynik = 100·(1−e<sup>−suma/60</sup>); ryzyko propaguje się w grafie z wygaszaniem 0,5 na krok.</p>
  <form class="card tablewrap" id="wf" style="max-width:760px"><table><thead><tr><th>Kod</th><th>Sygnał</th><th>Waga</th></tr></thead>
  <tbody>${w.map((x) => `<tr><td class="mono">${esc(x.code)}</td><td>${esc(x.label)}</td><td><input type="number" min="-100" max="100" value="${x.weight}" data-code="${esc(x.code)}" style="width:80px"></td></tr>`).join('')}</tbody></table>
  <div class="row" style="margin-top:12px"><button class="primary">Zapisz i przelicz</button></div></form>`;
  $('#wf').addEventListener('submit', async (e) => {
    e.preventDefault();
    await api('/weights', { method: 'PUT', body: JSON.stringify([...view.querySelectorAll('[data-code]')].map((i) => ({ code: i.dataset.code, weight: +i.value }))) });
    toast('Zapisano – wyniki przeliczone');
  });
}

async function vSearch(q) {
  const r = await api(`/search?q=${encodeURIComponent(q)}`);
  view.innerHTML = `<h1>Wyniki: „${esc(q)}”</h1>
  <div class="grid g2"><section class="card"><h2>Węzły grafu (${r.entities.length})</h2><ul class="list">${r.entities.map((e) => `<li><span class="dot" style="background:${TYPE[e.type]?.color}"></span> <span class="plat">${esc(TYPE[e.type]?.label || e.type)}</span> <a href="#" data-ent="${esc(e.id)}" class="mono">${esc(e.label)}</a></li>`).join('') || '<li class="muted">Brak</li>'}</ul></section>
  <section class="card"><h2>Reklamy (${r.ads.length})</h2><ul class="list">${r.ads.map(adRow).join('') || '<li class="muted">Brak</li>'}</ul></section></div>`;
  bindAdClicks(); bindEntityLinks();
}

$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) location.hash = `#/szukaj?q=${encodeURIComponent(q)}`; });

async function route() {
  const [path, qs] = location.hash.slice(1).split('?');
  const parts = (path || '/panel').split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === parts[0] || (parts[0] === 'ad' && a.dataset.v === 'kolejka')));
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  view.innerHTML = '<p class="muted">Ładowanie…</p>';
  try {
    switch (parts[0]) {
      case 'mapa': return await vMap(params);
      case 'kolejka': return await vQueue();
      case 'kampanie': return await vCampaigns(parts[1]);
      case 'zmiany': return await vTimeline();
      case 'dodaj': return vAdd();
      case 'wagi': return await vWeights();
      case 'ad': return await vAd(parts[1]);
      case 'szukaj': return await vSearch(params.get('q') || '');
      default: return await vPanel();
    }
  } catch (e) { view.innerHTML = `<div class="card"><b>Błąd:</b> ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
route();
