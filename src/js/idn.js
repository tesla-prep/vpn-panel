const B = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;
const MAXINT = 0x7fffffff;

const digitOf = cp => {                          // one basic code point → its digit value, or -1
  if (cp >= 0x30 && cp <= 0x39) return cp - 0x16;          // '0'-'9' → 26..35
  if (cp >= 0x41 && cp <= 0x5a) return cp - 0x41;          // 'A'-'Z' → 0..25
  if (cp >= 0x61 && cp <= 0x7a) return cp - 0x61;          // 'a'-'z' → 0..25
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
  const delim = input.lastIndexOf("-");                     // the LAST hyphen separates basic from extended
  for (let j = 0; j < Math.max(delim, 0); j++) {
    const c = input.charCodeAt(j);
    if (c > 0x7f) return null;                              // a basic code point is ASCII by definition
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

// Which script a letter belongs to, coarsely — enough to answer "is this label written in one alphabet".
// Anything that is not a letter (digits, hyphen, combining marks) is script-neutral and answers "".
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
/** True when every letter in the label comes from one script. A label mixing two is the homograph shape and
 *  is left as punycode — Japanese, which legitimately mixes three, is admitted as the one known exception. */
export function singleScript(s) {
  const seen = new Set();
  for (const ch of s) { const k = scriptOf(ch); if (k) seen.add(k); }
  if (seen.has("unknown")) return false;      // cannot tell two unlisted scripts apart → never render it
  if (seen.size <= 1) return true;
  return [...seen].every(k => k === "han" || k === "hiragana" || k === "katakana");
}

/** One label as it should be READ. `xn--p1ai` → `рф`; anything that does not decode, does not re-encode to
 *  itself, or mixes scripts comes back exactly as it went in. */
export function idnLabel(label) {
  const s = String(label || "");
  if (!/^xn--/i.test(s)) return s;
  const u = punyDecode(s.slice(4).toLowerCase());
  if (!u || !singleScript(u)) return s;
  let back = null;                                          // the platform's own IDNA encoder is the referee
  try { back = new URL("http://" + u + ".test").hostname; } catch { return s; }
  return back === s.toLowerCase() + ".test" ? u : s;
}

/** A whole host name as it should be READ, label by label. `xn--80aswg.xn--p1ai` → `сайт.рф`. */
export const idnHost = name => String(name || "").split(".").map(idnLabel).join(".");
/** True when reading it changes it — the caller then has two forms and should show both somewhere. */
export const idnDiffers = name => idnHost(name) !== String(name || "");
