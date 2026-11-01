// Data layer: Supabase RPC calls, sign-in session, offline queue and local cache.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const CONFIGURED = !!SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT') && !!SUPABASE_KEY && !SUPABASE_KEY.includes('YOUR-');

const ls = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
export const store = ls;

// ---------- session ----------
export const session = {
  get() { return ls.get('imt_session'); },
  set(s) { ls.set('imt_session', s); },
  clear() { ls.del('imt_session'); },
  get token() { return this.get()?.token; },
  get user() { return this.get()?.user; },
};

export class ApiError extends Error {
  constructor(msg, { offline = false, status = 0 } = {}) { super(msg); this.offline = offline; this.status = status; }
}

function cleanMessage(m) {
  return String(m || 'Something went wrong.').replace(/^DUPLICATE:\s*/, '');
}

export async function rpc(fn, args = {}) {
  if (!CONFIGURED) throw new ApiError('The app is not connected to a database yet. Add your Supabase URL and key in js/config.js.');
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + SUPABASE_KEY;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch (e) {
    throw new ApiError('No network connection.', { offline: true });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = cleanMessage(data?.message || data?.hint || res.statusText);
    if (res.status >= 500 && !data?.message) throw new ApiError('The server is not reachable right now.', { offline: true, status: res.status });
    if (/session has expired/i.test(msg)) { session.clear(); setTimeout(() => location.reload(), 1200); }
    throw new ApiError(msg, { status: res.status });
  }
  return data;
}

// call with the signed-in token
export const call = (fn, args = {}) => rpc(fn, { p_token: session.token, ...args });

// ---------- offline queue (vaccinator) ----------
const QKEY = 'imt_queue';
export const queue = {
  all() { return ls.get(QKEY, []); },
  save(q) { ls.set(QKEY, q); window.dispatchEvent(new CustomEvent('imt:queue')); },
  add(item) { const q = this.all(); q.push({ ...item, queued_at: new Date().toISOString() }); this.save(q); },
  get count() { return this.all().filter((i) => !i.error).length; },
};

let syncing = false;
export async function syncQueue() {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    const q = queue.all();
    const keep = [];
    for (let i = 0; i < q.length; i++) {
      const it = q[i];
      if (it.error) { keep.push(it); continue; }
      try {
        if (it.kind === 'child') {
          const child = await call('imt_register_child', { p: it.payload });
          cache.upsertChild(child);
          cache.removePendingChild(it.payload.client_ref);
        } else if (it.kind === 'dose') {
          await call('imt_record_dose', { p: it.payload });
        }
        synced++;
      } catch (e) {
        if (e.offline) { keep.push(...q.slice(i)); break; }
        failed++;
        keep.push({ ...it, error: e.message });
      }
    }
    queue.save(keep);
  } finally {
    syncing = false;
    window.dispatchEvent(new CustomEvent('imt:synced', { detail: { synced, failed } }));
  }
  return { synced, failed };
}

// ---------- local cache (lets the vaccinator search and record while offline) ----------
export const cache = {
  children() { return ls.get('imt_children', []); },
  setChildren(list) { ls.set('imt_children', (list || []).slice(0, 150)); },
  upsertChild(c) {
    if (!c || !c.id) return;
    const list = this.children().filter((x) => x.id !== c.id);
    list.unshift(c); this.setChildren(list);
  },
  pendingChildren() { return ls.get('imt_pending_children', []); },
  addPendingChild(c) { const l = this.pendingChildren(); l.unshift(c); ls.set('imt_pending_children', l); },
  removePendingChild(ref) { ls.set('imt_pending_children', this.pendingChildren().filter((c) => c.client_ref !== ref)); },
  ref() { return ls.get('imt_ref'); },
  setRef(r) { ls.set('imt_ref', r); },
  home() { return ls.get('imt_home'); },
  setHome(h) { ls.set('imt_home', h); },
  clear() { ['imt_children', 'imt_pending_children', 'imt_ref', 'imt_home'].forEach((k) => ls.del(k)); },
};

export async function loadReference(force = false) {
  const cached = cache.ref();
  if (cached && !force) { call('imt_reference').then((r) => cache.setRef(r)).catch(() => {}); return cached; }
  try { const r = await call('imt_reference'); cache.setRef(r); return r; }
  catch (e) { if (cached) return cached; throw e; }
}

// ---------- device helpers ----------
export function getPosition(timeout = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ error: 'This device has no GPS / location support.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), accuracy: Math.round(p.coords.accuracy) }),
      (e) => resolve({ error: e.code === 1 ? 'Location permission was refused. Allow location for this site in your browser settings.' : 'Could not get a GPS fix. Move to an open area and try again.' }),
      { enableHighAccuracy: true, timeout, maximumAge: 20000 });
  });
}

export function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, toR = (x) => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
