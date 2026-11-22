import { tkey, seen, fmtBytes, isMobile } from "./util.js";
import { lossColor, lossColorMesh } from "./charts.js";
import { Store, api, bus, isCustomKey, customKeyWindow, useStore } from "./store.js";
import { ifaceIsAwg, ifaceMatch, ifaceIsAll, nodeStale, tgtXfer, tgtSeenAge,
         isWdttName, isCsqttName, isSelfContainedName } from "./model.js";
import { go } from "./router.js";
import { statusLabel, Popover, Ic, Tag, toast, inProc, setPendingSection, Sheet, closeModal, openChildOrRoot } from "./ui.js";
import { subFeatureOn } from "./crypto.js";
import { T, plural, pluralWord, fmtNum, srvText, locale } from "./i18n.js";
import { trafficData, trafficFreezeTag, trafficView, chartsFirstDay } from "./traffic.js";
import { h } from "preact";
import { useState, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export const reachOpts = () => [["everyone", T("Everyone on this node")], ["user", T("Same user and their groups")], ["none", T("Nobody")]];
export const reachSkipText = (nname, why) => why === "overlap"
  ? T("Not enforced on {node} — this interface's subnet overlaps another interface's.", { node: nname })
  : why === "no_address" ? T("Not enforced on {node} — the node can't read this interface's address.", { node: nname })
  : why === "not_here" ? T("Not enforced on {node} — the node doesn't run this interface.", { node: nname })
  : T("Not enforced on {node}.", { node: nname });
export const reachStaleText = (nname, st) => T("Couldn't apply the latest change on {node}: {detail}. The previous rules stay in force.",
  { node: nname, detail: st.detail || st.why || "" });
export const fmtWhen = s => { try { return new Date(s * 1000).toLocaleString(locale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };

export function ReachField({ node, iface, value, onChange, create, unvouched, unvouchedRaw }) {
  const label = T("Who can open connections to devices here");
  const snap = node ? (Store.stats[node] || {}) : {};
  const st = snap.dev_reach;
  const nname = node ? Store.nodeName(node) : "";
  const mine = !!(st && (st.ifaces || []).includes(iface));
  const skipped = st && st.skipped ? st.skipped[iface] : null;
  const when = fmtWhen;
  let status = null;
  const _promoted = value === "everyone" && !create && node && promotedAt(node, iface);
  if (!create && node && (value !== "everyone" || _promoted) && Store.recon.nodeStatus[node] === "live") {
    if (!((snap.net_deps || {}).reach >= 2)) status = html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Not enforced on {node} — it runs an older version. Update it.", { node: nname })}</span></div>`;
    else if (st && st.ok === false && st.stale) status = html`<div class="formmsg err">${reachStaleText(nname, st)}</div>`;
    else if (st && st.ok === false && mine) status = html`<div class="formmsg err">${T("Couldn't apply on {node}: {detail}", { node: nname, detail: st.detail || st.why || "" })}</div>`;
    else if (skipped) status = html`<div class="notice warn"><${Ic} i="warn"/><span>${reachSkipText(nname, skipped)}</span></div>`;
    else if (st && st.ok && mine) status = html`<div class="hint">${T("Packets to devices here stopped since {when}: {n}", { when: when(st.since), n: (st.blocked || {})[iface] || 0 })}</div>`;
    else status = html`<div class="hint">${T("Applies on {node}'s next sync.", { node: nname })}</div>`;
  }
  return html`<div class="field reachfield">
    <label>${label}</label>
    <div class="dpsw netsw-share" role="radiogroup" aria-label=${label}>${reachOpts().map(([m, l]) => html`<button type="button" role="radio"
      aria-checked=${value === m} class=${value === m ? "on" : ""} onClick=${() => onChange(m)}>${l}</button>`)}</div>
    <div class="hint">${value === "everyone" && _promoted
      ? T("Any device on this node can open connections to devices here, except the ones marked Private — only their user's own devices reach those.")
      : value === "everyone"
      ? T("Any device on this node can open connections to devices here. Internet access and networks behind devices are not affected.")
      : value === "none"
      ? T("No other device can open connections to devices here; their own connections still work. Internet access and networks behind devices are not affected.")
      : T("A device here can be reached by its user's other devices on this node and by users who share a group with them. Internet access and networks behind devices are not affected.")}</div>
    ${unvouched && value === "user" ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This server build can't prove which user a device belongs to, so no other device can reach any device here.")}</span></div>` : null}
    ${unvouchedRaw && !unvouched && value === "user" ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This server build can't prove which user a device connected over RAW belongs to, so no other device can reach those devices.")}</span></div>` : null}
    ${status}
  </div>`;
}

const PEER_STATUS_KEYS = ["", "online", "ready", "unassigned", "disabled", "expired", "expiring", "blocking",
  "restoring", "dangling", "broken", "partial", "blocked", "faulty", "pending", "unknown"];
export const pageSizeOpts = () => [20, 30, 50, 100].map(n => ({ value: n, label: String(n) }));
export const peerStatusFilters = () => PEER_STATUS_KEYS.map(k => ({ value: k, label: k ? statusLabel(k) : T("All statuses") }));

export function ifaceOptGroups(names) {
  const wdtt = names.filter(isWdttName);
  const csqtt = names.filter(isCsqttName);
  const awg = names.filter(n => !isSelfContainedName(n) && ifaceIsAwg(n));
  const wg = names.filter(n => !isSelfContainedName(n) && !ifaceIsAwg(n));
  const groups = [["*awg", "AmneziaWG", awg], ["*wg", "WireGuard", wg], ["*wdtt", "WDTT", wdtt], ["*csqtt", "CSQTT", csqtt]].filter(g => g[2].length);
  if (groups.length < 2) return names.map(i => ({ value: i, label: i }));
  return [...groups.filter(([, , arr]) => arr.length > 1).map(([val, label]) => ({ value: val, label: T("All {v1}", { v1: label }) })),
          ...groups.map(([, label, arr]) => ({ group: label, items: arr.map(i => ({ value: i, label: i })) }))];
}
export function nodeFilterOptions(allVal) {
  const ns = Store.nodes || [];
  if (!ns.length) return [{ value: allVal, label: T("No nodes") }];
  if (ns.length === 1) return [{ value: allVal, label: ns[0].name }];
  return [{ value: allVal, label: T("All nodes") }, ...ns.map(n => ({ value: n.id, label: n.name }))];
}
export function ifaceFilterOptions(names, allVal) {
  if (!names.length) return [{ value: allVal, label: T("No interfaces") }];
  if (names.length === 1) return [{ value: allVal, label: names[0] }];
  return [{ value: allVal, label: T("All interfaces") }, ...ifaceOptGroups(names)];
}

const _ipKey = ip => String(ip || "").split(/[./]/).map(n => String((+n) || 0).padStart(3, "0")).join(".");
export const PEER_STATUS_RANK = { online: 10, faulty: 9, ready: 8, expiring: 8, blocked: 7, partial: 6, pending: 5, creating: 5, rotating: 5, restoring: 4, unassigned: 3, unknown: 2, dangling: 1, broken: 1, blocking: 0, disabled: 0, expired: 0 };
export const PEER_SORT = {
  status: ({ p, t }) => PEER_STATUS_RANK[t.status || p.status] || 0,
  server: ({ t }) => Store.nodeName(t.node).toLowerCase() + "|" + t.iface,
  user: ({ p }) => { const u = p.user_id ? Store.user(p.user_id) : null; return u ? u.name.toLowerCase() : "￿"; },
  title: ({ p }) => String(p.title || p.name || "").toLowerCase(),
  address: ({ t }) => _ipKey(t.ip),
  endpoint: ({ t }) => ((t.observed && t.observed.endpoint) || "￿").toLowerCase(),
  online: ({ t }) => { const a = tgtSeenAge(t); return a != null ? a : Infinity; },
  rate: ({ t }) => { const x = tgtXfer(t); return x ? (x.rx_speed || 0) + (x.tx_speed || 0) : 0; },
  total: ({ t }) => { const x = tgtXfer(t); return x ? (x.rx_bytes || 0) + (x.tx_bytes || 0) : 0; },
  rtotal: ({ p, o }) => { const a = peerTraffic(p.id, o); return a ? a.rx + a.tx : 0; },
};
export const PEER_DEFDIR = { status: -1, rate: -1, total: -1, rtotal: -1, online: 1, title: 1, user: 1, server: 1, address: 1, endpoint: 1 };
export function peerTraffic(pid, owner) {
  const d = trafficData();
  return d ? (owner ? d.slot.get(owner + "|" + pid) : d.peer.get(pid)) || null : null;
}
export function userTraffic(uid) { const d = trafficData(); return d ? d.user.get(uid) || null : null; }
const rtotalTag = sort => sort === "rtotal" ? "|" + trafficFreezeTag() : "";
export function trafficRangeLabel(v) {
  v = v || trafficView;
  if (v.range === "all") return T("All time");
  if (v.range === "today") return T("Today");
  if (v.range === "7d") return T("Last 7 days");
  if (v.range === "30d") return T("Last 30 days");
  if (v.range === "custom" && v.from && v.to) {
    const f = d => { try { return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z")); } catch (_) { return d; } };
    return v.from === v.to ? f(v.from) : f(v.from) + " – " + f(v.to);
  }
  return v.range === "month" ? T("This month") : T("All time");
}
const _orderFreeze = {};
export function stableOrder(freezeKey, items, idOf, cmp) {
  const frozen = _orderFreeze[freezeKey];
  if (!frozen) { const s = items.slice().sort(cmp); _orderFreeze[freezeKey] = s.map(idOf); return s; }
  const pos = new Map(frozen.map((id, i) => [id, i]));
  const s = items.slice().sort((a, b) => {
    const ai = pos.has(idOf(a)) ? pos.get(idOf(a)) : Infinity;
    const bi = pos.has(idOf(b)) ? pos.get(idOf(b)) : Infinity;
    return ai !== bi ? ai - bi : cmp(a, b);
  });
  if (items.length !== frozen.length || items.some(it => !pos.has(idOf(it)))) _orderFreeze[freezeKey] = s.map(idOf);
  return s;
}
export function sortPeerRows(rows, sort, dir, freeze) {
  const key = PEER_SORT[sort] || PEER_SORT.status;
  const cmp = (a, b) => ((x, y) => x < y ? -1 : x > y ? 1 : 0)(key(a), key(b)) * (dir || -1)
    || String(a.p.title || a.p.name || "").localeCompare(String(b.p.title || b.p.name || ""));
  const s = freeze ? stableOrder(freeze + "|" + sort + "|" + dir + rtotalTag(sort), rows, r => r.p.id + "|" + tkey(r.t.node, r.t.iface), cmp)
    : rows.slice().sort(cmp);
  return pinRecentlyCreated(s, r => r.p.id);
}
export function pinRecentlyCreated(sorted, idOf) {
  const rc = Store.recentlyCreated;
  if (!rc || !sorted.some(x => rc[idOf(x)])) return sorted;
  const pin = [], rest = [];
  for (const x of sorted) (rc[idOf(x)] ? pin : rest).push(x);
  pin.sort((a, b) => (rc[idOf(b)] || 0) - (rc[idOf(a)] || 0));
  return pin.concat(rest);
}
export function peerSortBy(view, col) { if (view.sort === col) view.dir = -view.dir; else { view.sort = col; view.dir = PEER_DEFDIR[col] || 1; } }
export function pageScroll(e, dir) {
  const pager = e.currentTarget && e.currentTarget.closest(".pager");
  const grid = pager && pager.previousElementSibling;
  if (!grid) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = grid.getBoundingClientRect();
    const y = dir > 0 ? window.scrollY + r.top - 120 : window.scrollY + r.bottom - window.innerHeight + 64;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }));
}


export const usersView = { q: "", status: "", node: "", iface: "", page: 1, pageSize: 20, sort: "status", dir: -1, expanded: {},
  mode: "users", group: "", online: false,
  gq: "", gpage: 1, gpageSize: 20, gsort: "name", gdir: 1, gexpanded: {} };
export function clearUserFilters() { usersView.group = ""; usersView.node = ""; usersView.iface = ""; usersView.online = false; usersView.status = ""; }
export const groupMemberViews = {};
export const unassignedView = { node: "", iface: "", q: "", page: 1, pageSize: 20, sort: "status", dir: -1 };
export const userPeerViews = {};

export function userStatTag(user) {
  const s = user.peerCount ? user.status : "empty";
  return html`<span class=${"ustat s-" + s}>${s === "empty" ? T("No peers") : statusLabel(s)}</span>`;
}
export function userStats(uid) {
  let rx = 0, tx = 0, rxb = 0, txb = 0, last = null;
  for (const p of Store.peersByUser(uid)) for (const t of p.targets) {
    const o = tgtXfer(t); if (!o) continue;
    rx += o.rx_speed || 0; tx += o.tx_speed || 0; rxb += o.rx_bytes || 0; txb += o.tx_bytes || 0;
    if (o.handshake_age != null) last = (last == null) ? o.handshake_age : Math.min(last, o.handshake_age);
  }
  return { rx, tx, rxb, txb, last };
}
export function searchMatch(hay, q) {
  if (!q) return true;
  hay = String(hay).toLowerCase();
  return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}
export function peerMatchesQ(p, q) {
  if (!q) return true;
  const hay = (p.title || "") + " " + (p.name || "") + " " + (p.pubkey || "") + " "
    + p.targets.map(t => (t.ip || "") + " " + Store.nodeName(t.node) + " " + t.iface).join(" ");
  return searchMatch(hay, q);
}
export function userIdentityMatchesQ(u, q) { return searchMatch((u.name || "") + " " + (u.tag || "") + " " + (u.note || ""), q); }
export function userMatchesQ(u, q) {
  if (!q) return true;
  if (userIdentityMatchesQ(u, q)) return true;
  return Store.peersByUser(u.id).some(p => peerMatchesQ(p, q));
}
export function userOnNodeIface(u, node, iface) {
  const anyIface = !iface || iface === "*";
  if (!node && anyIface) return true;
  return Store.peersByUser(u.id).some(p => p.targets.some(t => (!node || node === "*" || t.node === node) && ifaceMatch(t.iface, iface, t)));
}
export const USER_SORT = {
  status: u => PEER_STATUS_RANK[u.status] || 0, name: u => (u.name || "").toLowerCase(),
  peers: u => u.peerCount || 0, online: u => u.onlineCount || 0,
  last: u => { const s = userStats(u.id); return s.last == null ? Infinity : s.last; },
  rate: u => { const s = userStats(u.id); return s.rx + s.tx; },
  total: u => { const s = userStats(u.id); return s.rxb + s.txb; },
  rtotal: u => { const a = userTraffic(u.id); return a ? a.rx + a.tx : 0; },
  nodes: u => { const nm = {}; let ifs = 0; for (const p of Store.peersByUser(u.id)) for (const t of p.targets) { const s = nm[t.node] = nm[t.node] || new Set(); if (!s.has(t.iface)) { s.add(t.iface); ifs++; } } return Object.keys(nm).length * 10000 + ifs; },
};
export const USER_DEFDIR = { status: -1, peers: -1, online: -1, last: 1, rate: -1, total: -1, rtotal: -1, name: 1, nodes: -1 };
export function sortUsers(users, sort, dir, freeze) {
  const key = USER_SORT[sort] || USER_SORT.status;
  const cmp = (a, b) => ((x, y) => x < y ? -1 : x > y ? 1 : 0)(key(a), key(b)) * (dir || -1) || String(a.name).localeCompare(String(b.name));
  const s = freeze ? stableOrder(freeze + "|" + sort + "|" + dir + rtotalTag(sort), users, u => u.id, cmp) : users.slice().sort(cmp);
  return pinRecentlyCreated(s, u => u.id);
}
export function sortColToggle(view, sk, dk, col, defdir) { if (view[sk] === col) view[dk] = -view[dk]; else { view[sk] = col; view[dk] = defdir[col] || 1; } }

export function userPageOf(uid) {
  const users = sortUsers(Store.recon.users, usersView.sort, usersView.dir, "users");
  const idx = users.findIndex(u => u.id === uid);
  return idx < 0 ? 1 : Math.floor(idx / (usersView.pageSize || 20)) + 1;
}
export function groupShares(gid) { return Store.sharesByGroup(gid); }
export function groupTraffic(td, gid) {
  const g = td && Store.group(gid);
  let out = null;
  for (const uid of (g ? g.users : [])) {
    const a = td.user.get(uid); if (!a) continue;
    out = out || { rx: 0, tx: 0, lifetime_rx: 0, lifetime_tx: 0, opening_rx: 0, opening_tx: 0, since: 0 };
    out.rx += a.rx || 0; out.tx += a.tx || 0; out.lifetime_rx += a.lifetime_rx || 0; out.lifetime_tx += a.lifetime_tx || 0;
    out.opening_rx += a.opening_rx || 0; out.opening_tx += a.opening_tx || 0;
    if (a.since && (!out.since || a.since < out.since)) out.since = a.since;
  }
  return out;
}
export function groupStats(g) {
  let online = 0, peers = 0, peersOn = 0, rx = 0, tx = 0;
  const nodes = new Set();
  for (const uid of g.users) {
    const mine = Store.peersByUser(uid);
    let on = 0;
    for (const p of mine) { if (p.online) on++; for (const t of p.targets) nodes.add(t.node); }
    peers += mine.length; peersOn += on; if (on) online++;
    const s = userStats(uid);
    rx += s.rx; tx += s.tx;
  }
  return { members: g.users.length, online, peers, peersOn, nodes: nodes.size, nets: groupShares(g.id).length, rx, tx,
    traffic: isMobile() ? null : groupTraffic(trafficData(), g.id) };
}
export const GROUP_SORT = {
  name: g => g.name.toLowerCase(), members: (g, s) => s.members, peers: (g, s) => s.peers, nodes: (g, s) => s.nodes,
  nets: (g, s) => s.nets, rate: (g, s) => s.rx + s.tx,
  rtotal: (g, s) => s.traffic ? s.traffic.rx + s.traffic.tx : 0,
};
export const GROUP_DEFDIR = { name: 1, members: -1, peers: -1, nodes: -1, nets: -1, rate: -1, rtotal: -1 };
export function sortGroups(groups, st, sort, dir) {
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (!GROUP_SORT[sort] || sort === "name") return groups.slice().sort((a, b) => byName(a, b) * (dir || 1));
  const key = GROUP_SORT[sort];
  const cmp = (a, b) => ((x, y) => x < y ? -1 : x > y ? 1 : 0)(key(a, st(a)), key(b, st(b))) * (dir || 1) || byName(a, b);
  return stableOrder("groups|" + sort + "|" + dir + rtotalTag(sort), groups, g => g.id, cmp);
}
export const shareDeviceName = p => p.title || (p.user_id && Store.user(p.user_id) ? Store.user(p.user_id).name : T("Untitled"));
export function deviceLabel(peer) {
  if (!peer) return T("Untitled");
  if (peer.title) return peer.title;
  const t = (peer.targets || []).find(x => x && (x.ip || x.iface));
  const where = t ? (t.ip ? String(t.ip).split("/")[0] : t.iface) : "";
  return where || T("Untitled");
}
export const peerOnline = p => !!(p && (p.targets || []).some(t => t && t.online));
export function deviceNameAt(peer, node) {
  const nm = deviceLabel(peer);
  const t = (peer && (peer.targets || []).find(x => x && (!node || x.node === node) && x.ip)) || null;
  const ip = t && t.ip ? String(t.ip).split("/")[0] : "";
  return ip && nm !== ip ? nm + " (" + ip + ")" : nm;
}
export function ownerNameAt(peer, node) {
  const u = peer && peer.user_id ? Store.user(peer.user_id) : null;
  if (!u) return deviceNameAt(peer, node);
  const t = (peer.targets || []).find(x => x && (!node || x.node === node) && x.ip) || null;
  const ip = t && t.ip ? String(t.ip).split("/")[0] : "";
  return ip ? u.name + " (" + ip + ")" : u.name;
}

export function privateUnenforced(peer) {
  if (!peer || peer.disabled || peer.expired) return [];
  const out = [], seen = new Set();
  for (const t of (peer.targets || [])) {
    if (!t || !t.node) continue;
    if (!nodeEnforces(t.node)) {
      if (!seen.has(t.node)) { seen.add(t.node); out.push({ node: t.node, why: "old" }); }
    } else if (ifaceLevelOf(t) === "everyone" && (!Store.user(peer.user_id) || unvouchedTarget(t))) {
      out.push({ node: t.node, iface: t.iface, why: Store.user(peer.user_id) ? "unvouched" : "no_user" });
    }
  }
  return out;
}
export function privateOffOpens(peer) {
  const p = { ...(peer || {}), private: false };
  const everyoneAt = [...new Set((p.targets || []).filter(t => t && t.node && targetOpen(t) === "everyone").map(t => t.node))];
  return { everyoneAt, nets: (p.routes || []).length ? peerAudience(p) : null };
}
const ifaceLevelOf = t => {
  const nr = (Store.nodes || []).find(x => x.id === t.node) || {};
  const c = (nr.wdtt_cfg || {})[t.iface] || (nr.csqtt_cfg || {})[t.iface];
  return (c ? c.reach : (Store.ifaceMeta(t.node, t.iface) || {}).reach) || "user";
};
const nodeEnforces = nid => ((Store.stats[nid] || {}).net_deps || {}).reach >= 2 && Store.recon.nodeStatus[nid] === "live";
const unvouchedTarget = t => {
  const nr = (Store.nodes || []).find(x => x.id === t.node) || {};
  if ((nr.reach_unvouched || []).includes(t.iface)) return true;
  return (nr.reach_unvouched_raw || []).some(ifn => ((nr.wdtt_cfg || {})[ifn] || {}).raw_iface === t.iface);
};
export const promotedAt = (node, iface) =>
  (((Store.nodes || []).find(x => x.id === node) || {}).reach_promoted || []).includes(iface);
export const promotedBy = (node, iface) => (Store.recon.peers || []).filter(p => p.private && !p.disabled && !p.expired
  && Store.user(p.user_id) && (p.targets || []).some(t => t && t.node === node && t.iface === iface));
const targetOpen = t => {
  if (!nodeEnforces(t.node)) return "everyone";
  const lv = ifaceLevelOf(t);
  return lv === "user" && unvouchedTarget(t) ? "none" : lv;
};

let _reachOf = null, _reachIdx = null;
function reachIndex() {
  if (_reachOf === Store.recon && _reachIdx) return _reachIdx;
  const open = new Map(), lvl = new Map(), here = new Map();
  const put = (m, k, v) => (m.get(k) || m.set(k, new Set()).get(k)).add(v);
  for (const p of Store.recon.peers) {
    const u = p.user_id ? Store.user(p.user_id) : null;
    if (!u || p.unassigned || p.disabled || p.expired || u.disabled) continue;
    for (const t of p.targets || []) {
      if (!t || !t.node) continue;
      put(here, t.node, p.user_id);
      const lv = targetOpen(t);
      if (lv === "everyone") put(open, t.node, p.user_id);
      else if (lv === "user") put(lvl, t.node, p.user_id);
    }
  }
  const out = new Map();
  const add = (uid, other) => { if (other !== uid) put(out, uid, other); };
  for (const [nid, users] of here) {
    for (const uid of users) for (const o of open.get(nid) || []) add(uid, o);
    const atUser = lvl.get(nid) || new Set();
    for (const g of Store.groups()) {
      const mates = g.users.filter(x => users.has(x));
      if (mates.length < 2) continue;
      for (const a of mates) for (const b of mates) if (atUser.has(b)) add(a, b);
    }
  }
  _reachOf = Store.recon; _reachIdx = out;
  return out;
}
export const reachOwners = uid => reachIndex().get(uid) || new Set();

export function reachableByGroup(uid) {
  const u = Store.user(uid);
  if (!u || u.disabled) return [];
  const out = [];
  for (const p of Store.peersByUser(uid)) {
    if (p.disabled || p.expired || p.unassigned) continue;
    const t = (p.targets || []).find(x => x && x.node && !(p.private && nodeEnforces(x.node))
      && (targetOpen(x) === "everyone" || targetOpen(x) === "user"));
    if (t) out.push({ peer: p, node: t.node, online: (p.targets || []).some(x => x && x.online) });
  }
  return out.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || deviceLabel(a.peer).localeCompare(deviceLabel(b.peer)));
}

let _urOf = null, _urCache = new Map();
export function userReach(uid) {
  if (_urOf !== Store.recon) { _urOf = Store.recon; _urCache = new Map(); }
  const hit = _urCache.get(uid);
  if (hit) return hit;
  const mates = new Set(Store.groupsByUser(uid).flatMap(g => g.users));
  const myNodes = new Set();
  for (const p of Store.peersByUser(uid)) {
    if (p.disabled || p.expired || p.unassigned) continue;
    for (const t of p.targets || []) if (t && t.node) myNodes.add(t.node);
  }
  const allows = (t, owner) => {
    if (!t || !t.node || !myNodes.has(t.node)) return false;
    const lv = targetOpen(t);
    return lv === "everyone" || (lv === "user" && mates.has(owner));
  };
  const rows = [];
  for (const other of reachOwners(uid)) {
    const u = Store.user(other);
    if (!u) continue;
    const devices = [];
    for (const p of Store.peersByUser(other)) {
      if (p.disabled || p.expired) continue;
      const t = (p.targets || []).find(x => allows(x, other) && !(p.private && nodeEnforces(x.node)));
      if (!t) continue;
      devices.push({ peer: p, online: !!t.online, node: t.node, ip: t.ip ? String(t.ip).split("/")[0] : "" });
    }
    devices.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || deviceLabel(a.peer).localeCompare(deviceLabel(b.peer)));
    if (devices.length) rows.push({ user: u, devices, online: devices.filter(d => d.online).length });
  }
  const out = rows.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0)
    || String(a.user.name).localeCompare(String(b.user.name)));
  _urCache.set(uid, out);
  return out;
}
const ASK_TTL = 300000;
let SIG = "", SIG_KEY = null;
export function askSig() {
  if (SIG_KEY === Store.recon) return SIG;
  const parts = [];
  for (const p of (Store.recon && Store.recon.peers) || []) {
    const tg = (p.targets || []).map(t => t.node + "/" + t.iface).join(",");
    const dead = (p.disabled ? 1 : 0) + (p.expired ? 2 : 0) + (p.userDisabled ? 4 : 0) + (p.private ? 8 : 0);
    if ((p.routes || []).length) parts.push("R" + p.id + ":" + (p.routes || []).join("|") + ":" + JSON.stringify(p.share || null) + ":" + tg + ":" + dead);
    else parts.push("P" + p.id + ":" + (p.user_id || "") + ":" + tg + ":" + dead);
  }
  for (const g of (Store.groups ? Store.groups() : [])) parts.push("G" + g.id + ":" + (g.users || []).join("|"));
  for (const n of (Store.nodes || [])) parts.push("N" + n.id + ":" + (n.lan_share === false ? 0 : 1) + ":" + ((n.lans || []).length) + ":" + (n.net_capable ? 1 : 0));
  parts.push("S" + ((Store.panelSettings || {}).show_node_lans === false ? 0 : 1));
  SIG_KEY = Store.recon; SIG = parts.join(";");
  return SIG;
}
export const askFresh = e => !!(e && e.sig === askSig() && Date.now() - e.at < ASK_TTL);

export function peerAudience(peer) {
  const sh = peer && peer.share && typeof peer.share === "object" ? peer.share : null;
  const owner = peer && peer.user_id ? Store.user(peer.user_id) : null;
  const nodes = [...new Set((peer.targets || []).map(t => t && t.node).filter(Boolean))];
  if (peer && peer.private) return { mode: "owner", nodes, owner, users: [], groups: [], private: true };
  const now = Math.floor(Date.now() / 1000);
  const live = u => typeof u === "number" && u >= 0 && (!u || u > now);
  const here = uid => Store.peersByUser(uid).filter(q => !q.disabled && !q.expired
    && (q.targets || []).some(t => t && nodes.includes(t.node))).length;
  if (!sh) return { mode: "everyone", nodes, owner, users: [], groups: [] };
  const users = [], groups = [];
  for (const [uid, until] of Object.entries(sh.users || {})) {
    const u = live(until) ? Store.user(uid) : null;
    if (!u || u.disabled || uid === (peer.user_id || "")) continue;
    users.push({ id: uid, name: u.name, devices: here(uid), until: until || 0 });
  }
  for (const [gid, until] of Object.entries(sh.groups || {})) {
    const g = live(until) ? Store.group(gid) : null;
    if (!g) continue;
    groups.push({ id: gid, name: g.name, members: (g.users || []).length, until: until || 0 });
  }
  users.sort((a, b) => b.devices - a.devices || String(a.name).localeCompare(String(b.name)));
  groups.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { mode: users.length || groups.length ? "shared" : "owner", nodes, owner, users, groups };
}
const AUD = new Map();
export const peerAudCached = pid => { const e = AUD.get(pid); return e && e.rep && askFresh(e) ? e.rep : null; };
export async function peerAudFetch(pid) {
  const e = AUD.get(pid);
  if (e && (e.busy || (e.rep && askFresh(e)))) return;
  AUD.set(pid, { ...(e || {}), busy: true });
  let rep = { targets: [] };
  try {
    const r = await api.peerNetworks({ peer_id: pid });
    rep = (r && r.data) || { targets: [] };
  } catch (_) { rep = { targets: [] }; }
  AUD.set(pid, { at: Date.now(), sig: askSig(), rep });
  bus.emit();
}

export function reachTally(uid) {
  let total = 0, online = 0;
  for (const r of userReach(uid)) { total += r.devices.length; online += r.online; }
  return { total, online, shown: online || total };
}

const NETS = new Map();
export function netsCached(uid) { const e = NETS.get(uid); return e && e.rows && askFresh(e) ? e : null; }
export async function netsFetch(uid) {
  const e = NETS.get(uid);
  if (e && (e.busy || (e.rows && askFresh(e)))) return;
  NETS.set(uid, { ...(e || {}), busy: true });
  let rows = [];
  try {
    const r = await api.userNetworks({ user_id: uid });
    const rank = c => (c === true ? 2 : c == null ? 1 : 0);
    const seen = new Map();
    for (const p of ((r && r.data && r.data.peers) || []).filter(x => !x.blocked)) for (const t of p.targets || []) {
      for (const n of t.networks || []) {
        const k = t.node + "|" + n.prefix, cur = seen.get(k);
        if (!cur) seen.set(k, { node: t.node, prefix: n.prefix, via: n.via || "", restricted: !!n.restricted, until: n.until || 0, covered: n.covered });
        else if (rank(n.covered) > rank(cur.covered)) cur.covered = n.covered;
      }
      if (t.lan && (t.lan.addrs || []).length) {
        const k = t.node + "|lan", cur = seen.get(k);
        if (!cur) seen.set(k, { node: t.node, prefix: t.lan.addrs.join(", "), lan: t.lan, covered: t.lan.covered });
        else if (rank(t.lan.covered) > rank(cur.covered)) cur.covered = t.lan.covered;
      }
    }
    rows = [...seen.values()].sort((a, b) => String(Store.nodeName(a.node)).localeCompare(String(Store.nodeName(b.node)))
      || (a.lan ? 1 : 0) - (b.lan ? 1 : 0) || String(a.prefix).localeCompare(String(b.prefix)));
  } catch (_) { rows = []; }
  NETS.set(uid, { at: Date.now(), sig: askSig(), rows });
  COUNTS.set(uid, { sig: askSig(), at: Date.now(), n: rows.length,
    rows: rows.map(r => ({ node: r.node, via: r.via || "", lan: !!r.lan, covered: r.covered })) });
  bus.emit();
}

const COUNTS = new Map();
export const netsCount = uid => { const e = COUNTS.get(uid); return e ? e.n : null; };
export const netsBrief = uid => { const e = COUNTS.get(uid); return e && Array.isArray(e.rows) ? e.rows : null; };

let _pbOf = null, _pb = null;
const peerById = id => {
  if (_pbOf !== Store.recon) { _pbOf = Store.recon; _pb = new Map(Store.recon.peers.map(p => [p.id, p])); }
  return _pb.get(id);
};
export function netRowOnline(r) {
  if (!r || r.covered === false || r.covered == null) return false;
  if (r.lan) return (Store.recon.nodeStatus || {})[r.node] === "live";
  const dev = r.via ? peerById(r.via) : null;
  return !!(dev && (dev.targets || []).some(t => t && t.node === r.node && t.online));
}
export function netTally(uid) {
  const hit = netsCached(uid);
  const rows = hit ? hit.rows : netsBrief(uid);
  const n = netsCount(uid);
  if (!rows) {
    const total = n != null ? n : new Set(userNets(uid).map(x => x.prefix)).size;
    return { total, online: 0, shown: total, known: n != null };
  }
  const online = rows.filter(netRowOnline).length;
  return { total: rows.length, online, shown: online || rows.length, known: true };
}
let PEND = new Set(), PEND_T = null;
export function wantNetsCount(uid) {
  if (!uid) return;
  if (askFresh(COUNTS.get(uid))) return;
  PEND.add(uid);
  if (!PEND_T) PEND_T = setTimeout(flushNetsCounts, 60);
}
async function flushNetsCounts() {
  PEND_T = null;
  const ids = [...PEND];
  PEND.clear();
  if (!ids.length) return;
  const sig = askSig(), at = Date.now();
  try {
    const r = await api.userNetworks({ user_ids: ids });
    const c = ((r && r.data) || {}).counts, rw = ((r && r.data) || {}).rows || {};
    if (!c) return;
    for (const k of Object.keys(c)) COUNTS.set(k, { sig, at, n: c[k], rows: Array.isArray(rw[k]) ? rw[k] : null });
    bus.emit();
  } catch (_) {   }
}

export function userNets(uid) {
  const gids = new Set(Store.groupsByUser(uid).map(g => g.id));
  const out = [];
  for (const p of Store.recon.peers) {
    if (!(p.routes || []).length) continue;
    const sh = p.share && typeof p.share === "object" ? p.share : null;
    const own = p.user_id === uid;
    if (p.private && !own) continue;
    const named = !!(sh && sh.users && Object.prototype.hasOwnProperty.call(sh.users, uid));
    const via = sh && sh.groups && !own && !named ? Object.keys(sh.groups).find(g => gids.has(g)) : null;
    if (!own && !named && !via) continue;
    const vname = via ? (Store.group(via) || {}).name || "" : "";
    for (const prefix of p.routes) out.push({ prefix, peer: p, own, via: vname });
  }
  return out.sort((a, b) => (a.own === b.own ? 0 : a.own ? -1 : 1) || a.prefix.localeCompare(b.prefix));
}
export function namedFew(names) {
  if (names.length <= 3) return names.join(", ");
  return T("{names} and {n} more", { names: names.slice(0, 3).join(", "), n: names.length - 3 });
}

export function revealUser(userId, peerId) {
  if (!userId) return;
  usersView.mode = "users"; usersView.q = ""; clearUserFilters(); usersView.expanded[userId] = true;
  go("#/users");
  setTimeout(() => {
    usersView.page = userPageOf(userId);
    if (peerId) Store.recentlyCreated[peerId] = Date.now();
    Store.apply();
    requestAnimationFrame(() => { const el = document.getElementById("urow-" + userId); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }, 240);
}
export function revealPeer(peer) {
  if (!peer) return openUsers();
  if (peer.user_id != null) { revealUser(peer.user_id, peer.id); return; }
  Store.recentlyCreated[peer.id] = Date.now();
  openUsers({ status: "unassigned" });
}
export function peerInRosterStatus(peer, status) {
  if (!status) return true;
  if (status === "unassigned") return peer.unassigned;
  return status === "partial" ? peer.status === "partial" : peer.targets.some(t => t.status === status);
}

export function openUsers({ node = "", status = "", online = false } = {}) {
  clearUserFilters();
  Object.assign(usersView, { mode: "users", q: "", node, status, online, page: 1 });
  Object.assign(unassignedView, { node, iface: "", q: "", page: 1 });
  go("#/users");
  bus.emit();
  if (status === "unassigned") requestAnimationFrame(() => document.getElementById("unassigned-peers")?.scrollIntoView({ block: "start" }));
}

export function revealOrphans(node, iface) {
  go("#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(iface));
  setTimeout(() => requestAnimationFrame(() => { const el = document.getElementById("iface-orphans"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }), 320);
}
export function revealAssignedPeer(userId, peerId) {
  if (!userId) return;
  if (peerId) Store.recentlyCreated[peerId] = Date.now();
  if ((location.hash || "").startsWith("#/user")) revealUser(userId, peerId);
  else Store.apply();
}

const _byHandshake = (a, b) => {
  const av = a.lastAge == null ? Infinity : a.lastAge, bv = b.lastAge == null ? Infinity : b.lastAge;
  return av - bv;
};

export function orphCount(nodeId, iface) {
  return (Store.recon.orphans || []).filter(o => o.node === nodeId && (iface == null || o.iface === iface)).length;
}

export function onlineUserRows(nodeId) {
  const m = {};
  (Store.recon.peers || []).forEach(p => {
    const isOn = nodeId ? p.targets.some(t => t.node === nodeId && t.online) : p.online;
    if (!isOn) return;
    const id = p.unassigned ? "_un" : ("u" + p.user_id);
    if (!m[id]) m[id] = { name: p.unassigned ? T("val|Unassigned") : (p.name || T("(unnamed)")), count: 0, unassigned: !!p.unassigned, lastAge: null, uid: p.user_id || null };
    m[id].count++;
    if (p.lastHandshakeAge != null) m[id].lastAge = (m[id].lastAge == null) ? p.lastHandshakeAge : Math.min(m[id].lastAge, p.lastHandshakeAge);
  });
  return Object.values(m).sort(_byHandshake);
}

export function onlineUserCount(rows) { return (rows || []).reduce((a, r) => a + (r.unassigned ? (r.count || 0) : 1), 0); }

export function onlinePeerRows(nodeId, iface) {
  const onT = (t) => (nodeId == null || t.node === nodeId) && (iface == null || t.iface === iface) && t.online;
  return (Store.recon.peers || []).filter(p => p.targets.some(onT))
    .map(p => { const t = p.targets.find(onT) || {};
      return { title: p.title || p.name || T("(peer)"), user: p.unassigned ? T("val|Unassigned") : (p.name || T("(unnamed)")),
               ip: t.ip || "", iface: t.iface, unassigned: !!p.unassigned, lastAge: p.lastHandshakeAge }; })
    .sort(_byHandshake);
}

export function turnConnRows(nodeId, iface, service) {
  const onT = (t) => t.node === nodeId && t.iface === iface && t.online && t.viaTurn === service;
  return (Store.recon.peers || []).filter(p => p.targets.some(onT))
    .map(p => { const t = p.targets.find(onT) || {};
      return { title: p.title || p.name || T("(peer)"), user: p.unassigned ? T("val|Unassigned") : (p.name || T("(unnamed)")), ip: t.ip || "", unassigned: !!p.unassigned, lastAge: p.lastHandshakeAge }; })
    .sort(_byHandshake);
}

export function wdttConnRows(nodeId, iface) {
  const onT = (t) => t.node === nodeId && t.iface === iface && t.online;
  return (Store.recon.peers || []).filter(p => p.targets.some(onT))
    .map(p => { const t = p.targets.find(onT) || {};
      return { title: p.title || p.name || T("(peer)"), user: p.unassigned ? T("val|Unassigned") : (p.name || T("(unnamed)")), ip: t.ip || "", unassigned: !!p.unassigned, lastAge: p.lastHandshakeAge }; })
    .sort(_byHandshake);
}

export function OnlPop({ title, rows, peer, orphans, orphHref, trigger, cls, count, hoverOnly }) {
  const n = count != null ? count : rows.length;
  const src = useRef(null);
  if (isMobile()) {
    if (!src.current) src.current = {};
    _onlSrc.set(src.current, { title, rows, peer, n, orphans });
    return onlTap(cls, () => openChildOrRoot(html`<${OnlineListSheet} src=${src.current}/>`), trigger(n));
  }
  const renderRow = peer
    ? r => html`<div class=${"onrow" + (r.unassigned ? " un" : "")}><span class="on-name">${r.title}</span><span class="on-user faint">${r.user}${r.iface ? " · " + r.iface : ""}${r.ip ? " · " + r.ip : ""}</span></div>`
    : r => html`<div class=${"onrow" + (r.unassigned ? " un" : "")}><span class="on-name">${r.name}</span><span class="on-ct">${r.count} <span class="faint">${pluralWord(r.count, "peer")}</span></span></div>`;
  return html`<${Popover} cls=${"onlinetag " + (cls || "")} hoverOnly=${hoverOnly} trigger=${trigger(n)}>
    <a class="onpop-h onpop-link" href="#/users" onClick=${e => { e.stopPropagation(); e.preventDefault(); openUsers({ online: true }); }}>${title} · ${n} →</a>
    ${rows.length ? rows.slice(0, 10).map(renderRow) : html`<div class="onrow faint">${peer ? T("no peers online") : T("no one online")}</div>`}
    ${orphans ? html`<a class="onpop-orph" href=${orphHref || "#/nodes"} onClick=${e => e.stopPropagation()}>${T("{v1} unmanaged orphan", { v1: plural(orphans, "peer") })}</a>` : null}
    ${rows.length > 10 ? html`<a class="onpop-viewall" href="#/users" onClick=${e => { e.stopPropagation(); e.preventDefault(); openUsers({ online: true }); }}>${T("view all {n} connections →", { n: rows.length })}</a>` : null}
  </${Popover}>`;
}

export function meshHealth(nodeId) {
  const byId = id => (Store.nodes || []).find(n => n.id === id);
  const mp = (byId(nodeId) || {}).mesh_peers || [];
  const hs = (nid, iface) => iface ? (((Store.describe || {})[nid] || {})[iface] || {}).handshake_age : undefined;
  const stat = (nid, iface, reprov) => reprov ? "connecting"
    : (nodeStale(nid) || !iface) ? "down"
    : (hs(nid, iface) == null ? "connecting" : (hs(nid, iface) < 180 ? "up" : "down"));
  const peers = mp.map(({ peer, iface, reprovisioning }) => {
    const pmp = ((byId(peer) || {}).mesh_peers || []).find(x => x.peer === nodeId) || {};
    const linkDown = nodeStale(nodeId) || nodeStale(peer);
    const link = (((Store.describe || {})[nodeId] || {})[iface] || {}).link || null;
    const plink = (((Store.describe || {})[peer] || {})[pmp.iface] || {}).link || null;
    return { peer, link, plink,
      out: linkDown ? "down" : stat(nodeId, iface, reprovisioning),
      in:  linkDown ? "down" : stat(peer, pmp.iface, pmp.reprovisioning) };
  });
  return { peers, total: peers.length,
    okIn: peers.filter(p => p.in === "up").length, okOut: peers.filter(p => p.out === "up").length };
}

export const mhArrow = (dir, status) => html`<span class=${"mh-ar mh-" + dir + " s-" + status}>${dir === "down" ? "↓" : "↑"}</span>`;

function MeshSheet({ nodeId, mode }) {
  useStore();
  const h = meshHealth(nodeId);
  return html`<${Sheet} title=${(mode === "in" ? T("Inbound links") : T("Mesh connections")) + " · " + h.total} noGuard=${true}
    foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>
      ${location.hash === "#/node/" + encodeURIComponent(nodeId) ? null
        : html`<button class="btn btn-primary" onClick=${() => { closeModal(); go("#/node/" + encodeURIComponent(nodeId)); }}>${T("Open node")}</button>`}`}>
    <div class="m-meshsheet"><${MeshStat} nodeId=${nodeId} mode=${mode} rows=${true}/></div>
  <//>`;
}
export function MeshStat({ nodeId, mode, rows }) {
  const h = meshHealth(nodeId);
  if (!h.total) return null;
  const num = (ok, dir) => html`<b class=${"mh-num " + (mode === "in" ? "mh-num-hdr " : "") + (ok >= h.total ? dir : ok === 0 ? "mhn-bad" : "mhn-warn")}>${ok}/${h.total}</b>`;
  const ordered = (Store.nodes || []).filter(n => h.peers.some(p => p.peer === n.id));
  const legOf = p => (mode === "in" ? (p.plink || p.link) : p.link);
  const legIsPeer = p => mode !== "in" || !!p.plink;
  const lossOf = p => (mode === "in" ? p.plink : p.link);
  const anyLoss = h.peers.some(p => { const l = lossOf(p); return l && typeof l.loss === "number" && l.loss > 0; });
  const row = n => {
    const p = h.peers.find(x => x.peer === n.id);
    const nameCls = p.in === "up" ? "mh-bold" : p.in === "down" ? "mh-dim" : "";
    const lk = legOf(p), ll = lossOf(p);
    const loss = ll && typeof ll.loss === "number" ? ll.loss : null;
    const warn = loss != null && loss > 0;
    const legBase = !ll ? (lk ? T("Round-trip latency to {v3}. Loss this way is measured by {v3}, which has not reported it.", { v3: n.name }) : "")
      : legIsPeer(p) ? T("Leg measured from {v3}: {v1} of {v2} probe packets lost.",
                         { v1: ll.window_lost, v2: ll.window_sent, v3: n.name })
      : T("Leg measured from this node: {v1} of {v2} probe packets lost.",
          { v1: ll.window_lost, v2: ll.window_sent });
    const legTitle = [legBase,
      ll && typeof ll.peak_loss === "number" && ll.peak_loss > (ll.loss || 0) ? T("Worst probe {v1}%.", { v1: ll.peak_loss }) : "",
      ll && ll.last_loss_s != null ? T("Last loss {v1} ago.", { v1: seen(ll.last_loss_s) }) : "",
      lk && lk.mdev_ms != null ? T("Jitter {v1}ms.", { v1: lk.mdev_ms.toFixed(1) }) : "",
    ].filter(Boolean).join(" ");
    return html`<div class="mh-row" title=${legTitle}>
      <span class=${"mh-rn " + nameCls} style=${"color:" + Store.nodeColor(n.id)}>${n.name}</span>
      ${anyLoss ? html`<span class="mh-loss" style=${warn ? "color:" + lossColorMesh(loss) : ""}>${warn ? loss + "%" : ""}</span>` : null}
      <span class="mh-rtt">${lk && lk.rtt_ms != null ? Math.round(lk.rtt_ms) + T("unit|ms") : ""}</span>
      <span class="mh-rar">${mhArrow("down", p.in)}${mode === "both" ? mhArrow("up", p.out) : null}</span>
    </div>`;
  };
  const trigger = mode === "in"
    ? html`<span class="mh-tag mh-tag-hdr"><span class="mh-lbl-hdr">${T("This node's mesh status:")}</span> ${num(h.okIn, "mhn-down")}</span>`
    : html`<span class="mh-tag"><span class="nm-l">${T("Mesh")}</span><span class="mh-grp"><span class="mh-ar mh-down s-up">↓</span>${num(h.okIn, "mhn-down")}</span><span class="mh-grp"><span class="mh-ar mh-up s-up">↑</span>${num(h.okOut, "mhn-up")}</span></span>`;
  if (rows) return html`<div class=${"mh-rows" + (anyLoss ? " has-loss" : "")}>${ordered.map(row)}</div>`;
  if (isMobile()) return onlTap("mh-pop", () => openChildOrRoot(html`<${MeshSheet} nodeId=${nodeId} mode=${mode}/>`), trigger);
  return html`<${Popover} cls="mh-pop" popCls=${"mh-bubble" + (anyLoss ? " has-loss" : "")} alignRight=${true} trigger=${trigger}>
    <div class="onpop-h">${mode === "in" ? T("Inbound links") : T("Mesh connections")}</div>
    ${ordered.map(row)}
  </${Popover}>`;
}

const DROP_KINDS = [
  { k: "tx_drop", dir: "out", lbl: d => d.dp === "wg" ? T("no session") : T("queue full"),
    hint: d => d.dp === "wg" ? T("Packets held for the other server were discarded because the link had no working session — it was down.")
      : d.dp === "tun" ? T("The program serving this interface didn't read its queue in time — local load, or it was restarting.")
      : T("Packets waiting to go out were discarded before they could be sent.") },
  { k: "tx_err",  dir: "out", lbl: () => T("failed"),
    hint: () => T("Sends failed outright — no route out, or a peer whose endpoint this node doesn't know yet.") },
  { k: "rx_drop", dir: "in",  lbl: () => T("overflow"),
    hint: () => T("Packets arrived faster than this node could take them in — local load, not the path.") },
  { k: "rx_err",  dir: "in",  lbl: () => T("refused"),
    hint: () => T("Packets came from a source outside the sender's allowed range, or were malformed — usually one misconfigured sender.") },
];

const DROP_PCT_MIN = 200;
export const dropsEnough = d => (d.window_pkts || 0) + (d.window_bad || 0) >= DROP_PCT_MIN;
export function DropsFigure({ d }) {
  return !dropsEnough(d)
    ? html`<span class="dp-num">${fmtCount(d.window_bad)} ${T("dropped")}</span>`
    : html`<span class="dp-num" style=${"color:" + lossColor(d.pct)}>${d.pct}%</span>`;
}

export function LossPop({ l, pl, peerName, node, iface, trigger, alignRight }) {
  const [reset, setReset] = useState("");
  if (!l && !pl) return trigger;
  const doReset = async e => {
    e.preventDefault(); e.stopPropagation();
    setReset("busy");
    const r = await api.ifaceUpdate({ node: node, iface: iface, mesh_reset: 1 });
    if (r && r.ok) { setReset("ok"); setTimeout(() => setReset(""), 2500); }
    else { setReset(""); toast(srvText(r) || T("Couldn't reset the probe window."), "err"); }
  };
  const nearName = node ? Store.nodeName(node) : T("this node");
  const ends = [];
  if (l && typeof l.loss === "number") ends.push({ dir: nearName, x: l });
  if (pl && typeof pl.loss === "number") ends.push({ dir: peerName, x: pl });
  if (!ends.length) return trigger;
  const both = ends.length > 1;
  const tag = e => both ? html`<span class="dp-kind">${e.dir}</span>` : null;
  const pick = (has, better) => { const c = ends.filter(has); return c.length ? c.reduce(better) : null; };
  const worst = pick(e => typeof e.x.peak_loss === "number", (a, b) => b.x.peak_loss > a.x.peak_loss ? b : a);
  const last  = pick(e => e.x.last_loss_s != null, (a, b) => b.x.last_loss_s < a.x.last_loss_s ? b : a);
  const reportsLast = ends.some(e => "last_loss_s" in e.x);
  const rtts = ends.filter(e => e.x.rtt_ms != null);
  const spread = rtts.map(e => e.x.rtt_max != null ? e.x.rtt_max : e.x.rtt_ms);
  const splitRtt = rtts.length > 1 && Math.max(...spread) > Math.min(...spread) * 1.25;
  const rttRows = splitRtt ? rtts : rtts.slice(0, 1);
  const one = ends.find(e => e.x.window_lost === 1);
  return html`<${Popover} cls="drops-pop" popCls="dp-bubble" flipFit=${true} alignRight=${alignRight !== false} trigger=${trigger}>
    <div class="onpop-h dp-h">${T("Leg quality · {v1}", { v1: peerName })}
      ${node && iface ? html`<button class=${"dp-reset" + (reset === "ok" ? " ok" : "")} disabled=${reset === "busy"}
        title=${T("Clear this leg's probe window at both ends and start measuring again from now")}
        onClick=${doReset}>${reset === "ok" ? T("Reset ✓") : reset === "busy" ? T("Resetting…") : T("Reset")}</button>` : null}</div>
    ${ends.map(e => html`<div class="dp-row"><span class="dp-l">${e.dir}</span><span class="dp-v">
      <b style=${"color:" + lossColorMesh(e.x.loss)}>${e.x.loss}%</b>
      <span class="dp-kind">${T("{v1} of {v2}", { v1: e.x.window_lost, v2: e.x.window_sent })}</span></span></div>`)}
    ${rttRows.map(e => html`<div class="dp-row"><span class="dp-l">${T("Round trip")}</span><span class="dp-v">
      <b>${Math.round(e.x.rtt_ms)}${T("unit|ms")}</b>${e.x.rtt_min != null && e.x.rtt_max != null
        ? html`<span class="dp-kind">${T("min {v1} · max {v2}", { v1: Math.round(e.x.rtt_min), v2: Math.round(e.x.rtt_max) })}</span>` : null}${splitRtt ? tag(e) : null}</span></div>`)}
    ${rttRows.filter(e => e.x.mdev_ms != null).map(e => html`<div class="dp-row"><span class="dp-l">${T("Jitter")}</span>
      <span class="dp-v"><b>${e.x.mdev_ms.toFixed(1)}${T("unit|ms")}</b>${splitRtt ? tag(e) : null}</span></div>`)}
    ${worst && worst.x.peak_loss > (worst.x.loss || 0) ? html`<div class="dp-row"><span class="dp-l">${T("Worst probe")}</span>
      <span class="dp-v"><b style=${"color:" + lossColorMesh(worst.x.peak_loss)}>${worst.x.peak_loss}%</b>${tag(worst)}</span></div>` : null}
    ${last ? html`<div class="dp-row"><span class="dp-l">${T("Last loss")}</span><span class="dp-v">${
        last.x.last_loss_s < 90 ? T("just now") : T("{v1} ago", { v1: seen(last.x.last_loss_s) })}${tag(last)}</span></div>`
      : reportsLast ? html`<div class="dp-row"><span class="dp-l">${T("Last loss")}</span><span class="dp-v">${"—"}</span></div>` : null}
    ${one ? html`<div class="dp-hint">${T("That is a single lost packet — the smallest amount this probe can measure. One is normal; watch whether it keeps happening.")}</div>` : null}
    ${both ? html`<div class="dp-hint">${T("Each row is a round trip measured from that node, so both cross the link in both directions — a difference between them is two samples of the same link, not a direction.")}</div>` : null}
    <div class="dp-foot">${ends[0].x.probes
      ? T("Loss over the last {v1} ({v2} probes of {v3} packets, {v4}-byte). Latency and jitter are from the newest probe.",
          { v1: seen((ends[0].x.probes || 0) * (ends[0].x.probe_every_s || 60)), v2: ends[0].x.probes,
            v3: 20, v4: ends[0].x.probe_size })
      : T("measured by pinging the far end of this link")}</div>
  </${Popover}>`;
}

export const fmtCount = n => {
  n = Number(n) || 0;
  if (n < 10000) return fmtNum(n);
  const [d, u] = n < 1e6 ? [n / 1e3, "K"] : n < 1e9 ? [n / 1e6, "M"] : [n / 1e9, "G"];
  return d.toFixed(1).replace(/\.0$/, "") + u;
};

export const dropRate = v => (v >= 100 ? fmtCount(Math.round(v)) : v >= 10 ? v.toFixed(1) : String(v));

export function ProxyDropsPop({ d, service, trigger, alignRight }) {
  if (!d) return trigger;
  const n = v => typeof v === "number";
  return html`<${Popover} cls="drops-pop" popCls="dp-bubble" flipFit=${true} alignRight=${alignRight !== false} trigger=${trigger}>
    <div class="onpop-h">${T("Dropped at the socket · {v1}", { v1: service })}</div>
    <div class="dp-head">
      <span class="dp-sub">${T("in the last {v1}", { v1: d.span_s ? seen(d.span_s) : "—" })}</span>
      <b class="dp-pct" style=${"color:" + lossColor(d.per_min > 0 ? Math.min(5, d.per_min / 20) : 0)}>${fmtCount(d.win_drops || 0)}</b>
    </div>
    ${n(d.per_min) ? html`<div class="dp-row"><span class="dp-l">${T("Rate")}</span><span class="dp-v"><b>${dropRate(d.per_min)}</b><span class="dp-kind">${T("per minute")}</span></span></div>` : null}
    ${n(d.rxq) ? html`<div class="dp-row"><span class="dp-l">${T("Backlog")}</span><span class="dp-v"><b>${fmtBytes(d.rxq)}</b><span class="dp-kind">${T("waiting")}</span></span></div>` : null}
    ${d.last_bad_s !== undefined ? html`<div class="dp-row"><span class="dp-l">${T("Last drop")}</span><span class="dp-v">${
      d.last_bad_s == null ? "—" : d.last_bad_s < 90 ? T("just now") : T("{v1} ago", { v1: seen(d.last_bad_s) })}</span></div>` : null}
    ${n(d.life_drops) ? html`<div class="dp-row"><span class="dp-l">${T("Since it started")}</span><span class="dp-v">${fmtCount(d.life_drops)}</span></div>` : null}
    <div class="dp-foot">${T("Packets that reached this server and were discarded because the proxy wasn't reading its socket fast enough. They never reach an interface, so no interface counter can show them.")}</div>
  </${Popover}>`;
}

export function DropsPop({ d, iface, node, trigger, alignRight }) {
  const [reset, setReset] = useState("");
  if (!d) return trigger;
  const doReset = async e => {
    e.preventDefault(); e.stopPropagation();
    setReset("busy");
    const r = await api.ifaceUpdate({ node: node, iface: iface, drops_reset: 1 });
    if (r && r.ok) { setReset("ok"); setTimeout(() => setReset(""), 2500); }
    else { setReset(""); toast(srvText(r) || T("Couldn't reset the counters."), "err"); }
  };
  const has = k => typeof d[k] === "number";
  const counts = k => !Array.isArray(d.fault_kinds) || d.fault_kinds.includes(k);
  const split = DROP_KINDS.filter(x => has(x.k) && counts(x.k));
  const offN = DROP_KINDS.filter(x => has(x.k) && !counts(x.k)).reduce((a, x) => a + d[x.k], 0);
  const top = split.slice().sort((a, b) => d[b.k] - d[a.k])[0];
  const hint = top && d[top.k] > 0 && d[top.k] * 2 > d.window_bad ? top.hint(d) : null;
  const rowsFor = dir => split.filter(x => x.dir === dir);
  const pair = (dir, label) => {
    const rs = rowsFor(dir);
    if (!rs.length) return null;
    return html`<div class="dp-row"><span class="dp-l">${label}</span><span class="dp-v">${rs.map(x => html`
      <span class=${"dp-kind" + (d[x.k] ? "" : " zero")}>${x.lbl(d)} <b>${fmtCount(d[x.k])}</b></span>`)}</span></div>`;
  };
  return html`<${Popover} cls="drops-pop" popCls="dp-bubble" flipFit=${true} alignRight=${alignRight !== false} trigger=${trigger}>
    <div class="onpop-h dp-h">${T("Drops · {v1}", { v1: iface })}
      ${node ? html`<button class=${"dp-reset" + (reset === "ok" ? " ok" : "")} disabled=${reset === "busy"}
        title=${T("Zero the counters and start measuring again from now")}
        onClick=${doReset}>${reset === "ok" ? T("Reset ✓") : reset === "busy" ? T("Resetting…") : T("Reset")}</button>` : null}</div>
    <div class="dp-head">
      <span class="dp-sub">${T("{v1} of {v2} packets", { v1: fmtCount(d.window_bad), v2: fmtCount(d.window_pkts) })}</span>
      ${dropsEnough(d) ? html`<b class="dp-pct" style=${"color:" + lossColor(d.pct)}>${d.pct}%</b>` : null}
    </div>
    ${pair("out", T("Sending"))}
    ${pair("in", T("Receiving"))}
    ${offN ? html`<div class="dp-row"><span class="dp-l">${T("Not counted")}</span><span class="dp-v">${fmtCount(offN)}</span></div>` : null}
    ${(() => {
      const wp = has("peak") && d.peak > (d.pct || 0) ? d.peak : null;
      const wb = typeof d.peak_bad === "number" && d.peak_bad > 0 ? d.peak_bad : null;
      if (wp == null && wb == null) return null;
      return html`<div class="dp-row"><span class="dp-l">${T("Worst sample")}</span><span class="dp-v">${wp != null
        ? html`<b style=${"color:" + lossColor(wp)}>${wp}%</b>${wb ? html`<span class="dp-kind">${fmtCount(wb)} ${T("dropped")}</span>` : null}`
        : html`<b>${fmtCount(wb)}</b><span class="dp-kind">${T("dropped")}</span>`}</span></div>`;
    })()}
    ${has("last_bad_s") || d.last_bad_s === null ? html`<div class="dp-row"><span class="dp-l">${T("Last drop")}</span><span class="dp-v">${
      d.last_bad_s == null ? "—" : d.last_bad_s < 5 ? T("just now") : T("{v1} ago", { v1: seen(d.last_bad_s) })}</span></div>` : null}
    ${has("life_bad") ? html`<div class="dp-row"><span class="dp-l">${
      d.life_since ? T("Since reset") : T("Since boot")}</span><span class="dp-v">${
      T("{v1} of {v2}", { v1: fmtCount(d.life_bad), v2: fmtCount(d.life_pkts) })}${d.life_pkts + d.life_bad >= DROP_PCT_MIN
        ? html`<span class="dp-life" style=${"color:" + lossColor(100 * d.life_bad / d.life_pkts)}>${
            (100 * d.life_bad / d.life_pkts).toFixed(4)}%</span>` : null}</span></div>` : null}
    ${hint ? html`<div class="dp-hint">${hint}</div>` : null}
    ${offN ? html`<div class="dp-hint">${T("Not counted: packets for clients that weren't connected, traffic to addresses no client owns, and traffic one client sent from outside its range. None of it is something a connected client lost.")}</div>` : null}
    <div class="dp-foot">${d.span_s ? T("measured over the last {v1}", { v1: seen(d.span_s) }) : T("this node's own queues and datapath, not the path to the client")}</div>
  </${Popover}>`;
}

export function OnlineUsersTag({ nodeId, cls, trigger, presence, rangeLabel }) {
  const [mode, setMode] = useState("users");
  const isPeers = mode === "peers";
  const userRows = presence ? (presence.userRows || []).map(r => ({ ...r, lastAge: null })) : onlineUserRows(nodeId);
  const peerRows = onlinePeerRows(nodeId, null);
  const rows = isPeers ? peerRows : userRows;
  const count = isPeers ? peerRows.length : onlineUserCount(userRows);
  const title = isPeers ? T("Online peers") : (presence ? T("Users online · {v1}", { v1: rangeLabel || T("val|range") }) : T("Online users"));
  const word = isPeers ? "peer" : "user";
  const dflt = (c, w) => html`<span class="dot"></span><b class=${"oncount" + (c ? " on" : "")}>${c}</b> ${pluralWord(c, w || "user")}`;
  const trig = c => html`<span class="onl-toggle" title=${T("Click to switch users / peers")} onClick=${e => { e.stopPropagation(); e.preventDefault(); setMode(m => m === "users" ? "peers" : "users"); }}>${(trigger || dflt)(c, word)}</span>`;
  if (isMobile()) return onlTap(cls, () => openChildOrRoot(html`<${OnlineSheet} nodeId=${nodeId}/>`), (trigger || dflt)(onlineUserCount(onlineUserRows(nodeId)), "user"));
  return html`<${OnlPop} peer=${isPeers} title=${title} rows=${rows} count=${count} cls=${cls} hoverOnly=${true} trigger=${trig}/>`;
}

const ONLINE_SHEET_CAP = 20;
function onsheetRows(rows, peers) {
  return html`<div class="onsheet-list">${rows.slice(0, ONLINE_SHEET_CAP).map((r, i) => {
    const open = !peers && r.uid ? () => { closeModal(); revealUser(r.uid); } : null;
    return html`<div class=${"onsheet-row" + (open ? " clk" : "")} key=${i} onClick=${open}>
      <span class="dot"></span>
      <span class="onsheet-main"><b>${peers ? r.title : r.name}</b>${peers ? html`<span class="onsheet-sub">${[r.user, r.iface, r.ip].filter(Boolean).join(" · ")}</span>` : null}</span>
      <span class="onsheet-side">${peers ? (r.lastAge != null ? seen(r.lastAge) : "") : plural(r.count, "peer")}</span>
    </div>`; })}</div>
    ${rows.length > ONLINE_SHEET_CAP ? html`<div class="hint">${T("and {n} more", { n: rows.length - ONLINE_SHEET_CAP })}</div>` : null}`;
}
const onsheetFoot = () => html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>
  <button class="btn btn-primary" onClick=${() => { closeModal(); openUsers({ online: true }); }}>${T("Open Users")}</button>`;
export function OnlineSheet({ nodeId = null } = {}) {
  useStore();
  const [mode, setMode] = useState("users");
  const peers = mode === "peers";
  const rows = peers ? onlinePeerRows(nodeId, null) : onlineUserRows(nodeId);
  const count = peers ? rows.length : onlineUserCount(rows);
  const name = nodeId ? Store.nodeName(nodeId) : null;
  return html`<${Sheet} title=${(name ? name + " · " : "") + T("Online now · {n}", { n: count })} noGuard=${true} foot=${onsheetFoot()}>
    <div class="dpsw netsw-share onsheet-sw" role="radiogroup" aria-label=${T("Users or peers")}>${[["users", T("Users")], ["peers", T("Peers")]].map(([v, l]) =>
      html`<button type="button" role="radio" aria-checked=${mode === v} class=${mode === v ? "on" : ""} onClick=${() => setMode(v)}>${l}</button>`)}</div>
    ${!rows.length ? html`<div class="empty"><b>${peers ? T("No connections online") : T("No users online")}</b></div>` : onsheetRows(rows, peers)}
  <//>`;
}
const _onlSrc = new WeakMap();
function OnlineListSheet({ src }) {
  useStore();
  const d = _onlSrc.get(src) || { title: T("Online peers"), rows: [], peer: true, n: 0 };
  return html`<${Sheet} title=${d.title + " · " + d.n} noGuard=${true} foot=${onsheetFoot()}>
    ${!d.rows.length ? html`<div class="empty"><b>${d.peer ? T("no peers online") : T("no one online")}</b></div>` : onsheetRows(d.rows, d.peer)}
    ${d.orphans ? html`<div class="hint">${T("{v1} unmanaged orphan", { v1: plural(d.orphans, "peer") })}</div>` : null}
  <//>`;
}
const onlTap = (cls, open, body) => html`<span class=${"onlinetag m-onltap " + (cls || "")} role="button"
  onClick=${e => { e.stopPropagation(); e.preventDefault(); open(); }}>${body}</span>`;

export function OnlinePeersTag({ nodeId, iface, total, cls, trigger, orphans, orphHref }) {
  return html`<${OnlPop} peer title=${T("Online peers")} rows=${onlinePeerRows(nodeId, iface)} orphans=${orphans} orphHref=${orphHref} cls=${cls}
    trigger=${trigger || (c => html`<b class=${"oncount" + (c ? " on" : "")}>${c}</b>${(total != null ? " / " + total : "") + " " + T("val|online")}`)}/>`;
}

export const DASH_RANGES = [["live", "Live"], ["hour", "Hour"], ["day", "Day"], ["week", "Week"], ["month", "Month"]];
export const rangeLabel = k => isCustomKey(k) ? customKeyLabel(k) : ({ live: T("range|Live"), hour: T("range|Hour"), day: T("range|Day"), week: T("range|Week"), month: T("range|Month") }[k] || k);
export const rangeWord = k => isCustomKey(k) ? customKeyLabel(k) : (({ live: T("range|live"), hour: T("range|hour"), day: T("range|day"), week: T("range|week"), month: T("range|month") })[k] || T("range|live"));
export { isCustomKey, customKeyWindow };
export const customKeyLabel = k => trafficRangeLabel(customKeyWindow(k));
export const dashState = { nodes: null, range: "live", from: "", to: "", peers: true, mesh: true, ov: {} };
export function dashKey() {
  if (dashState.range !== "custom" || !dashState.from || !dashState.to) return dashState.range === "custom" ? "live" : dashState.range;
  const first = chartsFirstDay(), from = dashState.from < first ? first : dashState.from, to = dashState.to < from ? from : dashState.to;
  return "custom:" + from.replace(/-/g, "") + "-" + to.replace(/-/g, "");
}
(function () {
  try {
    const raw = JSON.parse(localStorage.getItem("swg-dash") || "{}");
    if (Array.isArray(raw.nodes) && raw.nodes.length) dashState.nodes = new Set(raw.nodes);
    if (DASH_RANGES.some(r => r[0] === raw.range)) dashState.range = raw.range;
    else if (raw.range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(raw.to || "")) Object.assign(dashState, { range: "custom", from: raw.from, to: raw.to });
    if (typeof raw.peers === "boolean") dashState.peers = raw.peers;
    if (typeof raw.mesh === "boolean") dashState.mesh = raw.mesh;
    if (raw.ov && typeof raw.ov === "object") dashState.ov = raw.ov;
  } catch (_) {}
})();
export function dashSave() {
  try { localStorage.setItem("swg-dash", JSON.stringify({ nodes: dashState.nodes ? [...dashState.nodes] : null, range: dashState.range, ...(dashState.range === "custom" ? { from: dashState.from, to: dashState.to } : {}), peers: dashState.peers, mesh: dashState.mesh, ov: dashState.ov })); } catch (_) {}
}

export function dashNodes() {
  const fleet = (Store.fleet || []).map(n => n.id);
  if (!dashState.nodes || !dashState.nodes.size) return fleet;
  const sel = fleet.filter(id => dashState.nodes.has(id));
  return sel.length ? sel : fleet;
}

export function dashNodeOn(id) { const s = dashState.nodes; return !s || !s.size || s.has(id); }

export function dashToggleNode(id) {
  const fleet = (Store.fleet || []).map(n => n.id);
  const sel = new Set(dashState.nodes && dashState.nodes.size ? [...dashState.nodes].filter(x => fleet.includes(x)) : fleet);
  if (sel.has(id)) {
    if (sel.size <= 1) return;
    sel.delete(id);
  } else sel.add(id);
  dashState.nodes = (sel.size >= fleet.length) ? null : sel;
  dashSave(); bus.emit();
}

export const evItemLabel = item => ({
  "Peer": T("event|Peer"), "User": T("event|User"), "Node": T("event|Node"),
  "Interface": T("event|Interface"), "Turn-proxy": T("event|Turn-proxy"), "Mesh": T("event|Mesh"),
  "Settings": T("event|Settings"), "Update": T("event|Update"),
}[item] || item);
export const EV_ITEMS = ["Peer", "User", "Node", "Interface", "Turn-proxy", "Mesh", "Settings", "Update"];
export const EV_ACTIONS = ["Added", "Changed", "Removed"];
export const evActionLabel = a => ({ "Added": T("event|Added"), "Changed": T("event|Changed"), "Removed": T("event|Removed") }[a] || a);
export const EV_ITEM_IC = { Peer: "device", User: "user", Node: "server", Interface: "network", "Turn-proxy": "relay", Mesh: "cascade", Settings: "gear", Update: "download" };
export const evSlug = s => s.toLowerCase().replace(/[^a-z]/g, "");
export function evItem(e) {
  const v = e.verb || "";
  if (e.kind === "peer") return "Peer";
  if (e.kind === "user") return "User";
  if (e.kind === "group") return "User";
  if (e.kind === "panel") return v === "Panel updated" ? "Update" : "Settings";
  if (e.kind === "settings") return "Settings";
  if (/interface/i.test(v)) return "Interface";
  if (/turn-proxy/i.test(v)) return "Turn-proxy";
  if (/mesh/i.test(v)) return "Mesh";
  if (/^update |host update/i.test(v)) return "Update";
  return "Node";
}
export function evAction(e) {
  const v = (e.verb || "").toLowerCase();
  if (/\b(deleted|removed|deleting|uninstalled|flagged)\b/.test(v)) return "Removed";
  if (/\b(created|enrolled|installing|creating|onboarding|added|linked|adopted)\b/.test(v)) return "Added";
  return "Changed";
}
export function evClick(e) {
  const item = evItem(e), v = e.verb || "", gone = /\bdeleted\b/i.test(v);
  if (item === "Peer") return gone ? { href: "#/users" } : { href: "#/users", on: () => revealPeer((Store.recon.peers || []).find(p => p.id === e.id)) };
  if (e.kind === "group") return { href: "#/users", on: () => { usersView.mode = "groups"; usersView.gq = ""; usersView.gpage = 1; clearUserFilters(); go("#/users"); Store.apply(); } };
  if (item === "User") return gone ? { href: "#/users" } : { href: "#/users", on: () => revealUser(e.id) };
  if (item === "Settings") return { href: "#/panel/settings", on: () => { setPendingSection((e.id && e.id !== "settings") ? e.id : null); go("#/panel/settings"); } };
  if (item === "Update") return null;
  if (/\b(removed node|uninstalled)\b/i.test(v)) return { href: "#/nodes" };
  return e.id ? { href: "#/node/" + encodeURIComponent(e.id) } : { href: "#/nodes" };
}
const NODE_REF = /\b([0-9a-f]{12})(?=\/)/g;
const withNodeNames = v => (typeof v === "string" ? v.replace(NODE_REF, id => Store.nodeName(id) || id) : v);
export function evDecorate(e, i) {
  const item = evItem(e);
  const action = evAction(e);
  const dv = e.detail_vars && Object.fromEntries(Object.entries(e.detail_vars).map(([k, v]) => [k, withNodeNames(v)]));
  return { ...e, detail: withNodeNames(e.detail), ...(dv ? { detail_vars: dv } : {}),
           item, itemLabel: evItemLabel(item), action, actionLabel: evActionLabel(action), icon: EV_ITEM_IC[item] || "info", slug: evSlug(item),
           click: evClick(e), key: "e" + (e.eid || e.ts) + "_" + i };
}
export function synthEvents() {
  const ev = [];
  for (const u of Store.recon.users) {
    const c = u.created_at || 0, m = u.modified_at || c;
    ev.push({ ts: m, kind: "user", id: u.id, verb: m > c + 5 ? T("Updated user") : T("Created user"), name: u.name, detail: "" });
  }
  for (const p of Store.recon.peers) {
    const c = p.created_at || 0, m = p.modified_at || c;
    ev.push({ ts: m, kind: "peer", id: p.id, verb: m > c + 5 ? T("Updated peer") : T("Created peer"), name: p.title || p.name || T("unassigned peer"), detail: "" });
  }
  return ev.filter(e => e.ts).sort((a, b) => b.ts - a.ts);
}
export function recentActivity(n) {
  const src = (Store.events && Store.events.length) ? Store.events : synthEvents();
  return src.slice(0, n || 15).map(evDecorate);
}

let _svcLabel = null;
export const SVC_LABEL = new Proxy({}, { get: (_, k) => (_svcLabel || (_svcLabel = { sub: T("Subscription server"), netctl: T("Network & TLS helper"), update: T("One-click self-update"), panel: T("Panel server"), awg: T("AmneziaWG datapath") }))[k] });
export const SVC_UNIT  = { sub: "swg-sub", netctl: "swg-netctl", update: "swg-update", panel: "swg-panel-server", awg: "" };
let _svcKind = null;
export const SVC_KINDWORD = new Proxy({}, { get: (_, k) => (_svcKind || (_svcKind = { missing: T("not installed"), down: T("not running"), disabled: T("won’t survive a reboot"), unwritable: T("can’t be saved") }))[k] });
function subCertIssue(out) {
  const sc = Store.subCert || {};
  if (!sc.needs_issue || !subFeatureOn()) return;
  out.push({ id: "subcert", sev: "critical", kind: sc.present ? "wrong" : "missing",
             label: T("Subscription certificate"), unit: SVC_UNIT.sub,
             msg: sc.present
               ? T("the subscription server's certificate doesn't match {v1}", { v1: T("{v1} — subscribers get a TLS error", { v1: sc.domain }) })
               : T("the subscription server has no certificate for {v1}", { v1: T("{v1} — subscribers get a TLS error", { v1: sc.domain }) }) });
}

function sessionKeyIssue(out) {
  const why = Store.sessionEphemeral;
  if (!why) return;
  out.push({ id: "sessionkey", sev: "warn", kind: "unwritable",
             label: T("Session key"), unit: SVC_UNIT.panel,
             msg: T("the panel can't save the key it signs sign-ins with ({v1}), so everyone is signed out whenever it restarts — its state directory is owned by another user", { v1: why }) });
}

export function serviceIssues() {
  const ps = Store.panelServices || {};
  if (inProc(Store.hostProc)) return [];
  const out = [], add = (id, sev, kind, msg, fix = true) => out.push({ id, sev, kind, msg, fix, label: SVC_LABEL[id], unit: SVC_UNIT[id] });
  subCertIssue(out);
  sessionKeyIssue(out);
  if (!Object.keys(ps).length) return out;
  const gone = u => u && !u.present;
  const down = u => u && u.present && u.active !== "active";
  const unen = u => u && u.present && u.enabled && u.enabled !== "enabled" && u.enabled !== "static";
  const sub = ps.sub;
  if (sub && subFeatureOn()) {
    if (gone(sub))      add("sub", "critical", "missing", T("the subscription server isn’t installed — subscribers can’t load their configs"));
    else if (down(sub)) add("sub", "critical", "down", T("the subscription server isn’t running — subscribers can’t load their configs"));
    else if (unen(sub)) add("sub", "warn", "disabled", T("the subscription server won’t start again after a reboot"));
  }
  const np = ps.netctl_path, nt = ps.netctl_timer;
  if (gone(np) || gone(nt))       add("netctl", "warn", "missing", T("Panel URL and address changes can’t be applied until it’s restored"));
  else if (down(np) && down(nt))  add("netctl", "warn", "down", T("Panel URL and address changes can’t be applied right now"));
  else if (unen(np) || unen(nt))  add("netctl", "warn", "disabled", T("the network helper won’t start again after a reboot"));
  const up = ps.update;
  if (gone(up))      add("update", "warn", "missing", T("the one-click Update button won’t work (a manual update still will)"));
  else if (down(up)) add("update", "warn", "down", T("the one-click Update button won’t work right now"));
  else if (unen(up)) add("update", "warn", "disabled", T("one-click self-update won’t arm again after a reboot"));
  if (unen(ps.panel)) add("panel", "warn", "disabled", T("the panel won’t start again after a reboot"));
  const dp = (Store.datapath || {}).awg;
  if (dp && dp.needed && !dp.ok && !dp.updating) {
    if (dp.why === "key") add("awg", dp.fallback ? "warn" : "critical", "secureboot", dp.mok
      ? T("Secure Boot refuses the AmneziaWG kernel module — its signing key is not enrolled ({v1}). Enrol it once: sudo mokutil --import {v2}, reboot, and pick “Enroll MOK” at the console", {
          v1: dp.fallback ? T("awg interfaces run on the slower fallback datapath") : T("awg interfaces can’t come up"), v2: dp.mok })
      : T("Secure Boot refuses the AmneziaWG kernel module — its signing key is not enrolled ({v1}). Enrol the key DKMS signed it with once — sudo mokutil --import /var/lib/shim-signed/mok/MOK.der on Ubuntu, /var/lib/dkms/mok.pub on Debian — then reboot and pick “Enroll MOK” at the console", {
          v1: dp.fallback ? T("awg interfaces run on the slower fallback datapath") : T("awg interfaces can’t come up") }), false);
    else if (dp.why === "compile") add("awg", dp.fallback ? "warn" : "critical", "compile", dp.fallback
      ? T("AmneziaWG runs on the slower fallback datapath — its kernel module does not compile on this kernel yet; an update tries again when a new kernel or a newer AmneziaWG build arrives")
      : T("the AmneziaWG kernel module does not compile on this kernel yet — awg interfaces can’t come up; an update tries again when a new kernel or a newer AmneziaWG build arrives"));
    else if (dp.fallback) add("awg", "warn", "fallback", T("AmneziaWG runs on the slower fallback datapath — its kernel module isn’t built or loaded; running Update rebuilds it"));
    else add("awg", "critical", "module", T("the AmneziaWG kernel module isn’t built or loaded — awg interfaces can’t come up; running Update rebuilds it"));
  }
  out.sort((a, b) => (b.sev === "critical") - (a.sev === "critical"));
  return out;
}
export function svcKey(is) { return is.id + ":" + is.kind; }
export function svcSilencedSet() { try { return new Set(JSON.parse(localStorage.getItem("swg-svc-silence") || "[]")); } catch (_) { return new Set(); } }
export function svcSaveSilence(s) { try { localStorage.setItem("swg-svc-silence", JSON.stringify([...s])); } catch (_) {} }
export function svcSilence(is) { const s = svcSilencedSet(); s.add(svcKey(is)); svcSaveSilence(s); bus.emit(); }

export const activityView = { q: "", item: "", action: "", page: 1 };
