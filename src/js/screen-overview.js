import {
  ago, dur, fmtBytes, seen, panelNowS, isMobile,
} from "./util.js";
import { T, Trich, plural, pluralWord, srvVerb, srvDetail, srvName, srvText } from "./i18n.js";
import {
  Store, api, bus, useStore,
} from "./store.js";
import {
  turnColor, turnFork, turnForkList, forkNames, forkLabel,
} from "./turn-catalog.js";
import {
  targetType, awgDict3, tip3, lastHeard,
} from "./model.js";
import {
  Badge, Popover, STATUS_RANK, Sheet, StoreOffBanner, closeModal, dlul, ifaceColor, modalDepth, openModal,
  rateCell, secTitle, toast, xferCell, tgt3,
  Ic,
  rate,
} from "./ui.js";
import {
  MultiRing, OnlineBlocks, RANGE_CAP, RANGE_WIN, axisCap, histTime, RankBars, RingLegend, ThroughputChart, TrendSpark,
} from "./charts.js";
import { RailCustom } from "./traffic-ui.js";
import { panelToday, chartsFirstDay, trafficTotals, talkerGroups } from "./traffic.js";
import {
  DASH_RANGES, OnlineUsersTag, onlinePeerRows, SVC_KINDWORD, dashKey, dashNodes, dashSave, dashState, isCustomKey, customKeyWindow, openUsers, rangeLabel, rangeWord, recentActivity,
  revealOrphans, revealPeer, revealUser, serviceIssues, svcKey, svcSaveSilence,
  svcSilence, svcSilencedSet,
} from "./views.js";
import {
  CAT_UNCAT_COLOR, blockCatLabel, catLabelOf, dashRankColor, fmtCount, isBlockCat,
} from "./routing.js";
import {
  enabledTurnForkIds, turnEnabled,
} from "./turn.js";
import {
  openNodeCreate,
} from "./sheets-crud.js";
import {
  NodesRailPanel,
} from "./grids.js";
import {
  NodeHealth, healthAlerts,
} from "./screen-nodes.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);


const SVC_LOG_SRC = { "swg-panel-server": "panel", "swg-sub": "sub", "swg-netctl": "netctl", "swg-update": "update", "swg-noded": "noded" };
function svcLogCmd(unit) {
  const src = SVC_LOG_SRC[String(unit).replace(/\.(service|timer|path)$/, "")];
  return src && (Store.env || {}).platform !== "nixos" ? "swg-logs " + src + " -e" : "journalctl -u " + unit + " -e";
}

export function FleetNodeCard({ n, traffic, ranged, histRange, nodeHist, presence }) {
  const live = Store.recon.nodeStatus[n.id] === "live";
  const snap = Store.stats[n.id];
  const nrec = (Store.nodes || []).find(x => x.id === n.id) || {};
  const health = nrec.health || null;
  const tr = traffic || { rx: 0, tx: 0 };
  const trafCell = ranged ? xferCell(...dlul(tr.rx, tr.tx)) : rateCell(tr.rx, tr.tx);
  const seenAt = lastHeard(nrec, snap);
  let sync = T("no data"); if (seenAt) { const a = Math.floor(panelNowS() - seenAt); sync = live ? (isMobile() ? seen(a) : T("{v1} ago", { v1: seen(a) })) : T("stale · {v1}", { v1: seen(a) }); }
  const al = healthAlerts(health);
  const ifs = Store.describe[n.id] || {}; let wg = 0, awg = 0, awg3 = 0;
  for (const ifn in ifs) { const m = ifs[ifn]; if (!m || m.system) continue; if (awgDict3(m.awg_params)) awg3++; else if (m.awg_params && Object.keys(m.awg_params).length) awg++; else wg++; }
  const wdtt = ((Store.stats[n.id] || {}).wdtt || []).filter(w => w && w.iface).length;
  const csqtt = ((Store.stats[n.id] || {}).csqtt || []).filter(c => c && c.iface).length;
  const ifBadges = []; if (awg) ifBadges.push(["awg", awg]); if (awg3) ifBadges.push(["awg", awg3, true]); if (wg) ifBadges.push(["wg", wg]); if (wdtt) ifBadges.push(["wdtt", wdtt]); if (csqtt) ifBadges.push(["csqtt", csqtt]);
  return html`<a class=${"fnode " + (live ? "" : "stale")} href=${"#/node/" + encodeURIComponent(n.id)}>
    <div class="fnode-main">
      <div class="fnode-top"><span class="dot ${live ? "live" : "stale"}"></span><span class="fnode-name">${n.name}</span>${al.length ? html`<span class="halert hot"><${Ic} i="warn"/> ${al.length}</span>` : ""}<span class="grow"></span>${ifBadges.length ? html`<div class="fnode-ifs">${ifBadges.map(([t, c, g3]) => html`<span key=${t + (g3 ? "3" : "")} class=${"iftype " + t + (g3 ? " awg3" : "")} ...${tip3(g3)}>${t}${c > 1 ? " ×" + c : ""}</span>`)}</div>` : null}<span class="rowarrow"><${Ic} i="arrow"/></span></div>
      <div class="fnode-stats">
        <div><span class="fl">${T("Throughput")}</span>${trafCell}</div>
        <div><span class="fl">${T("status|Online")}</span><span class="fv"><${OnlineUsersTag} nodeId=${n.id} presence=${presence} rangeLabel=${rangeWord(histRange)} trigger=${isMobile()
          ? c => html`<span class="faint">${plural(c, "user")} · ${plural(onlinePeerRows(n.id, null).length, "peer")}</span>`
          : (c, w) => html`<span class="faint">${plural(c, w || "user")}</span>`}/></span></div>
        <div><span class="fl">${T("Sync")}</span><span class="fv">${sync}</span></div>
      </div>
    </div>
    ${isMobile() ? null : html`<div class="fnode-health">
      ${health ? html`<${NodeHealth} health=${health} node=${n.id} compact=${true} range=${histRange} nodeHist=${nodeHist}/>` : html`<div class="fnode-nohealth">${live ? T("no health data reported") : T("node offline")}</div>`}
    </div>`}
  </a>`;
}

export function ifCountPhrase(g) {
  const parts = [];
  if (g.wg.size) parts.push(T("{v1} WireGuard", { v1: g.wg.size }));
  if (g.awg.size) parts.push(T("{v1} AmneziaWG", { v1: g.awg.size }));
  if (g.wdtt && g.wdtt.size) parts.push(T("{v1} WDTT", { v1: g.wdtt.size }));
  if (g.csqtt && g.csqtt.size) parts.push(T("{v1} CSQTT", { v1: g.csqtt.size }));
  const tot = g.wg.size + g.awg.size + (g.wdtt ? g.wdtt.size : 0) + (g.csqtt ? g.csqtt.size : 0);
  const phrase = parts.length > 1
    ? T("{v1} and {v2}", { v1: parts.slice(0, -1).join(", "), v2: parts[parts.length - 1] })
    : (parts[0] || "0");
  return T("{v1} {v2}", { v1: phrase, v2: pluralWord(tot, "interface") });
}
export function ifTypeLabel(node, iface) {
  const m = Store.ifaceMeta && Store.ifaceMeta(node, iface);
  return (m && Object.keys(m.awg_params || {}).length) ? "AmneziaWG" : "WireGuard";
}


export const RANGE_ICON = { hour: "hour2", day: "daycal", week: "weekcal", month: "monthcal" };
export const DASH_NAV = [["Fleet", "fleet", "server"], ["Distribution", "distribution", "donut"],
  ["Traffic flow", "flow", "flow"], ["Top charts", "protection|topnodes", "bars"], ["Activity log", "activity", "excl"]];
export const dashNavLabel = k => ({ "Fleet": T("nav|Fleet"), "Distribution": T("nav|Distribution"), "Traffic flow": T("nav|Traffic flow"),
  "Top charts": T("nav|Top charts"), "Activity log": T("nav|Activity log") }[k] || k);
export function trafPick(rx, tx, mrx, mtx, f) {
  const crx = Math.max(0, (rx || 0) - (mrx || 0)), ctx = Math.max(0, (tx || 0) - (mtx || 0));
  return { rx: (f.peers ? crx : 0) + (f.mesh ? (mrx || 0) : 0),
           tx: (f.peers ? ctx : 0) + (f.mesh ? (mtx || 0) : 0) };
}
export function trafFlags(key) {
  const ov = key && dashState.ov ? dashState.ov[key] : null;
  return { peers: ov && ov.peers != null ? ov.peers : dashState.peers,
           mesh:  ov && ov.mesh  != null ? ov.mesh  : dashState.mesh };
}
export function dashToggleTrafKey(key, which) {
  const cur = trafFlags(key), other = which === "peers" ? "mesh" : "peers";
  const next = { peers: cur.peers, mesh: cur.mesh };
  if (next[which] && !next[other]) { next[which] = false; next[other] = true; }
  else next[which] = !next[which];
  dashState.ov = dashState.ov || {}; dashState.ov[key] = next;
  dashSave(); bus.emit();
}
function ofTotal(dn, up) {
  const one = T("of {dn} and {up} total");
  const [a, r1] = [one.split("{dn}")[0], one.split("{dn}").slice(1).join("{dn}")];
  const [b, c] = [r1.split("{up}")[0], r1.split("{up}").slice(1).join("{up}")];
  return html`<${Fragment}>${a}<span style="color:var(--online)">↓${dn}</span>${b}<span style="color:var(--rate-up)">↑${up}</span>${c}<//>`;
}

export function dashSetRange(r) { if (DASH_RANGES.some(x => x[0] === r)) { dashState.range = r; dashSave(); bus.emit(); } }
export function dashSetCustom(from, to) { Object.assign(dashState, { range: "custom", from, to }); dashSave(); bus.emit(); }

export function mergeFleetSeries(selIds) {
  const byT = new Map();
  selIds.forEach(id => {
    const n = (Store.nodes || []).find(x => x.id === id); const h = n && n.health_history;
    if (!h || !h.t) return;
    h.t.forEach((t, i) => { const r = byT.get(t) || { rx: 0, tx: 0, on: 0 };
      r.rx += Math.max(0, ((h.rx || [])[i] || 0) - ((h.mrx || [])[i] || 0));
      r.tx += Math.max(0, ((h.tx || [])[i] || 0) - ((h.mtx || [])[i] || 0));
      r.on += (h.pon || [])[i] || 0; byT.set(t, r); });
  });
  const t = [...byT.keys()].sort((a, b) => a - b);
  return { t, rx: t.map(x => byT.get(x).rx), tx: t.map(x => byT.get(x).tx), on: t.map(x => byT.get(x).on), hasOn: t.some(x => byT.get(x).on > 0) };
}
export const DASH_TICK_MAX = 180;
export const dashLive = { t: [], on: {} };
export function recordDashTick() {
  const rec = Store.recon; if (!rec) return;
  const now = Math.floor(Date.now() / 1000);
  if (dashLive.t.length && now - dashLive.t[dashLive.t.length - 1] < 3) return;
  const byNode = {};
  rec.peers.forEach(p => p.targets.forEach(t => { if (t.online) byNode[t.node] = (byNode[t.node] || 0) + 1; }));
  const L = dashLive.t.length;
  (Store.fleet || []).forEach(n => { const a = dashLive.on[n.id] || (dashLive.on[n.id] = new Array(L).fill(0)); while (a.length < L) a.push(0); a.push(byNode[n.id] || 0); });
  dashLive.t.push(now);
  if (dashLive.t.length > DASH_TICK_MAX) { dashLive.t.shift(); Object.values(dashLive.on).forEach(a => a.shift()); }
}
export function dashOnlineTrend(selIds) {
  const t = dashLive.t; if (t.length < 2) return null;
  return { t, pts: t.map((_, i) => selIds.reduce((a, id) => a + ((dashLive.on[id] || [])[i] || 0), 0)) };
}
export function fleetHistory(selIds, range, hist) {
  if (range === "live") {
    const m = mergeFleetSeries(selIds);
    if (m.hasOn) return { t: m.t, rx: m.rx, tx: m.tx, onT: m.t, on: m.on };
    const o = dashOnlineTrend(selIds);
    return { t: m.t, rx: m.rx, tx: m.tx, onT: o ? o.t : [], on: o ? o.pts : [] };
  }
  const byT = new Map();
  selIds.forEach(id => { const d = hist.byNode[id]; if (!d || !d.t) return;
    d.t.forEach((t, i) => { const r = byT.get(t) || { rx: 0, tx: 0, on: 0 };
      r.rx += Math.max(0, ((d.rx || [])[i] || 0) - ((d.mrx || [])[i] || 0));
      r.tx += Math.max(0, ((d.tx || [])[i] || 0) - ((d.mtx || [])[i] || 0));
      r.on += (d.pon || [])[i] || 0; byT.set(t, r); }); });
  const t = [...byT.keys()].sort((a, b) => a - b);
  return { t, rx: t.map(x => byT.get(x).rx), tx: t.map(x => byT.get(x).tx), onT: t, on: t.map(x => byT.get(x).on) };
}
export const ONLINE_BLOCKS = { live: [30, 30], hour: [30, 120], day: [24, 3600], week: [28, 21600], month: [30, 86400] };
export function resampleBlocks(t, v, n, step) {
  const out = new Array(n).fill(null);
  if (!t || !t.length) return out;
  const end = t[t.length - 1];
  for (let i = 0; i < t.length; i++) {
    const idx = n - 1 - Math.floor((end - t[i]) / step);
    if (idx >= 0 && idx < n) { const x = v[i] || 0; out[idx] = out[idx] == null ? x : Math.max(out[idx], x); }
  }
  return out;
}


export function DashRail() {
  const fleet = Store.fleet || [];
  const range = dashState.range;
  const findSection = find => { for (const a of String(find).split("|")) { const el = document.querySelector('.section-title[data-sec="' + a + '"]'); if (el) return el; } return null; };
  const jump = find => { const s = findSection(find); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const menuIc = ic => /^[a-z0-9_-]+$/.test(ic) ? html`<${Ic} i=${ic}/>` : html`<span class="railmenu-emoji">${ic}</span>`;
  const [active, setActive] = useState(0);
  useEffect(() => {
    let raf = 0;
    const compute = () => { raf = 0;
      let idx = 0;
      DASH_NAV.forEach(([label, find], i) => { const el = findSection(find);
        if (el && el.getBoundingClientRect().top <= 130) idx = i; });
      setActive(idx); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    window.addEventListener("scroll", onScroll, { passive: true }); compute();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return html`<div class="dashrail">
    <div class="dashrail-stack">
      <div class="railpanel railmenu">
        ${DASH_NAV.map(([label, find, ic], i) => html`<button key=${label} class=${"railmenu-b" + (i === active ? " on" : "")} onClick=${() => jump(find)} title=${dashNavLabel(label)}>
          <span class="railmenu-ic">${menuIc(ic)}</span><span class="railmenu-t">${dashNavLabel(label)}</span></button>`)}
      </div>
      <div class="railpanel railmenu">
        ${DASH_RANGES.map(([k]) => html`<button key=${k} class=${"railmenu-b" + (range === k ? " on" : "")} onClick=${() => dashSetRange(k)} title=${rangeLabel(k)}>
          <span class="railmenu-ic">${k === "live" ? html`<span class="rlive-dot"></span>` : html`<${Ic} i=${RANGE_ICON[k]}/>`}</span><span class="railmenu-t">${rangeLabel(k)}</span></button>`)}
        <${OverviewCustom} on=${range === "custom"}/>
      </div>
      ${fleet.length > 1 ? html`<${NodesRailPanel} nav=${false}/>` : null}
    </div>
  </div>`;
}

function OverviewCustom({ on }) {
  const today = panelToday(), k = dashKey();
  const w = isCustomKey(k) ? customKeyWindow(k) : null;
  const first = chartsFirstDay(today), m1 = today.slice(0, 8) + "01";
  const from = w ? w.from : (m1 < first ? first : m1), to = w ? (w.to > today ? today : w.to) : today;
  return html`<${RailCustom} key=${k} on=${on} label=${rangeLabel(k)} from=${from} to=${to} min=${first} max=${today} onApply=${dashSetCustom}/>`;
}

export const RANGE_STEP = { hour: 15, day: 300, week: 1800, month: 7200 };
export function rangeStep(key, hist) {
  return isCustomKey(key) ? ((hist && hist.axis && hist.axis.step) || 0) : (RANGE_STEP[key] || 1);
}
export const talkWindow = key => isCustomKey(key) ? customKeyWindow(key) : { window: RANGE_WIN[key] };
export function talkSub(key, d, scoped) {
  let s = T("{range} · by volume", { range: rangeWord(key) });
  if (scoped) s += " · " + T("each on all their servers");
  const win = RANGE_WIN[key];
  if (d && d.asked && win && (d.since > d.asked + 60 || d.asked - d.since > win / 10))
    s += " · " + T("since {v1}", { v1: histTime(d.since, "day") });
  return s;
}
function rangedTalkerRows(d, inScope, n) {
  if (!d) return [];
  return talkerGroups(d, inScope).slice(0, n).map((g, i) => {
    const user = g.uid ? Store.user(g.uid) : null, p0 = g.uid ? null : Store.peer(g.pid);
    const devs = g.devices.filter(x => x.rx + x.tx > 0).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
    return {
      label: user ? user.name : ((p0 && p0.title) || T("Unassigned peer")), value: g.rx + g.tx, count: devs.length,
      sub: xferCell(...dlul(g.rx, g.tx)),
      bub: devs.length > 1 ? devs.map(x => { const t = ((x.peer || {}).targets || [])[0]; const oct = ((t || {}).ip || "").split(".").pop();
        const nm = x.name || (oct ? T("Peer .{v1}", { v1: oct }) : T("Peer"));
        return { kind: t ? targetType(t) : null, gen3: t ? tgt3(t) : false, value: x.rx + x.tx, sub: xferCell(...dlul(x.rx, x.tx)),
          name: x.gone === "deleted" ? nm + " · " + T("deleted") : x.gone === "handed" ? nm + " · " + T("handed on") : nm }; }) : null,
      color: dashRankColor(i, "talker"), href: "#/users",
      onClick: e => { e.preventDefault(); user ? revealUser(user.id) : p0 && revealPeer(p0); },
    };
  });
}
export const effRangeOf = (dKey, loaded) => dKey === "live" ? "live" : loaded;
export function blockPollMs(key, today) {
  if (!isCustomKey(key)) return 15000;
  return customKeyWindow(key).to < today ? 0 : 60000;
}
export function useRangeHistory(range, selIds) {
  const empty = { loading: false, byNode: {}, mesh: [], cats: [], turn: [], exits: [], presence: null, axis: null, err: null, range: "live" };
  const [st, setSt] = useState(empty);
  const key = range + "|" + selIds.slice().sort().join(",");
  useEffect(() => {
    if (range === "live") { setSt(empty); return; }
    let alive = true; setSt(s => ({ ...s, loading: true }));
    const custom = isCustomKey(range);
    const [obN, obStep] = custom ? [0, 0] : (ONLINE_BLOCKS[range] || ONLINE_BLOCKS.live);
    Promise.all([
      Promise.all(selIds.map(id => api.nodeHistory(id, range).then(r => [id, r]).catch(() => [id, null]))),
      api.meshHistory(range).then(r => (r && r.data && r.data.pairs) || []).catch(() => []),
      api.categoryHistory(range).then(r => (r && r.data && r.data.cats) || []).catch(() => []),
      api.turnHistory(range).then(r => (r && r.data && r.data.turn) || []).catch(() => []),
      api.exitHistory(range).then(r => (r && r.data && r.data.exits) || []).catch(() => []),
      api.presence(range, obN, obStep, selIds).then(r => (r && r.data) || null).catch(() => null),
    ]).then(([rows, mesh, cats, turn, exits, presence]) => { if (!alive) return;
      const byNode = {}; let axis = null, err = null;
      rows.forEach(([id, r]) => { byNode[id] = (r && r.ok && r.data) || null;
        if (r && r.ok && r.data && r.data.axis) axis = r.data.axis; else if (r && r.ok === false && !err) err = r; });
      setSt({ loading: false, byNode, mesh, cats, turn, exits, presence, axis, err, range }); });
    return () => { alive = false; };
  }, [key]);
  return st;
}

export function DashDoughnuts({ selIds, range, hist }) {
  const sel = new Set(selIds);
  const fleet = (Store.fleet || []).filter(n => sel.has(n.id));
  const live = range === "live";
  const ranged = !live && hist.range === range;
  const STEP = rangeStep(range, hist);
  const isSys = (nid, ifn) => !!(Store.describe[nid] && Store.describe[nid][ifn] && Store.describe[nid][ifn].system);
  const ifType = (nid, ifn) => {
    if (((Store.stats[nid] || {}).wdtt || []).some(w => w && w.iface === ifn)) return "wdtt";
    if (((Store.stats[nid] || {}).csqtt || []).some(c => c && c.iface === ifn)) return "csqtt";
    const m = Store.describe[nid] && Store.describe[nid][ifn]; return (m && m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg"; };
  const sPeers = Store.recon.peers.filter(p => p.targets.some(t => sel.has(t.node)));
  const _sum = a => (a || []).reduce((x, v) => x + (v || 0), 0);
  const clientVol = d => { let rx = 0, tx = 0; const R = (d && d.rx) || [], T = (d && d.tx) || [], MR = (d && d.mrx) || [], MT = (d && d.mtx) || [];
    for (let i = 0; i < R.length; i++) { rx += Math.max(0, (R[i] || 0) - (MR[i] || 0)); tx += Math.max(0, (T[i] || 0) - (MT[i] || 0)); } return { rx: rx * STEP, tx: tx * STEP }; };
  const awgVol = d => ({ rx: _sum(d && d.arx) * STEP, tx: _sum(d && d.atx) * STEP });
  const meshVol = d => ({ rx: _sum(d && d.mrx) * STEP, tx: _sum(d && d.mtx) * STEP });

  const FN = trafFlags("dnode"), FT = trafFlags("dtype");
  const nodeRaw = {};
  const typeRaw = { wg: { rx: 0, tx: 0 }, awg: { rx: 0, tx: 0 }, wdtt: { rx: 0, tx: 0 }, csqtt: { rx: 0, tx: 0 }, mesh: { rx: 0, tx: 0 } };
  const addType = (k, rx, tx) => { (typeRaw[k] = typeRaw[k] || { rx: 0, tx: 0 }).rx += rx; typeRaw[k].tx += tx; };
  fleet.forEach(n => {
    if (ranged) {
      const d = hist.byNode[n.id]; const cv = clientVol(d), av = awgVol(d), mv = meshVol(d);
      nodeRaw[n.id] = { crx: cv.rx, ctx: cv.tx, mrx: mv.rx, mtx: mv.tx };
      addType("awg", av.rx, av.tx); addType("wg", Math.max(0, cv.rx - av.rx), Math.max(0, cv.tx - av.tx));
      addType("mesh", mv.rx, mv.tx);
    } else {
      let crx = 0, ctx = 0, mrx = 0, mtx = 0; const snap = Store.stats[n.id];
      if (snap) for (const [ifn, blk] of Object.entries(snap.interfaces || {})) {
        let r = 0, t = 0; for (const pp of blk.peers || []) { r += pp.rx_speed || 0; t += pp.tx_speed || 0; }
        if (isSys(n.id, ifn)) { mrx += r; mtx += t; }
        else { crx += r; ctx += t; addType(ifType(n.id, ifn), r, t); }
      }
      if (snap) for (const w of (snap.wdtt || [])) {
        const r = w.rx_speed || 0, t = w.tx_speed || 0; crx += r; ctx += t; addType("wdtt", r, t);
      }
      if (snap) for (const c of (snap.csqtt || [])) {
        const r = c.rx_speed || 0, t = c.tx_speed || 0; crx += r; ctx += t; addType("csqtt", r, t);
      }
      addType("mesh", mrx, mtx);
      nodeRaw[n.id] = { crx, ctx, mrx, mtx };
    }
  });
  const nodeTraf = {}; fleet.forEach(n => { const r = nodeRaw[n.id] || { crx: 0, ctx: 0, mrx: 0, mtx: 0 }; nodeTraf[n.id] = trafPick(r.crx + r.mrx, r.ctx + r.mtx, r.mrx, r.mtx, FN); });
  const typePick = k => k === "mesh" ? { rx: FT.mesh ? typeRaw.mesh.rx : 0, tx: FT.mesh ? typeRaw.mesh.tx : 0 }
                                     : { rx: FT.peers ? typeRaw[k].rx : 0, tx: FT.peers ? typeRaw[k].tx : 0 };
  const typeTraf = { wg: typePick("wg"), awg: typePick("awg"), wdtt: typePick("wdtt"), csqtt: typePick("csqtt"), mesh: typePick("mesh") };
  const trafFmt = ranged ? fmtBytes : rate;

  const nodeCnt = {}, typeCnt = { wg: { tot: 0, on: 0 }, awg: { tot: 0, on: 0 }, wdtt: { tot: 0, on: 0 }, csqtt: { tot: 0, on: 0 } };
  fleet.forEach(n => nodeCnt[n.id] = { tot: 0, on: 0 });
  const tyOf = targetType;
  sPeers.forEach(p => p.targets.forEach(t => {
    if (!sel.has(t.node)) return;
    const ty = tyOf(t);
    nodeCnt[t.node].tot++; (typeCnt[ty] = typeCnt[ty] || { tot: 0, on: 0 }).tot++;
    if (!ranged && t.online) { nodeCnt[t.node].on++; typeCnt[ty].on++; }
  }));
  if (ranged) {
    const pnodes = (hist.presence && hist.presence.nodes) || {};
    fleet.forEach(n => nodeCnt[n.id].on = ((pnodes[n.id] || {}).peers) || 0);
    Object.keys(typeCnt).forEach(ty => typeCnt[ty].on = 0);
    Object.entries(pnodes).forEach(([nid, v]) => {
      if (!sel.has(nid)) return;
      Object.entries(v.ifaces || {}).forEach(([ifn, c]) => {
        const ty = ifType(nid, ifn);
        if (typeCnt[ty]) typeCnt[ty].on += c;
      });
    });
  }

  const nodeName = id => Store.nodeName(id), nodeColor = id => Store.nodeColor(id);
  const TYPES = [["awg", "AmneziaWG"], ["wg", "WireGuard"], ["wdtt", "WDTT"], ["csqtt", "CSQTT"], ["mesh", T("Mesh")]];
  const typeColor = t => t === "mesh" ? FLOW_MESH : ifaceColor(t);
  const segNodes = kind => fleet.map(n => ({ key: n.id, name: nodeName(n.id), value: (nodeTraf[n.id] || {})[kind] || 0, color: nodeColor(n.id) }));
  const segTypes = kind => TYPES.map(([t, nm]) => ({ key: t, name: nm, value: (typeTraf[t] || {})[kind] || 0, color: typeColor(t) }));
  const sum = (o, k) => Object.values(o).reduce((a, v) => a + (v[k] || 0), 0);

  const fitFs = n => n <= 9 ? 16 : n <= 11 ? 14 : n <= 13 ? 12.5 : 11;
  const povPeers = (Store.panelSettings || {}).throughput_perspective === "peers";
  const trafCenter = (rx, tx) => {
    const [down, up] = dlul(rx, tx);
    const ds = "↓ " + trafFmt(down), us = "↑ " + trafFmt(up);
    const dfs = fitFs(Math.max(ds.length, us.length)), ufs = Math.max(11, dfs - 3);
    return html`<div class="mrc-def"><span class="mrc-k">${T("val|total")}</span>
      <span class="mrc-tot dn" style=${"font-size:" + dfs + "px"}>${ds}</span><span class="mrc-tot up" style=${"font-size:" + ufs + "px"}>${us}</span></div>`;
  };
  const cntCenter = (on, tot) => html`<div class="mrc-def"><span class="mrc-k">${T("val|online")}</span>
    <span class="mrc-tot dn">${on}<small style="color:var(--faint)"> / ${tot}</small></span></div>`;

  const totDownN = sum(nodeTraf, "rx"), totUpN = sum(nodeTraf, "tx");
  const totDownT = typeTraf.wg.rx + typeTraf.awg.rx + typeTraf.wdtt.rx + typeTraf.csqtt.rx + typeTraf.mesh.rx, totUpT = typeTraf.wg.tx + typeTraf.awg.tx + typeTraf.wdtt.tx + typeTraf.csqtt.tx + typeTraf.mesh.tx;
  const nodeOn = Object.values(nodeCnt).reduce((a, v) => a + v.on, 0), nodeTot = Object.values(nodeCnt).reduce((a, v) => a + v.tot, 0);
  const typeOn = typeCnt.wg.on + typeCnt.awg.on + typeCnt.wdtt.on + typeCnt.csqtt.on, typeTot = typeCnt.wg.tot + typeCnt.awg.tot + typeCnt.wdtt.tot + typeCnt.csqtt.tot;

  const legDU = (rx, tx) => { const [d, u] = dlul(rx, tx); return { down: trafFmt(d), up: trafFmt(u) }; };
  const trafLegNodes = fleet.map(n => ({ key: n.id, name: nodeName(n.id), color: nodeColor(n.id),
    ...legDU((nodeTraf[n.id] || {}).rx || 0, (nodeTraf[n.id] || {}).tx || 0) }));
  const trafLegTypes = TYPES.filter(([t]) => (typeCnt[t] || { tot: 0 }).tot > 0
      || ((typeTraf[t] || {}).rx || 0) + ((typeTraf[t] || {}).tx || 0) > 0).map(([t, nm]) => ({ key: t, name: nm, color: typeColor(t),
    ...legDU((typeTraf[t] || {}).rx || 0, (typeTraf[t] || {}).tx || 0) }));
  const cntLegNodes = fleet.map(n => ({ key: n.id, name: nodeName(n.id), color: nodeColor(n.id), right: nodeCnt[n.id].on + " / " + nodeCnt[n.id].tot }));
  const cntLegTypes = TYPES.filter(([t]) => (typeCnt[t] || { tot: 0 }).tot > 0).map(([t, nm]) => ({ key: t, name: nm, color: ifaceColor(t), right: typeCnt[t].on + " / " + typeCnt[t].tot }));

  const rlabel = DASH_RANGES.find(r => r[0] === range);
  const rname = rlabel ? rlabel[1].toLowerCase() : rangeWord(range);
  const loadingNote = (!live && hist.loading) ? html`<div class="donut-note">${T("loading {v1} history…", { v1: rname })}</div>` : null;
  const volNote = ranged ? html`<div class="donut-note">${T("volume over the {v1}", { v1: rname })}</div>` : null;
  const avgNote = ranged ? html`<div class="donut-note">${T("avg over the {v1}", { v1: rname })}</div>` : null;
  const trafRings = (rxSegs, txSegs) => { const dnSegs = povPeers ? txSegs : rxSegs, upSegs = povPeers ? rxSegs : txSegs;
    return [{ label: T("traffic|Download"), dir: "dn", fmt: trafFmt, unitColor: "var(--online)", segments: dnSegs },
      { label: T("traffic|Upload"), dir: "up", fmt: trafFmt, unitColor: "var(--rate-up)", segments: upSegs }]; };

  const turnOn = turnEnabled();
  const enSet = turnOn ? enabledTurnForkIds() : new Set();
  const sanF = s => String(s).replace(/[^A-Za-z0-9_]/g, "_");
  const fLive = {};
  if (turnOn) sPeers.forEach(p => p.targets.forEach(t => {
    if (!sel.has(t.node)) return;
    const _tk = targetType(t);
    const isCS = _tk === "csqtt";
    const isSC = _tk === "wdtt" || isCS;
    let fk;
    if (isSC) { const kind = isCS ? "csqtt" : "wdtt"; const inst = ((Store.stats[t.node] || {})[kind] || []).find(x => x && x.iface === t.iface); fk = (inst && inst.fork) || (isCS ? "csqtt" : "amurcanov"); }
    else if (t.viaTurn) fk = turnFork(t.viaTurn);
    else return;
    if (!enSet.has(fk)) return;
    const a = fLive[fk] = fLive[fk] || { rx: 0, tx: 0, on: 0, tot: 0 };
    if (!isSC) { const o = t.observed; if (o) { a.rx += o.rx_speed || 0; a.tx += o.tx_speed || 0; } }
    a.tot++; if (t.online) a.on++;
  }));
  if (turnOn) fleet.forEach(n => { if (!sel.has(n.id)) return;
    for (const w of ((Store.stats[n.id] || {}).wdtt || [])) { const fk = (w && w.fork) || "amurcanov"; if (!enSet.has(fk)) continue;
      const a = fLive[fk] = fLive[fk] || { rx: 0, tx: 0, on: 0, tot: 0 }; a.rx += w.rx_speed || 0; a.tx += w.tx_speed || 0; }
    for (const c of ((Store.stats[n.id] || {}).csqtt || [])) { const fk = (c && c.fork) || "csqtt"; if (!enSet.has(fk)) continue;
      const a = fLive[fk] = fLive[fk] || { rx: 0, tx: 0, on: 0, tot: 0 }; a.rx += c.rx_speed || 0; a.tx += c.tx_speed || 0; } });
  const fRanged = {};
  if (ranged) (hist.turn || []).forEach(e => { if (!sel.has(e.node)) return;
    const a = fRanged[e.fork] = fRanged[e.fork] || { rx: 0, tx: 0, pon: 0, ptot: 0 };
    a.rx += e.rx || 0; a.tx += e.tx || 0; a.pon += e.pon || 0; a.ptot += e.ptot || 0; });
  const turnRanged = ranged && Object.keys(fRanged).length > 0;
  const _selfFork = fk => { const k = (((typeof turnForkList === "function" && turnForkList().find(f => f.id === fk)) || {}).kind); return k === "wdtt" || k === "csqtt"; };
  const fTraf = fk => (turnRanged && !_selfFork(fk)) ? (fRanged[sanF(fk)] || { rx: 0, tx: 0 }) : (fLive[fk] || { rx: 0, tx: 0 });
  const fCnt = fk => (turnRanged && !_selfFork(fk))
    ? { on: Math.round((fRanged[sanF(fk)] || {}).pon || 0), tot: Math.round((fRanged[sanF(fk)] || {}).ptot || 0) }
    : { on: (fLive[fk] || {}).on || 0, tot: (fLive[fk] || {}).tot || 0 };
  const _fo = turnForkList().map(f => f.id), _fi = fk => { const i = _fo.indexOf(fk); return i < 0 ? _fo.length : i; };
  const forks = [...enSet].filter(fk => { const t = fTraf(fk), c = fCnt(fk); return (t.rx + t.tx) > 0 || c.tot > 0; }).sort((a, b) => _fi(a) - _fi(b));
  const turnFmt = turnRanged ? fmtBytes : rate;
  const turnCenter = (rx, tx) => { const [d, u] = dlul(rx, tx); const ds = "↓ " + turnFmt(d), us = "↑ " + turnFmt(u);
    const dfs = fitFs(Math.max(ds.length, us.length)), ufs = Math.max(11, dfs - 3);
    return html`<div class="mrc-def"><span class="mrc-k">${T("val|total")}</span>
      <span class="mrc-tot dn" style=${"font-size:" + dfs + "px"}>${ds}</span><span class="mrc-tot up" style=${"font-size:" + ufs + "px"}>${us}</span></div>`; };
  const fkName = forkNames(forks);
  const turnTrafRings = () => { const rxS = forks.map(fk => ({ key: fk, name: fkName[fk], value: fTraf(fk).rx, color: turnColor(fk) })),
      txS = forks.map(fk => ({ key: fk, name: fkName[fk], value: fTraf(fk).tx, color: turnColor(fk) }));
    const dn = povPeers ? txS : rxS, up = povPeers ? rxS : txS;
    return [{ label: T("traffic|Download"), dir: "dn", fmt: turnFmt, unitColor: "var(--online)", segments: dn }, { label: T("traffic|Upload"), dir: "up", fmt: turnFmt, unitColor: "var(--rate-up)", segments: up }]; };
  const turnCntRings = () => [
    { label: T("Deployments"), fmt: v => v, segments: forks.map(fk => ({ key: fk, name: fkName[fk], value: fCnt(fk).tot, color: turnColor(fk) })) },
    { label: T("Online"), fmt: v => v, segments: forks.map(fk => ({ key: fk, name: fkName[fk], value: fCnt(fk).on, color: turnColor(fk) })) }];
  const turnTrafLeg = forks.map(fk => ({ key: fk, name: fkName[fk], color: turnColor(fk), ...(() => { const t = fTraf(fk), [d, u] = dlul(t.rx, t.tx); return { down: turnFmt(d), up: turnFmt(u) }; })() }));
  const turnCntLeg = forks.map(fk => { const c = fCnt(fk); return { key: fk, name: fkName[fk], color: turnColor(fk), right: c.on + " / " + c.tot }; });
  const turnTot = forks.reduce((s, fk) => { const t = fTraf(fk), c = fCnt(fk); s.rx += t.rx; s.tx += t.tx; s.on += c.on; s.tot += c.tot; return s; }, { rx: 0, tx: 0, on: 0, tot: 0 });
  const turnLiveNote = html`<div class="donut-note">${T("live rates")}${ranged ? T(" · no history yet for this range") : ""}</div>`;
  const turnNote = turnRanged ? volNote : turnLiveNote;
  const turnAvgNote = turnRanged ? avgNote : turnLiveNote;

  const loading = !live && hist.loading;
  const trafBadgesFor = (key, F) => html`<div class="dcard-traf">
    <button class=${"tbadge peers" + (F.peers ? " on" : "")} onClick=${() => dashToggleTrafKey(key, "peers")} title=${F.peers ? T("Hide client (peer) traffic") : T("Show client (peer) traffic")}>${T("Peers")}</button>
    <button class=${"tbadge mesh" + (F.mesh ? " on" : "")} onClick=${() => dashToggleTrafKey(key, "mesh")} title=${F.mesh ? T("Hide mesh (node-to-node relay) traffic") : T("Show mesh (node-to-node relay) traffic")}>${T("Mesh")}</button>
  </div>`;
  return html`<div class="donutgrid">
    <${DoughCard} title=${T("Traffic by node")} badges=${trafBadgesFor("dnode", FN)} loading=${loading}
      rings=${trafRings(segNodes("rx"), segNodes("tx"))} center=${trafCenter(totDownN, totUpN)} legend=${trafLegNodes} note=${loadingNote || volNote}/>

    <${DoughCard} title=${T("Deployments by node")} loading=${loading}
      rings=${[{ label: T("Deployments"), fmt: v => v, segments: fleet.map(n => ({ key: n.id, name: nodeName(n.id), value: nodeCnt[n.id].tot, color: nodeColor(n.id) })) },
               { label: T("Online"), fmt: v => v, segments: fleet.map(n => ({ key: n.id, name: nodeName(n.id), value: nodeCnt[n.id].on, color: nodeColor(n.id) })) }]}
      center=${cntCenter(nodeOn, nodeTot)} legend=${cntLegNodes} note=${loadingNote || avgNote}/>

    <${DoughCard} title=${T("Traffic by interface")} badges=${trafBadgesFor("dtype", FT)} loading=${loading}
      rings=${trafRings(segTypes("rx"), segTypes("tx"))} center=${trafCenter(totDownT, totUpT)} legend=${trafLegTypes} note=${loadingNote || volNote}/>

    <${DoughCard} title=${T("Deployments by interface")} loading=${loading}
      rings=${[{ label: T("Deployments"), fmt: v => v, segments: TYPES.map(([t, nm]) => ({ key: t, name: nm, value: (typeCnt[t] || {}).tot || 0, color: ifaceColor(t) })) },
               { label: T("Online"), fmt: v => v, segments: TYPES.map(([t, nm]) => ({ key: t, name: nm, value: (typeCnt[t] || {}).on || 0, color: ifaceColor(t) })) }]}
      center=${cntCenter(typeOn, typeTot)} legend=${cntLegTypes} note=${loadingNote || avgNote}/>

    ${turnOn && forks.length ? html`<${Fragment}>
      <${DoughCard} title=${T("Traffic by turn-proxy")} loading=${loading}
        rings=${turnTrafRings()} center=${turnCenter(turnTot.rx, turnTot.tx)} legend=${turnTrafLeg} note=${loadingNote || turnNote}/>

      <${DoughCard} title=${T("Deployments by turn-proxy")} loading=${loading}
        rings=${turnCntRings()} center=${cntCenter(turnTot.on, turnTot.tot)} legend=${turnCntLeg} note=${loadingNote || turnAvgNote}/>
    <//>` : null}
  </div>`;
}

export function DoughCard({ title, rings, center, legend, note, loading, badges }) {
  const [active, setActive] = useState(null);
  return html`<div class="donutcard">
    <div class="donutcard-h"><h3>${title}</h3><span class="grow"></span>${badges || null}</div>
    <div class="donut-body">
      <${MultiRing} rings=${rings} center=${center} active=${active} onActive=${setActive}/>
      <${RingLegend} items=${legend} active=${active} onActive=${setActive}/>
    </div></div>`;
}

export const FLOW_EG = "#2E90FF", FLOW_IN = "#22D07A", FLOW_GLOBE = "#12BECE", FLOW_MESH = "#9B8AFF",
  FLOW_EXIT = "#0B7A8C";

export function exitTraffic(nid, ranged, hist) {
  const nrec = (Store.nodes || []).find(n => n.id === nid) || {};
  const owners = {};
  (nrec.exits || []).forEach(x => { const d = String((x && x.device) || "").trim(); if (d) (owners[d] = owners[d] || []).push(x); });
  const src = ranged
    ? Object.fromEntries(((hist && hist.exits) || []).filter(e => e.node === nid).map(e => [e.dev, { up: e.up || 0, down: e.down || 0 }]))
    : ((Store.stats[nid] || {}).exit_rate || {});
  return Object.entries(src).filter(([dev]) => (owners[dev] || []).length).map(([dev, v]) => {
    const own = owners[dev], one = own.length === 1 ? own[0] : null;
    return { dev, key: one ? "exit:" + one.id : "dev:" + dev, label: (one && one.label) || dev, up: v.up || 0, down: v.down || 0 };
  }).filter(x => x.up || x.down);
}
export function flowGraph(selIds, range, hist) {
  const sel = new Set(selIds);
  const fleet = (Store.fleet || []).filter(n => sel.has(n.id));
  const ranged = range && range !== "live" && hist && hist.range === range;
  const STEP = rangeStep(range, hist);
  const acc = {};
  fleet.forEach(n => acc[n.id] = { cl: { rx: 0, tx: 0 }, turn: {}, mesh: {}, offmesh: { rx: 0, tx: 0, n: new Set() }, inet: null });
  if (ranged) {
    fleet.forEach(n => { const d = hist.byNode[n.id]; if (!d) return;
      const R = d.rx || [], T = d.tx || [], MR = d.mrx || [], MT = d.mtx || []; let rx = 0, tx = 0;
      for (let i = 0; i < R.length; i++) { rx += Math.max(0, (R[i] || 0) - (MR[i] || 0)); tx += Math.max(0, (T[i] || 0) - (MT[i] || 0)); }
      acc[n.id].cl.rx = rx * STEP; acc[n.id].cl.tx = tx * STEP;
      const IU = d.inet_up || [], ID = d.inet_down || [];
      let iu = 0, id = 0; for (let i = 0; i < IU.length; i++) iu += IU[i] || 0; for (let i = 0; i < ID.length; i++) id += ID[i] || 0;
      if (iu || id) acc[n.id].inet = { out: iu * STEP, in: id * STEP }; });
    const _sanF = s => String(s).replace(/[^A-Za-z0-9_]/g, "_");
    const _realFork = {}; ((typeof turnForkList === "function" ? turnForkList() : []) || []).forEach(f => { _realFork[_sanF(f.id)] = f.id; });
    (hist.turn || []).forEach(e => { const a = acc[e.node]; if (!a) return; const rx = e.rx || 0, tx = e.tx || 0; if (!rx && !tx) return;
      const fk = _realFork[e.fork] || e.fork;
      (a.turn[fk] = a.turn[fk] || { rx: 0, tx: 0 }); a.turn[fk].rx += rx; a.turn[fk].tx += tx;
      a.cl.rx = Math.max(0, a.cl.rx - rx); a.cl.tx = Math.max(0, a.cl.tx - tx); });
    const winSec = Math.max(1, ...fleet.map(n => { const d = hist.byNode[n.id]; return d && d.rx ? d.rx.length : 0; })) * STEP;
    (hist.mesh || []).forEach(p => { const aSel = sel.has(p.a), bSel = sel.has(p.b); if (!aSel && !bSel) return;
      if (aSel && bSel) {
        if (p.ab > 0) (acc[p.a].mesh[p.b] = acc[p.a].mesh[p.b] || { rx: 0, tx: 0 }).tx = p.ab * winSec;
        if (p.ba > 0) (acc[p.b].mesh[p.a] = acc[p.b].mesh[p.a] || { rx: 0, tx: 0 }).tx = p.ba * winSec;
      } else if (aSel) { acc[p.a].offmesh.tx += (p.ab || 0) * winSec; acc[p.a].offmesh.rx += (p.ba || 0) * winSec; acc[p.a].offmesh.n.add(p.b); }
      else { acc[p.b].offmesh.tx += (p.ba || 0) * winSec; acc[p.b].offmesh.rx += (p.ab || 0) * winSec; acc[p.b].offmesh.n.add(p.a); } });
  } else {
    Store.recon.peers.forEach(p => p.targets.forEach(t => {
      if (!acc[t.node]) return; const o = t.observed; if (!o) return;
      const rx = o.rx_speed || 0, tx = o.tx_speed || 0; if (!rx && !tx) return;
      const a = acc[t.node];
      if (t.viaTurn) { const fk = turnFork(t.viaTurn); (a.turn[fk] = a.turn[fk] || { rx: 0, tx: 0 }); a.turn[fk].rx += rx; a.turn[fk].tx += tx; }
      else { a.cl.rx += rx; a.cl.tx += tx; }
    }));
    fleet.forEach(n => { const snap = Store.stats[n.id]; if (!snap) return;
      if (snap.inet) acc[n.id].inet = { out: snap.inet.up || 0, in: snap.inet.down || 0 };
      for (const w of (snap.wdtt || [])) { if (!w) continue; const fk = w.fork || "amurcanov"; const at = (acc[n.id].turn[fk] = acc[n.id].turn[fk] || { rx: 0, tx: 0 }); at.rx += w.rx_speed || 0; at.tx += w.tx_speed || 0; }
      for (const c of (snap.csqtt || [])) { if (!c) continue; const fk = c.fork || "csqtt"; const at = (acc[n.id].turn[fk] = acc[n.id].turn[fk] || { rx: 0, tx: 0 }); at.rx += c.rx_speed || 0; at.tx += c.tx_speed || 0; }
      for (const [ifn, blk] of Object.entries(snap.interfaces || {})) {
        const meta = (Store.describe[n.id] || {})[ifn] || blk.meta || {};
        const peer = meta.link_node || meta.egress_node;
        if (!(meta.system && peer)) continue;
        let rx = 0, tx = 0; for (const pp of blk.peers || []) { rx += pp.rx_speed || 0; tx += pp.tx_speed || 0; }
        if (sel.has(peer)) acc[n.id].mesh[peer] = { rx, tx };
        else { acc[n.id].offmesh.rx += rx; acc[n.id].offmesh.tx += tx; acc[n.id].offmesh.n.add(peer); }
      }
    });
  }
  const flows = [], sats = [];
  const satId = (n, k) => n + "|" + k;
  fleet.forEach(n => {
    const a = acc[n.id];
    const turnRx = Object.values(a.turn).reduce((s, v) => s + v.rx, 0), turnTx = Object.values(a.turn).reduce((s, v) => s + v.tx, 0);
    if (a.cl.rx || a.cl.tx) { const s = satId(n.id, "clients"); sats.push({ id: s, node: n.id, kind: "clients", label: "clients", color: "var(--online)", ic: "users" });
      if (a.cl.rx) flows.push({ from: s, to: n.id, bps: a.cl.rx }); if (a.cl.tx) flows.push({ from: n.id, to: s, bps: a.cl.tx }); }
    Object.entries(a.turn).forEach(([fk, v]) => { if (!(v.rx || v.tx)) return;
      const s = satId(n.id, "turn:" + fk); sats.push({ id: s, node: n.id, kind: "turn", fork: fk, label: fk, color: turnColor(fk), ic: "relay" });
      if (v.rx) flows.push({ from: s, to: n.id, bps: v.rx }); if (v.tx) flows.push({ from: n.id, to: s, bps: v.tx }); });
    const ex = exitTraffic(n.id, ranged, hist);
    const exOut = ex.reduce((t, x) => t + x.up, 0), exIn = ex.reduce((t, x) => t + x.down, 0);
    const inetOut = Math.max(0, (a.inet ? a.inet.out : a.cl.rx + turnRx) - exOut),
      inetIn = Math.max(0, (a.inet ? a.inet.in : a.cl.tx + turnTx) - exIn);
    if (inetOut || inetIn) { const s = satId(n.id, "internet"); sats.push({ id: s, node: n.id, kind: "internet", label: "internet", color: FLOW_GLOBE, ic: "globe", measured: !!a.inet });
      if (inetOut) flows.push({ from: n.id, to: s, bps: inetOut }); if (inetIn) flows.push({ from: s, to: n.id, bps: inetIn }); }
    ex.forEach(x => { const s = satId(n.id, x.key);
      sats.push({ id: s, node: n.id, kind: "exit", label: x.label, color: FLOW_EXIT, ic: "link" });
      if (x.up) flows.push({ from: n.id, to: s, bps: x.up }); if (x.down) flows.push({ from: s, to: n.id, bps: x.down }); });
    Object.entries(a.mesh).forEach(([peer, v]) => { if (v.tx) flows.push({ from: n.id, to: peer, bps: v.tx }); });
    if (a.offmesh.rx || a.offmesh.tx) {
      const s = satId(n.id, "mesh"), oc = a.offmesh.n.size; sats.push({ id: s, node: n.id, kind: "mesh", label: T("Other {v1}", { v1: plural(oc, "node") }), color: FLOW_MESH, ic: "server" });
      if (a.offmesh.tx) flows.push({ from: n.id, to: s, bps: a.offmesh.tx }); if (a.offmesh.rx) flows.push({ from: s, to: n.id, bps: a.offmesh.rx });
    }
  });
  const inTot = {}, outTot = {};
  fleet.forEach(n => { inTot[n.id] = 0; outTot[n.id] = 0; });
  flows.forEach(f => { if (outTot[f.from] != null) outTot[f.from] += f.bps; if (inTot[f.to] != null) inTot[f.to] += f.bps; });
  return { fleet, sats, flows, inTot, outTot, ranged };
}
let _flow_anims = null;
export const FLOW_ANIMS = () => (_flow_anims || (_flow_anims = [
  { id: "dots", ic: "dots", label: T("Dots") },
  { id: "chevrons", ic: "arrow", label: T("Arrows") },
  { id: "pulse", ic: "activity", label: T("Pulse") },
  { id: "gradient", ic: "waves", label: T("Flow") },
  { id: "off", ic: "off", label: T("Off") },
]));
export function FlowMap2({ selIds, range, hist }) {
  const [hov, setHov] = useState(null);
  const rankRef = useRef({ key: null, order: [] });
  const anim = (Store.panelSettings || {}).flow_anim || "off";
  const setAnim = m => { Store.panelSettings = { ...(Store.panelSettings || {}), flow_anim: m }; bus.emit(); api.panelSettings({ flow_anim: m }).catch(() => {}); };
  const G = flowGraph(selIds, range, hist);
  const { fleet, sats, flows, ranged } = G;
  const fmt = ranged ? fmtBytes : rate;
  const N = fleet.length;
  if (!N) return html`<div class="allclear">${T("No nodes selected.")}</div>`;
  const W = 960, H = 520, cx = W / 2, cy = H / 2;
  const nodeIds = new Set(fleet.map(n => n.id));
  const satTot = {}; sats.forEach(s => { let ib = 0, ob = 0; flows.forEach(f => { if (f.to === s.id) ib += f.bps; if (f.from === s.id) ob += f.bps; }); satTot[s.id] = { ib, ob, tot: ib + ob }; });
  const nameLen = id => (Store.nodeName(id) || id).length;
  const busy = id => (G.inTot[id] || 0) + (G.outTot[id] || 0);
  const LOQ = 0.15;
  const curve = Math.sqrt;
  const mapper = (vals, floor, ceil, loq) => { const s = vals.filter(v => v > 0).sort((a, b) => a - b);
    if (!s.length) return () => floor;
    const lo = s[Math.min(s.length - 1, Math.round((loq == null ? LOQ : loq) * (s.length - 1)))], hi = s[s.length - 1];
    if (hi <= lo) return () => ceil;
    const cLo = curve(Math.max(lo, 1)), cHi = curve(Math.max(hi, 1));
    return v => v <= lo ? floor : floor + Math.min(1, (curve(v) - cLo) / Math.max(1e-9, cHi - cLo)) * (ceil - floor); };
  const wCeil = 25 * Math.min(1, 0.62 + 0.1 * (N - 1));
  const wMap = mapper(flows.map(f => f.bps), 2, wCeil, LOQ);
  const wOf = bps => wMap(bps);
  const NODE_FLOOR = 12, SAT_FLOOR = 11, ICON_R = 1.3;
  const visBusy = id => flows.reduce((a, f) => (f.from === id || f.to === id) ? a + wOf(f.bps) : a, 0);
  const fontMap = mapper(fleet.map(n => visBusy(n.id)), NODE_FLOOR, 21, 0);
  const satMap = mapper(sats.map(s => (satTot[s.id] || {}).tot || 0), SAT_FLOOR, 22, 0);
  const seatNeed = id => flows.reduce((a, f) => (f.from === id || f.to === id) ? a + wOf(f.bps) + 4 : a, 0);
  const pairThick = id => { const bo = {}; flows.forEach(f => { const o = f.from === id ? f.to : f.to === id ? f.from : null; if (o == null) return; bo[o] = (bo[o] || 0) + wOf(f.bps); }); let mx = 0; for (const k in bo) if (bo[k] > mx) mx = bo[k]; return mx ? mx + 2 : 0; };
  const satR = id => Math.max(satMap((satTot[id] || {}).tot || 0), seatNeed(id) / 2);
  const nodeFont = id => Math.max(fontMap(visBusy(id)), (seatNeed(id) / 4 - 5) / (0.31 * nameLen(id) + 1.85), pairThick(id) / 2 + 5);
  const nR = id => (0.31 * nameLen(id) + 0.85) * nodeFont(id) + 2;
  const nmeta = id => { if (!nodeIds.has(id)) { const r = satR(id); return { hw: r, hh: r }; }
    const fs = nodeFont(id), L = nameLen(id); return { hw: (0.31 * L + 0.85) * fs + 2, hh: fs + 3 }; };
  const rimDist = (id, ux, uy) => { const m = nmeta(id); return 1 / Math.max(Math.abs(ux) / m.hw, Math.abs(uy) / m.hh, 1e-6); };
  const connected = id => flows.some(f => (f.from === id && nodeIds.has(f.to)) || (f.to === id && nodeIds.has(f.from)));
  const maxNR = Math.max(24, ...fleet.map(n => nR(n.id)));
  const allIsle = N >= 2 && fleet.every(n => !connected(n.id)), maxSatR = Math.max(12, ...sats.map(s => satR(s.id)));
  const sep = 2 * maxNR + 50, Rc = N <= 1 ? 0 : sep / (2 * Math.sin(Math.PI / N));
  const start = N === 2 ? 0 : N === 4 ? -Math.PI / 4 : -Math.PI / 2, Rx = Rc * 1.34, Ry = Rc * 0.70;
  const _selKey = fleet.map(n => n.id).slice().sort().join(",");
  if (rankRef.current.key !== _selKey)
    rankRef.current = { key: _selKey, order: fleet.slice().sort((p, q) => (busy(q.id) - busy(p.id)) || (p.id < q.id ? -1 : 1)).map(n => n.id) };
  const ranked = rankRef.current.order.map(id => fleet.find(n => n.id === id)).filter(Boolean);
  const spos = {};
  if (allIsle) {
    const REACH = 108, cellW = 2 * (REACH * 0.85 + maxSatR) + 0.6 * maxNR + 34, cellH = 2 * REACH + 2 * maxSatR + 64;
    const rows = Math.ceil(N / 3), cols = Math.ceil(N / rows);
    ranked.forEach((n, i) => { const rI = Math.floor(i / cols), cN = Math.min(cols, N - rI * cols), cI = i - rI * cols;
      spos[n.id] = { x: cx + (cI - (cN - 1) / 2) * cellW, y: cy + (rI - (rows - 1) / 2) * cellH }; });
  } else {
    const ringSlots = fleet.map((n, i) => { const a = N === 1 ? 0 : start + i * 2 * Math.PI / N; return { x: cx + Rx * Math.cos(a), y: cy + Ry * Math.sin(a) }; });
    let startIdx = 0; ringSlots.forEach((p, i) => { const s = ringSlots[startIdx]; if (p.y < s.y - 0.5 || (Math.abs(p.y - s.y) <= 0.5 && p.x < s.x)) startIdx = i; });
    const used = new Array(ringSlots.length).fill(false);
    let prev = startIdx; used[startIdx] = true; spos[ranked[0].id] = ringSlots[startIdx];
    for (let k = 1; k < ranked.length; k++) { let best = -1, bd = -1;
      ringSlots.forEach((p, i) => { if (used[i]) return; const d = (p.x - ringSlots[prev].x) ** 2 + (p.y - ringSlots[prev].y) ** 2; if (d > bd) { bd = d; best = i; } });
      used[best] = true; spos[ranked[k].id] = ringSlots[best]; prev = best; }
  }
  let minNN = Infinity;
  flows.forEach(f => { if (nodeIds.has(f.from) && nodeIds.has(f.to)) { const A = spos[f.from], B = spos[f.to]; minNN = Math.min(minNN, Math.hypot(B.x - A.x, B.y - A.y) - nR(f.from) - nR(f.to)); } });
  const satReach = isFinite(minNN) ? Math.max(90, Math.min(120, minNN * 0.6)) : 108;
  const satpos = {};
  fleet.forEach(n => { const mine = sats.filter(s => s.node === n.id), P = spos[n.id];
    const place = (s, a) => { const D = rimDist(n.id, Math.cos(a), Math.sin(a)) + satR(s.id) + satReach; satpos[s.id] = { x: P.x + D * Math.cos(a), y: P.y + D * Math.sin(a) }; };
    const HB = 0.42;
    const hfrac = Rx > 0 ? Math.max(-1, Math.min(1, (P.x - cx) / Rx)) : 0;
    const vfrac = Ry > 0 ? (P.y - cy) / Ry : 0;
    const arc = (grp, sideSign) => {
      const sp = Math.min(Math.PI - 2 * HB - 0.15, 0.5 + grp.length * 0.42);
      const tilt = hfrac * Math.max(0, Math.PI / 2 - HB - sp / 2);
      const center = sideSign < 0 ? -Math.PI / 2 + tilt : Math.PI / 2 - tilt;
      grp.forEach((s, i) => place(s, center + (grp.length === 1 ? 0 : (i / (grp.length - 1) - 0.5) * sp)));
    };
    if (allIsle || N === 1) {
      const up = mine.filter(s => s.kind === "internet" || s.kind === "mesh");
      const down = mine.filter(s => s.kind !== "internet" && s.kind !== "mesh");
      const fan = (grp, base) => { const sp = Math.min(Math.PI - 2 * HB - 0.15, 0.5 + grp.length * 0.42);
        grp.forEach((s, i) => place(s, base + (grp.length === 1 ? 0 : (i / (grp.length - 1) - 0.5) * sp))); };
      fan(up, -Math.PI / 2); fan(down, Math.PI / 2);
    }
    else if (vfrac < -0.32) arc(mine, -1);
    else if (vfrac > 0.32) arc(mine, 1);
    else { const h = Math.ceil(mine.length / 2); arc(mine.slice(0, h), -1); arc(mine.slice(h), 1); }
  });
  for (let it = 0; it < 70; it++) {
    sats.forEach(s => { const P = satpos[s.id]; if (!P) return; const r = satR(s.id); let dx = 0, dy = 0;
      sats.forEach(o => { if (o.id === s.id) return; const Q = satpos[o.id]; if (!Q) return; const ex = P.x - Q.x, ey = P.y - Q.y, d = Math.hypot(ex, ey) || 1, md = r + satR(o.id) + 10; if (d < md) { const k = (md - d) / d * 0.5; dx += ex * k; dy += ey * k; } });
      fleet.forEach(m => { if (m.id === s.node) return; const Q = spos[m.id], ex = P.x - Q.x, ey = P.y - Q.y, d = Math.hypot(ex, ey) || 1, md = r + nR(m.id) + 12; if (d < md) { const k = (md - d) / d * 0.5; dx += ex * k; dy += ey * k; } });
      P.x += dx; P.y += dy; });
    sats.forEach(s => { const P = satpos[s.id]; if (!P) return; const A = spos[s.node], r = satR(s.id);
      const ex = P.x - A.x, ey = P.y - A.y, d = Math.hypot(ex, ey) || 1, base = rimDist(s.node, ex / d, ey / d) + r, minL = base + Math.max(30, satReach * 0.7), maxL = base + satReach;
      if (d < minL) { P.x = A.x + ex / d * minL; P.y = A.y + ey / d * minL; } else if (d > maxL) { P.x = A.x + ex / d * maxL; P.y = A.y + ey / d * maxL; } });
  }
  const epPos = id => spos[id] || satpos[id];
  const epR = id => spos[id] ? nR(id) : satR(id);
  const epName = id => { if (spos[id]) return Store.nodeName(id); const s = sats.find(x => x.id === id) || {}; return s.kind === "turn" ? forkLabel(s.fork) : s.label || s.kind || id; };
  let vx0 = 1e9, vy0 = 1e9, vx1 = -1e9, vy1 = -1e9;
  fleet.forEach(n => { const P = spos[n.id], m = nmeta(n.id); vx0 = Math.min(vx0, P.x - m.hw); vx1 = Math.max(vx1, P.x + m.hw); vy0 = Math.min(vy0, P.y - m.hh); vy1 = Math.max(vy1, P.y + m.hh); });
  sats.forEach(s => { const P = satpos[s.id]; if (!P) return; const r = satR(s.id); vx0 = Math.min(vx0, P.x - r); vx1 = Math.max(vx1, P.x + r); vy0 = Math.min(vy0, P.y - r); vy1 = Math.max(vy1, P.y + r); });
  const PAD = 22; vx0 -= PAD; vy0 -= PAD; vx1 += PAD; vy1 += PAD;
  const AR = Math.max(1.25, Math.min(1.7, 1.7 - Math.max(0, N - 2) * 0.05)), FRAME_W = 480;
  const cw = vx1 - vx0, ch = vy1 - vy0, ccx = (vx0 + vx1) / 2, ccy = (vy0 + vy1) / 2;
  const vbW = Math.max(cw, ch * AR, FRAME_W), vbH = vbW / AR;
  vx0 = ccx - vbW / 2; vy0 = ccy - vbH / 2;
  const slot = {};
  [...fleet.map(n => n.id), ...sats.map(s => s.id)].forEach(id => {
    const P = epPos(id); if (!P) return; const m = nmeta(id), hw = m.hw, hh = m.hh, Peri = 4 * (hw + hh), byOther = {};
    flows.forEach(f => { if (f.from !== id && f.to !== id) return; const o = f.from === id ? f.to : f.from; if (!epPos(o)) return; (byOther[o] = byOther[o] || { o, w: 0 }).w += wOf(f.bps); });
    const arcOf = (ux, uy) => { const t = 1 / Math.max(Math.abs(ux) / hw, Math.abs(uy) / hh, 1e-9), qx = ux * t, qy = uy * t, onV = Math.abs(qx) > hw - 0.5;
      return !onV && qy < 0 ? qx + hw : onV && qx > 0 ? 2 * hw + (qy + hh) : !onV && qy > 0 ? 2 * hw + 2 * hh + (hw - qx) : 4 * hw + 2 * hh + (hh - qy); };
    const items = Object.values(byOther).map(c => { const O = epPos(c.o), d = Math.hypot(O.x - P.x, O.y - P.y) || 1; return { key: c.o, s: arcOf((O.x - P.x) / d, (O.y - P.y) / d), half: c.w / 2 + 4 }; });
    if (!items.length) return;
    items.sort((a, b) => a.s - b.s); items.forEach(it => it.c = it.s);
    for (let iter = 0; iter < 40; iter++) for (let k = 0; k < items.length; k++) { const a = items[k], b = items[(k + 1) % items.length];
      let gap = b.c - a.c; if (k === items.length - 1) gap += Peri; const need = a.half + b.half;
      if (gap < need) { const push = (need - gap) / 2; a.c -= push; b.c += push; } }
    items.forEach(it => { let s = ((it.c % Peri) + Peri) % Peri, x, y;
      if (s <= 2 * hw) { x = -hw + s; y = -hh; } else if (s -= 2 * hw, s <= 2 * hh) { x = hw; y = -hh + s; } else if (s -= 2 * hh, s <= 2 * hw) { x = hw - s; y = hh; } else { s -= 2 * hw; x = -hw; y = hh - s; }
      slot[id + "|" + it.key] = Math.atan2(y, x); });
  });
  const pkey = f => [f.from, f.to].slice().sort().join("~");
  const pairFlows = {}; flows.forEach((f, i) => { const k = pkey(f); (pairFlows[k] = pairFlows[k] || []).push(i); });
  const ribbons = flows.map((f, idx) => {
    const sa = slot[f.from + "|" + f.to], sb = slot[f.to + "|" + f.from]; if (sa == null || sb == null) return null;
    const Pa = epPos(f.from), Pb = epPos(f.to);
    const [lo, hi] = [f.from, f.to].slice().sort(), Lo = epPos(lo), Hi = epPos(hi);
    const cdx = Hi.x - Lo.x, cdy = Hi.y - Lo.y, cd = Math.hypot(cdx, cdy) || 1, cpx = -cdy / cd, cpy = cdx / cd;
    const w = wOf(f.bps), sibs = pairFlows[pkey(f)], sibIdx = sibs.length > 1 ? sibs.find(i => i !== idx) : null;
    const GAP = 2, baseOff = sibIdx != null ? (GAP + wOf(flows[sibIdx].bps)) / 2 : 0;
    const off = sibIdx != null ? (f.from === lo ? 1 : -1) * Math.min(baseOff, 0.62 * Math.min(epR(f.from), epR(f.to))) : 0;
    const aux = Math.cos(sa), auy = Math.sin(sa), bux = Math.cos(sb), buy = Math.sin(sb);
    const ra = rimDist(f.from, aux, auy), rb = rimDist(f.to, bux, buy);
    const dist = Math.hypot(Pb.x - Pa.x, Pb.y - Pa.y), isMesh = spos[f.from] && spos[f.to];
    const ext = isMesh ? Math.min(52, dist * 0.2) : Math.min(16, dist * 0.11);
    const ax = Pa.x + aux * ra * 0.28 + cpx * off, ay = Pa.y + auy * ra * 0.28 + cpy * off, bx = Pb.x + bux * rb * 0.28 + cpx * off, by = Pb.y + buy * rb * 0.28 + cpy * off;
    const c1x = Pa.x + aux * (ra + ext) + cpx * off, c1y = Pa.y + auy * (ra + ext) + cpy * off, c2x = Pb.x + bux * (rb + ext) + cpx * off, c2y = Pb.y + buy * (rb + ext) + cpy * off;
    const path = `M ${ax.toFixed(1)} ${ay.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
    const HITEXT = 16, hsh = (off === 0 ? 0 : off > 0 ? 1 : -1) * HITEXT / 2, hx = cpx * hsh, hy = cpy * hsh, hitW = Math.max(w, 3) + HITEXT;
    const hitPath = `M ${(ax + hx).toFixed(1)} ${(ay + hy).toFixed(1)} C ${(c1x + hx).toFixed(1)} ${(c1y + hy).toFixed(1)} ${(c2x + hx).toFixed(1)} ${(c2y + hy).toFixed(1)} ${(bx + hx).toFixed(1)} ${(by + hy).toFixed(1)}`;
    return { idx, f, path, hitPath, hitW, w, sx: ax, sy: ay, ex: bx, ey: by, mid: { x: (c1x + c2x) / 2, y: (c1y + c2y) / 2 } };
  }).filter(Boolean);
  const gid = "fg" + (FlowMap2._n = (FlowMap2._n || 0) + 1);
  const satC = id => (sats.find(s => s.id === id) || {}).color;
  const flowLit = idx => hov && (hov.fi === idx || (hov.id != null && (flows[idx].from === hov.id || flows[idx].to === hov.id)));
  const badgeLit = id => !hov || hov.id === id || (hov.fi != null && (flows[hov.fi].from === id || flows[hov.fi].to === id));
  const relOf = id => hov && hov.id != null && hov.id !== id && flows.some(f => (f.from === hov.id && f.to === id) || (f.to === hov.id && f.from === id));
  const bubbleSpot = (P, occ, r) => {
    const M = 15;
    if (!occ.length) return { x: P.x, y: P.y - r - M, tx: "-50%", ty: "-100%" };
    const s = occ.slice().sort((a, b) => a - b); let best = -1, dir = -Math.PI / 2;
    for (let i = 0; i < s.length; i++) { const a = s[i], b = i + 1 < s.length ? s[i + 1] : s[0] + 2 * Math.PI, g = b - a; if (g > best) { best = g; dir = a + g / 2; } }
    const R = r + M, ax = Math.cos(dir), ay = Math.sin(dir);
    return { x: P.x + ax * R, y: P.y + ay * R, tx: ax > 0.35 ? "0" : ax < -0.35 ? "-100%" : "-50%", ty: ay > 0.35 ? "0" : ay < -0.35 ? "-100%" : "-50%" };
  };
  let hv = null, spot = null;
  if (hov && hov.id != null) {
    const P = epPos(hov.id); if (P) {
      const occ = flows.filter(f => f.from === hov.id || f.to === hov.id).map(f => { const O = epPos(f.from === hov.id ? f.to : f.from); return O ? Math.atan2(O.y - P.y, O.x - P.x) : null; }).filter(a => a != null);
      spot = bubbleSpot(P, occ, epR(hov.id));
      if (spos[hov.id]) hv = { type: "ep", name: Store.nodeName(hov.id), ib: G.inTot[hov.id], ob: G.outTot[hov.id], sub: "server", col: Store.nodeColor(hov.id) };
      else { const sm = sats.find(x => x.id === hov.id); if (sm) { const t = satTot[hov.id] || {}; hv = { type: "ep", name: sm.kind === "turn" ? forkLabel(sm.fork) : sm.label || sm.kind, ib: t.ib, ob: t.ob, sub: sm.kind === "internet" ? (sm.measured ? "internet · measured" : "internet · estimated") : sm.kind === "turn" ? "turn-proxy" : sm.kind === "exit" ? T("external exit") : sm.kind === "mesh" ? T("fleet nodes not shown") : "clients", col: sm.color }; } }
    }
  } else if (hov && hov.fi != null) {
    const f = flows[hov.fi], r = ribbons.find(x => x.idx === hov.fi);
    if (r) { const ang = Math.atan2(r.ey - r.sy, r.ex - r.sx); spot = bubbleSpot(r.mid, [ang, ang + Math.PI], 4);
      hv = { type: "flow", a: epName(f.from), b: epName(f.to), v: f.bps, ca: spos[f.from] ? Store.nodeColor(f.from) : satC(f.from), cb: spos[f.to] ? Store.nodeColor(f.to) : satC(f.to) }; }
  }
  const PX = x => (x - vx0) / vbW * 100, PY = y => (y - vy0) / vbH * 100;
  const U = 100 / vbW;
  const bubStyle = "left:" + (spot ? PX(spot.x) : 0) + "%;top:" + (spot ? PY(spot.y) : 0) + "%;transform:translate(" + (spot ? spot.tx : "-50%") + "," + (spot ? spot.ty : "-100%") + ")";
  return html`<div class="flowcard">
    <div class="flowmap2" style=${"aspect-ratio:" + vbW.toFixed(0) + "/" + vbH.toFixed(0)} onMouseLeave=${() => setHov(null)}>
      <svg viewBox=${vx0.toFixed(1) + " " + vy0.toFixed(1) + " " + vbW.toFixed(1) + " " + vbH.toFixed(1)} preserveAspectRatio="xMidYMid meet">
        <defs>${ribbons.map(r => { if (anim === "gradient") {
            const dx = r.ex - r.sx, dy = r.ey - r.sy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, P = 64, lit = !hov || flowLit(r.idx);
            return html`<linearGradient key=${gid + r.idx} id=${gid + "-" + r.idx} gradientUnits="userSpaceOnUse" spreadMethod="repeat" x1=${r.sx} y1=${r.sy} x2=${(r.sx + ux * P).toFixed(1)} y2=${(r.sy + uy * P).toFixed(1)}>
              <stop offset="0" stop-color=${FLOW_EG}/><stop offset="0.5" stop-color=${FLOW_IN}/><stop offset="1" stop-color=${FLOW_EG}/>
              ${lit ? html`<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to=${(ux * P).toFixed(1) + " " + (uy * P).toFixed(1)} dur=${Math.max(0.6, (2.8 - r.w * 0.12) / 1.5).toFixed(2) + "s"} repeatCount="indefinite"/>` : null}
            </linearGradient>`;
          }
          return html`<linearGradient key=${gid + r.idx} id=${gid + "-" + r.idx} gradientUnits="userSpaceOnUse" x1=${r.sx} y1=${r.sy} x2=${r.ex} y2=${r.ey}>
            <stop offset="0" stop-color=${FLOW_EG}/><stop offset="0.2" stop-color=${FLOW_EG}/><stop offset="0.8" stop-color=${FLOW_IN}/><stop offset="1" stop-color=${FLOW_IN}/>
          </linearGradient>`; })}</defs>
        ${ribbons.map(r => html`<path key=${"r" + r.idx} id=${gid + "-p" + r.idx} d=${r.path} fill="none" stroke=${"url(#" + gid + "-" + r.idx + ")"} stroke-width=${r.w.toFixed(1)} stroke-linecap="butt"
          class=${"fm2-flow" + (hov && !flowLit(r.idx) ? " dim" : flowLit(r.idx) ? " lit" : "")} style="pointer-events:none"/>`)}
        ${anim === "dots" ? ribbons.filter(r => !hov || flowLit(r.idx)).map(r => html`<path key=${"a" + r.idx} d=${r.path} fill="none" stroke="var(--flowdot)" stroke-width=${Math.max(1.3, Math.min(r.w * 0.5, 4.5)).toFixed(1)} stroke-linecap="round"
          class=${"fm2-flowdot" + (hov && !flowLit(r.idx) ? " dim" : "")} style=${"animation-duration:" + Math.max(0.8, 2.6 - r.w * 0.11).toFixed(2) + "s;pointer-events:none"}/>`) : null}
        ${anim === "pulse" ? ribbons.filter(r => !hov || flowLit(r.idx)).map(r => { const L = Math.hypot(r.ex - r.sx, r.ey - r.sy) || 1, nc = Math.max(1, Math.round(L / 240)), hl = Math.max(9, Math.min(L * 0.16, 24)),
          w = Math.max(2.4, r.w * 0.7), dotDur = Math.max(0.8, 2.6 - r.w * 0.11), dur = L * dotDur / 66;
          return html`<g key=${"pl" + r.idx} class=${"fm2-pulse" + (hov && !flowLit(r.idx) ? " dim" : "")} style="pointer-events:none">
            ${Array.from({ length: nc }, (_, k) => html`<path key=${k} d=${"M" + (-hl).toFixed(1) + ",0 L" + hl.toFixed(1) + ",0"} fill="none" stroke="var(--flowdot)" stroke-width=${w.toFixed(1)} stroke-linecap="round">
              <animateMotion dur=${dur.toFixed(2) + "s"} begin=${(-k * dur / nc).toFixed(2) + "s"} repeatCount="indefinite" rotate="auto"><mpath href=${"#" + gid + "-p" + r.idx}/></animateMotion></path>`)}
          </g>`; }) : null}
        ${anim === "chevrons" ? ribbons.filter(r => !hov || flowLit(r.idx)).map(r => { const L = Math.hypot(r.ex - r.sx, r.ey - r.sy) || 1, nc = Math.max(2, Math.round(L / 70)), sz = Math.max(3, Math.min(r.w * 0.55, 6.5)),
          dotDur = Math.max(0.8, 2.6 - r.w * 0.11), dur = L * dotDur / 45;
          return html`<g key=${"cv" + r.idx} class=${"fm2-chev" + (hov && !flowLit(r.idx) ? " dim" : "")} style="pointer-events:none">
            ${Array.from({ length: nc }, (_, k) => html`<path key=${k} d=${"M" + (-sz).toFixed(1) + "," + (-sz).toFixed(1) + " L0,0 L" + (-sz).toFixed(1) + "," + sz.toFixed(1)} fill="none" stroke="var(--flowdot)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <animateMotion dur=${dur.toFixed(2) + "s"} begin=${(-k * dur / nc).toFixed(2) + "s"} repeatCount="indefinite" rotate="auto"><mpath href=${"#" + gid + "-p" + r.idx}/></animateMotion></path>`)}
          </g>`; }) : null}
        ${ribbons.map(r => html`<path key=${"h" + r.idx} d=${r.hitPath} fill="none" stroke="transparent" stroke-width=${r.hitW.toFixed(0)} stroke-linecap="butt"
          style="pointer-events:stroke;cursor:pointer" onMouseEnter=${() => setHov({ fi: r.idx })} onMouseLeave=${() => setHov(null)}/>`)}
      </svg>
      ${fleet.map(n => { const P = spos[n.id];
        return html`<button key=${n.id} class=${"fm2-nb" + (badgeLit(n.id) ? "" : relOf(n.id) ? " reldim" : " dim")} style=${"left:" + PX(P.x) + "%;top:" + PY(P.y) + "%;--c:" + Store.nodeColor(n.id) + ";font-size:" + (nodeFont(n.id) * U).toFixed(3) + "cqw"}
          onMouseEnter=${() => setHov({ id: n.id })} onMouseLeave=${() => setHov(null)}>${n.name}</button>`; })}
      ${sats.map(s => { const P = satpos[s.id]; if (!P) return null; const rr = satR(s.id), isz = ICON_R * rr;
        return html`<button key=${s.id} class=${"fm2-sb sb-" + s.kind + (badgeLit(s.id) ? "" : relOf(s.id) ? " reldim" : " dim")} style=${"left:" + PX(P.x) + "%;top:" + PY(P.y) + "%;--c:" + s.color + ";--isz:" + (isz * U).toFixed(3) + "cqw;width:" + (rr * 2 * U).toFixed(3) + "cqw;height:" + (rr * 2 * U).toFixed(3) + "cqw"}
          onMouseEnter=${() => setHov({ id: s.id })} onMouseLeave=${() => setHov(null)}><${Ic} i=${s.ic}/></button>`; })}
      ${hv && hv.type === "flow" ? html`<div class="fm2-bub" style=${bubStyle}>
        <div class="fm2-bub-h" style="flex-direction:row;gap:6px;align-items:center;flex-wrap:wrap"><span style=${"color:" + hv.ca}>${hv.a}</span><span style="color:var(--faint)">→</span><span style=${"color:" + hv.cb}>${hv.b}</span></div>
        <div class="fm2-bub-r"><span style="color:var(--dim)">${ranged ? T("fm|volume") : T("fm|throughput")}</span><b>${fmt(hv.v)}</b></div>
      </div>` : hv ? html`<div class="fm2-bub" style=${bubStyle}>
        <div class="fm2-bub-h" style=${"color:" + hv.col}>${hv.name}<span class="fm2-bub-k">${hv.sub}</span></div>
        <div class="fm2-bub-r"><span style=${"color:" + FLOW_IN}>${T("↓ ingress")}</span><b>${fmt(hv.ib || 0)}</b></div>
        <div class="fm2-bub-r"><span style=${"color:" + FLOW_EG}>${T("↑ egress")}</span><b>${fmt(hv.ob || 0)}</b></div>
      </div>` : null}
    </div>
    <div class="fm2-anim" title=${T("Flow animation (saved for everyone)")}>${FLOW_ANIMS().map(a => html`<button key=${a.id} class=${"fm2-anim-b" + (anim === a.id ? " on" : "")} title=${a.label} onClick=${() => setAnim(a.id)}><${Ic} i=${a.ic}/></button>`)}</div>
  </div>`;
}

let _svcAlerted = new Set();
let _appReady = false;
export const setAppReady = v => { _appReady = !!v; };
export function maybeAlertServices() {
  if (!_appReady) return;
  try {
    const issues = serviceIssues();
    const live = new Set(issues.map(svcKey));
    const sil = svcSilencedSet(); let silChanged = false;
    [...sil].forEach(k => { if (!live.has(k)) { sil.delete(k); silChanged = true; } });
    if (silChanged) svcSaveSilence(sil);
    [..._svcAlerted].forEach(k => { if (!live.has(k)) _svcAlerted.delete(k); });
    if (modalDepth()) return;
    const crit = issues.filter(i => i.sev === "critical" && !sil.has(svcKey(i)));
    const fresh = crit.filter(i => !_svcAlerted.has(svcKey(i)));
    if (!fresh.length) return;
    crit.forEach(i => _svcAlerted.add(svcKey(i)));
    setTimeout(() => { if (!modalDepth()) openModal(html`<${ServiceIssueSheet} issues=${crit}/>`); }, 0);
  } catch (_) {}
}
export function ServiceIssueSheet({ issues }) {
  const list = (issues || []).filter(Boolean);
  if (!list.length) { closeModal(); return null; }
  return html`<${Sheet} noGuard=${true} onClose=${closeModal}
      title=${list.length === 1 ? T("{v1} needs attention", { v1: list[0].label }) : T("Panel services need attention")}
      foot=${html`<${Fragment}>
        <button class="btn btn-ghost" onClick=${() => { list.forEach(svcSilence); closeModal(); }}>${T("Silence")}</button>
        <span class="grow"></span>
      <//>`}>
    <div class="svc-modal">
      ${list.map(i => html`<div class=${"svc-item " + i.sev} key=${svcKey(i)}>
        <div class="svc-head"><span class=${"svc-dot " + i.sev}></span><b>${i.label}</b>
          <span class=${"svc-tag " + i.sev}>${i.sev === "critical" ? T("sev|Critical") : T("sev|Warning")}</span></div>
        <div class="svc-msg">${i.msg}.</div>
        ${i.unit ? html`<div class="svc-cmd"><code>systemctl status ${i.unit}</code> · <code>${svcLogCmd(i.unit)}</code></div>`
          : i.fix === false ? html`<div class="svc-cmd"><code>mokutil --sb-state</code> · <code>modprobe amneziawg</code></div>`
          : html`<div class="svc-cmd"><code>dkms status</code> · <code>modprobe amneziawg</code></div>`}
      </div>`)}
      <div class="svc-foot">${certOnly
        ? T("The subscription service is installed — what is missing is its certificate, which only a reissue can create. “Run update” cannot fix this one.")
        : noUpdate ? T("An update cannot fix this — the key has to be enrolled once at the box's console, after a reboot. Until then awg interfaces stay on the userspace datapath, if it is installed.")
        : T("“Run update” reinstalls anything missing and re-enables the service — the same repair the Update button runs. A service that keeps crashing needs the logs above.")}</div>
    </div>
  <//>`;
}

export function useBlockStats(range) {
  const [bs, setBs] = useState({ loading: true, data: null, range: null });
  useEffect(() => {
    let alive = true; setBs(s => ({ ...s, loading: true }));
    const load = () => api.blockStats(range)
      .then(r => { if (alive) setBs({ loading: false, data: (r && r.data) || null, range }); })
      .catch(() => { if (alive) setBs(s => ({ ...s, loading: false })); });
    load();
    const ms = blockPollMs(range, panelToday());
    const t = ms ? setInterval(load, ms) : 0;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [range]);
  return bs;
}

export const joinNodes = (nodes, sep) => nodes.flatMap((n, i) => i ? [sep, n] : [n]);



export const WHO_PER_PAGE = 50, WHO_VISIBLE = 15;
export function WhoBubble({ rows, color, foot }) {
  const flat = [];
  for (const g of rows) for (const q of (g.peers || [])) flat.push({ user: g.user, name: q.name, ago: q.ago, dur: q.dur });
  flat.sort((a, b) => a.ago - b.ago);
  const [page, setPage] = useState(0);
  const listRef = useRef(null), dir = useRef(0);
  const pages = Math.max(1, Math.ceil(flat.length / WHO_PER_PAGE));
  const p = Math.min(page, pages - 1);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = dir.current < 0 ? el.scrollHeight : 0; }, [p]);
  const paged = pages > 1 ? flat.slice(p * WHO_PER_PAGE, p * WHO_PER_PAGE + WHO_PER_PAGE) : flat;
  const go = d => { dir.current = d; setPage(x => Math.max(0, Math.min(pages - 1, x + d))); };
  const scroll = flat.length > WHO_VISIBLE || pages > 1;
  const agoS = s => (s == null ? "" : s < 5 ? "now" : T("{v1} ago", { v1: seen(s) }));
  return html`<div class="prot-who">
    <div class="prot-who-h">${T("Who")}<span class="prot-who-sub">${T("latest first")}</span>${flat.length > 1 ? html`<span class="prot-who-tot">${fmtCount(flat.length)}</span>` : ""}</div>
    <div class=${"prot-who-list" + (scroll ? " scroll" : "")} ref=${listRef}>
      ${paged.map((q, i) => html`<div class="prot-who-r" key=${p + "-" + i}>
        <span class="prot-who-id">${q.user ? html`<span class="prot-who-nm">${q.user}</span>` : html`<span class="prot-who-un">${T("tag|unassigned")}</span>`}<span class="prot-who-sep">·</span><span class="prot-who-pn">${q.name}</span></span>
        <span class="prot-who-ago" style=${"color:" + color}>${agoS(q.ago)}</span>
      </div>`)}
    </div>
    ${pages > 1 ? html`<div class="prot-who-pg">
      <span class="prot-who-pglbl">${T("{v1}–{v2} of {v3}", { v1: p * WHO_PER_PAGE + 1, v2: Math.min(flat.length, p * WHO_PER_PAGE + WHO_PER_PAGE), v3: fmtCount(flat.length) })}</span>
      <span class="prot-who-pgbtns">
        <button class="prot-who-pgb" disabled=${p === 0} onClick=${() => go(-1)}>${T("Prev")}</button>
        <button class="prot-who-pgb" disabled=${p >= pages - 1} onClick=${() => go(1)}>${T("Next")}</button>
      </span>
    </div>` : null}
    ${foot ? html`<div class="prot-who-foot">${foot}</div>` : null}
  </div>`;
}
export function CatsBubble({ cats, color, counts }) {
  const kmb = n => { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
    : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); };
  const scroll = cats.length > WHO_VISIBLE;
  return html`<div class="prot-who">
    <div class="prot-who-h">${counts ? T("Blocked") : T("Filtering")}<span class="prot-who-sub">${counts ? T("sites caught") : T("by list size")}</span><span class="prot-who-tot">${fmtCount(cats.length)}</span></div>
    <div class=${"prot-who-list" + (scroll ? " scroll" : "")}>
      ${cats.map((c, i) => html`<div class="prot-who-r prot-cat-row" key=${i}>
        <span class="prot-cat-nm">${blockCatLabel(c.label)}</span>
        <span class="prot-who-ago prot-cat-n" style=${"color:" + color}>${counts ? T("{v1} {v2}", { v1: kmb(c.count), v2: pluralWord(c.count, "site") }) : (c.threat_ips ? T("{v1} IPs", { v1: kmb(c.threat_ips) }) : T("{v1} dom", { v1: kmb(c.domains) }))}</span>
      </div>`)}
    </div>
  </div>`;
}
export function Protection({ range, bs }) {
  const d = bs.data;
  const cov = (d && d.coverage) || {};
  const mech = cov.mechanisms || {};
  const mechKeys = Object.keys(mech);
  const waiting = Array.isArray(cov.waiting) ? cov.waiting : [];
  const hasCov = (cov.domains || 0) + (cov.threat_ips || 0) + (cov.categories || 0) + mechKeys.length + waiting.length > 0;
  const torrents = (d && d.torrents) || 0, scan = (d && d.scan) || 0, reach = (d && d.reach) || 0, blocked = (d && d.blocked) || 0;
  const mechd = (d && d.mech) || 0;
  const who = (d && d.who) || {};
  const bcats = (d && d.blocked_cats) || [];
  if (!d || (!hasCov && !torrents && !scan && !reach && !blocked && !mechd)) return null;
  const rw = rangeWord(bs.range || range);
  const kmb = n => { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M"
    : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n); };
  const MECH_LABEL = { torrents: T("Torrents"), smtp: T("Spam / SMTP"), portscan: T("Port scans"),
                       quic: "QUIC", doh: "DoH", mining: T("Mining") };
  const tiles = [];
  if (cov.domains || blocked || reach) {
    const bsites = bcats.reduce((a, c) => a + (c.count || 0), 0);
    const bsub = bcats.length ? (T("{v1} sites", { v1: kmb(bsites) })) : (reach ? (T("{v1} sites", { v1: kmb(reach) })) : "");
    tiles.push({ k: T("Blocked"), v: kmb(blocked), n: blocked,
      sub: bsub ? T("packets · {v1} · {v2}", { v1: bsub, v2: rw }) : (blocked ? T("packets · {v1}", { v1: rw }) : T("none {v1}", { v1: rw })),
      spark: (d && d.bseries) || null, color: "var(--brand)",
      bcats: bcats.length ? bcats : null, cats: (cov.cats && cov.cats.length) ? cov.cats : null });
  }
  tiles.push({ k: T("Torrents caught"), v: kmb(torrents), n: torrents, sub: torrents ? T("connections · {v1}", { v1: rw }) : T("none {v1}", { v1: rw }), spark: (d && d.series) || null, color: "var(--dangling)", who: who.torrent });
  tiles.push({ k: T("Scanners flagged"), v: kmb(scan), n: scan, sub: scan ? plural(scan, "source") + " · " + rw : T("none flagged"), color: "var(--partial)", who: who.scan });
  if (mechKeys.length || mechd) {
    tiles.push({ k: T("Ports blocked"), v: kmb(mechd), n: mechd,
      sub: mechd ? T("packets · {v1}", { v1: rw }) : T("none {v1}", { v1: rw }),
      spark: (d && d.mseries) || null, color: "var(--pending)" });
  }
  const q = (n, s) => s.replace(/^\d+/, kmb(n));
  const covParts = [];
  if (cov.domains) covParts.push(q(cov.domains, plural(cov.domains, "domain")));
  if (cov.threat_ips) covParts.push(q(cov.threat_ips, plural(cov.threat_ips, "threat-IP")));
  const acrossParts = [];
  if (cov.categories) acrossParts.push(q(cov.categories, plural(cov.categories, "category")));
  if (cov.ifaces) acrossParts.push(q(cov.ifaces, plural(cov.ifaces, "interface")));
  return html`<${Fragment}>
    ${secTitle(T("Protection"), html`${rw} · ${T("what blocking caught & is filtering")}`, undefined, "protection")}
    <div class="protcard">
      <div class="prot-metrics">
        ${tiles.map(t => { const w = (t.who && t.who.length) ? t.who : null;
          const inner = html`<${Fragment}>
            <div class="prot-top">
              <div class="prot-v" style=${"color:" + (t.n ? t.color : "var(--faint)")}>${t.v}</div>
              <div class="prot-tc">
                <div class="prot-k">${t.k}</div>
                <div class="prot-sub">${t.sub}</div>
              </div>
            </div>
            ${t.spark ? html`<div class="prot-spark"><${TrendSpark} data=${t.spark} color=${t.color}/></div>` : null}
          <//>`;
          const pop = w
            ? html`<${WhoBubble} rows=${w} color=${t.color} foot=${t.foot}/>`
            : (t.bcats ? html`<${CatsBubble} cats=${t.bcats} color=${t.color} counts/>`
              : (t.cats ? html`<${CatsBubble} cats=${t.cats} color=${t.color}/>` : null));
          if (pop && isMobile()) return html`<div class="prot-tile haswho" role="button" key=${t.k} onClick=${() => openModal(html`<${Sheet}
              title=${t.k} noGuard=${true} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}>
              <div class="m-protsheet">${pop}</div><//>`)}>${inner}</div>`;
          return pop
            ? html`<${Popover} key=${t.k} hoverOnly flipFit cls="prot-tile haswho" popCls="prot-who-pop" trigger=${inner}>
                ${pop}
              <//>`
            : html`<div class="prot-tile" key=${t.k}>${inner}</div>`;
        })}
      </div>
      ${hasCov ? html`<div class="prot-cov">
        <span class="prot-cov-ic"><${Ic} i="shield"/></span>
        <span class="prot-cov-txt">
          ${(() => {
            const what = covParts.join(" + "), where = acrossParts.join(" · ");
            if (what && where) return Trich("Filtering *{v1}* across *{v2}*", { v1: what, v2: where });
            if (what) return Trich("Filtering *{v1}*", { v1: what });
            if (where) return Trich("Mechanism blocking across *{v1}*", { v1: where });
            return T("Mechanism blocking");
          })()}
        </span>
        ${mechKeys.length ? html`<span class="prot-mech">${mechKeys.map(m => html`<span class="prot-chip" key=${m}>${MECH_LABEL[m] || m}${mech[m] > 1 ? html` <i>×${mech[m]}</i>` : ""}</span>`)}</span>` : null}
      </div>` : null}
      ${waiting.map(w => html`<div class="hint warnish" style="margin-top:8px" key=${w.label}>${T("{v1}: not filtered yet on {v2} — waiting for the provider catalog, or for this node's update.",
        { v1: w.label, v2: (w.nodes || []).join(", ") })}</div>`)}
    </div>
  <//>`;
}

const ATTN_KEY = "swg-attn-dismissed";
function attnRead() { try { return new Set(JSON.parse(localStorage.getItem(ATTN_KEY) || "[]")); } catch (_) { return new Set(); } }
function attnWrite(set) { try { localStorage.setItem(ATTN_KEY, JSON.stringify([...set].slice(-200))); } catch (_) {} }
let _attnDismissAt = 0;
function attnQuiet() { return Date.now() - _attnDismissAt >= 5000; }
function attnAct(key, awaySet) {
  if (!isMobile()) return null;
  const away = awaySet.has(key);
  return html`<span class="attn-acts" onClick=${e => e.stopPropagation()}><button type="button" class="iconbtn" data-lbl=${away ? T("Restore") : T("Dismiss")}
    aria-label=${away ? T("Restore") : T("Dismiss")} onClick=${e => { e.stopPropagation(); const s2 = attnRead(); away ? s2.delete(key) : s2.add(key); attnWrite(s2);
      if (!away) { _attnDismissAt = Date.now(); setTimeout(() => bus.emit(), 5100); } bus.emit(); }}>
    <${Ic} i=${away ? "refresh" : "x"}/></button></span>`;
}
export function Overview() {
  useStore();
  const peers = Store.recon.peers, users = Store.recon.users, fleet = Store.fleet, ns = Store.recon.nodeStatus;
  const m = isMobile();
  const selIds = m ? (Store.fleet || []).map(n => n.id) : dashNodes(), sel = new Set(selIds);
  const dKey = m ? "live" : dashKey();
  const rangeHist = useRangeHistory(dKey, selIds);
  const blockStats = useBlockStats(dKey);
  if (fleet.length === 0) return html`<div class="screen"><div class="nonodes">
    <div class="nonodes-ic"><${Ic} i="server"/></div>
    <h2>${T("No nodes yet")}</h2>
    <p>${T("Add your first entry server to start deploying peers. The panel stays the source of truth — each node syncs to it over outbound HTTPS.")}</p>
    <button class="btn btn-primary" onClick=${openNodeCreate}><span class="plus"><${Ic} i="plus"/></span> ${T("Add node")}</button>
  </div></div>`;
  const fleetSel = fleet.filter(n => sel.has(n.id));
  const scoped = selIds.length < fleet.length;
  const isSys = (nid, ifn) => !!(Store.describe[nid] && Store.describe[nid][ifn] && Store.describe[nid][ifn].system);
  const onSel = p => p.targets.some(t => sel.has(t.node));
  const sPeers = peers.filter(onSel);
  const nodeRate = id => { const snap = Store.stats[id]; let r = 0, t = 0;
    if (snap) for (const [ifn, blk] of Object.entries(snap.interfaces || {})) { if (isSys(id, ifn)) continue; for (const pp of blk.peers || []) { r += pp.rx_speed || 0; t += pp.tx_speed || 0; } }
    if (snap) for (const w of (snap.wdtt || [])) { r += w.rx_speed || 0; t += w.tx_speed || 0; }
    if (snap) for (const c of (snap.csqtt || [])) { r += c.rx_speed || 0; t += c.tx_speed || 0; }
    return [r, t]; };

  const online = sPeers.filter(p => p.targets.some(t => sel.has(t.node) && t.online)).length;
  const ready = sPeers.filter(p => p.status === "ready").length;
  const attention = sPeers.length - online - ready;
  const pAssigned = sPeers.filter(p => !p.unassigned).length;
  const pUnassigned = sPeers.length - pAssigned;
  const sUsers = users.filter(u => sPeers.some(p => p.user_id === u.id));
  const liveNodes = fleetSel.filter(n => ns[n.id] === "live").length;
  const ifaceCount = selIds.reduce((a, id) => a + Object.keys(Store.describe[id] || {}).filter(ifn => !isSys(id, ifn)).length + ((Store.stats[id] || {}).wdtt || []).filter(w => w && w.iface).length + ((Store.stats[id] || {}).csqtt || []).filter(c => c && c.iface).length, 0);
  const nodesAlerting = fleetSel.filter(n => healthAlerts(((Store.nodes || []).find(x => x.id === n.id) || {}).health).length).length;
  let rx = 0, tx = 0;
  fleetSel.forEach(n => { const [r, t] = nodeRate(n.id); rx += r; tx += t; });

  const PROB_STATUSES = ["dangling", "partial", "blocked", "faulty", "pending", "unknown"];
  const probs = sPeers.filter(p => PROB_STATUSES.includes(p.status))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const unassigned = Store.unassignedPeers().filter(onSel);
  const orphans = Store.recon.orphans.filter(o => sel.has(o.node));
  const why = { dangling: T("missing on every server"), partial: T("missing on some servers"), blocked: T("handshake never completes"), faulty: T("no inbound data flowing"), pending: T("just created, not seen yet"), unknown: T("server stale — can't confirm") };

  const STATUS_WORD = { dangling: "dangling", partial: T("partially deployed"), blocked: "restricted", faulty: "faulty", pending: "pending", unknown: T("on a stale server") };
  const statusGroups = PROB_STATUSES.map(s => ({ status: s, peers: probs.filter(p => p.status === s) })).filter(g => g.peers.length);
  const unByNode = {};
  unassigned.forEach(p => p.targets.forEach(t => {
    if (!sel.has(t.node)) return;
    const g = unByNode[t.node] || (unByNode[t.node] = { node: t.node, peers: new Set(), wg: new Set(), awg: new Set(), wdtt: new Set(), csqtt: new Set() });
    g.peers.add(p.id); (g[targetType(t)] || g.wg).add(t.iface);
  }));
  const unGroups = Object.values(unByNode);
  const orphByIf = {};
  orphans.forEach(o => { const k = o.node + "|" + o.iface; (orphByIf[k] || (orphByIf[k] = { node: o.node, iface: o.iface, n: 0 })).n++; });
  const orphGroups = Object.values(orphByIf);
  const svcIssues = serviceIssues();

  const recent = recentActivity();

  const effRange = effRangeOf(dKey, rangeHist.range);
  const dRanged = effRange !== "live";
  const dStep = rangeStep(effRange, rangeHist);
  const nodeVol = id => { const d = rangeHist.byNode[id]; if (!d) return { rx: 0, tx: 0 };
    let rx = 0, tx = 0; const R = d.rx || [], T = d.tx || [], MR = d.mrx || [], MT = d.mtx || [];
    for (let i = 0; i < R.length; i++) { rx += Math.max(0, (R[i] || 0) - (MR[i] || 0)); tx += Math.max(0, (T[i] || 0) - (MT[i] || 0)); }
    return { rx: rx * dStep, tx: tx * dStep }; };
  const nodeTraffic = fleetSel.map(n => {
    const [lr, lt] = nodeRate(n.id); const v = dRanged ? nodeVol(n.id) : { rx: lr, tx: lt };
    return { id: n.id, name: n.name, color: Store.nodeColor(n.id), rx: v.rx, tx: v.tx, peers: sPeers.filter(p => p.targets.some(d => d.node === n.id)).length };
  });
  const onlineOf = n => dRanged ? (((rangeHist.presence || {}).nodes || {})[n.id] || {}).peers || 0
                                 : sPeers.filter(p => p.targets.some(t => t.node === n.id && t.online)).length;
  const nodeOnline = fleetSel.map(n => ({ id: n.id, name: n.name, color: Store.nodeColor(n.id),
    online: onlineOf(n), total: sPeers.filter(p => p.targets.some(t => t.node === n.id)).length }));
  const rnkTotal = !dRanged && !nodeOnline.some(x => x.online > 0);
  const rankRows = nodeOnline.slice()
    .sort((a, b) => rnkTotal ? b.total - a.total : (b.online - a.online) || (b.total - a.total))
    .slice(0, 6)
    .map(x => ({ label: x.name, value: rnkTotal ? x.total : x.online,
      sub: rnkTotal ? (T("{v1} total", { v1: x.total })) : (T("{v1} online", { v1: x.online })),
      color: x.color || "var(--brand)", href: "#/node/" + encodeURIComponent(x.id) }));
  const anyTraffic = nodeTraffic.some(x => x.rx + x.tx > 0);
  const rankRowsTraffic = nodeTraffic.slice().sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx)).slice(0, 6)
    .map(x => ({ label: x.name, value: x.rx + x.tx, sub: dRanged ? xferCell(...dlul(x.rx, x.tx)) : rateCell(x.rx, x.tx),
      color: x.color || "var(--brand)", href: "#/node/" + encodeURIComponent(x.id) }));

  const fleetHist = fleetHistory(selIds, effRange, rangeHist);
  const tputRange = effRange === "live" ? "hour" : effRange;
  const _pres = rangeHist.presence;
  const [obN, obStep] = isCustomKey(effRange) ? [((_pres || {}).blocks || []).length, (_pres || {}).step || 86400]
    : (ONLINE_BLOCKS[effRange] || ONLINE_BLOCKS.live);
  const onlineBlocks = (dRanged && _pres && _pres.blocks) ? _pres.blocks : resampleBlocks(fleetHist.onT, fleetHist.on, obN, obStep);
  const onlineEndTs = (dRanged && _pres) ? _pres.end : fleetHist.onT[fleetHist.onT.length - 1];
  const onlineTimes = dRanged && _pres && isCustomKey(effRange) ? _pres.t : null;
  const hasOnline = onlineBlocks.some(v => v != null);
  const nTalk = Math.max(1, Math.min(50, (Store.panelSettings || {}).top_talkers || 10));
  const nDest = Math.max(1, Math.min(50, (Store.panelSettings || {}).top_destinations || 10));
  const talkE = dRanged ? trafficTotals(talkWindow(effRange)) : null;
  const talkD = talkE && talkE.data;
  let perPeer = [];
  if (!dRanged) {
    perPeer = sPeers.map(p => {
      let r = 0, t = 0; p.targets.forEach(tg => { if (!sel.has(tg.node)) return;
        const o = tg.observed; if (o) { r += o.rx_speed || 0; t += o.tx_speed || 0; }
        else if (tg.kwSpeed) { r += tg.kwSpeed.rx || 0; t += tg.kwSpeed.tx || 0; } });
      return { p, rx: r, tx: t };
    });
  }
  const talkG = {};
  perPeer.forEach(x => { if (x.rx + x.tx <= 0) return;
    const key = x.p.user_id ? "u" + x.p.user_id : "p" + x.p.id;
    const g = talkG[key] || (talkG[key] = { user: x.p.user_id ? Store.user(x.p.user_id) : null, sample: x.p, rx: 0, tx: 0, peers: [] });
    g.rx += x.rx; g.tx += x.tx; g.peers.push(x); });
  const talkers = dRanged ? [] : Object.values(talkG).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx)).slice(0, nTalk);
  const talkerRows = dRanged ? rangedTalkerRows(talkD, scoped ? (pid => { const p = Store.peer(pid); return !!p && p.targets.some(t => sel.has(t.node)); }) : null, nTalk)
    : talkers.map((g, i) => {
    const peers = g.peers.slice().sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
    return {
      label: g.user ? g.user.name : (g.sample.title || T("Unassigned peer")), value: g.rx + g.tx, count: peers.length,
      sub: dRanged ? xferCell(...dlul(g.rx, g.tx)) : rateCell(g.rx, g.tx),
      bub: peers.length > 1 ? peers.map(pp => { const t = (pp.p.targets || [])[0] || {}; const oct = (t.ip || "").split(".").pop();
        return { kind: targetType(t), gen3: tgt3(t), name: pp.p.title || (oct ? T("Peer .{v1}", { v1: oct }) : T("Peer")), value: pp.rx + pp.tx,
          sub: dRanged ? xferCell(...dlul(pp.rx, pp.tx)) : rateCell(pp.rx, pp.tx) }; }) : null,
      color: dashRankColor(i, "talker"), href: "#/users",
      onClick: e => { e.preventDefault(); g.user ? revealUser(g.user.id) : revealPeer(g.sample); },
    };
  });
  const catAgg = {};
  const _cadd = (cat, up, dn) => { if (isBlockCat(cat)) return; const a = catAgg[cat] = catAgg[cat] || { up: 0, dn: 0 }; a.up += up || 0; a.dn += dn || 0; };
  if (dRanged) (rangeHist.cats || []).forEach(e => { if (sel.has(e.node)) _cadd(e.cat, e.up, e.dn); });
  else { const cById = Object.fromEntries((Store.nodes || []).map(n => [n.id, n.cats || {}]));
    fleetSel.forEach(n => { for (const [cat, v] of Object.entries(cById[n.id] || {})) _cadd(cat, v.up, v.dn); }); }
  const catRows = Object.entries(catAgg).filter(([c, v]) => c !== "uncat" && v.up + v.dn > 0)
    .sort((a, b) => (b[1].dn + b[1].up) - (a[1].dn + a[1].up)).slice(0, nDest)
    .map(([cat, v], i) => ({ label: catLabelOf(cat), value: v.dn + v.up, sub: dRanged ? xferCell(...dlul(v.dn, v.up)) : rateCell(v.dn, v.up), color: dashRankColor(i, "dest") }));
  const _un = catAgg.uncat;
  if (_un && _un.up + _un.dn > 0) catRows.push({ label: catLabelOf("uncat"), value: _un.dn + _un.up, sub: dRanged ? xferCell(...dlul(_un.dn, _un.up)) : rateCell(_un.dn, _un.up), color: CAT_UNCAT_COLOR });
  const exitAll = fleetSel.flatMap(n => exitTraffic(n.id, dRanged, rangeHist).map(x => ({ ...x, node: n.id })));
  const exitDup = {};
  exitAll.forEach(x => { exitDup[x.label] = (exitDup[x.label] || 0) + 1; });
  const exitSorted = exitAll.slice().sort((a, b) => (b.up + b.down) - (a.up + a.down));
  const exitTail = exitSorted.splice(nDest);
  const exitCell = (up, down) => dRanged ? xferCell(...dlul(down, up)) : rateCell(down, up);
  const exitRows = exitSorted.map(x => ({
    label: exitDup[x.label] > 1 ? x.label + " · " + Store.nodeName(x.node) : x.label,
    value: x.up + x.down, color: FLOW_EXIT, sub: exitCell(x.up, x.down),
  }));
  if (exitTail.length) {
    const up = exitTail.reduce((t, x) => t + x.up, 0), dn = exitTail.reduce((t, x) => t + x.down, 0);
    exitRows.push({ label: T("…and {v1} more", { v1: exitTail.length }), value: up + dn,
                    color: FLOW_EXIT, sub: exitCell(up, dn) });
  }
  const totClientRx = nodeTraffic.reduce((a, x) => a + (x.rx || 0), 0);
  const totClientTx = nodeTraffic.reduce((a, x) => a + (x.tx || 0), 0);

  return html`<div class="screen">
    <${StoreOffBanner}/>
    ${m ? null : html`<${DashRail}/>`}
    ${isCustomKey(dKey) && rangeHist.range === dKey && rangeHist.err ? html`<div class="notice warn">${srvText(rangeHist.err)}</div>` : null}
    <div class="statgrid">
      <a class="stat accent clk" href="#/users" onClick=${e => { e.preventDefault(); openUsers({ online: true }); }}><span class="stat-ic"><${Ic} i="activity"/></span><div class="stat-c"><div class="k">${T("Online now")}</div><div class="v">${online}<small> / ${sPeers.length}</small></div><div class="sub">${T("Online users →")}</div></div></a>
      <a class="stat clk" href="#/users"><span class="stat-ic"><${Ic} i="users"/></span><div class="stat-c"><div class="k">${T("Users")}</div><div class="v">${sUsers.length}</div><div class="sub">${scoped ? T("{v1} here", { v1: plural(sPeers.length, "peer") }) : T("{v1} total", { v1: plural(sPeers.length, "peer") })}</div></div></a>
      <a class="stat clk" href="#/users" onClick=${e => { e.preventDefault(); openUsers(); }}><span class="stat-ic"><${Ic} i="device"/></span><div class="stat-c"><div class="k">${T("Peers")}</div><div class="v" style="font-size:19px"><span style="color:var(--ink)">${pAssigned}</span> · <span style="color:var(--dim)">${pUnassigned}</span></div><div class="sub">${T("assigned · unassigned")}</div>${orphans.length ? html`<div class="sub" style="color:#E8912D;font-weight:600">${T("Orphan peers {n}", { n: orphans.length })}</div>` : ""}</div></a>
      <a class="stat clk" href="#/nodes"><span class="stat-ic"><${Ic} i="server"/></span><div class="stat-c"><div class="k">${T("col|Nodes")}</div><div class="v">${liveNodes}<small> / ${fleetSel.length}</small></div><div class="sub">${plural(ifaceCount, "interface")}</div>${nodesAlerting ? html`<div class="sub" style="color:var(--dangling)">${T("{n} alerting", { n: nodesAlerting })}</div>` : ""}</div></a>
      <div class="stat"><span class="stat-ic"><${Ic} i="gauge"/></span><div class="stat-c"><div class="k">${T("Throughput")}</div><div class="v" style=${"font-size:19px;color:" + (rx + tx > 0 ? "var(--online)" : "var(--faint)")}>↓ ${rate(dlul(rx, tx)[0])}</div><div class="sub"><span style=${"color:" + (rx + tx > 0 ? "var(--ready)" : "var(--faint)")}>↑ ${rate(dlul(rx, tx)[1])}</span>${" " + (scoped ? T("sum|selected") : T("sum|aggregate"))}</div></div></div>
    </div>

    ${secTitle(T("Fleet"), scoped ? T("{n} of {total}", { n: fleetSel.length, total: plural(fleet.length, "server") }) : plural(fleet.length, "server"), undefined, "fleet")}
    ${fleetSel.length && !m ? html`<div class="trends">
      <div class="trendcard wide">
        <div class="donutcard-h"><h3>${T("Fleet throughput")}</h3></div>
        ${(fleetHist.t || []).length > 1
          ? html`<${ThroughputChart} rx=${fleetHist.rx} tx=${fleetHist.tx} times=${fleetHist.t} range=${tputRange} cap=${isCustomKey(tputRange) ? axisCap(rangeHist.axis) : RANGE_CAP[tputRange]} h=${70}/>`
          : html`<div class="harea-empty">${T("gathering — no history yet")}</div>`}
      </div>
      <div class="trendcard">
        <div class="donutcard-h"><h3>${T("Online peers")}</h3><span class="grow"></span><span class="trend-now">${dRanged && _pres ? (_pres.total || {}).peers : online}</span></div>
        ${hasOnline
          ? html`<${OnlineBlocks} blocks=${onlineBlocks} step=${obStep} endTs=${onlineEndTs} times=${onlineTimes} range=${effRange} color="var(--online)" h=${70}/>`
          : html`<div class="harea-empty">${T("gathering — fills as it polls")}</div>`}
      </div>
    </div>` : null}
    ${fleetSel.length ? html`<div class="fleet2">${fleetSel.map(n => html`<${FleetNodeCard} key=${n.id} n=${n} traffic=${nodeTraffic.find(x => x.id === n.id)} ranged=${dRanged} histRange=${effRange} nodeHist=${(rangeHist.byNode || {})[n.id] || null} presence=${dRanged && _pres ? (_pres.nodes || {})[n.id] || null : null}/>`)}</div>`
      : html`<div class="allclear">${T("No servers configured in fleet.json.")}</div>`}

    ${fleetSel.length && !m ? html`<${Fragment}>
      ${secTitle(T("Distribution"), html`${scoped ? T("selected nodes") : T("whole fleet")} · ${rangeWord(effRange)}`, undefined, "distribution")}
      <${DashDoughnuts} selIds=${selIds} range=${effRange} hist=${rangeHist}/>
    <//>` : null}

    ${fleetSel.length && !m ? html`<${Fragment}>
      ${secTitle(T("Traffic flow map"), T("signal flow · by category"), undefined, "flow")}
      <${FlowMap2} selIds=${selIds} range=${effRange} hist=${rangeHist}/>
    <//>` : null}

    ${fleetSel.length ? html`<${Protection} range=${effRange} bs=${blockStats}/>` : null}

    ${fleetSel.length > 1 && !m ? html`<${Fragment}>
      ${secTitle(T("Top nodes by peers"), rnkTotal ? T("total peers") : (dRanged ? T("online · {range}", { range: rangeWord(effRange) }) : T("online now")), undefined, "topnodes")}
      <div class="rankcard"><${RankBars} rows=${rankRows}/></div>
    <//>` : null}

    ${fleetSel.length > 1 && anyTraffic && !m ? html`<${Fragment}>
      ${secTitle(T("Top nodes by traffic"), dRanged ? T("{range} · by volume", { range: rangeWord(effRange) }) : T("by live throughput"), undefined, "topnodestraf")}
      <div class="rankcard"><${RankBars} rows=${rankRowsTraffic}/></div>
    <//>` : null}

    ${!m && (talkerRows.length || (dRanged && (!talkD || talkE.off || talkE.err))) ? html`<${Fragment}>
      ${secTitle(T("Top talkers"), dRanged ? talkSub(effRange, talkD, scoped) : T("by live throughput"), undefined, "toptalkers")}
      ${talkerRows.length ? html`<div class="rankcard"><${RankBars} rows=${talkerRows}/></div>`
        : talkE.off ? html`<div class="hint">${T("Traffic totals are off — Settings → Display says why.")}</div>`
        : talkE.err ? html`<div class="hint">${typeof talkE.err === "object" ? srvText(talkE.err) : T("The traffic totals could not be loaded.")}</div>`
        : html`<div class="hint faint">…</div>`}
    <//>` : null}

    ${catRows.length && !m ? html`<${Fragment}>
      ${secTitle(T("Top destinations"), html`${dRanged ? rangeWord(effRange) : rangeWord("live")} · ${T("categories overlap")}${(totClientRx + totClientTx) ? (() => { const f = dRanged ? fmtBytes : rate, [d, u] = dlul(totClientRx, totClientTx); return html` · ${ofTotal(f(d), f(u))}`; })() : ""}`, undefined, "topdest")}
      <div class="rankcard"><${RankBars} rows=${catRows}/></div>
    <//>` : null}

    ${exitRows.length && !m ? html`<${Fragment}>
      ${secTitle(T("Traffic by exit"), dRanged ? T("{range} · by volume", { range: rangeWord(effRange) }) : T("by live throughput"), undefined, "byexit")}
      <div class="rankcard"><${RankBars} rows=${exitRows}/></div>
    <//>` : null}

    ${recent.length ? html`<${Fragment}>
      ${secTitle(T("Recent activity"), null, false, "activity")}
      <div class="actlist">${(m ? recent.slice(0, 5) : recent).map(e => html`<a class=${"act-row" + (e.click ? "" : " noclk")} href=${e.click ? e.click.href : null} key=${e.key}
          onClick=${e.click && e.click.on ? (ev => { ev.preventDefault(); e.click.on(); }) : (e.click ? null : (ev => ev.preventDefault()))}>
        <span class=${"act-ic t-" + e.slug}><${Ic} i=${e.icon}/></span>
        <span class="act-what">${srvVerb(e.verb)}</span>${e.name ? html`<span class="act-name">${srvName(e)}</span>` : null}
        ${e.detail || e.detail_key ? html`<span class="act-detail">${srvDetail(e)}</span>` : null}
        <span class="grow"></span><span class="when">${ago(e.ts)}</span>${e.click ? html`<span class="act-arrow"><${Ic} i="arrow"/></span>` : null}</a>`)}</div>
      <div class="act-morewrap"><a class="act-more" href="#/activity">${T("Show all history »")}</a></div>
    <//>` : null}

    ${(() => {
      const awaySet = m ? attnRead() : new Set();
      const rows = [
        ...svcIssues.map(is => ["svc" + svcKey(is), html`<div class=${"attn-row svc " + is.sev} key=${"svc" + svcKey(is)} onClick=${() => openModal(html`<${ServiceIssueSheet} issues=${[is]}/>`)}>
            <span class=${"svc-badge " + is.sev}><${Ic} i="warn"/>${is.sev === "critical" ? T("sev|Critical") : T("sev|Warning")}</span>
            <span class="name">${is.label} — ${SVC_KINDWORD[is.kind] || is.kind}</span>
            <span class="why">${is.msg}</span><span class="grow"></span><span class="rowarrow"><${Ic} i="arrow"/></span>${attnAct("svc" + svcKey(is), awaySet)}</div>`]),
        ...statusGroups.map(g => ["s" + g.status + ":" + g.peers.length, html`<div class="attn-row" key=${"s" + g.status} onClick=${() => openUsers({ status: g.status })}>
            <${Badge} s=${g.status}/><span class="name">${Trich("*{v1}* {v2}", { v1: plural(g.peers.length, "peer"), v2: STATUS_WORD[g.status] || g.status })}</span>
            <span class="why">${why[g.status] || ""}</span><span class="grow"></span><span class="rowarrow"><${Ic} i="arrow"/></span>${attnAct("s" + g.status + ":" + g.peers.length, awaySet)}</div>`]),
        ...unGroups.map(g => ["u" + g.node + ":" + g.peers.size, html`<div class="attn-row" key=${"u" + g.node} onClick=${() => openUsers({ node: g.node, status: "unassigned" })}>
            <${Badge} s="unassigned"/><span class="name">${Trich("*{v1}* unassigned on {v2} on {v3}", { v1: plural(g.peers.size, "peer"), v2: ifCountPhrase(g), v3: Store.nodeName(g.node) })}</span>
            <span class="grow"></span><span class="rowarrow"><${Ic} i="arrow"/></span>${attnAct("u" + g.node + ":" + g.peers.size, awaySet)}</div>`]),
        ...orphGroups.map(g => ["o" + g.node + g.iface + ":" + g.n, html`<div class="attn-row" key=${"o" + g.node + g.iface} onClick=${() => revealOrphans(g.node, g.iface)}>
            <${Badge} s="orphan"/><span class="name">${Trich("*{v1}* orphan on {v2} ({v3}) on {v4}", { v1: plural(g.n, "peer"), v2: g.iface, v3: ifTypeLabel(g.node, g.iface), v4: Store.nodeName(g.node) })}</span>
            <span class="grow"></span><span class="rowarrow"><${Ic} i="arrow"/></span>${attnAct("o" + g.node + g.iface + ":" + g.n, awaySet)}</div>`]),
      ];
      const away = awaySet;
      const shown = rows.filter(r => !away.has(r[0])), set = rows.filter(r => away.has(r[0]));
      const quiet = m && !shown.length && set.length && attnQuiet();
      return html`
    ${quiet ? null : html`${secTitle(T("Needs attention"), shown.length ? plural(shown.length, "group") : null, undefined, "attention")}
    ${!shown.length
      ? html`<div class="allclear"><${Ic} i="check"/><span>${set.length ? T("Nothing else needs attention — what you set aside is at the bottom.") : T("Everything's deployed and reporting. No drift across the fleet.")}</span></div>`
      : html`<div class="attn">${shown.map(r => r[1])}</div>`}`}
    ${set.length ? html`${secTitle(T("Dismissed"), plural(set.length, "group"), undefined, "dismissed")}<div class="attn attn-away">${set.map(r => r[1])}</div>` : null}`;
    })()}
  </div>`;
}
