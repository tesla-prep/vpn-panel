import { classify, classifyAll, patternTier } from "./classify.js";
import { idnHost } from "./idn.js";

let _gidSeq = 0;
export const newGid = () => "rg" + (++_gidSeq);

const isCatchAll = r => r && r.category === "all";
const isLegacy = r => !!(r && (r.match || r.tlds));
const rowKey = r => [r.action || "exit",
                     r.action === "exit" ? (r.node || "") : r.action === "dev" ? (r.exit_id || "") : "",
                     ruleOn(r) ? 1 : 0].join("|") + (r.who ? "|" + JSON.stringify(canonWho(r.who)) : "")
                     + (r.aud ? "|aud:" + r.aud : "")
                     + ptKey(r);

const ruleOn = r => r && r.ports && typeof r.ports === "object" ? r.ports.on === true
  : r && r.who && typeof r.who === "object" ? r.who.on === true : !!r && r.enabled !== false;

export const PORTS_MAX_TOKENS = 32;
export const portsToks = raw => String(raw || "").replace(/\u2013/g, "-").split(/[, \t\r\n\u00a0]+/).filter(Boolean);
export function portsClean(proto, raw) {
  if (!["tcp", "udp", "both"].includes(proto)) return { bad: "proto" };
  if (raw != null && typeof raw !== "string") return { bad: "list" };
  const toks = portsToks(raw);
  if (toks.length > PORTS_MAX_TOKENS) return { bad: "too_many" };
  const spans = [];
  for (const t of toks) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(t);
    if (!m) return { bad: "list" };
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    if (!(a >= 1 && a <= b && b <= 65535)) return { bad: "list" };
    spans.push([a, b]);
  }
  if (!spans.length && proto === "both") return { bad: "empty" };
  spans.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out = [];
  for (const [a, b] of spans) {
    if (out.length && a <= out[out.length - 1][1] + 1) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  return { proto, list: out.map(([a, b]) => a === b ? String(a) : a + "-" + b).join(",") };
}
export const portsOf = r => r && r.ports && typeof r.ports === "object" ? (({ on, ...p }) => p)(r.ports) : null;
const ptKey = r => { const p = portsOf(r); return p ? "|pt:" + p.proto + ":" + p.list : ""; };
export const portsSpans = p => { const c = portsClean(p && p.proto, p && p.list);
  return c.bad ? null : [c.proto, c.list ? c.list.split(",").map(t => { const [a, b] = t.split("-").map(Number); return [a, b || a]; }) : []]; };
export function portsCover(a, b) {
  if (!a) return true;
  const A = portsSpans(a);
  if (!A) return false;
  if (!b) return false;
  const B = portsSpans(b);
  return !!B && (A[0] === "both" || A[0] === B[0]) && (!A[1].length || (B[1].length > 0
    && B[1].every(([lo, hi]) => A[1].some(([x, y]) => x <= lo && hi <= y))));
}
export const portsReach = (p, pr, n) => !p || ((p.proto === "both" || p.proto === pr)
  && (!p.list || p.list.split(",").some(t => { const [a, b] = t.split("-").map(Number); return a <= n && n <= (b || a); })));
const whoList = v => Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
export const canonWho = w => ({ users: [...new Set(whoList(w && w.users))].sort(), groups: [...new Set(whoList(w && w.groups))].sort(),
                                peers: [...new Set(whoList(w && w.peers))].sort() });
export const rowCovers = (a, b) => (!(a && a.aud) || a.aud === (b && b.aud))
  && (!(a && a.who) || (!!(b && b.who) && JSON.stringify(canonWho(a.who)) === JSON.stringify(canonWho(b.who))));

export function rowLints(rows, destOf, opts = {}) {
  const mode = opts.mode || "", shadowEng = mode === "sni" || mode === "forcedns";
  const isName = opts.isName || (b => b.t === "list" || (b.kind !== "ip" && b.kind !== "asn"));
  const typedKey = r => (r.badges || []).filter(b => b.t === "target").map(badgeIdentity).sort().join("\n");
  const sameSrc = (a, b) => !a.who === !b.who && (!a.who || JSON.stringify(canonWho(a.who)) === JSON.stringify(canonWho(b.who)));
  const seen = new Map();
  return (rows || []).map((row, ri) => {
    const badges = row.badges || [];
    const dupes = [];
    const pj = portsOf(row), pk = ptKey(row);
    const ups = pj ? rows.slice(0, ri).filter(up => destOf(up) !== destOf(row) && rowCovers(up, row)) : [];
    const dead = b => ups.some(up => {
      const pu = portsOf(up);
      if (!portsCover(pu, pj)) return false;
      if (mode === "sni" && up.action === "block" && isName(b)) return false;
      return (up.badges || []).some(ub => badgeIdentity(ub) === badgeIdentity(b)
        ? !(!pu && sameSrc(up, row) && (b.t === "list" || typedKey(up) === typedKey(row)))
        : badgeCovers(ub, b) && !(shadowEng && portsCover(pj, pu)));
    });
    for (const b of badges) {
      const k = badgeIdentity(b) + pk, held = seen.get(k) || [];
      if (held.some(e => rowCovers(e, row)) || (pj && dead(b))) dupes.push(b);
      seen.set(k, [...held, row]);
    }
    const taken = new Map();
    for (const lower of rows.slice(ri + 1)) {
      if (destOf(lower) === destOf(row)) continue;
      if (portsOf(lower) && !(pj && shadowEng && portsCover(portsOf(lower), pj))) continue;
      const all = rowCovers(lower, row);
      if (!all && (row.who || row.aud)) continue;
      for (const nb of lower.badges || []) {
        if (!badges.some(b => badgeCovers(b, nb))) continue;
        const k = badgeIdentity(nb), t = taken.get(k);
        taken.set(k, { b: t ? t.b : nb, all: (t && t.all) || all });
      }
    }
    const tv = [...taken.values()];
    return { dupes, takenBy: tv.filter(t => t.all).map(t => t.b), takenFew: tv.filter(t => !t.all).map(t => t.b) };
  });
}

function badgesOf(rule) {
  if (rule.category !== "custom") return [{ t: "list", id: rule.category }];
  if (rule.targets != null) return classifyAll(rule.targets).map(x => ({ t: "target", ...x }));
  return [...(rule.domains || []), ...(rule.cidrs || []), ...(rule.asns || []), ...(rule.patterns || [])]
    .map(raw => ({ t: "target", raw, ...classify(raw) }));
}

export function rulesToRows(rules) {
  const rows = [];
  let catchAll = null;
  for (const rule of (rules || [])) {
    if (!rule || typeof rule !== "object") continue;
    if (isCatchAll(rule)) { if (!catchAll && ruleOn(rule)) catchAll = rule; continue; }
    if (isLegacy(rule)) {
      rows.push({ _gid: newGid(), enabled: rule.enabled !== false, action: rule.action || "exit",
                  node: rule.node || "", exit_id: rule.exit_id || "", locked: true, legacy: rule,
                  badges: (rule.tlds || []).map(t => ({ t: "target", raw: "*." + t, ...classify("*." + t) })) });
      continue;
    }
    const key = rowKey(rule);
    const last = rows[rows.length - 1];
    if (last && !last.locked && last._key === key) { last.badges.push(...badgesOf(rule)); continue; }
    rows.push({ _gid: newGid(), _key: key, enabled: ruleOn(rule), action: rule.action || "exit",
                node: rule.action === "exit" ? (rule.node || "") : "",
                exit_id: rule.action === "dev" ? (rule.exit_id || "") : "", badges: badgesOf(rule),
                ...(rule.who && typeof rule.who === "object" ? { who: canonWho(rule.who) } : {}),
                ...(portsOf(rule) ? { ports: portsOf(rule) } : {}),
                ...(rule.aud === "local" || rule.aud === "cascaded" ? { aud: rule.aud } : {}) });
  }
  return { rows, catchAll };
}

export function rowsToRules(rows, catchAll) {
  const out = [];
  for (const row of (rows || [])) {
    if (!row) continue;
    if (row.legacy) { out.push(row.legacy); continue; }
    const badges = row.badges || [];
    if (!badges.length) continue;
    const base = { enabled: row.enabled !== false, action: row.action || "exit" };
    if (base.action === "exit") base.node = row.node || "";
    if (base.action === "dev") base.exit_id = row.exit_id || "";
    if (row.who) { base.who = { on: base.enabled, ...canonWho(row.who) }; base.enabled = false; }
    if (row.aud === "local" || row.aud === "cascaded") base.aud = row.aud;
    if (portsOf(row)) { base.ports = { on: row.enabled !== false, ...portsOf(row) }; base.enabled = false; if (base.who) base.who.on = false; }
    for (const b of badges) if (b.t === "list") out.push({ ...base, category: b.id });
    const typed = badges.filter(b => b.t === "target");
    if (typed.length) out.push({ ...base, category: "custom", targets: typed.map(b => b.raw).join(", ") });
  }
  if (catchAll) out.push(catchAll);
  return out;
}

export const badgeIdentity = b => b.t === "list" ? "list:" + b.id : "target:" + b.kind + ":" + b.value;

export const badgeText = b => b.t === "list" ? badgeIdentity(b) : idnHost(b.raw);

export function readToken(tok, opts) {
  const allowKind = (opts && opts.allowKind) || (() => true);
  const knownList = (opts && opts.knownList) || (() => true);
  const t = String(tok || "").trim();
  if (!t) return null;
  const m = /^list:(.+)$/i.exec(t);
  if (m) { const id = m[1].trim();
    if (id.toLowerCase() === "all") return { bad: t, why: "catch_all" };
    return knownList(id) ? { b: { t: "list", id } } : { bad: t, why: "unknown_list" }; }
  const c = classify(t);
  if (c.kind === "invalid" || !allowKind(c.kind)) return { bad: t, why: "target" };
  return { b: { t: "target", raw: t, kind: c.kind, value: c.value } };
}

const _SFX = { site: 1, zone: 1 };
export function badgeCovers(broad, narrow) {
  if (broad.t === "list" || narrow.t === "list") return false;
  if (badgeIdentity(broad) === badgeIdentity(narrow)) return false;
  const B = String(broad.value || ""), N = String(narrow.value || "");
  const bk = _SFX[broad.kind] ? "sfx" : broad.kind, nk = _SFX[narrow.kind] ? "sfx" : narrow.kind;
  if (!B || !N) return false;
  switch (bk) {
    case "contains":
      return nk === "sfx" || nk === "first" || nk === "any" ? N.includes(B)
           : nk === "starts" || nk === "ends" || nk === "contains" ? N.includes(B) : false;
    case "ends":
      return (nk === "sfx" || nk === "ends") && N.endsWith(B);
    case "starts":
      return (nk === "first" || nk === "starts") && N.startsWith(B);
    case "any":
      return nk === "sfx" ? N.split(".").includes(B) : nk === "first" ? N === B : false;
    case "sfx":
      return nk === "sfx" && N.endsWith("." + B);
    default:
      return false;
  }
}

export const rowHasBadge = (row, badge) =>
  (row.badges || []).some(b => badgeIdentity(b) === badgeIdentity(badge));


export const customTargets = l => (typeof l === "string") ? l
  : (l && (l.targets ?? [...(l.domains || []), ...(l.cidrs || []), ...(l.asns || []), ...(l.patterns || [])].join(", "))) || "";

const _bucketMemo = new WeakMap();
export function listBuckets(l) {
  const raw = customTargets(l);
  if (l && typeof l === "object") {
    const hit = _bucketMemo.get(l);
    if (hit && hit.raw === raw) return hit.v;
    const v = _bucketsOf(raw);
    _bucketMemo.set(l, { raw, v });
    return v;
  }
  return _bucketsOf(raw);
}
function _bucketsOf(raw) {
  const host = [], ip = [], pat = [], seenKey = new Set();
  let t2 = 0;
  for (const c of classifyAll(raw)) {
    const k = c.kind + ":" + c.value;
    if (seenKey.has(k)) continue;
    seenKey.add(k);
    if (c.kind === "site") host.push(c.raw);
    else if (c.kind === "ip" || c.kind === "asn") ip.push(c.raw);
    else if (patternTier(c.kind) > 0) { pat.push(c.raw); if (patternTier(c.kind) === 2) t2++; }
  }
  return { host, ip, pat, t2 };
}

export function customCaps(l) {
  const b = listBuckets(l);
  return { host: b.host.length + b.pat.length > 0, ip: b.ip.length > 0 };
}

export const TIER2_CAP = 100;

export const listTier2 = list => listBuckets(list).t2;

export const tier2Count = (rows, lookupList) => (rows || []).reduce((n, r) =>
  n + (r.badges || []).reduce((m, b) => m + (b.t === "list" ? listTier2(lookupList ? lookupList(b.id) : null)
                                           : (b.t === "target" && patternTier(b.kind) === 2 ? 1 : 0)), 0), 0);

export function adoptRows(held, rules, live) {
  const same = h => JSON.stringify(rowsToRules(h.rows, h.catchAll)) === JSON.stringify(rules || []);
  if (held && same(held)) return held;
  const gone = x => x && x.action === "dev" && !(live && live.has(String(x.exit_id || "")));
  if (held) {
    const pr = { rows: (held.rows || []).map(r => gone(r) ? { ...r, action: "direct", exit_id: "" } : r),
                 catchAll: gone(held.catchAll) ? (({ exit_id, ...x }) => ({ ...x, action: "direct" }))(held.catchAll) : held.catchAll };
    if (same(pr)) return pr;
  }
  const { rows, catchAll } = rulesToRows(rules || []);
  for (const r of rows) for (const b of (r.badges || [])) b.stored = true;
  return { rows, catchAll };
}
