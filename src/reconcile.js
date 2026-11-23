
import { T } from "./js/i18n.js";

const DEFAULTS = { graceMs: 60000, nodeStaleMs: 30000, unblockMs: 300000, restoreGraceMs: 120000 };

const RANK = { online: 8, faulty: 7, ready: 6, blocked: 5, partial: 4, restoring: 3, pending: 3, creating: 3, rotating: 3, dangling: 2, broken: 2, blocking: 1, disabled: 0, unknown: 1 };

function ipInCidr(ip, cidr) {
  if (!ip || !cidr || String(cidr).indexOf("/") < 0 || String(ip).indexOf(":") >= 0) return true;
  const parts = String(cidr).split("/"); const bits = +parts[1];
  if (!(bits >= 0 && bits <= 32)) return true;
  const toInt = a => { const o = String(a).split("."); if (o.length !== 4) return null; let v = 0; for (let i = 0; i < 4; i++) { const n = +o[i]; if (!(n >= 0 && n <= 255)) return null; v = (v * 256) + n; } return v >>> 0; };
  const a = toInt(ip), b = toInt(parts[0]); if (a === null || b === null) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

function ipOf(hostport) {
  if (!hostport) return "";
  const s = String(hostport);
  return s[0] === "[" ? s.slice(1, s.indexOf("]")) : s.split(":")[0];
}
function portOf(hostport) {
  if (!hostport) return "";
  const s = String(hostport); const i = s.lastIndexOf(":");
  return i < 0 ? "" : s.slice(i + 1);
}

function reconcile(roster, stats, now, cfg) {
  now = now || Date.now();
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  roster = roster || {};
  stats = stats || {};
  const users = roster.users || {};
  const peerStore = roster.peers || {};

  const nodeStatus = {};
  for (const node of Object.keys(stats)) {
    const seen = (cfg.nodeSeen || {})[node];
    const gen = Number.isFinite(seen) ? seen : (stats[node] && stats[node].generated_at);
    nodeStatus[node] = (gen && (now - gen * 1000) <= cfg.nodeStaleMs) ? "live" : "stale";
  }

  const observed = {}, ifDown = {};
  for (const node of Object.keys(stats)) {
    const ifaces = (stats[node] && stats[node].interfaces) || {};
    for (const iface of Object.keys(ifaces)) {
      if (ifaces[iface] && ifaces[iface].down) ifDown[node + "|" + iface] = ifaces[iface].down;
      for (const p of (ifaces[iface].peers || [])) observed[node + "|" + iface + "|" + p.public_key] = p;
    }
  }

  const turnConnIps = {}, turnByPort = {}, turnSportSvc = {};
  for (const node of Object.keys(stats)) {
    const ips = {}, byPort = {}, sportSvc = {};
    for (const tp of ((stats[node] && stats[node].turn_proxies) || [])) {
      const ip = ipOf(tp && tp.connect); if (ip) ips[ip] = true;
      const port = portOf(tp && tp.connect); if (port) (byPort[port] = byPort[port] || []).push((tp && tp.service) || "turn");
      for (const sp of ((tp && tp.wg_sports) || [])) sportSvc[String(sp)] = (tp && tp.service) || "turn";
    }
    turnConnIps[node] = ips; turnByPort[node] = byPort; turnSportSvc[node] = sportSvc;
  }

  const managed = {};
  const peers = Object.keys(peerStore).map(function (pid) {
    const p = peerStore[pid] || {};
    const pubkey = p.pubkey || "";
    const user = (p.user_id != null) ? (users[p.user_id] || null) : null;
    const createdMs = (p.created_at || 0) * 1000;
    const targetsIn = Array.isArray(p.targets) ? p.targets : [];

    const wpass = p.wdtt_password || "";
    const cpass = p.csqtt_password || "";
    const targets = targetsIn.map(function (t) {
      if (t.type === "wdtt" || t.type === "csqtt") {
        const src = t.type === "csqtt" ? "csqtt" : "wdtt";
        const pass = t.type === "csqtt" ? cpass : wpass;
        const inst = ((stats[t.node] || {})[src] || []).filter(Boolean).find(w => w.iface === t.iface) || null;
        const dev = inst ? (inst.passwords || {})[pass] : null;
        let st;
        if (nodeStatus[t.node] !== "live") st = "unknown";
        else if (!inst) st = ((now - createdMs) <= cfg.graceMs) ? "creating" : "dangling";
        else st = !dev ? (((now - createdMs) <= cfg.graceMs) ? "creating" : "ready")
                       : (dev.online ? "online" : "ready");
        return { node: t.node, iface: t.iface, ip: (dev && dev.ip) || "", type: t.type, primary: t.primary || false,
                 raw_ip: (dev && dev.raw_ip) || "",
                 status: st, online: st === "online", observed: null, via: null, viaTurn: null,
                 kwSpeed: dev ? { rx: dev.rx_speed || 0, tx: dev.tx_speed || 0 } : null,
                 kwXfer: dev ? { rx_speed: dev.rx_speed || 0, tx_speed: dev.tx_speed || 0,
                                 rx_bytes: dev.up_bytes || 0, tx_bytes: dev.down_bytes || 0 } : null,
                 restorable: false, correctable: false, problemMs: 0, down: null };
      }
      const key = t.node + "|" + t.iface + "|" + pubkey;
      managed[key] = true;
      const obs = observed[key] || null;
      let st, faultKind = null;
      if (nodeStatus[t.node] !== "live") st = "unknown";
      else if (obs) {
        if (obs.online) {
          st = "online";
          if (cfg.detectChurn !== false && obs.hs_gap_med != null
              && obs.hs_seen >= (cfg.churnMin || 3)
              && obs.hs_gap_med <= (cfg.churnGapS || 60)
              && (obs.hs_bytes_med || 0) >= (cfg.churnBytes || 16384)
              && !obs.ep_moves) { st = "blocked"; faultKind = "churn"; }
        } else if (cfg.detectBlocked !== false && obs.endpoint && (obs.rx_bytes || 0) > 0
                   && obs.handshake_age == null && (now - createdMs) > cfg.graceMs) {
          st = "blocked"; faultKind = "nohs";
        } else st = "ready";
      }
      else {
        const ifm = ((stats[t.node] || {}).interfaces || {})[t.iface];
        const sub = ifm && ifm.meta && ifm.meta.subnet;
        if (sub && t.ip && !ipInCidr(t.ip, sub)) st = "broken";
        else st = (now - createdMs) <= cfg.graceMs ? "creating" : "dangling";
      }
      const _tk = pid + "|" + t.node + "|" + t.iface;
      const _tprob = (st === "dangling" || st === "broken");
      if (cfg.probSince) {
        if (_tprob) { if (!cfg.probSince[_tk]) cfg.probSince[_tk] = now; }
        else if (cfg.probSince[_tk]) delete cfg.probSince[_tk];
      }
      const _tms = (cfg.probSince && cfg.probSince[_tk]) ? (now - cfg.probSince[_tk]) : 0;
      const _trip = _tms >= (cfg.restoreGraceMs || 120000);
      const epIp = (obs && obs.endpoint) ? ipOf(obs.endpoint) : "";
      const via = epIp ? ((turnConnIps[t.node] || {})[epIp] ? "turn" : "direct") : null;
      let viaTurn = null;
      if (via === "turn") {
        const eport = portOf(obs && obs.endpoint);
        const bySport = (turnSportSvc[t.node] || {})[String(eport)];
        const lp = ((((((stats[t.node] || {}).interfaces || {})[t.iface] || {}).meta) || {}).listen_port);
        const svcs = (turnByPort[t.node] || {})[String(lp)] || [];
        viaTurn = bySport || (svcs.length ? svcs[0] : null);
      }
      return { node: t.node, iface: t.iface, ip: t.ip, type: t.type, primary: t.primary || false,
               overrides: t.overrides || null,
               status: st, fault: faultKind, online: !!(obs && obs.online), observed: obs, via: via,
               viaTurn: viaTurn,
               restorable: (st === "dangling") && _trip,
               correctable: (st === "broken") && _trip,
               problemMs: _tprob ? _tms : 0,
               down: ifDown[t.node + "|" + t.iface] || null };
    });

    const live = targets.filter(d => nodeStatus[d.node] === "live");
    const present = live.filter(d => (d.type === "wdtt" || d.type === "csqtt") ? (d.status === "online" || d.status === "ready") : d.observed);
    const onlineAny = targets.some(d => d.online);
    let status;
    if (p._creating) status = "creating";
    else if (targets.length === 0 || live.length === 0) status = "unknown";
    else if (present.length === 0) status = (live.length && live.every(d => d.status === "broken")) ? "broken"
                                            : ((now - createdMs) <= cfg.graceMs ? "creating" : "dangling");
    else if (present.length < live.length) status = "partial";
    else { status = present[0].status; present.forEach(d => { if ((RANK[d.status] || 0) > (RANK[status] || 0)) status = d.status; }); }

    if (cfg.rotating && cfg.rotating.has(pid) && (status === "dangling" || status === "creating" || status === "unknown")) status = "rotating";

    const blocked = !!(p.disabled || (user && user.disabled));
    const ublkAt = Math.max(p.unblock_at || 0, (user && user.unblock_at) || 0);
    const restoring = !blocked && ublkAt && (now - ublkAt * 1000) < cfg.unblockMs && !(live.length > 0 && present.length === live.length);
    const lifecycle = blocked ? "disabled" : restoring ? "restoring" : null;
    const removedByAccess = blocked;
    const OFF_STATES = { dangling: 1, unknown: 1, creating: 1, broken: 1, partial: 1 };
    const takesLifecycle = s => s === "ready" || (removedByAccess && OFF_STATES[s]);
    if (lifecycle && takesLifecycle(status)) status = lifecycle;
    targets.forEach(d => {
      if (lifecycle && takesLifecycle(d.status)) d.status = lifecycle;
      if (removedByAccess) { d.restorable = d.correctable = false; d.problemMs = 0; }
    });

    let reason = null;
    if (status === "dangling" || status === "partial" || status === "creating") {
      const dt = targets.find(d => d.down);
      reason = dt ? T("interface {v1} is down — {v2}", { v1: dt.iface, v2: dt.down })
                  : (status === "dangling" ? T("missing on every server")
                     : status === "partial" ? T("missing on some live servers") : T("created — not seen on a node yet"));
    } else if (status === "blocked") {
      const bt = new Set(targets.filter(d => d.status === "blocked").map(d => d.type));
      const proto = (bt.has("awg") && bt.has("wg")) ? "Wireguard or AmneziaWG" : bt.has("awg") ? "AmneziaWG" : bt.has("wg") ? "Wireguard" : "Wireguard or AmneziaWG";
      reason = targets.some(d => d.fault === "churn")
        ? T("the tunnel keeps collapsing and being rebuilt — the session won't hold, which is what a filtered or DPI'd connection looks like")
        : T("reaching the server but the handshake never completes — likely DPI / MTU / wrong {v1} params", { v1: proto });
    }
    else if (status === "broken") reason = T("the interface is up but this peer's IP is outside its subnet — the record needs correcting, not the interface");

    const restorable = targets.some(d => d.restorable);
    const correctable = targets.some(d => d.correctable);
    const problemMs = targets.reduce((m, d) => Math.max(m, d.problemMs || 0), 0);

    let lastAge = null;
    targets.forEach(d => {
      if (d.observed && d.observed.handshake_age != null)
        lastAge = (lastAge == null) ? d.observed.handshake_age : Math.min(lastAge, d.observed.handshake_age);
    });

    return {
      id: pid, pubkey: pubkey, psk: p.psk || "", title: p.title || "",
      wdtt_password: p.wdtt_password || "", csqtt_password: p.csqtt_password || "", vk_hash: p.vk_hash || "",
      user_id: (p.user_id != null) ? p.user_id : null,
      name: user ? (user.name || "") : "",
      unassigned: !user,
      sub_hide: Array.isArray(p.sub_hide) ? p.sub_hide : [],
      overrides: p.overrides || null,
      targets: targets, created_at: p.created_at || null, modified_at: p.modified_at || null,
      status: status, reason: reason, online: onlineAny, lastHandshakeAge: lastAge,
      presentCount: present.length, liveCount: live.length,
      restorable: restorable,
      correctable: correctable,
      problemMs: problemMs,
      disabled: blocked, selfDisabled: !!p.disabled, userDisabled: !!(user && user.disabled),
      disabledAt: p.disabled_at || 0,
    };
  });

  const byUser = {};
  peers.forEach(pr => { if (pr.user_id != null) (byUser[pr.user_id] = byUser[pr.user_id] || []).push(pr); });
  const userList = Object.keys(users).map(function (uid) {
    const u = users[uid] || {};
    const mine = byUser[uid] || [];
    let status = "empty", online = false;
    mine.forEach(pr => {
      if (pr.online) online = true;
      if (status === "empty" || (RANK[pr.status] || 0) > (RANK[status] || 0)) status = pr.status;
    });
    if ((status === "ready" || status === "empty") && u.disabled) status = "disabled";
    return {
      id: uid, name: u.name || "", vk_link: u.vk_link || "",
      vk_links: Array.isArray(u.vk_links) ? u.vk_links : (u.vk_link ? [u.vk_link] : []),
      vk_pool: u.vk_pool || {},

      created_at: u.created_at || null, modified_at: u.modified_at || null,
      peerIds: mine.map(pr => pr.id),
      peerCount: mine.length, onlineCount: mine.filter(pr => pr.online).length,
      status: status, online: online, disabled: !!u.disabled,
      disabledAt: u.disabled_at || 0,
    };
  });

  const retiring = cfg.retiring || null;
  const systemIfaces = cfg.systemIfaces || null;
  const orphans = [];
  for (const key of Object.keys(observed)) {
    if (managed[key]) continue;
    const parts = key.split("|");
    if (nodeStatus[parts[0]] !== "live") continue;
    if (systemIfaces && systemIfaces.has(parts[0] + "|" + parts[1])) continue;
    if (retiring && retiring.has(parts[2])) continue;
    orphans.push(Object.assign({ node: parts[0], iface: parts[1], pubkey: parts[2], status: "orphan" }, observed[key]));
  }

  return { nodeStatus: nodeStatus, peers: peers, users: userList, orphans: orphans };
}

export { reconcile, DEFAULTS };
