// Vaccinator app (designed for a phone in the field)
import { call, session, queue, cache, syncQueue, loadReference, getPosition, distanceM, store } from './api.js';
import { esc, icon, toast, modal, busy, confirmBox, banner, avatar, doseStatusChip, fmtTime, fmtDate, fmtShort, fmtDT, ageText, todayISO, uuid, qrSvg, $, $$ } from './ui.js';
import { captureFace } from './camera.js';

export const nav = [
  { key: 'today', label: 'Today', icon: 'home' },
  { key: 'register', label: 'Register child', short: 'Register', icon: 'userPlus' },
  { key: 'record', label: 'Record vaccination', short: 'Vaccinate', icon: 'syringe' },
  { key: 'find', label: 'Find child', short: 'Find', icon: 'search' },
  { key: 'activity', label: 'My activity', short: 'Activity', icon: 'activity' },
];
export const parent = {};

const user = () => session.user;
const visitOtp = {}; // childId -> { code, at } : one guardian code covers the whole visit
const SITES = ['Left thigh', 'Right thigh', 'Left upper arm', 'Right upper arm', 'Oral'];

async function getHome() {
  try { const h = await call('imt_vaccinator_home'); cache.setHome(h); return { home: h, offline: false }; }
  catch (e) { if (e.offline && cache.home()) return { home: cache.home(), offline: true }; throw e; }
}

function siteRef(home, ref) {
  const o = home?.outreach;
  if (o) return { lat: o.site_lat, lng: o.site_lng, name: 'planned site ' + o.community };
  const f = (ref?.facilities || []).find((x) => x.id === user().facility_id);
  return f ? { lat: f.lat, lng: f.lng, name: f.name } : null;
}

// =====================================================================
// TODAY
// =====================================================================
async function today(main) {
  const [{ home, offline }, ref] = await Promise.all([getHome(), loadReference()]);
  const o = home.outreach;
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 16 ? 'Good afternoon' : 'Good evening';
  main.innerHTML = `
    <div class="page-head"><div><h1>${greet}, ${esc(user().full_name)}</h1><p>${esc(user().facility)} · ${fmtDate(new Date())}</p></div>
      <div class="head-actions"><a class="btn" href="#/register">${icon.userPlus} Register child</a><a class="btn primary" href="#/record">${icon.syringe} Record vaccination</a></div></div>
    ${offline ? banner('amber', 'You are offline. Showing the last saved view; new records are kept on this phone until the network returns.', icon.wifiOff) : ''}
    <div class="kpis">
      <div class="kpi"><div class="v">${home.doses_today}</div><div class="l">Doses today</div></div>
      <div class="kpi ${home.doses_flagged_today ? 'red' : ''}"><div class="v">${home.doses_flagged_today}</div><div class="l">Flagged today</div></div>
      <div class="kpi"><div class="v">${home.children_today}</div><div class="l">Children registered today</div></div>
      <div class="kpi ${queue.count ? 'amber' : ''}"><div class="v">${queue.count}</div><div class="l">Waiting to sync</div></div>
    </div>
    <div class="grid g-main">
      <div class="card" id="outreach-card">${o ? outreachOpenHtml(o) : outreachNoneHtml(home)}</div>
      <div class="card"><div class="card-head"><h3>Recent records</h3><a class="small" href="#/activity">See all</a></div>
        <div class="list">${recentList(home.recent.slice(0, 6))}</div></div>
    </div>`;
  const oc = $('#outreach-card');
  oc.querySelector('[data-start]')?.addEventListener('click', () => startOutreach(ref));
  oc.querySelector('[data-close-session]')?.addEventListener('click', () => closeOutreach(o));
  bindRecent(main);
}

function outreachNoneHtml(home) {
  const lc = home.last_closed;
  return `<div class="card-head"><h3>Outreach session</h3><span class="chip">Not started</span></div>
    <p class="muted" style="margin-top:0">Start each outreach by recording the vaccine box you collected from the PHC. Every dose you record is checked against this box and the planned site, and you return the box here at close of work.</p>
    <button class="btn primary" data-start>${icon.box} Collect vaccine box &amp; start</button>
    ${lc ? `<div class="divider"></div><div class="small muted">Last session · ${esc(lc.community)} · closed ${fmtShort(lc.closed_at)}</div>
      ${lc.recon_flags?.length ? `<ul class="flag-list" style="margin-top:8px">${lc.recon_flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>` : `<div class="chip green" style="margin-top:8px">${icon.check} Stock reconciled</div>`}` : ''}`;
}

function outreachOpenHtml(o) {
  return `<div class="card-head"><h3>Outreach · ${esc(o.community)}</h3><span class="chip green"><span class="dot green"></span> Open</span></div>
    <div class="small muted" style="margin-bottom:12px">Started ${fmtTime(o.started_at)} · planned site ${o.site_lat.toFixed(4)}°N, ${o.site_lng.toFixed(4)}°E${o.demo_site ? ' <span class="chip amber">demo site</span>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Vaccine</th><th>Batch</th><th class="r">Vials</th><th class="r">Doses given</th></tr></thead><tbody>
      ${o.items.map((i) => `<tr><td>${esc(i.vaccine)}</td><td class="mono">${esc(i.batch_no)}</td><td class="r num">${i.vials_issued}</td><td class="r num">${i.doses_recorded} <span class="faint">/ ${i.vials_issued * i.doses_per_vial}</span></td></tr>`).join('')}
    </tbody></table></div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn primary" href="#/record">${icon.syringe} Record vaccination</a><button class="btn" data-close-session>${icon.box} Return box &amp; close</button></div>`;
}

const TYPICAL = { BCG: 1, HepB: 1, OPV: 1, Pentavalent: 2, PCV: 3, Rotavirus: 6, IPV: 2, Malaria: 3, Measles: 1, 'Yellow Fever': 1, MenA: 1 };

function startOutreach(ref) {
  const mine = ref.communities.filter((c) => c.facility_id === user().facility_id);
  const others = ref.communities.filter((c) => c.facility_id !== user().facility_id);
  const seen = new Set();
  const batches = ref.batches.filter((b) => { if (seen.has(b.vaccine)) return false; seen.add(b.vaccine); return true; });
  const m = modal({
    title: 'Collect vaccine box', wide: true,
    body: `<div class="field"><label>Planned community (outreach site)</label><select class="input" id="o-comm">
        <optgroup label="${esc(user().facility)}">${mine.map((c) => `<option>${esc(c.name)}</option>`).join('')}</optgroup>
        <optgroup label="Other communities">${others.map((c) => `<option>${esc(c.name)}</option>`).join('')}</optgroup></select></div>
      <label class="check" style="margin-bottom:14px"><input type="checkbox" id="o-demo"><span><b>Demo: use my current location as the planned site.</b> Tick this if you are testing outside Alimosho, so honest doses are not flagged for GPS mismatch.</span></label>
      <div class="label" style="margin-bottom:4px">Vials collected from the cold store</div>
      <div class="list">${batches.map((b) => `<div class="li"><div class="grow"><div class="t">${esc(b.vaccine)}</div>
        <div class="s"><span class="mono">${esc(b.batch_no)}</span> · ${b.doses_per_vial} dose${b.doses_per_vial === 1 ? '' : 's'}/vial · exp. ${fmtDate(b.expiry)}</div></div>
        <input class="input num" style="width:84px;min-height:40px;text-align:center" type="number" min="0" max="50" inputmode="numeric" aria-label="Vials of ${esc(b.vaccine)}" data-batch="${b.id}" value="${TYPICAL[b.vaccine] ?? 0}"></div>`).join('')}</div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="o-go">${icon.box} Start session</button>`,
  });
  m.el.querySelector('#o-go').onclick = async (e) => {
    const btn = e.currentTarget;
    const items = $$('[data-batch]', m.el).map((i) => ({ batch_id: +i.dataset.batch, vials: +i.value || 0 })).filter((i) => i.vials > 0);
    const p = { community: $('#o-comm', m.el).value, items, demo_site: $('#o-demo', m.el).checked };
    busy(btn, true, 'Starting…');
    try {
      if (p.demo_site) {
        const pos = await getPosition();
        if (pos.error) { toast(pos.error, 'err'); busy(btn, false); return; }
        p.lat = pos.lat; p.lng = pos.lng;
      }
      await call('imt_start_outreach', { p });
      m.close(); toast('Outreach session started. Good work!', 'ok');
      route();
    } catch (err) { toast(err.message, 'err'); busy(btn, false); }
  };
}

function closeOutreach(o) {
  const m = modal({
    title: 'Return vaccine box', wide: true,
    body: `${banner('blue', 'Count the vials you are returning. Unused vials go back to the cold store; empty vials are checked against the doses you recorded.')}
      <div class="list">${o.items.map((i) => {
        const needed = Math.ceil(i.doses_recorded / i.doses_per_vial);
        return `<div class="li" style="flex-wrap:wrap"><div class="grow" style="min-width:150px"><div class="t">${esc(i.vaccine)} <span class="mono faint small">${esc(i.batch_no)}</span></div>
          <div class="s">${i.vials_issued} vial${i.vials_issued === 1 ? '' : 's'} issued · ${i.doses_recorded} dose${i.doses_recorded === 1 ? '' : 's'} recorded</div></div>
          <div style="display:flex;gap:8px"><label class="small muted" style="display:flex;flex-direction:column;gap:3px;align-items:center">Unused<input class="input num" style="width:70px;min-height:38px;text-align:center" type="number" min="0" inputmode="numeric" data-unused="${i.batch_id}" value="${Math.max(0, i.vials_issued - needed)}"></label>
          <label class="small muted" style="display:flex;flex-direction:column;gap:3px;align-items:center">Empty<input class="input num" style="width:70px;min-height:38px;text-align:center" type="number" min="0" inputmode="numeric" data-empty="${i.batch_id}" value="${Math.min(i.vials_issued, needed)}"></label></div></div>`;
      }).join('')}</div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="c-go">Return box &amp; close session</button>`,
  });
  m.el.querySelector('#c-go').onclick = async (e) => {
    const btn = e.currentTarget;
    const items = o.items.map((i) => ({ batch_id: i.batch_id, unused: +$(`[data-unused="${i.batch_id}"]`, m.el).value || 0, empty: +$(`[data-empty="${i.batch_id}"]`, m.el).value || 0 }));
    busy(btn, true, 'Reconciling…');
    try {
      const res = await call('imt_close_outreach', { p: { items } });
      m.close();
      route(); // refresh Today underneath, then show the result on top
      const flags = res.recon_flags || [];
      modal({
        title: 'Session closed',
        body: (flags.length ? banner('amber', `<b>${flags.length} stock discrepancy flag(s) sent to your supervisor.</b><ul class="flag-list" style="margin-top:8px">${flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>`)
          : banner('green', '<b>Stock reconciled.</b> Doses recorded match the vials opened.'))
          + `<div class="table-wrap"><table><thead><tr><th>Batch</th><th class="r">Empty vials</th><th class="r">Doses in them</th><th class="r">Recorded</th><th class="r">Wastage</th></tr></thead><tbody>
            ${(res.recon?.items || []).map((r) => `<tr><td>${esc(r.vaccine)} <span class="mono faint">${esc(r.batch_no)}</span></td><td class="r num">${r.empty}</td><td class="r num">${r.capacity}</td><td class="r num">${r.recorded}</td><td class="r num">${r.wastage_pct}%</td></tr>`).join('')}
          </tbody></table></div>`,
        foot: '<button class="btn primary" data-close>Done</button>',
      });
    } catch (err) { toast(err.message, 'err'); busy(btn, false); }
  };
}

function recentList(list) {
  const pending = queue.all().filter((q) => q.kind === 'dose').map((q) => ({ pending: true, label: q.meta?.label, child: q.meta?.child, captured_at: q.payload.captured_at, error: q.error }));
  const all = [...pending, ...list];
  if (!all.length) return '<div class="empty">No records yet. Register a child, then record a vaccination.</div>';
  return all.map((d) => `<div class="li">${avatar(d.child)}<div class="grow"><div class="t">${esc(d.label || 'Dose')} · ${esc(d.child || '')}</div>
      <div class="s">${fmtShort(d.captured_at)}${d.flags?.length ? ' · ' + esc(d.flags[0].text) : ''}${d.error ? ' · ' + esc(d.error) : ''}</div></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${doseStatusChip(d)}
      ${!d.pending && d.otp_status === 'pending' && d.status === 'valid' ? `<button class="pill-btn" data-confirm="${d.id}" data-child="${d.child_id}">Confirm OTP</button>` : ''}</div></div>`).join('');
}

function bindRecent(root) {
  root.querySelectorAll('[data-confirm]').forEach((b) => (b.onclick = () => confirmLateOtp(+b.dataset.confirm, +b.dataset.child)));
}

async function confirmLateOtp(doseId, childId) {
  const m = modal({
    title: 'Confirm with guardian',
    body: `<p class="muted" style="margin-top:0">This dose was saved without guardian confirmation. Send a code to the guardian's phone and enter it to verify the record.</p>
      <div id="lo-sms"></div><button class="btn block" id="lo-send">${icon.sms} Send OTP</button>
      <div class="field" style="margin-top:14px"><label>4-digit code</label><input class="input otp-input" id="lo-code" maxlength="4" inputmode="numeric" placeholder="••••"></div>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="lo-go">Verify</button>`,
  });
  m.el.querySelector('#lo-send').onclick = async (e) => {
    const sb = e.currentTarget;
    busy(sb, true, 'Sending…');
    try { const r = await call('imt_request_otp', { p_child: childId, p_dose_id: doseId }); $('#lo-sms', m.el).innerHTML = smsBubble(r); }
    catch (err) { toast(err.message, 'err'); }
    busy(sb, false);
  };
  m.el.querySelector('#lo-go').onclick = async (e) => {
    const gb = e.currentTarget;
    busy(gb, true, 'Checking…');
    try { await call('imt_confirm_dose_otp', { p_dose: doseId, p_code: $('#lo-code', m.el).value.trim() }); m.close(); toast('Guardian confirmed. Record verified.', 'ok'); route(); }
    catch (err) { toast(err.message, 'err'); busy(gb, false); }
  };
}
const route = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

function smsBubble(r) {
  const msg = esc(r.message).replace(/(\d{4})$/, '<span class="code">$1</span>');
  return `<div class="sms" style="margin-bottom:10px"><div class="from"><span>SMS to ${esc(r.phone || r.to)}</span><span class="chip amber" style="padding:1px 7px;font-size:11px">Simulated</span></div>${msg}</div>`;
}

// =====================================================================
// REGISTER CHILD
// =====================================================================
async function register(main) {
  const ref = await loadReference();
  const comms = ref.communities;
  let photo = null;
  main.innerHTML = `
    <div class="page-head"><div><h1>Register child</h1><p>Issues the unique ImmunTrack ID that every dose record must reference</p></div></div>
    <div class="grid g-main">
      <form class="card" id="reg-form" novalidate>
        <h3>Child bio-data</h3>
        <div class="row"><div class="field"><label>First name</label><input class="input" name="first_name" placeholder="e.g. Babajide" required></div>
          <div class="field"><label>Last name</label><input class="input" name="last_name" placeholder="e.g. Arulogun" required></div></div>
        <div class="row"><div class="field"><label>Date of birth</label><input class="input" name="dob" type="date" max="${todayISO()}" required></div>
          <div class="field"><label>Sex</label><select class="input" name="sex"><option>Female</option><option>Male</option></select></div></div>
        <div class="row"><div class="field"><label>Birth certificate no.</label><input class="input" name="birth_cert_no" placeholder="e.g. NPC/LA/2026/000123" autocapitalize="characters"><span class="hint">National Population Commission number</span></div>
          <div class="field"><label>LASRA ID</label><input class="input" name="lasra_id" placeholder="LASRA-2026-000000" autocapitalize="characters"><span class="hint">Leave blank if not yet enrolled</span></div></div>
        <div class="row"><div class="field"><label>Guardian name</label><input class="input" name="guardian_name" placeholder="e.g. Babajide Arulogun" required></div>
          <div class="field"><label>Guardian phone</label><input class="input" name="guardian_phone" type="tel" inputmode="tel" placeholder="e.g. 0803 000 0000" required><span class="hint">Receives the OTP and reminders</span></div></div>
        <div class="field"><label>Community</label><select class="input" name="community">${comms.map((c) => `<option ${c.facility_id === user().facility_id ? '' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div id="reg-msg"></div>
        <button class="btn primary block" id="reg-btn">Save &amp; generate ID</button>
      </form>
      <div>
        <div class="card"><h3>Face capture</h3>
          <div class="photo-box" id="reg-photo" style="max-width:260px;margin:0 auto;cursor:pointer">${icon.camera}<div>Tap to capture the child's face</div></div>
          <p class="small muted" style="text-align:center">Used to match the child at every dose, so a child cannot be re-registered under another name. Fingerprints: Phase 2.</p>
          <button class="btn block" id="reg-cam">${icon.camera} Capture face</button></div>
        <div class="card" id="reg-result"><h3>Recently registered</h3><div class="list" id="reg-recent"><div class="empty">Loading…</div></div></div>
      </div>
    </div>`;
  const myComm = comms.find((c) => c.facility_id === user().facility_id);
  if (myComm) main.querySelector('[name=community]').value = myComm.name;
  const box = $('#reg-photo');
  const take = async () => { const p = await captureFace('Child face photo'); if (p) { photo = p; box.innerHTML = `<img src="${p}" alt="Child">`; box.style.borderStyle = 'solid'; } };
  box.onclick = take; $('#reg-cam').onclick = take;

  const showRecent = (list) => {
    const pend = cache.pendingChildren();
    const all = [...pend.map((c) => ({ ...c, uid: 'ID issued on sync', pending: true })), ...list];
    $('#reg-recent').innerHTML = all.length ? all.slice(0, 6).map((c) => `<div class="li click" data-child="${c.id || ''}">${avatar(c.name || c.first_name + ' ' + c.last_name, c.photo)}<div class="grow"><div class="t">${esc(c.name || c.first_name + ' ' + c.last_name)} · ${esc(c.sex || '')}</div>
      <div class="s"><span class="mono">${esc(c.uid)}</span> · ${c.lasra_id ? esc(c.lasra_id) : 'No LASRA ID'}</div></div>${c.pending ? '<span class="chip amber">Pending</span>' : ''}</div>`).join('') : '<div class="empty">No children yet.</div>';
    $$('#reg-recent [data-child]').forEach((el) => { if (el.dataset.child) el.onclick = () => childCard(+el.dataset.child); });
  };
  call('imt_find_children', { p_q: '' }).then((l) => { cache.setChildren(l); showRecent(l); }).catch(() => showRecent(cache.children()));

  $('#reg-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const p = Object.fromEntries(f.entries());
    const missing = ['first_name', 'last_name', 'dob', 'guardian_name', 'guardian_phone'].filter((k) => !String(p[k] || '').trim());
    if (missing.length) { toast('Please fill in: ' + missing.map((k) => k.replace('_', ' ')).join(', '), 'err'); return; }
    if (!photo && !(await confirmBox('No face photo', 'Register without a face photo? The supervisor will not be able to match this child at later doses.', 'Register anyway'))) return;
    p.photo = photo; p.client_ref = uuid(); p.captured_at = new Date().toISOString();
    const btn = $('#reg-btn');
    busy(btn, true, 'Saving…');
    try {
      const child = await call('imt_register_child', { p });
      cache.upsertChild(child);
      showIdCard(child);
      e.target.reset(); photo = null; box.innerHTML = `${icon.camera}<div>Tap to capture the child's face</div>`;
      if (myComm) main.querySelector('[name=community]').value = myComm.name;
      call('imt_find_children', { p_q: '' }).then((l) => { cache.setChildren(l); showRecent(l); }).catch(() => {});
    } catch (err) {
      if (err.offline) {
        queue.add({ kind: 'child', payload: p, meta: { name: p.first_name + ' ' + p.last_name } });
        cache.addPendingChild({ ...p, name: p.first_name + ' ' + p.last_name, pending: true });
        toast('Offline: child saved on this phone. The ID is issued when it syncs.', 'ok');
        showRecent(cache.children());
        e.target.reset(); photo = null;
      } else {
        $('#reg-msg').innerHTML = banner('red', esc(err.message) + (/already registered/i.test(err.message) ? ' <a href="#/find">Find child</a>' : ''));
      }
    }
    busy(btn, false);
  };
}

function idCardHtml(c) {
  return `<div class="idcard"><div><div class="lbl">ImmunTrack ID · Lagos State</div><div class="id">${esc(c.uid)}</div>
      <div class="nm">${esc(c.name)}</div><div class="small" style="opacity:.85">${esc(c.sex || '')} · born ${fmtDate(c.dob)}${c.lasra_id ? ' · ' + esc(c.lasra_id) : ''}</div></div>
      <div class="qr">${qrSvg(c.uid)}</div></div>`;
}

function showIdCard(c) {
  const next = (c.due || []).find((d) => ['overdue', 'due', 'upcoming'].includes(d.status));
  const m = modal({
    title: 'Child registered',
    body: `${idCardHtml(c)}
      <p class="small muted">The guardian can show this ID (or the QR code) at any Lagos State facility to see the full record, even without the vaccination card.</p>
      ${next ? banner(next.status === 'overdue' ? 'amber' : 'blue', `Next due: <b>${esc(next.label)}</b> · ${fmtDate(next.due)}${next.status === 'overdue' ? ' (overdue)' : ''}`) : ''}`,
    foot: `<button class="btn" data-close>Done</button><button class="btn primary" id="id-rec">${icon.syringe} Record vaccination</button>`,
  });
  m.el.querySelector('#id-rec').onclick = () => { m.close(); location.hash = '#/record/' + c.id; };
}

// =====================================================================
// FIND CHILD (search used by Record and Find)
// =====================================================================
function searchBox(container, onPick, { autofocus = false } = {}) {
  container.innerHTML = `<div class="field" style="margin-bottom:10px"><input class="input" id="sq" type="search" placeholder="Search by ImmunTrack ID, LASRA ID, birth certificate, name or phone" ${autofocus ? 'autofocus' : ''}></div>
    <div class="list" id="sr"><div class="empty">Loading…</div></div>`;
  const input = $('#sq', container), out = $('#sr', container);
  let t = null, last = '';
  const show = (list, offline) => {
    if (!list.length) { out.innerHTML = `<div class="empty">No child found${offline ? ' in this phone\'s saved list' : ''}. Check the ID or <a href="#/register">register the child</a>.</div>`; return; }
    out.innerHTML = (offline ? `<div class="small muted" style="margin-bottom:6px">${icon.wifiOff ? '' : ''}Offline — searching children saved on this phone</div>` : '') +
      list.map((c, i) => `<div class="li click" data-i="${i}">${avatar(c.name, c.photo)}<div class="grow"><div class="t">${esc(c.name)} <span class="faint small">· ${esc(ageText(c.dob))}</span></div>
      <div class="s"><span class="mono">${esc(c.uid)}</span> · ${esc(c.facility || c.community || '')}</div></div>
      ${c.pending ? '<span class="chip amber">Pending sync</span>' : c.next ? `<span class="chip ${c.next.status === 'overdue' ? 'red' : c.next.status === 'due' ? 'amber' : ''}">${esc(c.next.label)}</span>` : '<span class="chip green">Up to date</span>'}</div>`).join('');
    $$('[data-i]', out).forEach((el) => (el.onclick = () => onPick(list[+el.dataset.i])));
  };
  const localSearch = (q) => {
    q = q.toLowerCase();
    const pend = cache.pendingChildren().map((c) => ({ ...c, uid: 'Pending ID', pending: true }));
    return [...pend, ...cache.children()].filter((c) => !q || [c.uid, c.name, c.lasra_id, c.birth_cert_no, c.guardian_phone, c.guardian_name].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 25);
  };
  const run = async () => {
    const q = input.value.trim();
    last = q;
    try {
      const list = await call('imt_find_children', { p_q: q });
      if (q === '') cache.setChildren(list); else list.forEach((c) => cache.upsertChild(c));
      if (last === q) show([...(q ? [] : cache.pendingChildren().map((c) => ({ ...c, uid: 'Pending ID', pending: true }))), ...list], false);
    } catch (e) { if (e.offline) show(localSearch(q), true); else out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  input.oninput = () => { clearTimeout(t); t = setTimeout(run, 280); };
  run();
}

async function find(main) {
  main.innerHTML = `<div class="page-head"><div><h1>Find child</h1><p>Any child registered anywhere in the state — a forgotten card is no longer a missed dose</p></div></div>
    <div class="card" id="find-box"></div>`;
  searchBox($('#find-box'), (c) => c.pending ? toast('This child is waiting to sync. You can still record a dose for them.') || (location.hash = '#/record/ref:' + c.client_ref) : childCard(c.id), { autofocus: true });
}

export async function childCard(id) {
  const m = modal({ title: 'Child record', wide: true, body: '<div class="empty">Loading…</div>' });
  try {
    const c = await call('imt_child_card', { p_child: id });
    cache.upsertChild(c);
    m.el.querySelector('.modal-b').innerHTML = childDetailHtml(c);
    const f = document.createElement('div'); f.className = 'modal-f';
    f.innerHTML = `<button class="btn" data-close>Close</button><button class="btn primary" id="cc-rec">${icon.syringe} Record vaccination</button>`;
    m.el.appendChild(f);
    f.querySelector('#cc-rec').onclick = () => { m.close(); location.hash = '#/record/' + c.id; };
  } catch (e) {
    const c = cache.children().find((x) => x.id === id);
    m.el.querySelector('.modal-b').innerHTML = c ? childDetailHtml(c) + banner('amber', 'Offline: showing saved details.') : `<div class="empty">${esc(e.message)}</div>`;
  }
}

export function dueChips(due) {
  if (!due) return '';
  return `<div class="due-grid">${due.map((d) => `<span class="due st-${d.status}" title="${d.status === 'expired' ? 'Not eligible — age limit passed on ' + fmtDate(d.last_day) : esc(d.status) + ' · ' + fmtDate(d.given_at || d.due)}">${d.status === 'given' ? '✓ ' : ''}${esc(d.label)}</span>`).join('')}</div>
    <div class="legend" style="margin-top:8px"><span><i style="background:var(--green)"></i>Given</span><span><i style="background:var(--red)"></i>Overdue</span><span><i style="background:var(--amber)"></i>Due today</span><span><i style="background:var(--border-2)"></i>Upcoming</span><span><i style="background:transparent;border:1px dashed var(--faint)"></i>Age limit passed</span></div>`;
}

export function childDetailHtml(c) {
  return `<div class="grid g2"><div>${idCardHtml(c)}</div>
    <div style="display:flex;gap:14px;align-items:flex-start">${avatar(c.name, c.photo, 'lg')}<div class="kv" style="flex:1">
      <div><span>Age</span><b>${esc(ageText(c.dob))}</b></div><div><span>Sex</span><b>${esc(c.sex || '—')}</b></div>
      <div><span>Guardian</span><b>${esc(c.guardian_name || '—')}</b></div><div><span>Phone</span><b>${esc(c.guardian_phone || '—')}</b></div>
      <div><span>Birth cert.</span><b>${esc(c.birth_cert_no || '—')}</b></div><div><span>Facility</span><b>${esc(c.facility || '—')}</b></div></div></div></div>
    <div class="divider"></div><div class="label" style="margin-bottom:8px">Schedule</div>${dueChips(c.due)}
    <div class="divider"></div><div class="label" style="margin-bottom:4px">Dose history</div>
    ${(c.doses || []).length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Vaccine</th><th>Batch</th><th>Site</th><th>By</th><th>Status</th></tr></thead><tbody>
      ${c.doses.map((d) => `<tr><td class="small">${fmtShort(d.captured_at)}</td><td>${esc(d.label)}</td><td class="mono small">${esc(d.batch_no)}</td><td class="small">${esc(d.injection_site || '')}</td><td class="small">${esc(d.vaccinator)}<div class="faint">${esc(d.facility)}</div></td><td>${doseStatusChip(d)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No doses recorded yet.</div>'}`;
}

// =====================================================================
// RECORD VACCINATION
// =====================================================================
async function record(main, [param]) {
  main.innerHTML = `<div class="page-head"><div><h1>Record vaccination</h1><p>Point-of-care capture with guardian OTP verification</p></div></div>
    <div class="card" id="pick"></div>`;
  const pick = (c) => { location.hash = '#/record/' + (c.pending ? 'ref:' + c.client_ref : c.id); };
  if (!param) { searchBox($('#pick'), pick, { autofocus: true }); return; }

  const [{ home }, ref] = await Promise.all([getHome().catch(() => ({ home: cache.home() })), loadReference()]);
  let child;
  if (param.startsWith('ref:')) {
    const p = cache.pendingChildren().find((c) => c.client_ref === param.slice(4));
    if (!p) { location.hash = '#/record'; return; }
    child = { ...p, uid: 'Pending ID', pending: true, due: null, doses: [] };
  } else {
    try { child = await call('imt_child_card', { p_child: +param }); cache.upsertChild(child); }
    catch (e) { child = cache.children().find((c) => c.id === +param); if (!child) throw e; }
  }
  renderRecordForm(main, child, home, ref);
}

function renderRecordForm(main, child, home, ref) {
  const o = home?.outreach;
  const site = siteRef(home, ref);
  let gps = null, photo = null, otpSent = false;
  const OPEN = ['overdue', 'due', 'upcoming'];
  const next = (child.due || []).find((d) => OPEN.includes(d.status));
  const vaccines = ref.vaccines;
  const vc = visitOtp[child.id];
  const visitCode = vc && Date.now() - vc.at < 29 * 60000 ? vc : null;
  main.innerHTML = `
    <div class="page-head"><div><h1>Record vaccination</h1><p>Point-of-care capture with guardian OTP verification</p></div>
      <div class="head-actions"><a class="btn" href="#/record">Change child</a></div></div>
    ${!o ? banner('amber', 'No outreach session is open, so doses are checked against your facility location. <a href="#/today">Collect a vaccine box</a> first when you are going out to a community.') : ''}
    <div class="grid g-main">
      <div class="card">
        <div class="label" style="margin-bottom:6px">Child</div>
        <div style="display:flex;gap:14px;align-items:center;margin-bottom:14px">${avatar(child.name, child.photo, 'lg')}
          <div style="min-width:0"><div style="font-weight:700;font-size:17px">${esc(child.name)}</div><div class="mono small muted">${esc(child.uid)}</div>
          <div class="small muted">${esc(child.sex || '')} · ${esc(ageText(child.dob))} · born ${fmtDate(child.dob)}</div></div></div>
        <div class="kv" style="margin-bottom:14px">
          <div><span>Guardian</span><b>${esc(child.guardian_name || '—')}</b></div><div><span>Community</span><b>${esc(child.community || '—')}</b></div>
          <div><span>LASRA ID</span><b>${esc(child.lasra_id || 'Not enrolled')}</b></div><div><span>Birth cert.</span><b>${esc(child.birth_cert_no || '—')}</b></div></div>
        ${child.due ? `<details style="margin-bottom:14px"><summary class="small" style="cursor:pointer;color:var(--accent-2)">Immunisation schedule</summary><div style="margin-top:10px">${dueChips(child.due)}</div></details>` : ''}
        <div class="row"><div class="field"><label>Vaccine</label><select class="input" id="r-vac">${vaccines.map((v) => `<option>${esc(v.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Dose #</label><select class="input" id="r-dose"></select></div></div>
        <div class="row"><div class="field"><label>Batch / lot no.</label><select class="input" id="r-batch"></select></div>
          <div class="field"><label>Site of administration</label><select class="input" id="r-site">${SITES.map((s) => `<option>${s}</option>`).join('')}</select></div></div>
        <div id="r-warn"></div>
        <div class="label" style="margin:4px 0 8px">Face match at point of care</div>
        <div class="photo-pair" style="max-width:360px">
          <div><div class="photo-box">${child.photo ? `<img src="${esc(child.photo)}" alt="">` : 'No photo at registration'}</div><div class="cap">At registration</div></div>
          <div><div class="photo-box" id="r-photo" style="cursor:pointer">${icon.camera}<div>Tap to capture now</div></div><div class="cap">Now</div></div>
        </div>
        <div class="label" style="margin:16px 0 8px">Auto-captured proof</div>
        <div class="proof" id="r-proof"></div>
      </div>
      <div class="card" id="otp-card">
        <h3>Guardian confirmation</h3>
        <p class="small muted" style="margin-top:-4px">An SMS code goes to the guardian's registered phone (${esc(child.guardian_phone || '—')}). They give it to you only after seeing the vaccine given. <span class="chip amber" style="font-size:11px;padding:1px 7px">SMS simulated in demo</span></p>
        <div id="r-sms">${visitCode ? banner('green', `Guardian already confirmed this visit. The same code covers every vaccine given to ${esc(child.first_name || child.name)} until ${fmtTime(visitCode.at + 30 * 60000)}.`) : ''}</div>
        <button class="btn block" id="r-send">${icon.sms} Send OTP</button>
        <div class="field" style="margin-top:14px"><label>Enter 4-digit code</label><input class="input otp-input" id="r-code" maxlength="4" inputmode="numeric" autocomplete="one-time-code" placeholder="••••" value="${visitCode ? visitCode.code : ''}"></div>
        <button class="btn primary block" id="r-submit">${icon.shield} Verify &amp; submit record</button>
        <button class="btn ghost block small" id="r-nootp" style="margin-top:6px">Guardian has no phone / no network — submit without OTP</button>
        <p class="tiny faint" style="margin:10px 0 0">Once submitted, the record is sealed. Only a supervisor can change it, and every change is logged with a reason.</p>
      </div>
    </div>`;

  const vac = $('#r-vac'), dose = $('#r-dose'), batch = $('#r-batch'), siteSel = $('#r-site');
  const fillDoses = () => {
    const opts = ref.schedule.filter((s) => s.vaccine === vac.value);
    const nextForVac = (child.due || []).find((d) => d.vaccine === vac.value && OPEN.includes(d.status));
    dose.innerHTML = opts.map((s) => `<option value="${s.dose_no}">${s.dose_no}${s.label !== vac.value ? ' · ' + esc(s.label) : ''}</option>`).join('');
    if (nextForVac) dose.value = nextForVac.dose_no;
    const inBox = (o?.items || []).filter((i) => i.vaccine === vac.value);
    const others = ref.batches.filter((b) => b.vaccine === vac.value && !inBox.some((i) => i.batch_id === b.id));
    batch.innerHTML = inBox.map((i) => `<option value="${i.batch_id}">${esc(i.batch_no)} ✓ in box</option>`).join('') +
      others.map((b) => `<option value="${b.id}">${esc(b.batch_no)}${o ? ' · not in box' : ''}</option>`).join('');
    const v = vaccines.find((x) => x.name === vac.value);
    if (v?.default_site) siteSel.value = v.default_site;
    warn();
  };
  const warn = () => {
    const w = [];
    const given = (child.doses || []).find((d) => d.vaccine === vac.value && String(d.dose_no) === dose.value && d.status === 'valid');
    if (given) w.push(`Already recorded on ${fmtDate(given.captured_at)} at ${esc(given.facility)}. Submitting again will be flagged as a duplicate.`);
    const sel = batch.selectedOptions[0];
    const sch = ref.schedule.find((x) => x.vaccine === vac.value && String(x.dose_no) === dose.value);
    if (sch && child.dob) {
      const ageDays = Math.floor((Date.now() - new Date(child.dob + 'T00:00:00')) / 86400000);
      if (sch.max_age_days != null && ageDays > sch.max_age_days) w.push(`<b>Age limit passed:</b> ${esc(sch.label)} is only given up to ${sch.max_age_days < 60 ? Math.round(sch.max_age_days / 7) + ' weeks' : sch.max_age_days < 700 ? Math.round(sch.max_age_days / 30.4) + ' months' : Math.round(sch.max_age_days / 365.25) + ' years'} of age. This child is ${esc(ageText(child.dob))}. Do not give it; the record would be flagged.`);
      else if (ageDays < sch.age_days - 7) w.push(`${esc(sch.label)} is not due until ${Math.round(sch.age_days / 7)} weeks of age. The record would be flagged.`);
    }
    if (o && sel && /not in box/.test(sel.textContent)) w.push('This batch was not in the vaccine box you collected. It will be flagged.');
    if (!batch.options.length) w.push('No batch of this vaccine is available.');
    $('#r-warn').innerHTML = w.length ? banner('amber', w.join('<br>')) : '';
  };
  vac.onchange = fillDoses; dose.onchange = warn; batch.onchange = warn;
  if (next) vac.value = next.vaccine;
  fillDoses();

  const proof = () => {
    const d = gps && !gps.error && site ? distanceM(gps, site) : null;
    $('#r-proof').innerHTML = `
      <div>${gps == null ? '<span class="chip">GPS …</span> <span class="muted">Getting location…</span>'
        : gps.error ? `<span class="chip red">GPS ✗</span> <span class="muted">${esc(gps.error)}</span> <button class="pill-btn" id="r-gps">Retry</button>`
        : `<span class="chip green">GPS ✓</span> ${gps.lat.toFixed(4)}°N, ${gps.lng.toFixed(4)}°E · ±${gps.accuracy} m ${d != null ? (d > 1000 ? `<span class="chip red">${(d / 1000).toFixed(1)} km from ${esc(site.name)}</span>` : `<span class="chip green">on site</span>`) : ''} <button class="pill-btn" id="r-gps">Refresh</button>`}</div>
      <div><span class="chip green">Timestamp ✓</span> ${fmtTime(new Date())} · device clock</div>
      <div>${photo ? '<span class="chip green">Face ✓</span> captured now' : '<span class="chip">Face</span> <span class="muted">not captured yet</span>'}</div>
      <div>${navigator.onLine ? '<span class="chip green">Network ✓</span> online' : '<span class="chip amber">Offline</span> <span class="muted">record will sync later</span>'}</div>`;
    $('#r-gps')?.addEventListener('click', locate);
  };
  const locate = async () => { gps = null; proof(); gps = await getPosition(); proof(); };
  locate();

  const pbox = $('#r-photo');
  pbox.onclick = async () => { const p = await captureFace('Point-of-care photo', 'Photograph the child being vaccinated'); if (p) { photo = p; pbox.innerHTML = `<img src="${p}" alt="">`; pbox.style.borderStyle = 'solid'; proof(); } };

  $('#r-send').onclick = async (e) => {
    if (child.pending) { toast('This child has not synced yet, so an OTP cannot be sent. Submit without OTP; it will be flagged as pending.'); return; }
    const btn = e.currentTarget;
    busy(btn, true, 'Sending…');
    try {
      const label = ref.schedule.find((s) => s.vaccine === vac.value && String(s.dose_no) === dose.value)?.label || vac.value;
      const r = await call('imt_request_otp', { p_child: child.id, p_vaccine: label });
      $('#r-sms').innerHTML = smsBubble(r);
      delete visitOtp[child.id];
      otpSent = true;
      btn.innerHTML = `${icon.sms} Resend OTP`; btn.disabled = false;
      $('#r-code').focus();
    } catch (err) {
      busy(btn, false);
      toast(err.offline ? 'No network: the OTP cannot be sent. Submit without OTP; the record will be flagged until the guardian confirms.' : err.message, 'err');
    }
  };

  const submit = async (withOtp) => {
    const code = $('#r-code').value.trim();
    if (withOtp && !/^\d{4}$/.test(code)) { toast(otpSent ? 'Enter the 4-digit code from the guardian\'s SMS.' : 'Send the OTP first, then enter the code.', 'err'); return; }
    if (!batch.value) { toast('Choose a batch.', 'err'); return; }
    if (!withOtp && !(await confirmBox('Submit without OTP?', 'The record will be saved but flagged as <b>not confirmed by the guardian</b> until you confirm it later from My activity.', 'Submit without OTP'))) return;
    if (!photo && !(await confirmBox('No face photo', 'Submit without a point-of-care photo? The record will be flagged.', 'Submit anyway'))) return;
    const label = ref.schedule.find((s) => s.vaccine === vac.value && String(s.dose_no) === dose.value)?.label || vac.value;
    const p = {
      client_ref: uuid(), vaccine: vac.value, dose_no: +dose.value, batch_id: +batch.value, injection_site: siteSel.value,
      lat: gps && !gps.error ? gps.lat : null, lng: gps && !gps.error ? gps.lng : null, accuracy: gps?.accuracy ?? null,
      captured_at: new Date().toISOString(), otp: withOtp ? code : null, photo, offline: false,
    };
    if (child.pending) p.child_ref = child.client_ref; else p.child_id = child.id;
    const btn = withOtp ? $('#r-submit') : $('#r-nootp');
    busy(btn, true, 'Submitting…');
    try {
      if (child.pending) throw Object.assign(new Error('pending child'), { offline: true });
      const res = await call('imt_record_dose', { p });
      if (res.otp_status === 'verified' && p.otp) visitOtp[child.id] = visitOtp[child.id] || { code: p.otp, at: Date.now() };
      receipt(res, child);
    } catch (err) {
      if (err.offline) {
        p.offline = true;
        queue.add({ kind: 'dose', payload: p, meta: { label, child: child.name } });
        modal({ title: 'Saved on this phone', body: banner('amber', `<b>No network.</b> ${esc(label)} for ${esc(child.name)} is saved on this phone and will be sealed when it syncs. The supervisor will see it as captured offline${p.otp ? '' : ', pending guardian confirmation'}.`, icon.wifiOff),
          foot: '<a class="btn primary" href="#/today" data-close>Done</a>' });
      } else { toast(err.message, 'err'); }
    }
    busy(btn, false);
  };
  $('#r-submit').onclick = () => submit(true);
  $('#r-nootp').onclick = () => submit(false);
}

function receipt(d, child) {
  const flagged = d.flags?.length > 0;
  const m = modal({
    title: flagged ? 'Record submitted — flagged for review' : 'Record verified & sealed',
    body: `<div class="seal ${flagged ? 'bad' : ''}">${flagged ? icon.warn : icon.shield}<div><b>${esc(d.label)} · ${esc(d.child)}</b><div class="small muted">${esc(d.uid)} · ${fmtDT(d.captured_at)}</div>
        <div class="hash">Seal ${esc((d.hash || '').slice(0, 24))}…</div></div></div>
      ${flagged ? `<div style="margin-top:14px">${banner('amber', `<b>Sent to your supervisor for review:</b><ul class="flag-list" style="margin-top:8px">${d.flags.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>`)}</div>` : ''}
      <div class="kv" style="margin-top:14px"><div><span>Guardian OTP</span><b>${d.otp_status === 'verified' ? '✓ Confirmed' : 'Pending'}</b></div><div><span>Batch</span><b class="mono">${esc(d.batch_no)}</b></div>
        <div><span>Site</span><b>${esc(d.injection_site)}</b></div><div><span>Next dose</span><b>${d.next_vaccine ? esc(d.next_vaccine) + ' · ' + fmtDate(d.next_due) : 'Schedule complete'}</b></div></div>
      ${d.reminder_sms ? `<div class="label" style="margin:16px 0 8px">Reminder scheduled for the guardian</div>${smsBubble({ phone: child.guardian_phone, message: d.reminder_sms })}` : ''}`,
    foot: `<a class="btn" href="#/today" data-close>Done</a><button class="btn primary" id="rc-again">Another dose for ${esc(child.first_name || child.name.split(' ')[0])}</button>`,
  });
  m.el.querySelector('#rc-again').onclick = () => { m.close(); route(); };
}

// =====================================================================
// MY ACTIVITY
// =====================================================================
async function activity(main) {
  const { home, offline } = await getHome();
  const q = queue.all();
  const rate = home.doses_total ? Math.round(100 * home.verified_total / home.doses_total) : null;
  main.innerHTML = `
    <div class="page-head"><div><h1>My activity</h1><p>${esc(user().full_name)} · ${esc(user().facility)}</p></div>
      <div class="head-actions"><button class="btn" id="a-sync" ${q.length ? '' : 'disabled'}>${icon.sync} Sync now</button></div></div>
    ${offline ? banner('amber', 'Offline — showing the last saved view.', icon.wifiOff) : ''}
    <div class="kpis">
      <div class="kpi"><div class="v">${home.doses_today}</div><div class="l">Doses today</div></div>
      <div class="kpi"><div class="v">${home.doses_total}</div><div class="l">Doses recorded (all time)</div></div>
      <div class="kpi ${rate != null && rate < 80 ? 'amber' : 'green'}"><div class="v">${rate == null ? '—' : rate + '%'}</div><div class="l">Verification rate</div></div>
      <div class="kpi ${q.length ? 'amber' : ''}"><div class="v">${q.length}</div><div class="l">On this phone, not synced</div></div>
    </div>
    ${q.length ? `<div class="card"><div class="card-head"><h3>Waiting to sync</h3></div><div class="list">${q.map((it, i) => `<div class="li"><div class="grow"><div class="t">${it.kind === 'child' ? 'Registration · ' + esc(it.meta?.name) : esc(it.meta?.label) + ' · ' + esc(it.meta?.child)}</div>
      <div class="s">Saved ${fmtShort(it.queued_at)}${it.error ? ` · <span style="color:var(--red)">${esc(it.error)}</span>` : ''}</div></div>
      ${it.error ? `<button class="pill-btn" data-retry="${i}">Retry</button><button class="pill-btn" data-drop="${i}">Discard</button>` : '<span class="chip amber">Queued</span>'}</div>`).join('')}</div></div>` : ''}
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>My records</h3><div class="list">${recentList(home.recent)}</div></div>
      <div class="card"><h3>What your supervisor sees</h3><div class="table-wrap"><table><thead><tr><th>Time</th><th>Type</th><th>Activity</th></tr></thead><tbody>
        ${home.activity.map((a) => `<tr><td class="num small">${fmtShort(a.at)}</td><td><span class="chip">${esc(a.type)}</span></td><td class="small">${esc(a.text)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No activity yet.</td></tr>'}
      </tbody></table></div></div>
    </div>`;
  bindRecent(main);
  $('#a-sync').onclick = async (e) => { busy(e.currentTarget, true, 'Syncing…'); await syncQueue(); activity(main); };
  $$('[data-retry]', main).forEach((b) => (b.onclick = () => { const all = queue.all(); delete all[+b.dataset.retry].error; queue.save(all); syncQueue().then(() => activity(main)); }));
  $$('[data-drop]', main).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Discard record?', 'This record will be deleted from the phone and will not reach the server.', 'Discard', true))) return;
    const all = queue.all(); const [it] = all.splice(+b.dataset.drop, 1); queue.save(all);
    if (it.kind === 'child') cache.removePendingChild(it.payload.client_ref);
    activity(main);
  }));
}

export const pages = { today, register, record, find, activity };
