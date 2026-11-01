// ImmunTrack — app shell: sign-in, navigation, routing, sync.
import { CONFIGURED, rpc, call, session, queue, syncQueue, cache } from './api.js';
import { esc, icon, logo, toast, modal, busy, $ } from './ui.js';
import { LGA_NAME } from './config.js';
import * as V from './vaccinator.js';
import * as S from './supervisor.js';

const app = document.getElementById('app');
let cleanup = null;
let navSeq = 0;
let timers = [];

// ---------- theme ----------
export function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  try { localStorage.setItem('imt_theme', next); } catch (e) {}
  document.querySelector('meta[name=theme-color]').content = next === 'light' ? '#f4f6f9' : '#0f1115';
}

// ---------- tester guide ----------
export function showGuide() {
  modal({
    title: 'How to test ImmunTrack', wide: true,
    body: `
      <div class="banner amber">${icon.warn}<div><b>Test data only.</b> Use a group member as the "baby" and invent the details. Do not enter real children's records: real infant health data is protected under the Nigeria Data Protection Act.</div></div>
      <ol style="padding-left:18px;margin:0;display:flex;flex-direction:column;gap:10px">
        <li><b>Vaccinator, on a phone.</b> Sign in as <span class="mono">sbello · 1234</span>. Allow camera and location when asked.</li>
        <li><b>Start outreach.</b> On <i>Today</i>, collect a vaccine box: pick a community, enter vials per batch. If you are not physically in Alimosho, tick <i>"Demo: use my current location as the planned site"</i>, otherwise every dose will be flagged for GPS mismatch (which is also worth showing once).</li>
        <li><b>Register the "baby".</b> Enter a made-up name, date of birth, birth certificate number and LASRA ID, a guardian phone, and take a face photo. The app issues a unique ImmunTrack ID with a QR card.</li>
        <li><b>Record a vaccination.</b> Find the child, pick a vaccine that is due, choose the batch and injection site, take the point-of-care photo, then <i>Send OTP</i>. The SMS is simulated: the code appears on screen as the guardian's text message. Enter it and submit. The record is sealed and the next-dose reminder is scheduled.</li>
        <li><b>Supervisor, on a laptop.</b> Sign in as <span class="mono">supervisor · 2026</span>. The dose appears in the live feed within seconds. Open <i>Flagged records</i>, pick a record, and look at the map, the two photos, the integrity seal and the audit trail. Try <i>"Attempt direct edit"</i> to see the database refuse it.</li>
        <li><b>Try to cheat.</b> Record the same dose twice, skip the OTP, record two doses within seconds, use a batch you did not collect, or return empty vials with no doses recorded when you close the session. Each one is caught and flagged.</li>
        <li><b>Offline.</b> Turn on airplane mode, record a dose (it is saved on the phone), then turn the network back on: it syncs and shows up for the supervisor as captured offline.</li>
      </ol>
      <div class="divider"></div>
      <p class="small muted" style="margin:0">Simulated in this demo: SMS delivery, LASRA / birth-certificate lookups and the DHIS2 push (they need government credentials). Fingerprint capture is planned for Phase 2. The supervisor can reset all demo data under <i>Demo &amp; help</i>.</p>`,
  });
}

// ---------- not configured ----------
function renderSetup() {
  app.innerHTML = `<div class="login-wrap"><div class="login card" style="max-width:520px">
    <div class="brand">${logo}<span class="brand-name">ImmunTrack</span></div>
    <p class="tag">Almost there: connect the database.</p>
    <ol class="small" style="padding-left:18px;line-height:1.7">
      <li>In Supabase, run <span class="mono">supabase/schema.sql</span> in the SQL Editor.</li>
      <li>Copy the Project URL and the anon/publishable key from Project Settings → API.</li>
      <li>Paste them into <span class="mono">js/config.js</span> and redeploy.</li>
    </ol></div></div>`;
}

// ---------- sign-in ----------
function renderLogin() {
  let role = 'vaccinator';
  app.innerHTML = `<div class="login-wrap"><div class="login">
    <div class="brand">${logo}<span class="brand-name">ImmunTrack</span></div>
    <p class="tag">${esc(LGA_NAME)} · immunisation data verified at the source</p>
    <div class="seg"><button data-role="vaccinator" class="on">Vaccinator</button><button data-role="supervisor">Supervisor</button></div>
    <form class="card" id="login-form" autocomplete="on">
      <div class="field"><label for="u">Username</label><input class="input" id="u" autocomplete="username" autocapitalize="none" placeholder="e.g. sbello" required></div>
      <div class="field"><label for="p">PIN</label><input class="input" id="p" type="password" inputmode="numeric" autocomplete="current-password" placeholder="••••" required></div>
      <button class="btn primary block" id="login-btn">Sign in as Vaccinator</button>
      <div class="demo-chips" id="chips"></div>
    </form>
    <p class="notice">Competition demo: use test data only, never real children's records. <a href="#" id="guide-link">How to test</a> · <a href="#" id="theme-link">Switch theme</a></p>
  </div></div>`;
  const chips = $('#chips');
  const demo = { vaccinator: [['sbello', '1234'], ['rojo', '1234'], ['ayusuf', '1234'], ['fadeyemi', '1234']], supervisor: [['supervisor', '2026']] };
  function setRole(r) {
    role = r;
    app.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.role === r));
    $('#login-btn').textContent = 'Sign in as ' + (r === 'vaccinator' ? 'Vaccinator' : 'Supervisor');
    $('#u').placeholder = r === 'vaccinator' ? 'e.g. sbello' : 'e.g. supervisor';
    chips.innerHTML = 'Demo access (tap to fill): ' + demo[r].map(([u, p]) => `<button type="button" data-u="${u}" data-p="${p}">${u} · ${p}</button>`).join('');
  }
  app.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setRole(b.dataset.role)));
  chips.onclick = (e) => { const b = e.target.closest('button'); if (b) { $('#u').value = b.dataset.u; $('#p').value = b.dataset.p; } };
  $('#guide-link').onclick = (e) => { e.preventDefault(); showGuide(); };
  $('#theme-link').onclick = (e) => { e.preventDefault(); toggleTheme(); };
  setRole('vaccinator');
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    busy(btn, true, 'Signing in…');
    try {
      const res = await rpc('imt_login', { p_username: $('#u').value, p_pin: $('#p').value });
      if (res.user.role !== role) {
        toast(`That is a ${res.user.role} account — signing you in to the ${res.user.role} view.`);
      }
      cache.clear();
      session.set(res);
      history.replaceState(null, '', res.user.role === 'vaccinator' ? '#/today' : '#/overview');
      renderApp();
    } catch (err) {
      toast(err.message, 'err');
      busy(btn, false);
    }
  };
}

export async function signOut() {
  try { await call('imt_logout'); } catch (e) {}
  if (queue.count > 0 && !confirm(`${queue.count} record(s) on this phone have not synced yet. Sign out anyway? They stay on this phone and sync at the next sign-in.`)) return;
  session.clear();
  timers.forEach(clearInterval); timers = [];
  location.hash = '';
  renderLogin();
}

// ---------- shell ----------
function connHtml() {
  const n = queue.count;
  const on = navigator.onLine;
  return `<span class="conn"><span class="dot ${on ? 'green' : 'amber'}"></span>${on ? 'Online' : 'Offline'}${n ? ` · ${n} to sync` : ''}</span>`;
}

function renderApp() {
  const user = session.user;
  if (!user) return renderLogin();
  const mod = user.role === 'vaccinator' ? V : S;
  const nav = mod.nav;
  app.innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand">${logo}<span class="brand-name">ImmunTrack</span></div>
      <div class="brand-sub">${esc(LGA_NAME)} · ${user.role === 'vaccinator' ? 'Vaccinator' : 'Supervisor'}</div>
      <div class="who"><b>${esc(user.full_name)}</b><span>${esc(user.role === 'vaccinator' ? user.facility : 'LGA Supervisor · ' + LGA_NAME)}</span></div>
      ${nav.map((n) => `<button class="nav-item" data-go="${n.key}">${icon[n.icon]}<span>${n.label}</span>${n.badge ? `<span class="badge hidden" data-badge="${n.key}"></span>` : ''}</button>`).join('')}
      <div class="spacer"></div>
      ${user.role === 'vaccinator' ? `<div class="who" id="side-conn" style="margin:8px 0">${connHtml()}</div>` : ''}
      <button class="nav-item" id="guide-btn">${icon.help}<span>How to test</span></button>
      <button class="nav-item" id="theme-btn">${icon.moon}<span>Toggle theme</span></button>
      <button class="nav-item" id="out-btn">${icon.out}<span>Sign out</span></button>
    </aside>
    <div>
      <header class="topbar">${logo}<div class="grow"><div class="brand-name">ImmunTrack</div><div class="sub">${esc(user.full_name)} · ${esc(user.role === 'vaccinator' ? user.facility : 'Supervisor')}</div></div>
        <span id="top-conn">${user.role === 'vaccinator' ? connHtml() : ''}</span>
        <button class="x" id="theme-btn-m" aria-label="Theme">${icon.moon}</button><button class="x" id="out-btn-m" aria-label="Sign out">${icon.out}</button></header>
      <main class="main" id="main"></main>
    </div>
    <nav class="tabbar">${nav.map((n) => `<button data-go="${n.key}">${icon[n.icon]}<span>${n.short || n.label}</span>${n.badge ? `<span class="badge hidden" data-badge="${n.key}"></span>` : ''}</button>`).join('')}</nav>
  </div>`;
  app.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { location.hash = '#/' + b.dataset.go; }));
  $('#theme-btn').onclick = toggleTheme; $('#theme-btn-m').onclick = toggleTheme;
  $('#out-btn').onclick = signOut; $('#out-btn-m').onclick = signOut;
  $('#guide-btn').onclick = showGuide;

  timers.forEach(clearInterval); timers = [];
  if (user.role === 'vaccinator') {
    const beat = () => { if (navigator.onLine) call('imt_heartbeat', { p_pending: queue.count }).catch(() => {}); };
    beat(); timers.push(setInterval(beat, 45000));
    timers.push(setInterval(() => { if (navigator.onLine && queue.count) syncQueue(); }, 30000));
    if (navigator.onLine && queue.count) syncQueue();
  } else {
    const badge = () => S.refreshBadge && S.refreshBadge(setBadge);
    badge(); timers.push(setInterval(badge, 20000));
  }
  route();
}

export function setBadge(key, n) {
  document.querySelectorAll(`[data-badge="${key}"]`).forEach((b) => { b.textContent = n; b.classList.toggle('hidden', !n); });
}

function refreshConn() {
  const html = connHtml();
  const a = document.getElementById('top-conn'), b = document.getElementById('side-conn');
  if (session.user?.role !== 'vaccinator') return;
  if (a) a.innerHTML = html; if (b) b.innerHTML = html;
}

// ---------- routing ----------
async function route() {
  const user = session.user;
  if (!user) return renderLogin();
  const mod = user.role === 'vaccinator' ? V : S;
  const [key, ...rest] = (location.hash.replace(/^#\/?/, '') || mod.nav[0].key).split('/');
  const page = mod.pages[key] ? key : mod.nav[0].key;
  document.querySelectorAll('[data-go]').forEach((b) => b.classList.toggle('active', b.dataset.go === page || (mod.parent?.[page] === b.dataset.go)));
  if (typeof cleanup === 'function') { try { cleanup(); } catch (e) {} }
  cleanup = null;
  // close any dialog left open (this also stops the camera if it was running)
  document.querySelectorAll('#modal-root .modal-bg').forEach((bg) => bg.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const main = document.getElementById('main');
  if (!main) return;
  // each navigation renders into its own container, so a slow page that finishes late can never paint over the next one
  const nav = ++navSeq;
  const view = document.createElement('div');
  view.innerHTML = '<div class="empty">Loading…</div>';
  main.replaceChildren(view);
  window.scrollTo(0, 0);
  try {
    const done = await mod.pages[page](view, rest.map(decodeURIComponent));
    if (nav !== navSeq) { if (typeof done === 'function') done(); return; }
    cleanup = done;
  } catch (e) {
    if (nav !== navSeq) return;
    view.innerHTML = `<div class="card"><div class="empty">${esc(e.message || 'Could not load this page.')}<br><br><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { refreshConn(); toast('Back online.', 'ok'); if (session.user?.role === 'vaccinator') syncQueue(); });
window.addEventListener('offline', () => { refreshConn(); toast('You are offline. Records will be saved on this phone and synced later.'); });
window.addEventListener('imt:queue', refreshConn);
window.addEventListener('imt:synced', (e) => {
  refreshConn();
  const { synced, failed } = e.detail;
  if (synced) toast(`${synced} offline record(s) synced to the server.`, 'ok');
  if (failed) toast(`${failed} record(s) could not sync — see My activity.`, 'err');
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (!CONFIGURED) renderSetup();
else if (session.get()) renderApp();
else renderLogin();
