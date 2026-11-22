export const PATTERN_TIER = { site: 1, zone: 1, first: 1, any: 1, starts: 2, ends: 2, contains: 2 };
export const TIER2_MIN = 3;
export const patternTier = kind => PATTERN_TIER[kind] || 0;
export const isPatternKind = kind => kind in PATTERN_TIER;

const IP_SHAPED = /^[0-9.]+(?:\/[0-9]*)?$/;
const IP4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;
const ASN = /^as:?(\d{1,10})$/;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const bad = why => ({ kind: "invalid", why });

function puny(s) {
  if (!/[^\x00-\x7f]/.test(s)) return s;
  if (/[:/?#@[\]\s]/.test(s)) return null;
  try { return new URL("http://" + s).hostname; } catch { return null; }
}

function asDomain(s) {
  const d = puny(s);
  if (!d || d.length > 253) return null;
  const labels = d.split(".");
  if (labels.length < 2) return null;
  if (!labels.every(l => LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1])) return null;
  return d;
}

function asLabel(s, tldRules) {
  const d = puny(s);
  if (!d || d.includes(".")) return null;
  if (!LABEL.test(d)) return null;
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

  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split("/")[0];
  t = t.replace(/\.+$/, "");
  if (!t) return bad("empty");

  const lead = t.startsWith("*");
  const trail = t.length > 1 && t.endsWith("*");
  if (!lead && !trail) {
    if (t.includes("*")) return bad("star_mid");
    const d = asDomain(t);
    if (d) return { kind: "site", value: d };
    const undot = t.replace(/^\.+/, "");
    if (t !== undot && undot && !undot.includes("*") && (asDomain(undot) || asLabel(undot, true))) return bad("lead_dot");
    return (!t.includes(".") && /^[^\s.]+$/.test(t)) ? bad("bare_label") : bad("bad_domain");
  }

  const core = t.slice(lead ? 1 : 0, trail ? -1 : undefined);
  if (core.includes("*")) return bad("star_mid");
  if (!core || core === ".") return bad("empty");

  const headDot = core.startsWith("."), tailDot = core.endsWith(".");

  if (lead && !trail && headDot) {
    const op = core.slice(1);
    if (!op) return bad("empty");
    if (op.includes(".")) {
      const d = asDomain(op);
      return d ? { kind: "site", value: d } : bad("bad_domain");
    }
    const z = asLabel(op, true);
    return z ? { kind: "zone", value: z } : bad("bad_domain");
  }
  if (!lead && trail && tailDot) {
    const op = asLabel(core.slice(0, -1), false);
    return op ? { kind: "first", value: op } : bad("multi_label_operand");
  }
  if (lead && trail && headDot && tailDot) {
    const op = asLabel(core.slice(1, -1), false);
    return op ? { kind: "any", value: op } : bad("multi_label_operand");
  }

  if (/[^\x00-\x7f]/.test(core)) return bad("idn_tier2");
  if (core.length < TIER2_MIN) return bad("short_tier2");
  return { kind: lead && trail ? "contains" : lead ? "ends" : "starts", value: core };
}

export const classifyAll = raw => String(raw || "").split(/[\s,]+/).filter(Boolean).map(t => ({ raw: t, ...classify(t) }));
