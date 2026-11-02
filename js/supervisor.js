// Supervisor dashboard (designed for a laptop; works on phones too)
import { call, session } from './api.js';
import { esc, icon, toast, modal, busy, confirmBox, banner, avatar, doseStatusChip, fmtTime, fmtDate, fmtShort, fmtDT, ago, download, $, $$ } from './ui.js';
import { LGA_NAME } from './config.js';
import { childDetailHtml } from './vaccinator.js';

export const nav = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'vaccinators', label: 'Vaccinators', icon: 'users' },
  { key: 'activity', label: 'Activity feed', short: 'Activity', icon: 'activity' },
  { key: 'flags', label: 'Flagged records', short: 'Flags', icon: 'flag', badge: true },
  { key: 'children', label: 'Child registry', short: 'Children', icon: 'child' },
  { key: 'stock', label: 'Vaccine stock', short: 'Stock', icon: 'box' },
  { key: 'defaulters', label: 'Defaulters', icon: 'clock' },
  { key: 'reports', label: 'Reports & DHIS2', short: 'Reports', icon: 'file' },
  { key: 'demo', label: 'Demo & help', short: 'Demo', icon: 'help' },
];
export const parent = { review: 'flags' };

export async function refreshBadge(setBadge) {
  try { const c = await call('imt_sup_counts'); setBadge('flags', c.open_flags); } catch (e) {}
}

const live = (fn, ms = 12000) => {
  const t = setInterval(() => { if (!document.querySelector('.modal-bg') && document.visibilityState === 'visible') fn(); }, ms);
  return () => clearInterval(t);
};
const typeChip = (t) => `<span class="chip ${{ Dose: 'blue', Registration: 'green', Review: 'amber', Outreach: '', Reminder: '' }[t] || ''}">${esc(t)}</span>`;
const pct = (v) => (v == null ? '—' : v + '%');
const rateMeter = (v) => `<div style="display:flex;align-items:center;gap:10px"><div class="meter ${v < 70 ? 'red' : v < 85 ? 'amber' : ''}" style="flex:1"><i style="width:${v || 0}%"></i></div><b class="num" style="width:40px;text-align:right">${pct(v)}</b></div>`;

function flagTable(list, empty = 'No flagged records. Every dose this week passed verification.') {
  if (!list.length) return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Record</th><th>Child</th><th>Facility</th><th>Vaccinator</th><th>Vaccine</th><th>Reason</th><th>Status</th></tr></thead><tbody>
    ${list.map((d) => `<tr class="click" data-dose="${d.id}"><td class="mono small">${esc(d.uid)}<div class="faint">${fmtShort(d.captured_at)}</div></td><td>${esc(d.child)}</td><td class="small">${esc(d.facility)}</td><td>${esc(d.vaccinator)}</td><td>${esc(d.label)}</td>
      <td class="small">${esc(d.flags?.[0]?.text || '')}${d.flags?.length > 1 ? ` <span class="chip">+${d.flags.length - 1}</span>` : ''}</td><td>${doseStatusChip(d)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
const bindDoseRows = (root) => $$('[data-dose]', root).forEach((r) => (r.onclick = () => { location.hash = '#/review/' + r.dataset.dose; }));

// =====================================================================
// OVERVIEW
// =====================================================================
async function overview(main) {
  const draw = async () => {
    const d = await call('imt_sup_overview');
    const max = Math.max(1, ...d.chart.map((c) => c.reported));
    const days = d.chart.map((c) => new Date(c.day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }));
    main.innerHTML = `
      <div class="page-head"><div><h1>${esc(LGA_NAME)} — Supervisor overview</h1><p>Last 7 days · <span class="conn"><span class="dot green"></span>live, updated ${fmtTime(new Date())}</span></p></div>
        <div class="head-actions"><a class="btn primary" href="#/activity">View live activity</a></div></div>
      <div class="kpis">
        <div class="kpi ${d.verification_rate < 80 ? 'amber' : ''}"><div class="v">${pct(d.verification_rate)}</div><div class="l">Data verification rate</div></div>
        <div class="kpi"><div class="v">${d.doses_week.toLocaleString()}</div><div class="l">Doses this week · ${d.doses_today} today</div></div>
        <div class="kpi"><div class="v">${d.online}/${d.vaccinators}</div><div class="l">Vaccinators online</div></div>
        <div class="kpi ${d.open_flags ? 'red' : 'green'}"><div class="v">${d.open_flags}</div><div class="l">Open flags</div></div>
        <div class="kpi"><div class="v">${pct(d.lasra_coverage)}</div><div class="l">LASRA ID coverage · ${d.children} children</div></div>
        <div class="kpi ${d.unsynced ? 'amber' : ''}"><div class="v">${d.unsynced}</div><div class="l">Unsynced records</div></div>
      </div>
      <div class="grid g-main">
        <div class="card"><div class="card-head"><h3>Reported vs verified doses</h3><div class="legend"><span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>Reported</span><span><i style="background:var(--accent)"></i>Verified</span></div></div>
          <div class="bars">${d.chart.map((c, i) => `<div class="day" title="${fmtDate(c.day)}: ${c.reported} reported, ${c.verified} verified"><div class="pair">
            <div class="bar rep" style="height:${(100 * c.reported) / max}%"></div><div class="bar ver" style="height:${(100 * c.verified) / max}%"></div></div><div class="lbl">${days[i]}</div></div>`).join('')}</div></div>
        <div class="card"><h3>Alerts</h3>${d.alerts.length ? d.alerts.slice(0, 8).map((a) => `<div class="alert-row"><span class="chip ${a.level === 'Urgent' ? 'red' : 'amber'}">${a.level}</span><div>${esc(a.text)}</div></div>`).join('') : '<div class="empty">No alerts.</div>'}</div>
      </div>
      <div class="grid g-main" style="margin-top:16px">
        <div class="card"><div class="card-head"><h3>Live vaccinator activity</h3><a class="small" href="#/activity">All activity</a></div>
          <div class="list feed">${d.activity.map((a) => `<div class="li"><span class="time">${fmtTime(a.at)}</span><div class="grow"><b>${esc(a.who)}</b> · ${esc(a.text)}</div></div>`).join('') || '<div class="empty">No activity yet.</div>'}</div></div>
        <div class="card"><h3>Facility verification rate</h3>${d.facilities.map((f) => `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between" class="small"><span>${esc(f.name)}</span><span class="faint">${f.doses} doses</span></div>${rateMeter(f.rate)}</div>`).join('')}</div>
      </div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h3>Latest flagged records</h3><a class="small" href="#/flags">All flags</a></div>${flagTable(d.flags)}</div>`;
    bindDoseRows(main);
  };
  await draw();
  return live(() => draw().catch(() => {}), 15000);
}

// =====================================================================
// VACCINATORS
// =====================================================================
async function vaccinators(main) {
  const draw = async () => {
    const list = await call('imt_sup_vaccinators');
    main.innerHTML = `<div class="page-head"><div><h1>Vaccinators</h1><p>Performance and data quality by field worker · select one for detail</p></div></div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Facility</th><th>Status</th><th class="r">Doses</th><th class="r">Children reg.</th><th style="min-width:150px">Verified</th><th class="r">OTP rate</th><th class="r">Open flags</th><th>Last active</th></tr></thead><tbody>
      ${list.map((v) => `<tr class="click" data-v="${v.id}" data-name="${esc(v.name)}"><td><b>${esc(v.name)}</b><div class="faint small mono">${esc(v.username)}</div></td><td class="small">${esc(v.facility)}</td>
        <td>${v.online ? `<span class="chip green"><span class="dot green"></span>Online${v.pending ? ` · ${v.pending} unsynced` : ''}</span>` : `<span class="chip ${v.pending ? 'amber' : ''}">Offline${v.pending ? ` · ${v.pending} unsynced` : ''}</span>`}${v.outreach ? `<div class="faint small" style="margin-top:4px">In the field · ${esc(v.outreach)}</div>` : ''}</td>
        <td class="r num">${v.doses}</td><td class="r num">${v.children}</td><td>${rateMeter(v.verified_rate)}</td><td class="r num">${pct(v.otp_rate)}</td><td class="r num">${v.open_flags ? `<span class="chip red">${v.open_flags}</span>` : '0'}</td><td class="small">${ago(v.last_seen)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    $$('[data-v]', main).forEach((r) => (r.onclick = () => vaccinatorDetail(+r.dataset.v, r.dataset.name)));
  };
  await draw();
  return live(() => draw().catch(() => {}), 20000);
}

async function vaccinatorDetail(id, name) {
  const m = modal({ title: esc(name), wide: true, body: '<div class="empty">Loading…</div>' });
  const acts = await call('imt_sup_activity', { p_vaccinator: id });
  m.el.querySelector('.modal-b').innerHTML = `<div class="list feed">${acts.slice(0, 60).map((a) => `<div class="li"><span class="time" style="width:90px">${fmtShort(a.at)}</span><div class="grow">${typeChip(a.type)} ${esc(a.text)}</div></div>`).join('') || '<div class="empty">No activity.</div>'}</div>`;
}

// =====================================================================
// ACTIVITY FEED
// =====================================================================
async function activity(main) {
  const vs = await call('imt_sup_vaccinators');
  let who = '', type = '';
  main.innerHTML = `<div class="page-head"><div><h1>Activity feed</h1><p>Every sign-in, registration, dose, sync and review event · <span class="conn"><span class="dot green"></span>live</span></p></div>
      <div class="head-actions"><select class="input" id="f-who" style="width:auto"><option value="">All vaccinators</option>${vs.map((v) => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      <select class="input" id="f-type" style="width:auto"><option value="">All types</option>${['Dose', 'Registration', 'Outreach', 'Sign-in', 'Review', 'Reminder', 'Report'].map((t) => `<option>${t}</option>`).join('')}</select></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Time</th><th>Who</th><th>Type</th><th>Activity</th></tr></thead><tbody id="feed"></tbody></table></div></div>`;
  const draw = async () => {
    const list = await call('imt_sup_activity', { p_vaccinator: who ? +who : null, p_type: type || null });
    $('#feed').innerHTML = list.map((a) => `<tr><td class="num small" style="white-space:nowrap">${fmtShort(a.at)}</td><td>${esc(a.who)}</td><td>${typeChip(a.type)}</td><td class="small">${esc(a.text)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No activity.</td></tr>';
  };
  $('#f-who').onchange = (e) => { who = e.target.value; draw(); };
  $('#f-type').onchange = (e) => { type = e.target.value; draw(); };
  await draw();
  return live(() => draw().catch(() => {}), 8000);
}

// =====================================================================
// FLAGGED RECORDS
// =====================================================================
async function flags(main, [tab = 'open']) {
  const d = await call('imt_sup_flags', { p_status: tab });
  main.innerHTML = `<div class="page-head"><div><h1>Flagged records</h1><p>Select a record to open its evidence and audit trail</p></div>
      <div class="head-actions"><a class="btn ${tab === 'open' ? 'primary' : ''}" href="#/flags/open">Open (${tab === 'open' ? d.doses.length : '…'})</a><a class="btn ${tab === 'all' ? 'primary' : ''}" href="#/flags/all">All reviewed</a></div></div>
    <div class="card">${flagTable(d.doses, tab === 'open' ? 'No open flags. 🎉' : 'Nothing reviewed yet.')}</div>
    <div class="card"><div class="card-head"><h3>Stock reconciliation flags</h3><a class="small" href="#/stock">Vaccine stock</a></div>
      ${d.outreach.length ? d.outreach.map((o) => `<div class="alert-row"><span class="chip red">Stock</span><div><b>${esc(o.vaccinator)}</b> · ${esc(o.community)} · closed ${fmtShort(o.closed_at)}<ul class="flag-list" style="margin-top:6px">${o.recon_flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul></div></div>`).join('') : '<div class="empty">No vial discrepancies.</div>'}</div>`;
  bindDoseRows(main);
}

// =====================================================================
// REVIEW ONE RECORD (evidence + audit trail)
// =====================================================================
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => resolve(window.L); s.onerror = reject; document.head.appendChild(s);
  });
  return leafletP;
}

async function review(main, [id]) {
  const r = await call('imt_sup_dose_detail', { p_dose: +id });
  const d = r.dose, c = r.child, it = r.integrity;
  const sealOk = it.hash_ok && it.chain_ok && it.photo_ok;
  const closed = d.status === 'voided';
  main.innerHTML = `
    <div class="page-head"><div><h1>${esc(d.label)} · ${esc(d.child)}</h1><p><span class="mono">${esc(d.uid)}</span> · ${fmtDT(d.captured_at)} · ${esc(d.vaccinator)}, ${esc(d.facility)}</p></div>
      <div class="head-actions">${doseStatusChip(d)}<a class="btn" href="#/flags">Back to flags</a></div></div>
    ${d.flags?.length ? banner(d.flag_status === 'open' ? 'red' : 'amber', `<b>${d.flag_status === 'open' ? 'Why this record was flagged' : 'Flags (reviewed)'}</b><ul class="flag-list" style="margin-top:8px">${d.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>`) : banner('green', 'This record passed every verification check.')}
    <div class="grid g-main">
      <div>
        <div class="card"><h3>Face match</h3>
          <div class="photo-pair" style="max-width:420px">
            <div><div class="photo-box">${c.photo ? `<img src="${esc(c.photo)}" alt="">` : 'No photo at registration'}</div><div class="cap">At registration · ${fmtDate(c.created_at)}</div></div>
            <div><div class="photo-box">${d.photo ? `<img src="${esc(d.photo)}" alt="">` : 'No photo at this dose'}</div><div class="cap">At this dose · ${fmtTime(d.captured_at)}</div></div>
          </div></div>
        <div class="card"><div class="card-head"><h3>Location evidence</h3>${d.distance_m != null ? `<span class="chip ${d.distance_m > 1000 ? 'red' : 'green'}">${d.distance_m > 1000 ? (d.distance_m / 1000).toFixed(1) + ' km' : d.distance_m + ' m'} from ${esc(r.site.name)}</span>` : '<span class="chip red">No GPS</span>'}</div>
          <div class="map" id="map"></div>
          <div class="small muted" style="margin-top:8px">Blue: ${esc(r.site.name)}${r.site.demo ? ' (demo site)' : ''} with 1 km geofence. ${d.lat != null ? `Red: where the dose was recorded (${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}${d.gps_accuracy ? ', ±' + Math.round(d.gps_accuracy) + ' m' : ''}).` : ''}</div></div>
        <div class="card"><h3>Record details</h3><div class="kv">
          <div><span>Child</span><b>${esc(c.name)}</b></div><div><span>ImmunTrack ID</span><b class="mono">${esc(c.uid)}</b></div>
          <div><span>Vaccine · dose</span><b>${esc(d.vaccine)} · ${d.dose_no}</b></div><div><span>Batch / lot</span><b class="mono">${esc(d.batch_no)}</b></div>
          <div><span>Site of administration</span><b>${esc(d.injection_site)}</b></div><div><span>Guardian OTP</span><b>${d.otp_status === 'verified' ? '✓ Confirmed by SMS code' : 'Not confirmed'}</b></div>
          <div><span>Captured</span><b>${fmtDT(d.captured_at)}</b></div><div><span>Received by server</span><b>${fmtDT(d.received_at)}${d.offline ? ' <span class="chip amber">offline sync</span>' : ''}</b></div>
          <div><span>Guardian</span><b>${esc(c.guardian_name || '—')} · ${esc(c.guardian_phone || '')}</b></div><div><span>LASRA ID</span><b>${esc(c.lasra_id || 'Not enrolled')}</b></div>
        </div></div>
        <div class="card"><h3>This child's dose history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Vaccine</th><th>By</th><th>Status</th></tr></thead><tbody>
          ${r.history.map((h) => `<tr class="${h.id === d.id ? '' : 'click'}" data-dose="${h.id}" style="${h.id === d.id ? 'background:var(--accent-soft)' : ''}"><td class="small">${fmtShort(h.captured_at)}</td><td>${esc(h.label)}</td><td class="small">${esc(h.vaccinator)}</td><td>${doseStatusChip(h)}</td></tr>`).join('')}
        </tbody></table></div></div>
      </div>
      <div>
        <div class="card"><h3>Integrity seal</h3>
          <div class="seal ${sealOk ? '' : 'bad'}">${sealOk ? icon.shield : icon.shieldX}<div><b>${sealOk ? 'Sealed record intact' : 'Seal check failed'}</b>
            <div class="small muted">${it.hash_ok ? '✓' : '✗'} content hash · ${it.chain_ok ? '✓' : '✗'} chain link · ${it.photo_ok ? '✓' : '✗'} photo fingerprint</div></div></div>
          <div class="label" style="margin:12px 0 4px">Seal (SHA-256)</div><div class="hash">${esc(d.hash)}</div>
          <div class="label" style="margin:10px 0 4px">Chained to previous record</div><div class="hash">${esc(d.prev_hash)}</div>
          <p class="small muted">Each record's seal includes the one before it, so changing any past record breaks every seal after it.</p>
          <button class="btn block" id="tamper">${icon.warn} Attempt direct edit (test the seal)</button>
          <div id="tamper-out" style="margin-top:10px"></div></div>
        <div class="card"><h3>Supervisor decision</h3>
          ${closed ? '<div class="empty">This record has been voided. No further changes.</div>' : `
          <p class="small muted" style="margin-top:-4px">Every decision is stored with your name, the time and your reason. The original sealed values are never overwritten.</p>
          <div class="field"><label>Reason (required)</label><textarea class="input" id="reason" rows="3" placeholder="e.g. Called guardian Babajide Arulogun; confirmed the child was vaccinated at the outreach point."></textarea></div>
          <details style="margin-bottom:12px"><summary class="small" style="cursor:pointer;color:var(--accent-2)">Amend fields</summary>
            <div class="row" style="margin-top:10px"><div class="field"><label>Dose #</label><input class="input" id="am-dose" type="number" min="0" value="${d.dose_no}"></div>
            <div class="field"><label>Site</label><select class="input" id="am-site">${['Left thigh', 'Right thigh', 'Left upper arm', 'Right upper arm', 'Oral'].map((s) => `<option ${s === d.injection_site ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div></details>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="accept">${icon.check} Accept</button><button class="btn" data-act="amend">Amend</button><button class="btn danger" data-act="void">Void record</button></div>`}
        </div>
        <div class="card"><h3>Audit trail</h3><div class="timeline">
          <div class="tl green"><b>Captured &amp; sealed</b> · ${fmtDT(d.received_at)}<div class="small muted">${esc(d.vaccinator)}${d.offline ? ' · synced from offline' : ''}</div></div>
          ${d.flags?.length ? `<div class="tl red"><b>Flagged automatically</b><div class="small muted">${d.flags.map((f) => esc(f.text)).join('<br>')}</div></div>` : ''}
          ${r.audit.map((a) => `<div class="tl ${a.action === 'blocked-edit' ? 'red' : a.action === 'void' ? 'red' : a.action === 'accept' || a.action === 'otp-confirmed' ? 'green' : 'amber'}"><b>${esc({ accept: 'Accepted', amend: 'Amended', void: 'Voided', 'blocked-edit': 'Direct edit blocked', 'otp-confirmed': 'Guardian confirmed late' }[a.action] || a.action)}</b> · ${fmtDT(a.at)}
            <div class="small muted">${esc(a.who || '')}${a.reason ? ' — “' + esc(a.reason) + '”' : ''}</div>
            ${a.before && a.after ? `<div class="small faint">${Object.keys(a.after).filter((k) => JSON.stringify(a.before[k]) !== JSON.stringify(a.after[k])).map((k) => `${esc(k)}: ${esc(a.before[k])} → ${esc(a.after[k])}`).join(' · ')}</div>` : ''}</div>`).join('')}
        </div></div>
      </div>
    </div>`;
  bindDoseRows(main);

  loadLeaflet().then((L) => {
    const el = $('#map'); if (!el) return;
    const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    const site = [r.site.lat, r.site.lng];
    L.circle(site, { radius: 1000, color: '#2f6fed', weight: 1, fillOpacity: 0.08 }).addTo(map);
    L.circleMarker(site, { radius: 8, color: '#2f6fed', fillColor: '#2f6fed', fillOpacity: 1 }).addTo(map).bindTooltip(r.site.name);
    const pts = [site];
    if (d.lat != null) {
      const p = [d.lat, d.lng]; pts.push(p);
      L.circleMarker(p, { radius: 8, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }).addTo(map).bindTooltip('Dose recorded here');
      L.polyline(pts, { color: '#ef4444', dashArray: '4 6', weight: 2 }).addTo(map);
    }
    map.fitBounds(L.latLngBounds(pts).pad(0.6), { maxZoom: 15 });
  }).catch(() => { const el = $('#map'); if (el) el.innerHTML = '<div class="empty">Map could not load.</div>'; });

  $('#tamper').onclick = async (e) => {
    const tb = e.currentTarget;
    busy(tb, true, 'Trying to edit…');
    try {
      const t = await call('imt_tamper_test', { p_dose: d.id });
      $('#tamper-out').innerHTML = banner(t.blocked ? 'green' : 'red', `<b>${t.blocked ? 'Blocked by the database.' : 'Not blocked!'}</b> ${esc(t.message)}`);
      setTimeout(() => review(main, [id]), 2500);
    } catch (err) { toast(err.message, 'err'); }
    busy(tb, false);
  };
  $$('[data-act]', main).forEach((b) => (b.onclick = async () => {
    const act = b.dataset.act, reason = $('#reason').value.trim();
    if (reason.length < 10) { toast('Write a reason of at least 10 characters.', 'err'); $('#reason').focus(); return; }
    if (act === 'void' && !(await confirmBox('Void this record?', 'The dose will no longer count in coverage or stock. The sealed original stays in the audit trail.', 'Void record', true))) return;
    const changes = act === 'amend' ? { dose_no: +$('#am-dose').value, injection_site: $('#am-site').value } : {};
    busy(b, true, 'Saving…');
    try { await call('imt_sup_action', { p_dose: d.id, p_action: act, p_reason: reason, p_changes: changes }); toast('Decision recorded in the audit trail.', 'ok'); review(main, [id]); }
    catch (err) { toast(err.message, 'err'); busy(b, false); }
  }));
}

// =====================================================================
// CHILD REGISTRY
// =====================================================================
async function children(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Child registry</h1><p>Search any child by ImmunTrack ID, LASRA ID, birth certificate, name or guardian phone</p></div></div>
    <div class="card"><div class="field"><input class="input" id="cq" type="search" placeholder="e.g. IMT-LAG-AL-08841, LASRA-2026-…, Babajide Arulogun"></div><div id="cr" class="table-wrap"></div></div>`;
  let t;
  const run = async () => {
    const list = await call('imt_find_children', { p_q: $('#cq').value });
    $('#cr').innerHTML = list.length ? `<table><thead><tr><th>Child</th><th>ImmunTrack ID</th><th>LASRA ID</th><th>Facility</th><th>Registered by</th><th>Next due</th></tr></thead><tbody>
      ${list.map((c) => `<tr class="click" data-c="${c.id}"><td><div style="display:flex;gap:10px;align-items:center">${avatar(c.name, c.photo)}<div><b>${esc(c.name)}</b><div class="small faint">${esc(c.sex || '')} · born ${fmtDate(c.dob)}</div></div></div></td>
        <td class="mono small">${esc(c.uid)}</td><td class="small">${c.lasra_id ? esc(c.lasra_id) : '<span class="chip amber">None</span>'}</td><td class="small">${esc(c.facility)}</td><td class="small">${esc(c.registered_by || '')}</td>
        <td>${c.next ? `<span class="chip ${c.next.status === 'overdue' ? 'red' : c.next.status === 'due' ? 'amber' : ''}">${esc(c.next.label)} · ${fmtDate(c.next.due)}</span>` : '<span class="chip green">Complete</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No children match.</div>';
    $$('[data-c]', main).forEach((r) => (r.onclick = () => openChild(+r.dataset.c)));
  };
  $('#cq').oninput = () => { clearTimeout(t); t = setTimeout(run, 280); };
  await run();
}

async function openChild(id) {
  const m = modal({ title: 'Child record', wide: true, body: '<div class="empty">Loading…</div>' });
  const c = await call('imt_child_card', { p_child: id });
  m.el.querySelector('.modal-b').innerHTML = childDetailHtml(c);
  $$('tbody tr', m.el).forEach((tr, i) => { tr.classList.add('click'); tr.onclick = () => { m.close(); location.hash = '#/review/' + c.doses[i].id; }; });
}

// =====================================================================
// VACCINE STOCK
// =====================================================================
async function stock(main) {
  const s = await call('imt_sup_stock');
  main.innerHTML = `<div class="page-head"><div><h1>Vaccine stock</h1><p>Doses deplete as vaccinators record · every vaccine box is reconciled at close of work</p></div></div>
    <div class="card"><h3>Batches</h3><div class="table-wrap"><table><thead><tr><th>Vaccine</th><th>Batch</th><th class="r">Received</th><th class="r">Given (verified + pending)</th><th class="r">In the field now</th><th class="r">Doses left</th><th>Expiry</th><th>Status</th></tr></thead><tbody>
      ${s.batches.map((b) => `<tr><td>${esc(b.vaccine)}</td><td class="mono small">${esc(b.batch_no)}</td><td class="r num">${b.received}</td><td class="r num">${b.used}</td><td class="r num">${b.in_field || '—'}</td><td class="r num"><b>${b.left}</b></td><td class="small">${fmtDate(b.expiry)}</td>
        <td><span class="chip ${b.status === 'OK' ? 'green' : /Low|Expired/.test(b.status) ? 'red' : 'amber'}">${esc(b.status)}</span></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card"><div class="card-head"><h3>Outreach sessions · vaccine box reconciliation</h3></div>
      <p class="small muted" style="margin-top:-6px">Empty vials returned × doses per vial should roughly equal doses recorded. A large gap means vials were opened but children were not recorded — or vials were emptied to fake usage.</p>
      ${s.sessions.length ? `<div class="table-wrap"><table><thead><tr><th>Vaccinator</th><th>Community</th><th>Started</th><th>Status</th><th>Box</th><th>Result</th></tr></thead><tbody>
        ${s.sessions.map((o) => `<tr><td>${esc(o.vaccinator)}</td><td>${esc(o.community)}${o.demo_site ? ' <span class="chip amber">demo site</span>' : ''}</td><td class="small">${fmtShort(o.started_at)}</td>
          <td>${o.status === 'open' ? '<span class="chip green">In the field</span>' : `<span class="chip">Closed ${fmtTime(o.closed_at)}</span>`}</td>
          <td class="small">${o.items.map((i) => `${esc(i.vaccine)}: ${i.vials_issued} vial${i.vials_issued === 1 ? '' : 's'}, ${i.doses_recorded} dose${i.doses_recorded === 1 ? '' : 's'}${i.vials_empty != null ? `, ${i.vials_empty} empty back` : ''}`).join('<br>')}</td>
          <td class="small">${o.status === 'open' ? '—' : o.recon_flags?.length ? `<ul class="flag-list">${o.recon_flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : '<span class="chip green">Reconciled</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No outreach sessions yet.</div>'}</div>`;
}

// =====================================================================
// DEFAULTERS
// =====================================================================
async function defaulters(main) {
  const d = await call('imt_sup_defaulters');
  main.innerHTML = `<div class="page-head"><div><h1>Defaulter tracker</h1><p>Children overdue for a scheduled dose · reminders go to the guardian by SMS</p></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Child</th><th>LASRA ID</th><th>Due</th><th class="r">Days overdue</th><th>Facility</th><th>Guardian</th><th></th></tr></thead><tbody>
      ${d.children.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="mono small faint">${esc(c.uid)}</div></td><td class="small">${c.lasra_id ? esc(c.lasra_id) : '<span class="faint">None</span>'}</td>
        <td>${esc(c.next.label)}${c.overdue_count > 1 ? ` <span class="chip">+${c.overdue_count - 1} more</span>` : ''}</td><td class="r num"><span class="chip ${c.days_overdue > 28 ? 'red' : 'amber'}">${c.days_overdue} days</span></td>
        <td class="small">${esc(c.facility)}</td><td class="small">${esc(c.guardian_name || '')}<div class="faint">${esc(c.guardian_phone || '')}</div></td>
        <td class="r"><button class="btn sm" data-remind="${c.id}">${icon.sms} ${c.last_reminder ? 'Remind again' : 'Send reminder'}</button>${c.last_reminder ? `<div class="tiny faint">sent ${ago(c.last_reminder)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No defaulters. Every child is up to date.</td></tr>'}
    </tbody></table></div></div>
    <div class="card"><div class="card-head"><h3>SMS outbox</h3><span class="chip amber">Simulated — connects to an SMS gateway (e.g. Termii) in production</span></div>
      <div class="list">${d.sms.map((s) => `<div class="li" style="align-items:flex-start"><span class="time" style="width:90px;font-size:12.5px;color:var(--muted)">${fmtShort(s.at)}</span><div class="grow"><div class="small"><span class="chip">${esc({ otp: 'OTP', reminder: 'Defaulter reminder', 'reminder-scheduled': 'Next-dose reminder' }[s.kind] || s.kind)}</span> to ${esc(s.to)} · ${esc(s.child || '')}</div><div class="small muted" style="margin-top:4px">${esc(s.message)}</div></div></div>`).join('') || '<div class="empty">No messages yet.</div>'}</div></div>`;
  $$('[data-remind]', main).forEach((b) => (b.onclick = async () => {
    busy(b, true, 'Sending…');
    try { const r = await call('imt_send_reminder', { p_child: +b.dataset.remind }); toast('Reminder sent to ' + r.to, 'ok'); defaulters(main); }
    catch (err) { toast(err.message, 'err'); busy(b, false); }
  }));
}

// =====================================================================
// REPORTS & DHIS2
// =====================================================================
async function reports(main, [month]) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  month = month || months[0];
  const r = await call('imt_sup_report', { p_month: month });
  const facilities = [...new Set(r.rows.map((x) => x.facility))];
  const byLabel = {};
  r.rows.forEach((x) => { const k = x.label; byLabel[k] = byLabel[k] || { label: k, vaccine: x.vaccine, dose_no: x.dose_no, reported: 0, verified: 0 }; byLabel[k].reported += x.reported; byLabel[k].verified += x.verified; });
  const agg = Object.values(byLabel);
  const tot = agg.reduce((a, x) => ({ reported: a.reported + x.reported, verified: a.verified + x.verified }), { reported: 0, verified: 0 });
  const rate = tot.reported ? Math.round((100 * tot.verified) / tot.reported) : null;
  const monthName = new Date(month + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  main.innerHTML = `<div class="page-head"><div><h1>Reports &amp; DHIS2</h1><p>Only verified records flow into official reporting</p></div>
      <div class="head-actions"><select class="input" id="rm" style="width:auto">${months.map((m) => `<option value="${m}" ${m === month ? 'selected' : ''}>${new Date(m + '-15').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>`).join('')}</select></div></div>
    <div class="card no-print"><div class="card-head"><h3>DHIS2 integration</h3><span class="chip green"><span class="dot green"></span>Ready · simulated</span></div>
      <p class="small muted" style="margin-top:-4px">Verified records are aggregated per facility and mapped to the national routine immunisation data elements, then pushed through the DHIS2 Web API (<span class="mono">/api/dataValueSets</span>). Live push needs Lagos State DHIS2 credentials; in this demo it produces the exact payload.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pdf">${icon.print} Generate PDF</button><button class="btn" id="csv">${icon.download} Export CSV</button><button class="btn primary" id="dhis">${icon.upload} Export to DHIS2</button></div></div>
    <div class="print-only"><h2>ImmunTrack · Monthly immunisation coverage — ${esc(LGA_NAME)}</h2><p>${esc(monthName)} · generated ${fmtDT(new Date())} by ${esc(session.user.full_name)}</p></div>
    <div class="kpis" style="margin-top:16px">
      <div class="kpi"><div class="v">${tot.reported}</div><div class="l">Doses reported · ${esc(monthName)}</div></div>
      <div class="kpi green"><div class="v">${tot.verified}</div><div class="l">Verified (sent to DHIS2)</div></div>
      <div class="kpi ${rate < 80 ? 'amber' : ''}"><div class="v">${pct(rate)}</div><div class="l">Verification rate</div></div>
      <div class="kpi"><div class="v">${tot.reported - tot.verified}</div><div class="l">Held back for review</div></div>
    </div>
    <div class="card"><h3>Monthly coverage — all ${esc(LGA_NAME)} facilities</h3><div class="table-wrap"><table><thead><tr><th>Antigen</th>${facilities.map((f) => `<th class="r">${esc(f)}</th>`).join('')}<th class="r">Reported</th><th class="r">Verified</th><th class="r">%</th></tr></thead><tbody>
      ${agg.filter((x) => x.reported).map((x) => `<tr><td>${esc(x.label)}</td>${facilities.map((f) => { const row = r.rows.find((y) => y.facility === f && y.label === x.label); return `<td class="r num">${row.verified}<span class="faint">/${row.reported}</span></td>`; }).join('')}<td class="r num">${x.reported}</td><td class="r num"><b>${x.verified}</b></td><td class="r num">${pct(Math.round((100 * x.verified) / x.reported))}</td></tr>`).join('') || `<tr><td colspan="${facilities.length + 4}" class="empty">No doses recorded in ${esc(monthName)}.</td></tr>`}
    </tbody></table></div><p class="small faint">Facility cells show verified / reported.</p></div>
    <div class="card no-print"><h3>Recent reports</h3><div class="table-wrap"><table><thead><tr><th>Report</th><th>Period</th><th class="r">Verification</th><th>Status</th><th>Date</th></tr></thead><tbody>
      ${r.reports.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.period)}</td><td class="r num">${pct(x.verification)}</td><td><span class="chip ${/Submitted/.test(x.status) ? 'green' : ''}">${esc(x.status)}</span></td><td class="small">${fmtDate(x.at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No reports yet.</td></tr>'}
    </tbody></table></div></div>`;

  $('#rm').onchange = (e) => { location.hash = '#/reports/' + e.target.value; };
  $('#pdf').onclick = () => { call('imt_save_report', { p_name: 'Monthly coverage — ' + LGA_NAME, p_period: monthName, p_verification: rate, p_status: 'PDF generated' }).catch(() => {}); window.print(); };
  $('#csv').onclick = () => {
    const lines = [['facility', 'antigen', 'vaccine', 'dose_no', 'reported', 'verified'].join(',')].concat(r.rows.filter((x) => x.reported).map((x) => [x.facility, x.label, x.vaccine, x.dose_no, x.reported, x.verified].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    download(`immuntrack-coverage-${month}.csv`, lines.join('\n'), 'text/csv');
    call('imt_save_report', { p_name: 'Coverage CSV — ' + LGA_NAME, p_period: monthName, p_verification: rate, p_status: 'CSV exported' }).catch(() => {});
  };
  $('#dhis').onclick = () => {
    const code = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const payload = {
      dataSet: 'IMT_RI_MONTHLY', period: month.replace('-', ''), completeDate: new Date().toISOString().slice(0, 10),
      dataValues: r.rows.filter((x) => x.verified > 0).map((x) => ({ orgUnit: 'LA_ALIMOSHO_' + code(x.facility), dataElement: `RI_${code(x.vaccine)}_${x.dose_no}`, categoryOptionCombo: 'default', value: String(x.verified) })),
    };
    const m = modal({ title: 'Export to DHIS2', wide: true,
      body: `${banner('blue', `<b>${payload.dataValues.length} data values</b> from ${tot.verified} verified doses for ${esc(monthName)}. ${tot.reported - tot.verified} unverified dose(s) are held back.`)}
        <div class="label" style="margin-bottom:6px">Payload · POST /api/dataValueSets</div>
        <pre class="mono" style="background:var(--field);border:1px solid var(--border);border-radius:8px;padding:12px;max-height:280px;overflow:auto;font-size:12px;margin:0">${esc(JSON.stringify(payload, null, 2))}</pre>
        <p class="small faint">Data element and organisation unit codes are placeholders, mapped to the Lagos State DHIS2 instance at deployment.</p>
        <div id="push-out"></div>`,
      foot: `<button class="btn" id="dl">${icon.download} Download JSON</button><button class="btn primary" id="push">${icon.upload} Push now</button>` });
    m.el.querySelector('#dl').onclick = () => download(`dhis2-${month}.json`, JSON.stringify(payload, null, 2), 'application/json');
    m.el.querySelector('#push').onclick = async (e) => {
      const pb = e.currentTarget;
      busy(pb, true, 'Pushing…');
      await new Promise((res) => setTimeout(res, 1100));
      await call('imt_save_report', { p_name: 'Monthly coverage — ' + LGA_NAME, p_period: monthName, p_verification: rate, p_status: 'Submitted to DHIS2 (simulated)' }).catch(() => {});
      m.el.querySelector('#push-out').innerHTML = banner('green', `<b>Import summary (simulated):</b> status SUCCESS · imported ${payload.dataValues.length} · updated 0 · ignored 0`);
      busy(pb, false); pb.textContent = 'Pushed'; pb.disabled = true;
    };
  };
}

// =====================================================================
// DEMO & HELP
// =====================================================================
async function demo(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Demo &amp; help</h1><p>For the competition judges and the team</p></div></div>
    <div class="grid g2">
      <div class="card"><h3>Demo accounts</h3><div class="table-wrap"><table><thead><tr><th>Role</th><th>Username</th><th>PIN</th><th>Facility</th></tr></thead><tbody>
        <tr><td>Vaccinator</td><td class="mono">sbello</td><td class="mono">1234</td><td>Igando HC</td></tr>
        <tr><td>Vaccinator</td><td class="mono">rojo</td><td class="mono">1234</td><td>Egbeda Model PHC</td></tr>
        <tr><td>Vaccinator</td><td class="mono">ayusuf</td><td class="mono">1234</td><td>Ikotun-Egbe PHC</td></tr>
        <tr><td>Vaccinator</td><td class="mono">fadeyemi</td><td class="mono">1234</td><td>Ikotun-Egbe PHC</td></tr>
        <tr><td>Supervisor</td><td class="mono">supervisor</td><td class="mono">2026</td><td>${esc(LGA_NAME)}</td></tr></tbody></table></div>
        <button class="btn block" style="margin-top:12px" id="guide">${icon.help} Step-by-step testing guide</button></div>
      <div class="card"><h3>What is real and what is simulated</h3>
        <div class="label" style="margin-bottom:6px">Real in this demo</div>
        <p class="small" style="margin-top:0">Unique child IDs with QR, face photos, live GPS with geofence, sealed and hash-chained dose records, tamper blocking, 15 automatic checks on every dose plus 4 vial checks on every vaccine box, offline capture and sync, next-dose scheduling, defaulter tracking, supervisor review with audit trail, CSV and DHIS2 payload export.</p>
        <div class="label" style="margin-bottom:6px">Simulated</div>
        <p class="small" style="margin-top:0">SMS delivery (the message shows on screen), LASRA and birth-certificate lookups, the live DHIS2 push. Fingerprints are Phase 2.</p></div>
    </div>
    <div class="card"><h3>Reset demo data</h3><p class="small muted" style="margin-top:-4px">Deletes every record the testers created and reloads fresh sample Alimosho data dated to this week (do this the day before judging so the charts look current). Everyone is signed out.</p>
      <button class="btn danger" id="reset">Reset all demo data</button></div>`;
  $('#guide').onclick = () => import('./app.js').then((m) => m.showGuide());
  $('#reset').onclick = async (e) => {
    if (!(await confirmBox('Reset all demo data?', 'This deletes every child, dose and session created by testers, and signs everyone out. It cannot be undone.', 'Reset everything', true))) return;
    const rb = e.currentTarget;
    busy(rb, true, 'Resetting…');
    try { await call('imt_reset_demo'); session.clear(); toast('Demo data reset. Please sign in again.', 'ok'); setTimeout(() => location.replace(location.pathname), 1200); }
    catch (err) { toast(err.message, 'err'); busy(rb, false); }
  };
}

export const pages = { overview, vaccinators, activity, flags, review, children, stock, defaulters, reports, demo };
