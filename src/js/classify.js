// Tier 1 = label-anchored, hash lookup. Tier 2 = character scan. `ip`/`asn` are neither — they never touch
// the host matcher at all, they load straight into the category's nft set.
export const PATTERN_TIER = { site: 1, zone: 1, first: 1, any: 1, starts: 2, ends: 2, contains: 2 };
export const TIER2_MIN = 3;
export const patternTier = kind => PATTERN_TIER[kind] || 0;
export const isPatternKind = kind => kind in PATTERN_TIER;

const IP_SHAPED = /^[0-9.]+(?:\/[0-9]*)?$/;                    // digits and dots (+ an optional /…) → they meant an address
const IP4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const ASN = /^as:?(\d{1,10})$/;                                // AS<n> / AS:<n> — the panel resolves it to that AS's prefixes
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;                  // one DNS label: no leading/trailing hyphen
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;           // a last label must be alphabetic or punycode — never a number

const bad = why => ({ kind: "invalid", why });

// IDN → punycode, per whole labels. Only safe where the operand IS whole labels: a Tier-2 operand is an
// arbitrary substring, and the punycode of half a label does not exist — see the tier2 guard below.
function puny(s) {
  if (!/[^\x00-\x7f]/.test(s)) return s;
  if (/[:/?#@[\]\s]/.test(s)) return null;
  try { return new URL("http://" + s).hostname; } catch { return null; }
}

// A dotted operand that must be a real hostname: ≥2 labels, each a legal label, last one alphabetic/punycode.
function asDomain(s) {
  const d = puny(s);
  if (!d || d.length > 253) return null;
  const labels = d.split(".");
  if (labels.length < 2) return null;
  if (!labels.every(l => LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1])) return null;
  return d;
}

// A single operand label — the zone in `*.ru`, the name in `google.*` and `*.google.*`.
function asLabel(s, tldRules) {
  const d = puny(s);
  if (!d || d.includes(".")) return null;
  if (!LABEL.test(d)) return null;
  // A zone is the last label of a real name, so it obeys the stricter last-label rule: `*.1` is not a zone.
  // A first/any operand is an ordinary label and may legitimately be numeric (`*.123.*`).
  if (tldRules && !TLD.test(d)) return null;
  return d;
}

export function classify(raw) {
  let t = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!t) return bad("empty");

  const ma = ASN.exec(t);
  if (ma) return { kind: "asn", value: "as" + String(Number(ma[1])) };

  if (IP_SHAPED.test(t)) {
    const mi = IP4.exec(t);
    if (!mi) return bad("bad_ip");
    if (![1, 2, 3, 4].every(i => +mi[i] <= 255)) return bad("bad_ip");
    if (mi[5] !== undefined && +mi[5] > 32) return bad("bad_ip");
    return { kind: "ip", value: mi.slice(1, 5).join(".") + "/" + (mi[5] === undefined ? "32" : String(+mi[5])) };
  }

  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0];   // scheme + path — people paste URLs
  t = t.replace(/\.+$/, "");                                    // `yandex.ru.` is a valid FQDN; the last label would be ""
  if (!t) return bad("empty");

  const lead = t.startsWith("*");
  const trail = t.length > 1 && t.endsWith("*");
  if (!lead && !trail) {
    if (t.includes("*")) return bad("star_mid");
    const d = asDomain(t);
    if (d) return { kind: "site", value: d };
    const undot = t.replace(/^\.+/, "");
    if (t !== undot && undot && !undot.includes("*") && (asDomain(undot) || asLabel(undot, true))) return bad("lead_dot");
    // A single label is the one case worth naming separately: `ru` is almost always someone reaching for the
    // whole zone, and guessing that for them would be a rule of enormous blast radius that nobody asked for.
    return (!t.includes(".") && /^[^\s.]+$/.test(t)) ? bad("bare_label") : bad("bad_domain");
  }

  const core = t.slice(lead ? 1 : 0, trail ? -1 : undefined);
  if (core.includes("*")) return bad("star_mid");               // only the three shapes exist; `goo*gle.com` is not one
  if (!core || core === ".") return bad("empty");

  const headDot = core.startsWith("."), tailDot = core.endsWith(".");

  if (lead && !trail && headDot) {                              // *.X — the star is on a label boundary
    const op = core.slice(1);
    if (!op) return bad("empty");
    if (op.includes(".")) {                                     // *.google.com — the documented alias for the plain name
      const d = asDomain(op);
      return d ? { kind: "site", value: d } : bad("bad_domain");
    }
    const z = asLabel(op, true);                                // *.ru — a whole ending, every name under it
    return z ? { kind: "zone", value: z } : bad("bad_domain");
  }
  if (!lead && trail && tailDot) {                              // X.* — the first part of the name is X
    const op = asLabel(core.slice(0, -1), false);
    return op ? { kind: "first", value: op } : bad("multi_label_operand");
  }
  if (lead && trail && headDot && tailDot) {                    // *.X.* — some part of the name is X
    const op = asLabel(core.slice(1, -1), false);
    return op ? { kind: "any", value: op } : bad("multi_label_operand");
  }

  if (/[^\x00-\x7f]/.test(core)) return bad("idn_tier2");
  if (core.length < TIER2_MIN) return bad("short_tier2");
  return { kind: lead && trail ? "contains" : lead ? "ends" : "starts", value: core };
}

/** Every token in a pasted blob, classified. Splits on whitespace and commas, exactly like the panel's
 *  _split_targets, so what the field accepts and what the server re-reads cannot diverge on the split. */
export const classifyAll = raw => String(raw || "").split(/[\s,]+/).filter(Boolean).map(t => ({ raw: t, ...classify(t) }));
