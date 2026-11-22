import { h } from "preact";

const LOCALES = {
  ru: () => import("./lang/ru.js"),
};

export const LANGS = [["en", "English", "EN"], ["ru", "Русский", "РУ"]];

export function nextLang() {
  const codes = LANGS.map(([c]) => c);
  return codes[(codes.indexOf(LANG) + 1) % codes.length];
}
const STORE_KEY = "swg-lang";

function pick() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && (saved === "en" || LOCALES[saved])) return saved;
  } catch (_) {   }
  try {
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    if (LOCALES[nav]) return nav;
  } catch (_) {   }
  return "en";
}

let LANG = pick();
let STR = {};
let PLURALS = {};

export const lang = () => LANG;

export async function loadLang() {
  STR = {}; PLURALS = {};
  const get = LOCALES[LANG];
  if (!get) return;
  try {
    const m = await get();
    STR = m.STR || {};
    PLURALS = m.PLURALS || {};
  } catch (e) {
    console.error("i18n: could not load", LANG, e);
  }
}

export function setLang(code) {
  try { localStorage.setItem(STORE_KEY, code); } catch (_) {   }
  location.reload();
}

const stripCtx = k => { const i = k.indexOf("|"); return i > 0 ? k.slice(i + 1) : k; };

export function T(key, vars) {
  let out = STR[key];
  if (out == null) out = stripCtx(key);
  if (vars) for (const k in vars) out = out.split("{" + k + "}").join(vars[k]);
  return out;
}

export function Tsplit(key, marker, vars) {
  const parts = T(key, vars).split("{" + marker + "}");
  return [parts[0], parts.slice(1).join("{" + marker + "}")];
}

export function Trich(key, vars) {
  const s = T(key), out = [];
  const re = /\*([^*]+)\*|`([^`]+)`/g;
  let at = 0, m;
  const sub = txt => {
    if (!vars) return txt;
    let parts = [txt];
    for (const k in vars) {
      const v = vars[k], next = [];
      for (const p of parts) {
        if (typeof p !== "string") { next.push(p); continue; }
        const bits = p.split("{" + k + "}");
        bits.forEach((b, i) => { if (i) next.push(v); if (b) next.push(b); });
      }
      parts = next;
    }
    return parts.length === 1 ? parts[0] : parts;
  };
  while ((m = re.exec(s))) {
    if (m.index > at) out.push(sub(s.slice(at, m.index)));
    out.push(m[1] != null ? h("b", null, sub(m[1])) : h("span", { class: "mono" }, sub(m[2])));
    at = re.lastIndex;
  }
  if (at < s.length) out.push(sub(s.slice(at)));
  return out;
}

export function pluralWord(n, noun) {
  const out = plural(n, noun), sp = out.indexOf(" ");
  return sp < 0 ? out : out.slice(sp + 1);
}

export function srvText(r) {
  if (!r) return "";
  if (r.error_key) return T(r.error_key, srvVars(r.error_vars));
  if (r.error) return T(r.error);
  return "";
}

export function srvVars(vars) {
  if (!vars) return undefined;
  const out = {};
  for (const k in vars) {
    const v = vars[k];
    out[k] = (v && typeof v === "object" && "error_key" in v) ? srvText(v)
      : (v && typeof v === "object" && "n" in v) ? plural(v.n, v.noun) : v;
  }
  return out;
}

const USER_FIELDS = { tag: "Tag", note: "Note", vk_link: "VK call link", vk_links: "VK call links", expiry: "Subscription expiry" };
const ACT_FIELDS = { awg_params: "act|AmneziaWG parameters", listen_port: "act|listen port", mtu: "MTU" };
const LEGACY_DETAIL = {
  "Deleted peer": [[/^(\d+) targets?$/, m => plural(+m[1], "target")]],
  "Unassigned peer": [[/^was (.+)$/, m => T("was {v1}", { v1: m[1] })]],
  "Assigned peer": [[/^fresh key issued$/, () => T("fresh key issued")]],
  "An exit key restore expired without being applied": [[/^the node never reported the restored key — it may be too old to accept one$/,
    () => T("the node never reported the restored key — it may be too old to accept one")]],
  "Interface came back different from the request": [[/^(.+): (awg_params|listen_port|mtu)$/, m => `${m[1]}: ${T(ACT_FIELDS[m[2]])}`]],
  "Adopted from the live interface": [[/^couldn't read (.+?) — adopted from the live interface instead \(keys, peers and ports kept; any DNS\/Table\/PostUp lines in that file are not\)$/,
    m => T("couldn't read {v1} — adopted from the live interface instead (keys, peers and ports kept; any DNS/Table/PostUp lines in that file are not)", { v1: m[1] })]],
  "Updated panel settings": [[/^(.+)$/, m => m[1].split(", ").map(x => T(x)).join(", ")]],
  "Updated user": [[/^([a-z_]+(?:, [a-z_]+)*)$/, m => m[1].split(", ").map(f => (USER_FIELDS[f] ? T(USER_FIELDS[f]) : f)).join(", ")]],
};
const RECLAIMED = [[/^(\d+) user\(s\) kept$/, m => T("{count} kept", { count: plural(+m[1], "user") })],
                   [/^no users in its store$/, () => T("no users in its store")]];
for (const v of ["Reclaimed a WDTT server", "Reclaimed a csqtt server", "Reclaimed a wdtt server"]) LEGACY_DETAIL[v] = RECLAIMED;

export function srvName(e) {
  const n = (e && e.name) || "";
  if (e && e.verb === "Update requested" && n === "with the panel") return T("with the panel");
  if (e && e.kind === "peer" && n === "unassigned peer") return T("unassigned peer");
  if (e && e.verb === "Updated panel settings") return n.split(", ").map(x => T(x)).join(", ");
  const m = e && e.verb === "Starting interface" && /^(.+) \(automatic, attempt (\d+) of (\d+)\)$/.exec(n);
  if (m) return `${m[1]} (${T("automatic, attempt {v1} of {v2}", { v1: m[2], v2: m[3] })})`;
  return n;
}

export function srvDetail(e) {
  if (!e) return "";
  if (e.detail_key) return T(e.detail_key, srvVars(e.detail_vars));
  const d = e.detail || "";
  for (const [re, f] of (d && LEGACY_DETAIL[e.verb]) || []) { const m = re.exec(d); if (m) return f(m); }
  return d;
}

const LEGACY_VERB = [
  [/^VK pool changed — reassigned (\d+) user\(s\)$/, m => T("VK pool changed — reassigned %d user(s)").replace("%d", m[1])],
  [/^VK links per new user: (\d+) → (\d+)$/, m => T("VK links per new user: %d → %d").replace("%d", m[1]).replace("%d", m[2])],
  [/^Reclaimed a (wdtt|csqtt) server$/, m => T(m[1] === "wdtt" ? "Reclaimed a WDTT server" : "Reclaimed a csqtt server")],
];
export const srvVerb = v => {
  if (!v) return "";
  if (v === "Reset learned IPs") return T("act|Reset learned IPs");
  if (STR[v] == null) for (const [re, f] of LEGACY_VERB) { const m = re.exec(v); if (m) return f(m); }
  return T(v);
};

const EN_IRREGULAR = { person: "people", child: "children", man: "men", woman: "women" };
function enPlural(w) {
  const at = w.lastIndexOf(" ") + 1, head = w.slice(at);
  const irr = EN_IRREGULAR[head.toLowerCase()];
  const p = irr ? (head[0] === head[0].toUpperCase() ? irr[0].toUpperCase() + irr.slice(1) : irr)
    : /[^aeiou]y$/.test(head) ? head.slice(0, -1) + "ies"
      : /(s|x|z|ch|sh)$/.test(head) ? head + "es"
        : head + "s";
  return w.slice(0, at) + p;
}

export function plural(n, noun) {
  const forms = PLURALS[noun];
  if (!forms) { const w = stripCtx(noun); return n + " " + (n === 1 ? w : enPlural(w)); }
  if (LANG === "ru") {
    const a = Math.abs(n) % 100, d = a % 10;
    const i = (a > 10 && a < 20) ? 2 : (d > 1 && d < 5) ? 1 : (d === 1) ? 0 : 2;
    return n + " " + forms[i];
  }
  return n + " " + (n === 1 ? forms[0] : forms[1]);
}

export const locale = () => (LANG === "en" ? "en-GB" : LANG);
export const fmtNum = n => { try { return Number(n).toLocaleString(locale()); } catch (_) { return String(n); } };
