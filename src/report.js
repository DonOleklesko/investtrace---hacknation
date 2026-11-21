// Raport analityczny (HTML do druku / „Zapisz jako PDF” w przeglądarce)
import { evidenceManifest } from './api.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pl-PL', { timeZone: 'UTC' }) + ' UTC' : '—');

export function renderReport(caseId) {
  const m = evidenceManifest(caseId);
  if (!m) return null;
  const sig = m.risk.signals.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.weight > 0 ? '+' : ''}${s.weight}</td><td>${esc(s.detail)}</td></tr>`).join('');
  const steps = (m.journey?.steps || []).map((s, i) => `<li><b>${i + 1}. ${esc(s.domain)}</b> <span class="muted">(${esc(s.via)}${s.http_status ? ', HTTP ' + s.http_status : ''})</span><br>
    <span class="mono">${esc(s.url)}</span>${s.title ? `<br>Tytuł: „${esc(s.title)}”` : ''}
    ${s.forms.length ? `<br>Formularz: ${esc(s.forms.map((f) => f.fields.join(', ')).join(' | '))}` : ''}
    ${s.trackers.length ? `<br>Trackery: <span class="mono">${esc(s.trackers.join(', '))}</span>` : ''}
    ${s.contacts.length ? `<br>Kontakty: <span class="mono">${esc(s.contacts.map((c) => c.value).join(', '))}</span>` : ''}</li>`).join('');
  const ev = m.evidence.map((e) => `<tr><td>#${e.id}</td><td>${esc(e.kind)}</td><td>${esc(e.reason)}</td><td>${esc(e.source)}</td><td>${fmt(e.created_at)}</td><td class="mono">${e.sha256.slice(0, 16)}…</td></tr>`).join('');
  const acts = m.actions.map((a) => `<li>${fmt(a.created_at)} – ${esc(a.actor)}: ${esc(a.from_status)} → ${esc(a.to_status)} ${a.note ? '– ' + esc(a.note) : ''}</li>`).join('') || '<li>Brak działań analityka.</li>';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raport InvestTrace – sprawa #${m.case.id}</title>
<style>
 body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#1d232b;max-width:900px;margin:24px auto;padding:0 16px;background:#fff}
 h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #d8dde3;padding-bottom:4px}
 .muted{color:#5c6773} .mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
 .disc{background:#fff6e0;border:1px solid #f0d48a;padding:10px 12px;border-radius:6px;margin:12px 0}
 .score{display:inline-block;font-size:28px;font-weight:700;padding:4px 12px;border-radius:6px;background:#fde3e1;color:#a3221b}
 table{border-collapse:collapse;width:100%} td,th{border-bottom:1px solid #e7eaee;padding:6px;text-align:left;vertical-align:top} .num{text-align:right;white-space:nowrap}
 blockquote{margin:0;padding:8px 12px;background:#f4f6f8;border-left:3px solid #9aa5b1}
 @media print{.noprint{display:none} body{margin:0}}
</style></head><body>
<p class="noprint"><button onclick="print()">Drukuj / zapisz jako PDF</button></p>
<h1>Raport InvestTrace – sprawa #${m.case.id}</h1>
<div class="muted">Wygenerowano ${fmt(m.generated_at)} · Status: <b>${esc(m.case.status)}</b>${m.case.assignee ? ' · Analityk: ' + esc(m.case.assignee) : ''}</div>
<div class="disc"><b>Zastrzeżenie:</b> ${esc(m.disclaimer)} Ocena ma charakter pomocniczy i wymaga weryfikacji przez analityka.</div>
<h2>1. Podsumowanie</h2>
<p><span class="score">${m.risk.score}/100</span> &nbsp; poziom ryzyka: <b>${esc(m.risk.level)}</b> <span class="muted">(suma wag sygnałów: ${m.risk.points} pkt; wynik = 100·(1−e<sup>−pkt/60</sup>))</span></p>
<p>Reklama #${m.ad.id} na platformie <b>${esc(m.ad.platform)}</b>, konto: <b>${esc(m.ad.advertiser)}</b>, wykryta ${fmt(m.ad.detected_at)}.</p>
<blockquote>${esc(m.ad.text)}</blockquote>
<h2>2. Uzasadnienie oceny – sygnały ryzyka</h2>
<table><tr><th>Sygnał</th><th class="num">Waga</th><th>Dowód / szczegóły</th></tr>${sig}</table>
<h2>3. Ścieżka inwestora</h2>
${m.journey ? `${m.journey.cloaking ? `<p><b>Wykryto cloaking:</b> ${esc(m.journey.cloaking_note)}</p>` : ''}<ol style="list-style:none;padding:0">${steps}</ol>` : '<p class="muted">Brak zarejestrowanej ścieżki przekierowań.</p>'}
<h2>4. Działania analityka</h2><ul>${acts}</ul>
<h2>5. Rejestr dowodów (append-only, SHA-256)</h2>
<table><tr><th>ID</th><th>Rodzaj</th><th>Powód</th><th>Źródło</th><th>Data</th><th>SHA-256</th></tr>${ev}</table>
<p class="muted">Pełna paczka dowodowa (manifest JSON z treścią dowodów): <span class="mono">/api/cases/${m.case.id}/evidence.json</span></p>
</body></html>`;
}
