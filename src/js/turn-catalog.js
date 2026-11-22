import { Store } from "./store.js";
import { pickThemed } from "./theme.js";

export const TURN_FORKS_FALLBACK = [
  { id: "WINGS-N", label: "WINGS-N", owner: "WINGS-N/vk-turn-proxy", wrap: "-wrap-mode on", color: "#C98BE0", colorL: "#9B4FC7", protocols: ["wg", "awg"], awg3: false },
  { id: "samosvalishe", label: "FreeTurn", owner: "hackdiaz-dev/free-turn-proxy", wrap: "-obf-profile rtpopus", keyflag: "-obf-key", color: "#E0A85F", colorL: "#C07A1E", protocols: ["wg", "awg"] },
];

// turn-proxy display label: strip the vk-turn-proxy- prefix and render as name:port (a "-NNNN"
// suffix in the service name becomes ":NNNN"; otherwise the listen port is appended).
export function turnLabel(service, port) {   // just the fork name — the port shows in the Listen row
  let s = (service || "turn-proxy").replace(/^vk-turn-proxy-?/, "") || "turn";   // i18n-keys: internal fork/service id
  s = s.replace(/-\d+$/, "") || "turn";
  return s === "main" ? "cacggghp" : s;   // legacy "main" services (pre-rename) still display as cacggghp
}
// the fork id baked into a service name (vk-turn-proxy-<fork>-<port>) → its owner repo (for version/update checks)
export function turnFork(svc) { return turnLabel(svc, ""); }
// The csqtt version a server runs when its record or report names none (docs/CSQTT-LINES-PLAN.md). Here, not in turn.js, so
// ui.js (below turn.js) reads the same constant; turn.js re-exports it.
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
      wdtt_versions: Array.isArray(s.wdtt_versions) ? s.wdtt_versions : [],   // published builds; EMPTY = nothing a node could install yet
      reach_vouched: s.reach_vouched === true,   // DEVICE ACCESS §11.2 F4: the build a create installs proves a device's owner (else the create sheet warns)
      awg3: s.awg3 !== false,   // can its app carry AmneziaWG 3.1? The catalog says false for WINGS-N only; absent = yes (docs/AWG3-PLAN.md D-apps)
      client_dns: s.client_dns || "",   // the DNS a WDTT / csqtt server hands its clients when the panel sets none (docs/DNS-SETTINGS-PLAN.md §3.3)
      cli_authors: Array.isArray(s.cli_authors) ? s.cli_authors : ["samosvalishe"] }));
  return TURN_FORKS_FALLBACK;
}
export function turnForksVisible() { return turnForkList().filter(f => !f.hidden); }
export const forkOpts = (forks, off = null) => (forks || []).map(f => {
  const why = off ? off(f) : "";      // a reason this fork cannot be picked, or "" — the row greys and says it
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
export function forkPickLabel(fork) {   // fork dropdowns: "author · product" (author alone where there is no product)
  const f = turnForkList().find(x => x.id === fork) || {};
  const lbl = f.label || fork || "";
  return f.product ? lbl + " · " + f.product : lbl;
}
// Can this fork's app carry an AmneziaWG 3.1 interface? The catalog says `awg3: false` for WINGS-N only (its app, WINGS V,
// parses AmneziaWG 2.0); unknown → yes, the panel refuses what it has to (docs/AWG3-PLAN.md D-apps).
export function forkSupportsAwg3(fork) {
  const f = turnForkList().find(x => x.id === fork);
  return !f || f.awg3 !== false;
}
export function forkSupportsAwg(fork) {
  const f = turnForkList().find(x => x.id === fork);
  return f ? (f.protocols || ["wg", "awg"]).includes("awg") : true;   // unknown fork → assume awg-capable (permissive, matches prior default)
}
// stable colour for a turn-proxy fork in the ACTIVE mode (peers connected via it get their badge tinted this);
// a Panel-settings override (turn_fork_colors[id] = {dark,light}) wins over the fork's catalog default.
export function turnColor(label) {
  const ov = (Store.panelSettings && Store.panelSettings.turn_fork_colors) || {};
  const fk = turnForkList().find(x => x.id === label);
  return pickThemed(ov[label], (fk && fk.color) || "#8FA8C0", (fk && fk.colorL) || "#5E7085");
}
// A client app's colour = its NATIVE fork's turn-proxy server colour (a cross-fork app still shows its
// HOME server's colour). null for the generic CLI (no native fork) — callers fall back to the current fork's colour.
export function turnClientColor(clientId) {
  const c = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[clientId] || {};
  if (c.color) return pickThemed(c.color, c.color.dark, c.color.light);   // explicit app colour (author isn't a fork, e.g. SpaceNeuroX/luminescq)
  return c.native_fork ? turnColor(c.native_fork) : null;
}
// The app's author = its NATIVE fork (who makes it). null for the generic CLI (no native fork). `owner` is that
// fork's GitHub owner/repo, so callers can link "by <author>" to the source.
export function turnClientAuthor(clientId) {
  const c = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[clientId] || {};
  // an explicit `author` (real app author — may not be a server fork, e.g. SpaceNeuroX/luminescq) wins over the
  // native_fork (which is only for schema sharing). owner links "by <author>" to the app's own repo.
  if (c.author) {
    const p = ((c.platforms && Object.values(c.platforms)[0]) || {}).github || "";
    const m = p.match(/github\.com\/([^/]+\/[^/]+)/);
    return { fork: c.author, owner: m ? m[1] : "" };
  }
  if (!c.native_fork) return null;
  const f = turnForkList().find(x => x.id === c.native_fork) || {};
  return { fork: c.native_fork, owner: f.owner || "" };
}
