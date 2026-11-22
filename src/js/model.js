import { isWdttIface, isCsqttIface, isSelfContainedIface, portOf } from "./util.js";
import { Store } from "./store.js";
import { T } from "./i18n.js";
import { portsClean, portsToks, portsSpans } from "./rulerows.js";

export const wdttCfgClaims = (cfg, iface) =>
  !!(cfg || {})[iface] || Object.values(cfg || {}).some(c => c && c.raw_iface === iface);
export const csqttCfgClaims = (cfg, iface) => !!(cfg || {})[iface];

export function wdttOn(node, iface) {
  if (!node || !iface) return false;
  if (((Store.stats[node] || {}).wdtt || []).some(w => w && (w.iface === iface || w.raw_iface === iface))) return true;
  return wdttCfgClaims(((Store.nodes || []).find(x => x.id === node) || {}).wdtt_cfg, iface);
}
export function csqttOn(node, iface) {
  if (!node || !iface) return false;
  if (((Store.stats[node] || {}).csqtt || []).some(c => c && c.iface === iface)) return true;
  return csqttCfgClaims(((Store.nodes || []).find(x => x.id === node) || {}).csqtt_cfg, iface);
}
export function scKindByName(name) {
  if (!name) return null;
  for (const nid of Object.keys(Store.stats || {})) {
    if (wdttOn(nid, name)) return "wdtt";
    if (csqttOn(nid, name)) return "csqtt";
  }
  for (const n of (Store.nodes || [])) {
    if (wdttCfgClaims(n.wdtt_cfg, name)) return "wdtt";
    if (csqttCfgClaims(n.csqtt_cfg, name)) return "csqtt";
  }
  return isWdttIface(name) ? "wdtt" : isCsqttIface(name) ? "csqtt" : null;
}
export const isSelfContainedTgt = (t) => !!t && (targetType(t) === "wdtt" || targetType(t) === "csqtt");
export const isWdttName = (name) => scKindByName(name) === "wdtt";
export const isCsqttName = (name) => scKindByName(name) === "csqtt";
export const isSelfContainedName = (name) => !!scKindByName(name);

export function kindOf(node, iface, type) {
  if (type === "wdtt" || wdttOn(node, iface) || isWdttIface(iface)) return "wdtt";
  if (type === "csqtt" || csqttOn(node, iface) || isCsqttIface(iface)) return "csqtt";
  const m = (Store.describe[node] || {})[iface];
  if (m && (m.tool === "wg" || m.tool === "awg")) return m.tool;
  if (m) return (m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg";
  return (String(type || "wg").toLowerCase() === "awg") ? "awg" : "wg";
}
export const awgDict3 = a => !!(a && String(a.HeaderProtectionKey || "").trim());
export function awg31No(nrec, iface) {
  const us = (nrec || {}).awg31_no_us;
  return (us && Object.prototype.hasOwnProperty.call(us, iface)) ? us[iface] : ((nrec || {}).awg31_no || null);
}
export function awgGen(node, iface) {
  const m = (Store.describe[node] || {})[iface], a = m && m.awg_params;
  return (a && Object.keys(a).length) ? (awgDict3(a) ? "3.1" : "2.0") : null;
}
export const tip3 = (on, id) => on ? { title: T("AmneziaWG 3.1"), key: "awg3" + (id ? ":" + id : "") } : {};
export const awg3Cls = (node, iface) => awgGen(node, iface) === "3.1" ? " awg3" : "";
export const awg3Tip = (node, iface) => tip3(awgGen(node, iface) === "3.1", node + "|" + iface);
export function awgGenPending(node, iface) {
  const m = (Store.describe[node] || {})[iface];
  if (!m || !m.awg_reported || !m.awg_params) return null;
  const want = awgDict3(m.awg_params);
  return want === awgDict3(m.awg_reported) ? null : (want ? "3.1" : "2.0");
}
export const kindLabel = (kind, runtime) => (kind === "docker" && runtime === "podman")
  ? T("kind|podman")
  : (({ docker: T("kind|docker"), baremetal: T("kind|bare-metal") })[kind] || kind || "");

const PLATFORM_NAMES = {
  nixos: "NixOS", ubuntu: "Ubuntu", debian: "Debian", fedora: "Fedora", arch: "Arch", alpine: "Alpine",
  centos: "CentOS", rhel: "RHEL", rocky: "Rocky", almalinux: "AlmaLinux", opensuse: "openSUSE",
  "opensuse-leap": "openSUSE Leap", "opensuse-tumbleweed": "openSUSE Tumbleweed", sles: "SLES",
  raspbian: "Raspberry Pi OS", devuan: "Devuan", gentoo: "Gentoo", void: "Void", manjaro: "Manjaro",
  linuxmint: "Linux Mint", pop: "Pop!_OS", kali: "Kali", amzn: "Amazon Linux", ol: "Oracle Linux",
  freebsd: "FreeBSD", openwrt: "OpenWrt", talos: "Talos",
};
export const platformLabel = p => PLATFORM_NAMES[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : "");

export const iTypeOf = (node, iface) => kindOf(node, iface, null);
export const targetType = t => t ? kindOf(t.node, t.iface, t.type) : "wg";
export const P2P_PORTOK_DEFAULT = ["1194", "3478-3481", "4500", "5222-5223", "5349", "8801-8810", "19302-19309", "27000-27200", "51820"];
export const PORTOK_WIDE = 1000;
export function portokRead(text) {
  const bad = portsToks(text).filter(t => portsClean("both", t).bad);
  const r = portsClean("both", text == null ? "" : String(text));
  const list = r.list ? r.list.split(",") : [];
  const sp = r.list ? (portsSpans({ proto: "both", list: r.list }) || [])[1] || [] : [];
  const ports = sp.reduce((n, [a, b]) => n + Math.max(0, b - Math.max(a, 1024) + 1), 0);
  return { list, bad, tooMany: r.bad === "too_many", ports };
}
export const portokSame = (a, b) => (a || []).join(",") === (b || []).join(",");

export const routerCapable = p => !!p && (p.router === true || (p.targets || []).some(t => ["wg", "awg"].includes(targetType(t))));
export const candDialPort = cd => {
  const l = ((cd || {}).wdtt || {}).listen;
  const p = l ? Number(String(l).split(":").pop()) : 0;
  return p || (cd || {}).listen_port || 0;
};
export function ifaceIsAwg(iface) {
  for (const n of Object.keys(Store.describe || {})) { const m = (Store.describe[n] || {})[iface]; if (m && Object.keys(m.awg_params || {}).length) return true; }
  return false;
}
export const ifaceIsAll = v => !v || v === "*" || v === "*awg" || v === "*wg" || v === "*wdtt" || v === "*csqtt";
export function ifaceMatch(iface, filter, t) {
  if (!filter || filter === "*") return true;
  const sc = t ? (kind => kind === "wdtt" || kind === "csqtt" ? kind : null)(targetType(t)) : scKindByName(iface);
  if (filter === "*wdtt") return sc === "wdtt";
  if (filter === "*csqtt") return sc === "csqtt";
  const awg = t ? targetType(t) === "awg" : ifaceIsAwg(iface);
  if (filter === "*awg") return awg && !sc;
  if (filter === "*wg") return !awg && !sc;
  return iface === filter;
}

export function turnProxiesFor(node, iface) {
  const snap = Store.stats[node]; if (!snap) return [];
  const lp = String((((snap.interfaces || {})[iface] || {}).meta || {}).listen_port || "");
  return (snap.turn_proxies || []).filter(tp => lp && portOf(tp.connect) === lp);
}
export function nodeStale(node) { return Store.recon.nodeStatus[node] !== "live"; }

export function nodeStatusOf(n) {
  const st = (n || {}).status || "dangling";
  const live = Store.recon.nodeStatus[(n || {}).id];
  return (live && (st === "online" || st === "offline")) ? (live === "live" ? "online" : "offline") : st;
}

export function lastHeard(nrec, snap) {
  const ls = (nrec || {}).last_seen;
  return Number.isFinite(ls) ? ls : ((snap || {}).generated_at || null);
}

export function peerUncategorised(t) {
  const ip = String((t && t.ip) || "").split("/")[0];
  const nrec = (Store.nodes || []).find(n => n.id === t.node) || {};
  return !!ip && Object.prototype.hasOwnProperty.call(nrec.doh_peers || {}, ip);
}
export function ifaceNotUp(node, ifn) { const s = (((Store.stats[node] || {}).interfaces) || {})[ifn] || {}; return !!s.down || !!s.stopped; }
export function turnLooping(tp) { return !!(tp && tp.flapping && !tp.stopped); }
export function turnDown(tp) { return !!tp && (tp.running === false || turnLooping(tp)); }
export function turnLoopMins(tp) { return Math.max(1, Math.ceil(((tp && tp.flapping_for) || 0) / 60)); }

export function ghostIface(node, iface) {
  const nr = (Store.nodes || []).find(n => n.id === node) || {};
  const g = (nr.ghost_ifaces || {})[iface];
  if (g) return { cold: true, ripe: !!g.ripe, problemMs: g.problemMs || 0, subnet: null, reach: g.reach || null };
  const mi = (nr.missing_ifaces || {})[iface];
  if (mi && !mi.key_source) return { cold: false, ripe: !!mi.ripe, problemMs: mi.problemMs || 0,
                                     subnet: mi.subnet || null, listen_port: mi.listen_port || 0,
                                     mtu: mi.mtu || 0, awg_params: mi.awg_params || null,
                                     endpoint_host: mi.endpoint_host || "",
                                     dns: Array.isArray(mi.dns) ? mi.dns : null,
                                     keepalive: typeof mi.keepalive === "number" ? mi.keepalive : null,
                                     reach: mi.reach || null };
  return null;
}
export function ghostPeers(node, iface) {
  return (Store.recon.peers || []).filter(p => (p.targets || []).some(t => t.node === node && t.iface === iface));
}

export function pendingIf(node) {
  const pfx = node + "|", out = [];
  for (const k of Object.keys(Store.ifaceNew)) if (k.startsWith(pfx)) { const e = Store.ifaceNew[k]; out.push({ name: k.slice(pfx.length), subnet: e.subnet || "", port: e.port || "", type: e.type }); }
  return out;
}
export function pendingTurnPorts(node) {
  const pfx = node + "|", out = [];
  for (const k of Object.keys(Store.turnNew)) if (k.startsWith(pfx)) { const p = Number(portOf(Store.turnNew[k].listen)); if (p) out.push(p); }
  return out;
}
export function pendingWdttPorts(node) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const out = [];
  for (const w of Object.values(nrec.wdtt_cfg || {})) {
    if (!w) continue;
    const d = Number(String(w.listen || "").split(":").pop()); if (d) out.push(d);
    const g = Number(w.wg_port); if (g) out.push(g);
  }
  return out;
}
export function pendingCsqttPorts(node) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const out = [];
  for (const c of Object.values(nrec.csqtt_cfg || {})) {
    if (!c) continue;
    const d = Number(String(c.listen || "").split(":").pop()); if (d) out.push(d);
  }
  return out;
}
export function suggestPort(node, kind, extra) {
  const snap = Store.stats[node] || {};
  const ifacePorts = Object.values(snap.interfaces || {}).map(b => Number((b.meta || {}).listen_port)).filter(Boolean)
    .concat(pendingIf(node).map(p => Number(p.port)).filter(Boolean));
  const turnPorts = ((snap.turn_proxies) || []).map(t => Number(portOf(t.listen))).filter(Boolean)
    .concat(pendingTurnPorts(node));
  const wdttPorts = (snap.wdtt || []).flatMap(w => w ? [Number(String(w.listen || "").split(":").pop()), Number(w.wg_port)] : []).filter(Boolean);
  const csqttPorts = (snap.csqtt || []).map(c => c ? Number(String(c.listen || "").split(":").pop()) : 0).filter(Boolean);
  const used = new Set([...ifacePorts, ...turnPorts, ...wdttPorts, ...pendingWdttPorts(node), ...csqttPorts, ...pendingCsqttPorts(node), ...dialinPorts(node).map(x => x[1]), ...(extra || []).map(Number).filter(Boolean)]);
  const mine = kind === "turn" ? turnPorts : ifacePorts;
  const reserved = new Set([51820, 56000, 56001, 56003]);
  const _rsv = (Store.panelSettings || {}).reserved || {};
  const _mBase = Number(_rsv.mesh_port_base) || 9999, _mSpan = Number(_rsv.port_span) || 100;
  const inMesh = q => q >= _mBase && q < _mBase + _mSpan;
  const mineUser = mine.filter(q => !inMesh(q));
  let p = mineUser.length ? Math.max(...mineUser) + 1 : (kind === "turn" ? 56002 : 51821);
  while ((used.has(p) || reserved.has(p) || inMesh(p) || (p >= 20000 && p <= 29999)) && p < 65535) p++;
  return p;
}
const dialinPorts = node => (((Store.nodes || []).find(n => n.id === node) || {}).exits || [])
  .filter(x => x && x.provider === "profile" && x.profile && x.profile.listen_port && !x.profile.endpoint)
  .map(x => [x, Number(x.profile.listen_port)]);
export function portHolder(node, port, own) {
  const p = Number(port); if (!p) return null;
  const skip = new Set((own || []).map(Number).filter(Boolean));
  if (skip.has(p)) return null;
  const snap = Store.stats[node] || {};
  for (const [ifn, b] of Object.entries(snap.interfaces || {})) if (Number((b.meta || {}).listen_port) === p) return ifn;
  for (const t of ((snap.turn_proxies) || [])) if (Number(portOf(t.listen)) === p) return (t.service || T("a turn-proxy"));
  for (const w of (snap.wdtt || [])) {
    if (!w) continue;
    if (Number(String(w.listen || "").split(":").pop()) === p) return (w.iface || T("a WDTT proxy")) + T(" (WDTT)");
    if (Number(w.wg_port) === p) return (w.iface || T("a WDTT proxy")) + T(" (WDTT internal WG)");
  }
  for (const c of (snap.csqtt || [])) {
    if (!c) continue;
    if (Number(String(c.listen || "").split(":").pop()) === p) return (c.iface || T("a csqtt proxy")) + T(" (CSQTT)");
  }
  for (const pt of pendingIf(node)) if (Number(pt.port) === p) return (pt.name || T("a pending interface"));
  for (const [x, q] of dialinPorts(node)) if (q === p) return T("the dial-in exit {v1}", { v1: x.label || x.device || "" });
  const _nrec = (Store.nodes || []).find(n => n.id === node) || {};
  for (const [ifn, w] of Object.entries(_nrec.wdtt_cfg || {})) {
    if (!w) continue;
    if ((snap.wdtt || []).some(x => x && x.iface === ifn)) continue;
    if (Number(String(w.listen || "").split(":").pop()) === p) return (ifn || T("a WDTT proxy")) + T(" (WDTT, starting)");
    if (Number(w.wg_port) === p) return (ifn || T("a WDTT proxy")) + T(" (WDTT internal WG, starting)");
  }
  for (const [ifn, c] of Object.entries(_nrec.csqtt_cfg || {})) {
    if (!c) continue;
    if ((snap.csqtt || []).some(x => x && x.iface === ifn)) continue;
    if (Number(String(c.listen || "").split(":").pop()) === p) return (ifn || T("a csqtt proxy")) + T(" (CSQTT, starting)");
  }
  return null;
}
export function portErrMsg(node, port, own) {
  const s = String(port == null ? "" : port).trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return T("Port must be a number.");
  const n = Number(s);
  if (n < 1 || n > 65535) return T("Port must be between 1 and 65535.");
  const h = portHolder(node, n, own);
  return h ? T("Port {port} is already used by {holder} on this node.", { port: n, holder: h }) : null;
}
export function suggestIface(node, proto) {
  const names = Object.keys((Store.stats[node] || {}).interfaces || {}).concat(pendingIf(node).map(p => p.name));
  const base = proto === "wg" ? "wg" : "awg";
  let hi = 0;
  for (const n of names) { const m = /(\d+)$/.exec(n); if (m) hi = Math.max(hi, Number(m[1])); }
  let i = hi + 1;
  while (names.includes(base + i)) i++;
  return base + i;
}
export function cidrNet(cidr) {
  const parts = String(cidr || "").split("/"); const pfx = parseInt(parts[1], 10);
  const oct = String(parts[0]).split(".").map(n => parseInt(n, 10));
  if (oct.length !== 4 || oct.some(n => isNaN(n) || n < 0 || n > 255) || isNaN(pfx) || pfx < 0 || pfx > 32) return null;
  const ipInt = ((oct[0] << 24) >>> 0) + ((oct[1] << 16) >>> 0) + ((oct[2] << 8) >>> 0) + oct[3];
  const mask = pfx === 0 ? 0 : (0xFFFFFFFF << (32 - pfx)) >>> 0;
  return { net: (ipInt & mask) >>> 0, pfx };
}
export function subnetsOverlap(a, b) {
  const A = cidrNet(a), B = cidrNet(b); if (!A || !B) return false;
  const m = Math.min(A.pfx, B.pfx); const mask = m === 0 ? 0 : (0xFFFFFFFF << (32 - m)) >>> 0;
  return ((A.net & mask) >>> 0) === ((B.net & mask) >>> 0);
}
export function fleetSubnets(skipNode, skipIface) {
  const out = [];
  for (const nid of Object.keys(Store.describe || {})) {
    const meta = Store.describe[nid] || {};
    for (const ifn in meta) { const m = meta[ifn]; if (!m || m.system || (nid === skipNode && ifn === skipIface)) continue; if (m.subnet) out.push({ node: nid, iface: ifn, subnet: m.subnet }); }
  }
  for (const nid of Object.keys(Store.stats || {})) {
    for (const w of ((Store.stats[nid] || {}).wdtt || [])) { if (!w || !w.iface || (nid === skipNode && w.iface === skipIface)) continue; if (w.wg_addr) out.push({ node: nid, iface: w.iface, subnet: w.wg_addr }); }
    for (const c of ((Store.stats[nid] || {}).csqtt || [])) { if (!c || !c.iface || (nid === skipNode && c.iface === skipIface)) continue; if (c.tun_addr) out.push({ node: nid, iface: c.iface, subnet: c.tun_addr }); }
  }
  for (const nrec of (Store.nodes || [])) {
    const nid = nrec.id; if (!nid) continue;
    const reported = new Set(((Store.stats[nid] || {}).csqtt || []).map(c => c && c.iface).filter(Boolean));
    for (const [ifn, c] of Object.entries(nrec.csqtt_cfg || {})) {
      if (!c || reported.has(ifn) || (nid === skipNode && ifn === skipIface)) continue;
      if (c.tun_addr) out.push({ node: nid, iface: ifn, subnet: c.tun_addr });
    }
  }
  return out;
}
export function subnetFleetConflict(subnet, skipNode, skipIface) {
  if (!subnet || !cidrNet(subnet)) return null;
  for (const s of fleetSubnets(skipNode, skipIface)) if (subnetsOverlap(subnet, s.subnet)) return s;
  return null;
}
export function subnetServerAddr(subnet) {
  const c = cidrNet(subnet); if (!c) return subnet;
  const ip = (c.net + 1) >>> 0;
  return [(ip >>> 24) & 255, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join(".") + "/" + c.pfx;
}
export function suggestSubnet(node) {
  const used = new Set();
  for (const s of fleetSubnets(null, null)) { const m = /^10\.(\d{1,3})\./.exec(s.subnet || ""); if (m) used.add(Number(m[1])); }
  for (const p of pendingIf(node)) { const m = /^10\.(\d{1,3})\./.exec(p.subnet || ""); if (m) used.add(Number(m[1])); }
  for (let i = 8; i < 255; i++) if (i !== 255 && !used.has(i)) return "10." + i + ".0.0/24";
  return "10.8.0.0/24";
}

export function nextWdttName(node) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const used = new Set([...Object.keys(nrec.wdtt_cfg || {}),
                        ...((Store.stats[node] || {}).wdtt || []).map(w => w && w.iface),
                        ...Object.keys(Store.describe[node] || {}),
                        ...Object.keys(nrec.missing_ifaces || {}), ...Object.keys(nrec.ghost_ifaces || {}),
                        ...(nrec.iface_candidates || []).map(c => c && c.name)].filter(Boolean));
  for (let i = 1; i < 1000; i++) if (!used.has("wdtt" + i)) return "wdtt" + i;
  return "wdtt1";
}
export function nextCsqttName(node) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const used = new Set([...Object.keys(nrec.csqtt_cfg || {}),
                        ...((Store.stats[node] || {}).csqtt || []).map(c => c && c.iface),
                        ...Object.keys(nrec.wdtt_cfg || {}),
                        ...((Store.stats[node] || {}).wdtt || []).map(w => w && w.iface),
                        ...(nrec.csqtt_candidates || []).map(c => c && c.iface),
                        ...Object.keys(Store.describe[node] || {}),
                        ...Object.keys(nrec.missing_ifaces || {}), ...Object.keys(nrec.ghost_ifaces || {}),
                        ...(nrec.iface_candidates || []).map(c => c && c.name)].filter(Boolean));
  for (let i = 1; i < 10000; i++) if (!used.has("csqtt" + i)) return "csqtt" + i;
  return "csqtt1";
}

export function turnIfaceNameError(node, name, kind) {
  const nm = String(name || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,14}$/.test(nm))
    return T("Name: letters, digits, - and _ (max 15, starting with a letter or digit).");
  if (/^swg_/.test(nm)) return T("Names starting with swg_ are reserved for system mesh links.");
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const other = kind === "wdtt" ? "csqtt" : "wdtt";
  if ((nrec[other + "_cfg"] || {})[nm]) return T("{v1} is already a {v2} instance on this node.", { v1: nm, v2: other.toUpperCase() });
  if ((nrec[kind + "_cfg"] || {})[nm]) return "";
  if ((Store.describe[node] || {})[nm]) return T("{v1} is already a WireGuard interface on this node.", { v1: nm });
  return "";
}

export const SUB_SOURCES = ["wg", "awg", "wdtt", "csqtt", "turn"];
export function peerSubSources(peer) {
  const out = [];
  for (const t of (peer && peer.targets) || []) {
    const ty = targetType(t);
    if (!out.includes(ty)) out.push(ty);
    if (ty === "wdtt" || ty === "csqtt" || out.includes("turn")) continue;
    if (turnProxiesFor(t.node, t.iface).length) out.push("turn");
  }
  return SUB_SOURCES.filter(s => out.includes(s));
}
export const subHidden = peer => ((peer && peer.sub_hide) || []).filter(s => SUB_SOURCES.includes(s));
export const subHides = (peer, src) => subHidden(peer).includes(src);

export const tgtXfer = t => (t && (t.observed || t.kwXfer)) || null;
export const tgtSeenAge = t => (t && t.observed) ? t.observed.handshake_age : ((t && t.kwXfer && t.online) ? 0 : null);
