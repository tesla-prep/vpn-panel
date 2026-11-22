const B = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;
const MAXINT = 0x7fffffff;

const digitOf = cp => {
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x16;
  if (cp >= 0x41 && cp <= 0x5a) return cp - 0x41;
  if (cp >= 0x61 && cp <= 0x7a) return cp - 0x61;
  return -1;
};

const adapt = (delta, numpoints, first) => {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numpoints);
  let k = 0;
  while (delta > ((B - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (B - TMIN)); k += B; }
  return k + Math.floor(((B - TMIN + 1) * delta) / (delta + SKEW));
};

export function punyDecode(input) {
  if (!input) return null;
  const out = [];
  let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
  const delim = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delim, 0); j++) {
    const c = input.charCodeAt(j);
    if (c > 0x7f) return null;
    out.push(c);
  }
  for (let idx = delim >= 0 ? delim + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = B; ; k += B) {
      if (idx >= input.length) return null;
      const d = digitOf(input.charCodeAt(idx++));
      if (d < 0 || d > Math.floor((MAXINT - i) / w)) return null;
      i += d * w;
      const t = k <= bias ? TMIN : (k >= bias + TMAX ? TMAX : k - bias);
      if (d < t) break;
      if (w > Math.floor(MAXINT / (B - t))) return null;
      w *= B - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    if (Math.floor(i / (out.length + 1)) > MAXINT - n) return null;
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  try { return String.fromCodePoint(...out); } catch { return null; }
}

const SCRIPTS = [["latin", /\p{Script=Latin}/u], ["cyrillic", /\p{Script=Cyrillic}/u],
                 ["greek", /\p{Script=Greek}/u], ["han", /\p{Script=Han}/u],
                 ["arabic", /\p{Script=Arabic}/u], ["hebrew", /\p{Script=Hebrew}/u],
                 ["hiragana", /\p{Script=Hiragana}/u], ["katakana", /\p{Script=Katakana}/u],
                 ["hangul", /\p{Script=Hangul}/u], ["thai", /\p{Script=Thai}/u],
                 ["devanagari", /\p{Script=Devanagari}/u],
                 ["armenian", /\p{Script=Armenian}/u], ["georgian", /\p{Script=Georgian}/u],
                 ["bengali", /\p{Script=Bengali}/u], ["gujarati", /\p{Script=Gujarati}/u],
                 ["gurmukhi", /\p{Script=Gurmukhi}/u], ["kannada", /\p{Script=Kannada}/u],
                 ["malayalam", /\p{Script=Malayalam}/u], ["oriya", /\p{Script=Oriya}/u],
                 ["sinhala", /\p{Script=Sinhala}/u], ["tamil", /\p{Script=Tamil}/u],
                 ["telugu", /\p{Script=Telugu}/u], ["thaana", /\p{Script=Thaana}/u],
                 ["tibetan", /\p{Script=Tibetan}/u], ["lao", /\p{Script=Lao}/u],
                 ["myanmar", /\p{Script=Myanmar}/u], ["khmer", /\p{Script=Khmer}/u],
                 ["ethiopic", /\p{Script=Ethiopic}/u], ["syriac", /\p{Script=Syriac}/u]];
const scriptOf = ch => { for (const [name, re] of SCRIPTS) if (re.test(ch)) return name;
  return /\p{L}/u.test(ch) ? "unknown" : ""; };
export function singleScript(s) {
  const seen = new Set();
  for (const ch of s) { const k = scriptOf(ch); if (k) seen.add(k); }
  if (seen.has("unknown")) return false;
  if (seen.size <= 1) return true;
  return [...seen].every(k => k === "han" || k === "hiragana" || k === "katakana");
}

export function idnLabel(label) {
  const s = String(label || "");
  if (!/^xn--/i.test(s)) return s;
  const u = punyDecode(s.slice(4).toLowerCase());
  if (!u || !singleScript(u)) return s;
  let back = null;
  try { back = new URL("http://" + u + ".test").hostname; } catch { return s; }
  return back === s.toLowerCase() + ".test" ? u : s;
}

export const idnHost = name => String(name || "").split(".").map(idnLabel).join(".");
export const idnDiffers = name => idnHost(name) !== String(name || "");
