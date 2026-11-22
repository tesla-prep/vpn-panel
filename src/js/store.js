import { url, clock, panelNow, esc } from "./util.js";
import { T, lang } from "./i18n.js";
import { pickThemed, NODE_COLOR_DEFAULT } from "./theme.js";
import { reconcile } from "../reconcile.js";
import { useState, useEffect } from "preact/hooks";

export const hooks = {
  themeColors: null,      // applyThemeColors  — re-inject the accent + per-kind colours
  forkColors: null,       // applyForkColors   — turn-fork tints
  dashTick: null,         // recordDashTick    — dashboard live trend series
  alertServices: null,    // maybeAlertServices— critical panel-service modal
  rekeyGhosts: null,      // maybeRekeyGhosts  — phase 2 of a ghost recreate
  vaultKeyCached: null,   // subSKCached       — is the encryption vault unlocked this session?
  vaultAutoHeal: null,    // subAutoHeal       — re-issue blobs after an unlock
  ifaceKeyAutoRestore: null,  // ifaceKeyAutoRestore — put a migrated interface's escrowed key back (T-22)
  escrowAutoVerify: null,     // escrowAutoVerify — prove an unstamped escrow blob opens, which only the browser can
};

let _on401 = () => { throw new Error("unauthorized"); };   // i18n-keys: a control-flow sentinel, never displayed
export const setUnauthorizedHandler = fn => { _on401 = fn; };

// api
export const REQ_TIMEOUT = 90000;
async function _fetch(u, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || REQ_TIMEOUT);   // `ms`: the one call that legitimately outlasts it (docker-confirm)
  const o = { ...(opts || {}), signal: ac.signal, headers: { ...((opts || {}).headers || {}), "X-SWG-Lang": lang() } };
  try { return await fetch(u, o); }
  catch (e) { if (e && e.name === "AbortError") throw new Error(T("the panel didn't respond in time")); throw e; }
  finally { clearTimeout(t); }
}
export const isCustomKey = k => typeof k === "string" && /^custom:\d{8}-\d{8}$/.test(k);
const _iso = d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
export function customKeyWindow(k) { const [f, t] = k.slice(7).split("-"); return { range: "custom", from: _iso(f), to: _iso(t) }; }
export function rangeQ(k) {
  if (!isCustomKey(k)) return "range=" + encodeURIComponent(k);
  const w = customKeyWindow(k);
  return "range=custom&from=" + w.from + "&to=" + w.to;
}
export const api = {
  async get(p) { const r = await _fetch(url(p)); if (r.status === 401) return _on401(); return r.json(); },
  async post(p, b, ms) { const r = await _fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }, ms); if (r.status === 401 && !/\/api\/login$/.test(p)) return _on401(); return r.json(); },
  login(b) { return this.post("/api/login", b); },
  logout() { return this.post("/api/logout", {}); },
  state() { return this.get("/api/state"); },
  events(limit) { return this.get("/api/events?limit=" + (limit || 15)); },
  eventDelete(eid) { return this.post("/api/events/delete", { eid }); },
  eventsClear() { return this.post("/api/events/clear", {}); },
  nodeHistory(node, range) { return this.get("/api/node-history?node=" + encodeURIComponent(node) + "&" + rangeQ(range)); },
  meshHistory(range) { return this.get("/api/mesh-history?" + rangeQ(range)); },
  categoryHistory(range) { return this.get("/api/category-history?" + rangeQ(range)); },
  turnHistory(range) { return this.get("/api/turn-history?" + rangeQ(range)); },
  exitHistory(range) { return this.get("/api/exit-history?" + rangeQ(range)); },
  blockStats(range) { return this.get("/api/block-stats?" + rangeQ(range)); },
  presence(range, blocks, step, nodes) {
    return this.get("/api/presence?" + rangeQ(range) + "&blocks=" + blocks + "&step=" + step
      + (nodes && nodes.length ? "&nodes=" + encodeURIComponent(nodes.join(",")) : ""));
  },
  ifaceSeries(node, iface, range) { return this.get("/api/iface-series?node=" + encodeURIComponent(node) + "&iface=" + encodeURIComponent(iface) + "&range=" + encodeURIComponent(range)); },
  turnSeries(node, fork, range) { return this.get("/api/turn-series?node=" + encodeURIComponent(node) + "&fork=" + encodeURIComponent(fork) + "&range=" + encodeURIComponent(range)); },
  meshSeries(node, peer, range) { return this.get("/api/mesh-series?node=" + encodeURIComponent(node) + "&peer=" + encodeURIComponent(peer) + "&range=" + encodeURIComponent(range)); },
  turnIps() { return this.get("/api/turn-ips"); },
  turnIpsFlush(body) { return this.post("/api/turn-ips/flush", body || {}); },   // {node?, ip?, service?}: ip → delete one; service → this proxy's offline; else node/fleet inactive (keep online)
  catalog(search, page) { return this.get("/api/catalog?search=" + encodeURIComponent(search || "") + "&page=" + (page || 0)); },
  catalogIndex() { return this.get("/api/catalog/index"); },
  catalogRefresh() { return this.post("/api/catalog/refresh", {}); },
  blockCatalog() { return this.get("/api/block-catalog"); },                       // block-list categories + providers + pickable lists (Routing & Blocking → Blocking tab)
  blockCatalogSave(body) { return this.post("/api/block-catalog/save", body || {}); },   // staged commit: category deltas + provider toggles
  // `retry` clears the panel's failure cooldown for this list — the operator pressing "not ready" is the one
  // signal that should reach upstream sooner than the cooldown would allow.
  listInfo(cat, retry) { return this.get("/api/list-info?cat=" + encodeURIComponent(cat) + (retry ? "&retry=1" : "")); },
  geoUpdate() { return this.post("/api/geo/update", {}); },
  geoProviderRetry(provider) { return this.post("/api/geo/provider-retry", { provider }); },
  // Cancel also turns the provider off, server-side: a cancelled download was started by enabling it, so
  // leaving it enabled would have the next settings save start the same fetch again.
  geoProviderCancel(provider) { return this.post("/api/geo/provider-cancel", { provider }); },
  nextIp(nodes, iface) { return this.get("/api/next-ip?nodes=" + encodeURIComponent(nodes.join(",")) + "&iface=" + encodeURIComponent(iface)); },
  config(pubkey, node, iface) { return this.get("/api/config?pubkey=" + encodeURIComponent(pubkey) + "&node=" + encodeURIComponent(node) + "&iface=" + encodeURIComponent(iface)); },
  account() { return this.get("/api/account"); },
  accountSave(b) { return this.post("/api/account", b); },
  nodes() { return this.get("/api/nodes"); },
  nodeCreate(b) { return this.post("/api/nodes/create", b); },
  nodeUpdate(b) { return this.post("/api/nodes/update", b); },
  nodeArrivedClear(b) { return this.post("/api/nodes/arrived/clear", b); },   // dismiss the "arrived here" note
  turnReclaim(b) { return this.post("/api/turn/reclaim", b); },   // a wdtt/csqtt server the node holds and no panel claims
  escrowVerified(b) { return this.post("/api/iface/escrow/verified", b); },   // the browser opened the blob: it is for THIS vault
  resolveHost(h) { return this.get("/api/resolve?host=" + encodeURIComponent(h)); },   // does this name land on this node?
  // is this device an exit on that node, and may it be one? (tri-state `known` + a role verdict — §11.3)
  exitCheck(node, dev, iface) { return this.get("/api/exit/check?node=" + encodeURIComponent(node)
    + "&dev=" + encodeURIComponent(dev) + (iface ? "&iface=" + encodeURIComponent(iface) : "")); },
  // decision 8: relay a vault-escrowed exit key back to its node, re-sealed by the BROWSER to the node's
  // transport key — the panel never sees plaintext, which is the property that makes the escrow worth having.
  exitRestore(node, id, key_blob, pub) { return this.post("/api/exit/restore", { node, id, key_blob, pub }); },
  exitEscrowForget(node, id) { return this.post("/api/exit/escrow/forget", { node, id }); },
  connectionUpdate(b) { return this.post("/api/connection/update", b); },
  panelSettings(b) { return this.post("/api/panel/settings", b); },
  subVault() { return this.get("/api/sub/vault"); },
  subVaultSet(b) { return this.post("/api/sub/vault", b); },
  subReset() { return this.post("/api/sub/reset", {}); },
  subUsers() { return this.get("/api/sub/users"); },
  subUserEnable(b) { return this.post("/api/sub/user/enable", b); },
  subUserRotate(b) { return this.post("/api/sub/user/rotate", b); },
  subUserDisable(b) { return this.post("/api/sub/user/disable", b); },
  subBlob(b) { return this.post("/api/sub/blob", b); },
  subBlobGet(pid) { return this.get("/api/sub/blob?peer_id=" + encodeURIComponent(pid)); },   // read one peer's ciphertext for in-browser Show-QR decrypt
  subExitBlob(b) { return this.post("/api/sub/exitblob", b); },   // keep a dial-in exit's router key (ciphertext)
  subExitBlobGet(node, exit) { return this.get("/api/sub/exitblob?node=" + encodeURIComponent(node) + "&exit=" + encodeURIComponent(exit)); },
  subEscrow(b) { return this.post("/api/sub/escrow", b); },   // ensure a user holds an encryption unlock-key (encrypted config storage, no subscription)
  purgePlaintext(b) { return this.post("/api/config/purge-plaintext", b || {}); },   // migration: delete legacy plaintext where a blob exists
  plaintextPeers() { return this.get("/api/config/plaintext-peers"); },   // migration: exactly which peers still hold plaintext (+ orphan count)
  refreshGeo() { return this.post("/api/panel/refresh-geo", {}); },
  // external integration API (Settings → Integrations): read-only tokens + webhooks
  apiTokenCreate(label) { return this.post("/api/integrations/token", { label }); },
  apiTokenRevoke(id) { return this.post("/api/integrations/token/revoke", { id }); },
  apiWebhookSave(b) { return this.post("/api/integrations/webhook", b); },
  apiWebhookDelete(id) { return this.post("/api/integrations/webhook/delete", { id }); },
  apiWebhookTest(id) { return this.post("/api/integrations/webhook/test", { id }); },
  routingReset(b) { return this.post("/api/node/routing-reset", b); },   // per-node: wipe + rebuild + re-pull all smart-routing state
  awgLoad(b) { return this.post("/api/node/awg-load", b); },   // "Load now": swap in the AmneziaWG module an update installed
  asnCount(n) { return this.get("/api/asn?n=" + encodeURIComponent(n)); },   // resolve an ASN → prefix count (live editor feedback)
  nodeRotate(b) { return this.post("/api/nodes/rotate", b); },
  nodeRebuild(b) { return this.post("/api/nodes/rebuild", b); },
  // T-11: the SAME analysis, read-only and before the token rotates. It writes nothing, so the confirm
  // sheets can show what a rebuild would do while the operator can still decide not to.
  nodeRebuildPreflight(nid) { return this.get("/api/nodes/rebuild/preflight?node=" + encodeURIComponent(nid)); },
  nodeRebuildRollback(b) { return this.post("/api/nodes/rebuild/rollback", b); },   // {discard:true} = forget the old box instead
  nodeRemesh(b) { return this.post("/api/nodes/remesh", b); },   // rebuild THIS node's mesh links on demand
  nodeTransferPreflight(b) { return this.post("/api/nodes/transfer/preflight", b); },
  nodeTransfer(b) { return this.post("/api/nodes/transfer", b); },
  // "is it Reporting on the target panel yet" — asked OF the target, not inferred from our silence.
  nodeTransferStatus(nid) { return this.get("/api/nodes/transfer/status?node=" + encodeURIComponent(nid)); },
  nodeTransferCancel(b) { return this.post("/api/nodes/transfer/cancel", b); },   // withdraw the candidate; the node never left
  nodeFlagRemove(b) { return this.post("/api/nodes/flag-remove", b); },
  nodeUnflagRemove(b) { return this.post("/api/nodes/unflag-remove", b); },
  nodeDelete(b) { return this.post("/api/nodes/delete", b); },
  saveOrder(b) { return this.post("/api/order", b); },   // drag-to-reorder: {kind:"node"|"iface"|"turn", node?, order:[ids]}
  // users
  userCreate(b) { return this.post("/api/users/create", b); },
  userUpdate(b) { return this.post("/api/users/update", b); },
  userDelete(b) { return this.post("/api/users/delete", b); },
  // user groups (docs/GROUPS-PLAN.md) — membership travels as a delta: {id, name?, add?: [uid], remove?: [uid]}
  groupCreate(b) { return this.post("/api/groups/create", b); },
  groupUpdate(b) { return this.post("/api/groups/update", b); },
  groupDelete(b) { return this.post("/api/groups/delete", b); },
  userBlock(b) { return this.post("/api/user/block", b); },       // revoke WG + suspend the subscription URL
  userUnblock(b) { return this.post("/api/user/unblock", b); },   // restore both
  // peers
  peerCreate(b) { return this.post("/api/peers/create", b); },
  peerUpdate(b) { return this.post("/api/peers/update", b); },
  peerNetworks(b) { return this.post("/api/peers/networks", b); },   // {peer_id, routes?} — routes = a draft, judged and reported, never saved
  routingWho(b) { return this.post("/api/routing/who", b); },   // {node, iface, rows:[who]} — what each per-person selection covers there
  userNetworks(b) { return this.post("/api/users/networks", b); },   // {user_id} — what that user's devices can reach; on demand, never per poll
  peerNetworkProbe(b) { return this.post("/api/peers/networks/probe", b); },   // {peer_id, node, addr, port?} arms one reachability test from that node · {peer_id, id} reads it · {peer_id} lists this peer's
  peerAddTarget(b) { return this.post("/api/peers/add-target", b); },
  exitTest(b) { return this.post("/api/exit/test", b); },   // {node, exit_id?, socks_text, socks_pass} tests a SOCKS5 proxy from that node · {node, id} reads it
  peerUpdateTarget(b) { return this.post("/api/peers/update-target", b); },
  peerRemoveTarget(b) { return this.post("/api/peers/remove-target", b); },
  peerSetRole(b) { return this.post("/api/peers/set-role", b); },   // role: "primary" | "backup" | "" (clear)
  peerDelete(b) { return this.post("/api/peers/delete", b); },
  peerUnassign(b) { return this.post("/api/peers/unassign", b); },
  peerRekey(b) { return this.post("/api/peers/rekey", b); },
  peerBlock(b) { return this.post("/api/peers/block", b); },      // drop this peer from every node's desired set
  peerUnblock(b) { return this.post("/api/peers/unblock", b); },
  peerAdopt(b) { return this.post("/api/peers/adopt", b); },
  peerCorrect(b) { return this.post("/api/peers/correct", b); },   // broken: reassign an in-subnet IP
  ifaceUpdate(b) { return this.post("/api/iface/update", b); },
  ifaceOnboard(b) { return this.post("/api/iface/onboard", b); },
  ifaceIgnore(b) { return this.post("/api/iface/ignore", b); },       // dismiss an adoption candidate
  ifaceUnignore(b) { return this.post("/api/iface/unignore", b); },   // bring an ignored candidate back
  ifaceCreate(b) { return this.post("/api/iface/create", b); },
  ifaceCancel(b) { return this.post("/api/iface/cancel", b); },
  ifaceDelete(b) { return this.post("/api/iface/delete", b); },
  ifaceRestart(b) { return this.post("/api/iface/restart", b); },   // bounce the iface service on the node
  ifaceStop(b) { return this.post("/api/iface/stop", b); },         // stop (down + disable) the iface
  ifaceStart(b) { return this.post("/api/iface/start", b); },       // start (up + enable) the iface
  ifaceAdopt(b) { return this.post("/api/iface/adopt", b); },     // drift: pull the node's server-edited value
  ifaceRestore(b) { return this.post("/api/iface/restore", b); }, // drift: re-assert the panel's value
  ifaceRecreate(b) { return this.post("/api/iface/recreate", b); }, // restore a MISSING iface with its original identity
  turnManage(b) { return this.post("/api/turn/manage", b); },     // edit listen/connect (+ wrap key)
  turnTitle(b) { return this.post("/api/turn/title", b); },       // set the display title only — no restart/bounce
  turnRotate(b) { return this.post("/api/turn/rotate", b); },     // regenerate the wrap key
  turnDelete(b) { return this.post("/api/turn/delete", b); },         // stop + remove the service
  turnRestart(b) { return this.post("/api/turn/restart", b); },       // restart the service
  turnStop(b) { return this.post("/api/turn/stop", b); },             // stop the service (kept down, survives reconcile)
  turnStart(b) { return this.post("/api/turn/start", b); },           // start a stopped service
  turnReinstall(b) { return this.post("/api/turn/reinstall", b); },   // re-download the binary (fix a failed install / update) + (re)start
  turnInstall(b) { return this.post("/api/turn/install", b); },       // install a new turn-proxy (download + unit)
  turnOnboard(b) { return this.post("/api/turn/onboard", b); },       // adopt a host .service by path
  turnCancel(b) { return this.post("/api/turn/cancel", b); },
  turnCheckUpdates(b) { return this.post("/api/turn/check-updates", b); },   // resolve each fork's latest release tag
  wdttSet(b) { return this.post("/api/wdtt/set", b); },                      // create/update a WDTT instance on a node (declarative)
  wdttDelete(b) { return this.post("/api/wdtt/delete", b); },                // remove a WDTT instance
  wdttAdopt(b) { return this.post("/api/wdtt/adopt", b); },                  // adopt a FOREIGN WDTT server (seeded create: reuses its identity + passwords)
  wdttPeerCreate(b) { return this.post("/api/wdtt-peer/create", b); },       // keyless WDTT peer (mints the WRAP password). UNUSED by the SPA since a peer may hold any mix of kinds — peerCreate takes a keyless target set and mints the password itself. The endpoint stays for API consumers.
  wdttPeerRotate(b) { return this.post("/api/wdtt-peer/rotate", b); },       // rotate a WDTT peer's password (revoke the old link)
  wdttRestore(b) { return this.post("/api/wdtt/restore", b); },              // restore a WDTT server's vaulted identity (owner pw + keypair)
  wdttRecreateFresh(b) { return this.post("/api/wdtt/recreate-fresh", b); }, // abandon the vaulted identity → mint a fresh key (users re-import)
  wdttVersions(q) { return this.get("/api/wdtt/versions?node=" + encodeURIComponent(q.node || "") + "&iface=" + encodeURIComponent(q.iface || "") + "&fork=" + encodeURIComponent(q.fork || "")); },   // our published builds (rollback targets) + any hold
  wdttVersion(b) { return this.post("/api/wdtt/version", b); },              // roll a WDTT instance to a build (ver) or release the hold (ver="")
  csqttVersions(q) { return this.get("/api/csqtt/versions?node=" + encodeURIComponent(q.node || "") + (q.iface ? "&iface=" + encodeURIComponent(q.iface) : "")); },   // our published csqtt builds (rollback targets) + any hold — per (node, version): the iface names the version, none = 2.1
  csqttVersion(b) { return this.post("/api/csqtt/version", b); },            // roll a node's csqtt to a build (ver) or release the hold (ver="")
  csqttSet(b) { return this.post("/api/csqtt/set", b); },                    // create/update a csqtt instance on a node (declarative)
  containerAdopt(b) { return this.post("/api/container/adopt", b); },   // take a wg/awg server over from another container (Amnezia)
  csqttAdopt(b) { return this.post("/api/csqtt/adopt", b); },                // adopt a FOREIGN csqtt server (its users come across)
  csqttDelete(b) { return this.post("/api/csqtt/delete", b); },              // remove a csqtt instance
  csqttPeerCreate(b) { return this.post("/api/csqtt-peer/create", b); },     // keyless csqtt peer (mints the access password). UNUSED by the SPA — see wdttPeerCreate above.
  csqttPeerRotate(b) { return this.post("/api/csqtt-peer/rotate", b); },     // rotate a csqtt peer's password (revoke the old link)
  rosterCheck() { return this.get("/api/turn/roster-check"); },              // client-app schema drift vs upstream GitHub (P1 ack-only clients)
  rosterAck(client) { return this.post("/api/turn/roster-ack", { client }); },   // acknowledge a client's current upstream as the baseline
  p4Report(refresh) { return this.get("/api/turn/p4/report" + (refresh ? "?refresh=1" : "")); },  // P4a versioned per-field roster (parseable forks)
  p4Adopt(client, body) { return this.post("/api/turn/p4/adopt", { client, ...(body || {}) }); },   // adopt {add,remove,vadd,vrem}
  p4SetVersion(client, index) { return this.post("/api/turn/p4/setversion", { client, index }); },     // rollback to an observed version (index=null → latest)
  turnVersions(q) { return this.get("/api/turn/versions?owner=" + encodeURIComponent(q.owner || "") + "&node=" + encodeURIComponent(q.node || "") + "&service=" + encodeURIComponent(q.service || "") + "&fork=" + encodeURIComponent(q.fork || "")); },   // mirrored (rollback-able) versions + any per-(node,fork) hold
  changelog(want) { return this.get("/api/changelog" + (want ? "?want=" + encodeURIComponent(want) : "")); },   // full panel changelog (newest-first) for the version info bubble
  procClearNode(node) { return this.post("/api/node/proc-clear", { node }); },   // dismiss a stuck/failed re-install/convert/update tag
  procClearHost() { return this.post("/api/host/proc-clear", {}); },
};

// ───────────────────────── store + reactive bus ─────────────────────────
export const bus = { subs: new Set(), emit() { this.subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }, sub(f) { this.subs.add(f); return () => this.subs.delete(f); } };
export function useStore() { const [, set] = useState(0); useEffect(() => bus.sub(() => set(x => x + 1)), []); }

export const Store = {
  fleet: [], storeConfigs: false, env: {}, versions: {},
  roster: { version: 1, users: {}, peers: {} }, stats: {}, nodes: [], describe: {}, events: [],
  recon: { peers: [], users: [], orphans: [], nodeStatus: {} },
  sessionConfigs: {},        // pubkey -> { "node|iface" -> confText }   (built at creation, in-memory)
  configEpoch: 0,            // bumps when a config is re-issued, so QR cards re-read it
  recentlyCreated: {},       // id -> ts (row flash)
  rotating: {},              // peer id -> ts — key rotation in flight; grid shows "rotating" until the new key is live
  ifaceOp: {},               // "node|iface" -> { verb:start|restart, phase:busy|ok|fail, started, until, err }
  ifaceNew: {},              // "node|iface" -> { type } — optimistic "creating/onboarding" card shown the instant Create is clicked (until the server's own pending/meta picks it up)
  ctrAdopt: {},              // "node|container:iface" -> { at } — optimistic "taking over" the instant it is
                             // confirmed, until /api/state carries the node's adopt_container back (or it ages out)
  ifaceGone: {},             // "node|iface" -> { at } — ifaceNew's mirror image: optimistic "deleting" card shown the instant Delete is confirmed (until the node stops reporting the interface)
  ghostRekey: {},            // "node|iface" -> { peers:[id], at } — a ghost recreate staged its peers; maybeRekeyGhosts() rekeys them once the fresh interface reports its new key (phase 2)
  turnNew: {},               // "node|service" -> { listen, connect, ... } — optimistic "installing" turn card (full entered data), shown until the node reports the real proxy
  pending: {},               // opId -> { apply(store), done }  — optimistic overlay (Model B)
  rowErrors: {},             // entityKey -> { msg, at }        — explained failure, shown on the row
  async init() {
    await this.poll();
    setInterval(() => { if (document.visibilityState !== "hidden") this.poll().catch(() => {}); }, 5000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.poll().catch(() => {}); });
  },
  // One round trip: /api/state bundles roster + nodes (incl. health_history) + per-node
  // interface meta + raw snapshots. Status is still derived in the browser via reconcile.js.
  _server: { roster: { version: 1, users: {}, peers: {} }, nodes: [] },   // pristine, last fetched
  async poll() {
    const [s, ev] = await Promise.all([api.state(), api.events().catch(() => null)]);
    const d = (s && s.data) || {};
    this._server = { roster: d.roster || { version: 1, users: {}, peers: {} }, nodes: d.nodes || [] };
    this.describe = d.describe || {};
    this.stats = d.snapshots || {};
    if (Number.isFinite(d.panel_now) && d.panel_now > 0) clock.skewMs = Date.now() - d.panel_now * 1000;
    trackInstance(d.instance, d.panel_now, d.nodes || []);
    // store_configs is now an enum: "encrypted" (blob at rest) | "off". storeConfigs stays a convenience bool
    // meaning "the panel keeps configs" (now encrypted). configsPlaintext = legacy plaintext files awaiting migration.
    this.storeMode = (d.store_configs === "off" || d.store_configs === false) ? "off" : "encrypted";
    // The placeholder a stored profile's PrivateKey line carries in the editor. Comes from the SERVER so the
    // two ends can never disagree about the exact string — it is what says "keep the key you already hold".
    this.exitKeyKeep = d.exit_key_keep || "";
    this.exitPskKeep = d.exit_psk_keep || "";   // the same sentinel trick for the peer's preshared key
    this.exitPassKeep = d.exit_pass_keep || "";   // …and for a SOCKS5 exit's password, which the browser never sees
    this.storeConfigs = this.storeMode !== "off";
    this.configsPlaintext = d.configs_plaintext || 0;
    this.panelSettings = d.panel_settings || this.panelSettings || {};
    this.subCert = d.sub_cert || {};              // subscription TLS health; {} behind a reverse proxy (admin's own)
    this.panelServices = d.panel_services || {};   // THIS host's own swg units (active/enabled/present) → service-health needs-attention. {} on docker/older panels
    // Non-empty = the panel could not persist its session-signing secret, so every operator is signed
    // out on each restart. "" on a healthy panel and on older ones that do not report it.
    this.sessionEphemeral = d.session_ephemeral || "";
    this.datapath = d.datapath || {};              // THIS host's kernel datapath health (awg module loadable?) → healable "Fix" issue
    this.turnCatalog = d.turn_catalog || this.turnCatalog || null;   // single-source turn fork/client catalog (server-owned); turnForks() falls back to TURN_FORKS_FALLBACK when absent (mixed-version safe)
    this.turnHolds = d.turn_holds || this.turnHolds || {};   // {node: {fork: held_version}} → fork-row "held" flag
    this.csqttLines = d.csqtt_lines || this.csqttLines || [];   // ["2.1", "2.5"] csqtt versions on offer (docs/CSQTT-LINES-PLAN.md) — one entry = no Version control (unless a server runs another)
    this.panelPublicUrl = d.panel_public_url || this.panelPublicUrl || "";   // CONFIRMED canonical address → flag a tab on an old panel address
    this.panelMigrateRevertable = !!d.panel_migrate_revertable;   // a still-gracing panel-controlled move → the ribbon offers an instant "cancel the move" (server auto-clears at grace end)
    this.panelMigratePrev = d.panel_migrate_prev || null;         // the OLD address to cancel back to (only while revertable)
    this.accessCooldown = d.access_cooldown || { secs: 0, reason: "" };   // one-at-a-time: while a change verifies/graces, Access&TLS disables Save + shows the cooldown
    this.dockerAwaiting = d.docker_awaiting || null;   // a docker restart-safe recreate awaiting a reachability confirm → a global effect auto-commits (reaching /api/state here IS the proof)
    hooks.forkColors && hooks.forkColors();   // keep every .tf-<fork> tag/badge in sync with the picker override
    hooks.themeColors && hooks.themeColors();  // keep wg/awg/blocked/faulty colours + the --brand theme in sync with the pickers
    this.smartCaps = d.smart_caps || this.smartCaps || {};   // per-category {ip,host} → [IP]/[Host] grouping + kernel-mode greying
    this.catDomains = d.cat_domains || this.catDomains || {};   // curated domains per host category → hover tooltip
    this.catLabels = d.cat_labels || this.catLabels || {};   // custom_<hash> → custom-list title (for the destination bars)
    this.catalogProviders = d.catalog_providers || this.catalogProviders || [];   // Geo-data provider registry [{id,label,url,tiers,enabled,error}]
    this.catalogGen = d.catalog_gen || "";   // moves whenever the panel's catalog index changes → loadCatalogIndex refetches exactly then
    this.catSizes = d.cat_sizes || this.catSizes || {};   // {cat:{ip,host}} resolved-list record counts → list-size display
    this.env = d.env || this.env || {};
    this.versions = d.versions || this.versions;
    this.tls = d.tls || this.tls || {};   // cert expiry + renewal health → the Access & TLS card

    this.turnUpdates = d.turn_updates || this.turnUpdates || [];   // [{fork,kind,node,installed,latest,ids}] — deployed turn-family servers behind their newest build, one row per (fork, node). Held forks are already excluded server-side.
    if (s && s.ok) { this.hostProc = d.host_proc || null; this.hostProcErr = d.host_proc_err || null; }   // only on a clean poll → the tag HOLDS through the panel's own re-install downtime
    if (ev && Array.isArray(ev.data)) this.events = ev.data;
    this.apply();
    try {
      const hk = ((hooks.vaultKeyCached && hooks.vaultKeyCached()) && this.storeMode === "encrypted")
        ? (Object.keys(this.roster.peers || {}).length + ":" + Object.keys(this.roster.users || {}).length)
        : "off";
      if (hk !== this._healKey) { this._healKey = hk; if (hk !== "off") hooks.vaultAutoHeal && hooks.vaultAutoHeal(); }
    } catch (_) {}
    try {
      const heldList = [];
      for (const n of (this.nodes || [])) {
        for (const i of (n.awaiting_key || [])) heldList.push(n.id + "|" + i);
        for (const w of (((this.stats[n.id] || {}).wdtt) || [])) if (w && w.await_restore && w.iface) heldList.push(n.id + "|w:" + w.iface);
      }
      const held = heldList.sort().join(",");
      if (held !== this._heldKey) { this._heldKey = held; if (heldList.length) hooks.ifaceKeyAutoRestore && hooks.ifaceKeyAutoRestore(); }
      const unver = [];
      for (const n of (this.nodes || [])) {
        const ifs = (this.describe || {})[n.id] || {};
        for (const [ifn, m] of Object.entries(ifs)) if (m && m.escrow_unverified) unver.push(n.id + "|i|" + ifn);
        // …and the WDTT twin, which is escrowed the same way and would otherwise never wake this
        for (const ifn of Object.keys(n.wdtt_escrow_unverified || {})) unver.push(n.id + "|w|" + ifn);
      }
      const uk = unver.sort().join(",");
      if (uk !== this._unverKey) { this._unverKey = uk; if (unver.length) hooks.escrowAutoVerify && hooks.escrowAutoVerify(); }
    } catch (_) {}
  },
  apply() {
    for (const id of Object.keys(this.pending)) if (this.pending[id].done) delete this.pending[id];
    const snap = (typeof structuredClone === "function") ? structuredClone(this._server)
                                                         : JSON.parse(JSON.stringify(this._server));
    this.roster = snap.roster; this.nodes = snap.nodes;
    for (const id of Object.keys(this.pending)) { try { this.pending[id].apply(this); } catch (_) {} }
    // fleet entries carry the stable id (the connector everywhere) + the mutable name (display)
    this.fleet = this.nodes.map(n => ({ id: n.id, name: n.name, color: n.color, transport: "https" }));
    const retiring = new Set();   // pubkeys mid-removal (rotation/delete) — keep them out of the orphans grid
    for (const n of this.nodes) for (const pk of (n.retiring || [])) retiring.add(pk);
    const systemIfaces = new Set();   // node|iface that are panel-managed mesh links (swg_*) — their peers
    for (const nid of Object.keys(this.describe || {}))   // are managed via nodes.json, NOT the roster: not orphans
      for (const ifn of Object.keys(this.describe[nid] || {}))
        if (this.describe[nid][ifn] && this.describe[nid][ifn].system) systemIfaces.add(nid + "|" + ifn);
    const _adv = (this.panelSettings || {}).advanced || {};   // operator-tunable stale/grace thresholds
    this._probSince = this._probSince || {};   // {pid: firstProblemMs} — persists so Restore/Correct only offers after a real, sustained problem (not a hiccup / mid-create)
    const _sc = (this.panelSettings || {}).status_conditions || {};   // peer-health detection toggles (default on)
    // `nodeSeen`: when the PANEL received each node's last sync (its own clock, `node_seen` → nodes_view). Paired with
    // panelNow() this is one machine's clock at both ends of every window reconcile measures — see reconcile.js.
    const nodeSeen = {}; for (const n of (this.nodes || [])) if (n && n.last_seen != null) nodeSeen[n.id] = n.last_seen;
    this.recon = reconcile(this.roster, this.stats, panelNow(), { retiring, systemIfaces, nodeSeen, rotating: new Set(Object.keys(this.rotating)),
      probSince: this._probSince,
      ...(_adv.churn_gap_s ? { churnGapS: _adv.churn_gap_s } : {}), ...(_adv.churn_min ? { churnMin: _adv.churn_min } : {}),
      detectBlocked: _sc.blocked !== false, detectChurn: _sc.faulty !== false,
      expiryWarnDays: (this.panelSettings || {}).expiry_warn_days,   // "about to expire" warn window (days) for the derived status
      ...(_adv.restore_grace_ms ? { restoreGraceMs: _adv.restore_grace_ms } : {}),
      ...(_adv.node_stale_ms ? { nodeStaleMs: _adv.node_stale_ms } : {}), ...(_adv.peer_grace_ms ? { graceMs: _adv.peer_grace_ms } : {}) });
    this._missIfSince = this._missIfSince || {};
    { const _now = Date.now(), _grace = _adv.restore_grace_ms || 120000, _seen = new Set();
      for (const n of (this.nodes || [])) { const mi = n.missing_ifaces || {}, gi = n.ghost_ifaces || {};
        for (const ifn of Object.keys(mi)) { const k = n.id + "|" + ifn; _seen.add(k);
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          mi[ifn].problemMs = _now - this._missIfSince[k];
          mi[ifn].ripe = mi[ifn].problemMs >= _grace; }
        for (const ifn of Object.keys(gi)) { const k = n.id + "|g|" + ifn; _seen.add(k);   // ghosts get the SAME grace (a briefly-lost iface isn't a ghost yet)
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          gi[ifn].problemMs = _now - this._missIfSince[k];
          gi[ifn].ripe = gi[ifn].problemMs >= _grace; }
        // BROKEN (reported but down) gets the same grace for the same reason: an interface is briefly down
        // during any restart, and a Repair button that flashes on every bounce is one nobody trusts.
        const bi = n.broken_ifaces || {};
        for (const ifn of Object.keys(bi)) { const k = n.id + "|b|" + ifn; _seen.add(k);
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          bi[ifn].problemMs = _now - this._missIfSince[k];
          bi[ifn].ripe = bi[ifn].problemMs >= _grace; } }
      for (const k of Object.keys(this._missIfSince)) if (!_seen.has(k)) delete this._missIfSince[k]; }
    // a rotation is "done" once the new key shows up live (or after a 45s safety cap) — drop the marker
    for (const id of Object.keys(this.rotating)) {
      const pr = this.recon.peers.find(p => p.id === id);
      // Keep the marker for ≥4s even if the peer still reads ready — an optimistic "Rotating" (set the instant you
      // confirm) must survive the poll that lands before the rekey has actually taken the peer not-ready.
      if ((pr && (pr.status === "online" || pr.status === "ready" || pr.status === "partial") && Date.now() - this.rotating[id] > 4000) || (Date.now() - this.rotating[id] > 45000)) delete this.rotating[id];
    }
    for (const k of Object.keys(this.rowErrors)) {
      if (!k.startsWith("peer:")) continue;
      const e = this.rowErrors[k];
      const pr = this.recon.peers.find(p => p.id === k.slice(5));
      const resolved = e.iface ? !!this.ifaceMeta(e.node, e.iface)
                               : (pr && (pr.status === "online" || pr.status === "ready"));
      if (!pr || resolved || Date.now() - (e.at || 0) > 120000) delete this.rowErrors[k];
    }
    try { hooks.dashTick && hooks.dashTick(); } catch (_) {}   // accumulate the dashboard's live-only trend series (online counts)
    bus.emit();
    hooks.alertServices && hooks.alertServices();   // raise the on-load modal for an un-silenced CRITICAL panel-service issue (guarded: once per incident, never over an open modal)
    try { hooks.rekeyGhosts && hooks.rekeyGhosts(); } catch (_) {}   // phase 2 of a ghost recreate: rekey its peers once the fresh interface is live
  },
  node(id) { return this.fleet.find(n => n.id === id); },              // lookup by stable id
  nodeName(id) { const n = this.node(id); return (n && n.name) || id; }, // display title (falls back to id)
  nodeRank(id) { const i = this.fleet.findIndex(n => n.id === id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; },
  byNode(a, b) {
    return this.nodeRank(a) - this.nodeRank(b)
        || String(this.nodeName(a) || "").localeCompare(String(this.nodeName(b) || ""));
  },
  nodeColor(id) { const n = this.node(id); return pickThemed(n && n.color, NODE_COLOR_DEFAULT.dark, NODE_COLOR_DEFAULT.light); },
  ifacesOf(node) { return Object.keys(this.describe[node] || {}); },   // node = id (describe keyed by id)
  ifaceMeta(node, iface) { return (this.describe[node] || {})[iface] || null; },
  // a panel-managed inter-node mesh link (swg_*): never a user-peer target / egress NIC. Authoritative
  // signal is the backend `.system` flag; fall back to the reserved prefix for un-updated nodes.
  ifaceIsSystem(node, iface) {
    if (!iface) return false;
    const m = (this.describe[node] || {})[iface] || {};
    const pfx = (this.panelSettings || {}).reserved?.iface_prefix || "swg_";
    return !!m.system || String(iface).startsWith(pfx) || String(iface).startsWith("swg_");
  },
  userIfacesOf(node) {   // wg/awg from describe + WDTT + csqtt ifaces (self-contained kinds own their iface, absent from describe → pulled from the readback)
    const base = this.ifacesOf(node).filter(i => !this.ifaceIsSystem(node, i));
    const wd = ((this.stats[node] || {}).wdtt || []).map(w => w && w.iface).filter(Boolean);
    const cs = ((this.stats[node] || {}).csqtt || []).map(c => c && c.iface).filter(Boolean);
    return Array.from(new Set([...base, ...wd, ...cs]));
  },
  peer(id) { return this.recon.peers.find(p => p.id === id); },
  user(id) { return this.recon.users.find(u => u.id === id); },
  groups() {
    if (this._groupsOf !== this.roster) {
      const g = (this.roster && this.roster.groups) || {}, us = (this.roster && this.roster.users) || {};
      this._groupsList = Object.keys(g).filter(id => g[id] && typeof g[id] === "object")
        .map(id => ({ id, name: String(g[id].name || ""), users: (Array.isArray(g[id].users) ? g[id].users : []).filter(u => us[u]) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      this._groupsById = new Map(this._groupsList.map(x => [x.id, x]));
      this._groupsOf = this.roster;
    }
    return this._groupsList;
  },
  group(id) { this.groups(); return this._groupsById.get(id) || null; },
  groupsByUser(id) {
    if (this._gByUserOf !== this.roster) {
      const m = new Map();
      for (const g of this.groups()) for (const u of g.users) (m.get(u) || m.set(u, []).get(u)).push(g);
      this._gByUser = m;
      this._gByUserOf = this.roster;
    }
    return this._gByUser.get(id) || [];
  },
  peersOfUser(id) { return this.recon.peers.filter(p => p.user_id === id); },
  sharesByGroup(gid) {
    if (this._sByGroupOf !== this.recon) {
      const m = new Map();
      for (const p of this.recon.peers) {
        if (p.private || !(p.routes || []).length || !p.share || !p.share.groups || typeof p.share.groups !== "object") continue;
        for (const g of Object.keys(p.share.groups)) (m.get(g) || m.set(g, []).get(g)).push(p);
      }
      this._sByGroup = m;
      this._sByGroupOf = this.recon;
    }
    return this._sByGroup.get(gid) || [];
  },
  peersByUser(id) {
    if (this._pByUserOf !== this.recon) {
      const m = new Map();
      for (const p of this.recon.peers) if (p.user_id) (m.get(p.user_id) || m.set(p.user_id, []).get(p.user_id)).push(p);
      this._pByUser = m;
      this._pByUserOf = this.recon;
    }
    return this._pByUser.get(id) || [];
  },
  unassignedPeers() { return this.recon.peers.filter(p => p.unassigned); },
};


// TWO PANELS BEHIND ONE ADDRESS (see _INSTANCE in swg-panel-server)
const INST_KEY = "swg.panelInstances:" + url(""), INST_DISMISS = "swg.panelTwinsDismissed:" + url("");
const INST_MARGIN = 120;          // seconds of clock disagreement tolerated between two servers' clocks
// The other one must have answered within this window to still count. Short on purpose: once the operator stops the
// stray, the notice must go away soon, or it reads as "stopping it did not work" (code review 09-24; was 6 h).
const INST_RECENT = 30 * 60;
// Pure: the remembered instance whose life overlaps `cur`'s and that answered recently, or null.
export function panelTwin(list, cur) {
  return (list || []).find(o => o && cur && o.id !== cur.id
    && cur.started + INST_MARGIN < o.last && o.started + INST_MARGIN < cur.last
    && cur.last - o.last < INST_RECENT) || null;
}
function trackInstance(inst, now, nodes) {
  if (!inst || !inst.id || !Number.isFinite(now)) return;   // a panel too old to say → nothing to compare
  let list = [];
  try { list = JSON.parse(localStorage.getItem(INST_KEY) || "[]"); } catch (_) {}
  if (!Array.isArray(list)) list = [];
  // `reporting` = servers syncing to THIS panel right now — the one to keep is the one they report to
  const cur = { id: String(inst.id), started: Number(inst.started) || now, last: now, nodes: nodes.length,
                reporting: nodes.filter(n => n && n.status === "online").length,
                version: inst.version || "", method: inst.method || "", state_dir: inst.state_dir || "" };
  list = [cur, ...list.filter(o => o && o.id !== cur.id && now - (Number(o.last) || 0) < 7 * 86400)].slice(0, 8);
  try { localStorage.setItem(INST_KEY, JSON.stringify(list)); } catch (_) {}
  const twin = panelTwin(list.slice(1), cur);
  let dismissed = "";
  try { dismissed = localStorage.getItem(INST_DISMISS) || ""; } catch (_) {}
  const pair = twin ? [cur.id, twin.id].sort().join("|") : "";
  showTwinBanner(twin && pair !== dismissed ? { cur, twin, pair } : null);
}
function showTwinBanner(t) {
  let b = document.getElementById("panel-twin-banner");
  if (!t) { if (b) b.remove(); return; }
  const sig = t.pair + "|" + t.cur.nodes + "|" + t.cur.reporting;
  if (b && b.dataset.sig === sig) return;
  if (!b) { b = document.createElement("div"); b.id = "panel-twin-banner"; b.className = "twin-banner"; document.body.insertBefore(b, document.body.firstChild); }
  b.dataset.sig = sig;
  const since = ts => new Date(ts * 1000).toLocaleString();
  const who = o => T("{v1} · version {v2} · state {v3} · {v4} · running since {v5}", {
    v1: o.method || "?", v2: o.version || "?", v3: o.state_dir || "?", v4: T("nodes: {n}, reporting here: {r}", { n: o.nodes, r: o.reporting == null ? "?" : o.reporting }), v5: since(o.started) });
  b.innerHTML = `<b>${esc(T("Two different panels are answering at this address."))}</b> `
    + esc(T("Each keeps its own servers, settings and lists, and the page shows whichever one answered — so what you see can change between reloads, and changes saved on the one your servers don't sync to never reach them. Keep the one your servers report to; stop the other."))
    + `<div class="twin-rows"><div><span class="twin-tag">${esc(T("this page"))}</span>${esc(who(t.cur))}</div>`
    + `<div><span class="twin-tag">${esc(T("also answered"))}</span>${esc(who(t.twin))} · ${esc(T("last seen {v1}", { v1: since(t.twin.last) }))}</div></div>`
    + `<button type="button" class="twin-x">${esc(T("Dismiss"))}</button>`;
  b.querySelector(".twin-x").onclick = () => { try { localStorage.setItem(INST_DISMISS, t.pair); } catch (_) {} b.remove(); };
}
