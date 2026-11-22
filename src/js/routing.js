import { T, Trich, Tsplit, plural, pluralWord, srvText } from "./i18n.js";
import { classify, classifyAll, patternTier, TIER2_MIN } from "./classify.js";
import { idnHost, idnDiffers } from "./idn.js";
import { rulesToRows, rowsToRules, badgeIdentity, rowHasBadge, newGid,
         badgeText, readToken as rrReadToken,
         customTargets, customCaps, listBuckets, TIER2_CAP, listTier2, tier2Count, canonWho, rowLints, badgeCovers,
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

let _smart_categories = null;
export const SMART_CATEGORIES = () => (_smart_categories || (_smart_categories = [
  // The brand rows carry the marker: a product name is the same string in every language, and listing
  // them as untranslated trains you to skim the report past the rows that are real sentences.
  ["google", "Google"], ["youtube", "YouTube"], ["telegram", "Telegram"], ["netflix", "Netflix"],   // i18n-keys: brand names
  ["meta", "Meta (FB / IG / WA)"], ["twitter", "X (Twitter)"], ["tiktok", "TikTok"], ["discord", "Discord"],   // i18n-keys: brand names
  ["yandex", "Yandex"], ["vk", "VK"], ["openai", "ChatGPT (OpenAI)"], ["claude", "Claude (Anthropic)"],   // i18n-keys: brand names
  ["grok", "Grok (xAI)"], ["gemini", T("Gemini (Google AI)")], ["copilot", T("Microsoft Copilot")], ["signal", "Signal"],   // i18n-keys: brand names
  ["spotify", "Spotify"], ["twitch", "Twitch"], ["disney", "Disney+"], ["reddit", "Reddit"], ["github", "GitHub"],   // i18n-keys: brand names
  ["ru_net", T("Russia — all IPs")], ["ru_gov", T("Russia — Government")], ["ru_banks", T("Russia — Banks")],
  ["ru_blocked", T("Russia — Blocked (all)")], ["ru_blocked_media", T("Russia — Blocked (media)")],
  ["all", T("All traffic (catch-all)")],
]));
export const CURATED_HEAVY = { ru_blocked: 1, ru_net: 1 };   // UI weight flag — large lists
// Same rule as the table it derives from: built on first read, not at import.
let _smart_cat_label = null;
export const SMART_CAT_LABEL = new Proxy({}, { get: (_, k) => (_smart_cat_label || (_smart_cat_label = Object.fromEntries(SMART_CATEGORIES())))[k] });
export const CAT_UNCAT_COLOR = "#8A94A6";   // muted slate — the "everything else" catch-all, deliberately off-palette
// HSL→hex, no deps.
export function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => { const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return Math.round(255 * c).toString(16).padStart(2, "0"); };
  return "#" + f(0) + f(8) + f(4);
}
export const dashRankColor = (i, kind) => kind === "talker" ? hsl2hex((205 + i * 137.508) % 360, 68, 62) : hsl2hex((32 + i * 137.508) % 360, 58, 55);
// If a resolved label has NO capital letters (a bare list name like "timeweb"), capitalise its first letter —
// but leave intentional casing alone ("iCloud", "YouTube" stay as-is).
export const capFirst = s => (typeof s === "string" && s && !/[A-Z]/.test(s)) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
// A block-list category (the blku_* union or a blk:* source) — rides the smart chain for its drop verdict but is
// NOT a routing destination, so it's excluded from the destination stats (Top destinations / flow map).
export const isBlockCat = c => /^blku?[_:]/i.test(String(c));
export function catLabelOf(c) {   // built-in label · custom-list title (keyed by the list's id AND name, so whichever the node emits resolves to the human title) · inline custom → "Custom" · else the id
  if (c === "uncat") return T("Uncategorised");
  const lt = {};
  (Store.panelSettings?.custom_lists || []).forEach(l => { if (l && l.title) { if (l.id) lt[l.id] = l.title; if (l.name) lt[l.name] = l.title; } });
  if (isProviderCat(c)) return capFirst(prettyCatLabel(c, (Store.catLabels || {})[c]));   // provider list → humanised (country names etc.)
  return capFirst(SMART_CAT_LABEL[c] || (Store.catLabels || {})[c] || lt[c] || (String(c).startsWith("custom") ? T("Custom") : c));
}
// Host/IP capability flags for a list — ALWAYS Host first, IP second (house rule).
export const capBadges = caps => html`<span class="capbs">
  ${caps && caps.host ? html`<span class="capb host" title=${T("Matchable by domain — needs Hybrid SNI")}>${T("Host")}</span>` : null}
  ${caps && caps.ip ? html`<span class="capb ip" title=${T("Matchable by IP range — works in every mode")}>${T("cap|IP")}</span>` : null}</span>`;
// A provider-catalog id is "<prov>:<rawid>"; return the provider's display label (MetaCubeX / v2fly / …) for the source tag.
export const isProviderCat = c => typeof c === "string" && c.includes(":") && !String(c).startsWith("custom");
// A "Curated" category = one of the panel's own hand-maintained built-in sets (bare id, no ":"). These are presented
// as the first-class "Curated" provider — the old "built-in" concept, retired. ("all" is the catch-all, not a list.)
export const isCuratedCat = c => typeof c === "string" && !c.includes(":") && c !== "all" && c !== "custom" && !String(c).startsWith("custom") && SMART_CAT_LABEL[c] != null;
// The provider a category belongs to: "<prov>" for a namespaced catalog id, "curated" for a built-in, else "".
export const providerOf = c => isProviderCat(c) ? String(c).split(":")[0] : (isCuratedCat(c) ? "curated" : "");

export function reportDropped(r) {
  const rep = ((r && r.data) || {}).dropped || {};
  const list = rep.entries || [];
  const total = rep.total || list.length;   // the server caps what it carries back; the count stays whole
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

const isListCat = c => !!c && (isProviderCat(c) || isCuratedCat(c));

/** {nodeId: Set(category)} for the whole fleet, in one walk. */
export function fleetRuleCats() {
  const out = {};
  for (const n of (Store.nodes || [])) {
    const s = new Set();
    for (const cats of Object.values(n.rule_cats || {}))
      for (const c of (cats || [])) if (isListCat(c)) s.add(c);
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
  meta: "Meta / Facebook", facebook: "Meta / Facebook", openai: "ChatGPT / OpenAI", twitter: "Twitter / X",   // i18n-keys: brand names
  xai: "Grok / xAI", grok: "Grok / xAI", anthropic: "Claude / Anthropic", claude: "Claude / Anthropic",   // i18n-keys: brand names
  gemini: T("Gemini (Google AI)"), perplexity: T("Perplexity AI"), deepseek: "DeepSeek", copilot: T("Microsoft Copilot"),   // i18n-keys: brand names
  google: "Google", youtube: "YouTube", netflix: "Netflix", telegram: "Telegram", whatsapp: "WhatsApp",   // i18n-keys: brand names
  instagram: "Instagram", tiktok: "TikTok", github: "GitHub", disney: "Disney+", spotify: "Spotify",   // i18n-keys: brand names
  twitch: "Twitch", reddit: "Reddit", discord: "Discord", vk: "VK", yandex: "Yandex", cloudflare: "Cloudflare",   // i18n-keys: brand names
  ru_gov: T("Russian Government"), ru_banks: T("Russian Banks"), ru_social: T("Russian Social (VK / OK)"),
}));
export function prettyCatLabel(id, fallback) {
  const rid = String(id || "").includes(":") ? String(id).split(":")[1] : String(id || "");
  if (CAT_FRIENDLY()[rid.toLowerCase()]) return CAT_FRIENDLY()[rid.toLowerCase()];   // curated friendly name (ids vary in case across providers)
  if (/^[a-z]{2}$/i.test(rid) && _REGION_NAMES) {                 // ISO 3166 alpha-2 → country name
    try { const n = _REGION_NAMES.of(rid.toUpperCase()); if (n && n.toUpperCase() !== rid.toUpperCase()) return n; } catch (e) {}
  }
  let m;
  if ((m = rid.match(/^geolocation-(.+)$/))) return T("Geolocation: {v1}", { v1: prettyCatLabel(m[1], null) });
  if ((m = rid.match(/^category-(.+?)(-all)?$/))) return _titleize(m[1]) + (m[2] ? " (all)" : "");
  if ((m = rid.match(/^tld-(.+)$/))) return T("TLD .{v1}", { v1: m[1].toLowerCase() });
  return fallback || _titleize(rid) || rid;
}
export const catRawId = id => String(id || "").includes(":") ? String(id).split(":")[1] : String(id || "");   // the provider's raw id ("telegram")
let _cat_desc = null;
export const CAT_DESC = () => (_cat_desc || (_cat_desc = {
  google: T("Google search, accounts & core services"), youtube: T("YouTube video + its CDN"),
  netflix: T("Netflix streaming & app"), meta: T("Facebook, Instagram & WhatsApp"), facebook: T("Facebook, Instagram & WhatsApp"),
  telegram: T("Telegram messenger"), whatsapp: T("WhatsApp messenger"), instagram: "Instagram", twitter: "Twitter / X",   // i18n-keys: brand names
  openai: T("ChatGPT & the OpenAI API"), tiktok: T("TikTok video"), github: T("GitHub & its CDN"), disney: T("Disney+ streaming"),
  spotify: T("Spotify audio"), twitch: T("Twitch live streaming"), reddit: "Reddit", discord: T("Discord voice & chat"),   // i18n-keys: brand name
  cloudflare: T("Cloudflare CDN / edge network"), vk: T("VKontakte"), yandex: T("Yandex services"),
  ru_gov: T("Russian government sites"), ru_banks: T("Russian banks"), ru_social: T("Russian social (VK / OK)"),
  claude: T("Claude & the Anthropic API"), grok: T("Grok (xAI) — grok.com & x.ai"),
  gemini: T("Google Gemini AI — kept separate from the rest of Google"), copilot: T("Microsoft & GitHub Copilot"),
  signal: T("Signal private messenger"),
  "rf:domains_all": T("Domains blocked in Russia — the RKN registry, filtered"),
  "rf:ipsum": T("IP addresses blocked in Russia, merged into ranges"),
  "rf:community": T("Community list: sites RKN does not block that refuse visitors from Russia"),
  "rf:community_ips": T("Community list: networks RKN does not block that refuse addresses from Russia"),
  "rf:discord_ips": T("Discord's networks"),
  ru_net: T("The whole Russian IP space (GeoIP) — works in every mode"),
  ru_blocked: T("Sites blocked inside Russia — comprehensive (~86k domains, heavy)"),
  ru_blocked_media: T("News / media blocked inside Russia — light subset (~130)"),
}));
export const catDescOf = id => CAT_DESC()[String(id || "").toLowerCase()] || CAT_DESC()[catRawId(id).toLowerCase()] || "";   // a full-id entry wins over the raw id
// Info icon that shows a description bubble on hover — used for curated presets (which have no external URL to link).
export const DescInfo = ({ text }) => text ? html`<span class="catrow-info descinfo" tabindex="0" role="note" onClick=${e => e.stopPropagation()}>
  <${Ic} i="info"/><span class="descbub" role="tooltip">${text}</span></span>` : null;
// The provider's GitHub page for a specific list — where the operator can see exactly what it contains (the raw
// file, or blackmatrix7's folder with its README). Built from the same paths we fetch, as human github.com URLs.
export function catListUrl(id, caps) {
  const rid = catRawId(id), prov = String(id).includes(":") ? String(id).split(":")[0] : "";
  const host = !!(caps && caps.host);
  switch (prov) {
    case "mc": return "https://github.com/MetaCubeX/meta-rules-dat/blob/meta/geo/" + (host ? "geosite" : "geoip") + "/" + rid + ".list";
    case "v2": return "https://github.com/v2fly/domain-list-community/blob/master/data/" + rid;
    case "ls": return "https://github.com/Loyalsoldier/geoip/blob/release/text/" + rid + ".txt";
    case "rf": return "https://github.com/1andrevich/Re-filter-lists/blob/main/" + rid + ".lst";
    case "bm": return "https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/Clash/" + rid;
    default: return "";
  }
}
// Record count for a provider-catalog cat (Host+IP tiers), shipped by the panel in Store.catSizes {cat:{ip,host}}.
export const fmtCount = n => n == null ? "…" : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
export function sizeSummary(host, ip, pat) {
  const p = [];
  if (host) p.push(plural(host, "host").replace(String(host), fmtCount(host)));
  if (ip) p.push(plural(ip, "net").replace(String(ip), fmtCount(ip)));
  if (pat) p.push(plural(pat, "pattern").replace(String(pat), fmtCount(pat)));
  return p.join(" · ");
}
const _LIST_INFO_CACHE = {};   // cat -> resolved list-info (count + sample), so CatalogRow paging never re-fetches
// Plain "N hosts · M nets" text for a list. Counts come from the panel's shipped cat_sizes (routed cats) or the
// custom list's own targets — no fetch, no hover bubble (the full sample lives inline in the catalog browse row).
export function ListInfo({ cat, list }) {
  let hostN = null, ipN = null;
  let patN = 0;
  if (list) { const b = listBuckets(list); hostN = b.host.length; ipN = b.ip.length; patN = b.pat.length; }
  else if (cat) { const s = (Store.catSizes || {})[cat] || {}; hostN = s.host; ipN = s.ip; }
  const summary = sizeSummary(hostN || 0, ipN || 0, patN);
  if (!summary) return null;
  return html`<span class="listsize">${summary}</span>`;
}

export function CatalogRow({ it, added, onPick }) {
  const [fetched, setFetched] = useState(() => _LIST_INFO_CACHE[it.id] || null);
  const own = it.list, ownB = own ? listBuckets(own) : null;
  const ownDoms = ownB ? ownB.host : [], ownIps = ownB ? ownB.ip : [];
  const info = own ? { tiers: { ...(ownDoms.length ? { host: { n: ownDoms.length, sample: ownDoms.slice(0, 4) } } : {}),
                               ...(ownIps.length ? { ip: { n: ownIps.length, sample: ownIps.slice(0, 4) } } : {}) } }
                   : fetched;
  useEffect(() => {
    if (own) return;                                  // nothing to fetch, and the endpoint would refuse it
    if (info && !(info.tiers && Object.keys(info.tiers).some(k => info.tiers[k] && info.tiers[k].pending))) return;
    let live = true;
    const t = setTimeout(() => askListInfo(it.id, () => live && setFetched(_LIST_INFO_CACHE[it.id] || null),
                                           { waitMs: LIST_ASK_MS, errOnGiveUp: false }), 250);
    return () => { live = false; clearTimeout(t); }; }, [it.id]);
  const title = prettyCatLabel(it.id, it.label), rid = catRawId(it.id), desc = catDescOf(it.id);
  const hostD = info && info.tiers && info.tiers.host, ipD = info && info.tiers && info.tiers.ip;
  const summary = sizeSummary((hostD && hostD.n) || 0, (ipD && ipD.n) || 0);
  const samples = ((hostD && hostD.sample) || (ipD && ipD.sample) || []).slice(0, 4);
  const more = (((hostD && hostD.n) || (ipD && ipD.n) || 0) > samples.length);
  const anyFailed = info && info.tiers && Object.keys(info.tiers).some(t => info.tiers[t].failed);
  const anyPending = info && info.tiers && Object.keys(info.tiers).some(t => info.tiers[t].pending);
  const empty = info && !info.err && !summary && !samples.length && !anyFailed && !anyPending;   // resolved to 0 routable records
  const sub = desc || (samples.length ? "e.g. " + samples.join(", ") + (more ? "…" : "")
    : (!info || anyPending ? T("preparing…") : anyFailed ? T("couldn't load — will retry") : empty ? T("no routable records") : "—"));
  return html`<button type="button" class=${"catrow" + (added ? " sel" : "") + (empty ? " off" : "")} disabled=${empty} title=${empty ? T("This list has no routable records") : ""} onClick=${() => !empty && onPick(it.id)}>
    <span class=${"catpick-tick" + (added ? " on" : "")}>${added ? "✓" : ""}</span>
    <div class="catrow-main">
      <div class="catrow-l1"><span class="catrow-title">${title}</span>${rid.toLowerCase() !== title.toLowerCase() ? html`<span class="catrow-id">${rid}</span>` : null}${CURATED_HEAVY[it.id] ? html`<span class="catrow-heavy" title=${T("Large list — noticeable memory / reload on any node that routes it")}>${T("tag|heavy")}</span>` : null}</div>
      ${sub ? html`<div class="catrow-l2">${desc ? html`<span class="catrow-desc">${desc}</span>` : null}${desc && samples.length ? html`<span class="catrow-eg"> · ${T("e.g. {v1}", { v1: samples.join(", ") + (more ? "…" : "") })}</span>` : (!desc ? html`<span class="catrow-eg">${sub}</span>` : null)}</div>` : null}
    </div>
    <div class="catrow-right">
      <${ProvTag} id=${it.id} label=${it.provider_label || provLabelOf(it.id)}/>${capBadges(it.caps)}${summary ? html`<span class="catrow-size">${summary}</span>` : null}
      ${catListUrl(it.id, it.caps) ? html`<a class="catrow-info" href=${catListUrl(it.id, it.caps)} target="_blank" rel="noopener" title=${T("View this list on GitHub")} onClick=${e => e.stopPropagation()}><${Ic} i="info"/></a>`
        : html`<${DescInfo} text=${catDescOf(it.id)}/>`}</div>
  </button>`;
}
// A Geo-data provider's name as shown. The panel's own provider is a word, not a name: the registry sends it as
// "Curated", and it is shown in the operator's language; every other provider's label is a proper name, shown as sent.
export function provName(p) { return p.id === "curated" ? T("Curated") : (p.label || p.id); }
export function provLabelOf(c) {
  const pid = providerOf(c);
  if (!pid) return "";
  return provName((Store.catalogProviders || []).find(p => p.id === pid) || { id: pid });
}
// Each provider gets a distinct colour (default palette + a Panel-settings per-mode override, like turn forks).
export const CAT_PROVIDER_DEFAULTS = { mc: { color: "#5B8FF9", colorL: "#2C6FD6" }, v2: { color: "#61DDAA", colorL: "#1E9E6E" },
  ls: { color: "#F6BD16", colorL: "#B8890A" }, rf: { color: "#E8684A", colorL: "#C2452A" }, bm: { color: "#B07BE0", colorL: "#8347C0" },
  curated: { color: "#E85D9E", colorL: "#C43B7E" } };   // "Curated" — the panel's own maintained set (rose; distinct from every fetched provider)
export function providerColor(prov) {
  const ov = (Store.panelSettings && Store.panelSettings.provider_colors) || {};
  const d = CAT_PROVIDER_DEFAULTS[prov] || (prov === "custom" ? { color: "#8A94A6", colorL: "#5E6875" } : { color: "#8FA8C0", colorL: "#5E7085" });
  return pickThemed(ov[prov], d.color, d.colorL);
}

// Provider source tag — colour-coded by provider. Curated built-ins and catalog cats both get a coloured chip;
// only genuinely source-less chips (a raw "Custom" label) stay plain. `plain` forces the neutral chip.
export function ProvTag({ id, label, plain }) {
  const prov = providerOf(id) || (customListOf(id) ? "custom" : "");
  if (plain || !prov) return html`<span class="catpick-src legacy">${label}</span>`;
  return html`<span class="catpick-src" style=${"--pc:" + providerColor(prov)}>${label || provLabelOf(id)}</span>`;
}
function buildModeMeta() {
  const WINS = {
    order:    { card: T("First match — the order you set"),       label: T("— the first matching rule wins") },
    specific: { card: T("Most specific name; IP rules in order"), label: T("— the most specific rule wins") },
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
    // A BLOCKED NAME'S ADDRESS IS SPARED WHERE AN ALLOWED NAME USES IT (1.8.8, KSNI-HOSTNAMES D2): a tracker on a Google front
    // end no longer takes YouTube down — and so the tracker itself gets through there. Said where the mode is chosen.
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
    // Every line re-read against the engine after the 1.8.8 Kernel SNI work (KSNI-HOSTNAMES D3/D4): Direct and Block by name
    // run here now, a site matches itself and its subdomains, and only domain block LISTS stay with the other two engines.
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
    // PER CONNECTION since 1.8.8 (KSNI-HOSTNAMES D1): a blocked name is refused, its address is never dropped.
    block: { s: "+", t: T("Enforces domain block lists per connection — other sites on a blocked site's address stay reachable") },
    exp: T("Routes by hostname by parsing the SNI from each TLS handshake in a small userspace helper, so your clients' DNS — DoH, DoT or plain — is never touched, observed or downgraded: the connection stays encrypted end-to-end. Parses the real SNI field (precise, fine with very large lists). Learns each destination on its first connection (a brand-new host routes on the next one). A blocked name is refused on every connection and its address stays open to other sites. QUIC / HTTP3 is dropped, so browsers use TLS over TCP, which is read; names hidden by ECH fall back to IP rules."),
    routes: T("IP ranges, networks, sites, zones, name patterns, text patterns"),
    ...arb("specific"),
  },
}; }
let _modeMeta = null;
/* "…turn them on in <Settings ▸ Routing & Blocking>." — the tail is a button. */
function noFilterCats(onNav) {
  const [a, b] = Tsplit("No content-filter categories are enabled on this node yet — turn them on in {where}.", "where");
  return html`<${Fragment}>${a}<button type="button" class="linkbtn" onClick=${onNav}>${T("Settings ▸ Routing & Blocking")}</button>${b}<//>`;
}
/* "Type <RESET LEARNED> or <RESET ALL> to confirm your action" — two coloured literals. */
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
  if (!n) return T("no rules yet");
  const a = { v1: n, v2: pluralWord(n, "rule") };
  // The count only: how rules win is in the section's own title (rulesTitle), which says it for the mode in force.
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
// Two-scope reset: "learned" clears only the node's SNI-learned IPs; "all" wipes tables + learned IPs + list cache
// and rebuilds/re-pulls. Each button is gated by its own typed token ("RESET LEARNED" / "RESET ALL").
export function ResetRoutingSheet({ node, name }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const t = typed.trim();   // case-sensitive: the tokens must be typed in CAPS exactly
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
  if (!sr.mode) return null;                                  // node hasn't reported host-layer health yet → don't guess
  const eng = sr.engine || "";                                // ACTUAL running engine (may differ from configured — see degrade)
  const label = eng === "dns" ? T("DNS resolver") : eng === "sni_kernel" ? T("SNI scanner") : T("SNI parser");
  const ok = sr.engine_ok !== false;
  let extra = null, note = null;
  // Destinations the engine has in its routing sets (geoip + SNI-learned), excluding block-list sets. Kernel-SNI keeps
  // learned IPs in an ipset it doesn't surface, so this reads 0 there — shown only when the node reports set counts.
  const routed = Object.entries(sr.sets || {}).reduce((n, [k, v]) => n + (String(k).includes("blku") ? 0 : (v || 0)), 0);
  const lowered = Object.values(sr.lowered || {}).reduce((n, v) => n + (v || 0), 0);
  if (routed || lowered || (eng.startsWith("sni") && sr.resets)) {
    const bits = [];
    if (routed) bits.push(T("{v1} routed", { v1: plural(routed, "destination").replace(String(routed), fmtCount(routed)) }));
    if (lowered) bits.push(T("matching {v1}", { v1: plural(lowered, "pattern") }));
    if (eng.startsWith("sni") && sr.resets) bits.push(T("{v1} rerouted", { v1: plural(sr.resets, "new host") }));
    extra = bits.join(" · ");
  }
  if (mode === "sni_kernel" && eng === "sni_user") note = T("kernel SNI scanner unavailable — running userspace SNI parser");   // degraded-open
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
    // An older node sends no sample at all; then the count is the whole of what is known, and saying just
    // that beats padding it out. Same rule as everywhere else here: fewer facts, never invented ones.
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
// the ONE rule behind every ROUTING mode-gate (mirrors blockTierOk)
export const routeTierOk = (mode, tier) => tier === "ip" || mode !== "kernel";
export const routeCapsUsable = (mode, caps) => !!(caps && ((caps.ip && routeTierOk(mode, "ip")) || (caps.host && routeTierOk(mode, "host"))));
export const catUsableInMode = (id, mode) => routeCapsUsable(mode, catCap(id));

export const PATTERN_ENGINE_OK = {
  ip:       { kernel: 1, forcedns: 1, sni_kernel: 1,      sni: 1 },
  asn:      { kernel: 1, forcedns: 1, sni_kernel: 1,      sni: 1 },
  site:     { kernel: 0, forcedns: 1, sni_kernel: 1,      sni: 1 },   // Kernel SNI: the name and its subdomains (1.8.8 D4)
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
  return !!v && (v === 1 || !mode || !!v[mode]); };   // no mode known → gate nothing, as everywhere else
// Preference order for "switch this node to…" — Force-DNS first (cheapest host layer, and the switch the panel
// already offers), then Hybrid SNI, which is the only engine that runs every kind.
const _FIX_MODES = ["sni"];
const ENGINE_NO = { kernel: "engine", forcedns: "whole", sni_kernel: "anchor" };
export function targetGate(mode, kind) {
  if (!kind || kind === "invalid") return { ok: false, why: "invalid" };
  if (!PATTERN_SHIPPED[kind]) return { ok: false, why: "unbuilt" };
  const row = PATTERN_ENGINE_OK[kind];
  // The fix we offer must be a mode that works TODAY, not one the capability matrix merely allows: sending an
  // operator to switch a node to an engine whose lowering is not written yet is worse than saying nothing.
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
// Amber (--partial): a kind whose blast radius is orders larger than it looks. A zone is every name under a
// whole ending; the three Tier-2 shapes match text, so they catch names nobody meant (notgoogle.com).
export const KIND_WIDE = { zone: 1, contains: 1, starts: 1, ends: 1 };
const TIER2_WARN = 5;
const isTier2 = kind => patternTier(kind) === 2;   // ONE tier table, in the classifier, where the grammar is
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
/** One sentence saying what this target will match. Shown under the field before the badge is committed, and
 *  in the badge's tooltip after. `n` (the IP count) is only used by the ip kind. */
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
/** Why a token was refused, in the operator's words. `why` is classify()'s stable code — never its prose, so
 *  each surface writes its own sentence and the grammar stays free of UI copy. */
export function targetWhy(why, raw) {
  const t = String(raw || "").trim().toLowerCase();
  switch (why) {
    case "bare_label": case "lead_dot": return T("Did you mean the whole .{v1} zone? Write *.{v1}.", { v1: t.replace(/^\.+/, "") });
    case "bad_ip": return T("That isn't a valid IP address or range.");
    case "bad_domain": return T("That isn't a valid web address.");
    case "star_mid": return T("A * goes at the start or the end of a name, not in the middle.");
    case "multi_label_operand": return T("Put one name between the stars, not a dotted address.");
    case "idn_tier2": return T("A partial-word match can't be written in non-Latin letters — names travel already encoded.");
    // The floor, said as what it protects rather than as a rule. `*ru*` reads to an operator as "Russian
    // sites" and to the matcher as ruble.com, brutal.io and truecaller.com.
    case "short_tier2": return T("Too short to match on — under {v1} characters this catches names that have nothing to do with what you meant.", { v1: TIER2_MIN });
    default: return T("That isn't an address, IP range or AS number.");
  }
}
// hover bubble listing a list's domains/IPs (only when there are some); `note` = a faint footer caption
let _ruleSeq = 0;
export const newRid = () => "rr" + (++_ruleSeq);


let _CATALOG_INDEX = null;
let _CATALOG_BY_ID = {};
let _CATALOG_KEY = null;
let _CATALOG_REQ = { key: null, p: null };   // the latest request: shared by every caller asking under the same key
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
               hay: (it.id + " " + catRawId(it.id) + " " + disp + " " + catDescOf(it.id)).toLowerCase() }; });
    if (_CATALOG_REQ.p === p) {                // a newer request superseded this one → it commits, not this
      _CATALOG_INDEX = idx; _CATALOG_KEY = key;
      _CATALOG_BY_ID = Object.fromEntries(idx.map(it => [it.id, it]));
    }
    return idx;
  }).catch(forget);          // .catch, not a second .then argument: it must also catch a throw INSIDE the handler above
  _CATALOG_REQ = { key, p };
  return p;
}

// Block-list catalog (Blocking tab): categories + providers + pickable lists. Loaded on demand and cached, then
// mirrored onto Store.blockCatalog so screens can read it synchronously; pass force=true to refetch after a save.
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
export const blockHostBlind = mode => !blockTierOk(mode, "host");                                  // this node can't enforce ANY domain list
export const blockProvTier = (providers, p) => ((providers || []).find(x => x.id === p) || {}).tier || "host";
export const blockSrcOk = (mode, providers, s) => blockTierOk(mode, blockProvTier(providers, s.provider));   // a single list/source enforces here?
export const blockCatHasIp = (providers, c) => (c.sources || []).some(s => blockProvTier(providers, s.provider) === "ip");
export const blockCatDisabled = (mode, providers, c) => blockHostBlind(mode) && !blockCatHasIp(providers, c);   // no enforceable list → dead on this node
// Does ANY list of this category enforce here — a provider that is switched on, of a kind this mode can match? The
// panel skips the rest (_resolve_iface_blocks), so a category without one blocks nothing however its chip is set.
export const blockProvOn = (providers, p) => ((providers || []).find(x => x.id === p) || {}).enabled !== false;
export const blockCatLive = (mode, providers, c) => (c.sources || []).some(s => s.provider && blockProvOn(providers, s.provider) && blockSrcOk(mode, providers, s));
// Built on FIRST READ, never at import: modules load before loadLang() resolves, so a T() here would
// freeze in English whatever the catalog says (see --frozen).
let _mech_hint = null;
// Mechanisms the node does not build yet. They stay in the catalog and in any stored block[] (nothing is rewritten), but no
// screen offers them: a switch that blocks nothing is worse than no switch — and blocking WebRTC would break calls (Meet).
const MECH_UNBUILT = new Set(["cryptomining", "webrtc"]);
export const MECH_HINT = () => (_mech_hint || (_mech_hint = {   // Torrents / P2P is a choice of its own (`IfaceP2p`), not a chip
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

// The default block set for a NEW interface on `node`: every default-on category available here — mechanisms are
// built-in (always available), content/IP categories must be enabled on this node (Settings ▸ Routing & Blocking).
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
  // the exits' own namer — but an exit no longer in the list is named by its id: `exitLabel` of a bare id reads "Custom"
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
  const byId = l => (l || []).find(e => e && String(e.id) === String(rec.exit_id));   // stored first (its live udp_ok), else the
  const x = rec && rec.action === "dev" ? (byId((node || {}).exits) || byId(draft)) : null;   // draft's: one added in this edit (F37)
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
  // a pick → [block[], p2p]: Block is "torrents" in block[] and no p2p; every other row takes "torrents" out
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
  const mech = list.filter(c => c.kind === "mechanism" && !MECH_UNBUILT.has(c.id) && !(onP2p && c.id === "torrents"));   // its own row below
  const chip = c => { const dis = blockCatDisabled(mode, bc.providers, c);
    const dead = !dis && !blockCatLive(mode, bc.providers, c);   // enforceable in this mode, but none of its lists is switched on / present
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
      ${content.length ? nbLine(node, mode) : null}</div>
    <div class="blk-grp"><div class="blk-gtitle">${T("Traffic & abuse")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— built-in")}</span></div>
      ${onP2p ? html`<${IfaceP2p} node=${node} block=${value} p2p=${p2p}
        onPick=${(b, p) => { onChange(b); onP2p(p); }}/>` : null}
      <div class="blk-chips">${mech.map(mchip)}</div></div>
  </div>`;
}



// Add-a-list picker for a block category (expanded row): a popover of every enabled provider's lists, grouped by
// provider, minus the ones already in this category. Tapping one adds it; the popover stays open for multiple adds.
export function BlockListPicker({ providers, provLists, current, nodeMode, onAdd, autoOpen }) {
  const [q, setQ] = useState("");
  const has = (p, l) => (current || []).some(s => s.provider === p && s.list === l);
  const ql = q.trim().toLowerCase();
  // A domain (host) provider list can't enforce where domains aren't DNS-filled (IP-only, Kernel-SNI). IP lists work
  // everywhere. Same shared rule (blockTierOk) as every other block gate. Badge it, still addable.
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

// Create a custom block category — just a name. It matches by whatever the lists you add are (domains and/or IPs).
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
// The operator's own list, by either of the two ids the fleet may name it with.
const customListOf = id => (Store.panelSettings?.custom_lists || []).find(l => l && (l.id === id || l.name === id)) || null;
/** The same verdict shape as targetGate, for a LIST badge. Three reasons, one treatment: this engine cannot
 *  match the list's tier, the list is switched off on this node, or its provider is switched off. */
export function listGate(mode, id, node) {
  const cl = customListOf(id);
  if (cl && (cl.disabled_nodes || []).includes(node)) return { ok: false, why: "list_off_node" };
  const prov = providerOf(id);
  if (prov && prov !== "curated" && (Store.panelSettings?.providers || {})[prov] === false) return { ok: false, why: "prov_off" };
  if (!mode) return { ok: true };                       // node record not loaded → gate nothing
  const caps = cl ? customCaps(cl) : catCapsAny(id);
  if (!caps.ip && !caps.host) return { ok: true };      // capability unknown → gate nothing
  return routeCapsUsable(mode, caps) ? { ok: true } : { ok: false, why: "engine", fix: "forcedns" };
}
/** The verdict for any badge — the one call every gate in the field and in egressSaveBlock goes through. */
export const badgeGate = (mode, node, b) => b.t === "list" ? listGate(mode, b.id, node) : targetGate(mode, b.kind);
const _ipKind = k => k === "ip" || k === "asn";
/** Does this badge match by site name? A list by what it can hold, a typed target by its kind. The ONE test: the per-person
 *  Kernel SNI gate, the Block notices, the port chip and the lints all ask it. */
const _listCaps = b => customListOf(b.id) ? customCaps(customListOf(b.id)) : catCapsAny(b.id);
const _nameBadge = b => { const caps = b.t === "list" ? _listCaps(b) : null; return caps ? !!caps.host : !_ipKind(b.kind); };
export function rowGate(row, mode, node, b) {
  const g = badgeGate(mode, node, b);
  if (!g.ok || mode !== "sni_kernel") return g;
  const caps = b.t === "list" ? _listCaps(b) : null;
  if (!_nameBadge(b)) return g;
  // A DIRECT OR BLOCK ROW BY SITE NAME RUNS HERE since 1.8.8 (KSNI-HOSTNAMES D3) — the badge that said it was inert
  // (F19) is gone with the gap; only a per-person row still needs the kernel to bind its devices, below.
  if (!(row && row.who) || ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) >= 2) return g;
  return caps && caps.ip ? { ...g, note: T("Kernel SNI on this node can't match hostnames for chosen people — only this rule's IP addresses and networks apply here. Switch to Hybrid SNI to match them.") }
    : { ok: false, why: "person_ksni", fix: "sni" };
}

const _byName = r => r.enabled !== false && r.action !== "block" && (r.badges || []).some(_nameBadge);
export const catchAllPreemptsNames = (mode, rows, catchAll) => (mode === "sni" || mode === "sni_kernel")
  && !!catchAll && catchAll.action === "block"          // only a catch-all that is on reaches here (rulesToRows, setCatch)
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
/** "UDP 19302–19309", "TCP 443, 8000–8100", "every UDP port". */
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

const _LIST_INFO_PENDING = {};   // id -> ts of the ask now in flight
const _LIST_INFO_WAIT = {};      // id -> Set(onDone) — everyone waiting on that one ask
const _sizeOfInfo = d => {
  if (!d || !d.tiers) return { err: true };
  const host = (d.tiers.host || {}).n || 0, ip = (d.tiers.ip || {}).n || 0;
  if (host || ip) return { host, ip };
  const any = f => Object.keys(d.tiers).some(k => d.tiers[k] && d.tiers[k][f]);
  if (any("pending")) return null;
  return any("failed") ? { err: true } : { host: 0, ip: 0 };
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
  const fire = () => { for (const f of [...(_LIST_INFO_WAIT[id] || [])]) { try { f(); } catch (_) { /* unmounted */ } } };
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
function ListBadgeSize({ cat, onRetry }) {
  if (!knownListId(cat)) return html`<span class="tfb-size missing"
    title=${T("No list with this id — its provider may be switched off in Settings, or the list was withdrawn upstream. The rule keeps it, and it matches nothing until it comes back.")}>${T("list|not found")}</span>`;
  const sz = listSizeNow(cat);
  if (sz && !sz.err) return sizeSummary(sz.host, sz.ip) ? null : html`<span class="tfb-size missing"
    title=${T("The panel resolved this list and it holds nothing — check the id, or the source may have emptied it.")}>${T("list|empty")}</span>`;
  if (!sz) return html`<span class="tfb-size preparing" title=${T("The panel is fetching this list now — it routes as soon as it lands.")}>${T("preparing…")}</span>`;
  // The rule saves and routes as soon as the list lands; this is not an error, it is a wait with a way out.
  return html`<button type="button" class="tfb-size notready" title=${T("The panel hasn't fetched this list yet. The rule saves either way and routes as soon as it lands — click to ask again.")}
    onClick=${e => { e.stopPropagation(); delete _LIST_INFO_CACHE[cat]; delete _LIST_INFO_PENDING[cat];
                     askListInfo(cat, onRetry, { retry: true }); onRetry(); }}>${T("not ready")}</button>`;
}

// THE TEXT FORM OF A BADGE
const readToken = (tok, mode, listEditor) => rrReadToken(tok, {
  allowKind: k => targetGate(mode, k).ok,
  knownList: listEditor ? () => false : knownListId,
});

export const knownListId = id => !!id && String(id).toLowerCase() !== "all" && (
  SMART_CATEGORIES().some(([c]) => c === id)                                    // a curated preset
  || (Store.panelSettings?.custom_lists || []).some(l => l && l.id === id)      // one the operator wrote
  || (isProviderCat(id) && (!!_CATALOG_BY_ID[id]                                // already indexed…
                            || !_CATALOG_INDEX || !_CATALOG_INDEX.length)));    // …or there is no index to ask

const listSourceOf = id => provLabelOf(id) || (customListOf(id) ? T("Custom") : T("Unknown list"));

// The resolved size as a string, or "" — for the badge TOOLTIP, since the badge no longer spends a row on it.
const listSizeOf = cat => { const sz = listSizeNow(cat);
  return sz && !sz.err ? (sizeSummary(sz.host, sz.ip) || T("empty")) : ""; };

function Badge({ b, gate, node, modeLabel, onRemove, onEdit, onFix, onRetry, onReveal, editing }) {
  const inert = !gate.ok;
  const isList = b.t === "list";
  const wide = !isList && KIND_WIDE[b.kind];
  const puny = isList ? "" : targetPuny(b.kind, b.value);
  const title = inert ? gateReason(gate, modeLabel)
    // NAMED BY ITS PROVIDER, from the same source as the chip beside it, so the two cannot say different
    // things about one badge: "Curated list — …", "v2fly list — …", "Custom list — …".
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
    ${/* A LIST BADGE WAS INERT. Clicking it fell through to the box, which opens the dropdown at the top —
          so the operator had to go and find the thing they had just pointed at. It now opens AT that list. */""}
    <button type="button" class="tfb-main" onClick=${() => (isList ? (onReveal && onReveal(b.id)) : onEdit())} title=${title}>
      <span class="tfb-lbl">${isList ? catLabelOf(b.id) : targetLabel(b.kind, b.value)}</span>
      ${isList ? html`<${ProvTag} id=${b.id} label=${listSourceOf(b.id)}/>`
        : html`<span class=${"capb " + (wide ? "wide" : "kind")}>${KIND_LABEL()[b.kind]}</span>`}
    </button>
    ${isList ? html`<${ListBadgeSize} cat=${b.id} onRetry=${onRetry}/>` : null}
    ${inert && gate.fix && onFix ? html`<button type="button" class="tfb-fix" title=${T("Switch this node to {v1}", { v1: (MODE_META[gate.fix] || {}).label || gate.fix })}
      onClick=${e => { e.stopPropagation(); onFix(gate.fix); }}><${Ic} i="refresh"/></button>` : null}
    <button type="button" class="tfb-x" title=${T("Remove")} aria-label=${T("Remove {v1}", { v1: isList ? catLabelOf(b.id) : targetLabel(b.kind, b.value) })}
      onClick=${e => { e.stopPropagation(); onRemove(); }}><${Ic} i="x"/></button>
  </span>`;
}

// Overflow threshold: past this many badges a row would push its destination dropdown off screen, so the tail
// collapses behind a count that expands in place. Fifteen services in one row is the point of the field.
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
  // THE FIELD'S STATE, and the two rules that keep it consistent
  const [q, setQ] = useState("");
  // A phone: a pick clears the box for the next search but the list stays on what was being browsed, scrolled where the pick
  // was, until something is typed (operator, 2026-10-29: "keep it where I just added an item")
  const [holdQ, setHoldQ] = useState(null);
  // …and has no pages: its list grows by a page as it is scrolled near its end (operator, 2026-10-29: "remove pagination")
  const [more, setMore] = useState(1);
  // one page per render: a fling fires many scroll events before the grown list is drawn (F57); a closed search starts over
  const growing = useRef(false);
  useEffect(() => { growing.current = false; }, [more]);
  const [open, setOpen] = useState(false);
  const onKeyRef = useRef(null);   // the latest `onKey`, for the dropdown's window-level Escape (its effect runs only on `open`)
  const [pos, setPos] = useState(null);
  const [act, setAct] = useState(-1);
  const [editing, setEditing] = useState(null);
  const [reveal, setReveal] = useState(null);   // a list id to scroll to once the dropdown has rendered it
  const [asText, setAsText] = useState(false);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(0);
  const [cidx, setCidx] = useState(_CATALOG_INDEX);
  const [expand, setExpand] = useState(false);
  const [say, setSay] = useState("");                       // aria-live: what just happened
  const [pending, setPending] = useState({ text: "", forQ: null });
  const [tries, bump] = useState(0);                        // a size landed, went late, or was asked for again
  const ref = useRef(null), popRef = useRef(null), inRef = useRef(null);
  const badges = row.badges || [];
  const modeLabel = (MODE_META[mode] || {}).label || mode;
  useListSizes(badges.filter(b => b.t === "list").map(b => b.id), () => bump(x => x + 1), tries);
  useAsnCounts(badges.filter(b => b.t === "target" && b.kind === "asn").map(b => b.value));

  const lq = (holdQ != null && !q) ? holdQ : q;   // what the list is searched by: the typed box, or the search a pick left held
  const ql = lq.trim().toLowerCase();
  const listTok = /^list:(.+)$/i.exec(q.trim());
  const readList = (listTok && !listEditor) ? { id: listTok[1].trim(), ok: knownListId(listTok[1].trim()) } : null;
  // What a typed list that cannot be added says: `all` is pointed at "Everything else", anything else is no such list.
  const noList = () => /^all$/i.test((readList || {}).id || "") ? T("For all traffic, use “Everything else” below the rules")
    : T("No list called {v1} on this panel", { v1: q.trim() });
  const reading = (!listTok && q.trim()) ? classify(q.trim()) : null;     // the "use this" row, when what is typed parses
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
      // Counted as it goes, not up front: a paste has to stop at the budget rather than be refused whole,
      // and what came before the limit is worth keeping.
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
    if (isMobile() && b.t === "list" && q.trim()) { setHoldQ(q); setQ(""); setAct(-1); setPending({ text: "", forQ: null }); }   // page and scroll stay
    else { setHoldQ(null); setQ(""); setPage(0); setAct(-1); setPending({ text: "", forQ: null }); }
    setSay(added.length ? T("Added {v1}", { v1: added[0] }) : T("Already in this rule."));
    if (inRef.current) inRef.current.focus();
  };
  const commitList = id => commit({ t: "list", id });
  const commitTyped = () => {
    // THROUGH `readToken`, so the box understands `list:youtube` exactly as the textarea does. Text copied
    // out of one rule has to paste into another as the same thing, and the box is where most of it lands.
    const parts = String(q || "").split(/[\s,]+/).filter(Boolean).map(t => ({ tok: t, r: readToken(t, mode, listEditor) }));
    if (!parts.length) return;
    const good = [], bad = [];
    for (const { tok, r } of parts) (r && r.b) ? good.push(r.b) : bad.push({ raw: tok, why: (r || {}).why });
    if (editing && !bad.length && good.length === 1 && badgeIdentity(good[0]) === badgeIdentity(editing.b)) {
      setEditing(null); setQ(""); setPage(0); setAct(-1); setPending({ text: "", forQ: null });
      return "";
    }
    // THE EDITED BADGE IS REPLACED, not duplicated: dropping it from the base means the new value is not
    // refused as a duplicate of itself, and the old one does not survive beside it.
    const base = editing ? badges.filter(x => x !== editing.b) : badges;
    const { added, overCap, next } = addAll(good, { base, defer: true });
    const rest = [...bad.map(b => b.raw), ...overCap].join(" ");
    if (added.length || editing) { onChange(next); setEditing(null); }
    setQ(rest);                                            // both kinds of leftover stay in the box, editable
    const msg = bad.length ? (bad[0].why === "catch_all" && !listEditor ? T("For all traffic, use “Everything else” below the rules")
                              : bad[0].why === "unknown_list" || bad[0].why === "catch_all" ? (listEditor ? T("A list can't contain another list — add its addresses here instead") : T("No list called {v1} on this panel", { v1: bad[0].raw }))
                                                            : T("{v1} was not added", { v1: bad[0].raw }))
      : overCap.length ? capSay()
      : added.length ? T("Added {v1}", { v1: added.join(", ") })
      : T("Already in this rule.");
    setSay(msg);
    setPending({ text: rest ? msg : "", forQ: rest });      // only while something actually stayed behind
    setPage(0); setAct(-1);
    return rest;                                           // "" when everything landed — edit() needs to know
  };
  // Декодируем исходную запись для редактирования, сохраняя синтаксис шаблонов.
  // Исходное значение остаётся в правиле до подтверждения правки, чтобы сохранение его не потеряло.
  const edit = i => { const b = badges[i]; if (b.t !== "target") return;
    if (editing && editing.b === b) { if (inRef.current) inRef.current.focus(); return; }
    if (commitTyped()) return;              // something in the box could not land — fix that before moving on
    setEditing({ b });
    setQ(idnHost(b.raw));                   // `raw`, so an IDN name comes back as the operator wrote it
    setPending({ text: "", forQ: null }); setPage(0); setAct(-1);
    if (inRef.current) inRef.current.focus(); };
  const remove = i => { const b = badges[i]; onChange(badges.filter((_, j) => j !== i));
    setSay(T("Removed {v1}", { v1: b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value) })); };
  // By id rather than index, because the dropdown row knows which LIST it is and not where its badge sits.
  const removeList = id => { onChange(badges.filter(b => !(b.t === "list" && b.id === id)));
    setSay(T("Removed {v1}", { v1: catLabelOf(id) }));
    if (inRef.current) inRef.current.focus(); };

  const ckey = catalogKey();
  useEffect(() => { if (open) { let live = true; loadCatalogIndex().then(x => live && setCidx(x)); return () => { live = false; }; } }, [open, ckey]);
  useEffect(() => { if (!open) { setMore(1); setHoldQ(null); } }, [open]);   // a closed search starts over (F57)
  const place = () => { const el = ref.current; if (!el) return; setPos(placeWide(el)); };
  useEffect(() => {
    if (!open) return; place();
    // a phone's search takes a history entry as a sheet does, so Back closes it (ui.js attachBackCloses) rather than the page
    if (isMobile()) history.pushState({ swgSearch: 1 }, "");
    // A phone scrolls the sheet under a list that is pinned to the screen: once its field leaves the sheet's view the list is
    // closed (and the keyboard with it) rather than drawn over the sheet's head or its buttons (operator, 2026-10-29)
    const onMove = () => { if (!isMobile()) place(); };   // a phone's list is docked by m/m.css (.m-tfsearch), not placed
    const onDoc = e => { const t = e.target;
      // The foot's controls (the rule's settings button, its destination) sit inside this field but are not the search: a
      // click there closes it, or the list stays open under the window or the dropdown it opened.
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
  const _curated = SMART_CATEGORIES().filter(([id]) => id !== "all")
    .map(([id, label]) => ({ id, provider: "curated", provider_label: T("Curated"), caps: catCap(id), disp: label }))
    .filter(it => !ql || it.id.toLowerCase().includes(ql) || it.disp.toLowerCase().includes(ql) || catDescOf(it.id).toLowerCase().includes(ql))
    .sort((a, b) => a.disp.toLowerCase().localeCompare(b.disp.toLowerCase()));
  const _mine = (Store.panelSettings?.custom_lists || [])
    .filter(l => l && (!ql || String(l.title || "").toLowerCase().includes(ql) || String(l.id || "").toLowerCase().includes(ql)))
    // `label` is what CatalogRow titles the row with — without it prettyCatLabel falls through to titleizing
    // the id, and "Office subnets" rendered as "Cl Office".
    .map(l => ({ id: l.id, provider: "custom", provider_label: T("Custom"), caps: customCaps(l),
                 disp: l.title || l.id, label: l.title || l.id, list: l }))
    .sort((a, b) => a.disp.toLowerCase().localeCompare(b.disp.toLowerCase()));
  const _hits = (ql.length >= 2 && cidx) ? cidx.filter(it => it.hay.includes(ql)).sort((a, b) => a.disp.localeCompare(b.disp)) : [];
  const _qn = ql.replace(/[^a-z0-9]/g, "");
  const _provHit = _qn.length >= 3 && !lq.includes("*") ? (Store.catalogProviders || []).filter(p => !p.builtin && p.enabled
    && String(p.label || "").toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(_qn)) : [];
  const _provGroups = _provHit.map(p => ({ p, all: (cidx || []).filter(it => it.provider === p.id) }));
  const _hitIds = new Set(_hits.map(it => it.id));
  const _cat = _hits.concat(..._provGroups.map(g => g.all.filter(it => !_hitIds.has(it.id))
    .sort((a, b) => a.disp.localeCompare(b.disp)).map(it => ({ ...it, grpProv: g.p.label }))));
  // Matched by name but nothing of it in the index yet: say why, rather than "No list matches". A failed fetch in the full
  // rebuild leaves the status `uptodate` and says so only in `error` — that is a failure too.
  const _provWait = _provGroups.filter(g => !g.all.length && (g.p.status === "downloading" || g.p.status === "failed" || g.p.error)).map(g => g.p);
  const catPage = _cat.slice(page * per, (page + 1) * per);
  const pages = Math.max(1, Math.ceil(_cat.length / per));
  const has = id => badges.some(b => b.t === "list" && b.id === id);
  const revealList = id => {
    setOpen(true); setEditing(null);
    const local = SMART_CATEGORIES().some(([c]) => c === id)
               || (Store.panelSettings?.custom_lists || []).some(l => l && l.id === id);
    if (local) { setQ(""); setPage(0); }
    else {
      const term = catRawId(id).toLowerCase();
      setQ(catRawId(id));
      const hits = (cidx || []).filter(it => it.hay.includes(term)).sort((a, b) => a.disp.localeCompare(b.disp));
      const at = hits.findIndex(it => it.id === id);
      setPage(at >= 0 ? Math.floor(at / per) : 0);
    }
    setReveal(id);
  };

  const rows = [];
  if (reading && reading.kind !== "invalid") rows.push({ k: "use" });
  if (!listEditor) {                      // a list cannot hold a list, so it is not offered one
    _curated.forEach(it => rows.push({ k: "list", it, grp: T("Recommended presets") }));
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
      list.scrollTop += (er.top + er.height / 2) - (lr.top + lr.height / 2);   // put it on the list's midline
      if (passes === 0) {                                     // highlight once; re-centring must not re-announce
        const tf = [...root.querySelectorAll(".tfrow")];
        setAct(tf.indexOf(el) + (root.querySelector(".tfuse") ? 1 : 0));       // the "use what you typed" row is rows[0]
      }
      if (++passes < 6) timer = setTimeout(centre, 70); else setReveal(null);
    };
    timer = setTimeout(centre, 0);
    return () => clearTimeout(timer);
  }, [reveal, open, page, q]);

  // the two directions of the text view
  const toText = () => { loadCatalogIndex();   // so `list:` ids can be checked for real by the time they return
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
    setAsText(false); setDraft(""); setQ(""); setPending({ text: "", forQ: null });   // the draft IS the rule now
    setSay(added.length ? T("{v1} in this rule", { v1: plural(added.length, "target") }) : T("Rule emptied."));
  };

  const onKey = e => {
    if (e.key === "Escape") {
      if (editing) { e.stopPropagation();      // the badge never left the row — just stop editing it
        setQ(""); setEditing(null); setOpen(false); setPending({ text: "", forQ: null }); setAct(-1);
        setSay(T("Edit discarded — {v1} is unchanged", { v1: targetLabel(editing.b.kind, editing.b.value) }));
        return; }
      if (open) { e.stopPropagation(); setOpen(false); }
      return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct(a => Math.min(a + 1, rows.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setAct(a => Math.max(a - 1, -1)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeRow && activeRow.k === "list") { const id = activeRow.it.id;   // same toggle the click does
        if (has(id)) removeList(id); else if (listGate(mode, id, node).ok) commitList(id);
        return; }
      if (readList) { if (readList.ok) commitList(readList.id);
        else { const m = noList(); setSay(m); setPending({ text: m, forQ: q }); }
        return; }
      if (readGate && readGate.ok) commitTyped();
      return;
    }
    if (e.key === "," || e.key === " " || (e.key === "Tab" && q.trim() && readGate && readGate.ok)) {
      if (e.key === " " && !q.trim()) return;                 // a lone space in an empty box is not a commit
      e.preventDefault(); commitTyped(); return; }
    if (e.key === "Backspace" && !q && badges.length) { e.preventDefault(); edit(badges.length - 1); }
  };
  onKeyRef.current = onKey;
  const onPaste = e => {
    const txt = (e.clipboardData || {}).getData ? e.clipboardData.getData("text") : "";
    if (!txt || !/[\s,]/.test(txt.trim())) return;                    // a single token: let it type normally
    e.preventDefault();
    // Same reader as the box and the textarea: paste a rule copied out as text and it lands as badges,
    // `list:` lines included. Which format you get is the format you paste INTO, not the one you copied from.
    const parts = txt.split(/[\s,]+/).filter(Boolean).map(t => ({ tok: t, r: readToken(t, mode, listEditor) }));
    const good = parts.filter(x => x.r && x.r.b).map(x => x.r.b);
    const bad = parts.filter(x => !(x.r && x.r.b)).map(x => ({ raw: x.tok }));
    const { added, overCap } = addAll(good);
    const rest = [...bad.map(b => b.raw), ...overCap].join(" ");
    setQ(rest);
    const msg = overCap.length ? capSay()
      : T("{v1} added, {v2} left to fix", { v1: added.length, v2: bad.length });
    setSay(msg);
    setPending({ text: rest ? msg : "", forQ: rest });      // only while something actually stayed behind
  };

  const leftovers = /[\s,]/.test((q || "").trim());

  // The cost meter (§3.4). An estimate, and labelled as one: list sizes are what the panel resolved, a typed
  // name is one name, an AS number is however many prefixes it announced when the hint last asked.
  const meter = (() => {
    let names = 0, nets = 0;
    for (const b of badges) {
      if (b.t === "list") { const s = listSizeNow(b.id); if (s && !s.err) { names += s.host || 0; nets += s.ip || 0; } continue; }
      if (b.kind === "ip") nets += 1;
      else if (b.kind === "asn") nets += asnNets(b.value);
      else names += 1;
    }
    // plural(), not "n + word": Russian picks between three forms and the rule is not derivable from English.
    const bits = [plural(badges.length, "entry")];
    if (names) bits.push(plural(names, "name").replace(String(names), fmtCount(names)));
    if (nets) bits.push(plural(nets, "network").replace(String(nets), fmtCount(nets)));
    return bits.join(" · ");
  })();

  const shown = expand ? badges : badges.slice(0, BADGE_CAP);
  const hidden = badges.length - shown.length;
  const fixBtn = g => g.fix && onSwitchMode
    ? html` <button type="button" class="linkbtn" onClick=${e => { e.stopPropagation(); setOpen(false); onSwitchMode(g.fix); }}>${T("Switch this node to {v1}", { v1: (MODE_META[g.fix] || {}).label || g.fix })}</button>`
    : null;
  const listRow = it => { const g = listGate(mode, it.id, node), added = has(it.id), i = rows.findIndex(r => r.it === it);
    // `i >= 0` because BOTH sides can be −1: findIndex misses return −1, and −1 is also "nothing highlighted".
    // Left as a bare `i === act` those two agree, and every row the lookup failed on draws itself as selected.
    return html`<div class=${"tfrow" + (i >= 0 && i === act ? " act" : "")} key=${it.id} data-lid=${it.id} onMouseEnter=${() => setAct(i)}>
      <${CatalogRow} it=${it} added=${added} onPick=${() => (added ? removeList(it.id) : g.ok && commitList(it.id))}/>
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
    ${/* IN THE RAIL, not the foot. It belongs beside the drag grip because it is a control ON the field
          rather than a fact ABOUT it, and the foot is where the facts are — the entry count, the reading of
          what is typed, the destination. Absolutely placed into the row's grip column: the state it toggles
          lives here, so lifting it into the row would have meant lifting `asText` with it. */""}
    ${listEditor ? null : vtog(true)}
    ${/* ESCAPE ABANDONS THE DRAFT, exactly as it abandons a badge edit. Without it the only way out of text
          view was to make every line valid — an operator who pasted the wrong file, or who opened the view
          just to copy from it, would have had to repair text they never meant to keep. */""}
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
    ${/* Badges cannot be selected, so without this a rule can be built and never read back out. */""}
    ${listEditor ? null : vtog(false)}
    <div class="tf-box" onClick=${() => inRef.current && inRef.current.focus()}>
      ${shown.map((b, i) => html`<${Badge} key=${badgeIdentity(b) + i} b=${b} gate=${rowGate(row, mode, node, b)} node=${node} modeLabel=${modeLabel}
        editing=${!!(editing && editing.b === b)}
        onRemove=${() => remove(i)} onEdit=${() => edit(i)} onFix=${onSwitchMode} onRetry=${() => bump(x => x + 1)}
        onReveal=${revealList}/>`)}
      ${hidden > 0 ? html`<button type="button" class="tf-more" onClick=${() => setExpand(true)}>${T("+{v1} more", { v1: hidden })}</button>` : null}
      ${expand && badges.length > BADGE_CAP ? html`<button type="button" class="tf-more" onClick=${() => setExpand(false)}>${T("show fewer")}</button>` : null}
      ${/* While the dropdown is open, Enter and Escape belong to the FIELD: Enter commits the highlighted row
            and Escape closes the dropdown. Without this the Sheet's own handler treats Enter as "press the
            primary button", so committing a badge also saved the whole interface — which it duly did, twice,
            while this was being tested. Closed, both go back to the sheet, so a second Escape still closes it. */""}
      <input ref=${inRef} class=${"tf-in" + (reading && reading.kind === "invalid" ? " bad" : "")} type="text" spellcheck="false" autocomplete="off"
        data-enter=${open ? "self" : null} data-noautofocus="1"
        role="combobox" aria-expanded=${open ? "true" : "false"} aria-autocomplete="list"
        placeholder=${badges.length ? T("add another…")
          : listEditor ? T("Address, IP range, AS number or pattern…")
          : T("Search a service, or type an address, IP range or AS number…")}
        value=${q} onInput=${e => { setHoldQ(null); setMore(1); setQ(e.target.value); setPage(0); setAct(-1); setOpen(true); }}
        onFocus=${() => setOpen(true)} onKeyDown=${onKey} onPaste=${onPaste}/>
    </div>
    <div class="tf-foot">
      ${/* THE × AND THE COUNT ARE ONE ITEM. Anchoring the × to the foot's top could not line it up: the foot
            is baseline-aligned and the destination select is the tallest thing on the line, so the count
            sits 11px below the top and the × floated above it. Paired in a flex box they align to each
            OTHER by construction — no offset to keep in step with the select's height. */""}
      <span class="tf-lstart">${leading ? html`<span class="tf-lead">${leading}</span>` : null}
        ${badges.length ? html`<span class="tf-meter" title=${T("An estimate from what the panel has resolved so far. The node's own report is the authority once it syncs.")}>${meter}</span>` : null}</span>
${/* The reading and its consequence live in the dropdown's "use what you typed" row while that row exists —
       saying the same sentence here at the same time is just noise. What is left for this line is what has no
       row of its own: a token that parses as nothing, and the empty-row invitation. */""}
      ${leftovers ? (pending.text && pending.forQ === q
            ? html`<span class="tf-lint err">${pending.text}</span>` : null)
        : (listEditor && listTok) ? html`<span class="tf-lint err">${T("A list can't contain another list — add its addresses here instead")}</span>`
        : readList && !readList.ok ? html`<span class="tf-lint err">${noList()}</span>`
        : reading && reading.kind === "invalid" ? html`<span class="tf-lint err">${targetWhy(reading.why, q)}</span>`
        : reading ? (open ? null : html`<span class="tf-say">${readGate && readGate.ok ? targetSentence(reading.kind, reading.value) : gateReason(readGate || {}, modeLabel)}</span>`)
        : !badges.length ? html`<span class="tf-say">${listEditor ? T("Type an address, IP range, AS number or pattern.")
              : Trich("Try a service name like *YouTube*, or type an address, IP range or AS number.")}</span>` : null}
      ${listEditor ? html`<span class="grow"></span>${vtog(false)}` : null}
      ${trailing ? html`<span class="tf-trail">${trailing}</span>` : null}
    </div>
    <span class="tf-live" aria-live="polite">${say}</span>
    ${/* IN A CUSTOM LIST THE POPOVER IS ONLY EVER THE "use what you typed" ROW, so it opens only when that
          row exists. Empty, it was a box whose entire content repeated the placeholder directly above it —
          chrome reporting that it has nothing to report. The reading it would have shown is not lost: the
          foot already prints it whenever the dropdown is closed. */""}
    ${open && pos && (!listEditor || rows.length) ? html`<${Portal}><div ref=${popRef} class=${"catpick-pop wide tfpop" + (pos.flip ? " flip" : "")}
        style=${"left:" + pos.left + "px;top:" + pos.top + "px;width:" + pos.width + "px;--catpick-maxh:" + (pos.maxh - 119) + "px"}>
      ${/* 119 = the 90 the list always left for the pager and padding, plus the 29px ✕ strip above it */""}
      <div class="tfpop-head"><button type="button" class="pop-x" aria-label=${T("Close")} title=${T("Close")} onClick=${() => { setOpen(false); setHoldQ(null); if (isMobile() && inRef.current) inRef.current.blur(); }}><${Ic} i="x"/></button></div>
      <div class="catpick-list" onScroll=${isMobile() ? (e => { const l = e.currentTarget;
          if (!growing.current && _cat.length > per && l.scrollTop + l.clientHeight > l.scrollHeight - 400) { growing.current = true; setMore(m => m + 1); } }) : null}>
${/* A DISABLED <button> DOES NOT DELIVER CLICKS TO ITS CHILDREN, so the "Switch this node to…" control that
       used to live inside this row was dead to a real mouse — and it is rendered ONLY when `readGate.ok` is
       false, which is exactly when the row is disabled, so it was dead every single time it appeared. Script
       clicks fired it (that is how it was isolated: dispatchEvent worked, a real click did nothing), which is
       also why no automated check would have caught it.
       So the row is a BUTTON only while it is actually actionable, and a DIV once it is not. The classes are
       unchanged, so `.tfuse.off` still dims it and `cursor:not-allowed` still says it cannot be used — what
       changes is that the one control inside it that IS meant to be used can now be clicked. */""}
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
              ${/* `kind`, not `host`: this chip carries the KIND, and `capb host` is the tier chip whose legend
                     two screens over reads "matched by domain name — needs Force-DNS or Hybrid-SNI". An `ip`
                     target is not wide, so it took that class and wore the host-tier colour while its own text
                     said IP. The committed badge below has always used `kind`; this is the preview catching up. */""}
              <span class=${"capb " + (KIND_WIDE[reading.kind] ? "wide" : "kind")}>${KIND_LABEL()[reading.kind]}</span></span>
            <span class="tfuse-say">${readGate.ok
              ? targetSentence(reading.kind, reading.value) + opTooLongNote(node, reading.kind, reading.value)
              : gateReason(readGate, modeLabel)}</span>
            ${!readGate.ok ? fixBtn(readGate) : null}
          <//>` : null}
        ${rows.filter(r => r.k === "list").map(r => { const head = r.grp !== lastGrp ? (lastGrp = r.grp) : null;
          return html`<${Fragment}>${head ? html`<div class="catpick-grp">${head}</div>` : null}${listRow(r.it)}<//>`; })}
        ${/* A STAR MEANS THEY ARE WRITING A PATTERN, NOT SEARCHING. No list is called `*.ru`, so "No list
              matches “*.ru”." is a true sentence about a question nobody asked — and it sat directly under
              the "Use what you typed" row that had already answered them, which made the field read as
              though it had rejected the rule it was in fact offering to create. The same is arguably true
              of an IP or an AS number, which can no more be a list name; left alone deliberately, because
              a plain domain like `youtube.com` IS worth searching the catalog for and the line between
              those two is the star, not "does it classify". */""}
        ${/* All three report on a CATALOG SEARCH. A custom list has no catalog, so "nothing matches" is an
              answer to a question nobody asked — and the operator reads it as their own address being
              rejected, which is the opposite of what it means. */""}
        ${!listEditor ? _provWait.map(p => html`<div class="catpick-empty">${p.status === "downloading"
            ? T("{v1} is still downloading its list catalog — its lists appear here when it finishes.", { v1: p.label })
            : T("{v1} could not download its list catalog — retry it in Settings ▸ Geo data providers.", { v1: p.label })}</div>`) : null}
        ${!listEditor && ql.length >= 2 && !q.includes("*") && !_cat.length && !_provWait.length && cidx ? html`<div class="catpick-empty">${T("No list matches “{q}”.", { q })}</div>` : null}
        ${!listEditor && ql.length === 1 ? html`<div class="catpick-empty">${T("Keep typing to search the provider catalog.")}</div>` : null}
        ${!listEditor && !rows.length && !ql ? html`<div class="catpick-empty">${T("Type a service name, an address, an IP range or an AS number.")}</div>` : null}
      </div>
      ${_cat.length > per && !isMobile() ? html`<div class="catpick-foot">
        <span class="catpick-count">${T("{v1}–{v2} of {v3}", { v1: page * per + 1, v2: Math.min(_cat.length, (page + 1) * per), v3: _cat.length })}</span><span class="grow"></span>
        <div class="catpick-nav">
          <button type="button" class="btn btn-mini" disabled=${page === 0} onClick=${() => { setPage(p => Math.max(0, p - 1)); setAct(-1); }} >${T("‹ Prev")}</button>
          <button type="button" class="btn btn-mini" disabled=${page >= pages - 1} onClick=${() => { setPage(p => Math.min(pages - 1, p + 1)); setAct(-1); }} >${T("Next ›")}</button>
        </div></div>` : null}
      ${isMobile() ? html`<button type="button" class="btn btn-primary m-tfdone" onClick=${() => {
          // ONE RESULT IS NOT A CHOICE here either: Done takes it, as Enter does, then closes (operator, 2026-10-29). What could
          // not be added stays in the box with its reason, and the search stays open on it.
          if (q.trim() && rows.length === 1) {
            const r0 = rows[0];
            if (r0.k === "list" && !has(r0.it.id)) {   // already in the rule: nothing to add, Done closes
              const g = listGate(mode, r0.it.id, node);
              if (!g.ok) { setSay(gateReason(g, modeLabel)); return; }   // refused: stays open on its row, which says why (F56)
              commitList(r0.it.id);
            }
            else if (readGate && readGate.ok && commitTyped()) return;
          }
          setOpen(false); setHoldQ(null); if (inRef.current) inRef.current.blur(); }}>
        <${Ic} i="check"/> ${T("Done")}</button>` : null}
    </div><//>` : null}
  </div>`;
}

export function RoutingRules({ node, iface, rows, catchAll, exitIps, directIp, onChange, scope, blk }) {
  const nodeScope = scope === "node";
  const others = (Store.nodes || []).filter(n => n.id !== node);
  const _nrec = (Store.nodes || []).find(n => n.id === node);
  // what "the node default" resolves to here, if the node has one — see `catchVal`
  const _dflt = nodeScope ? null : ((_nrec || {}).exits || []).find(x => String(x.id) === String((_nrec || {}).default_exit || "")) || null;
  const _nlist = !nodeScope && Array.isArray((_nrec || {}).default_routing) ? _nrec.default_routing : null;
  const _nfall = _nlist ? _nlist.filter(r => r && r.enabled !== false && r.category !== "all" && r.aud !== "cascaded") : [];
  // …and where the rest finally goes: the list's own "Everything else", read as the node's editor reads it (rulesToRows),
  // or with none this node's own way out (direct — destLabelOf's answer for null's empty action).
  const _ncatch = _nlist ? rulesToRows(_nlist).catchAll : null;
  const exits = (_nrec || {}).exits || [];
  // "" means the node record has not loaded. Kept distinct from "kernel" on purpose: a badge greyed because
  // we could not look up the engine is a lie about the configuration (§4.2).
  const _mode = _nrec ? (_nrec.routing_mode || "kernel") : "";
  const dispRows = rows || [];
  const ips = exitIps || {};
  const shownIps = !nodeScope && _nlist && !catchAll ? { ...((_nrec || {}).default_routing_exit_ips || {}), ...ips } : ips;
  const emit = (rs, ca, xs, dip) => onChange(rs, ca === undefined ? catchAll : ca, xs === undefined ? ips : xs, dip === undefined ? directIp : dip);

  const rs = useReorder(dispRows.map(r => r._gid), ids => emit(ids.map(id => dispRows.find(r => r._gid === id)).filter(Boolean)), "y", { container: ".rrlist", card: ".rrrow" });
  const setRow = (gid, patch) => emit(dispRows.map(r => r._gid === gid ? { ...r, ...patch } : r));
  const addRow = () => emit([...dispRows, { _gid: newGid(), enabled: true, badges: [], action: others[0] ? "exit" : "direct", node: (others[0] || {}).id || "" }]);
  // A row's destination in words, for the one place it is read rather than chosen (the D11 line below the catch-all).
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
  const destOpts = (withDefault, held) => { const _gone = goneDest(held); return [
    ...(withDefault && _nlist ? [{ value: "__dflt__", label: T("Node default ({v1})", { v1: plural(_nfall.length, "rule") }) }]
      : withDefault && _dflt ? [{ value: "__dflt__",
      label: T("Node default ({v1})", { v1: _dflt.label || _dflt.device || _dflt.id }) }] : []),
    { value: "direct", label: T("Direct (this node)") },
    ...(others.length ? [{ group: T("Forward to node (cascade)"),
                           items: others.map(n => ({ value: "exit|" + n.id, label: T("Forward to {node}", { node: n.name }) })) }] : []),
    // LAST, and outside every group. Block is not a place traffic goes, it is traffic not going — so it
    // sits apart from the lists of destinations rather than reading as one more of them.
    { value: "block", label: T("Block") },
    ...(_gone ? [{ value: _gone.value, label: _gone.label, className: "bad", refuse: _gone.why }] : []),
  ]; };
  const tuneBtn = (on, open) => html`<button type="button" class=${"iconbtn rrgear" + (on ? " on" : "")} title=${T("Rule settings")}
    aria-label=${T("Rule settings")} onClick=${open}><${Ic} i="sliders"/></button>`;
  // A Direct rule's address, where the caller can set it (an interface — the node's default list has its own control).
  const dipOn = !nodeScope && directIp !== undefined;
  // PER-PERSON ROWS: what each selection covers here is asked of the panel (the resolver the sync uses), so the chip, the
  // window and the node cannot disagree. Asked only while a row names people — a list with none sends nothing.
  const whoOf = useWhoReport(node, iface, dispRows.filter(r => r.who).map(r => r.who));
  const openRule = row => row && pushModal(html`<${RuleSettingsSheet} node=${node} iface=${iface} row=${row} exitIps=${ips}
    directIp=${dipOn ? directIp || "" : undefined} dests=${destOpts(false, destVal(row))} dest=${destVal(row)} mode=${_mode} nodeScope=${nodeScope}
    onApply=${(v, who, xs, aud, dip, ports) => emit(dispRows.map(r => r._gid === row._gid
      ? { ...r, ...destPatch(v), who: who || undefined, aud: nodeScope ? (aud || undefined) : r.aud, ports: nodeScope ? r.ports : (ports || undefined) } : r), undefined, xs, dip)}/>`);
  // THE CATCH-ALL'S OWN WINDOW (D10, §7.1). `everyone` fixes "For whom", so the only thing it can change besides the
  // destination is the address — which is the whole reason it opens at all.
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
  const catchVal = !catchAll ? (_dflt || _nlist ? "__dflt__" : "direct")
    : catchAll.action === "exit" ? "exit|" + (catchAll.node || "")
    : catchAll.action === "dev" ? "dev|" + (catchAll.exit_id || "") : catchAll.action;
  // `xs` — the interface's address map, when the window that called this changed it (P2).
  const setCatch = (v, xs, dip) => {
    if (v === "__dflt__") return emit(dispRows, null, xs, dip);      // silence — the node's default applies
    const p = destPatch(v);
    // A destination that names nothing (an exit or node id that is gone) falls back to silence too, rather
    // than storing a rule that routes to a blank.
    emit(dispRows, (p.action === "exit" && p.node) || (p.action === "dev" && p.exit_id)
      || p.action === "block" || p.action === "direct"
      ? { enabled: true, category: "all", ...p } : null, xs, dip); };
  const onCatch = v => setCatch(v);
  const lints = rowLints(dispRows, destVal, { mode: _mode, isName: _nameBadge });   // per row: dupes, takenBy, takenFew — see rulerows.js
  const nodeRows = _nlist && !catchAll ? rulesToRows(_nfall).rows : [];
  // Each interface row against the node rows only, one pass each — every node row here reaches this interface's traffic
  // (All or own clients), so its audience decides nothing and is not consulted.
  const nodeTaken = dispRows.map(r => (_mode === "sni" || _mode === "forcedns") && nodeRows.length
    ? [...new Map(nodeRows.filter(nr => destVal(nr) !== destVal(r)).flatMap(nr => (nr.badges || [])
        .filter(nb => (r.badges || []).some(b => badgeCovers(b, nb)))).map(nb => [badgeIdentity(nb), nb])).values()] : []);
  const tier2All = tier2Count(dispRows, customListOf);   // rulerows knows the grammar; the Store lookup is ours
  // NO HEADING OF ITS OWN: every caller shows the list under a "Routing rules" fold whose title says how rules win here
  // (rulesTitle) — a second heading inside it said the same thing again.
  return html`<div class="field">
    <div class="rrlist" ...${rs.container()}>${dispRows.map((row, ri) => {
      const badges = row.badges || [];
      const { dupes, takenBy } = lints[ri];   // a later row is judged only against rows that reach the same devices
      // …and "for the people it names" only where specificity decides (Hybrid SNI, Force-DNS): on Kernel SNI a per-person
      // hostname is not built at all (the interim gate), and IP-only has no hostnames.
      const takenFew = _mode === "sni" || _mode === "forcedns" ? lints[ri].takenFew : [];
      const self = row.action === "exit" && row.node === node;
      const inert = badges.filter(b => !rowGate(row, _mode, node, b).ok);
      const asns = badges.filter(b => b.t === "target" && b.kind === "asn").map(b => b.raw).join(", ");
      const it = rs.item(row._gid);
      return html`<div key=${row._gid} class=${"rrrow rrrow-b" + it.cls + ((dupes.length || self || inert.length || takenBy.length || takenFew.length || row.locked) ? " warn" : "")} data-rid=${it.rid}>
        <span class="drag-grip" title=${T("Drag to reorder")} ...${rs.grip(row._gid)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>
        ${/* Built once and handed to BOTH branches: the destination now rides in the field's foot (see
              TargetField's `trailing`), and a locked row has to carry the identical control or the two
              shapes of row would stop lining up with each other down the list. */""}
        ${/* NO `rrarrow` HERE. The exit options are themselves written "→ nixos", so the row read
              "→  → nixos" — two arrows for one destination. The catch-all below keeps its arrow: there it
              is the only one, and it is what joins "Everything else" to the control. */""}
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
              ${/* The draft is written INTO THE ROW so that egressSaveBlock sees it — and egressSaveBlock is what
                    all four save buttons already ask (both interface sheets, the WDTT one and the csqtt
                    one). A new prop threaded up through EgressPicker would have had to be wired into each
                    of them separately, and the one that got missed is the one that loses the text.
                    `_draft` never reaches the wire: dirtiness and the payload are both built from
                    egressBody(), which is rowsToRules() — transient row fields are not in it. */""}
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
        ${/* A node list's "Forward to node Q" rule says what it does to traffic cascaded in, where it is read (§7.3): arrivals
              that came FROM Q skip it (the origin guard, §3.5), and Q lets what it is sent out and never forwards it again. */""}
        ${nodeScope && row.action === "exit" && row.node && row.aud !== "local" && others.some(n => n.id === row.node)
          ? html`<div class="hint rrnote">${T("Traffic that came from {node} skips this rule — it would go back where it came from.", { node: Store.nodeName(row.node) })}</div>` : null}
      </div>`;
    })}</div>
    <div class="rrfoot">
      <span class="rrfoot-lead"><button class="btn btn-mini" onClick=${addRow}><${Ic} i="plus"/> ${T("Add rule")}</button><b class="rrfoot-label">${T("Everything else")}</b></span>
      ${/* THE SAME WRAPPER THE RULE ROWS USE, not a second set of numbers that happen to line up. The
            catch-all's arrow, dropdown and trailing button have to sit under the rule rows' own — and once
            the destination moved into the field's foot, matching that by hand meant guessing a width. One
            class, one rule, both places. */""}
      <span class="tf-trail">
        ${catchAll && catchAll.action === "exit" && ips[catchAll.node] ? html`<${AsChip} ip=${ips[catchAll.node]} node=${catchAll.node}/>`
          : catchAll && catchAll.action === "direct" && dipOn && directIp ? html`<${AsChip} ip=${directIp} node=${node} direct/>` : null}
        ${tuneBtn((catchAll && catchAll.action === "exit" && ips[catchAll.node]) || (catchAll && catchAll.action === "direct" && dipOn && directIp), openCatch)}
        <span class="rrarrow">→</span>
        <span class="rrdest rrcatch"><${Dropdown} value=${catchVal}
          onChange=${onCatch} options=${destOpts(true, catchVal)}/></span>
        ${/* NO GEAR. It linked to Settings ▸ Routing lists, which is where lists are PINNED and inspected —
              but every rule that names one is written right here, so the shortcut mostly offered a detour
              from the screen the operator was already on. The link survives where it is actually needed:
              the empty blocking state still offers it, in a sentence that says what it is for. */""}
      </span>
    </div>
    ${/* D11 — WHAT THE SILENCE FALLS THROUGH TO, where the interface is edited: the node's rules this interface's traffic
          meets (All and own clients), in order, bounded — then the node's own "Everything else". */""}
    ${!nodeScope && _nlist && !catchAll ? html`<div class="hint rrnote">${T("Node default (Settings ▸ Network ▸ Default exit):")} ${nodeRows.slice(0, 10).map(r => html`<span>${(r.badges || []).slice(0, 3).map(b => b.t === "list" ? catLabelOf(b.id) : targetLabel(b.kind, b.value)).join(", ")}${(r.badges || []).length > 3 ? "…" : ""} → ${destLabelOf(r)}</span> · `)}${nodeRows.length > 10 ? T("…and {v1} more", { v1: nodeRows.length - 10 }) + " · " : ""}<span>${T("everything else")} → ${_ncatch ? (goneDest(destVal(_ncatch)) || {}).label || destLabelOf(_ncatch) : T("Direct (this node)")}</span></div>` : null}
    ${nodeScope && _mode === "sni_kernel" && ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) < 2 && dispRows.some(r => r.aud !== "local")
      ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Kernel SNI on this node can't match hostnames for traffic cascaded in — only IP addresses and networks apply to it.")}</span></div>` : null}
    ${allBlockPreemptsNames(_mode, dispRows) >= 0 ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("A Block to every address (0.0.0.0/0) stops each new connection before its site name is read, so the rules above it that match by site name never take effect: those sites are blocked too. Route them by address instead, or give the Block ports that leave out TCP 443.")}</span></div>` : null}
    ${catchAllPreemptsNames(_mode, dispRows, catchAll) ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("“Everything else → Block” stops each new connection before its site name is read, so the rules above that match by site name never take effect: those sites are blocked too. Route them by address (an IP range or a network) instead, or block by name only what you don't want.")}</span></div>` : null}
    ${dispRows.length || catchAll ? null : html`<div class="hint">${others.length
      ? Trich("No rules yet. Add a rule to send some destinations through another node, or set *Everything else* to channel everything.")
      : Trich("No rules yet. Add a rule to send some destinations out a device on this node or block them, or set *Everything else* to say where the rest goes.")}</div>`}
  </div>`;
}

/** {selection → report} for the rows of one interface. Asked once per change of the set of selections, debounced. */
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
      } catch (e) { /* the chip says "…" until the next change asks again */ }
    }, 250);
    return () => { ok = false; clearTimeout(h); };
  }, [key]);
  return w => rep[JSON.stringify(canonWho(w))] || null;
}

// A report's devices, counted: in the set · keyless, not connected yet · on a build that can't tell them apart.
const whoTally = (rep, only) => { const c = { ok: 0, soon: 0, no: 0 };
  for (const [pid, st] of Object.entries((rep || {}).devices || {})) if (!only || only(pid)) c[st] = (c[st] || 0) + 1;
  return c; };
// Which of a report's devices one entry of the selection accounts for — a user's own, a group's members', or the one device.
export const whoEntryHas = (e, pid) => { const p = Store.peer(pid), uid = p && p.user_id;
  return e.k === "p" ? pid === e.id : e.k === "u" ? uid === e.id : !!uid && ((Store.group(e.id) || {}).users || []).includes(uid); };
export const whoEntryName = e => e.k === "g" ? ((Store.group(e.id) || {}).name || T("a group that no longer exists"))
  : e.k === "u" ? ((Store.user(e.id) || {}).name || T("a user who no longer exists"))
  : (Store.peer(e.id) ? deviceLabel(Store.peer(e.id)) : T("a device that no longer exists"));
export const whoEntries = w => [...(w.groups || []).map(id => ({ k: "g", id })), ...(w.users || []).map(id => ({ k: "u", id })),
                         ...(w.peers || []).map(id => ({ k: "p", id }))];

// Why a device reads red: its build can't prove its source — or the node runs no per-person rule yet (D4), and then none do.
const whoNoWhy = (rep, node) => rep && rep.node_old
  ? T("{v1} needs an update to route per person — these rules apply to nobody there until it is.", { v1: Store.nodeName(node) })
  : T("Can't be told apart on this build — the rule doesn't apply to it.");

// The colour-coded device count of one entry, with what each colour means on hover — the People window's idiom.
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

/** The row's chip: how many devices here it covers — and, on the SAME chip, how many it cannot (amber). One chip, not two:
 *  the uncovered count is a fact about the same selection, and the bubble says who they are and why. */
// A tally in words — the chip's text and each person's line in its bubble: the devices covered, and how many are not.
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

// The devices on one interface (or csqtt / WDTT server) — what the picker offers as single devices.
export const peersOn = (node, iface) => Store.recon.peers.filter(p => (p.targets || []).some(t => t && t.node === node && t.iface === iface));
export const whoCount = w => (w.groups || []).length + (w.users || []).length + (w.peers || []).length;
const whoSorted = (sel, k, key) => sel[key].slice().sort((a, b) => whoEntryName({ k, id: a }).localeCompare(whoEntryName({ k, id: b }))).map(id => ({ k, id }));

export function WhoPicker({ sel, setSel, here, cell, onTyped, empty }) {
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const list = [...whoSorted(sel, "g", "groups"), ...whoSorted(sel, "u", "users"), ...whoSorted(sel, "p", "peers")];
  const ql = q.trim().toLowerCase();
  const rows = ql ? list.filter(e => whoEntryName(e).toLowerCase().includes(ql)) : list;
  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE)), pg = Math.min(page, pages);
  const addTo = (k, id) => { if (!id || sel[k].includes(id)) return; setSel(s => ({ ...s, [k]: [...s[k], id].sort() })); setQ(""); };
  const drop = e => { const k = { g: "groups", u: "users", p: "peers" }[e.k]; setSel(s => ({ ...s, [k]: s[k].filter(x => x !== e.id) })); };
  return html`<${Fragment}>
      <div class="sharebar" onInput=${onTyped} onChange=${onTyped}>
        <div class="sharebar-add"><${UserPicker} value=${null} placeholder=${T("Add a person, group or device…")} exclude=${sel.users}
          groups=${Store.groups().filter(g => !sel.groups.includes(g.id))} onGroup=${id => addTo("groups", id)} onChange=${id => addTo("users", id)}
          devices=${here.filter(p => !sel.peers.includes(p.id)).map(p => ({ id: p.id, name: deviceLabel(p), sub: (Store.user(p.user_id) || {}).name || "" }))}
          onDevice=${id => addTo("peers", id)}/></div>
        ${list.length > LIST_PAGE || q ? html`<input class="sharebar-filter" value=${q} data-enter="self" placeholder=${T("Filter the list…")}
            aria-label=${T("Filter the list…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
      </div>
      ${list.length ? html`<div class="sharegrid gmembers" role="table">
          <div class="sharegrid-h" role="row"><span>${T("col|User, group or device")}</span><span>${T("Devices here")}</span><span></span></div>
          ${pageSlice(rows, pg).map(e => { const gone = e.k === "g" ? !Store.group(e.id) : e.k === "u" ? !Store.user(e.id) : !Store.peer(e.id);
            return html`<div class=${"sharegrid-r" + (e.k === "u" ? "" : " grp") + (gone ? " gone" : "")} role="row" key=${e.k + ":" + e.id}>
            <span class="nm">${e.k === "g" ? html`<${Ic} i="users"/>` : e.k === "p" ? html`<${Ic} i="device"/>` : null}${whoEntryName(e)}${e.k === "g" && !gone
              ? html`<span class="faint sharegrid-sub">${plural(Store.group(e.id).users.length, "member")}</span>` : e.k === "p" && !gone && Store.user(Store.peer(e.id).user_id)
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
  // D9 — on the node's default list "For whom" is an AUDIENCE, never people: "" (All) · "local" · "cascaded".
  const [aud, setAud] = useState(nodeScope && !everyone ? (row.aud || "") : "");
  const [chosen, setChosen] = useState(!nodeScope && !everyone && !!row.who);
  const [sel, setSel] = useState(() => canonWho(row.who || {}));
  // PORTS (B.6) — an interface rule's only; "Any" protocol with no port is the rule as it always was (no ports at all).
  const withPorts = !nodeScope && !everyone;
  const [proto, setProto] = useState(portsOf(row) ? String(portsOf(row).proto || "") : "both");   // "" — a stored one that doesn't read
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
  // THE address field, whichever it is: the far node's for Forward, this node's for Direct — one picker, one stale test.
  const addr = asRec ? { node: asNode, ips: asIps, value: ip, set: setIp } : dRec ? { node, ips: dIps, value: dip, set: setDip } : null;
  const addrStale = !!(addr && addr.value && addr.ips.length && !addr.ips.includes(addr.value));
  const key = JSON.stringify([dest, chosen, chosen ? sel : null, ips, aud, dip, withPorts ? [proto, plist] : null]);
  if (base.current === null) base.current = key;
  dirtyRef.current = key !== base.current;
  const typedOnly = () => { if (cleanRef.current) cleanRef.current(); };      // the filter and the search change nothing
  const whoOf = useWhoReport(node, iface, chosen ? [sel] : []);
  const rep = chosen ? whoOf(sel) : null;
  const here = peersOn(node, iface);
  const empty = chosen && !whoCount(sel);
  const c = whoTally(rep);
  const apply = () => { if (empty || pBad) return; onApply(dest, chosen ? sel : null, ips, aud, directIp !== undefined ? dip : undefined,
    withPorts && pc ? { proto: pc.proto, list: pc.list } : null);
    dirtyRef.current = false; if (cleanRef.current) cleanRef.current(); closeModal(); };
  const count = [sel.groups.length ? plural(sel.groups.length, "group") : "", sel.users.length ? plural(sel.users.length, "user") : "",
                 sel.peers.length ? plural(sel.peers.length, "device") : ""].filter(Boolean).join(", ");
  const kSni = chosen && mode === "sni_kernel" && ((((Store.stats || {})[node] || {}).smartroute || {}).src || 0) < 2;
  return html`<${Sheet} title=${T("Rule settings")} width=${680} dirtyRef=${dirtyRef} closeRef=${closeRef} cleanRef=${cleanRef}
    foot=${html`<${Fragment}><span class="faint">${chosen && count ? T("{v1} chosen", { v1: count }) : ""}</span><span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" onClick=${() => (closeRef.current ? closeRef.current() : closeModal())}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${empty || pBad} title=${empty ? T("Choose at least one person or device, or pick “Everyone on this interface”.") : ""} onClick=${apply}>${T("Apply")}</button><//>`}>
    ${/* WHERE IT LEAVES AND AS WHAT, ON ONE LINE: the address refines the destination beside it, and the notes about the
          address run under both at full width rather than down a half-width column.
          THE EXIT IP (D6). For a "Forward to node" destination it is that node's SNAT, and only for a node still in this
          panel — an address for a node that is gone is a setting with nothing on the other end. It shows for a per-person
          rule too: the address belongs to the INTERFACE's traffic to that node, whoever the rules name, which is why it is
          stored per node rather than per rule (§4.2). For Direct it is THIS node's address — one per interface, since the
          node source-NATs the interface's subnet as it leaves by the WAN, whichever rule sent it there.
          ⚠️ KEYED BY THE NODE. `NodeIpPick` holds "am I in Custom mode" in its own state and only leaves it when the
          operator picks a listed option — so one instance reused across a change of "Leaves by" carried the PREVIOUS
          node's Custom mode over. A key makes it a different control for a different node, which is what it is. */""}
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
    ${/* PORTS (B.6): which traffic to the destination takes the rule. Its own line under "Leaves by": the protocol in the same
          three-part switch as a node list's audience, the ports beside it. Empty = every port; "Any" + empty = no ports,
          the rule as it always was. Not on "Everything else" (it is every port, D10) nor on a node's default list (B.1). */""}
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
    ${/* D10 — "Everything else" is for everyone on the interface, so its window says so rather than
          offering a switch that cannot move. */""}
    <div class="field"><label>${T("For whom")}</label>
      ${/* ⚠️ THE ANSWER, NOT THE ANSWER PLUS THE REASON. This first read "Everyone on this interface —
            “Everything else” applies to everyone on the interface", which is the same sentence twice; the
            label asks the question and a value that is not a control is already saying it cannot change. */""}
      ${nodeScope && everyone ? html`<div class="hint">${T("All — this node's clients and traffic cascaded in")}</div>`
       // Three short names on one line, three equal parts — the full sentence each stands for is its tooltip.
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

// Live feedback for AS<n> tokens in a rule/list: shows "AS62041 → 5 prefixes" (or "not found") so the operator knows
// the ASN resolved. Counts are cached module-wide (keyed by AS number) so switching rows never re-fetches.
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
/** How many prefixes an `as<n>` target resolves to, 0 while unresolved or unknown. */
export const asnNets = value => {
  const c = _asnCache[asnKey(value)];
  return (c && typeof c === "object" && c.count) || 0;
};
export function AsnHint({ targets }) {
  const asns = [...new Set((String(targets || "").match(/\bas:?\d{1,10}\b/gi) || []).map(asnKey).filter(Boolean))];
  useAsnCounts(asns);   // already keys, and the hook keys again — idempotent, which is the point
  if (!asns.length) return null;
  return html`<div class="asn-hint">${asns.map(n => { const c = _asnCache[n]; const load = c === "loading" || c === undefined;
    const cnt = (c && typeof c === "object") ? c.count : 0;
    return html`<span class=${"asn-tok " + (load ? "load" : cnt ? "ok" : "bad")}>AS${n} ${load ? T("resolving…") : cnt ? T("→ {v1}", { v1: plural(cnt, "prefix") }) : T("→ not found")}</span>`; })}</div>`;
}

// ── egress: where an interface's traffic actually leaves the node ────────────────────────────────
export function EgressPicker({ node, value, onChange, noRules }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const ipIfaces = nrec.ip_ifaces || [];
  const others = (Store.nodes || []).filter(n => n.id !== node);
  const exits = nrec.exits || [];
  // The node's default exit, if it has a usable one — what "Auto" actually resolves to on this node.
  const _dflt = (nrec.exits || []).find(x => String(x.id) === String(nrec.default_exit || "")) || null;
  const ifSel = value.mode === "smart" ? "smart" : value.mode === "forward" ? "forward|" + (value.node || "")
    : value.mode === "exit" ? "exit|" + (value.exitId || "") : "auto";
  const _unnamed = value.mode === "forward" && !!value.node && !others.some(n => n.id === value.node);
  const _goneFwd = _unnamed && !(Store.nodes || []).some(n => n.id === value.node);
  const _selfFwd = _unnamed && !_goneFwd;
  const exSel = value.mode === "exit" ? exits.find(x => String(x.id) === String(value.exitId || "")) : null;
  const exNote = value.mode !== "exit" ? "" : !exSel
    ? T("That exit no longer exists — traffic goes out directly. Choose another, or add it back under Settings → Network.")
    : exSel.enabled === false
    ? T("This exit is turned off — traffic goes out directly until it is turned back on. The interface keeps this selection.")
    : exSel.why_not
    ? T("This exit's device can't be used right now — traffic goes out directly. Settings → Network says why.")
    : "";
  const exSrc = (value.mode === "exit" && exSel && !exNote && (exSel.producer || "adopted") !== "imported")
    ? (String(exSel.egress_ip || "").trim()
        ? T("Leaves as {v1}. That source belongs to the exit, so every interface using it shares one — change it under Settings → Network.", { v1: exSel.egress_ip })
        : T("Leaves as whichever address the node picks on {v1}. Pin one on the exit under Settings → Network.", { v1: exSel.device || "" }))
    : "";
  let ipOpts = [];
  if (value.mode === "direct") ipOpts = ipIfaces.filter(p => !value.nic || p.iface === value.nic).map(p => p.ip);
  else if (value.mode === "forward") { const tn = others.find(n => n.id === value.node); ipOpts = (tn && tn.ips) || []; }
  const onIf = v => {
    if (v === "auto") return onChange({ ...value, mode: "auto", node: "", exitId: "" });
    if (v === "smart") return onChange({ ...value, mode: v, nic: "", node: "",
      ip: value.mode === "auto" || value.mode === "direct" || value.mode === "smart" ? (value.ip || "") : (value.ownIp || "") });
    const [mode, x] = v.split("|");
    if (mode === "forward") return onChange({ ...value, mode, node: x, nic: "", ip: "", exitId: "" });
    if (mode === "exit") return onChange({ ...value, mode, exitId: x, nic: "", node: "", ip: "" });
    onChange({ ...value, mode, nic: x, node: "", ip: "", exitId: "" });
  };
  return html`<${Fragment}>
    <div class="field"><label>${T("Outbound (egress) interface")}</label>
      ${/* ⚠️ THE SAME LIST THE NODE'S OWN EGRESS PICKER OFFERS, from the same builder. This was a hand-written
            <select> with every exit in ONE flat group called "out via a device on this node" — a WARP account,
            a pasted profile and a TUN somebody else runs, shelved together, an untitled account reading as a
            raw `wgx-f4256ea7`, and no way to tell one that is still registering from one that is carrying
            traffic. `exitOptionGroups` exists precisely so this list is written once and spelled twice (an
            interface stores `exit|<id>`, the node's default stores a bare id) — it had one caller.
            NO ROW CONTROLS HERE. Switching an exit off, renaming or deleting it is node-wide, and this is an
            interface's editor: the shared builder makes every one of those optional, and this screen takes
            none of them. `Manage…` is not offered for the same reason — exits are managed where they live. */""}
      ${/* ⚠️ "AUTO" NAMES WHAT IT RESOLVES TO. An interface stored as direct-with-nothing-set inherits the
            node's default exit — `cascade_plan` literally rewrites its mode to `exit` and lends it that id —
            and the label said "Auto (MASQUERADE)" whatever the node was configured to do. So the one entry
            that means "no opinion" was also the one that never said what the opinion would be. Same idiom
            the egress-source picker uses: the parenthetical exists only when we can name the answer. */""}
      <${Dropdown} value=${ifSel} onChange=${onIf} options=${[
        { value: "auto", label: _dflt ? T("Auto ({v1})", { v1: _dflt.label || _dflt.device || _dflt.id })
                                      : T("Auto (MASQUERADE)") },
        { value: "smart", label: T("Routing (smart cascade)"), className: "egopt-mode" },
        ...(others.length ? [{ group: T("Forward to node (cascade)"), items: others.map(n => ({ value: "forward|" + n.id, label: T("Forward to {node}", { node: n.name }) })) }] : []),
        ...(_selfFwd ? [{ value: ifSel, label: T("This node itself"), className: "bad",
                          refuse: T("This interface is set to forward everything to the node it is already on, which cannot work — the traffic would leave by this node's own address anyway. Choose another destination.") }] : []),
        ...(_goneFwd ? [{ value: ifSel, label: T("A node that is no longer here"), className: "bad",
                          refuse: T("This interface forwards everything to a node that is not in this panel any more, so it routes nothing and its clients leave by this node's own address. Choose another destination.") }] : []),
      ]}/>
      ${/* The hint has to carry the same distinction the list does, or it re-merges the two things the
            labels just separated: pinning a source is not a way out, and the sentence used to call it one
            ("exit directly out a NIC") while the group below now offers actually leaving by that card. */""}
      <div class="hint">${others.length
        ? (exits.length
          ? T("Leave by a device on this node, channel everything through another node, or route per-destination (smart).")
          : T("Leave normally, channel everything through another node, or route per-destination (smart)."))
        : (exits.length
          ? T("Leave by a device on this node, or route per-destination (smart).")
          : T("Leave normally, or route per-destination (smart)."))}</div>
      ${exNote ? html`<div class="hint err">${exNote}</div>` : null}
      ${exSrc ? html`<div class="hint">${exSrc}</div>` : null}</div>
    ${/* THE NAT PIN IS NOT HERE ANY MORE — it lives under each sheet's "Advanced settings", as
          `NatSourcePick` below. It is not an egress DESTINATION and it was read as one twice; the sheets
          are where the "this is advanced, and it is not routing" framing can actually be built. */""}
    ${value.mode === "smart"
      ? (noRules ? null : html`<${RoutingRules} node=${node} rows=${value.rows || []} catchAll=${value.catchAll} onChange=${(rows, catchAll) => onChange({ ...value, rows, catchAll })}/>`)
      : (value.mode !== "auto" && value.mode !== "exit") ? html`<div class="field"><label>${T("Outbound (egress) IP")}</label>
      ${/* ⚠️ KEYED, for the reason the rule window's copy is (§7.2): this control holds "am I in Custom mode"
            in its own state, and the list under it is rebuilt when the mode or the target node changes. One
            instance reused across that change kept the PREVIOUS target's Custom mode — pick a node, type an
            address it does not report, switch to another node, and the field offered an empty Custom box
            instead of that node's Auto. Nothing wrong is stored (the value is cleared with the switch); it
            is the control misstating which state it is in. A key makes it a different control. */""}
      <${NodeIpPick} key=${value.mode + "|" + (value.node || value.nic || "")} ips=${ipOpts} value=${value.ip || ""} onChange=${ip => onChange({ ...value, ip })} auto=${value.mode === "forward" ? T("Auto (target node default)") : T("val|Auto")}/>
      <div class="hint">${value.mode === "forward" ? T("Source IP on the target node that clients egress from.") : T("Source IP clients egress from.")}</div></div>` : null}
  <//>`;
}

export const natPinApplies = eg => ((eg || {}).mode === "auto" || (eg || {}).mode === "direct");

export function NatSourcePick({ node, value, onChange }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const ipIfaces = nrec.ip_ifaces || [];
  const nics = (nrec.ether_ifaces && nrec.ether_ifaces.length)
    ? nrec.ether_ifaces.filter(n => !isSelfContainedName(n) && !n.startsWith("swg_"))
    : [...new Set(ipIfaces.map(p => p.iface))].filter(n => !isSelfContainedName(n) && !n.startsWith("swg_"));
  const nicNote = (value.mode === "direct" || value.mode === "auto") && value.nic
    && nrec.wan_iface && value.nic !== nrec.wan_iface
    ? T("This node's traffic leaves by {v2}, not {v1}, so this rule can never match and clients would leave with no NAT at all. Choose “Off”, or {v2} — unless you route to {v1} yourself.",
        { v1: value.nic, v2: nrec.wan_iface })
    : "";
  // Nothing to pin to, or a mode that does not store a pin — either way a control here is a dead field,
  // and in the second case a destructive one (see `natPinApplies`).
  if (!nics.length || !natPinApplies(value)) return null;
  return html`<${Fragment}>
    <div class="field secdiv"><label>${T("Extra NAT")}</label></div>
    <div class="field">
    <${Dropdown} value=${value.nic || ""}
      onChange=${n => onChange({ ...value, nic: n, mode: n ? "direct" : "auto" })}
      options=${[{ value: "", label: T("val|Off") }, ...nics.map(n => ({ value: n, label: n }))]}/>
    ${/* THE SENTENCE THIS CONTROL EXISTS TO CARRY, and it leads with the negative because that is the half
          every reader gets wrong: it does not send anything anywhere. */""}
    <div class="hint">${T("This doesn't send traffic out that card. It only changes the source address of traffic that already leaves by it — use it when you route to that card yourself, outside the panel. To leave by a card, pick it under “Leave by a device”.")}</div>
    ${nicNote ? html`<div class="hint err">${nicNote}</div>` : null}
    </div>
  <//>`;
}

export const egressInit = m => {
  const { rows, catchAll } = rulesToRows(m.routing || []);
  for (const r of rows) for (const b of (r.badges || [])) b.stored = true;
  return { mode: m.egress_mode === "smart" ? "smart" : m.egress_mode === "forward" ? "forward"
      : m.egress_mode === "exit" ? "exit" : (m.egress_ip || m.wan_iface) ? "direct" : "auto",
    nic: m.wan_iface || "", node: m.egress_node || "", ip: m.egress_ip || "",
    // THIS NODE's own stored source address — `egress_ip` is the FAR node's in forward mode, so it is not one there. What
    // switching back to smart restores, so a look at Forward/Exit and back loses nothing (see `onIf`).
    ownIp: m.egress_mode === "forward" ? "" : (m.egress_ip || ""),
    exitId: m.exit_id || "", rows, catchAll,
    // The interface's {far node: address} map (§4.2). Read and written whole, beside the rows rather than
    // inside them — see `_apply_exit_ips` on the panel for why that is where it lives.
    exitIps: { ...(m.routing_exit_ips || {}) },
    // Its own Torrents / P2P (Direct or a route; Block is "torrents" in block[]). Carried here so every save sends it back — a
    // WDTT/csqtt restart re-posts `egressBody(egressInit(cfg))`, which without it would clear the choice (IFACE-P2P-PICK §2.4).
    p2p: m.p2p && m.p2p.action ? { ...m.p2p } : null };
};

export function egressSaveBlock(eg, mode) {
  if (eg && eg.mode === "exit" && !String(eg.exitId || "").trim())
    return T("Choose which exit this interface leaves by.");
  if (!eg || eg.mode !== "smart") return null;
  for (const row of (eg.rows || [])) {
    if (row.locked) continue;                         // a legacy rule is re-emitted verbatim; nothing to validate
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
      // One key per count, not a sentence assembled with `+`: the pieces cannot be reordered, and Russian
      // needs the noun in a case the English suffix trick cannot express.
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

// The interface's egress/traffic mode as a header badge — shared by wg/awg + WDTT detail: direct | cascade
// (whole-interface forward to a node) | smart cascade (per-destination routing).
export const candOf = (node, name) =>
  ((node || {}).exit_candidates || []).find(c => c && c.name === String(name || "").trim()) || null;
export const candAddr = (node, name) => String((candOf(node, name) || {}).address || "").split("/")[0];

export const cardAddrs = (node, name) => (((node || {}).ip_ifaces) || [])
  .filter(p => p && String(p.iface) === String(name || "") && p.ip).map(p => p.ip);

export const isCardName = (node, name) => (((node || {}).ether_ifaces) || []).includes(String(name || ""));

export const cardGateway = (node, name) => String((((node || {}).ether_gws) || {})[String(name || "")] || "");

/** An imported exit's KIND, by name — every test of it compares to a name, never "not profile ⇒ WARP" (docs/SOCKS5-EXIT-PLAN.md
 *  T6): a kind this panel does not know is neither, and a later kind is added by name. Empty is a legacy WARP account. */
export const exitProv = x => String((x || {}).provider || "warp");
/** The kinds this panel can make, by name — a TWIN of the panel's EXIT_PROVIDERS and swg-noded's EXIT_KINDS
 *  (tests/cross_language_twins_selftest.py, s9a F28). */
export const EXIT_KINDS = ["warp", "profile", "socks5"];
/** A DIAL-IN exit (docs/LISTEN-EXIT-PLAN.md §2): a pasted SERVER config — a ListenPort, no Endpoint — which the upstream (a
 *  router behind NAT) dials. Derived from the stored profile, as the panel and the node derive it; nothing else marks it. */
export const exitIsDialin = x => exitProv(x) === "profile" && !!((x || {}).profile || {}).listen_port
  && !((x || {}).profile || {}).endpoint;

/** Where the traffic of an exit the NODE is routing around goes meanwhile, by its kill-switch — and the plain stalled
 *  sentence — shared by the imported and the adopted arm, so both say it in one set of words (and one set of RU keys). */
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
    const fresh = !nodeStale((node || {}).id);       // a stale node's last `back_in` is not believed (as for an imported exit)
    if (nt && Number.isFinite(nt.back_in) && fresh)
      return { state: "recovering", tone: "busy", icon: "refresh", dot: "down", why: exitRecoveringSay() + " " + exitFellSay(ex) };
    if (nt) return { state: "stalled", tone: "warn", icon: "warn", dot: "down", why: exitStalledSay(ex)
      + (String(nt.why || "").trim() ? " " + T("The node reports: {v1}", { v1: String(nt.why).trim() }) : "") };
    return { state: "ok", tone: "", dot: "up", why: T("Up on the node.") };
  }
  if (ex.cfg_sig && l.cfg_sig && l.cfg_sig !== ex.cfg_sig && !nodeStale((node || {}).id))
    return { state: "configuring", tone: "busy", icon: "refresh", dot: "unknown",
             why: T("Applying your changes on the node…") };
  // A node older than dial-in exits refuses one as a profile with no endpoint; a 1.8.11 node reports the port on every row.
  if (l.error && exitIsDialin(ex) && !l.listen_port && (!ex.cfg_sig || l.cfg_sig === ex.cfg_sig)) return { state: "unsupported", tone: "warn", icon: "warn", dot: "unknown",
    why: T("This node needs the 1.8.11 update for dial-in exits.") };
  // A SOCKS exit whose tunnel program is still being fetched: progress, not a fault (review F13)
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
  // A stale node's last `back_in` is not believed (above), but it did say the tunnel carried again: that is no router with
  // NAT missing — the row takes the plain stalled reading below rather than send the operator to the router (s9d F9)
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
  // A `busy` marker is progress, not a fault — there is nothing to open and nothing to read, so it keeps
  // the plain hover caption it always had.
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
  // The row's own controls, as one slot. A pencil is offered only where `onRename` says a row can be
  // titled; the switch only where there is something to switch.
  const ctl = (x, pencil, sw) => (x || pencil || sw)
    ? html`<${Fragment}>${x}${pencil}${sw}<//>`
    : null;
  const rmBtn = arg => (onRemove
    ? html`<button type="button" class="ddrm" title=${T("Remove")}
        onClick=${e => { e.stopPropagation(); (onArm || onRemove)(onArm ? arg.id : arg); }}><${Ic} i="x"/></button>`
    : null);
  // The row, asking. Deliberately the whole control slot: half a row of switches beside "delete?" reads as
  // two questions, and the switch is exactly the thing not to leave clickable while a delete is pending.
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
        // NOT "switch it on HERE" — the switch is only in this row on the screen that MANAGES exits. The
        // interface and rule pickers share this list and offer no controls, so "here" pointed at nothing.
        : { refuse: T("{v1} is turned off. Switch it on first, then choose it.", { v1: label }) }),
      title: [live.address || "", x.device || "", on ? "" : T("Turned off"), notReady ? h.why : ""]
        .filter(Boolean).join(" · "),
      ...(String(armed || "") === String(x.id) && onRemove && x._ext
        ? { extra: confirmRow({ id: x.id, label, device: x.device || "" }),
            // While a row is asking, choosing it would answer a different question.
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
      // Named like every other row: a candidate IS a discovered device, so it reads `Discovered — wg-lab0`
      // rather than a bare `wg-lab0` that says nothing about what it is or why it is in this group.
      value: prefix + "dev:" + c.name, label: exitLabel({ producer: "adopted", device: c.name }, node),
      title: [c.address || "", c.endpoint ? "→ " + c.endpoint : "", c.up ? "" : T("not up")].filter(Boolean).join(" · "),
      extra: ctl(null, penBtn({ kind: "device", device: c.name, title: "", egress_ip: "" }),
                 onToggle ? html`<${Switch} on=${true} onChange=${v => onToggle("dev:" + c.name, v)}/>` : null),
    });
  }
  // LAST IN ITS OWN GROUP, and the group is rendered even with nothing else in it — on a node whose only
  // way out is a device nobody has named yet, an empty group is exactly where the operator should look.
  if (custom) ext.push({ value: custom, label: T("Custom interface…"),
    ...(onManage ? { extra: html`<button type="button" class="btn btn-mini ddmanage"
      onClick=${e => { e.stopPropagation(); onManage(); }}>${T("Manage…")}</button>` } : {}) });
  return [
    ...(warp.length ? [{ group: T("Exit via WARP"), items: warp }] : []),
    ...(prof.length ? [{ group: T("Exit via a custom config"), items: prof }] : []),
    ...(socks.length ? [{ group: T("Exit via a SOCKS5 proxy"), items: socks }] : []),
    ...(other.length ? [{ group: T("Other exits"), items: other }] : []),
    // "an external interface" stopped being true the moment a NIC could be one — the node's own card is
    // not external to it. The group is what traffic LEAVES BY, whichever kind of device that is.
    ...(ext.length ? [{ group: T("Leave by a device"), items: ext }] : []),
  ];
}

/** Is this WARP account a paid one? From the LICENCE (what was asked for) or the account Cloudflare reports
 *  (what was granted) — they arrive a sync apart, and either alone makes the answer flicker. */
export const exitIsPlus = ex => !!(String((ex || {}).licence || "").trim()
  || /plus/.test((((ex || {}).live) || {}).account_type || ""));

/** What KIND of exit this is, in the operator's own words — the name a row falls back to when it has no
 *  title. The five kinds the panel can produce, and the vocabulary each already had on the exits screen:
 *
 *    imported · warp            WARP exit          (a registered Cloudflare account)
 *    imported · warp · licence  WARP+ exit         (paid — the whole point of the row is knowing which)
 *    imported · profile         Custom exit        (a WireGuard profile the operator pasted)
 *    imported · socks5          SOCKS5 exit        (a proxy the node runs a tunnel to)
 *    adopted  · node reports it Discovered         (a device already on the box)
 *    adopted  · it does not     Custom             (a name the operator typed ahead of the device)
 *
 *  ⚠️ The last two are told apart by the NODE'S OWN candidate list, not by a stored flag. A device the
 *  operator typed before the node reported it becomes Discovered the moment it appears — which is the
 *  truth about it, and a stored flag would have frozen the guess made at creation time. */
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

/** One exit record off a node, or null — the shared lookup, so "which exit is this?" has one answer. */
export const exitOf = (node, id) => (((Store.nodes || []).find(n => n.id === node) || {}).exits || [])
  .find(x => String(x.id) === String(id)) || null;

export function ifTrafficBadge(mode, egNode, node, exitId) {
  if (mode === "forward" && egNode) {
    const linking = (Store.panelSettings || {}).mesh_effective === "demand" && node && (p => !!p && p.out === "connecting")(
      meshHealth(node).peers.find(x => x.peer === egNode));
    if (linking) return html`<span class="egb egb-fwd" style=${"color:" + Store.nodeColor(egNode)} title=${T("Linking to {v1} — this interface's traffic resumes once the link is up", { v1: Store.nodeName(egNode) })}><${Ic} i="cascade"/>${T("linking →")} ${Store.nodeName(egNode)}</span>`;
    return html`<span class="egb egb-fwd" style=${"color:" + Store.nodeColor(egNode)} title=${T("Cascade — exits via {v1}", { v1: Store.nodeName(egNode) })}><${Ic} i="cascade"/>${T("cascade →")} ${Store.nodeName(egNode)}</span>`;
  }
  if (mode === "smart") return html`<span class="egb egb-smart" title=${T("Per-destination smart routing")}><${Ic} i="cascade"/>${T("smart cascade")}</span>`;
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

export const egressBody = eg => ({ ...(eg.mode === "smart"
  // `egress_ip` rides along: the node source-NATs by it in every mode, and it is what a Direct rule leaves as (Rule settings).
  ? { egress_mode: "smart", routing: rowsToRules(eg.rows, eg.catchAll), routing_exit_ips: eg.exitIps || {}, routing_v: 3, egress_ip: eg.ip || "" }
  : eg.mode === "exit" ? { egress_mode: "exit", exit_id: eg.exitId || "" }
  : { egress_mode: eg.mode === "auto" ? "direct" : eg.mode, egress_node: eg.node || "", egress_ip: eg.ip || "", wan_iface: eg.nic || "" }),
  p2p: eg.p2p || null });   // the torrent choice, in every mode (null: none)
