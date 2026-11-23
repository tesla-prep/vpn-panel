import { T, Trich, Tsplit, plural, pluralWord, srvText, fmtNum } from "./i18n.js";
import { classify, classifyAll, patternTier, TIER2_MIN } from "./classify.js";
import { idnHost, idnDiffers } from "./idn.js";
import { rulesToRows, rowsToRules, badgeIdentity, rowHasBadge, newGid,
         badgeText, readToken as rrReadToken,
         customTargets, customCaps, listBuckets, TIER2_CAP, listTier2, tier2Count, canonWho, rowLints, badgeCovers, newRuleRowId,
         portsClean, portsOf, portsReach, rowCovers } from "./rulerows.js";
import { esc, seen, isMobile } from "./util.js";
import { isSelfContainedName, nodeStale, nodeStatusOf, kindOf, awgGen } from "./model.js";
import { meshHealth, deviceLabel } from "./views.js";
import { UserPicker } from "./peer-actions.js";
import { Store, api, bus, useStore } from "./store.js";
import { pickThemed } from "./theme.js";
import { Ic, Tag, Panel, Switch, Dropdown, Disclosure, autoGrow, Sheet, footRow, secTitle, SearchBox,
         Popover, Portal, toast, openModal, pushModal, closeModal, closeAllModals, openConfirm, goSettings,
         useReorder, GRIP_SVG, NodeIpPick, ConfirmPhrase, CapList, ListPager, LIST_PAGE, pageSlice, ifaceColor } from "./ui.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export const CAT_UNCAT_COLOR = "#8A94A6";
export function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => { const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return Math.round(255 * c).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
}
export const dashRankColor = (i, kind) => kind === "talker" ? hsl2hex((205 + i * 137.508) % 360, 68, 62) : hsl2hex((32 + i * 137.508) % 360, 58, 55);
export const capFirst = s => (typeof s === "string" && s && !/[A-Z]/.test(s)) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export const isBlockCat = c => /^blku?[_:]/i.test(String(c));
export function catLabelOf(c) {
  if (c === "uncat") return T("Uncategorised");
  if (c === "all") return T("All traffic (catch-all)");
  const lt = {};
  (Store.panelSettings?.custom_lists || []).forEach(l => { if (l && l.title) { if (l.id) lt[l.id] = l.title; if (l.name) lt[l.name] = l.title; } });
  if (isProviderCat(c)) return capFirst(prettyCatLabel(c, (Store.catLabels || {})[c]));
  return capFirst((Store.catLabels || {})[c] || lt[c] || (String(c).startsWith("custom") ? T("Custom") : c));
}
export const capBadges = caps => caps && (caps.host || caps.ip) ? html`<span class="capbs">
  ${caps.host ? html`<span class="capb host" title=${T("Matchable by domain — needs Force-DNS or SNI mode")}>${T("Domains")}</span>` : null}
  ${caps.ip ? html`<span class="capb ip" title=${T("Matchable by IP range — works in every mode")}>${T("IP networks")}</span>` : null}</span>` : null;
export const isProviderCat = c => typeof c === "string" && c.includes(":") && !String(c).startsWith("custom");
export const providerOf = c => isProviderCat(c) ? c.split(":", 1)[0] : "";

export function reportDropped(r) {
  const rep = ((r && r.data) || {}).dropped || {};
  const list = rep.entries || [];
  const total = rep.total || list.length;
  if (!list.length) return;
  const parts = list.slice(0, 6).map(d => {
    const e = String((d && d.entry) || "");
    if ((d || {}).reason === "list_empty") return T("the list {v1} had nothing readable in it — not saved", { v1: e });
    if ((d || {}).reason === "id_reserved") return T("the list id {v1} already means something to a rule — the list was saved under a new id", { v1: e });
    if ((d || {}).reason !== "unknown_list") return T("{v1} couldn't be read", { v1: e });
    const prov = provLabelOf(e);
    return prov ? T("{v1} is no longer published by {v2}", { v1: catRawId(e), v2: prov })
                : T("{v1} is no longer a list the panel knows", { v1: e });
  });
  if (total > parts.length) parts.push(T("…and {v1} more", { v1: total - parts.length }));
  toast(T("Saved — {v1} not kept: {v2}", { v1: plural(total, "entry"), v2: parts.join("; ") }), "warn", 9000);
}

export function fleetRuleCats() {
  const out = {};
  for (const n of (Store.nodes || [])) {
    const s = new Set();
    for (const cats of Object.values(n.rule_cats || {}))
      for (const c of (cats || [])) if (isProviderCat(c)) s.add(c);
    out[n.id] = s;
  }
  return out;
}

export function providerUsage(pid) {
  const out = { rules: 0, ifaces: 0 };
  if (!pid) return out;
  for (const n of (Store.nodes || []))
    for (const cats of Object.values(n.rule_cats || {})) {
      const hits = (cats || []).filter(c => providerOf(c) === pid).length;
      if (hits) { out.rules += hits; out.ifaces++; }
    }
  return out;
}
const _REGION_NAMES = (() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } })();
const _titleize = s => String(s).replace(/[-_]+/g, " ").trim().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());
let _cat_friendly = null;
export const CAT_FRIENDLY = () => (_cat_friendly || (_cat_friendly = {
  meta: "Meta / Facebook", facebook: "Meta / Facebook", openai: "ChatGPT / OpenAI", twitter: "Twitter / X",
  xai: "Grok / xAI", grok: "Grok / xAI", anthropic: "Claude / Anthropic", claude: "Claude / Anthropic",
  gemini: T("Gemini (Google AI)"), perplexity: T("Perplexity AI"), deepseek: "DeepSeek", copilot: T("Microsoft Copilot"),
  google: "Google", youtube: "YouTube", netflix: "Netflix", telegram: "Telegram", whatsapp: "WhatsApp",
  instagram: "Instagram", tiktok: "TikTok", github: "GitHub", disney: "Disney+", spotify: "Spotify",
  twitch: "Twitch", reddit: "Reddit", discord: "Discord", vk: "VK", yandex: "Yandex", cloudflare: "Cloudflare",
  ru_gov: T("Russian Government"), ru_banks: T("Russian Banks"), ru_social: T("Russian Social (VK / OK)"),
  "rc:category-ru": T("Russian services"),
  "rc:whitelist": T("Direct access allowlist"),
  "runet:ru-available-only-inside": T("Only available from Russia"),
}));
export function prettyCatLabel(id, fallback) {
  const rid = catRawId(id);
  if (CAT_FRIENDLY()[id]) return CAT_FRIENDLY()[id];
  if (CAT_FRIENDLY()[rid.toLowerCase()]) return CAT_FRIENDLY()[rid.toLowerCase()];
  if (/^[a-z]{2}$/i.test(rid) && _REGION_NAMES) {
    try { const n = _REGION_NAMES.of(rid.toUpperCase()); if (n && n.toUpperCase() !== rid.toUpperCase()) return n; } catch (e) {}
  }
  let m;
  if ((m = rid.match(/^geolocation-(.+)$/))) return T("Geolocation: {v1}", { v1: prettyCatLabel(m[1], null) });
  if ((m = rid.match(/^category-(.+?)(-all)?$/))) return _titleize(m[1]) + (m[2] ? " (all)" : "");
  if ((m = rid.match(/^tld-(.+)$/))) return T("TLD .{v1}", { v1: m[1].toLowerCase() });
  return fallback || _titleize(rid) || rid;
}
export function catRawId(id) {
  const [prov, rid] = String(id || "").split(":");
  if (prov === "runet" && rid) return rid.replaceAll("--attr--", "@").replaceAll("--bang--", "!");
  return rid ?? prov;
}
let _cat_desc = null;
export const CAT_DESC = () => (_cat_desc || (_cat_desc = {
  google: T("Google search, accounts & core services"), youtube: T("YouTube video + its CDN"),
  netflix: T("Netflix streaming & app"), meta: T("Facebook, Instagram & WhatsApp"), facebook: T("Facebook, Instagram & WhatsApp"),
  telegram: T("Telegram messenger"), whatsapp: T("WhatsApp messenger"), instagram: "Instagram", twitter: "Twitter / X",
  openai: T("ChatGPT & the OpenAI API"), tiktok: T("TikTok video"), github: T("GitHub & its CDN"), disney: T("Disney+ streaming"),
  spotify: T("Spotify audio"), twitch: T("Twitch live streaming"), reddit: "Reddit", discord: T("Discord voice & chat"),
  cloudflare: T("Cloudflare CDN / edge network"), vk: T("VKontakte"), yandex: T("Yandex services"),
  ru_gov: T("Russian government sites"), ru_banks: T("Russian banks"), ru_social: T("Russian social (VK / OK)"),
  claude: T("Claude & the Anthropic API"), grok: T("Grok (xAI) — grok.com & x.ai"),
  gemini: T("Google Gemini AI — kept separate from the rest of Google"), copilot: T("Microsoft & GitHub Copilot"),
  signal: T("Signal private messenger"),
  "rf:domains_all": T("Domains blocked in Russia — the RKN registry, filtered"),
  "rf:community": T("Community list: sites RKN does not block that refuse visitors from Russia"),
  "rf:community_ips": T("Community list: networks RKN does not block that refuse addresses from Russia"),
  "rf:discord_ips": T("Discord's networks"),
  "rc:category-ru": T("Russian services and IP check sites"),
  "rc:whitelist": T("Russian services and sites for direct access"),
  "runet:ru-available-only-inside": T("Resources accessible only from Russia, including government sites"),
  "runet:ru-blocked": T("Resources blocked in Russia"),
  "runet:ru-blocked-all": T("Expanded list of resources blocked in Russia"),
  "runet:ru-whitelist": T("IP networks on the Russian mobile Internet allowlist"),
}));
export const catDescOf = id => CAT_DESC()[String(id || "").toLowerCase()] || CAT_DESC()[catRawId(id).toLowerCase()] || "";
export function catListUrl(id, caps) {
  const rid = catRawId(id), prov = String(id).includes(":") ? String(id).split(":")[0] : "";
  const host = !!(caps && caps.host);
  switch (prov) {
    case "mc": return "https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/" + (host ? "geosite" : "geoip") + "/" + rid + ".list";
    case "rf": return "https://github.com/1andrevich/Re-filter-lists/blob/main/" + rid + ".lst";
    case "rc": return "https://github.com/hydraponique/roscomvpn-geosite/blob/master/data/" + encodeURIComponent(rid);
    case "runet": {
      const encoded = encodeURIComponent(rid);
      if (!host) return "https://github.com/runetfreedom/russia-blocked-geoip/blob/release/text/" + encoded + ".txt";
      if (_CATALOG_BY_ID[id]?.host_text) return "https://github.com/runetfreedom/russia-blocked-geosite/blob/release/" + encoded + ".txt";
      return "https://github.com/runetfreedom/russia-v2ray-rules-dat/blob/release/sing-box/rule-set-geosite/geosite-" + encoded + ".srs";
    }
    default: return "";
  }
}
export const fmtCount = n => n == null ? "…" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
export function sizeSummary(host, ip, pat) {
  const p = [];
  if (host) p.push(plural(host, "host").replace(String(host), fmtCount(host)));
  if (ip) p.push(plural(ip, "net").replace(String(ip), fmtCount(ip)));
  if (pat) p.push(plural(pat, "pattern").replace(String(pat), fmtCount(pat)));
  return p.join(" · ");
}
const _LIST_INFO_CACHE = {};
export function ListInfo({ cat, list }) {
  let hostN = null, ipN = null;
  let patN = 0;
  if (list) { const b = listBuckets(list); hostN = b.host.length; ipN = b.ip.length; patN = b.pat.length; }
  else if (cat) { const s = (Store.catSizes || {})[cat] || {}; hostN = s.host; ipN = s.ip; }
  const summary = sizeSummary(hostN || 0, ipN || 0, patN);
  if (!summary) return null;
  return html`<span class="listsize">${summary}</span>`;
}

export function CatalogRow({ it, added, onPick, preview = true }) {
  const [fetched, setFetched] = useState(() => _LIST_INFO_CACHE[it.id] || null);
  const own = it.list, ownB = own ? listBuckets(own) : null;
  const ownDoms = ownB ? ownB.host : [], ownIps = ownB ? ownB.ip : [];
  const info = own ? { tiers: { ...(ownDoms.length ? { host: { n: ownDoms.length, sample: ownDoms.slice(0, 4) } } : {}),
                               ...(ownIps.length ? { ip: { n: ownIps.length, sample: ownIps.slice(0, 4) } } : {}) } }
                   : fetched;
  useEffect(() => {
    if (own || !preview || (it.provider === "runet" && it.caps.host && !it.host_text)) return;
    if (info && !(info.tiers && Object.keys(info.tiers).some(k => info.tiers[k] && info.tiers[k].pending))) return;
    let live = true;
    const t = setTimeout(() => askListInfo(it.id, () => live && setFetched(_LIST_INFO_CACHE[it.id] || null),
                                           { waitMs: LIST_ASK_MS, errOnGiveUp: false }), 250);
    return () => { live = false; clearTimeout(t); }; }, [it.id, preview]);
  const title = prettyCatLabel(it.id, it.label), rid = catRawId(it.id), desc = catDescOf(it.id);
  const hostD = info && info.tiers && info.tiers.host, ipD = info && info.tiers && info.tiers.ip;
  const summary = sizeSummary((hostD && hostD.n) || 0, (ipD && ipD.n) || 0);
  const samples = ((hostD && hostD.sample) || (ipD && ipD.sample) || []).slice(0, 4);
  const more = (((hostD && hostD.n) || (ipD && ipD.n) || 0) > samples.length);
  const anyFailed = info && info.tiers && Object.keys(info.tiers).some(t => info.tiers[t].failed);
  const anyPending = info && info.tiers && Object.keys(info.tiers).some(t => info.tiers[t].pending);
  const empty = info && !info.err && !summary && !samples.length && !anyFailed && !anyPending;
  const sub = desc || (samples.length ? "e.g. " + samples.join(", ") + (more ? "…" : "")
    : (!info || anyPending ? T("preparing…") : anyFailed ? T("couldn't load — will retry") : empty ? T("no routable records") : "—"));
  return html`<button type="button" class=${"catrow" + (added ? " sel" : "") + (empty ? " off" : "")} disabled=${empty} title=${empty ? T("This list has no routable records") : ""} onClick=${() => !empty && onPick(it.id)}>
    <span class=${"catpick-tick" + (added ? " on" : "")}>${added ? "✓" : ""}</span>
    <div class="catrow-main">
      <div class="catrow-l1"><span class="catrow-title">${title}</span>${rid.toLowerCase() !== title.toLowerCase() ? html`<span class="catrow-id">${rid}</span>` : null}${(it.id === "rf:domains_all") ? html`<span class="catrow-heavy" title=${T("Large list — noticeable memory / reload on any node that routes it")}>${T("tag|heavy")}</span>` : null}</div>
      ${sub ? html`<div class="catrow-l2">${desc ? html`<span class="catrow-desc">${desc}</span>` : null}${desc && samples.length ? html`<span class="catrow-eg"> · ${T("e.g. {v1}", { v1: samples.join(", ") + (more ? "…" : "") })}</span>` : (!desc ? html`<span class="catrow-eg">${sub}</span>` : null)}</div>` : null}
    </div>
    <div class="catrow-right">
      <${ProvTag} id=${it.id} label=${it.provider_label || provLabelOf(it.id)}/>${capBadges(it.caps)}${summary ? html`<span class="catrow-size">${summary}</span>` : null}
      ${catListUrl(it.id, it.caps) ? html`<a class="catrow-info" href=${catListUrl(it.id, it.caps)} target="_blank" rel="noopener" title=${T("View this list on GitHub")} onClick=${e => e.stopPropagation()}><${Ic} i="info"/></a>`
        : null}</div>
  </button>`;
}
export function provName(p) { return p.label || p.id; }
export function provLabelOf(c) {
  const pid = providerOf(c);
  if (!pid) return "";
  return provName((Store.catalogProviders || []).find(p => p.id === pid) || { id: pid });
}
export const CAT_PROVIDER_DEFAULTS = {
  mc: { color: "#5B8FF9", colorL: "#2C6FD6" },
  rf: { color: "#E8684A", colorL: "#C2452A" },
  rc: { color: "#C084FC", colorL: "#8550B4" },
  runet: { color: "#4DB995", colorL: "#137456" },
};
export function providerColor(prov) {
  const ov = (Store.panelSettings && Store.panelSettings.provider_colors) || {};
  const d = CAT_PROVIDER_DEFAULTS[prov] || (prov === "custom" ? { color: "#8A94A6", colorL: "#5E6875" } : { color: "#8FA8C0", colorL: "#5E7085" });
  return pickThemed(ov[prov], d.color, d.colorL);
}

export function ProvTag({ id, label, plain }) {
  const prov = providerOf(id) || (customListOf(id) ? "custom" : "");
  if (plain || !prov) return html`<span class="catpick-src legacy">${label}</span>`;
  return html`<span class="catpick-src" style=${"--pc:" + providerColor(prov)}>${label || provLabelOf(id)}</span>`;
}
function buildModeMeta() {
  const WINS = {
    order:    { card: T("First match — the order you set"),       label: T("— the first matching rule wins") },
    specific: { card: T("Most specific name; IP rules in order"), label: T("— IP rules in order, most specific hostname") },
  };
  const arb = k => ({ overlaps: WINS[k].card, winsLabel: WINS[k].label });
  return {
  kernel:   { icon: "globe",  label: T("Default routing"), short: T("IP only"), tag: T("no host layer"),
    adds: T("Just the always-on IP layer — no domain matching added"),
    bene: [T("Simplest & most robust · never touches DNS · carries all traffic (calls, UDP, QUIC)")],
    cost: T("Can't separate services that share IPs (YouTube vs Google), no Host routing"),
    block: { s: "−", t: T("Blocks by IP / threat-feed only — domain content filters can't apply") },
    exp: T("Matches by destination IP (GeoIP / ASN) — routing never depends on DNS, so your clients' DoH, DoT and plain DNS all keep working untouched. Simplest and most robust; it just can't separate services that share IPs (YouTube vs Google), and a CDN category catches everything behind it."),
    routes: T("IP ranges, networks (AS)"),
    ...arb("order"),
  },
  forcedns: { icon: "compass", label: T("Force-DNS"), short: T("Host via DNS"), tag: T("host layer · via DNS"),
    adds: T("Adds domain matching by resolving your clients' DNS through the node"),
    bene: [T("Per-service precise · fills before the first connection (no first-hit miss)")],
    cost: T("Intercepts & downgrades client DNS — a client on encrypted DNS is flagged, not blocked"),
    block: [{ s: "+", t: T("Enforces domain block lists by DNS, before the first connection") },
            { s: "−", t: T("A blocked site that shares its address with an allowed one stays reachable") },
            { s: "−", t: T("Long block lists cost CPU per DNS query — keep them small (≈100k domains)") }],
    exp: T("The node becomes your clients' resolver: it answers their plain DNS and routes by the hostnames it sees, per-service precise. Trade-off: it sees and downgrades the client's DNS. A client that uses its own encrypted DNS (DoH or DoT) goes unseen — its hostname rules don't match, though rules by IP still route — so the panel marks that device instead of cutting its DNS off. To stop encrypted DNS, turn on the interface's DoH / DoT / DoQ block: it drops known DoH providers and all DoT, a DoH server it doesn't recognise can still slip past, and a client whose only resolver is encrypted stops resolving. A client answering from its own cache never asks, so a rule you add after it looked a name up takes effect on its next lookup — the node caps what clients may keep at 60 seconds for exactly that reason."),
    routes: T("IP ranges, networks, sites, zones"),
    ...arb("specific"),
  },
  sni_kernel: { icon: "cpu", label: T("Kernel SNI"), short: T("Host via SNI"), tag: T("host layer · SNI in-kernel"),
    adds: T("Scans the TLS SNI in-kernel — client DNS stays private"),
    bene: [T("Daemonless & parallel per-CPU · lightest at high connection rates"), T("Wins stability and high-connection-rate CPU over Hybrid")],
    cost: T("Can also match a longer name that carries the site inside it · needs xt_string + ipset on the node"),
    block: [{ s: "+", t: T("Blocks a site by name: each connection to it is refused, never its address") },
            { s: "−", t: T("Domain block lists are too long for the kernel — use Force-DNS or Hybrid for them") }],
    exp: T("Scans the SNI from each TLS handshake entirely in the kernel (xt_string) — no userspace helper, and your clients' DNS (DoH, DoT or plain) is never touched. Runs in parallel across CPUs, so it stays light even at high connection rates. Needs the node's kernel to provide xt_string + ipset. A site rule matches the name and its subdomains; it can also catch a longer name that carries the site inside it (example.com.evil.net), and name endings like *.ru cannot be matched here at all — this node counts them and says so, so you can move them to Force-DNS or Hybrid SNI. The first connection to a new site is reset while its address is learned; the client reconnects at once and every later connection follows the rule. A Block by name refuses every connection to that name and never blocks another site on the same address; domain block lists are too long for an in-kernel scan, so they run on Force-DNS or Hybrid SNI. QUIC / HTTP3 is dropped, so browsers use TLS over TCP, which is read; names hidden by ECH fall back to IP rules."),
    routes: T("IP ranges, networks, sites, text patterns"),
    ...arb("order"),
  },
  sni:      { icon: "eye", label: T("Hybrid SNI"), short: T("Host via SNI"), tag: T("host layer · SNI in userspace"),
    adds: T("Parses the TLS SNI in a small helper — client DNS stays private"),
    bene: [T("Precise parsed-SNI matching · unbothered by big lists"), T("Has fewer kernel deps, wins accuracy over Kernel")],
    cost: T("Runs a helper process — if it stops, traffic still flows but learning and name blocks pause"),
    block: { s: "+", t: T("Enforces domain block lists per connection — other sites on a blocked site's address stay reachable") },
    exp: T("Routes by hostname by parsing the SNI from each TLS handshake in a small userspace helper, so your clients' DNS — DoH, DoT or plain — is never touched, observed or downgraded: the connection stays encrypted end-to-end. Parses the real SNI field (precise, fine with very large lists). Learns each destination on its first connection (a brand-new host routes on the next one). A blocked name is refused on every connection and its address stays open to other sites. QUIC / HTTP3 is dropped, so browsers use TLS over TCP, which is read; names hidden by ECH fall back to IP rules."),
    routes: T("IP ranges, networks, sites, zones, name patterns, text patterns"),
    ...arb("specific"),
  },
}; }
let _modeMeta = null;
function noFilterCats(onNav) {
  const [a, b] = Tsplit("No content-filter categories are enabled on this node yet — turn them on in {where}.", "where");
  return html`<${Fragment}>${a}<button type="button" class="linkbtn" onClick=${onNav}>${T("Settings ▸ Routing & Blocking")}</button>${b}<//>`;
}
const TOK_LEARN = () => T("token|RESET LEARNED");
const TOK_ALL = () => T("token|RESET ALL");
function resetPrompt() {
  const one = T("Type {learn} or {all} to confirm your action");
  const [a, r1] = [one.split("{learn}")[0], one.split("{learn}").slice(1).join("{learn}")];
  const [b, c] = [r1.split("{all}")[0], r1.split("{all}").slice(1).join("{all}")];
  return html`<${Fragment}>${a}<span class="ct-learn"><${ConfirmPhrase} phrase=${TOK_LEARN()} bold=${true}/></span>${b}<span class="ct-all"><${ConfirmPhrase} phrase=${TOK_ALL()} bold=${true}/></span>${c}<//>`;
}

export const MODE_META = new Proxy({}, { get: (_, k) => (_modeMeta || (_modeMeta = buildModeMeta()))[k] });


export function rulesTitle(nodeId) {
  const rec = (Store.nodes || []).find(x => x.id === nodeId);
  const w = rec ? (MODE_META[rec.routing_mode || "kernel"] || {}).winsLabel : "";
  return html`${T("Routing rules")}${w ? html` <span class="disc-wins">${w}</span>` : null}`;
}

export function rulesSummary(nodeId, rows, catchAll) {
  const list = rows || [];
  const n = list.length;
  if (!n && catchAll?.action === "exit" && catchAll.enabled !== false)
    return T("Everything else → {v1}", { v1: T("Forward to {node}", { node: Store.nodeName(catchAll.node) }) });
  if (!n) return T("no rules yet");
  const a = { v1: n, v2: pluralWord(n, "rule") };
  const head = Trich("*{v1}* {v2}", a);
  const rec = (Store.nodes || []).find(x => x.id === nodeId);
  const mode = rec ? (rec.routing_mode || "kernel") : "";
  let off = 0;
  if (mode) for (const r of list) if (!r.locked)
    for (const bg of (r.badges || [])) if (!rowGate(r, mode, nodeId, bg).ok) off++;
  const _nr = (Store.nodes || []).find(x => x.id === nodeId);
  const known = new Set((Store.nodes || []).map(n => n.id));
  const _xids = new Set(((_nr || {}).exits || []).map(e => String(e.id)));
  const _gone = r => (r && !r.locked)
    && ((r.action === "exit" && r.node && !known.has(r.node))
        || (r.action === "dev" && r.exit_id && !_xids.has(String(r.exit_id))));
  let dead = _nr ? list.filter(_gone).length + (_gone(catchAll) ? 1 : 0) : 0;
  const parts = [];
  if (off) parts.push(T("{v1} can't run here", { v1: plural(off, "target") }));
  if (dead) parts.push(T("{v1} pointing nowhere", { v1: plural(dead, "rule") }));
  return parts.length ? html`${head}<span class="rs-off"> · ${parts.join(" · ")}</span>` : head;
}

export function ModeTabs({ value, onChange }) {
  return html`<div class="rmode-tabs" role="radiogroup">
    ${["kernel", "sni"].map(m => { const mm = MODE_META[m], on = m === value;
      return html`<button type="button" role="radio" aria-checked=${on} key=${m} title=${mm.label}
        class=${"rmtab m-" + m + (on ? " on" : "")} onClick=${() => onChange(m)}><${Ic} i=${mm.icon}/></button>`; })}
  </div>`;
}
export function resetRouting(node, name) {
  openModal(html`<${ResetRoutingSheet} node=${node} name=${name || "node"}/>`);
}
export function ResetRoutingSheet({ node, name }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const t = typed.trim();
  const learnOk = t === TOK_LEARN(), allOk = t === TOK_ALL();
  const run = async scope => {
    if (busy) return; setBusy(true);
    const r = await api.routingReset({ id: node, scope });
    if (r && r.ok === false) toast(srvText(r) || T("Reset failed."), "err", 4500);
    else toast(scope === "learned"
      ? T("Learned IPs cleared — the node forgets them and re-learns on its next sync.")
      : T("Routing reset queued — the node wipes, rebuilds and re-pulls on its next sync."), "ok");
    closeModal();
  };
  return html`<${Sheet} title=${T("Reset routing · {v1}", { v1: name })} onClose=${closeModal}
    foot=${html`<${Fragment}><span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button>
      <button class="btn btn-warn" disabled=${busy || !learnOk} onClick=${() => run("learned")}><${Ic} i="refresh"/> ${T("Reset learned IPs")}</button>
      <button class="btn btn-danger" disabled=${busy || !allOk} onClick=${() => run("all")}><${Ic} i="refresh"/> ${T("Reset all routing")}</button></>`}>
    <div class="notice warn"><${Ic} i="warn"/><span>${Trich("*Reset learned IPs* clears only the IPs this node has learned from SNI so far — its tables and lists stay in place and it re-learns as traffic flows. *Reset all routing* wipes the smart-routing tables, learned IPs and cached lists, then rebuilds from scratch and re-pulls every list from the panel; routing may blip for a few seconds.")}</span></div>
    <label class="confirm-type"><span>${resetPrompt()}</span>
      <input class="ctype-input" type="text" autofocus spellcheck="false" autocomplete="off" placeholder=${TOK_LEARN() + " / " + TOK_ALL()} value=${typed}
        onInput=${e => setTyped(e.target.value)}/></label>
  <//>`;
}
export function HostHealth({ node, mode, learn, onLearn }) {
  if (mode === "kernel") return null;
  const sr = (Store.stats[node] || {}).smartroute || {};
  if (!sr.mode) return null;
  const eng = sr.engine || "";
  const label = eng === "dns" ? T("DNS resolver") : eng === "sni_kernel" ? T("SNI scanner") : T("SNI parser");
  const ok = sr.engine_ok !== false;
  let extra = null, note = null;
  const routed = Object.entries(sr.sets || {}).reduce((n, [k, v]) => n + (String(k).includes("blku") ? 0 : (v || 0)), 0);
  const lowered = Object.values(sr.lowered || {}).reduce((n, v) => n + (v || 0), 0);
  if (routed || lowered || (eng.startsWith("sni") && sr.resets)) {
    const bits = [];
    if (routed) bits.push(T("{v1} routed", { v1: plural(routed, "destination").replace(String(routed), fmtCount(routed)) }));
    if (lowered) bits.push(T("matching {v1}", { v1: plural(lowered, "pattern") }));
    if (eng.startsWith("sni") && sr.resets) bits.push(T("{v1} rerouted", { v1: plural(sr.resets, "new host") }));
    extra = bits.join(" · ");
  }
  if (mode === "sni_kernel" && eng === "sni_user") note = T("kernel SNI scanner unavailable — running userspace SNI parser");
  else if (sr.xts_cap && ((sr.xts_cap.capped || []).length || sr.xts_cap.long)) {
    const c = sr.xts_cap, bits = [];
    if ((c.capped || []).length)
      bits.push(T("{v1} matched only in part here — {v2} not matched", {
        v1: c.capped.map(x => catLabelOf(x)).join(", "), v2: plural(c.missed || 0, "entry") }));
    if (c.long)
      bits.push(T("{v1} too long for this scanner to match — over {v2} characters", {
        v1: plural(c.long, "entry"), v2: c.maxlen }));
    note = bits.join(" · ");
  }
  else if (sr.sni_cap && sr.sni_cap.missed) {
    const smp = (sr.sni_cap.sample || []).filter(x => Array.isArray(x) && x.length === 2);
    const more = sr.sni_cap.missed - smp.length;
    const shown = smp.map(([k, v]) => targetLabel(k, v)).join(", ");
    const cap = sr.sni_cap.cap;
    note = !smp.length
      ? T("{v1} past this node's limit of {v2}", { v1: plural(sr.sni_cap.missed, "text pattern"), v2: cap })
      : T("{v1} past this node's limit of {v2} — no longer matched: {v3}", {
          v1: plural(sr.sni_cap.missed, "text pattern"), v2: cap,
          v3: more > 0 ? shown + " " + T("…and {v1} more", { v1: more }) : shown });
  }
  const noRun = Object.values(sr.no_lower || {}).reduce((n, v) => n + (v || 0), 0);
  if (noRun) {
    const s = T("{v1} this engine can't match at all — switch this node's mode, or route them from a node that can",
                { v1: plural(noRun, "pattern") });
    note = note ? note + " · " + s : s;
  }
  return html`<div class=${"rmode-health " + (ok ? "ok" : "down")}>
    <span class="rmh-dot"></span><b>${label}</b> <span>${ok ? T("healthy") : T("down — host routing degraded")}</span>
    ${extra ? html`<span class="rmh-sep">·</span><span>${extra}</span>
      ${onLearn ? html`<button class=${"learn-toggle" + (learn ? " on" : "")} title=${T("IP learning is {v1} · click to turn it {v2}", { v1: learn ? T("ON — the node remembers each learned IP") : T("OFF — routing stays fresh, no remembered IPs"), v2: learn ? T("val|off") : T("val|on") })} onClick=${() => onLearn(!learn)}><${Ic} i="database"/></button>` : null}
      <${Popover} hoverOnly cls="rmh-info" popCls="rmode-info-pop" trigger=${html`<span class="rmh-infobtn"><${Ic} i="info"/></span>`}>
        <div class="rmode-info-body">${Trich("A host's name is only visible once its connection starts, so the *first* connection to a brand-new host has already left on the default path before it can be routed. The engine learns that host's IP and *resets that one connection* so the client instantly reconnects on the correct route — that's the *new hosts rerouted* count; every later connection matches by IP and is never reset.")}<div style="margin-top:9px">${Trich("The *records* toggle (the database icon) controls *IP learning*. Each IP is remembered by *category* (not by domain), so it stays valid even if you later change that category's lists or custom domains. Nothing is kept forever: *On* (default) holds a learned IP for about *1 hour*, so repeat connections route instantly. *Off* keeps the node *fresh* — an IP is held only about *2 minutes*, so a host whose address rotates is never routed on a stale IP (at a little extra CPU, as more connections are re-scanned). Once it expires, the IP is simply re-learned on the next connection.")}</div></div>
      <//>` : null}
    ${note ? html`<span class="rmh-note">${note}</span>` : null}
  </div>`;
}
export function FleetAssign({ nodes, isOn, onToggle, disabledFor, noteFor }) {
  const on = (nodes || []).filter(n => isOn(n.id)).length;
  const noted = noteFor ? (nodes || []).filter(n => noteFor(n.id)).length : 0;
  return html`<${Popover} cls="fleetassign" popCls="fleetpop"
    trigger=${html`<span class="fleet-trig">${T("fleet|on")} <b>${on}</b>/${(nodes || []).length}${noted
      ? html` <span class="fleet-note">· ${T("in use on {v1}", { v1: plural(noted, "prep|node") })}</span>` : null} <span class="fleet-caret">▾</span></span>`}
    children=${html`<div class="fleetlist"><div class="fleetlist-h">${T("Enabled on")}</div>${(nodes || []).map(n => { const dis = disabledFor && disabledFor(n.id);
      const note = noteFor && noteFor(n.id);
      return html`<div class=${"fleetrow" + (dis ? " off" : "")} title=${dis || ""}>
        <span class="fleet-dot" style=${"--c:" + Store.nodeColor(n.id)}></span><span class="fleet-nm">${n.name}</span><span class="grow"></span>
        ${note ? html`<span class="fleet-note">${note}</span>` : null}
        <${Switch} on=${isOn(n.id)} disabled=${!!dis} onChange=${v => onToggle(n.id, v)}/></div>`; })}</div>`}/>`;
}
export const catCap = id => (Store.smartCaps || {})[id] || { ip: false, host: false };
export const routeTierOk = (mode, tier) => tier === "ip" || mode !== "kernel";
export const routeCapsUsable = (mode, caps) => !!(caps && ((caps.ip && routeTierOk(mode, "ip")) || (caps.host && routeTierOk(mode, "host"))));
export const catUsableInMode = (id, mode) => routeCapsUsable(mode, catCap(id));

export const PATTERN_ENGINE_OK = {
  ip:       { kernel: 1, forcedns: 1, sni_kernel: 1,      sni: 1 },
  asn:      { kernel: 1, forcedns: 1, sni_kernel: 1,      sni: 1 },
  site:     { kernel: 0, forcedns: 1, sni_kernel: 1,      sni: 1 },
  zone:     { kernel: 0, forcedns: 1, sni_kernel: 0,      sni: 1 },
  first:    { kernel: 0, forcedns: 0, sni_kernel: 0,      sni: 1 },
  any:      { kernel: 0, forcedns: 0, sni_kernel: 0,      sni: 1 },
  contains: { kernel: 0, forcedns: 0, sni_kernel: 1,      sni: 1 },
  starts:   { kernel: 0, forcedns: 0, sni_kernel: 0,      sni: 1 },
  ends:     { kernel: 0, forcedns: 0, sni_kernel: 0,      sni: 1 },
};
export const PATTERN_SHIPPED = { ip: 1, asn: 1, site: 1, zone: { forcedns: 1, sni: 1 },
                                 first: { sni: 1 }, any: { sni: 1 },
                                 contains: { sni_kernel: 1, sni: 1 },
                                 starts: { sni: 1 }, ends: { sni: 1 } };
const _shippedOn = (kind, mode) => { const v = PATTERN_SHIPPED[kind];
  return !!v && (v === 1 || !mode || !!v[mode]); };
const _FIX_MODES = ["sni"];
const ENGINE_NO = { kernel: "engine", forcedns: "whole", sni_kernel: "anchor" };
export function targetGate(mode, kind) {
  if (!kind || kind === "invalid") return { ok: false, why: "invalid" };
  if (!PATTERN_SHIPPED[kind]) return { ok: false, why: "unbuilt" };
  const row = PATTERN_ENGINE_OK[kind];
  const fix = _FIX_MODES.find(m => row && row[m] && _shippedOn(kind, m)) || "";
  if (mode && row && !row[mode]) return { ok: false, why: ENGINE_NO[mode] || "engine", ...(fix ? { fix } : {}) };
  if (!_shippedOn(kind, mode)) return { ok: false, why: "unbuilt", ...(fix ? { fix } : {}) };
  if (!mode || !row) return { ok: true };
  const v = row[mode];
  if (v === "text") return { ok: true, degraded: true };
  return { ok: true };
}
export const patternOk = (mode, kind) => targetGate(mode, kind).ok;

const idnOf = v => idnHost(String(v == null ? "" : v));
export function targetLabel(kind, value) {
  switch (kind) {
    case "zone": return "." + idnOf(value);
    case "first": return idnOf(value) + ".*";
    case "any": return "*." + idnOf(value) + ".*";
    case "contains": return "*" + value + "*";
    case "starts": return value + "*";
    case "ends": return "*" + value;
    case "ip": return String(value).replace(/\/32$/, "");
    case "asn": return String(value).toUpperCase();
    default: return idnOf(value);
  }
}
export const targetPuny = (kind, value) => idnDiffers(String(value == null ? "" : value))
  ? String(value) : "";
let _kind_label = null;
export const KIND_LABEL = () => (_kind_label || (_kind_label = {
  site: T("kind|site"), zone: T("kind|zone"), first: T("kind|name"), any: T("kind|name"),
  contains: T("kind|contains"), starts: T("kind|starts with"), ends: T("kind|ends with"),
  ip: T("kind|IP range"), asn: T("kind|network"),
}));
export const KIND_WIDE = { zone: 1, contains: 1, starts: 1, ends: 1 };
const TIER2_WARN = 5;
const isTier2 = kind => patternTier(kind) === 2;
const opMaxlen = node => (((Store.stats || {})[node] || {}).smartroute || {}).op_maxlen || 0;
export const opTooLongNote = (node, kind, value) => {
  if (patternTier(kind) !== 2) return "";
  const max = opMaxlen(node), n = String(value || "").length;
  return max && n > max
    ? " " + T("This node matches at most {v1} of a pattern — this one is {v2} and would be dropped.",
              { v1: plural(max, "character"), v2: plural(n, "character") })
    : "";
};
const tier2Note = v => String(v).length < TIER2_WARN
  ? " " + T("Only {v1} long — a short fragment turns up inside names that have nothing to do with it.",
            { v1: plural(String(v).length, "character") })
  : "";
export function targetSentence(kind, value) {
  const v = targetLabel(kind, value);
  switch (kind) {
    case "site": return T("{v1} and every name under it — www.{v1}, mail.{v1}…", { v1: idnOf(value) });
    case "zone": return T("Every address ending in {v1} — millions of sites", { v1: v });
    case "first": return T("Any address whose first part is {v1} — {v1}.com, {v1}.ru, {v1}.de", { v1: idnOf(value) });
    case "any": return T("Any address with {v1} as one of its parts", { v1: idnOf(value) });
    case "contains": return T("Any address with {v1} anywhere in it — also matches not{v1}.com", { v1: value }) + tier2Note(value);
    case "starts": return T("Any address whose text starts with {v1} — also matches {v1}mail.com", { v1: value }) + tier2Note(value);
    case "ends": return T("Any address whose text ends with {v1} — also matches not{v1}", { v1: value }) + tier2Note(value);
    case "ip": { const bits = +String(value).split("/")[1];
      return bits === 32 ? T("One address") : T("{v1} addresses", { v1: fmtCount(Math.pow(2, 32 - bits)) }); }
    case "asn": return T("All IP ranges announced by {v1}", { v1: v });
    default: return "";
  }
}
export function targetWhy(why, raw) {
  const t = String(raw || "").trim().toLowerCase();
  switch (why) {
    case "bare_label": case "lead_dot": return T("Did you mean the whole .{v1} zone? Write *.{v1}.", { v1: t.replace(/^\.+/, "") });
    case "bad_ip": return T("That isn't a valid IP address or range.");
    case "bad_domain": return T("That isn't a valid web address.");
    case "star_mid": return T("A * goes at the start or the end of a name, not in the middle.");
    case "multi_label_operand": return T("Put one name between the stars, not a dotted address.");
    case "idn_tier2": return T("A partial-word match can't be written in non-Latin letters — names travel already encoded.");
    case "short_tier2": return T("Too short to match on — under {v1} characters this catches names that have nothing to do with what you meant.", { v1: TIER2_MIN });
    default: return T("That isn't an address, IP range or AS number.");
  }
}
let _ruleSeq = 0;
export const newRid = () => "rr" + (++_ruleSeq);


let _CATALOG_INDEX = null;
let _CATALOG_BY_ID = {};
let _CATALOG_KEY = null;
let _CATALOG_REQ = { key: null, p: null };
const catalogWords = value => String(value || "").toLowerCase().replace(/[^\p{L}\p{N}!]+/gu, " ").trim();
const catalogPrefix = (fields, term) => fields.some(text => text.startsWith(term) || text.includes(" " + term));
export const catalogKey = () => {
  const on = (Store.panelSettings || {}).providers || {};
  return (Store.catalogGen || "") + "|" + Object.keys(on).filter(k => on[k]).sort().join(",");
};
export function loadCatalogIndex() {
  const key = catalogKey();
  if (_CATALOG_INDEX && _CATALOG_KEY === key) return Promise.resolve(_CATALOG_INDEX);
  if (_CATALOG_REQ.key === key && _CATALOG_REQ.p) return _CATALOG_REQ.p;
  const forget = () => { if (_CATALOG_REQ.p === p) _CATALOG_REQ = { key: null, p: null }; return _CATALOG_INDEX || []; };
  const p = api.catalogIndex().then(r => {
    if (!(r && r.ok)) return forget();
    const pl = r.data.provider_labels || {};
    const idx = (r.data.items || []).map(it => { const disp = prettyCatLabel(it.id, "");
      return { ...it, provider_label: pl[it.provider] || it.provider, disp,
               words: [catRawId(it.id), disp, it.label].map(catalogWords) }; });
    if (_CATALOG_REQ.p === p) {
      _CATALOG_INDEX = idx; _CATALOG_KEY = key;
      _CATALOG_BY_ID = Object.fromEntries(idx.map(it => [it.id, it]));
    }
    return idx;
  }).catch(forget);
  _CATALOG_REQ = { key, p };
  return p;
}

let _blockCatalogRequest = null;
export function loadBlockCatalog(force) {
  if (!force) {
    if (_blockCatalogRequest) return _blockCatalogRequest;
    if (Store.blockCatalog) return Promise.resolve(Store.blockCatalog);
  }
  Store.blockCatalogError = false;
  const request = api.blockCatalog().then(r => {
    if (_blockCatalogRequest !== request) return;
    if (r && r.ok && r.data) Store.blockCatalog = r.data;
    else Store.blockCatalogError = true;
  }).catch(() => {
    if (_blockCatalogRequest === request) Store.blockCatalogError = true;
  }).then(() => {
    if (_blockCatalogRequest !== request) return _blockCatalogRequest || Store.blockCatalog || null;
    _blockCatalogRequest = null;
    bus.emit();
    return Store.blockCatalog || null;
  });
  _blockCatalogRequest = request;
  bus.emit();
  return request;
}

export const blockTierOk = (mode, tier) => tier === "ip" || (mode !== "kernel" && mode !== "sni_kernel");
export const blockHostBlind = mode => !blockTierOk(mode, "host");
export const blockProvTier = (providers, p) => ((providers || []).find(x => x.id === p) || {}).tier || "host";
export const blockSrcOk = (mode, providers, s) => blockTierOk(mode, blockProvTier(providers, s.provider));
export const blockCatHasIp = (providers, c) => (c.sources || []).some(s => blockProvTier(providers, s.provider) === "ip");
export const blockCatDisabled = (mode, providers, c) => blockHostBlind(mode) && !blockCatHasIp(providers, c);
export const blockProvOn = (providers, p) => ((providers || []).find(x => x.id === p) || {}).enabled !== false;
export const blockCatLive = (mode, providers, c) => (c.sources || []).some(s => s.provider && blockProvOn(providers, s.provider) && blockSrcOk(mode, providers, s));
let _mech_hint = null;
const MECH_UNBUILT = new Set(["cryptomining", "webrtc"]);
export const MECH_HINT = () => (_mech_hint || (_mech_hint = {
  smtp:         T("Drop outbound mail on TCP :25 — stops spam being relayed through this exit."),
  portscan:     T("Rate-limit outbound port-scans, brute-force and SYN-floods leaving this interface."),
  cryptomining: T("Drop known cryptomining / Stratum-pool traffic."),
  quic:         T("Drop QUIC / HTTP-3 (UDP :443) so connections fall back to TCP and stay inspectable."),
  doh:          T("Drop DoH / DoT / DoQ so DNS can't slip past the tunnel's filtering. A client whose only resolver is encrypted stops resolving."),
  webrtc:       T("Block WebRTC / STUN — prevents the client's real IP leaking around the tunnel."),
}));
let _block_cat_label = null;
export const blockCatLabel = label => (_block_cat_label || (_block_cat_label = {
  "Torrents / P2P":           T("bcat|Torrents / P2P"),
  "SMTP :25 (outbound mail)": T("bcat|SMTP :25 (outbound mail)"),
  "Port-scan / Brute-force":  T("bcat|Port-scan / Brute-force"),
  "Cryptomining":             T("bcat|Cryptomining"),
}))[label] || label;
let _blist = null;
export const blistText = s => (_blist || (_blist = {
  "Adult / pornographic domains": T("blist|Adult / pornographic domains"),
  "All-in-one: ads, malware, phishing & tracking": T("blist|All-in-one: ads, malware, phishing & tracking"),
  "Balanced ads + tracking blocklist": T("blist|Balanced ads + tracking blocklist"),
  "Smaller ads list, fewer false positives": T("blist|Smaller ads list, fewer false positives"),
  "Compact list of malware, phishing & C2 domains": T("blist|Compact list of malware, phishing & C2 domains"),
  "Malware, phishing & C2 domains": T("blist|Malware, phishing & C2 domains"),
  "Gambling & betting sites": T("blist|Gambling & betting sites"),
  "Public DNS-over-HTTPS endpoints": T("blist|Public DNS-over-HTTPS endpoints"),
  "Hijacked / criminal netblocks": T("blist|Hijacked / criminal netblocks"),
}))[s] || s;

export function defaultBlockFor(node) {
  const bc = Store.blockCatalog; if (!bc) return [];
  return Object.values(bc.categories || {}).filter(c => c && c.default_on && c.enabled !== false &&
    (c.kind === "mechanism" || (c.enabled_nodes || []).includes(node))).map(c => c.id);
}

export function blockActiveN(node, value, p2p) {
  const bc = Store.blockCatalog; const ids = value || [];
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const own = p2p && p2p.action && nrec.p2p_eff === "iface" ? 1 : 0;
  if (!bc) return ids.length + own;
  const mode = nrec.routing_mode || "kernel";
  return own + ids.filter(id => { const c = (bc.categories || {})[id];
    return c && c.enabled !== false && (c.kind === "mechanism" ? !MECH_UNBUILT.has(id)
      : ((c.enabled_nodes || []).includes(node) && blockCatLive(mode, bc.providers, c))); }).length;
}

export const p2pVal = p => !p || !p.action ? "" : p.action === "dev" ? "dev:" + p.exit_id : p.action === "exit" ? "exit:" + p.node : p.action;
export const p2pRec = val => val.startsWith("dev:") ? { action: "dev", exit_id: val.slice(4) }
  : val.startsWith("exit:") ? { action: "exit", node: val.slice(5) } : { action: val };
const p2pNodeName = id => ((Store.nodes || []).find(n => n.id === id) || {}).name || id;
export const p2pTarget = (p, exits, node) => {
  if (p.action === "exit") return p2pNodeName(p.node);
  if (p.action !== "dev") return "";
  const x = (exits || []).find(e => String(e.id) === String(p.exit_id));
  return x ? exitLabel(x, node) : String(p.exit_id || "");
};
const P2P_SHORT = () => ({ block: T("blocked"), direct: T("this server's address only"), iface: T("per interface") });
export const p2pLabel = (p, exits, node) => !p || !p.action ? "" : (p.action === "dev" || p.action === "exit")
  ? T("via {v1}", { v1: p2pTarget(p, exits, node) }) : (P2P_SHORT()[p.action] || "");
export function p2pTargetOpts(node, exits) {
  const linked = new Set((node.mesh_peers || []).filter(m => m && m.iface).map(m => m.peer));
  const viaNode = (Store.nodes || []).filter(n => n.id !== node.id).map(n => ({ value: "exit:" + n.id,
    label: T("Route through node {v1}", { v1: n.name }),
    ...(!linked.has(n.id) ? { refuse: T("There is no mesh link to {v1}.", { v1: n.name }), className: "dim" } : {}) }));
  return [...exitOptionGroups({ ...node, exits: [] }, { prefix: "dev:", stored: [] })
      .map(g => ({ ...g, items: g.items.map(it => ({ ...it, label: T("Route through {v1}", { v1: it.label }) })) })),
    ...(viaNode.length ? [{ group: T("Through another node"), items: viaNode }] : [])];
}
export function p2pTargetHints(rec, node, draft = null) {
  const out = [];
  const tgt = rec && rec.action === "exit" ? (Store.nodes || []).find(n => n.id === rec.node) : null;
  const tgtDrops = tgt && ["block", "exit", "dev"].includes(tgt.p2p_eff);
  const tgtStale = !tgtDrops && !!tgt && nodeStatusOf(tgt) !== "online";
  if (tgtStale) out.push(html`<div class="hint warnish">${T("{v1} is not reporting right now — torrent traffic sent there will not get out until it is back.", { v1: tgt.name })}</div>`);
  if (tgtDrops) out.push(html`<div class="hint warnish">${T("{v1} blocks torrent traffic that other nodes send it, so nothing routed there will get out. Set {v1} to allow it, or to let each interface decide.", { v1: tgt.name })}</div>`);
  const byId = l => (l || []).find(e => e && String(e.id) === String(rec.exit_id));
  const x = rec && rec.action === "dev" ? (byId((node || {}).exits) || byId(draft)) : null;
  if (x && exitProv(x) === "socks5" && (x.live || {}).udp_ok !== true)
    out.push(html`<div class="hint warnish">${T("This exit carries TCP only — DHT and µTP can't pass it, so torrents find fewer peers and download slower.")}</div>`);
  return out;
}

export function ifaceP2pModel(nrec, block, p2p) {
  const pol = nrec.p2p_eff || "block";
  const iface = pol === "iface";
  const cur = (block || []).includes("torrents") ? "block" : p2pVal(p2p);
  const elsewhere = T("Counts only when {v1}'s Torrents / P2P setting is “Each interface decides” — Settings ▸ Network ▸ Filters & abuse.", { v1: nrec.name || nrec.id });
  const deny = it => iface ? it : { ...it, refuse: elsewhere, className: "dim" };
  const opts = [{ value: "block", label: T("Block") },
    { value: "", label: iface ? T("Allow — not checked") : T("As the server — {v1}", { v1: p2pLabel(nrec.p2p || { action: pol }, nrec.exits, nrec) }) },
    deny({ value: "direct", label: T("Allow, only out this server's own address") }),
    ...p2pTargetOpts(nrec, nrec.exits || []).map(g => ({ ...g, items: g.items.map(deny) }))];
  const rec = p2p && p2p.action ? p2p : null;
  const hint = cur === "block" ? T("Torrent traffic from this interface is dropped, whichever way it leaves.")
    : !rec ? (iface ? T("Torrent traffic from this interface is not checked — it follows the interface's own routing.")
                    : T("This interface follows the server's Torrents / P2P setting."))
    : rec.action === "direct" ? T("Torrent traffic from this interface may leave only by this server's own address — never through an exit or another node. Everything else keeps its route.")
    : T("Torrent traffic from this interface may leave only through {v1}. If that way is down, it is blocked — never sent out another way.", { v1: p2pTarget(rec, nrec.exits, nrec) });
  const pick = a => { const rest = (block || []).filter(id => id !== "torrents");
    return [a === "block" ? [...rest, "torrents"] : rest, a === "block" || a === "" ? null : p2pRec(a)]; };
  return { iface, cur, opts, rec, hint, warn: rec && !iface ? elsewhere : "", pick };
}
function IfaceP2p({ node, block, p2p, onPick }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || { id: node };
  const M = ifaceP2pModel(nrec, block, p2p);
  return html`<div class="field blk-p2p"><label>${T("Torrents / P2P")}</label>
    <${Dropdown} value=${M.cur} onChange=${a => onPick(...M.pick(a))} options=${M.opts}/>
    <div class="hint">${M.hint}</div>
    ${M.warn ? html`<div class="hint warnish">${M.warn}</div>` : null}
    ${M.rec && M.iface ? p2pTargetHints(M.rec, nrec) : null}
  </div>`;
}

function nbLine(node, mode) {
  const kinds = new Set(classifyAll((Store.panelSettings?.block_allow || []).join("\n")).map(c => c.kind));
  const names = kinds.has("site") && (mode === "forcedns" || mode === "sni") && !!((Store.stats[node] || {}).smartroute || {}).allow;
  const nets = kinds.has("ip");
  if (!names && !nets) return null;
  return html`<div class="hint blk-allow">${names && nets ? T("Sites and addresses on the Never-block list (Settings → Geo data providers → Blocking) are taken out of these lists here.")
    : names ? T("Sites on the Never-block list (Settings → Geo data providers → Blocking) are taken out of these lists here.")
    : T("Addresses on the Never-block list (Settings → Geo data providers → Blocking) are taken out of these lists here.")}</div>`;
}

export function BlockTraffic({ node, value, onChange, p2p, onP2p }) {
  useStore(); useEffect(() => { loadBlockCatalog(); }, []);
  const bc = Store.blockCatalog;
  const mode = ((Store.nodes || []).find(n => n.id === node) || {}).routing_mode || "kernel";
  const active = id => (value || []).includes(id);
  const toggle = id => { const s = new Set(value || []); s.has(id) ? s.delete(id) : s.add(id); onChange([...s]); };
  if (!bc) return html`<div class="blk-field"><div class="hint">${T("Loading block catalog…")}</div></div>`;
  const list = Object.values(bc.categories || {}).filter(c => c.enabled !== false);
  const availOn = c => (c.enabled_nodes || []).includes(node);
  const content = list.filter(c => (c.kind === "content" || c.kind === "ip") && availOn(c));
  const selectedSources = content.filter(c => active(c.id)).flatMap(c => c.sources || []);
  const mech = list.filter(c => c.kind === "mechanism" && !MECH_UNBUILT.has(c.id) && !(onP2p && c.id === "torrents"));
  const chip = c => { const dis = blockCatDisabled(mode, bc.providers, c);
    const dead = !dis && !blockCatLive(mode, bc.providers, c);
    return html`<button type="button" key=${c.id} disabled=${dis}
      class=${"blkchip" + (active(c.id) && !dis && !dead ? " on" : "") + (dis || dead ? " inert" : "")}
      title=${dis ? T("No IP list in this category — domain lists can't match in {mode}. Use Hybrid SNI, or add an IP list.", { mode: (MODE_META[mode] || {}).label || mode })
                 : dead ? T("None of this category's lists is in use — their providers are switched off, or it has no lists yet. It blocks nothing until one is.")
                 : (c.kind === "ip" ? T("Matched by IP address — works in every mode.") : T("Matched by domain name."))}
      onClick=${() => { if (!dis) toggle(c.id); }}><span class="blkchip-g">⊘</span>${c.label}</button>`; };
  const mchip = c => html`<button type="button" key=${c.id} class=${"blkchip mech" + (active(c.id) ? " on" : "")}
      title=${MECH_HINT()[c.id] || ""} onClick=${() => toggle(c.id)}><span class="blkchip-g">⊘</span>${blockCatLabel(c.label)}</button>`;
  return html`<div class="blk-field">
    <div class="blk-grp"><div class="blk-gtitle">${T("Content filtering")}</div>
      ${content.length ? html`<div class="blk-chips">${content.map(chip)}</div>`
        : html`<div class="hint blk-empty">${noFilterCats(() => { closeAllModals(); goSettings("routing"); })}</div>`}
      ${selectedSources.length ? html`<div class="hint"><${BlockCoverageSummary} sources=${selectedSources} hosts=${blockTierOk(mode, "host")}/></div>` : null}
      ${content.length ? nbLine(node, mode) : null}</div>
    <div class="blk-grp"><div class="blk-gtitle">${T("Traffic & abuse")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— built-in")}</span></div>
      ${onP2p ? html`<${IfaceP2p} node=${node} block=${value} p2p=${p2p}
        onPick=${(b, p) => { onChange(b); onP2p(p); }}/>` : null}
      <div class="blk-chips">${mech.map(mchip)}</div></div>
  </div>`;
}



export function BlockListPicker({ providers, provLists, current, nodeMode, onAdd, autoOpen }) {
  const [q, setQ] = useState("");
  const has = (p, l) => (current || []).some(s => s.provider === p && s.list === l);
  const ql = q.trim().toLowerCase();
  const naLabel = (MODE_META[nodeMode] || {}).label || nodeMode;
  const naFor = p => blockSrcOk(nodeMode, providers, { provider: p }) ? null : naLabel;
  const shown = (p, it) => !has(p.id, it.id) && (!ql || [it.label, it.desc, blistText(it.label), blistText(it.desc), p.label]
    .join(" ").toLowerCase().includes(ql));
  return html`<${Popover} alignRight flipFit clickOnly cls="bk-addwrap" popCls="bk-pickpop" autoOpen=${autoOpen}
      trigger=${html`<button class="btn btn-mini"><${Ic} i="plus"/> ${T("Add list")}</button>`}>
    ${close => html`<div class="bk-pick" onClick=${e => e.stopPropagation()}>
      <div class="bk-pickhead">
        <input class="bk-picksearch" ref=${el => { if (el && !el._foc && !isMobile()) { el._foc = 1; requestAnimationFrame(() => el.focus()); } }} placeholder=${T("Search lists…")} value=${q} onInput=${e => setQ(e.target.value)}/>
        <button type="button" class="pop-x" aria-label=${T("Close")} title=${T("Close")} onClick=${close}><${Ic} i="x"/></button>
      </div>
      <div class="bk-picklist">
        ${(providers || []).filter(p => p.enabled !== false).map(p => {
          const items = (provLists[p.id] || []).filter(it => shown(p, it));
          if (!items.length) return null;
          const na = naFor(p.id);
          return html`<div class="bk-pickgrp" key=${p.id}><div class="bk-pickprov" style=${p.color ? "--pc:" + p.color : ""}>${p.label}</div>
            ${items.map(it => html`<button class=${"bk-pickitem" + (na ? " na" : "")} key=${it.id} onClick=${() => onAdd(p.id, it.id)}><span class="bk-pilabel">${blistText(it.label)}${na ? html`<span class="bk-nabadge">${T("Not available with {v1}", { v1: na })}</span>` : null}</span>${it.desc ? html`<span class="bk-pidesc">${blistText(it.desc)}</span>` : null}</button>`)}</div>`;
        })}
        ${(providers || []).every(p => p.enabled === false || !(provLists[p.id] || []).some(it => shown(p, it)))
          ? html`<div class="bk-pickempty">${ql ? T("No lists match.") : T("Every available list is already added.")}</div>` : null}
      </div>
    </div>`}
  <//>`;
}

export function NewBlockCatSheet({ existingNames, onCreate }) {
  const [name, setName] = useState("");
  const nm = name.trim();
  const dup = existingNames.some(label => label.toLowerCase() === nm.toLowerCase());
  const bad = !nm || dup;
  const create = () => {
    if (bad) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = "cl_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    onCreate({ id, label: nm });
    closeModal();
  };
  return html`<${Sheet} title=${T("New block category")} onClose=${closeModal}
    foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button><button class="btn btn-primary" disabled=${bad} onClick=${create}>${T("Create")}</button></>`}>
    <div class="field"><label>${T("Name")}</label>
      <input type="text" autofocus spellcheck="false" maxlength="80" value=${name} placeholder=${T("e.g. Corporate block")}
        onInput=${e => setName(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") create(); }}/>
      <div class="hint">${T("Add lists next — the category matches by domain or IP depending on the lists you pick.")}</div></div>
    ${dup ? html`<div class="hint"><b class="warntext">${T("A category with that name already exists.")}</b></div>` : null}
  <//>`;
}

export function placeWide(el) {
  const r = el.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
  const box = el.closest(".sheet-body, .card, .setpane");
  const br = box ? box.getBoundingClientRect() : r, pad = 18;
  const flip = below < 360 && above > below;
  return { left: Math.round(br.left + pad), top: Math.round(flip ? r.top - 4 : r.bottom + 6),
    width: Math.round(br.width - pad * 2), flip, wide: true, maxh: Math.max(300, Math.round(flip ? above : below)) };
}

export function catCapsAny(id) {
  const s = (Store.smartCaps || {})[id]; if (s && (s.ip || s.host)) return s;
  const ix = _CATALOG_BY_ID[id]; if (ix && ix.caps && (ix.caps.ip || ix.caps.host)) return ix.caps;
  const li = _LIST_INFO_CACHE[id];
  if (li && li.tiers) return { ip: !!(li.tiers.ip && li.tiers.ip.n), host: !!(li.tiers.host && li.tiers.host.n) };
  return {};
}
const customListOf = id => (Store.panelSettings?.custom_lists || []).find(l => l && (l.id === id || l.name === id)) || null;
export function listGate(mode, id, node) {
  const cl = customListOf(id);
  if (cl && (cl.disabled_nodes || []).includes(node)) return { ok: false, why: "list_off_node" };
  const prov = providerOf(id);
  if (prov && (Store.panelSettings?.providers || {})[prov] === false) return { ok: false, why: "prov_off" };
  if (!mode) return { ok: true };
  const caps = cl ? customCaps(cl) : catCapsAny(id);
  if (!caps.ip && !caps.host) return { ok: true };
  return routeCapsUsable(mode, caps) ? { ok: true } : { ok: false, why: "engine", fix: "forcedns" };
}
export const badgeGate = (mode, node, b) => b.t === "list" ? listGate(mode, b.id, node) : targetGate(mode, b.kind);
const _ipKind = k => k === "ip" || k === "asn";
const _listCaps = b => customListOf(b.id) ? customCaps(customListOf(b.id)) : catCapsAny(b.id);
const _nameBadge = b => { const caps = b.t === "list" ? _listCaps(b) : null; return caps ? !!caps.host : !_ipKind(b.kind); };
export function rowGate(row, mode, node, b) {
  const g = badgeGate(mode, node, b);
  if (!g.ok || mode !== "sni_kernel") return g;
  const caps = b.t === "list" ? _listCaps(b) : null;
  if (!_nameBadge(b)) return g;
  if (!(row && row.who) || ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) >= 2) return g;
  return caps && caps.ip ? { ...g, note: T("Kernel SNI on this node can't match hostnames for chosen people — only this rule's IP addresses and networks apply here. Switch to Hybrid SNI to match them.") }
    : { ok: false, why: "person_ksni", fix: "sni" };
}

const _byName = r => r.enabled !== false && r.action !== "block" && (r.badges || []).some(_nameBadge);
export const catchAllPreemptsNames = (mode, rows, catchAll) => (mode === "sni" || mode === "sni_kernel")
  && !!catchAll && catchAll.action === "block"
  && (rows || []).some(_byName);
export const allBlockPreemptsNames = (mode, rows) => {
  if (mode !== "sni" && mode !== "sni_kernel") return -1;
  return (rows || []).findIndex((r, k) => r.enabled !== false && r.action === "block" && portsReach(portsOf(r), "tcp", 443)
    && (r.badges || []).some(b => b.t === "target" && b.kind === "ip" && /^0\.0\.0\.0\/0$/.test(String(b.value)))
    && rows.slice(0, k).some(up => _byName(up) && (!r.who || rowCovers(up, r))));
};

export function portsNote(mode, row, blk = []) {
  const p = portsOf(row);
  if (!p) return null;
  if (portsClean(p.proto, p.list).bad)
    return { warn: true, text: T("These ports can't be read, so this rule applies nowhere — open it and set them again.") };
  const names = (row.badges || []).some(_nameBadge), out = [];
  const say = (warn, text) => out.push({ warn, text });
  const named = n => !!p.list && p.list.split(",").some(t => { const [a, b] = t.split("-").map(Number); return a <= n && n <= (b || a); });
  if (((mode === "sni" || mode === "sni_kernel") || (blk || []).includes("quic")) && portsReach(p, "udp", 443))
    say(named(443), mode === "sni" || mode === "sni_kernel"
      ? T("This node drops QUIC (UDP 443) before any rule, so web browsers fall back to TCP — this rule never sees UDP 443.")
      : T("This interface's QUIC filter drops UDP 443 before any rule — this rule never sees it."));
  if ((blk || []).includes("smtp") && portsReach(p, "tcp", 25))
    say(named(25), T("This interface's SMTP filter drops TCP 25 before any rule — this rule never sees it."));
  if (mode === "forcedns" && (portsReach(p, "udp", 53) || portsReach(p, "tcp", 53)))
    say(named(53) || row.action === "block", row.action === "block"
      ? T("This rule drops your clients' DNS to these addresses before Force DNS can answer it.")
      : T("With Force DNS this node answers port 53 itself, whatever this rule says."));
  const only443 = p.proto === "tcp" && p.list === "443";
  if (names && mode === "sni_kernel" && !only443)
    say(true, portsReach(p, "tcp", 443)
      ? T("Kernel SNI reads site names on TCP 443 only — on the other ports only this rule's addresses and networks apply.")
      : T("Kernel SNI reads site names on TCP 443 only — on these ports only this rule's addresses and networks apply."));
  if (names && mode === "sni" && !only443)
    say(row.action === "block", row.action === "block"
      ? T("On Hybrid SNI a Block by site name acts on TCP 443 only — on other ports it blocks only this rule's addresses and networks.")
      : T("Hybrid SNI learns a site's addresses from its web connections — on other ports this rule matches the addresses already learned."));
  return out.length ? { warn: out.some(x => x.warn), text: out.map(x => x.text).join(" ") } : null;
}
const PROTO_LABEL = () => ({ tcp: "TCP", udp: "UDP", both: T("TCP and UDP") });
export const portsLabel = p => !p ? "" : portsClean(p.proto, p.list).bad ? T("ports unreadable")
  : p.list ? PROTO_LABEL()[p.proto] + " " + p.list.split(",").join(", ").replace(/-/g, "\u2013")
  : T("every {proto} port", { proto: PROTO_LABEL()[p.proto] });
function PortChip({ row, mode, blk }) {
  const n = portsNote(mode, row, blk);
  return html`<span class=${"whochip portchip" + (n && n.warn ? " warn" : "")} title=${(n ? n.text + " " : "") + T("Only this traffic takes the rule — the rest goes on to the rules below.")}>${n && n.warn
    ? html`<${Ic} i="warn"/>` : null}${portsLabel(portsOf(row))}</span>`;
}

export function gateReason(g, modeLabel) {
  switch (g.why) {
    case "unbuilt": return g.fix
      ? T("No engine on this node routes this kind yet — {v1} does.", { v1: (MODE_META[g.fix] || {}).label || g.fix })
      : T("This panel doesn't route this kind of address yet — it's classified and stored, but no node can match it.");
    case "list_off_node": return T("Switched off for this node in Settings ▸ Routing & Blocking.");
    case "person_ksni": return T("Kernel SNI on this node can't match hostnames for chosen people — only this rule's IP addresses and networks apply here. Switch to Hybrid SNI to match them.");
    case "prov_off": return T("This list's provider is switched off — turn it back on in Settings ▸ Geo data providers.");
    case "engine": return T("{v1} matches by IP only — this needs a host layer.", { v1: modeLabel });
    case "anchor": return T("{v1} only asks whether some text appears somewhere in a name — it never learns WHERE, so it can't anchor to a beginning, an ending or a label.", { v1: modeLabel });
    case "whole": return T("{v1} matches a whole name and everything under it — never a single label on its own, and never part of a name.", { v1: modeLabel });
    case "cap": return T("{v1} is all one interface can match by text — remove one to add another, or use a list instead.",
                         { v1: plural(TIER2_CAP, "text pattern") });
    default: return T("Not a valid address, IP range or AS number.");
  }
}

const _LIST_INFO_PENDING = {};
const _LIST_INFO_WAIT = {};
const _sizeOfInfo = d => {
  if (!d || !d.tiers) return { err: true };
  const host = (d.tiers.host || {}).n || 0, ip = (d.tiers.ip || {}).n || 0;
  if (host || ip) return { host, ip };
  const any = f => Object.keys(d.tiers).some(k => d.tiers[k] && d.tiers[k][f]);
  if (any("pending")) return null;
  if (any("failed")) return { err: true };
  return any("unsupported") ? { err: true, unsupported: true } : { host: 0, ip: 0 };
};
export function listSizeNow(id) {
  const cl = customListOf(id);
  if (cl) { const b = listBuckets(cl); return { host: b.host.length, ip: b.ip.length, pat: b.pat.length }; }
  const s = (Store.catSizes || {})[id];
  if (s && (s.host || s.ip)) return { host: s.host || 0, ip: s.ip || 0 };
  const c = _LIST_INFO_CACHE[id];
  return c ? _sizeOfInfo(c) : null;
}
const LIST_ASK_MS = 1500, LIST_WAIT_MS = 60000;
function askListInfo(id, onDone, opts) {
  const waiters = _LIST_INFO_WAIT[id] || (_LIST_INFO_WAIT[id] = new Set());
  waiters.add(onDone);
  if (_LIST_INFO_PENDING[id]) return;
  const { retry = false, waitMs = LIST_WAIT_MS, errOnGiveUp = true } = opts || {};
  const first = Date.now();
  _LIST_INFO_PENDING[id] = first;
  const fire = () => { for (const f of [...(_LIST_INFO_WAIT[id] || [])]) { try { f(); } catch (_) {   } } };
  const stop = d => { if (d) _LIST_INFO_CACHE[id] = d; delete _LIST_INFO_PENDING[id]; fire(); delete _LIST_INFO_WAIT[id]; };
  const go = force => api.listInfo(id, force).then(r => {
    const d = (r && r.ok) ? r.data : { err: true };
    const busy = !!(d.tiers && Object.keys(d.tiers).some(k => d.tiers[k] && d.tiers[k].pending));
    if (!busy) return stop(d);
    _LIST_INFO_CACHE[id] = d;
    if (Date.now() - first >= waitMs) return stop(errOnGiveUp ? { err: true } : null);
    fire();
    setTimeout(() => { if (_LIST_INFO_PENDING[id] === first) go(false); }, LIST_ASK_MS);
  }).catch(() => stop({ err: true }));
  go(!!retry);
}
function useListSizes(ids, onLand, tries) {
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    for (const id of ids) if (!listSizeNow(id)) askListInfo(id, () => live && onLand());
    return () => { live = false; };
  }, [key, tries]);
}

function useCoverage(method, selection) {
  const key = selection ? JSON.stringify(selection) : "";
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!key) return;
    let live = true, timer;
    const refresh = async () => {
      let data;
      try { data = (await api[method](JSON.parse(key)))?.data; } catch {}
      if (!live) return;
      const coverage = data || { state: "failed" };
      setResult({ key, coverage });
      timer = setTimeout(refresh, Object.values(coverage).some(t => t?.state === "pending") ? 2000 : 15000);
    };
    timer = setTimeout(refresh, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [method, key]);
  return key ? (result?.key === key ? result.coverage : { state: "pending" }) : null;
}

function coverageParts(coverage, { hosts = true, showZero = false } = {}) {
  if (!coverage) return [];
  if (coverage.state === "pending") return [T("Counting coverage…")];
  if (coverage.state === "failed") return [T("Coverage count unavailable")];
  const count = (n, what) => plural(n, what).replace(String(n), fmtNum(n));
  const out = [];
  const host = hosts ? coverage.host : null, ip = coverage.ip;
  if (host?.state === "ready") {
    if (host.names || showZero) out.push(count(host.names, "name"));
    if (host.patterns) out.push(count(host.patterns, "pattern"));
  } else if (host?.state === "pending") out.push(T("Counting domain names…"));
  else if (host?.state === "failed") out.push(T("Domain count unavailable"));
  if (ip?.state === "ready" && (ip.networks || showZero)) {
    out.push(T("IPv4: {v1}", { v1: count(ip.networks, "network") }));
  } else if (ip?.state === "pending") out.push(T("Counting IPv4 networks…"));
  else if (ip?.state === "failed") out.push(T("IPv4 network count unavailable"));
  return out;
}

export function BlockCoverageSummary({ sources, coverage, hosts }) {
  const draft = useCoverage("blockCoverage", sources?.length ? { sources } : null);
  const parts = coverageParts(sources ? draft : coverage, { hosts, showZero: true });
  return parts.length ? html`<span class="bk-count" title=${T("Coverage after merging the category sources and applying exceptions.")}>${parts.join(" · ")}</span>` : null;
}

function ListBadgeSize({ cat, onRetry }) {
  if (!knownListId(cat)) return html`<span class="tfb-size missing"
    title=${T("No list with this id — its provider may be switched off in Settings, or the list was withdrawn upstream. The rule keeps it, and it matches nothing until it comes back.")}>${T("list|not found")}</span>`;
  const sz = listSizeNow(cat);
  if (sz && !sz.err) return sizeSummary(sz.host, sz.ip) ? null : html`<span class="tfb-size missing"
    title=${T("The panel resolved this list and it holds nothing — check the id, or the source may have emptied it.")}>${T("list|empty")}</span>`;
  if (!sz) return html`<span class="tfb-size preparing" title=${T("The panel is fetching this list now — it routes as soon as it lands.")}>${T("preparing…")}</span>`;
  if (sz.unsupported) return html`<span class="tfb-size missing" title=${T("This list has no domain suffixes the routing engine can use.")}>${T("list|unsupported")}</span>`;
  return html`<button type="button" class="tfb-size notready" title=${T("The panel hasn't fetched this list yet. The rule saves either way and routes as soon as it lands — click to ask again.")}
    onClick=${e => { e.stopPropagation(); delete _LIST_INFO_CACHE[cat]; delete _LIST_INFO_PENDING[cat];
                     askListInfo(cat, onRetry, { retry: true }); onRetry(); }}>${T("not ready")}</button>`;
}

const readToken = (tok, mode, listEditor) => rrReadToken(tok, {
  allowKind: k => targetGate(mode, k).ok,
  knownList: listEditor ? () => false : knownListId,
});

export const knownListId = id => !!id && String(id).toLowerCase() !== "all" && (
  (Store.panelSettings?.custom_lists || []).some(l => l && l.id === id)
  || ((Store.catalogProviders || []).some(p => p.id === providerOf(id))
    && (!!_CATALOG_BY_ID[id] || !_CATALOG_INDEX || !_CATALOG_INDEX.length)));

const listSourceOf = id => provLabelOf(id) || (customListOf(id) ? T("Custom") : T("Unknown list"));

const listSizeOf = cat => { const sz = listSizeNow(cat);
  return sz && !sz.err ? (sizeSummary(sz.host, sz.ip) || T("empty")) : ""; };

function Badge({ b, gate, node, modeLabel, onRemove, onEdit, onFix, onRetry, onReveal, editing }) {
  const inert = !gate.ok;
  const isList = b.t === "list";
  const wide = !isList && KIND_WIDE[b.kind];
  const puny = isList ? "" : targetPuny(b.kind, b.value);
  const title = inert ? gateReason(gate, modeLabel)
    : isList ? T("{v1} list — the panel resolves it and every node routing it pulls the same copy.",
                 { v1: listSourceOf(b.id) })
      + (listSizeOf(b.id) ? " · " + listSizeOf(b.id) : "")
    : targetSentence(b.kind, b.value)
      + (puny ? " · " + T("Stored and matched as {v1}.", { v1: puny }) : "")
      + opTooLongNote(node, b.kind, b.value)
      + (gate.degraded ? " · " + T("On this node it is matched as text anywhere in the name.") : "")
      + (gate.note ? " · " + gate.note : "");
  return html`<span class=${"tfbadge" + (isList ? " list" : " tgt") + (wide ? " wide" : "") + (inert ? " inert" : "") + (gate.degraded ? " degraded" : "") + (editing ? " editing" : "")} title=${title}>
    ${inert ? html`<span class="tfb-g" aria-hidden="true">⊘</span>` : null}
    <button type="button" class="tfb-main" onClick=${() => (isList ? (onReveal && onReveal(b.id)) : onEdit())} title=${title}>
      <span class="tfb-lbl">${isList ? catLabelOf(b.id) : targetLabel(b.kind, b.value)}</span>
      ${isList ? html`<${ProvTag} id=${b.id} label=${listSourceOf(b.id)}/>${capBadges(_listCaps(b))}`
        : html`<span class=${"capb " + (wide ? "wide" : "kind")}>${KIND_LABEL()[b.kind]}</span>`}
    </button>
    ${isList ? html`<${ListBadgeSize} cat=${b.id} onRetry=${onRetry}/>` : null}
    ${inert && gate.fix && onFix ? html`<button type="button" class="tfb-fix" title=${T("Switch this node to {v1}", { v1: (MODE_META[gate.fix] || {}).label || gate.fix })}
      onClick=${e => { e.stopPropagation(); onFix(gate.fix); }}><${Ic} i="refresh"/></button>` : null}
    <button type="button" class="tfb-x" title=${T("Remove")} aria-label=${T("Remove {v1}", { v1: isList ? catLabelOf(b.id) : targetLabel(b.kind, b.value) })}
      onClick=${e => { e.stopPropagation(); onRemove(); }}><${Ic} i="x"/></button>
  </span>`;
}

const BADGE_CAP = 10;

export function unappliedLint({ asText, draft, q, editing, pending }) {
  if (asText) return String(draft || "").trim()
    ? ((pending || {}).text || T("This text hasn't been applied yet — press </> to apply it, or Escape to discard."))
    : "";
  const typed = String(q || "").trim();
  if (!typed || (editing && editing.b && typed === idnHost(editing.b.raw))) return "";
  return T("Text typed into this rule hasn't been added yet — press Enter to add it, or clear it.");
}

export function TargetField({ row, mode, node, tier2All, onChange, onSwitchMode, onLint, trailing, leading, listEditor }) {
  const [q, setQ] = useState("");
  const [holdQ, setHoldQ] = useState(null);
  const [more, setMore] = useState(1);
  const growing = useRef(false);
  useEffect(() => { growing.current = false; }, [more]);
  const [open, setOpen] = useState(false);
  const onKeyRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [act, setAct] = useState(-1);
  const [editing, setEditing] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [asText, setAsText] = useState(false);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(0);
  const [listType, setListType] = useState("all");
  const [cidx, setCidx] = useState(_CATALOG_INDEX);
  const [expand, setExpand] = useState(false);
  const [say, setSay] = useState("");
  const [pending, setPending] = useState({ text: "", forQ: null });
  const [tries, bump] = useState(0);
  const ref = useRef(null), popRef = useRef(null), inRef = useRef(null), resultsRef = useRef(null);
  const badges = row.badges || [];
  const modeLabel = (MODE_META[mode] || {}).label || mode;
  useListSizes(badges.filter(b => b.t === "list").map(b => b.id), () => bump(x => x + 1), tries);
  const hosts = !mode || routeCapsUsable(mode, { host: true });
  const lists = badges.filter(b => b.t === "list" && (hosts || _listCaps(b).ip || !_listCaps(b).host)).map(b => b.id).sort();
  const targets = badges.filter(b => b.t === "target" && (hosts || _ipKind(b.kind))).map(b => b.raw).sort();
  const coverage = useCoverage("routingCoverage", lists.length || targets.length
    ? { node: node || "", lists, targets, hosts } : null);

  const lq = (holdQ != null && !q) ? holdQ : q;
  const ql = lq.trim().toLowerCase();
  const term = lq.includes("*") ? "" : catalogWords(ql);
  const listTok = /^list:(.+)$/i.exec(q.trim());
  const readList = (listTok && !listEditor) ? { id: listTok[1].trim(), ok: knownListId(listTok[1].trim()) } : null;
  const noList = () => /^all$/i.test((readList || {}).id || "") ? T("For all traffic, use “Everything else” below the rules")
    : T("No list called {v1} on this panel", { v1: q.trim() });
  const reading = (!listTok && q.trim()) ? classify(q.trim()) : null;
  const t2Used = tier2All || 0;
  const readGate = reading && reading.kind !== "invalid"
    ? (g => g.ok && isTier2(reading.kind) && t2Used >= TIER2_CAP && !rowHasBadge(row, reading)
        ? { ok: false, why: "cap" } : g)(targetGate(mode, reading.kind))
    : null;

  const addAll = (toks, opts) => {
    const next = [...((opts && opts.base) || badges)], added = [], overCap = [];
    const t2Base = (opts && opts.base)
      ? t2Used - badges.filter(b => b.t === "target" && isTier2(b.kind)).length
                + opts.base.filter(b => b.t === "target" && isTier2(b.kind)).length
      : t2Used;
    let t2 = t2Base;
    for (const t of toks) { const b = t.t === "list" ? t : { t: "target", raw: t.raw, kind: t.kind, value: t.value };
      if (next.some(x => badgeIdentity(x) === badgeIdentity(b))) continue;
      if (b.t === "target" && isTier2(b.kind)) {
        if (t2 >= TIER2_CAP) { overCap.push(targetLabel(b.kind, b.value)); continue; }
        t2 += 1;
      }
      next.push(b); added.push(b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value)); }
    if (added.length && !(opts && opts.defer)) onChange(next);
    return { added, overCap, next };
  };
  const capSay = () => gateReason({ why: "cap" }, modeLabel);
  const commit = b => {
    const { added } = addAll([b]);
    setEditing(null);
    if (isMobile() && b.t === "list" && q.trim()) { setHoldQ(q); setQ(""); setAct(-1); setPending({ text: "", forQ: null }); }
    else { setHoldQ(null); setQ(""); setPage(0); setAct(-1); setPending({ text: "", forQ: null }); }
    setSay(added.length ? T("Added {v1}", { v1: added[0] }) : T("Already in this rule."));
    if (inRef.current) inRef.current.focus();
  };
  const commitList = id => commit({ t: "list", id });
  const commitTyped = () => {
    const parts = String(q || "").split(/[\s,]+/).filter(Boolean).map(t => ({ tok: t, r: readToken(t, mode, listEditor) }));
    if (!parts.length) return;
    const good = [], bad = [];
    for (const { tok, r } of parts) (r && r.b) ? good.push(r.b) : bad.push({ raw: tok, why: (r || {}).why });
    if (editing && !bad.length && good.length === 1 && badgeIdentity(good[0]) === badgeIdentity(editing.b)) {
      setEditing(null); setQ(""); setPage(0); setAct(-1); setPending({ text: "", forQ: null });
      return "";
    }
    const base = editing ? badges.filter(x => x !== editing.b) : badges;
    const { added, overCap, next } = addAll(good, { base, defer: true });
    const rest = [...bad.map(b => b.raw), ...overCap].join(" ");
    if (added.length || editing) { onChange(next); setEditing(null); }
    setQ(rest);
    const msg = bad.length ? (bad[0].why === "catch_all" && !listEditor ? T("For all traffic, use “Everything else” below the rules")
                              : bad[0].why === "unknown_list" || bad[0].why === "catch_all" ? (listEditor ? T("A list can't contain another list — add its addresses here instead") : T("No list called {v1} on this panel", { v1: bad[0].raw }))
                                                            : T("{v1} was not added", { v1: bad[0].raw }))
      : overCap.length ? capSay()
      : added.length ? T("Added {v1}", { v1: added.join(", ") })
      : T("Already in this rule.");
    setSay(msg);
    setPending({ text: rest ? msg : "", forQ: rest });
    setPage(0); setAct(-1);
    return rest;
  };
  const edit = i => { const b = badges[i]; if (b.t !== "target") return;
    if (editing && editing.b === b) { if (inRef.current) inRef.current.focus(); return; }
    if (commitTyped()) return;
    setEditing({ b });
    setQ(idnHost(b.raw));
    setPending({ text: "", forQ: null }); setPage(0); setAct(-1);
    if (inRef.current) inRef.current.focus(); };
  const remove = i => { const b = badges[i]; onChange(badges.filter((_, j) => j !== i));
    setSay(T("Removed {v1}", { v1: b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value) })); };
  const removeList = id => { onChange(badges.filter(b => !(b.t === "list" && b.id === id)));
    setSay(T("Removed {v1}", { v1: catLabelOf(id) }));
    if (inRef.current) inRef.current.focus(); };

  const ckey = catalogKey();
  useEffect(() => { if (open) { let live = true; loadCatalogIndex().then(x => live && setCidx(x)); return () => { live = false; }; } }, [open, ckey]);
  useEffect(() => { if (!open) { setMore(1); setHoldQ(null); } }, [open]);
  const place = () => { const el = ref.current; if (!el) return; setPos(placeWide(el)); };
  useEffect(() => {
    if (!open) return; place();
    if (isMobile()) history.pushState({ swgSearch: 1 }, "");
    const onMove = () => { if (!isMobile()) place(); };
    const onDoc = e => { const t = e.target;
      const inTrail = !!(t && t.closest && t.closest(".tf-trail"));
      if (inTrail || !((ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t)))) setOpen(false); };
    const mine = t => !!t && ((ref.current && ref.current.contains(t)) || (popRef.current && popRef.current.contains(t)));
    const onEsc = e => { const a = document.activeElement;
      if (e.key !== "Escape" || a === inRef.current || (a && a !== document.body && !mine(a))) return;
      e.stopPropagation(); e.preventDefault(); onKeyRef.current(e); };
    const onFocus = e => { if (!mine(e.target)) setOpen(false); };
    window.addEventListener("scroll", onMove, true); window.addEventListener("resize", onMove);
    document.addEventListener("mousedown", onDoc, true); window.addEventListener("keydown", onEsc, true);
    document.addEventListener("focusin", onFocus, true);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); document.removeEventListener("mousedown", onDoc, true); window.removeEventListener("keydown", onEsc, true); document.removeEventListener("focusin", onFocus, true); };
  }, [open]);

  const per = isMobile() ? 50 * more : 50;
  const chooseType = type => {
    setListType(type); setPage(0); setMore(1); setAct(-1);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  };
  const matchesType = it => listType === "all" || it.caps?.[listType];
  const _mine = (Store.panelSettings?.custom_lists || [])
    .filter(l => l && (!ql || (term && catalogPrefix([l.title, l.id].map(catalogWords), term))))
    .map(l => ({ id: l.id, provider: "custom", provider_label: T("Custom"), caps: customCaps(l),
                 disp: l.title || l.id, label: l.title || l.id, list: l }))
    .filter(matchesType)
    .sort((a, b) => a.disp.toLowerCase().localeCompare(b.disp.toLowerCase()));
  const byName = (a, b) => a.disp.localeCompare(b.disp);
  const _hits = (ql.length !== 1 && cidx)
    ? cidx.filter(it => matchesType(it) && (!ql || (term && catalogPrefix(it.words, term)))).sort(byName) : [];
  const _qn = ql.replace(/[^a-z0-9]/g, "");
  const _provHit = _qn.length >= 3 && !lq.includes("*") ? (Store.catalogProviders || []).filter(p => p.enabled
    && String(p.label || "").toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(_qn)) : [];
  const _provGroups = _provHit.map(p => ({ p, all: (cidx || []).filter(it => it.provider === p.id) }));
  const _hitIds = new Set(_hits.map(it => it.id));
  const _cat = _hits.concat(..._provGroups.map(g => g.all.filter(it => matchesType(it) && !_hitIds.has(it.id))
    .sort(byName).map(it => ({ ...it, grpProv: g.p.label }))));
  const searchingLists = !listEditor && !!ql && (_cat.length || _mine.length);
  const _provWait = _provGroups.filter(g => !g.all.length && (g.p.status === "downloading" || g.p.status === "failed" || g.p.error)).map(g => g.p);
  const pages = Math.max(1, Math.ceil(_cat.length / per));
  const pageNow = Math.min(page, pages - 1);
  const catPage = _cat.slice(pageNow * per, (pageNow + 1) * per);
  const has = id => badges.some(b => b.t === "list" && b.id === id);
  const revealList = id => {
    setOpen(true); setEditing(null);
    chooseType("all");
    const local = !!customListOf(id);
    if (local) { setQ(""); setPage(0); }
    else {
      const term = catalogWords(catRawId(id));
      setQ(catRawId(id));
      const hits = (cidx || []).filter(it => catalogPrefix(it.words, term)).sort(byName);
      const at = hits.findIndex(it => it.id === id);
      setPage(at >= 0 && !isMobile() ? Math.floor(at / per) : 0);
      if (at >= 0 && isMobile()) setMore(Math.floor(at / 50) + 1);
    }
    setReveal(id);
  };

  const rows = [];
  if (reading && reading.kind !== "invalid") rows.push({ k: "use" });
  if (!listEditor) {
    _mine.forEach(it => rows.push({ k: "list", it, grp: T("Your lists") }));
    catPage.forEach(it => rows.push({ k: "list", it, grp: it.grpProv ? T("Lists from {v1}", { v1: it.grpProv }) : T("Provider catalog") }));
  }
  const activeRow = rows[Math.min(act, rows.length - 1)];
  useEffect(() => { setAct(open && rows.length === 1 ? 0 : -1); }, [rows.length, q, open]);

  useEffect(() => {
    if (!reveal || !open) return;
    let timer = 0, tries = 0, passes = 0;
    const sel = '[data-lid="' + String(reveal).replace(/["\\]/g, "\\$&") + '"]';
    const centre = () => {
      const root = popRef.current, el = root && root.querySelector(sel);
      if (!el) { if (++tries < 25) timer = setTimeout(centre, 20); else setReveal(null); return; }
      const list = root.querySelector(".catpick-list") || root;
      const lr = list.getBoundingClientRect(), er = el.getBoundingClientRect();
      list.scrollTop += (er.top + er.height / 2) - (lr.top + lr.height / 2);
      if (passes === 0) {
        const tf = [...root.querySelectorAll(".tfrow")];
        setAct(tf.indexOf(el) + (root.querySelector(".tfuse") ? 1 : 0));
      }
      if (++passes < 6) timer = setTimeout(centre, 70); else setReveal(null);
    };
    timer = setTimeout(centre, 0);
    return () => clearTimeout(timer);
  }, [reveal, open, page, q]);

  const toText = () => { loadCatalogIndex();
    const typed = q.trim();
    setDraft([...badges.map(b => (editing && b === editing.b) ? typed : badgeText(b)).filter(Boolean),
              ...(!editing && typed ? [typed] : [])].join("\n"));
    setAsText(true); setOpen(false); setEditing(null); setPending({ text: "", forQ: null }); };
  const lintSent = useRef("");
  useEffect(() => {
    if (!onLint) return;
    const v = unappliedLint({ asText, draft, q, editing, pending });
    if (v === lintSent.current) return;
    lintSent.current = v;
    onLint(v);
  }, [asText, draft, q, editing, pending.text]);

  const fromText = () => {
    const good = [], bad = [];
    for (const line of draft.split(/\n/).map(x => x.trim()).filter(Boolean)) {
      const parts = line.split(/[\s,]+/).filter(Boolean).map(t => readToken(t, mode, listEditor));
      if (parts.length && parts.every(r => r && r.b)) good.push(...parts.map(r => r.b));
      else bad.push({ raw: line, why: (parts.find(r => r && r.bad) || {}).why });
    }
    const { added, overCap, next } = addAll(good, { base: [], defer: true });
    const rest = [...bad.map(x => x.raw), ...overCap].join("\n");
    if (rest) {
      const msg = bad.length
        ? (bad[0].why === "catch_all" && !listEditor ? T("For all traffic, use “Everything else” below the rules")
          : bad[0].why === "unknown_list" || bad[0].why === "catch_all" ? (listEditor ? T("A list can't contain another list — add its addresses here instead") : T("No list called {v1} on this panel", { v1: bad[0].raw }))
                                         : T("{v1} was not added", { v1: bad[0].raw }))
        : capSay();
      setSay(msg); setPending({ text: msg, forQ: null });
      return;
    }
    onChange(next);
    setAsText(false); setDraft(""); setQ(""); setPending({ text: "", forQ: null });
    setSay(added.length ? T("{v1} in this rule", { v1: plural(added.length, "target") }) : T("Rule emptied."));
  };

  const onKey = e => {
    if (e.key === "Escape") {
      if (editing) { e.stopPropagation();
        setQ(""); setEditing(null); setOpen(false); setPending({ text: "", forQ: null }); setAct(-1);
        setSay(T("Edit discarded — {v1} is unchanged", { v1: targetLabel(editing.b.kind, editing.b.value) }));
        return; }
      if (open) { e.stopPropagation(); setOpen(false); }
      return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct(a => Math.min(a + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setAct(a => Math.max(a - 1, -1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeRow && activeRow.k === "list") { const id = activeRow.it.id;
        if (has(id)) removeList(id); else if (listGate(mode, id, node).ok) commitList(id);
        return; }
      if (readList) { if (readList.ok) commitList(readList.id);
        else { const m = noList(); setSay(m); setPending({ text: m, forQ: q }); }
        return; }
      if (readGate && readGate.ok) commitTyped();
      return;
    }
    if (e.key === "," || e.key === " " || (e.key === "Tab" && q.trim() && readGate && readGate.ok)) {
      if (e.key === " " && !q.trim()) return;
      e.preventDefault(); commitTyped(); return; }
    if (e.key === "Backspace" && !q && badges.length) { e.preventDefault(); edit(badges.length - 1); }
  };
  onKeyRef.current = onKey;
  const onPaste = e => {
    const txt = (e.clipboardData || {}).getData ? e.clipboardData.getData("text") : "";
    if (!txt || !/[\s,]/.test(txt.trim())) return;
    e.preventDefault();
    const parts = txt.split(/[\s,]+/).filter(Boolean).map(t => ({ tok: t, r: readToken(t, mode, listEditor) }));
    const good = parts.filter(x => x.r && x.r.b).map(x => x.r.b);
    const bad = parts.filter(x => !(x.r && x.r.b)).map(x => ({ raw: x.tok }));
    const { added, overCap } = addAll(good);
    const rest = [...bad.map(b => b.raw), ...overCap].join(" ");
    setQ(rest);
    const msg = overCap.length ? capSay()
      : T("{v1} added, {v2} left to fix", { v1: added.length, v2: bad.length });
    setSay(msg);
    setPending({ text: rest ? msg : "", forQ: rest });
  };

  const leftovers = /[\s,]/.test((q || "").trim());

  const meter = [plural(badges.length, "entry"), ...coverageParts(coverage)].join(" · ");

  const shown = expand ? badges : badges.slice(0, BADGE_CAP);
  const hidden = badges.length - shown.length;
  const fixBtn = g => g.fix && onSwitchMode
    ? html` <button type="button" class="linkbtn" onClick=${e => { e.stopPropagation(); setOpen(false); onSwitchMode(g.fix); }}>${T("Switch this node to {v1}", { v1: (MODE_META[g.fix] || {}).label || g.fix })}</button>`
    : null;
  const listRow = it => { const g = listGate(mode, it.id, node), added = has(it.id), i = rows.findIndex(r => r.it === it);
    return html`<div class=${"tfrow" + (i >= 0 && i === act ? " act" : "")} key=${it.id} data-lid=${it.id} onMouseEnter=${() => setAct(i)}>
      <${CatalogRow} it=${it} added=${added} preview=${ql.length >= 2} onPick=${() => (added ? removeList(it.id) : g.ok && commitList(it.id))}/>
      ${!g.ok ? html`<div class="tfrow-why">${gateReason(g, modeLabel)}${fixBtn(g)}</div>` : null}
    </div>`; };
  let lastGrp = null;

  const vtog = (on) => listEditor
    ? html`<button type="button" class=${"tf-vtog inline" + (on ? " on" : "")} aria-pressed=${on ? "true" : "false"}
        title=${on ? T("Back to badges — reads every line and turns it into a target. Escape discards instead.")
                   : T("Show as text — copy it out, paste it in, or edit every target at once")}
        onClick=${on ? fromText : toText}><${Ic} i="code"/><span>${on ? T("Show badges") : T("Show text")}</span></button>`
    : html`<button type="button" class=${"tf-vtog" + (on ? " on" : "")} aria-pressed=${on ? "true" : "false"}
        title=${on ? T("Back to badges — reads every line and turns it into a target. Escape discards instead.")
                   : T("Show as text — copy it out, paste it in, or edit every target at once")}
        onClick=${on ? fromText : toText}><${Ic} i="code"/></button>`;

  if (asText) return html`<div class="tfield" ref=${ref}>
    ${listEditor ? null : vtog(true)}
    <textarea class="tf-text" spellcheck="false" autocomplete="off" autocorrect="off" data-enter="self" data-noautofocus="1"
      aria-label=${T("Targets, one per line")} placeholder=${T("One target per line — example.com, *.ru, 10.0.0.0/8, AS13335")}
      value=${draft} onInput=${e => setDraft(e.target.value)}
      onKeyDown=${e => { if (e.key !== "Escape") return; e.stopPropagation(); e.preventDefault();
        setAsText(false); setDraft(""); setPending({ text: "", forQ: null });
        setSay(T("Text discarded — the rule is unchanged.")); }}
      ref=${el => { if (el && !el._tf) { el._tf = 1; requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } catch {} }); } }}/>
    <div class="tf-foot">
      <span class="tf-lstart">${leading ? html`<span class="tf-lead">${leading}</span>` : null}
        <span class="tf-say">${plural(draft.split(/\n/).filter(x => x.trim()).length, "line")}</span></span>
      ${pending.text ? html`<span class="tf-lint err">${pending.text}</span>` : null}
      ${listEditor ? html`<span class="grow"></span>${vtog(true)}` : null}
      ${trailing ? html`<span class="tf-trail">${trailing}</span>` : null}
    </div>
    <span class="tf-live" aria-live="polite">${say}</span>
  </div>`;

  return html`<div class=${"tfield" + (open && isMobile() ? " m-tfsearch" : "")} ref=${ref}>
    ${listEditor ? null : vtog(false)}
    <div class="tf-box" onClick=${() => inRef.current && inRef.current.focus()}>
      ${shown.map((b, i) => html`<${Badge} key=${badgeIdentity(b) + i} b=${b} gate=${rowGate(row, mode, node, b)} node=${node} modeLabel=${modeLabel}
        editing=${!!(editing && editing.b === b)}
        onRemove=${() => remove(i)} onEdit=${() => edit(i)} onFix=${onSwitchMode} onRetry=${() => bump(x => x + 1)}
        onReveal=${revealList}/>`)}
      ${hidden > 0 ? html`<button type="button" class="tf-more" onClick=${() => setExpand(true)}>${T("+{v1} more", { v1: hidden })}</button>` : null}
      ${expand && badges.length > BADGE_CAP ? html`<button type="button" class="tf-more" onClick=${() => setExpand(false)}>${T("show fewer")}</button>` : null}
      <input ref=${inRef} class=${"tf-in" + (reading && reading.kind === "invalid" && !searchingLists ? " bad" : "")} type="text" spellcheck="false" autocomplete="off"
        data-enter=${open ? "self" : null} data-noautofocus="1"
        role="combobox" aria-expanded=${open ? "true" : "false"} aria-autocomplete="list"
        placeholder=${badges.length ? T("add another…")
          : listEditor ? T("Address, IP range, AS number or pattern…")
          : T("Search a service, or type an address, IP range or AS number…")}
        value=${q} onInput=${e => { setHoldQ(null); setMore(1); setQ(e.target.value); setPage(0); setAct(-1); setOpen(true); }}
        onFocus=${() => setOpen(true)} onKeyDown=${onKey} onPaste=${onPaste}/>
    </div>
    <div class="tf-foot">
      <span class="tf-lstart">${leading ? html`<span class="tf-lead">${leading}</span>` : null}
        ${badges.length ? html`<span class="tf-meter" title=${T("Domain and IPv4 coverage after merging the sources resolved by the panel.")}>${meter}</span>` : null}</span>
      ${leftovers ? (pending.text && pending.forQ === q
            ? html`<span class="tf-lint err">${pending.text}</span>` : null)
        : (listEditor && listTok) ? html`<span class="tf-lint err">${T("A list can't contain another list — add its addresses here instead")}</span>`
        : readList && !readList.ok ? html`<span class="tf-lint err">${noList()}</span>`
        : reading && reading.kind === "invalid" && !searchingLists ? html`<span class="tf-lint err">${targetWhy(reading.why, q)}</span>`
        : reading ? (open ? null : html`<span class="tf-say">${readGate && readGate.ok ? targetSentence(reading.kind, reading.value) : gateReason(readGate || {}, modeLabel)}</span>`)
        : !badges.length ? html`<span class="tf-say">${listEditor ? T("Type an address, IP range, AS number or pattern.")
              : Trich("Try a service name like *YouTube*, or type an address, IP range or AS number.")}</span>` : null}
      ${listEditor ? html`<span class="grow"></span>${vtog(false)}` : null}
      ${trailing ? html`<span class="tf-trail">${trailing}</span>` : null}
    </div>
    <span class="tf-live" aria-live="polite">${say}</span>
    ${open && pos && (!listEditor || rows.length) ? html`<${Portal}><div ref=${popRef} class=${"catpick-pop wide tfpop" + (pos.flip ? " flip" : "")}
        style=${"left:" + pos.left + "px;top:" + pos.top + "px;width:" + pos.width + "px;--catpick-maxh:" + (pos.maxh - 119) + "px"}>
      <div class="tfpop-head">
        ${listEditor ? null : html`<div class="tfpop-types" role="group" aria-label=${T("List type")}>
          ${[["all", T("All list types")], ["ip", T("IP networks")], ["host", T("Domains")]].map(([type, label]) =>
            html`<button key=${type} type="button" aria-pressed=${listType === type}
                onMouseDown=${e => e.preventDefault()} onClick=${() => chooseType(type)}>${label}</button>`)}
        </div>`}
        <button type="button" class="pop-x" aria-label=${T("Close")} title=${T("Close")} onClick=${() => { setOpen(false); setHoldQ(null); if (isMobile() && inRef.current) inRef.current.blur(); }}><${Ic} i="x"/></button>
      </div>
      <div class="catpick-list" ref=${resultsRef} onScroll=${isMobile() ? (e => { const l = e.currentTarget;
          if (!growing.current && _cat.length > per && l.scrollTop + l.clientHeight > l.scrollHeight - 400) { growing.current = true; setMore(m => m + 1); } }) : null}>
        ${readList ? html`<div class="catpick-grp">${T("Use what you typed")}</div>
          <${readList.ok ? "button" : "div"} type=${readList.ok ? "button" : null} class=${"tfuse" + (act <= 0 ? " act" : "") + (readList.ok ? "" : " off")}
            onMouseEnter=${() => setAct(0)} onClick=${readList.ok ? () => commitList(readList.id) : null}>
            <span class="tfbadge list"><span class="tfb-lbl">${readList.ok ? catLabelOf(readList.id) : readList.id}</span></span>
            <span class="tfuse-say">${readList.ok ? T("Add this list to the rule") : noList()}</span>
          <//>` : null}
        ${reading && reading.kind !== "invalid" ? html`<div class="catpick-grp">${T("Use what you typed")}</div>
          <${readGate.ok ? "button" : "div"} type=${readGate.ok ? "button" : null} class=${"tfuse" + (act <= 0 ? " act" : "") + (readGate.ok ? "" : " off")}
            onMouseEnter=${() => setAct(0)} onClick=${readGate.ok ? () => commitTyped() : null}>
            <span class=${"tfbadge tgt" + (KIND_WIDE[reading.kind] ? " wide" : "")}><span class="tfb-lbl">${targetLabel(reading.kind, reading.value)}</span>
              <span class=${"capb " + (KIND_WIDE[reading.kind] ? "wide" : "kind")}>${KIND_LABEL()[reading.kind]}</span></span>
            <span class="tfuse-say">${readGate.ok
              ? targetSentence(reading.kind, reading.value) + opTooLongNote(node, reading.kind, reading.value)
              : gateReason(readGate, modeLabel)}</span>
            ${!readGate.ok ? fixBtn(readGate) : null}
          <//>` : null}
        ${rows.filter(r => r.k === "list").map(r => { const head = r.grp !== lastGrp ? (lastGrp = r.grp) : null;
          return html`<${Fragment}>${head ? html`<div class="catpick-grp">${head}</div>` : null}${listRow(r.it)}<//>`; })}
        ${!listEditor ? _provWait.map(p => html`<div class="catpick-empty">${p.status === "downloading"
            ? T("{v1} is still downloading its list catalog — its lists appear here when it finishes.", { v1: p.label })
            : T("{v1} could not download its list catalog — retry it in Settings ▸ Geo data providers.", { v1: p.label })}</div>`) : null}
        ${!listEditor && ql.length !== 1 && !q.includes("*") && !_cat.length && !_mine.length && !_provWait.length && cidx
          ? html`<div class="catpick-empty">${listType !== "all" ? T("No lists of this type match.") : ql ? T("No list matches “{q}”.", { q }) : T("No lists available.")}</div>` : null}
        ${!listEditor && ql.length === 1 ? html`<div class="catpick-empty">${T("Keep typing to search the provider catalog.")}</div>` : null}
      </div>
      ${_cat.length > per && !isMobile() ? html`<div class="catpick-foot">
        <span class="catpick-count">${T("{v1}–{v2} of {v3}", { v1: pageNow * per + 1, v2: Math.min(_cat.length, (pageNow + 1) * per), v3: _cat.length })}</span><span class="grow"></span>
        <div class="catpick-nav">
          <button type="button" class="btn btn-mini" disabled=${pageNow === 0} onClick=${() => { setPage(pageNow - 1); setAct(-1); }} >${T("‹ Prev")}</button>
          <button type="button" class="btn btn-mini" disabled=${pageNow >= pages - 1} onClick=${() => { setPage(pageNow + 1); setAct(-1); }} >${T("Next ›")}</button>
        </div></div>` : null}
      ${isMobile() ? html`<button type="button" class="btn btn-primary m-tfdone" onClick=${() => {
          if (q.trim() && rows.length === 1) {
            const r0 = rows[0];
            if (r0.k === "list" && !has(r0.it.id)) {
              const g = listGate(mode, r0.it.id, node);
              if (!g.ok) { setSay(gateReason(g, modeLabel)); return; }
              commitList(r0.it.id);
            }
            else if (readGate && readGate.ok && commitTyped()) return;
          }
          setOpen(false); setHoldQ(null); if (inRef.current) inRef.current.blur(); }}>
        <${Ic} i="check"/> ${T("Done")}</button>` : null}
    </div><//>` : null}
  </div>`;
}

export function RoutingRules({ node, iface, rows, catchAll, exitIps, directIp, onChange, scope, blk, mode }) {
  const nodeScope = scope === "node";
  const others = (Store.nodes || []).filter(n => n.id !== node);
  const _nrec = (Store.nodes || []).find(n => n.id === node);
  const _nlist = !nodeScope && Array.isArray((_nrec || {}).default_routing) ? _nrec.default_routing : null;
  const _nfall = _nlist ? _nlist.filter(r => r && r.enabled !== false && r.category !== "all" && r.aud !== "cascaded") : [];
  const _ncatch = _nlist ? rulesToRows(_nlist).catchAll : null;
  const exits = (_nrec || {}).exits || [];
  const _mode = mode || (_nrec ? (_nrec.routing_mode || "kernel") : "");
  const tlsFallback = _mode === "sni" && !!Store.stats?.[node]?.smartroute?.tls_fallback;
  const dispRows = rows || [];
  const ips = exitIps || {};
  const shownIps = !nodeScope && _nlist && !catchAll ? { ...((_nrec || {}).default_routing_exit_ips || {}), ...ips } : ips;
  const emit = (rs, ca, xs, dip) => onChange(rs.map(r => r._rowId || r.legacy ? r : { ...r, _rowId: newRuleRowId() }),
    ca === undefined ? catchAll : ca, xs === undefined ? ips : xs, dip === undefined ? directIp : dip);

  const rs = useReorder(dispRows.map(r => r._gid), ids => emit(ids.map(id => dispRows.find(r => r._gid === id)).filter(Boolean)), "y", { container: ".rrlist", card: ".rrrow" });
  const setRow = (gid, patch) => emit(dispRows.map(r => r._gid === gid ? { ...r, ...patch } : r));
  const addRow = () => emit([...dispRows, { _gid: newGid(), enabled: true, badges: [], action: others[0] ? "exit" : "direct", node: (others[0] || {}).id || "" }]);
  const destLabelOf = r => r.action === "exit" ? T("Forward to {node}", { node: Store.nodeName(r.node) })
    : r.action === "dev" ? ((exits.find(x => String(x.id) === String(r.exit_id)) || {}).label || (exits.find(x => String(x.id) === String(r.exit_id)) || {}).device || T("an exit"))
    : r.action === "block" ? T("Block") : T("Direct (this node)");
  const destVal = r => r.action === "exit" ? "exit|" + (r.node || "")
    : r.action === "dev" ? "dev|" + (r.exit_id || "") : r.action;
  const onDest = (gid, v) => setRow(gid, destPatch(v));
  const destPatch = v => { const [a, x] = v.split("|");
    return a === "exit" ? { action: "exit", node: x, exit_id: "" }
      : a === "dev" ? { action: "dev", exit_id: x, node: "" }
      : { action: a, node: "", exit_id: "" }; };
  const goneDest = v => {
    const [a, x] = String(v || "").split("|");
    if (a === "exit" && x && !others.some(n => n.id === x))
      return { value: v, label: T("A node that is no longer here"),
               why: T("This rule forwards to a node that is not in this panel any more, so it routes nothing and traffic takes the next matching rule instead. Choose another destination, or delete the rule.") };
    if (a === "dev" && x && !(exits.some(e => String(e.id) === x)))
      return { value: v, label: T("An exit that is no longer here"),
               why: T("This rule leaves by an exit that is not on this node any more, so it routes nothing and traffic takes the next matching rule instead. Choose another destination, or delete the rule.") };
    return null;
  };
  const destOpts = (withDefault, held) => {
    const _gone = goneDest(held);
    const [action, id] = String(held || "").split("|");
    return [
      ...(withDefault && !nodeScope ? [{ value: "__dflt__", label: T("Node rules") }] : []),
      { value: "direct", label: T("Direct (this node)") },
      ...(others.length ? [{ group: T("Forward to node (cascade)"),
                             items: others.map(n => ({ value: "exit|" + n.id, label: T("Forward to {node}", { node: n.name }) })) }] : []),
      { value: "block", label: T("Block") },
      ...(_gone ? [{ value: _gone.value, label: _gone.label, className: "bad", refuse: _gone.why }] : []),
      ...(!_gone && action === "dev" && id ? [{ value: held, label: destLabelOf({ action, exit_id: id }) }] : []),
    ];
  };
  const tuneBtn = (on, open) => html`<button type="button" class=${"iconbtn rrgear" + (on ? " on" : "")} title=${T("Rule settings")}
    aria-label=${T("Rule settings")} onClick=${open}><${Ic} i="sliders"/></button>`;
  const dipOn = !nodeScope && directIp !== undefined;
  const whoOf = useWhoReport(node, iface, dispRows.filter(r => r.who).map(r => r.who));
  const openRule = row => row && pushModal(html`<${RuleSettingsSheet} node=${node} iface=${iface} row=${row} exitIps=${ips}
    directIp=${dipOn ? directIp || "" : undefined} dests=${destOpts(false, destVal(row))} dest=${destVal(row)} mode=${_mode} nodeScope=${nodeScope}
    onApply=${(v, who, xs, aud, dip, ports) => emit(dispRows.map(r => r._gid === row._gid
      ? { ...r, ...destPatch(v), who: who || undefined, aud: nodeScope ? (aud || undefined) : r.aud, ports: nodeScope ? r.ports : (ports || undefined) } : r), undefined, xs, dip)}/>`);
  const openCatch = () => pushModal(html`<${RuleSettingsSheet} node=${node} iface=${iface} everyone exitIps=${ips} nodeScope=${nodeScope}
    directIp=${dipOn ? directIp || "" : undefined} row=${catchAll || { action: "direct" }} dests=${destOpts(true, catchVal)} dest=${catchVal} mode=${_mode}
    onApply=${(v, _who, xs, _aud, dip) => setCatch(v, xs, dip)}/>`);
  const switchMode = target => { const mm = MODE_META[target] || {};
    openConfirm({ title: T("Switch {v1} to {v2}?", { v1: _nrec ? _nrec.name : T("this node"), v2: mm.label || target }), warn: true,
      confirmLabel: T("Switch mode"),
      body: T("This reprovisions the node so it can match by hostname. IP rules keep working, and the rule changes you have open stay open — save them afterwards."),
      onConfirm: async () => {
        const r = await api.nodeUpdate({ id: node, routing_mode: target });
        if (!r || !r.ok) return toast(srvText(r) || T("Couldn't switch mode"), "err");
        await Store.poll();
        toast(T("Switched to {v1} — save to apply your rules.", { v1: mm.label || target }), "ok");
      } });
  };
  const catchVal = !catchAll ? (nodeScope ? "direct" : "__dflt__")
    : catchAll.action === "exit" ? "exit|" + (catchAll.node || "")
    : catchAll.action === "dev" ? "dev|" + (catchAll.exit_id || "") : catchAll.action;
  const setCatch = (v, xs, dip) => {
    if (v === "__dflt__") return emit(dispRows, null, xs, dip);
    const p = destPatch(v);
    emit(dispRows, (p.action === "exit" && p.node) || (p.action === "dev" && p.exit_id)
      || p.action === "block" || p.action === "direct"
      ? { enabled: true, category: "all", ...p } : null, xs, dip); };
  const onCatch = v => setCatch(v);
  const lints = rowLints(dispRows, destVal, { mode: _mode, isName: _nameBadge });
  const nodeRows = _nlist && !catchAll ? rulesToRows(_nfall).rows : [];
  const nodeTaken = dispRows.map(r => (_mode === "sni" || _mode === "forcedns") && nodeRows.length
    ? [...new Map(nodeRows.filter(nr => destVal(nr) !== destVal(r)).flatMap(nr => (nr.badges || [])
        .filter(nb => (r.badges || []).some(b => badgeCovers(b, nb)))).map(nb => [badgeIdentity(nb), nb])).values()] : []);
  const tier2All = tier2Count(dispRows, customListOf);
  return html`<div class="field">
    <div class="rrlist" ...${rs.container()}>${dispRows.map((row, ri) => {
      const badges = row.badges || [];
      const { dupes, takenBy } = lints[ri];
      const takenFew = _mode === "sni" || _mode === "forcedns" ? lints[ri].takenFew : [];
      const self = row.action === "exit" && row.node === node;
      const inert = badges.filter(b => !rowGate(row, _mode, node, b).ok);
      const asns = badges.filter(b => b.t === "target" && b.kind === "asn").map(b => b.raw).join(", ");
      const it = rs.item(row._gid);
      return html`<div key=${row._gid} class=${"rrrow rrrow-b" + it.cls + ((dupes.length || self || inert.length || takenBy.length || takenFew.length || row.locked) ? " warn" : "")} data-rid=${it.rid}>
        <span class="drag-grip" title=${T("Drag to reorder")} ...${rs.grip(row._gid)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>
        ${(() => { const _xip = row.action === "exit" ? shownIps[row.node] : "", _dip = row.action === "direct" && dipOn ? directIp : "";
          const dest = html`${row.who ? html`<${WhoChip} who=${row.who} rep=${whoOf(row.who)} node=${node}/>` : null}
              ${row.ports ? html`<${PortChip} row=${row} mode=${_mode} blk=${blk}/>` : null}
              ${row.aud ? html`<span class="whochip" title=${row.aud === "local" ? T("This node's own clients") : T("Traffic cascaded in from other nodes")}><${Ic} i="users"/>${row.aud === "local" ? T("chip|own clients") : T("chip|cascaded in")}</span>` : null}
              ${_xip ? html`<${AsChip} ip=${_xip} node=${row.node}/>` : _dip ? html`<${AsChip} ip=${_dip} node=${node} direct/>` : null}
              ${row.locked ? null : tuneBtn(row.who || row.aud || row.ports || _xip || _dip, () => openRule(row))}<span class="rrdest" title=${row.locked ? T("Stored as written — this rule is kept exactly as it is.") : ""}>
            <${Dropdown} disabled=${!!row.locked} value=${destVal(row)}
              onChange=${v => onDest(row._gid, v)} options=${destOpts(false, destVal(row))}/>
          </span>`;
          const removeBtn = html`<button class="xbtn" title=${T("Remove rule")} onClick=${() => {
            const n = (row.badges || []).length;
            const drop = () => emit(dispRows.filter(x => x._gid !== row._gid));
            if (!n) return drop();
            openConfirm({ title: T("Remove rule"), confirmLabel: T("Remove"), danger: true,
              body: T("This rule routes {v1}. Removing it here is not written to the node until you save the interface.", { v1: plural(n, "target") }),
              onConfirm: drop });
          }}><${Ic} i="x"/></button>`;
          return row.locked
          ? html`<div class="tfield locked"><div class="tf-box">${badges.map((b, i) => html`<span key=${i} class="tfbadge tgt inert"><span class="tfb-g" aria-hidden="true">⊘</span>
              <span class="tfb-main"><span class="tfb-lbl">${targetLabel(b.kind, b.value)}</span><span class="capb wide">${KIND_LABEL()[b.kind] || T("kind|zone")}</span></span></span>`)}</div>
            <div class="tf-foot"><span class="tf-lead">${removeBtn}</span><span class="tf-lint" title=${T("Nothing on any node has ever read a stored TLD rule. It is kept exactly as written until the migration converts it.")}>${T("A legacy TLD rule — kept as written, and it has never routed anything.")}</span>
              <span class="tf-trail">${dest}</span></div></div>`
          : html`<${TargetField} row=${row} mode=${_mode} node=${node} onSwitchMode=${switchMode}
              onLint=${msg => setRow(row._gid, { _draft: msg || undefined })}
              tier2All=${tier2All} trailing=${dest} leading=${removeBtn}
              onChange=${bs => setRow(row._gid, { badges: bs })}/>`; })()}
        ${self ? html`<span class="rrlint">${T("can't exit via itself")}</span>`
          : dupes.length ? html`<span class="rrlint">${T("already sent somewhere else above: {toks}", { toks: dupes.slice(0, 3).map(b => b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value)).join(", ") + (dupes.length > 3 ? "…" : "") })}</span>`
          : takenBy.length ? html`<span class="rrlint">${T("a more specific rule below wins these hosts: {toks}", { toks: takenBy.slice(0, 3).map(b => targetLabel(b.kind, b.value)).join(", ") + (takenBy.length > 3 ? "…" : "") })}</span>`
          : takenFew.length ? html`<span class="rrlint">${nodeScope
              ? T("a more specific rule below wins these hosts for the traffic it names: {toks}", { toks: takenFew.slice(0, 3).map(b => targetLabel(b.kind, b.value)).join(", ") + (takenFew.length > 3 ? "…" : "") })
              : T("a more specific rule below wins these hosts for the people it names: {toks}", { toks: takenFew.slice(0, 3).map(b => targetLabel(b.kind, b.value)).join(", ") + (takenFew.length > 3 ? "…" : "") })}</span>`
          : nodeTaken[ri].length ? html`<span class="rrlint">${T("a more specific rule in this node's default wins these hosts: {toks}", { toks: nodeTaken[ri].slice(0, 3).map(b => targetLabel(b.kind, b.value)).join(", ") + (nodeTaken[ri].length > 3 ? "…" : "") })}</span>` : null}
        ${asns ? html`<${AsnHint} targets=${asns}/>` : null}
        ${nodeScope && row.action === "exit" && row.node && row.aud !== "local" && others.some(n => n.id === row.node)
          ? html`<div class="hint rrnote">${T("Traffic that came from {node} skips this rule — it would go back where it came from.", { node: Store.nodeName(row.node) })}</div>` : null}
      </div>`;
    })}</div>
    <div class="rrfoot">
      <span class="rrfoot-lead"><button class="btn btn-mini" onClick=${addRow}><${Ic} i="plus"/> ${T("Add rule")}</button><b class="rrfoot-label">${T("Everything else")}</b></span>
      <span class="tf-trail">
        ${catchAll && catchAll.action === "exit" && ips[catchAll.node] ? html`<${AsChip} ip=${ips[catchAll.node]} node=${catchAll.node}/>`
          : catchAll && catchAll.action === "direct" && dipOn && directIp ? html`<${AsChip} ip=${directIp} node=${node} direct/>` : null}
        ${tuneBtn((catchAll && catchAll.action === "exit" && ips[catchAll.node]) || (catchAll && catchAll.action === "direct" && dipOn && directIp), openCatch)}
        <span class="rrarrow">→</span>
        <span class="rrdest rrcatch"><${Dropdown} value=${catchVal}
          onChange=${onCatch} options=${destOpts(true, catchVal)}/></span>
      </span>
    </div>
    ${!nodeScope && _nlist && !catchAll ? html`<div class="hint rrnote">${T("Node rules (Settings → Network)")} · ${nodeRows.slice(0, 10).map(r => html`<span>${(r.badges || []).slice(0, 3).map(b => b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value)).join(", ")}${(r.badges || []).length > 3 ? "…" : ""} → ${destLabelOf(r)}</span> · `)}${nodeRows.length > 10 ? T("…and {v1} more", { v1: nodeRows.length - 10 }) + " · " : ""}<span>${T("everything else")} → ${_ncatch ? (goneDest(destVal(_ncatch)) || {}).label || destLabelOf(_ncatch) : T("Direct (this node)")}</span></div>` : null}
    ${nodeScope && _mode === "sni_kernel" && ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) < 2 && dispRows.some(r => r.aud !== "local")
      ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Kernel SNI on this node can't match hostnames for traffic cascaded in — only IP addresses and networks apply to it.")}</span></div>` : null}
    ${allBlockPreemptsNames(_mode, dispRows) >= 0 ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("A Block to every address (0.0.0.0/0) stops each new connection before its site name is read, so the rules above it that match by site name never take effect: those sites are blocked too. Route them by address instead, or give the Block ports that leave out TCP 443.")}</span></div>` : null}
    ${catchAllPreemptsNames(_mode, dispRows, catchAll) ? (tlsFallback
      ? html`<div class="hint">${T("Hybrid SNI checks the visible hostname after the TCP handshake on port 443. Rejected TLS connections receive a TCP reset.")}</div>`
      : html`<div class="notice warn"><${Ic} i="warn"/><span>${T("“Everything else → Block” stops each new connection before its site name is read, so the rules above that match by site name never take effect: those sites are blocked too. Route them by address (an IP range or a network) instead, or block by name only what you don't want.")}</span></div>`) : null}
    ${dispRows.length || catchAll ? null : html`<div class="hint">${others.length
      ? Trich("No rules yet. Add a rule to send some destinations through another node, or set *Everything else* to channel everything.")
      : Trich("No rules yet. Add a rule to send some destinations out a device on this node or block them, or set *Everything else* to say where the rest goes.")}</div>`}
  </div>`;
}

function useWhoReport(node, iface, whos) {
  const key = JSON.stringify([node, iface || "", whos.map(canonWho)]);
  const [rep, setRep] = useState({});
  useEffect(() => {
    if (!whos.length || !iface) return;
    let ok = true;
    const h = setTimeout(async () => {
      try {
        const r = await api.routingWho({ node, iface, rows: whos.map(canonWho) });
        if (ok && r && r.ok) setRep(Object.fromEntries(whos.map((w, i) => [JSON.stringify(canonWho(w)), ((r.data || {}).rows || [])[i] || null])));
      } catch (e) {   }
    }, 250);
    return () => { ok = false; clearTimeout(h); };
  }, [key]);
  return w => rep[JSON.stringify(canonWho(w))] || null;
}

const whoTally = (rep, only) => { const c = { ok: 0, soon: 0, no: 0 };
  for (const [pid, st] of Object.entries((rep || {}).devices || {})) if (!only || only(pid)) c[st] = (c[st] || 0) + 1;
  return c; };
export const whoEntryHas = (e, pid) => e.k === "p" ? pid === e.id : Store.peer(pid)?.user_id === e.id;
export const whoEntryName = e => e.k === "u" ? (Store.user(e.id)?.name || T("a user who no longer exists"))
  : (Store.peer(e.id) ? deviceLabel(Store.peer(e.id)) : T("a device that no longer exists"));
export const whoEntries = w => [...(w.users || []).map(id => ({ k: "u", id })), ...(w.peers || []).map(id => ({ k: "p", id }))];

const whoNoWhy = (rep, node) => rep && rep.node_old
  ? T("{v1} needs an update to route per person — these rules apply to nobody there until it is.", { v1: Store.nodeName(node) })
  : T("Can't be told apart on this build — the rule doesn't apply to it.");

function WhoDevices({ rep, e, node }) {
  if (!rep) return html`<span class="faint">…</span>`;
  const c = whoTally(rep, pid => whoEntryHas(e, pid));
  const parts = [[c.ok, "ok"], [c.soon, "soon"], [c.no, "no"]].filter(([n]) => n);
  const trigger = html`<span class=${"netdev" + (parts.length ? "" : " none")}>${parts.length
    ? parts.map(([n, k]) => html`<span class=${"netdev-n " + k}>${n}</span>`) : T("no device here")}${parts.length ? html`<${Ic} i="info"/>` : null}</span>`;
  if (!parts.length) return trigger;
  return html`<${Popover} hoverOnly cls="netdev-pop" popCls="netroute-bub" trigger=${trigger}>
    <span class="netroute-h">${whoEntryName(e)}</span>
    ${c.ok ? html`<div class="netbub-row nb-dot ok">${T("{devices} in the rule", { devices: plural(c.ok, "device") })}</div>` : null}
    ${c.soon ? html`<div class="netbub-row nb-dot soon">${plural(c.soon, "device")} — ${T("Not connected yet — the rule applies once it connects.")}</div>` : null}
    ${c.no ? html`<div class="netbub-row nb-dot no">${plural(c.no, "device")} — ${whoNoWhy(rep, node)}</div>` : null}
  <//>`;
}

const whoText = t => !t.no ? plural(t.ok, "device")
  : t.ok ? T("{devices} · {v1} not covered", { devices: plural(t.ok, "device"), v1: t.no })
  : T("{devices} not covered", { devices: plural(t.no, "device") });
function WhoChip({ who, rep, node }) {
  const c = whoTally(rep), list = whoEntries(who);
  const text = !rep ? "…" : whoText(c);
  const trigger = html`<span class=${"whochip" + (rep && c.no ? " bad" : rep && !c.ok ? " warn" : "")}><${Ic} i=${rep && c.no ? "warn" : "users"}/>${text}</span>`;
  return html`<${Popover} hoverOnly cls="whochip-pop" popCls="netroute-bub" trigger=${trigger}>
      <span class="netroute-h">${T("Chosen people and devices")}</span>
      <${CapList} items=${list} cap=${10} row=${e => html`<div class="netbub-row" key=${e.k + e.id}><b>${whoEntryName(e)}</b> — ${rep
        ? whoText(whoTally(rep, pid => whoEntryHas(e, pid))) : "…"}</div>`}/>
      ${c.soon ? html`<div class="netbub-row nb-dot soon">${plural(c.soon, "device")} — ${T("Not connected yet — the rule applies once it connects.")}</div>` : null}
      ${c.no ? html`<div class="netbub-row nb-dot no">${T("{devices} not covered", { devices: plural(c.no, "device") })} — ${whoNoWhy(rep, node)}</div>` : null}
      ${rep && !c.ok && !c.soon && !c.no ? html`<div class="netbub-row sub">${T("None of the chosen people has a device on this interface — the rule routes nothing until one does.")}</div>` : null}
    <//>`;
}

function AsChip({ ip, node, direct }) {
  const rec = (Store.nodes || []).find(n => n.id === node) || {};
  const gone = !!((rec.ips || []).length && !(rec.ips || []).includes(ip));
  return html`<span class=${"whochip" + (gone ? " bad" : "")} title=${gone
    ? T("{v1} isn't reporting this address. Traffic on this rule leaves it with a source it can't receive replies on, so it goes nowhere until the address is back or you choose another.", { v1: Store.nodeName(node) })
    : direct ? T("Everything this interface sends straight out of {v1} leaves as this address.", { v1: Store.nodeName(node) })
    : T("Every rule that sends this interface through {v1} leaves as this address.", { v1: Store.nodeName(node) })}>${gone
    ? html`<${Ic} i="warn"/>` : null}${T("as {v1}", { v1: ip })}</span>`;
}

export const peersOn = (node, iface) => Store.recon.peers.filter(p => (p.targets || []).some(t => t && t.node === node && t.iface === iface));
export const whoCount = w => (w.users || []).length + (w.peers || []).length;
const whoSorted = (sel, k, key) => sel[key].slice().sort((a, b) => whoEntryName({ k, id: a }).localeCompare(whoEntryName({ k, id: b }))).map(id => ({ k, id }));

export function WhoPicker({ sel, setSel, here, cell, onTyped, empty }) {
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const list = [...whoSorted(sel, "u", "users"), ...whoSorted(sel, "p", "peers")];
  const ql = q.trim().toLowerCase();
  const rows = ql ? list.filter(e => whoEntryName(e).toLowerCase().includes(ql)) : list;
  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE)), pg = Math.min(page, pages);
  const addTo = (k, id) => { if (!id || sel[k].includes(id)) return; setSel(s => ({ ...s, [k]: [...s[k], id].sort() })); setQ(""); };
  const drop = e => { const k = e.k === "u" ? "users" : "peers"; setSel(s => ({ ...s, [k]: s[k].filter(x => x !== e.id) })); };
  return html`<${Fragment}>
      <div class="sharebar" onInput=${onTyped} onChange=${onTyped}>
        <div class="sharebar-add"><${UserPicker} value=${null} placeholder=${T("Add a person or device…")} exclude=${sel.users}
          onChange=${id => addTo("users", id)}
          devices=${here.filter(p => !sel.peers.includes(p.id)).map(p => ({ id: p.id, name: deviceLabel(p), sub: (Store.user(p.user_id) || {}).name || "" }))}
          onDevice=${id => addTo("peers", id)}/></div>
        ${list.length > LIST_PAGE || q ? html`<input class="sharebar-filter" value=${q} data-enter="self" placeholder=${T("Filter the list…")}
            aria-label=${T("Filter the list…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
      </div>
      ${list.length ? html`<div class="sharegrid gmembers" role="table">
          <div class="sharegrid-h" role="row"><span>${T("col|User or device")}</span><span>${T("Devices here")}</span><span></span></div>
          ${pageSlice(rows, pg).map(e => { const gone = e.k === "u" ? !Store.user(e.id) : !Store.peer(e.id);
            return html`<div class=${"sharegrid-r" + (e.k === "u" ? "" : " grp") + (gone ? " gone" : "")} role="row" key=${e.k + ":" + e.id}>
            <span class="nm">${e.k === "p" ? html`<${Ic} i="device"/>` : null}${whoEntryName(e)}${e.k === "p" && !gone && Store.user(Store.peer(e.id).user_id)
              ? html`<span class="faint sharegrid-sub">${Store.user(Store.peer(e.id).user_id).name}</span>` : null}</span>
            <span>${cell(e)}</span>
            <span><button type="button" class="btn btn-ghost btn-mini" title=${T("Remove {name}", { name: whoEntryName(e) })}
              aria-label=${T("Remove {name}", { name: whoEntryName(e) })} onClick=${() => drop(e)}><${Ic} i="x"/></button></span></div>`; })}
          ${!rows.length ? html`<div class="sharegrid-empty">${T("Nobody on the list matches “{q}”.", { q })}</div>` : null}
        </div>
        <${ListPager} page=${pg} setPage=${setPage} total=${rows.length}/>`
      : html`<div class="sharegrid-empty">${empty}</div>`}
  <//>`;
}

function RuleSettingsSheet({ node, iface, row, dests, dest: dest0, mode, everyone, exitIps, directIp, onApply, nodeScope }) {
  useStore();
  const [dest, setDest] = useState(dest0);
  const [aud, setAud] = useState(nodeScope && !everyone ? (row.aud || "") : "");
  const [chosen, setChosen] = useState(!nodeScope && !everyone && !!row.who);
  const [sel, setSel] = useState(() => canonWho(row.who || {}));
  const withPorts = !nodeScope && !everyone;
  const [proto, setProto] = useState(portsOf(row) ? String(portsOf(row).proto || "") : "both");
  const [plist, setPlist] = useState(String((portsOf(row) || {}).list || "").split(",").join(", "));
  const pc = proto === "both" && !plist.trim() ? null : portsClean(proto, plist);
  const pBad = !!(withPorts && pc && pc.bad);
  const [ips, setIps] = useState(() => ({ ...(exitIps || {}) }));
  const dirtyRef = useRef(false), closeRef = useRef(null), cleanRef = useRef(null), base = useRef(null);
  const asNode = (/^exit\|(.+)$/.exec(dest) || ["", ""])[1];
  const asRec = asNode ? (Store.nodes || []).find(n => n.id === asNode) : null;
  const asIps = (asRec || {}).ips || [];
  const ip = (asRec && ips[asNode]) || "";
  const setIp = v => setIps(m => { const nx = { ...m }; if (v) nx[asNode] = v; else delete nx[asNode]; return nx; });
  const [dip, setDip] = useState(directIp || "");
  const dRec = dest === "direct" && directIp !== undefined ? (Store.nodes || []).find(n => n.id === node) : null;
  const dIps = (dRec || {}).ips || [];
  const addr = asRec ? { node: asNode, ips: asIps, value: ip, set: setIp } : dRec ? { node, ips: dIps, value: dip, set: setDip } : null;
  const addrStale = !!(addr && addr.value && addr.ips.length && !addr.ips.includes(addr.value));
  const key = JSON.stringify([dest, chosen, chosen ? sel : null, ips, aud, dip, withPorts ? [proto, plist] : null]);
  if (base.current === null) base.current = key;
  dirtyRef.current = key !== base.current;
  const typedOnly = () => { if (cleanRef.current) cleanRef.current(); };
  const whoOf = useWhoReport(node, iface, chosen ? [sel] : []);
  const rep = chosen ? whoOf(sel) : null;
  const here = peersOn(node, iface);
  const empty = chosen && !whoCount(sel);
  const c = whoTally(rep);
  const apply = () => { if (empty || pBad) return; onApply(dest, chosen ? sel : null, ips, aud, directIp !== undefined ? dip : undefined,
    withPorts && pc ? { proto: pc.proto, list: pc.list } : null);
    dirtyRef.current = false; if (cleanRef.current) cleanRef.current(); closeModal(); };
  const count = [sel.users.length ? plural(sel.users.length, "user") : "",
                 sel.peers.length ? plural(sel.peers.length, "device") : ""].filter(Boolean).join(", ");
  const kSni = chosen && mode === "sni_kernel" && ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) < 2;
  return html`<${Sheet} title=${T("Rule settings")} width=${680} dirtyRef=${dirtyRef} closeRef=${closeRef} cleanRef=${cleanRef}
    foot=${html`<${Fragment}><span class="faint">${chosen && count ? T("{v1} chosen", { v1: count }) : ""}</span><span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" onClick=${() => (closeRef.current ? closeRef.current() : closeModal())}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${empty || pBad} title=${empty ? T("Choose at least one person or device, or pick “Everyone on this interface”.") : ""} onClick=${apply}>${T("Apply")}</button><//>`}>
    ${(() => {
      const b = (txt, color) => html`<b style=${color ? "color:" + color : ""}>${txt}</b>`;
      const k = kindOf(node, iface);
      const ifB = b(iface, ifaceColor(k === "awg" && awgGen(node, iface) === "3.1" ? "awg3" : k));
      const nB = addr ? b(Store.nodeName(addr.node), Store.nodeColor(addr.node)) : null;
      const aB = addr && addr.value ? b(addr.value, Store.nodeColor(addr.node)) : null;
      const note = !addr ? "" : !addr.ips.length ? Trich("{v1} hasn't reported its addresses yet — type one it has, or leave this on Auto.", { v1: nB })
        : dRec ? (aB ? Trich("Everything {iface} sends straight out of {node} leaves as {addr}.", { iface: ifB, node: nB, addr: aB })
                     : Trich("Everything {iface} sends straight out of {node} leaves as {node}'s default address.", { iface: ifB, node: nB }))
        : nodeScope ? (aB ? Trich("Every rule of this node's default that sends traffic through {node} leaves as {addr}.", { node: nB, addr: aB })
                          : Trich("Every rule of this node's default that sends traffic through {node} leaves as {node}'s default address.", { node: nB }))
        : aB ? Trich("Every rule that sends {iface} through {node} leaves as {addr}.", { iface: ifB, node: nB, addr: aB })
        : Trich("Every rule that sends {iface} through {node} leaves as {node}'s default address.", { iface: ifB, node: nB });
      return html`<div class="row2 rs-where">
        <div class="field"><label>${T("Leaves by")}</label>
          <span class="rrdest rsdest"><${Dropdown} value=${dest} onChange=${setDest} options=${dests}/></span></div>
        ${addr ? html`<div class="field"><label>${T("As address")}</label>
          <span class="rrdest rsdest"><${NodeIpPick} key=${addr.node} ips=${addr.ips} value=${addr.value} onChange=${addr.set}
            auto=${T("Auto ({v1}'s default)", { v1: Store.nodeName(addr.node) })}/></span></div>` : null}
      </div>
      ${note ? html`<div class="hint rs-where-note">${note}</div>` : null}
      ${addrStale ? html`<div class="hint err rs-where-note">${T("{v1} isn't reporting this address. Traffic on this rule leaves it with a source it can't receive replies on, so it goes nowhere until the address is back or you choose another.", { v1: Store.nodeName(addr.node) })}</div>` : null}`; })()}
    ${withPorts ? html`<div class="row2 rs-ports">
        <div class="field"><label>${T("Protocol")}</label>
          <div class="dpsw netsw-share netsw-aud" role="radiogroup" aria-label=${T("Protocol")}>${[["both", T("proto|Any")], ["tcp", "TCP"], ["udp", "UDP"]].map(([v, l]) => html`<button type="button" role="radio"
            aria-checked=${proto === v} class=${proto === v ? "on" : ""} onClick=${() => setProto(v)}>${l}</button>`)}</div></div>
        <div class="field"><label for="rs-ports-in">${T("Ports")}</label>
          <input id="rs-ports-in" class=${pBad ? "bad" : ""} value=${plist} autocomplete="off" spellcheck="false" placeholder=${T("all ports — or 443, 8000-8100")}
            aria-invalid=${pBad ? "true" : "false"} onInput=${e => setPlist(e.target.value)}/></div>
      </div>
      <div class=${"hint rs-where-note" + (pBad ? " err" : "")}>${pBad ? (pc.bad === "proto" ? T("Choose a protocol.") : pc.bad === "empty" ? T("“Any” with no port is every connection — choose TCP or UDP, or name a port.")
          : pc.bad === "too_many" ? T("At most 32 ports or ranges.") : T("Write ports and ranges from 1 to 65535, like 443, 8000-8100."))
        : pc ? T("Only {ports} to this destination takes the rule — the rest goes on to the rules below.", { ports: portsLabel(pc) })
        : T("Every port. Choose TCP or UDP, or name ports, to narrow the rule.")}</div>` : null}
    <div class="field"><label>${T("For whom")}</label>
      ${nodeScope && everyone ? html`<div class="hint">${T("All — this node's clients and traffic cascaded in")}</div>`
       : nodeScope ? html`<div class="dpsw netsw-share netsw-aud" role="radiogroup" aria-label=${T("For whom")}>${[["", T("aud|Everyone"), T("All — this node's clients and traffic cascaded in")],
           ["local", T("aud|Own clients"), T("This node's own clients")], ["cascaded", T("aud|Cascaded in"), T("Traffic cascaded in from other nodes")]].map(([v, l, full]) => html`<button type="button" role="radio"
        aria-checked=${aud === v} class=${aud === v ? "on" : ""} title=${full} onClick=${() => setAud(v)}>${l}</button>`)}</div>`
       : everyone ? html`<div class="hint">${T("Everyone on this interface")}</div>`
       : html`<div class="dpsw netsw-share" role="radiogroup" aria-label=${T("For whom")}>${[[false, T("Everyone on this interface")], [true, T("Chosen people and devices")]].map(([v, l]) => html`<button type="button" role="radio"
        aria-checked=${chosen === v} class=${chosen === v ? "on" : ""} onClick=${() => setChosen(v)}>${l}</button>`)}</div>`}</div>
    ${chosen ? html`<${Fragment}>
      <${WhoPicker} sel=${sel} setSel=${setSel} here=${here} onTyped=${typedOnly} cell=${e => html`<${WhoDevices} rep=${rep} e=${e} node=${node}/>`}
        empty=${T("Choose at least one person or device, or pick “Everyone on this interface”.")}/>
      ${!empty && rep && !c.ok && !c.soon && !c.no ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("None of the chosen people has a device on this interface — the rule routes nothing until one does.")}</span></div>` : null}
      ${rep && rep.node_old ? html`<div class="notice warn"><${Ic} i="warn"/><span>${whoNoWhy(rep, node)}</span></div>` : null}
      ${kSni ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Kernel SNI on this node can't match hostnames for chosen people — only this rule's IP addresses and networks apply here. Switch to Hybrid SNI to match them.")}</span></div>` : null}
    <//>` : null}
  <//>`;
}

const _asnCache = {};
const _asnSubs = new Set();
const asnKey = v => { const m = /^(?:as:?)?(\d{1,10})$/i.exec(String(v == null ? "" : v).trim());
                      return m ? String(Number(m[1])) : ""; };
function useAsnCounts(raw) {
  const nums = [...new Set((raw || []).map(asnKey).filter(Boolean))];
  const [, force] = useState(0);
  useEffect(() => {
    const bump = () => force(x => x + 1);
    _asnSubs.add(bump);
    return () => { _asnSubs.delete(bump); };
  }, []);
  useEffect(() => {
    nums.forEach(n => {
      if (_asnCache[n] !== undefined) return;
      _asnCache[n] = "loading";
      api.asnCount(n).then(r => { _asnCache[n] = (r && r.ok && r.data) ? r.data : { count: 0 };
                                  _asnSubs.forEach(f => f()); });
    });
  }, [nums.join(",")]);
}
export const asnNets = value => {
  const c = _asnCache[asnKey(value)];
  return (c && typeof c === "object" && c.count) || 0;
};
export function AsnHint({ targets }) {
  const asns = [...new Set((String(targets || "").match(/\bas:?\d{1,10}\b/gi) || []).map(asnKey).filter(Boolean))];
  useAsnCounts(asns);
  if (!asns.length) return null;
  return html`<div class="asn-hint">${asns.map(n => { const c = _asnCache[n]; const load = c === "loading" || c === undefined;
    const cnt = (c && typeof c === "object") ? c.count : 0;
    return html`<span class=${"asn-tok " + (load ? "load" : cnt ? "ok" : "bad")}>AS${n} ${load ? T("resolving…") : cnt ? T("→ {v1}", { v1: plural(cnt, "prefix") }) : T("→ not found")}</span>`; })}</div>`;
}

export function EgressPicker({ node, value, onChange, noRules }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const ipIfaces = nrec.ip_ifaces || [];
  const onIf = v => {
    if (v === value.mode) return;
    onChange({ ...value, mode: v, nic: "", ip: v === "smart" ? (value.mode === "direct" ? value.ip : value.ownIp) : "" });
  };
  return html`<${Fragment}>
    <div class="field"><label>${T("Interface routing")}</label>
      <${Dropdown} value=${value.mode} onChange=${onIf} options=${[
        { value: "node", label: T("Inherit node rules") },
        { value: "direct", label: T("All traffic direct") },
        { value: "smart", label: T("Interface rules"), className: "egopt-mode" },
      ]}/>
      ${value.mode === "node" ? html`<div class="hint">${T("Uses this node's routing rules from Settings → Network.")}</div>`
        : value.mode === "direct" ? html`<div class="hint">${T("Exits directly from this node without inheriting its routing rules.")}</div>` : null}</div>
    ${value.mode === "smart"
      ? (noRules ? null : html`<${RoutingRules} node=${node} rows=${value.rows || []} catchAll=${value.catchAll} onChange=${(rows, catchAll) => onChange({ ...value, rows, catchAll })}/>`)
      : value.mode === "direct" ? html`<div class="field"><label>${T("Outbound (egress) IP")}</label>
      <${NodeIpPick} key=${value.nic || ""} ips=${ipIfaces.filter(p => !value.nic || p.iface === value.nic).map(p => p.ip)}
        value=${value.ip || ""} onChange=${ip => onChange({ ...value, ip })} auto=${T("val|Auto")}/>
      <div class="hint">${T("Source IP clients egress from.")}</div></div>` : null}
  <//>`;
}

export const natPinApplies = eg => eg?.mode === "direct";

export function NatSourcePick({ node, value, onChange }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const ipIfaces = nrec.ip_ifaces || [];
  const nics = (nrec.ether_ifaces && nrec.ether_ifaces.length)
    ? nrec.ether_ifaces.filter(n => !isSelfContainedName(n) && !n.startsWith("swg_"))
    : [...new Set(ipIfaces.map(p => p.iface))].filter(n => !isSelfContainedName(n) && !n.startsWith("swg_"));
  const nicNote = value.mode === "direct" && value.nic
    && nrec.wan_iface && value.nic !== nrec.wan_iface
    ? T("This node's traffic leaves by {v2}, not {v1}, so this rule can never match and clients would leave with no NAT at all. Choose “Off”, or {v2} — unless you route to {v1} yourself.",
        { v1: value.nic, v2: nrec.wan_iface })
    : "";
  if (!nics.length || !natPinApplies(value)) return null;
  return html`<${Fragment}>
    <div class="field secdiv"><label>${T("Extra NAT")}</label></div>
    <div class="field">
    <${Dropdown} value=${value.nic || ""}
      onChange=${n => onChange({ ...value, nic: n })}
      options=${[{ value: "", label: T("val|Off") }, ...nics.map(n => ({ value: n, label: n }))]}/>
    <div class="hint">${T("This doesn't send traffic out that card. It only changes the source address of traffic that already leaves by it — use it when you route to that card yourself, outside the panel. To leave by a card, pick it under “Leave by a device”.")}</div>
    ${nicNote ? html`<div class="hint err">${nicNote}</div>` : null}
    </div>
  <//>`;
}

const interfaceEgressMode = m => {
  if (m.egress_mode === "local") return "direct";
  if (!m.egress_mode || m.egress_mode === "direct")
    return m.egress_ip || m.wan_iface ? "direct" : "node";
  return m.egress_mode;
};

export const egressInit = m => {
  const { rows, catchAll } = rulesToRows(m.routing || []);
  const mode = interfaceEgressMode(m);
  const legacy = mode === "forward" && m.egress_node ? { action: "exit", node: m.egress_node }
    : mode === "exit" && m.exit_id ? { action: "dev", exit_id: m.exit_id } : null;
  const legacyMode = mode === "forward" || mode === "exit";
  const exitIps = legacy?.action === "exit" && m.egress_ip ? { [legacy.node]: m.egress_ip } : {};
  for (const r of rows) for (const b of (r.badges || [])) b.stored = true;
  return { mode: legacyMode ? "smart" : mode,
    nic: legacyMode ? "" : (m.wan_iface || ""), ip: legacyMode ? "" : (m.egress_ip || ""),
    ownIp: legacyMode ? "" : (m.egress_ip || ""), legacy,
    rows: legacyMode ? [] : rows,
    catchAll: legacyMode ? { enabled: true, category: "all", ...(legacy || { action: "direct" }) }
      : catchAll || (mode === "smart" || rows.length ? null : { enabled: true, category: "all", action: "direct" }),
    exitIps: legacyMode ? exitIps : { ...(m.routing_exit_ips || {}) },
    p2p: m.p2p && m.p2p.action ? { ...m.p2p } : null };
};

export function egressSaveBlock(eg, mode) {
  if (!eg || eg.mode !== "smart") return null;
  for (const row of (eg.rows || [])) {
    if (row.locked) continue;
    if (row._draft) return row._draft;
    if (row.action === "dev" && !String(row.exit_id || "").trim())
      return T("Choose which exit this rule leaves by.");
    const badges = row.badges || [];
    if (!badges.length) return T("A rule needs at least one service, address or IP range.");
    const bad = badges.filter(b => b.t === "target" && b.kind === "invalid").map(b => b.raw);
    if (bad.length) {
      const list = bad.slice(0, 4).join(", ") + (bad.length > 4 ? "…" : "");
      return bad.length > 1 ? T("Invalid targets: {list}", { list }) : T("Invalid target: {list}", { list });
    }
    if (mode === "kernel") {
      const doms = badges.filter(b => b.t === "target" && b.kind === "site" && !b.stored).map(b => targetLabel(b.kind, b.value));
      if (doms.length) {
        const list = doms.slice(0, 3).join(", ") + (doms.length > 3 ? "…" : "");
        return doms.length > 1
          ? T("IP-only mode routes by IP only — remove the domains ({list}), or switch this node to Hybrid SNI.", { list })
          : T("IP-only mode routes by IP only — remove the domain ({list}), or switch this node to Hybrid SNI.", { list });
      }
    }
  }
  return null;
}

export const candOf = (node, name) =>
  ((node || {}).exit_candidates || []).find(c => c && c.name === String(name || "").trim()) || null;
export const candAddr = (node, name) => String((candOf(node, name) || {}).address || "").split("/")[0];

export const cardAddrs = (node, name) => (((node || {}).ip_ifaces) || [])
  .filter(p => p && String(p.iface) === String(name || "") && p.ip).map(p => p.ip);

export const isCardName = (node, name) => (((node || {}).ether_ifaces) || []).includes(String(name || ""));

export const cardGateway = (node, name) => String((((node || {}).ether_gws) || {})[String(name || "")] || "");

export const exitProv = x => String((x || {}).provider || "warp");
export const EXIT_KINDS = ["warp", "profile", "socks5"];
export const exitIsDialin = x => exitProv(x) === "profile" && !!((x || {}).profile || {}).listen_port
  && !((x || {}).profile || {}).endpoint;

const exitFellSay = ex => ex.killswitch
  ? T("Meanwhile the kill-switch is holding everything that uses this exit.")
  : T("Meanwhile everything that uses this exit goes out through this node's own IP.");
const exitStalledSay = ex => ex.killswitch
  ? T("This exit has stopped carrying traffic, so the kill-switch is holding everything that uses it. It resumes by itself once the exit works again.")
  : T("This exit has stopped carrying traffic, so everything that uses it is going out through this node's own IP. It moves back by itself once the exit works again.");
const exitRecoveringSay = () => T("Traffic crosses it again — the node routes back through it within a minute.");

export function exitHealth(x, node) {
  const ex = x || {};
  const l = ex.live || {};
  const cand = candOf(node, ex.device);
  const why = String(ex.why_not || "").trim();
  if (why === "kind_unsupported") return { state: "unsupported", tone: "warn", icon: "warn", dot: "unknown",
    why: T("This node needs the 1.8.11 update for SOCKS5 exits.") };
  if (why) return { state: "refused", tone: "bad", dot: "bad", why: T("Refused: {v1}", { v1: why }) };
  if ((node || {}).exits_unsupported)
    return { state: "unsupported", tone: "warn", icon: "warn", dot: "unknown",
             why: T("This node's software is too old for exits. Update the node — nothing else needs changing.") };
  if ((ex.producer || "adopted") !== "imported") {
    if (!cand) return { state: "unreported", tone: "", dot: "unknown",
                        why: T("This node hasn't reported a device by this name.") };
    if (cand.up === false) return { state: "down", tone: "warn", dot: "down",
                                    why: T("The node reports this device is not up.") };
    const nt = l.no_traffic;
    const fresh = !nodeStale((node || {}).id);
    if (nt && Number.isFinite(nt.back_in) && fresh)
      return { state: "recovering", tone: "busy", icon: "refresh", dot: "down", why: exitRecoveringSay() + " " + exitFellSay(ex) };
    if (nt) return { state: "stalled", tone: "warn", icon: "warn", dot: "down", why: exitStalledSay(ex)
      + (String(nt.why || "").trim() ? " " + T("The node reports: {v1}", { v1: String(nt.why).trim() }) : "") };
    return { state: "ok", tone: "", dot: "up", why: T("Up on the node.") };
  }
  if (ex.cfg_sig && l.cfg_sig && l.cfg_sig !== ex.cfg_sig && !nodeStale((node || {}).id))
    return { state: "configuring", tone: "busy", icon: "refresh", dot: "unknown",
             why: T("Applying your changes on the node…") };
  if (l.error && exitIsDialin(ex) && !l.listen_port && (!ex.cfg_sig || l.cfg_sig === ex.cfg_sig)) return { state: "unsupported", tone: "warn", icon: "warn", dot: "unknown",
    why: T("This node needs the 1.8.11 update for dial-in exits.") };
  if (l.setup && !l.error) return { state: "creating", tone: "busy", icon: "refresh", dot: "unknown", why: T(l.setup) };
  if (l.error) return { state: "failed", tone: "bad", dot: "bad",
    why: T(l.error) + (l.retry_in ? " " + T("Retrying in {v1}.", { v1: l.retry_in >= 60
      ? T("{v1} min", { v1: Math.round(l.retry_in / 60) }) : T("{v1} s", { v1: l.retry_in }) }) : "") };
  if (!l.device) return { state: "creating", tone: "busy", icon: "refresh", dot: "unknown",
                          why: T("Waiting for the node to set this up…") };
  const probe = String(((l.no_traffic || {}).why) || (l.trace || {}).err || "").trim();
  const said = t => probe ? t + " " + T("The node reports: {v1}", { v1: probe }) : t;
  if (!l.up) return { state: "down", tone: "warn", dot: "down",
                      why: said(T("The node reports this device is not up.")) };
  const _fell = l.no_traffic ? " " + exitFellSay(ex) : "";
  if (exitIsDialin(ex) && !(l.handshake > 0 && l.handshake <= 180)) return { state: "waiting", tone: "warn", icon: "warn", dot: "down",
    why: T("Waiting for the router to connect. Check the router is on, its config imported, and UDP {v1} open on this node.",
           { v1: (ex.profile || {}).listen_port }) + _fell };
  if (l.no_traffic && Number.isFinite(l.no_traffic.back_in) && !nodeStale((node || {}).id)) return { state: "recovering", tone: "busy", icon: "refresh", dot: "down",
    why: exitRecoveringSay() + _fell };
  if (exitIsDialin(ex) && l.no_traffic && !Number.isFinite(l.no_traffic.back_in) && !(l.trace || {}).ip) return { state: "stalled", tone: "warn", icon: "warn", dot: "down",
    why: said(T("The router is connected but passes no traffic — check NAT on the router.")) + _fell };
  if (l.no_traffic) return { state: "stalled", tone: "warn", icon: "warn", dot: "down",
    why: said(exitStalledSay(ex)) };
  if (l.handshake === 0 && !(l.trace || {}).ip) return { state: "nohandshake", tone: "warn", icon: "warn", dot: "down",
    why: said((ex.provider || "warp") === "warp"
      ? T("The tunnel is up, but Cloudflare never answered it. Nothing here is yours to correct — the keys and the endpoint are the panel's own. Networks that block WARP look exactly like this, so try a pasted profile instead, or put this exit on another node.")
      : l.awg
      ? T("The device is up, but this peer has never answered. Check the endpoint, the keys, and that the server really is AmneziaWG with these exact obfuscation values.")
      : T("The device is up, but this peer has never answered. Check the endpoint and the keys — and if the server is AmneziaWG, its profile must be pasted with its obfuscation lines intact.")) };
  return { state: "ok", tone: "", dot: "up", why: exitIsDialin(ex) && l.endpoint
    ? T("Up on the node. The router connects from {v1}.", { v1: l.endpoint }) : T("Up on the node.") };
}

export const exitHealthMark = (h) => {
  if (!h || !h.tone) return null;
  if (h.tone === "busy" || !h.why)
    return html`<span class=${"ddwarn " + h.tone} title=${h.why}><${Ic} i=${h.icon || "warn"}/></span>`;
  return html`<span class=${"ddwarn ddwarn-clk " + h.tone} title=${T("Show the reason")}
    onClick=${e => { e.preventDefault(); e.stopPropagation();
                     openConfirm({ title: T("This exit isn't working"), log: h.why, confirmLabel: T("Close") }); }}
    ><${Ic} i=${h.icon || "warn"}/></span>`;
};

export function exitOptionGroups(node, { prefix = "", onToggle = null, custom = "", onRename = null, onRemove = null, onManage = null, armed = "", onArm = null, stored = null, devices = false } = {}) {
  const exits = ((node || {}).exits || []).filter(x => x && x.id);
  const health = x => exitHealth((stored || exits).find(o => String(o.id) === String(x.id)) || x, node);
  const ctl = (x, pencil, sw) => (x || pencil || sw)
    ? html`<${Fragment}>${x}${pencil}${sw}<//>`
    : null;
  const rmBtn = arg => (onRemove
    ? html`<button type="button" class="ddrm" title=${T("Remove")}
        onClick=${e => { e.stopPropagation(); (onArm || onRemove)(onArm ? arg.id : arg); }}><${Ic} i="x"/></button>`
    : null);
  const confirmRow = arg => html`<span class="ddconf">
    <span class="ddconf-q">${T("Delete?")}</span>
    <button type="button" class="ddconf-y" onClick=${e => { e.stopPropagation(); onRemove(arg); }}>${T("val|Yes")}</button>
    <button type="button" class="ddconf-n" onClick=${e => { e.stopPropagation(); onArm(""); }}>${T("val|No")}</button>
  </span>`;
  const penBtn = arg => (onRename
    ? html`<button type="button" class="ddpen" title=${T("Rename")}
        onClick=${e => { e.stopPropagation(); onRename(arg); }}><${Ic} i="pencil"/></button>`
    : null);
  const mk = (x, label) => {
    const on = x.enabled !== false;
    const live = x.live || {};
    const h = health(x);
    const notReady = (x.producer || "adopted") === "imported" && h.state !== "ok";
    const mark = h.tone
      ? exitHealthMark(h)
      : null;
    return {
      value: prefix + x.id, label,
      className: (on && !notReady) ? "" : "dim",
      ...(on
        ? (notReady ? { refuse: h.why } : {})
        : { refuse: T("{v1} is turned off. Switch it on first, then choose it.", { v1: label }) }),
      title: [live.address || "", x.device || "", on ? "" : T("Turned off"), notReady ? h.why : ""]
        .filter(Boolean).join(" · "),
      ...(String(armed || "") === String(x.id) && onRemove && x._ext
        ? { extra: confirmRow({ id: x.id, label, device: x.device || "" }),
            refuse: T("Answer the question on this row first."), className: (on ? "" : "dim") + " arming" }
        : { extra: ctl(onRemove && x._ext ? rmBtn({ id: x.id, label, device: x.device || "" }) : null,
                       onRename && x._ext ? penBtn({ kind: "exit", id: x.id, device: x.device || "", title: x.label || "",
                                                     egress_ip: x.egress_ip || "", gw: x.gw || "" }) : null,
                       notReady ? mark
                         : onToggle ? html`<${Switch} on=${on} onChange=${v => onToggle(x.id, v)}/>` : null) }),
    };
  };
  const imp = exits.filter(x => (x.producer || "adopted") === "imported");
  const warp = imp.filter(x => exitProv(x) === "warp").map(x => mk(x, exitLabel(x, node)));
  const prof = imp.filter(x => exitProv(x) === "profile").map(x => mk(x, exitLabel(x, node)));
  const socks = imp.filter(x => exitProv(x) === "socks5").map(x => mk(x, exitLabel(x, node)));
  const other = imp.filter(x => !EXIT_KINDS.includes(exitProv(x))).map(x => mk(x, exitLabel(x, node)));
  const ext = exits.filter(x => (x.producer || "adopted") !== "imported")
    .map(x => mk({ ...x, _ext: true }, exitLabel(x, node)));
  const taken = new Set(exits.map(x => String(x.device || "")).filter(Boolean));
  for (const c of (devices ? ((node || {}).exit_candidates || []) : [])) {
    if (!c || !c.offerable || taken.has(String(c.name))) continue;
    ext.push({
      value: prefix + "dev:" + c.name, label: exitLabel({ producer: "adopted", device: c.name }, node),
      title: [c.address || "", c.endpoint ? "→ " + c.endpoint : "", c.up ? "" : T("not up")].filter(Boolean).join(" · "),
      extra: ctl(null, penBtn({ kind: "device", device: c.name, title: "", egress_ip: "" }),
                 onToggle ? html`<${Switch} on=${true} onChange=${v => onToggle("dev:" + c.name, v)}/>` : null),
    });
  }
  if (custom) ext.push({ value: custom, label: T("Custom interface…"),
    ...(onManage ? { extra: html`<button type="button" class="btn btn-mini ddmanage"
      onClick=${e => { e.stopPropagation(); onManage(); }}>${T("Manage…")}</button>` } : {}) });
  return [
    ...(warp.length ? [{ group: T("Exit via WARP"), items: warp }] : []),
    ...(prof.length ? [{ group: T("Exit via a custom config"), items: prof }] : []),
    ...(socks.length ? [{ group: T("Exit via a SOCKS5 proxy"), items: socks }] : []),
    ...(other.length ? [{ group: T("Other exits"), items: other }] : []),
    ...(ext.length ? [{ group: T("Leave by a device"), items: ext }] : []),
  ];
}

export const exitIsPlus = ex => !!(String((ex || {}).licence || "").trim()
  || /plus/.test((((ex || {}).live) || {}).account_type || ""));

export function exitTypeLabel(ex, node) {
  const x = ex || {};
  if ((x.producer || "adopted") === "imported")
    return exitProv(x) === "profile" ? (exitIsDialin(x) ? T("Dial-in exit") : T("Custom exit"))
      : exitProv(x) === "warp" ? (exitIsPlus(x) ? T("WARP+ exit") : T("WARP exit"))
      : exitProv(x) === "socks5" ? T("SOCKS5 exit") : exitProv(x);
  const _cand = ((node || {}).exit_candidates || []).find(c => c && String(c.name) === String(x.device || ""));
  return _cand ? (_cand.proto === "nic" ? T("val|Network card") : T("val|Discovered")) : T("val|Custom");
}

export function exitLabel(ex, node) {
  const x = ex || {};
  const dev = String(x.device || "").trim();
  const title = String(x.label || "").trim();
  const name = (title && title !== dev) ? title : exitTypeLabel(x, node);
  return dev ? T("{v1} — {v2}", { v1: name, v2: dev }) : name;
}

export const exitOf = (node, id) => (((Store.nodes || []).find(n => n.id === node) || {}).exits || [])
  .find(x => String(x.id) === String(id)) || null;

export function ifTrafficBadge(meta, node) {
  const mode = interfaceEgressMode(meta), egNode = meta.egress_node, exitId = meta.exit_id;
  if (mode === "node") return html`<span class="egb egb-smart" title=${T("Uses this node's routing rules from Settings → Network.")}><${Ic} i="server"/>${T("Node rules")}</span>`;
  if (mode === "forward" && egNode) {
    const linking = (Store.panelSettings || {}).mesh_effective === "demand" && node && (p => !!p && p.out === "connecting")(
      meshHealth(node).peers.find(x => x.peer === egNode));
    if (linking) return html`<span class="egb egb-fwd" style=${"color:" + Store.nodeColor(egNode)} title=${T("Linking to {v1} — this interface's traffic resumes once the link is up", { v1: Store.nodeName(egNode) })}><${Ic} i="cascade"/>${T("linking →")} ${Store.nodeName(egNode)}</span>`;
    return html`<span class="egb egb-fwd" style=${"color:" + Store.nodeColor(egNode)} title=${T("Cascade — exits via {v1}", { v1: Store.nodeName(egNode) })}><${Ic} i="cascade"/>${T("cascade →")} ${Store.nodeName(egNode)}</span>`;
  }
  if (mode === "smart") return html`<span class="egb egb-smart" title=${T("Per-destination smart routing")}><${Ic} i="cascade"/>${T("Interface rules")}</span>`;
  if (mode === "forward") return html`<span class="egb egb-cascade"><${Ic} i="cascade"/>${T("tag|cascade")}</span>`;
  if (mode === "exit") {
    const x = exitOf(node, exitId);
    if (!x)
      return html`<span class="egb egb-exit egb-gone" title=${T("The exit this interface was set to is gone — traffic goes out directly, and the interface keeps the selection")}><${Ic} i="device"/>${T("exit — removed")}</span>`;
    const degraded = x.enabled === false || !!x.why_not;
    return html`<span class=${"egb egb-exit" + (degraded ? " egb-gone" : "")}
      title=${degraded
        ? (x.enabled === false
            ? T("This exit is turned off — traffic goes out directly, and the interface keeps the selection")
            : T("This exit's device can't be used — traffic goes out directly, and the interface keeps the selection"))
        : T("Leaves this node through {v1}", { v1: x.device || x.label })}>
      <${Ic} i=${degraded ? "warn" : "device"}/>${T("exit →")} ${x.label || x.device}</span>`;
  }
  return html`<span class="egb egb-direct" title=${T("Exits directly from this node")}><${Ic} i="globe"/>${T("tag|direct")}</span>`;
}

export const egressBody = eg => {
  let body;
  if (eg.mode === "node") body = { egress_mode: "node" };
  else if (eg.mode === "direct") body = { egress_mode: "local", egress_ip: eg.ip || "", wan_iface: eg.nic || "" };
  else {
    const { legacy, catchAll } = eg;
    const rules = rowsToRules(eg.rows, catchAll);
    // Keep the original cascade until its rule is edited.
    if (legacy && rules.length === 1 && catchAll?.enabled !== false && catchAll?.action === legacy.action
        && (catchAll.node || "") === (legacy.node || "") && (catchAll.exit_id || "") === (legacy.exit_id || "")) {
      body = legacy.action === "exit"
        ? { egress_mode: "forward", egress_node: legacy.node, egress_ip: eg.exitIps?.[legacy.node] || "" }
        : { egress_mode: "exit", exit_id: legacy.exit_id };
    } else {
      body = { egress_mode: "smart", routing: rules, routing_exit_ips: eg.exitIps || {}, routing_v: 3, egress_ip: eg.ip || "" };
    }
  }
  return { ...body, p2p: eg.p2p || null };
};
