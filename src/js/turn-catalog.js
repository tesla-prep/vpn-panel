import { Store } from "./store.js";
import { pickThemed } from "./theme.js";

export const TURN_FORKS_FALLBACK = [
  { id: "WINGS-N", label: "WINGS-N", owner: "WINGS-N/vk-turn-proxy", wrap: "-wrap-mode on", color: "#C98BE0", colorL: "#9B4FC7", protocols: ["wg", "awg"], awg3: false },
  { id: "samosvalishe", label: "FreeTurn", owner: "hackdiaz-dev/free-turn-proxy", wrap: "-obf-profile rtpopus", keyflag: "-obf-key", color: "#E0A85F", colorL: "#C07A1E", protocols: ["wg", "awg"] },
];

export function turnLabel(service, port) {
  let s = (service || "turn-proxy").replace(/^vk-turn-proxy-?/, "") || "turn";
  s = s.replace(/-\d+$/, "") || "turn";
  return s === "main" ? "cacggghp" : s;
}
export function turnFork(svc) { return turnLabel(svc, ""); }
export const CSQTT_DEFAULT_LINE = "2.1";
export function turnOwner(svc) {
  const f = turnFork(svc); const fk = turnForkList().find(x => x.id === f);
  return fk ? fk.owner : (f && f !== "turn" ? f + "/vk-turn-proxy" : "");
}

export function turnForkList() {
  const cat = Store.turnCatalog;
  if (cat && Array.isArray(cat.servers) && cat.servers.length)
    return cat.servers.map(s => ({ id: s.id, label: s.label || s.id, product: s.product || "", raw: !!s.raw, owner: s.owner || "", kind: s.kind || "turn",
      wrap: s.wrap || "", keyflag: s.keyflag, color: (s.color || {}).dark, colorL: (s.color || {}).light, hidden: !!s.hidden,
      protocols: (Array.isArray(s.protocols) && s.protocols.length) ? s.protocols : ["wg", "awg"],
      settings: Array.isArray(s.settings) ? s.settings : [], client_settings: Array.isArray(s.client_settings) ? s.client_settings : [], clients: s.clients || [], compat: s.compat || {}, client_schemas: s.client_schemas || {},
      wdtt_versions: Array.isArray(s.wdtt_versions) ? s.wdtt_versions : [],
      reach_vouched: s.reach_vouched === true,
      awg3: s.awg3 !== false,
      client_dns: s.client_dns || "",
      cli_authors: Array.isArray(s.cli_authors) ? s.cli_authors : ["samosvalishe"] }));
  return TURN_FORKS_FALLBACK;
}
export function turnForksVisible() { return turnForkList().filter(f => !f.hidden); }
export const forkOpts = (forks, off = null) => (forks || []).map(f => {
  const why = off ? off(f) : "";
  return { value: f.id, label: forkPickLabel(f.id) + (why ? " — " + why : ""), disabled: !!why };
});
export function forkLabel(fork) { return (turnForkList().find(f => f.id === fork) || {}).label || fork || ""; }
export function forkProduct(fork) {
  const f = turnForkList().find(x => x.id === fork) || {};
  return f.product || (f.kind === "wdtt" ? "WDTT" : f.label) || fork || "";
}
export function forkNames(forks) {
  const n = {}, out = {};
  (forks || []).forEach(fk => { const l = forkLabel(fk); n[l] = (n[l] || 0) + 1; });
  (forks || []).forEach(fk => { out[fk] = n[forkLabel(fk)] > 1 ? forkPickLabel(fk) : forkLabel(fk); });
  return out;
}
export function forkPickLabel(fork) {
  const f = turnForkList().find(x => x.id === fork) || {};
  const lbl = f.label || fork || "";
  return f.product ? lbl + " · " + f.product : lbl;
}
export function forkSupportsAwg3(fork) {
  const f = turnForkList().find(x => x.id === fork);
  return !f || f.awg3 !== false;
}
export function forkSupportsAwg(fork) {
  const f = turnForkList().find(x => x.id === fork);
  return f ? (f.protocols || ["wg", "awg"]).includes("awg") : true;
}
export function turnColor(label) {
  const ov = (Store.panelSettings && Store.panelSettings.turn_fork_colors) || {};
  const fk = turnForkList().find(x => x.id === label);
  return pickThemed(ov[label], (fk && fk.color) || "#8FA8C0", (fk && fk.colorL) || "#5E7085");
}
export function turnClientColor(clientId) {
  const c = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[clientId] || {};
  if (c.color) return pickThemed(c.color, c.color.dark, c.color.light);
  return c.native_fork ? turnColor(c.native_fork) : null;
}
export function turnClientAuthor(clientId) {
  const c = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[clientId] || {};
  if (c.author) {
    const p = ((c.platforms && Object.values(c.platforms)[0]) || {}).github || "";
    const m = p.match(/github\.com\/([^/]+\/[^/]+)/);
    return { fork: c.author, owner: m ? m[1] : "" };
  }
  if (!c.native_fork) return null;
  const f = turnForkList().find(x => x.id === c.native_fork) || {};
  return { fork: c.native_fork, owner: f.owner || "" };
}
