// Shared UI helpers
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icon = {
  home: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  userPlus: P('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M19 8v6M16 11h6"/>'),
  syringe: P('<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3a2 2 0 0 1-2.8 0l-1.2-1.2a2 2 0 0 1 0-2.8L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  activity: P('<path d="M3 12h4l3 8 4-16 3 8h4"/>'),
  grid: P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c0-3-1.8-5.5-4.5-6.3"/>'),
  flag: P('<path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/>'),
  box: P('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  file: P('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>'),
  child: P('<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  out: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  camera: P('<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>'),
  pin: P('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>'),
  check: P('<path d="M20 6 9 17l-5-5"/>'),
  shield: P('<path d="M12 3 4 6v6c0 5 3.4 8.6 8 9.9 4.6-1.3 8-4.9 8-9.9V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  shieldX: P('<path d="M12 3 4 6v6c0 5 3.4 8.6 8 9.9 4.6-1.3 8-4.9 8-9.9V6z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>'),
  warn: P('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  sms: P('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  sync: P('<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>'),
  wifiOff: P('<path d="m2 2 20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.3-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5"/><path d="M12 20h.01"/>'),
  help: P('<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>'),
  print: P('<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>'),
  download: P('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>'),
  upload: P('<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>'),
};

export const logo = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#2f6fed"/><path d="M16 6.5 8.5 9.3v5.9c0 4.7 3.2 8.4 7.5 9.8 4.3-1.4 7.5-5.1 7.5-9.8V9.3z" fill="#fff" opacity=".18"/><path d="M16 6.5 8.5 9.3v5.9c0 4.7 3.2 8.4 7.5 9.8 4.3-1.4 7.5-5.1 7.5-9.8V9.3z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="m12.4 15.6 2.6 2.6 4.8-5.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- formatting ----------
const TZ = 'Africa/Lagos';
export const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
export const fmtDate = (d) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—';
export const fmtDT = (d) => d ? `${fmtDate(d)}, ${fmtTime(d)}` : '—';
export const fmtShort = (d) => {
  if (!d) return '—';
  const dt = new Date(d), now = new Date();
  const same = dt.toLocaleDateString('en-GB', { timeZone: TZ }) === now.toLocaleDateString('en-GB', { timeZone: TZ });
  return same ? fmtTime(d) : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ }) + ' ' + fmtTime(d);
};
export const ago = (d) => {
  if (!d) return 'never';
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago';
};
export const ageText = (dob) => {
  if (!dob) return '';
  const days = Math.floor((Date.now() - new Date(dob + 'T00:00:00')) / 86400000);
  if (days < 0) return '';
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 98) return `${Math.floor(days / 7)} weeks`;
  if (days < 730) return `${Math.floor(days / 30.4)} months`;
  return `${Math.floor(days / 365.25)} years`;
};
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
export const avatar = (name, photo, cls = '') => `<div class="avatar ${cls}">${photo ? `<img src="${esc(photo)}" alt="">` : esc(initials(name))}</div>`;
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2));

export function doseStatusChip(d) {
  if (d.status === 'voided') return '<span class="chip red">Voided</span>';
  if (d.pending) return '<span class="chip amber">Waiting to sync</span>';
  if (d.flag_status === 'open') return '<span class="chip red">Flagged</span>';
  if (d.flag_status === 'accepted') return '<span class="chip blue">Reviewed</span>';
  if (d.flag_status === 'amended') return '<span class="chip blue">Amended</span>';
  if (d.otp_status === 'verified') return '<span class="chip green">Verified</span>';
  return '<span class="chip amber">OTP pending</span>';
}

export const banner = (kind, html, ic = { amber: icon.warn, red: icon.warn, green: icon.check, blue: icon.info }[kind]) =>
  `<div class="banner ${kind}">${ic}<div>${html}</div></div>`;

// ---------- toast ----------
export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6500 : 3800);
}

// ---------- modal ----------
export function modal({ title, body, foot = '', wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-h"><h3>${title}</h3><button class="x" data-close aria-label="Close">${icon.x}</button></div>
    <div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  root.appendChild(bg);
  const close = () => { bg.remove(); onClose && onClose(); };
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  return { el: bg.querySelector('.modal'), close };
}

export function confirmBox(title, html, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title, body: html, foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${okLabel}</button>`,
      onClose: () => { if (!done) resolve(false); } });
    m.el.querySelector('[data-ok]').onclick = () => { done = true; m.close(); resolve(true); };
  });
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = label || 'Please wait…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}

export function qrSvg(text) {
  try {
    if (!window.qrcode) return '';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } catch (e) { return ''; }
}

export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
