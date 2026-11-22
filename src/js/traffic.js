import { api, bus, Store } from "./store.js";
import { panelNow } from "./util.js";

export const trafficView = { range: "all", from: "", to: "" };
const DAY_RANGES = ["all", "today", "7d", "30d", "month"];
// The peer, user and group windows keep a window of their own: a graph over all time can hold years of columns, so they
// open on Week and offer Day · Week · Month · Custom. Held for the page's life, like the grids' window.
export const trafficModalView = { range: "7d", from: "", to: "" };

// The panel's own today (YYYY-MM-DD) — days are counted in ITS zone (Settings → Display), not the browser's. A custom
// window is capped here: a browser ahead of the panel's zone would otherwise ask for a day the panel has not reached.
export function panelToday(nowMs) {
  const tz = (Store.panelSettings || {}).time_zone_now || {};
  const off = typeof tz.offset === "number" ? tz.offset : -new Date().getTimezoneOffset() * 60;
  return new Date((nowMs == null ? panelNow() : nowMs) + off * 1000).toISOString().slice(0, 10);
}

export function trafficQuery(v) {
  v = v || trafficView;
  if (v.window) return "window=" + v.window;
  if (v.range === "custom" && v.from && v.to) return "range=custom&from=" + v.from + "&to=" + v.to;
  return "range=" + (DAY_RANGES.includes(v.range) ? v.range : "all");
}
export function customWindow(from, to, today, min) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from || "") || !re.test(to || "") || from < "1970-01-01") return { ok: false, why: "incomplete" };
  const t = to > today ? today : to;
  if (from > t) return { ok: false, why: from > today ? "future" : "order" };
  if (min && from < min) return { ok: false, why: "early" };
  return { ok: true, from, to: t };
}
// The first day a custom chart window can start on: the panel's today and the 32 days before it — what the coarsest ring
// holds (swg-panel-server RANGE_CUSTOM_DAYS). The server refuses an earlier one; this keeps the picker from offering it.
export const CHART_DAYS = 33;
export function chartsFirstDay(today) {
  const d = new Date((today || panelToday()) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - (CHART_DAYS - 1));
  return d.toISOString().slice(0, 10);
}
// A window that ended before the panel's today never changes: fetched once, kept.
export function trafficImmutable(v, today) {
  v = v || trafficView;
  return v.range === "custom" && !!v.from && !!v.to && v.to < (today || panelToday());
}

export function foldTotals(rows) {
  const peer = new Map(), user = new Map(), slot = new Map(), byUser = new Map(), free = new Map();
  const add = (m, k, r, extra) => {
    let a = m.get(k);
    if (!a) m.set(k, a = { rx: 0, tx: 0, lifetime_rx: 0, lifetime_tx: 0, opening_rx: 0, opening_tx: 0, opening_at: 0,
      since: 0, owners: 0, devices: 0, ...extra });
    a.rx += r.rx || 0; a.tx += r.tx || 0;
    a.lifetime_rx += r.lifetime_rx || 0; a.lifetime_tx += r.lifetime_tx || 0;
    a.opening_rx += r.opening_rx || 0; a.opening_tx += r.opening_tx || 0;
    if (r.opening_at) a.opening_at = a.opening_at ? Math.min(a.opening_at, r.opening_at) : r.opening_at;
    if (r.since) a.since = a.since ? Math.min(a.since, r.since) : r.since;
    return a;
  };
  for (const r of rows || []) {
    const uid = r.owner || "";
    add(peer, r.id, r).owners++;
    if (uid) {
      add(user, uid, r).devices++;
      add(slot, uid + "|" + r.id, r, { name: r.name || "", until: r.until || null });   // one row per (peer, owner)
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid).push(r);
    } else add(free, r.id, r);
  }
  return { peer, user, slot, rows: byUser, free };
}

export function talkerGroups(d, inScope) {
  const out = [];
  const ok = inScope || (() => true);
  for (const [uid, a] of d.user) {
    if (!Store.user(uid)) continue;
    const devs = [...new Set((d.rows.get(uid) || []).map(r => r.id))];
    if (inScope && !devs.some(id => { const p = Store.peer(id); return p && p.user_id === uid && ok(id); })) continue;
    out.push({ uid, rx: a.rx, tx: a.tx, devices: devs.map(id => {
      const s = d.slot.get(uid + "|" + id) || {}, p = Store.peer(id);
      return { id, rx: s.rx || 0, tx: s.tx || 0, name: (p && p.title) || s.name || "", gone: !p ? "deleted" : p.user_id !== uid ? "handed" : "", peer: p };
    }) });
  }
  for (const [pid, a] of d.free) {
    const p = Store.peer(pid);
    if (p && !p.user_id && ok(pid)) out.push({ uid: null, pid, rx: a.rx, tx: a.tx, devices: [] });
  }
  return out.filter(g => g.rx + g.tx > 0).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
}

// ── the totals cache ────────────────────────────────────────────────────────────────────────────────────────────
const TTL_MS = 60000;
const BUSY_MS = 3000;     // a 503 `busy` (the ledger's writer is in the way — a slow disk) is asked again after this, not a minute
const _tot = new Map();   // query → { at, busy, data, off, err }
let _gen = 0;

function _fetchTotals(q, e) {
  e.busy = true;
  api.get("/api/traffic-totals?by=slot&" + q).then(r => {
    e.busy = false; e.at = Date.now();
    if (r && r.ok && r.data) {
      e.data = { ...foldTotals(r.data.rows), q, gen: ++_gen, from: r.data.from, to: r.data.to,
        since: r.data.since, until: r.data.until, asked: r.data.asked || 0, gaps: r.data.gaps || {} };
      e.off = null; e.err = null;
    } else {
      e.off = r && r.code === "ledger_off" ? r : null;   // the whole reply: srvText() translates its sentence
      e.err = e.off ? null : (r || { error: "error" });
      if (r && r.code === "busy") e.at = Date.now() - TTL_MS + BUSY_MS;   // the history is being written: ask again soon
    }
    bus.emit();
  }).catch(err => { e.busy = false; e.at = Date.now(); e.err = String(err && err.message || err); bus.emit(); });
}

// The current window's totals, or null until they land. Safe to call on every render.
export function trafficTotals(v, nowMs) {
  const q = trafficQuery(v);
  let e = _tot.get(q);
  const now = nowMs == null ? Date.now() : nowMs;
  if (!e) { _tot.set(q, e = { at: 0, busy: false, data: null, off: null, err: null }); _fetchTotals(q, e); }
  else if (!e.busy && now - e.at > TTL_MS && !(e.data && trafficImmutable(v))) _fetchTotals(q, e);
  return e;
}
export const trafficData = v => trafficTotals(v).data;

export function trafficFreezeTag(v) {
  const e = _tot.get(trafficQuery(v));
  return trafficQuery(v) + (e && e.data ? ":in" : ":wait");
}

// ── series (the peer and user graphs) ───────────────────────────────────────────────────────────────────────────
const _ser = new Map();   // by|id|query → { at, busy, data, err }
export function trafficSeries(by, id, v, keyExtra) {   // keyExtra: what else the answer depends on (a group's members)
  const q = trafficQuery(v), k = by + "|" + id + "|" + q + (keyExtra ? "|" + keyExtra : "");
  let e = _ser.get(k);
  if (e && (e.busy || Date.now() - e.at <= TTL_MS || (e.data && trafficImmutable(v)))) return e;
  if (!e) _ser.set(k, e = { at: 0, busy: false, data: null, err: null });
  e.busy = true;
  api.get("/api/traffic-series?by=" + by + "&id=" + encodeURIComponent(id) + "&" + q).then(r => {
    e.busy = false; e.at = Date.now();
    if (r && r.ok && r.data) { e.data = r.data; e.err = null; }
    else { e.err = (r && r.error) || "error"; if (r && r.code === "busy") e.at = Date.now() - TTL_MS + BUSY_MS; }
    bus.emit();
  }).catch(err => { e.busy = false; e.at = Date.now(); e.err = String(err && err.message || err); bus.emit(); });
  return e;
}

export function volumeColumns(points, since, until, max) {
  max = max || 120;
  const pts = points || [];
  // A day point's step is 23 or 25 hours on a DST day: day points are days (86400), placed by their NEAREST day —
  // taking the 23-hour step as the width, the columns drifted off midnight and two days fell into one.
  const byDay = !pts.length || pts.every(p => (p[1] || 86400) >= 82800);
  const step0 = byDay ? 86400 : Math.min(...pts.map(p => p[1] || 86400));
  const span = Math.max(1, (until || since + step0) - since);
  const k = Math.max(1, Math.ceil(span / step0 / max));
  const step = step0 * k, n = Math.max(1, Math.ceil(span / step));
  const cols = Array.from({ length: n }, (_, i) => ({ start: since + i * step, step, rx: 0, tx: 0 }));
  for (const [start, , rx, tx] of pts) {
    const i = Math.min(n - 1, Math.max(0, byDay ? Math.floor(Math.round((start - since) / 86400) / k) : Math.floor((start - since) / step)));
    cols[i].rx += rx || 0; cols[i].tx += tx || 0;
  }
  return cols;
}

// ── usage (Settings → Display → Data) ───────────────────────────────────────────────────────────────────────────
const _use = { at: 0, busy: false, data: null, err: null };
export function statsUsage(force) {
  if (!_use.busy && (force || !_use.data || Date.now() - _use.at > TTL_MS)) {
    _use.busy = true;
    api.get("/api/stats-usage").then(r => {
      _use.busy = false; _use.at = Date.now();
      if (r && r.ok) { _use.data = r.data; _use.err = null; } else _use.err = (r && r.error) || "error";
      bus.emit();
    }).catch(err => { _use.busy = false; _use.at = Date.now(); _use.err = String(err && err.message || err); bus.emit(); });
  }
  return _use;
}
// After a settings save: the next read is fresh (a new window's totals, the sweep's effect on the read-out).
export function trafficInvalidate() { _tot.clear(); _ser.clear(); _use.at = 0; }
