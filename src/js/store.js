import { url, clock, panelNow, esc } from "./util.js";
import { T, lang } from "./i18n.js";
import { pickThemed, NODE_COLOR_DEFAULT } from "./theme.js";
import { reconcile } from "../reconcile.js";
import { useState, useEffect } from "preact/hooks";

export const hooks = {
  themeColors: null,
  forkColors: null,
  dashTick: null,
  alertServices: null,
  rekeyGhosts: null,
  vaultKeyCached: null,
  vaultAutoHeal: null,
  ifaceKeyAutoRestore: null,
  escrowAutoVerify: null,
};

let _on401 = () => { throw new Error("unauthorized"); };
export const setUnauthorizedHandler = fn => { _on401 = fn; };

export const REQ_TIMEOUT = 90000;
async function _fetch(u, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms || REQ_TIMEOUT);
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
  async get(p) {
    const r = await _fetch(url(p));
    if (r.status === 401) return _on401();
    try { return await r.json(); }
    catch (_) { throw new Error(T("The panel returned an invalid response (HTTP {v1}).", { v1: r.status })); }
  },
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
  turnIpsFlush(body) { return this.post("/api/turn-ips/flush", body || {}); },
  catalog(search, page) { return this.get("/api/catalog?search=" + encodeURIComponent(search || "") + "&page=" + (page || 0)); },
  catalogIndex() { return this.get("/api/catalog/index"); },
  catalogRefresh() { return this.post("/api/catalog/refresh", {}); },
  blockCatalog() { return this.get("/api/block-catalog"); },
  blockCatalogSave(body) { return this.post("/api/block-catalog/save", body || {}); },
  listInfo(cat, retry) { return this.get("/api/list-info?cat=" + encodeURIComponent(cat) + (retry ? "&retry=1" : "")); },
  routingIpCoverage(selection) { return this.post("/api/routing/ip-coverage", selection); },
  geoUpdate() { return this.post("/api/geo/update", {}); },
  geoProviderRetry(provider) { return this.post("/api/geo/provider-retry", { provider }); },
  geoProviderCancel(provider) { return this.post("/api/geo/provider-cancel", { provider }); },
  nextIp(nodes, iface) { return this.get("/api/next-ip?nodes=" + encodeURIComponent(nodes.join(",")) + "&iface=" + encodeURIComponent(iface)); },
  config(pubkey, node, iface) { return this.get("/api/config?pubkey=" + encodeURIComponent(pubkey) + "&node=" + encodeURIComponent(node) + "&iface=" + encodeURIComponent(iface)); },
  account() { return this.get("/api/account"); },
  accountSave(b) { return this.post("/api/account", b); },
  nodes() { return this.get("/api/nodes"); },
  nodeCreate(b) { return this.post("/api/nodes/create", b); },
  nodeUpdate(b) { return this.post("/api/nodes/update", b); },
  turnReclaim(b) { return this.post("/api/turn/reclaim", b); },
  escrowVerified(b) { return this.post("/api/iface/escrow/verified", b); },
  resolveHost(h) { return this.get("/api/resolve?host=" + encodeURIComponent(h)); },
  exitCheck(node, dev, iface) { return this.get("/api/exit/check?node=" + encodeURIComponent(node)
    + "&dev=" + encodeURIComponent(dev) + (iface ? "&iface=" + encodeURIComponent(iface) : "")); },
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
  subBlobGet(pid) { return this.get("/api/sub/blob?peer_id=" + encodeURIComponent(pid)); },
  subExitBlob(b) { return this.post("/api/sub/exitblob", b); },
  subExitBlobGet(node, exit) { return this.get("/api/sub/exitblob?node=" + encodeURIComponent(node) + "&exit=" + encodeURIComponent(exit)); },
  subEscrow(b) { return this.post("/api/sub/escrow", b); },
  purgePlaintext(b) { return this.post("/api/config/purge-plaintext", b || {}); },
  plaintextPeers() { return this.get("/api/config/plaintext-peers"); },
  refreshGeo() { return this.post("/api/panel/refresh-geo", {}); },
  apiTokenCreate(label) { return this.post("/api/integrations/token", { label }); },
  apiTokenRevoke(id) { return this.post("/api/integrations/token/revoke", { id }); },
  apiWebhookSave(b) { return this.post("/api/integrations/webhook", b); },
  apiWebhookDelete(id) { return this.post("/api/integrations/webhook/delete", { id }); },
  apiWebhookTest(id) { return this.post("/api/integrations/webhook/test", { id }); },
  routingReset(b) { return this.post("/api/node/routing-reset", b); },
  awgLoad(b) { return this.post("/api/node/awg-load", b); },
  asnCount(n) { return this.get("/api/asn?n=" + encodeURIComponent(n)); },
  nodeRotate(b) { return this.post("/api/nodes/rotate", b); },
  nodeRemesh(b) { return this.post("/api/nodes/remesh", b); },
  nodeFlagRemove(b) { return this.post("/api/nodes/flag-remove", b); },
  nodeUnflagRemove(b) { return this.post("/api/nodes/unflag-remove", b); },
  nodeDelete(b) { return this.post("/api/nodes/delete", b); },
  saveOrder(b) { return this.post("/api/order", b); },
  userCreate(b) { return this.post("/api/users/create", b); },
  userUpdate(b) { return this.post("/api/users/update", b); },
  userDelete(b) { return this.post("/api/users/delete", b); },
  groupCreate(b) { return this.post("/api/groups/create", b); },
  groupUpdate(b) { return this.post("/api/groups/update", b); },
  groupDelete(b) { return this.post("/api/groups/delete", b); },
  userBlock(b) { return this.post("/api/user/block", b); },
  userUnblock(b) { return this.post("/api/user/unblock", b); },
  peerCreate(b) { return this.post("/api/peers/create", b); },
  peerUpdate(b) { return this.post("/api/peers/update", b); },
  peerNetworks(b) { return this.post("/api/peers/networks", b); },
  routingWho(b) { return this.post("/api/routing/who", b); },
  userNetworks(b) { return this.post("/api/users/networks", b); },
  peerNetworkProbe(b) { return this.post("/api/peers/networks/probe", b); },
  peerAddTarget(b) { return this.post("/api/peers/add-target", b); },
  exitTest(b) { return this.post("/api/exit/test", b); },
  peerUpdateTarget(b) { return this.post("/api/peers/update-target", b); },
  peerRemoveTarget(b) { return this.post("/api/peers/remove-target", b); },
  peerSetRole(b) { return this.post("/api/peers/set-role", b); },
  peerDelete(b) { return this.post("/api/peers/delete", b); },
  peerUnassign(b) { return this.post("/api/peers/unassign", b); },
  peerRekey(b) { return this.post("/api/peers/rekey", b); },
  peerBlock(b) { return this.post("/api/peers/block", b); },
  peerUnblock(b) { return this.post("/api/peers/unblock", b); },
  peerAdopt(b) { return this.post("/api/peers/adopt", b); },
  peerCorrect(b) { return this.post("/api/peers/correct", b); },
  ifaceUpdate(b) { return this.post("/api/iface/update", b); },
  ifaceCreate(b) { return this.post("/api/iface/create", b); },
  ifaceCancel(b) { return this.post("/api/iface/cancel", b); },
  ifaceDelete(b) { return this.post("/api/iface/delete", b); },
  ifaceRestart(b) { return this.post("/api/iface/restart", b); },
  ifaceStop(b) { return this.post("/api/iface/stop", b); },
  ifaceStart(b) { return this.post("/api/iface/start", b); },
  ifaceAdopt(b) { return this.post("/api/iface/adopt", b); },
  ifaceRestore(b) { return this.post("/api/iface/restore", b); },
  ifaceRecreate(b) { return this.post("/api/iface/recreate", b); },
  turnManage(b) { return this.post("/api/turn/manage", b); },
  turnTitle(b) { return this.post("/api/turn/title", b); },
  turnRotate(b) { return this.post("/api/turn/rotate", b); },
  turnDelete(b) { return this.post("/api/turn/delete", b); },
  turnRestart(b) { return this.post("/api/turn/restart", b); },
  turnStop(b) { return this.post("/api/turn/stop", b); },
  turnStart(b) { return this.post("/api/turn/start", b); },
  turnReinstall(b) { return this.post("/api/turn/reinstall", b); },
  turnInstall(b) { return this.post("/api/turn/install", b); },
  turnOnboard(b) { return this.post("/api/turn/onboard", b); },
  turnCancel(b) { return this.post("/api/turn/cancel", b); },
  turnCheckUpdates(b) { return this.post("/api/turn/check-updates", b); },
  wdttSet(b) { return this.post("/api/wdtt/set", b); },
  wdttDelete(b) { return this.post("/api/wdtt/delete", b); },
  wdttAdopt(b) { return this.post("/api/wdtt/adopt", b); },
  wdttPeerCreate(b) { return this.post("/api/wdtt-peer/create", b); },
  wdttPeerRotate(b) { return this.post("/api/wdtt-peer/rotate", b); },
  wdttRestore(b) { return this.post("/api/wdtt/restore", b); },
  wdttRecreateFresh(b) { return this.post("/api/wdtt/recreate-fresh", b); },
  wdttVersions(q) { return this.get("/api/wdtt/versions?node=" + encodeURIComponent(q.node || "") + "&iface=" + encodeURIComponent(q.iface || "") + "&fork=" + encodeURIComponent(q.fork || "")); },
  wdttVersion(b) { return this.post("/api/wdtt/version", b); },
  csqttVersions(q) { return this.get("/api/csqtt/versions?node=" + encodeURIComponent(q.node || "") + (q.iface ? "&iface=" + encodeURIComponent(q.iface) : "")); },
  csqttVersion(b) { return this.post("/api/csqtt/version", b); },
  csqttSet(b) { return this.post("/api/csqtt/set", b); },
  csqttAdopt(b) { return this.post("/api/csqtt/adopt", b); },
  csqttDelete(b) { return this.post("/api/csqtt/delete", b); },
  csqttPeerCreate(b) { return this.post("/api/csqtt-peer/create", b); },
  csqttPeerRotate(b) { return this.post("/api/csqtt-peer/rotate", b); },
  rosterCheck() { return this.get("/api/turn/roster-check"); },
  rosterAck(client) { return this.post("/api/turn/roster-ack", { client }); },
  p4Report(refresh) { return this.get("/api/turn/p4/report" + (refresh ? "?refresh=1" : "")); },
  p4Adopt(client, body) { return this.post("/api/turn/p4/adopt", { client, ...(body || {}) }); },
  p4SetVersion(client, index) { return this.post("/api/turn/p4/setversion", { client, index }); },
  turnVersions(q) { return this.get("/api/turn/versions?owner=" + encodeURIComponent(q.owner || "") + "&node=" + encodeURIComponent(q.node || "") + "&service=" + encodeURIComponent(q.service || "") + "&fork=" + encodeURIComponent(q.fork || "")); },
  changelog(want) { return this.get("/api/changelog" + (want ? "?want=" + encodeURIComponent(want) : "")); },
  procClearNode(node) { return this.post("/api/node/proc-clear", { node }); },
  procClearHost() { return this.post("/api/host/proc-clear", {}); },
};

export const bus = { subs: new Set(), emit() { this.subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }, sub(f) { this.subs.add(f); return () => this.subs.delete(f); } };
export function useStore() { const [, set] = useState(0); useEffect(() => bus.sub(() => set(x => x + 1)), []); }

export const Store = {
  fleet: [], storeConfigs: false, env: {}, versions: {},
  roster: { version: 1, users: {}, peers: {} }, stats: {}, nodes: [], describe: {}, events: [],
  recon: { peers: [], users: [], orphans: [], nodeStatus: {} },
  sessionConfigs: {},
  configEpoch: 0,
  recentlyCreated: {},
  rotating: {},
  ifaceOp: {},
  ifaceNew: {},
  ifaceGone: {},
  ghostRekey: {},
  turnNew: {},
  pending: {},
  rowErrors: {},
  async init() {
    await this.poll();
    setInterval(() => { if (document.visibilityState !== "hidden") this.poll().catch(() => {}); }, 5000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.poll().catch(() => {}); });
  },
  _server: { roster: { version: 1, users: {}, peers: {} }, nodes: [] },
  async poll() {
    const [s, ev] = await Promise.all([api.state(), api.events().catch(() => null)]);
    const d = (s && s.data) || {};
    this._server = { roster: d.roster || { version: 1, users: {}, peers: {} }, nodes: d.nodes || [] };
    this.describe = d.describe || {};
    this.stats = d.snapshots || {};
    if (Number.isFinite(d.panel_now) && d.panel_now > 0) clock.skewMs = Date.now() - d.panel_now * 1000;
    trackInstance(d.instance, d.panel_now, d.nodes || []);
    this.storeMode = (d.store_configs === "off" || d.store_configs === false) ? "off" : "encrypted";
    this.exitKeyKeep = d.exit_key_keep || "";
    this.exitPskKeep = d.exit_psk_keep || "";
    this.exitPassKeep = d.exit_pass_keep || "";
    this.storeConfigs = this.storeMode !== "off";
    this.configsPlaintext = d.configs_plaintext || 0;
    this.panelSettings = d.panel_settings || this.panelSettings || {};
    this.subCert = d.sub_cert || {};
    this.panelServices = d.panel_services || {};
    this.sessionEphemeral = d.session_ephemeral || "";
    this.datapath = d.datapath || {};
    this.turnCatalog = d.turn_catalog || this.turnCatalog || null;
    this.turnHolds = d.turn_holds || this.turnHolds || {};
    this.csqttLines = d.csqtt_lines || this.csqttLines || [];
    this.panelPublicUrl = d.panel_public_url || this.panelPublicUrl || "";
    this.accessCooldown = d.access_cooldown || { secs: 0, reason: "" };
    hooks.forkColors && hooks.forkColors();
    hooks.themeColors && hooks.themeColors();
    this.smartCaps = d.smart_caps || this.smartCaps || {};
    this.catLabels = d.cat_labels || this.catLabels || {};
    this.catalogProviders = d.catalog_providers || this.catalogProviders || [];
    this.catalogGen = d.catalog_gen || "";
    this.catSizes = d.cat_sizes || this.catSizes || {};
    this.env = d.env || this.env || {};
    this.versions = d.versions || this.versions;
    this.tls = d.tls || this.tls || {};

    this.turnUpdates = d.turn_updates || this.turnUpdates || [];
    if (s && s.ok) { this.hostProc = d.host_proc || null; this.hostProcErr = d.host_proc_err || null; }
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
    this.fleet = this.nodes.map(n => ({ id: n.id, name: n.name, color: n.color, transport: "https" }));
    const retiring = new Set();
    for (const n of this.nodes) for (const pk of (n.retiring || [])) retiring.add(pk);
    const systemIfaces = new Set();
    for (const nid of Object.keys(this.describe || {}))
      for (const ifn of Object.keys(this.describe[nid] || {}))
        if (this.describe[nid][ifn] && this.describe[nid][ifn].system) systemIfaces.add(nid + "|" + ifn);
    const _adv = (this.panelSettings || {}).advanced || {};
    this._probSince = this._probSince || {};
    const _sc = (this.panelSettings || {}).status_conditions || {};
    const nodeSeen = {}; for (const n of (this.nodes || [])) if (n && n.last_seen != null) nodeSeen[n.id] = n.last_seen;
    this.recon = reconcile(this.roster, this.stats, panelNow(), { retiring, systemIfaces, nodeSeen, rotating: new Set(Object.keys(this.rotating)),
      probSince: this._probSince,
      ...(_adv.churn_gap_s ? { churnGapS: _adv.churn_gap_s } : {}), ...(_adv.churn_min ? { churnMin: _adv.churn_min } : {}),
      detectBlocked: _sc.blocked !== false, detectChurn: _sc.faulty !== false,
      expiryWarnDays: (this.panelSettings || {}).expiry_warn_days,
      ...(_adv.restore_grace_ms ? { restoreGraceMs: _adv.restore_grace_ms } : {}),
      ...(_adv.node_stale_ms ? { nodeStaleMs: _adv.node_stale_ms } : {}), ...(_adv.peer_grace_ms ? { graceMs: _adv.peer_grace_ms } : {}) });
    this._missIfSince = this._missIfSince || {};
    { const _now = Date.now(), _grace = _adv.restore_grace_ms || 120000, _seen = new Set();
      for (const n of (this.nodes || [])) { const mi = n.missing_ifaces || {}, gi = n.ghost_ifaces || {};
        for (const ifn of Object.keys(mi)) { const k = n.id + "|" + ifn; _seen.add(k);
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          mi[ifn].problemMs = _now - this._missIfSince[k];
          mi[ifn].ripe = mi[ifn].problemMs >= _grace; }
        for (const ifn of Object.keys(gi)) { const k = n.id + "|g|" + ifn; _seen.add(k);
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          gi[ifn].problemMs = _now - this._missIfSince[k];
          gi[ifn].ripe = gi[ifn].problemMs >= _grace; }
        const bi = n.broken_ifaces || {};
        for (const ifn of Object.keys(bi)) { const k = n.id + "|b|" + ifn; _seen.add(k);
          if (!this._missIfSince[k]) this._missIfSince[k] = _now;
          bi[ifn].problemMs = _now - this._missIfSince[k];
          bi[ifn].ripe = bi[ifn].problemMs >= _grace; } }
      for (const k of Object.keys(this._missIfSince)) if (!_seen.has(k)) delete this._missIfSince[k]; }
    for (const id of Object.keys(this.rotating)) {
      const pr = this.recon.peers.find(p => p.id === id);
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
    try { hooks.dashTick && hooks.dashTick(); } catch (_) {}
    bus.emit();
    hooks.alertServices && hooks.alertServices();
    try { hooks.rekeyGhosts && hooks.rekeyGhosts(); } catch (_) {}
  },
  node(id) { return this.fleet.find(n => n.id === id); },
  nodeName(id) { const n = this.node(id); return (n && n.name) || id; },
  nodeRank(id) { const i = this.fleet.findIndex(n => n.id === id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; },
  byNode(a, b) {
    return this.nodeRank(a) - this.nodeRank(b)
        || String(this.nodeName(a) || "").localeCompare(String(this.nodeName(b) || ""));
  },
  nodeColor(id) { const n = this.node(id); return pickThemed(n && n.color, NODE_COLOR_DEFAULT.dark, NODE_COLOR_DEFAULT.light); },
  ifacesOf(node) { return Object.keys(this.describe[node] || {}); },
  ifaceMeta(node, iface) { return (this.describe[node] || {})[iface] || null; },
  ifaceIsSystem(node, iface) {
    if (!iface) return false;
    const m = (this.describe[node] || {})[iface] || {};
    const pfx = (this.panelSettings || {}).reserved?.iface_prefix || "swg_";
    return !!m.system || String(iface).startsWith(pfx) || String(iface).startsWith("swg_");
  },
  userIfacesOf(node) {
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


const INST_KEY = "swg.panelInstances:" + url(""), INST_DISMISS = "swg.panelTwinsDismissed:" + url("");
const INST_MARGIN = 120;
const INST_RECENT = 30 * 60;
export function panelTwin(list, cur) {
  return (list || []).find(o => o && cur && o.id !== cur.id
    && cur.started + INST_MARGIN < o.last && o.started + INST_MARGIN < cur.last
    && cur.last - o.last < INST_RECENT) || null;
}
function trackInstance(inst, now, nodes) {
  if (!inst || !inst.id || !Number.isFinite(now)) return;
  let list = [];
  try { list = JSON.parse(localStorage.getItem(INST_KEY) || "[]"); } catch (_) {}
  if (!Array.isArray(list)) list = [];
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
