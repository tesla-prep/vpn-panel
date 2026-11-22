import { T, Tsplit, plural, locale, srvText } from "./i18n.js";   // locale: dates in the panel's language, not the browser's
import { tkey, seen, targetRole } from "./util.js";
import { Store, api, useStore } from "./store.js";
import { targetType, iTypeOf, ghostIface, ghostPeers, peerSubSources, subHidden, subHides, isSelfContainedTgt, awgDict3 } from "./model.js";
import { searchMatch, revealAssignedPeer } from "./views.js";
import { Ic, toast, mutate, openModal, pushModal, openConfirm, closeModal, closeAllModals, closeModals, Tag,
         Portal, useAnchoredList } from "./ui.js";
import {
  SubAutoNote, useSubRec, subFeatureOn, ensureVaultUnlocked, subPublishOrPrompt, genKeys, genPSK,
  buildConf, parseFullConf, getConfig, subSKCached, ivkResealForNode, subReconcileUser,
} from "./crypto.js";
import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

// The ghost recreate needs the Load-interface sheet, which lives a layer up (js/iface.js when it lands).
// app.js wires this at boot; until then the action simply does nothing rather than importing upward.
let _openLoadIface = () => {};
export const setLoadIfaceOpener = fn => { _openLoadIface = fn; };

export async function rotatePeerKeys(peer) {
  const key = "peer:" + peer.id;
  Store.rotating[peer.id] = Date.now();   // grid shows "rotating" until the new key is live
  let keys, psk, configs;
  try {
    keys = await genKeys(); psk = genPSK(); configs = {};   // rotate BOTH the keypair and the PSK
    for (const t of (peer.targets || []).filter(t => !isSelfContainedTgt(t))) {
      const m = Store.ifaceMeta(t.node, t.iface);
      if (!m) { delete Store.rotating[peer.id]; Store.rowErrors[key] = { msg: T("{v1} hasn't reported {v2} yet", { v1: Store.nodeName(t.node), v2: t.iface }), at: Date.now(), node: t.node, iface: t.iface }; Store.apply(); return { ok: false, error: Store.rowErrors[key].msg }; }
      const cur = await getConfig(peer.pubkey, t.node, t.iface);
      const s = cur ? parseFullConf(cur) : null;
      configs[tkey(t.node, t.iface)] = buildConf({ privkey: keys.priv, address: (t.ip || "").split("/")[0] + "/32",
        dns: s ? s.dns : m.dns, mtu: s ? s.mtu : 1280, awg_params: m.awg_params, server_pubkey: m.public_key,
        psk, endpoint: m.endpoint, allowed: s ? s.allowed : "0.0.0.0/0, ::/0", keepalive: s ? s.keepalive : 25 });
    }
  } catch (e) { delete Store.rotating[peer.id]; Store.rowErrors[key] = { msg: String(e.message || e), at: Date.now() }; Store.apply(); return { ok: false, error: Store.rowErrors[key].msg }; }
  let published = null;
  const r = await mutate({
    key,
    call: () => api.peerRekey({ peer_id: peer.id, user_id: peer.user_id, pubkey: keys.pub, psk }),   // no plaintext to the server
    onOk: () => { delete Store.sessionConfigs[peer.pubkey]; Store.sessionConfigs[keys.pub] = configs; Store.configEpoch++;
      published = subPublishOrPrompt(peer.user_id, peer.id, keys.priv, psk); },
  });
  return { ...r, published };
}

// Rotate EVERY key a user holds — each WG/AWG peer gets a fresh keypair + PSK (rotatePeerKeys), each WDTT peer a
// fresh WRAP password (wdttPeerRotate). All old configs/links die → every device must re-import. Confirmed once.
export function rotateAllUserKeys(user, after) {
  const peers = Store.peersOfUser(user.id);
  if (!peers.length) { toast(T("This user has no peers to rotate."), "err"); return; }
  // The count is bold and mid-sentence, so the sentence is translated whole and split on its own marker —
  // Russian puts the owner before the count, and two concatenated fragments could not express that.
  const [rotBefore, rotAfter] = Tsplit("Rotate the keys for all {what} of {name}. Every existing config, QR and link stops working — each device must re-import. This can't be undone.",
    "what", { name: user.name });
  openConfirm({ title: T("Rotate all keys · {name}", { name: user.name }), confirmLabel: T("Rotate all keys"), warn: true, back: after,
    body: html`${rotBefore}<b>${plural(peers.length, "peer")}</b>${rotAfter}`,
    onConfirm: () => {
      peers.forEach(p => { Store.rotating[p.id] = Date.now(); });
      Store.apply();
      (async () => {
        const oks = await Promise.all(peers.map(async p => {
          try {
            let did = false;
            if (p.csqtt_password) { await api.csqttPeerRotate({ peer_id: p.id }); did = true; }   // new access password
            if (p.wdtt_password)  { await api.wdttPeerRotate({ peer_id: p.id });  did = true; }   // new WRAP password
            // LAST: this one changes the pubkey, and the two above address the peer by id, so order is safe.
            if ((p.targets || []).some(t => !isSelfContainedTgt(t))) { await rotatePeerKeys(p); did = true; }
            if (!did) delete Store.rotating[p.id];     // nothing to rotate → don't leave the row spinning
            return did;
          } catch (_) { return false; }
        }));
        const n = oks.filter(Boolean).length;
        await Store.poll();
        toast(T("Rotated keys for {count} — every device must re-import.", { count: plural(n, "peer") }), n ? "ok" : "err");
      })();
    } });
}

export function rotateParts(peer) {
  const p = (peer && peer.id && Store.peer(peer.id)) || peer || {};
  const kinds = (p.targets || []).map(t => targetType(t));
  const hasCsqtt = !!p.csqtt_password || kinds.includes("csqtt"), hasWdtt = !!p.wdtt_password || kinds.includes("wdtt");
  const hasKeyed = (p.targets || []).some(t => !isSelfContainedTgt(t));
  const mixed = hasKeyed && (hasCsqtt || hasWdtt);
  return { p, hasCsqtt, hasWdtt, hasKeyed, mixed, none: !hasKeyed && !hasCsqtt && !hasWdtt,
    title: mixed ? T("Rotate credentials") : !hasKeyed ? T("Rotate link") : T("Rotate keys") };
}
export const rotateOneLabel = peer => rotateParts(peer).title;
export function rotateOnePeerKeys(peer) {
  const { p, hasCsqtt, hasWdtt, hasKeyed, mixed, none, title } = rotateParts(peer);
  if (none) return toast(T("This peer has nothing to rotate."), "err");   // F67: never "rotated" with no call made
  const body = mixed ? T("This peer holds several credentials — a WireGuard keypair and an access password per turn server. All of them are replaced: every config, QR and link this peer already handed out stops working and must be re-imported.")
    : !hasKeyed ? (hasCsqtt ? T("A fresh access password is generated. The current csqtt link stops working — send the user their new link (from the subscription page) to re-import.")
                            : T("A fresh access password is generated. The current WDTT link stops working — send the user their new link (from the subscription page) to re-import."))
    : T("A fresh keypair and preshared key are generated. The current config stops working — you'll need to send out the fresh QR / config to re-import. Useful if a config may have leaked.");
  openConfirm({ title, confirmLabel: title, warn: true, body,
    onConfirm: () => {
      Store.rotating[p.id] = Date.now(); Store.apply();
      (async () => {
        const done = [], why = [];
        const step = async (name, call) => {
          let r; try { r = await call(); } catch (_) { r = null; }
          if (r && r.ok) done.push(name); else why.push((srvText(r) || T("Rotate failed.")).replace(/[.\s]+$/, ""));
          return r;
        };
        if (hasCsqtt) await step(T("the csqtt link"), () => api.csqttPeerRotate({ peer_id: p.id }));
        if (hasWdtt) await step(T("the WDTT link"), () => api.wdttPeerRotate({ peer_id: p.id }));
        const kr = hasKeyed ? await step(T("the keypair"), () => rotatePeerKeys(p)) : null;   // LAST: this changes the pubkey, and the two above address by id
        if (!(kr && kr.ok)) delete Store.rotating[p.id];
        if (kr && kr.published) kr.published.then(e => { if (e) toast(T("The keypair was replaced, but {why}. Its new QR is only in this tab until you reload — show it to the user from here.", { why: e.replace(/[.\s]+$/, "") }), "err", 9000); }, () => {});
        await Store.poll();
        if (why.length) return toast(done.length ? T("Not everything was rotated: {why}. Already replaced: {done} — send the user the new one.", { why: why.join("; "), done: done.join(", ") }) : why.join("; ") + ".", "err");
        toast(mixed ? T("Credentials rotated — send the user their new QR and links; the old ones no longer work.")
          : !hasKeyed ? T("Link rotated — the old one no longer works.")
          : T("Keys rotated — send the user the new QR / config; the old one no longer works."), "ok");
      })();
    } });
}

// A device that carries networks takes them down with it, and nothing on the side of the people who used them says why — so
// every confirm that cuts one off names what goes (docs/NETWORKS-PLAN.md §18).
function _netsLost(peer, block) {
  const p = (peer && peer.id && Store.peer(peer.id)) || peer || {};
  const nets = p.routes || [];
  if (!nets.length) return "";
  const v = { device: p.title || p.name || T("This device"), nets: nets.join(", ") };
  return " " + (block ? T("{device} carries {nets} — everyone who reaches them through it loses access until it's unblocked.", v)
    : T("{device} carries {nets} — everyone who reaches them through it loses access.", v));
}
function _userNetsLost(user) {
  const gws = Store.peersOfUser(user.id).filter(p => (p.routes || []).length);
  return gws.length ? " " + T("Their devices that carry networks ({devices}) take them down too — everyone who reaches them through those devices loses access until the user is unblocked.",
    { devices: gws.map(p => p.title || T("Untitled")).join(", ") }) : "";
}

// Confirmed unassign — revokes the holder (PSK rotates) and is irreversible (keys change).
// `back` = where Cancel returns to (e.g. the peer view it was launched from).
export function confirmUnassign(peer, back) {
  openConfirm({ title: peer.name ? T("Unassign peer · {name}", { name: peer.name }) : T("Unassign peer"), confirmLabel: T("Unassign"), danger: true, back,
    body: T("This revokes access immediately and is irreversible — the keys change, so re-assigning later means sending the user a brand-new QR / config to import.") + _netsLost(peer),
    onConfirm: () => mutate({ key: "peer:" + peer.id,
      patch: s => { const p = s.roster.peers[peer.id]; if (p) p.user_id = null; },
      call: () => api.peerUnassign({ peer_id: peer.id }),
      onOk: () => { delete Store.sessionConfigs[peer.pubkey]; Store.configEpoch++; } }) });
}
// Confirmed delete (unassigned peers only). `back` = Cancel target.
export function confirmDeletePeer(peer, back, closeOwner) {
  openConfirm({ title: T("Delete peer"), confirmLabel: T("Delete"), danger: true, back,
    body: T("This is irreversible — the peer's key is removed from every interface it's deployed on.") + _netsLost(peer),
    onConfirm: () => { if (closeOwner) closeModals(2);
      return mutate({ key: "peer:" + peer.id, patch: s => { delete s.roster.peers[peer.id]; },
        call: () => api.peerDelete({ peer_id: peer.id }) }); } });
}

function _durText(ms) { const m = Math.max(1, Math.floor((ms || 0) / 60000)); return T("more than {count}", { count: plural(m, "minute") }); }
function _missingIface(node, iface) {
  const nr = (Store.nodes || []).find(n => n.id === node) || {};
  // {subnet, listen_port, mtu, address, awg_params, endpoint_host, dns, keepalive, public_key, key_source}
  // | null — `dns`/`keepalive` are null when the panel holds no opinion, and [] / 0 when it holds "off".
  return (nr.missing_ifaces || {})[iface] || null;
}
function _openRestoreInterface({ node, iface, mi, problemMs, rowKey, back, broken }) {
  if (!broken && ghostIface(node, iface)) return openRecreateRekey(node, iface, back);   // lost + keyless → can't restore, redirect to recreate + rekey
  const where = Store.nodeName(node) + " · " + iface;
  const gate = broken
    ? T("This isn't a brief bounce — the interface has been down on the node for {dur}.", { dur: _durText(problemMs) })
    : T("This isn't a brief hiccup or a peer still being created — the interface has stayed missing for {dur}.", { dur: _durText(problemMs) });
  const clean = !!(mi && mi.key_source);                 // "backup" | "vault" → original key recoverable
  const vault = !!(mi && mi.key_source === "vault");     // key gone from the node → recover from the operator vault (full wipe)
  const src = vault ? T("the operator vault") : T("the node's own backup");
  const lockedVault = vault && !subSKCached();
  const vars = { iface, node: Store.nodeName(node), src, gate };
  const body = !mi
    ? T("The panel has no saved configuration for interface {iface} on {node} yet, so it can't be recreated automatically. {gate}", vars)
    : broken
      ? (clean
        ? T("Rebuild the down interface {iface} on {node} with its ORIGINAL server key (from {src}) and saved settings. The device is gone from the node, so there is nothing left to restart — this recreates it. Every peer on {iface} re-converges over the next few syncs and existing clients keep working (no new QR / config to distribute). {unlock}{gate}",
            { ...vars, unlock: lockedVault ? T("You'll be asked to unlock the vault first to release the escrowed key. ") : "" })
        : T("Rebuild the down interface {iface} on {node} with its saved settings. The device is gone from the node, so there is nothing left to restart. Its original server key can't be recovered, so the interface comes back with a NEW key — every client on {iface} must re-import a fresh QR / config. {gate}", vars))
    : clean
      ? T("Recreate the missing interface {iface} on {node} with its ORIGINAL server key (from {src}) and saved settings. This restores the INTERFACE, not a single peer — every peer that lives on {iface} re-converges over the next few syncs, and existing clients keep working (no new QR / config to distribute). {unlock}{gate}",
          { ...vars, unlock: lockedVault ? T("You'll be asked to unlock the vault first to release the escrowed key. ") : "" })
      : T("Recreate the missing interface {iface} on {node} with its saved settings. This restores the INTERFACE, not a single peer. The original server key can't be recovered, so the interface gets a NEW key — every client on {iface} must re-import a fresh QR / config. {gate}", vars);
  openConfirm({ title: (broken ? T("Rebuild interface · {where}", { where }) : T("Restore interface · {where}", { where })),
    confirmLabel: mi ? (broken ? T("Rebuild interface") : T("Restore interface")) : T("Close"), danger: !!mi && !clean, back, body,
    note: (mi && clean) ? html`<${SubAutoNote}/>` : null,
    onConfirm: mi ? (async () => {
      let sealed = null;
      try { sealed = await ivkResealForNode(node, mi); }   // vault key → unseal + re-seal to the node (null for a backup/new-key restore)
      catch (e) { toast(T("Vault restore failed: {err}", { err: (e && e.message) || e }), "err", 5000); return; }
      await mutate({ key: rowKey, call: () => api.ifaceRecreate({ node, iface, ...(sealed ? { sealed_key: sealed } : {}) }),
        onOk: () => toast(T("Restoring interface {iface} on {node} — its peers re-converge over the next syncs.", { iface, node: Store.nodeName(node) }), "ok") });
    }) : null });
}
export function confirmRestoreDeployment(peer, t, back) {
  _openRestoreInterface({ node: t.node, iface: t.iface, mi: _missingIface(t.node, t.iface), problemMs: t.problemMs, rowKey: "peer:" + peer.id, back });
}
export function confirmRestoreInterface(node, iface, mi, back) {
  _openRestoreInterface({ node, iface, mi, problemMs: (mi && mi.problemMs) || 0, rowKey: "iface:" + node + "|" + iface, back });
}
export function confirmRebuildInterface(node, iface, bi, back) {
  _openRestoreInterface({ node, iface, mi: bi, problemMs: (bi && bi.problemMs) || 0, broken: true,
                          rowKey: "iface:" + node + "|" + iface, back });
}
export function brokenIface(node, iface) {
  const nr = (Store.nodes || []).find(n => n.id === node) || {};
  const b = (nr.broken_ifaces || {})[iface];
  return (b && b.repair === "recreate") ? b : null;   // repair:"" = no saved config, nothing to rebuild from
}

// GHOST interface: lost + KEYLESS — recreate FRESH + rekey every peer
function _subnet24(ip) { const m = String(ip || "").match(/^(\d+)\.(\d+)\.(\d+)\.\d+/); return m ? m[1] + "." + m[2] + "." + m[3] + ".0/24" : ""; }
export function openRecreateRekey(node, iface, back) {
  const g = ghostIface(node, iface) || {};
  const peers = ghostPeers(node, iface);
  let proto = "wg"; const ips = [];
  peers.forEach(p => (p.targets || []).forEach(t => { if (t.node === node && t.iface === iface) { if (t.type === "awg") proto = "awg"; if (t.ip) ips.push(t.ip); } }));
  if (g.awg_params && Object.keys(g.awg_params).length) proto = "awg";
  const nr = (Store.nodes || []).find(n => n.id === node) || {};
  const pre = { iface, proto, subnet: g.subnet || _subnet24(ips[0]),
                endpoint: g.endpoint_host || (nr.ips || [])[0] || "",
                port: g.listen_port || 0, mtu: g.mtu || 0,
                // `null` = the panel holds no opinion, so the sheet may use the fleet default. An empty
                // LIST is an opinion ("no DNS line") and must reach the sheet as an empty field.
                dns: Array.isArray(g.dns) ? g.dns.join(", ") : null,
                keepalive: typeof g.keepalive === "number" ? g.keepalive : null,
                // the device-access level, for the same reason: the sheet posts one unconditionally and create writes it
                // onto the warm record, so an unseeded level resets a chosen Everyone or Nobody (DEVICE-ACCESS §11.2 F1)
                reach: g.reach || null,
                // …and the AmneziaWG version it had, so a Settings preset of 3.1 cannot turn a 2.0 interface into a 3.1 one
                gen: proto === "awg" ? (awgDict3(g.awg_params) ? "3.1" : "2.0") : null };
  const rekeyable = peers.filter(p => p.user_id).map(p => p.id);   // only ASSIGNED peers can be rekeyed (rekey needs a holder)
  _openLoadIface({ node, pre, ghost: { node, iface, peers: rekeyable, total: peers.length, warm: g.cold === false }, back });
}

export function maybeRekeyGhosts() {
  const staged = Store.ghostRekey || {};
  for (const gk of Object.keys(staged)) {
    const rec = staged[gk]; const bar = gk.indexOf("|"); const node = gk.slice(0, bar), iface = gk.slice(bar + 1);
    if (Date.now() - (rec.at || 0) > 900000) { delete staged[gk]; continue; }   // give up after 15min
    const m = Store.ifaceMeta(node, iface);
    if (!m || !m.public_key) continue;                                          // fresh interface not live yet → wait
    delete staged[gk];                                                          // clear BEFORE rekeying so we never double-fire
    if (m.drift && m.drift.public_key) api.ifaceAdopt({ node, iface, key: "public_key" }).catch(() => {});
    const peers = (rec.peers || []).map(id => (Store.recon.peers || []).find(p => p.id === id)).filter(p => p && p.user_id);
    peers.forEach(p => { rotatePeerKeys(p).catch(() => {}); });
    if (peers.length) toast(T("Interface {iface} is back — rekeying {count}; hand out the fresh configs.", { iface, count: plural(peers.length, "peer") }), "ok", 5000);
  }
}
export function confirmRestoreAllInterfaces(nid, back) {
  const nr = (Store.nodes || []).find(n => n.id === nid) || {};
  const miss = Object.entries(nr.missing_ifaces || {}).filter(([, mi]) => mi && mi.ripe);
  if (!miss.length) { toast(T("No interfaces to restore yet — a missing interface must persist a couple of minutes first."), "info"); return; }
  const anyVault = miss.some(([, mi]) => mi.key_source === "vault");
  const newKey = miss.filter(([, mi]) => !mi.key_source).length;
  // "N have no recoverable key" needs subject-verb agreement English can only get from two sentences, so it
  // IS two keys picked by the count — plural() alone would produce "1 interface have".
  const newKeyNote = !newKey ? T(" Existing clients keep working — no re-distribution.")
    : newKey === 1 ? T(" One has no recoverable key, so it gets a new one and those clients must re-import.")
    : T(" {n} have no recoverable key, so they get a new one and those clients must re-import.", { n: newKey });
  openConfirm({ title: T("Restore {count} · {node}", { count: plural(miss.length, "interface"), node: Store.nodeName(nid) }),
    confirmLabel: T("Restore {n}", { n: miss.length }), danger: newKey > 0, back,
    body: T("Recreate {count} missing on {node} with their saved settings and, where recoverable, their ORIGINAL server keys — every peer re-converges.{vault}{newkey} This is the node-rebuild recovery: after re-installing the box, one press brings its interfaces back.",
      { count: plural(miss.length, "interface"), node: Store.nodeName(nid),
        vault: anyVault ? T(" You'll unlock the vault once to release the escrowed keys.") : "", newkey: newKeyNote }),
    note: html`<ul class="restore-list">${miss.map(([ifn, mi]) => html`<li>${ifn}${!mi.key_source ? html` <span class="rl-new">${T("new key")}</span>` : mi.key_source === "vault" ? html` <span class="faint">${T("(from vault)")}</span>` : null}</li>`)}</ul>`,
    onConfirm: async () => {
      let ok = 0, failed = 0;
      for (const [ifn, mi] of miss) {
        let sealed = null;
        try { sealed = await ivkResealForNode(nid, mi); }
        catch (e) { failed++; toast(T("{iface}: {err}", { iface: ifn, err: (e && e.message) || e }), "err", 5000); continue; }
        const r = await mutate({ key: "iface:" + nid + "|" + ifn, call: () => api.ifaceRecreate({ node: nid, iface: ifn, ...(sealed ? { sealed_key: sealed } : {}) }) });
        if (r && r.ok) ok++; else failed++;
      }
      toast(T("Restoring {count} on {node}{failed} — peers re-converge over the next syncs.",
        { count: plural(ok, "interface"), node: Store.nodeName(nid), failed: failed ? T(" ({n} failed)", { n: failed }) : "" }), failed ? "info" : "ok");
    } });
}

export function confirmCorrectDeployment(peer, t, back) {
  const who = peer.title || peer.name || T("kind|peer");
  const where = Store.nodeName(t.node) + " · " + t.iface;
  const gate = T("This isn't a transient state — the address has stayed out of range for {dur}.", { dur: _durText(t.problemMs) });
  openConfirm({ title: T("Fix {who} · {where}", { who, where }), confirmLabel: T("Fix address"), back,
    body: T("This peer's address {ip} is outside {iface}'s subnet on {node}, so the node can't add it. Fix reassigns the peer the LOWEST free address in {iface}'s subnet — the next one not already taken by another peer on that interface — then the node re-converges. If this peer runs on {iface} across several nodes, they all move to the one new address. Keys and PSK stay the same. {gate}",
      { ip: t.ip || "—", iface: t.iface, node: Store.nodeName(t.node), gate }),
    note: html`<${SubAutoNote}/>`,
    onConfirm: () => mutate({ key: "peer:" + peer.id, call: () => api.peerCorrect({ peer_id: peer.id, target: { node: t.node, iface: t.iface } }),
      onOk: r => toast(T("Address fixed{to}.", { to: (r && r.data && r.data.ip) ? " → " + r.data.ip : "" }), "ok") }) });
}

export const now_s = () => Math.floor(Date.now() / 1000);
const _peerName = p => p.title ? " · " + p.title : p.name ? " · " + p.name : "";
export function confirmBlockPeer(peer, back) {
  openConfirm({ title: T("Block access") + _peerName(peer), confirmLabel: T("Block"), danger: true, back,
    body: T("This removes the peer from every server it's deployed on, cutting its connection within a sync. The keys are unchanged, so unblocking later restores the same config — no new QR needed.") + _netsLost(peer, true),
    onConfirm: () => mutate({ key: "peer:" + peer.id,
      patch: s => { const p = s.roster.peers[peer.id]; if (p) p.disabled = true; },
      call: () => api.peerBlock({ peer_id: peer.id }) }) });
}
export function confirmUnblockPeer(peer, back) {
  openConfirm({ title: T("Unblock access") + _peerName(peer), confirmLabel: T("Unblock"), back,
    body: T("This restores the peer on every server it's deployed on. It reconnects with its existing keys once the servers converge."),
    onConfirm: () => mutate({ key: "peer:" + peer.id,
      patch: s => { const p = s.roster.peers[peer.id]; if (p) { delete p.disabled; p.unblock_at = now_s(); } },
      call: () => api.peerUnblock({ peer_id: peer.id }) }) });
}
export function confirmBlockUser(user, back) {
  openConfirm({ title: T("Block access · {name}", { name: user.name || T("kind|user") }), confirmLabel: T("Block"), danger: true, back,
    body: T("This blocks every peer of this user and, if they have a subscription, disables its page — the link still resolves but shows “Subscription disabled”. Nothing is deleted: unblocking restores connectivity and the same subscription URL.") + _userNetsLost(user),
    onConfirm: () => mutate({ key: "user:" + user.id,
      patch: s => { const u = s.roster.users[user.id]; if (u) u.disabled = true; },
      call: () => api.userBlock({ user_id: user.id }) }) });
}
export function confirmUnblockUser(user, back) {
  openConfirm({ title: T("Unblock access · {name}", { name: user.name || T("kind|user") }), confirmLabel: T("Unblock"), back,
    body: T("This restores every peer and re-enables the subscription page. Connections come back once the servers converge."),
    onConfirm: () => mutate({ key: "user:" + user.id,
      patch: s => { const u = s.roster.users[user.id]; if (u) { delete u.disabled; u.unblock_at = now_s(); } },
      call: () => api.userUnblock({ user_id: user.id }) }) });
}
export function peerBlockBtn(_peer, back) {
  const peer = (_peer && _peer.id && Store.peer(_peer.id)) || _peer;
  if (peer.userDisabled && !peer.selfDisabled)
    return html`<button class="btn btn-danger" disabled title=${T("Blocked because the user is blocked — unblock the user")}><${Ic} i="off"/> ${T("status|Blocked")}</button>`;
  return peer.selfDisabled
    ? html`<button class="btn btn-ghost m-pblock" onClick=${() => confirmUnblockPeer(peer, back)}><${Ic} i="refresh"/> ${T("Unblock")}</button>`
    : html`<button class="btn btn-danger" onClick=${() => confirmBlockPeer(peer, back)}><${Ic} i="off"/> ${T("Block")}</button>`;
}
export function userBlockBtn(_user, back) {
  const user = (_user && _user.id && Store.user(_user.id)) || _user;   // live, for the reason above
  return user.disabled
    ? html`<button class="btn btn-ok" onClick=${() => confirmUnblockUser(user, back)}><${Ic} i="refresh"/> ${T("Unblock")}</button>`
    : html`<button class="btn btn-danger" onClick=${() => confirmBlockUser(user, back)}><${Ic} i="off"/> ${T("Block")}</button>`;
}

// What a peer publishes to its subscription
export function pubState(peer, src) {
  peer = (peer && Store.peer(peer.id)) || peer;          // sheets hold a snapshot from open; read the live one
  const hidden = subHides(peer, src);
  const only = !hidden && peerSubSources(peer).filter(s => !subHides(peer, s)).length <= 1;
  return {
    hidden, only,
    title: only ? T("This is the last kind of config this peer publishes — a subscription can't be empty.")
      : hidden ? T("Hidden from the subscription — click to publish it again")
      : T("Published to the subscription — click to hide it"),
    flip: () => {
      if (only) { toast(T("A peer has to publish at least one kind of config — keep one selected."), "err", 4000); return; }
      const next = hidden ? subHidden(peer).filter(s => s !== src) : subHidden(peer).concat([src]);
      const showing = hidden;                            // what it becomes, not what it was
      mutate({
        key: "subhide:" + peer.id + ":" + src,
        patch: st => { const p2 = st.roster.peers[peer.id]; if (p2) p2.sub_hide = next; },
        call: () => api.peerUpdate({ peer_id: peer.id, sub_hide: next }),
        onOk: () => toast(showing
          ? T("{v1} configs are published again — saved.", { v1: String(src).toUpperCase() })
          : T("{v1} configs hidden from the subscription — saved.", { v1: String(src).toUpperCase() }), "ok"),
      });
    },
  };
}
// Classes shared by every publish switch, whatever it renders inside.
export const pubCls = (st, extra) => "pubtg" + (st.hidden ? " off" : "") + (st.only ? " lone" : "") + (extra ? " " + extra : "");

export function PubTag({ peer, src, label, kind, dim, gen3 }) {   // gen3: an AWG deployment on an AmneziaWG 3.1 interface wears its colour
  useStore();                                            // the flag lives in the roster — re-render when a poll lands
  const st = pubState(peer, src);
  return html`<button type="button" class=${"tg tg-" + (kind || src) + (gen3 ? " awg3" : "") + " " + pubCls(st, dim ? "dim" : "")}
    title=${st.title} aria-pressed=${!st.hidden} onClick=${e => { e.preventDefault(); e.stopPropagation(); st.flip(); }}>${label}${st.hidden ? html`<${Ic} i="off"/>` : null}</button>`;
}

export const DAY_S = 86400;
export const expiryWarnDays = () => { const d = +((Store.panelSettings || {}).expiry_warn_days); return (d >= 0 && d <= 365) ? d : 3; };
export function fmtDate(sec) { if (!sec) return ""; try { return new Date(sec * 1000).toLocaleDateString(locale(), { year: "numeric", month: "short", day: "numeric" }); } catch (_) { return ""; } }
export function expiryInputVal(sec) { if (!sec) return ""; const d = new Date(sec * 1000); if (isNaN(d.getTime())) return ""; const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
export function expiryFromInput(str) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || "").trim()); if (!m) return 0; const d = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59); const s = Math.floor(d.getTime() / 1000); return s > 0 ? s : 0; }
export function subState(user) {
  const now = now_s(), u = user || {}, exp = +(u.expiry || 0);
  if (u.disabled) return { cls: "s-blocked", text: T("Subscription was blocked") + (u.disabledAt ? " " + fmtDate(u.disabledAt) : "") };
  if (exp && now >= exp) return { cls: "s-expired", text: T("Subscription expired on {v1}", { v1: fmtDate(exp) })};
  if (exp && now >= exp - expiryWarnDays() * DAY_S) return { cls: "s-expiring", text: T("Subscription is about to expire on {v1}", { v1: fmtDate(exp) })};
  return { cls: "s-active", text: exp ? T("Subscription is active until {v1}", { v1: fmtDate(exp) }) : T("Subscription is active") };
}
export function peerState(peer) {
  const now = now_s(), p = peer || {}, exp = +(p.ownExpiry || 0);
  if (p.selfDisabled) return { cls: "s-blocked", text: T("Peer was blocked") + (p.disabledAt ? " " + fmtDate(p.disabledAt) : "") };
  if (exp && now >= exp) return { cls: "s-expired", text: T("Peer expired on {v1}", { v1: fmtDate(exp) })};
  if (exp && now >= exp - expiryWarnDays() * DAY_S) return { cls: "s-expiring", text: T("Peer is about to expire on {v1}", { v1: fmtDate(exp) })};
  if (exp) return { cls: "s-active", text: T("Peer is active until {v1}", { v1: fmtDate(exp) })};
  return null;
}
// pos: "hd" = centred in a modal title row · "center" = its own centred line (edit-user card) · "bar" = a right-
// aligned line UNDER the header (peer modal / edit-peer). Absent = a plain inline span.
const _statCls = pos => pos ? " substat-" + pos : "";   // i18n-keys: a CSS class fragment
export function userState(user) {
  const now = now_s(), u = user || {}, exp = +(u.expiry || 0);
  if (u.disabled) return { cls: "s-blocked", text: T("User was blocked") + (u.disabledAt ? " " + fmtDate(u.disabledAt) : "") };
  if (exp && now >= exp) return { cls: "s-expired", text: T("User expired on {v1}", { v1: fmtDate(exp) })};
  if (exp && now >= exp - expiryWarnDays() * DAY_S) return { cls: "s-expiring", text: T("User is about to expire on {v1}", { v1: fmtDate(exp) })};
  return null;
}
export function SubStatusLine({ user, pos }) {
  useStore();
  const rec = useSubRec(user.id);   // the subscription record — .enabled tells a live subscription from a disabled/never-enabled one
  if (!subFeatureOn()) return null;
  const u = (Store.recon.users || []).find(x => x.id === user.id) || user;
  const st = (rec && rec.enabled) ? subState(u) : userState(u);
  if (!st) return null;
  return html`<span class=${"substat " + st.cls + _statCls(pos)}>${st.text}</span>`;
}
// The peer's own lifecycle sentence (null when there's nothing to say — active with no expiry). Independent of the
// subscription feature — a peer's block/expiry applies either way.
export function PeerStatusLine({ peer, pos }) {
  useStore();
  const rp = (Store.recon.peers || []).find(p => p.id === peer.id) || peer;
  const st = peerState(rp);
  if (!st) return null;
  return html`<span class=${"substat " + st.cls + _statCls(pos)}>${st.text}</span>`;
}

// ── assigning a peer to a user, and marking a deployment PRIMARY ───────────────────────────────
export function UserCombo({ onPick, placeholder }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const users = Store.recon.users.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const ql = q.toLowerCase();
  const shown = users.filter(u => searchMatch(u.name + " " + (u.tag || ""), ql)).slice(0, 8);
  const { wrapRef, listRef, pos, popStyle } = useAnchoredList(open, setOpen, [q]);
  const pick = uid => { setOpen(false); setQ(""); onPick(uid); };
  return html`<div class="usercombo" ref=${wrapRef}>
    <input class="uc-input" value=${q} placeholder=${placeholder || T("Assign to…")} onClick=${() => setOpen(true)}
      onInput=${e => { setQ(e.target.value); setOpen(true); }}
      onKeyDown=${e => { if (e.key === "Enter" && shown.length === 1) { e.preventDefault(); pick(shown[0].id); } else if (e.key === "Escape") setOpen(false); }}/>
    ${open && pos ? html`<${Portal}><div class="uc-list uc-pop" ref=${listRef} style=${popStyle}>${shown.length ? shown.map(u => html`<button class="uc-opt" key=${u.id}
      onClick=${() => pick(u.id)}><span>${u.name}</span>${u.tag ? html`<span class="tagchip">${u.tag}</span>` : null}</button>`)
      : html`<div class="uc-empty">${users.length ? T("no match") : T("no users yet")}</div>`}</div><//>` : null}
  </div>`;
}

export function ucKeyStep(key, { open, q, act, opts, n }) {
  if (key === "Escape") return { close: true };
  if (key === "ArrowDown") return { open: true, act: Math.min(act + 1, opts.length - 1), prevent: true };
  if (key === "ArrowUp") return { act: Math.max(act - 1, -1), prevent: true };
  if (key !== "Enter" || !open) return {};
  if (act >= 0 && act < opts.length) return { pick: opts[act], prevent: true };
  if (q && n === 1) return { pick: opts.find(o => o[1] !== "" || o[0] !== "u"), prevent: true };
  return { prevent: !!q };
}

export function UserPicker({ value, onChange, allowUnassigned, placeholder, exclude, groups, onGroup, devices, onDevice }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const [act, setAct] = useState(-1);
  const users = Store.recon.users.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const sel = users.find(u => u.id === value);
  const selText = sel ? sel.name + (sel.tag ? " · " + sel.tag : "") : "";
  const ql = q.toLowerCase();
  const skip = exclude ? new Set(exclude) : null;
  const pool = skip ? users.filter(u => !skip.has(u.id)) : users;
  const named = {}; users.forEach(u => { named[u.name] = (named[u.name] || 0) + 1; });
  const shown = pool.filter(u => searchMatch(u.name + " " + (u.tag || ""), ql)).slice(0, 8);
  const gshown = groups ? groups.filter(g => searchMatch(g.name, ql)).slice(0, 4) : [];
  const dshown = devices ? devices.filter(d => searchMatch(d.name + " " + (d.sub || ""), ql)).slice(0, 6) : [];
  const { wrapRef, listRef, pos, popStyle } = useAnchoredList(open, setOpen, [q]);
  const pick = uid => { setOpen(false); setQ(""); setAct(-1); onChange(uid); };
  const pickGroup = gid => { setOpen(false); setQ(""); setAct(-1); onGroup(gid); };
  const pickDevice = pid => { setOpen(false); setQ(""); setAct(-1); onDevice(pid); };
  // the rows in the order they are drawn — what the arrow keys walk
  const opts = [...(allowUnassigned ? [["u", ""]] : []), ...gshown.map(g => ["g", g.id]), ...shown.map(u => ["u", u.id]), ...dshown.map(d => ["d", d.id])];
  const at = act < opts.length ? act : -1;
  const isAct = (kind, id) => at >= 0 && opts[at][0] === kind && opts[at][1] === id;
  const onKey = e => {
    const r = ucKeyStep(e.key, { open, q, act: at, opts, n: gshown.length + shown.length + dshown.length });
    if (r.prevent) e.preventDefault();
    if (r.close) { setOpen(false); setAct(-1); return; }
    if (r.open && !open) { setOpen(true); setQ(""); }
    if (r.act !== undefined) setAct(r.act);
    if (r.pick) { const [k, id] = r.pick; if (k === "g") pickGroup(id); else if (k === "d") pickDevice(id); else pick(id); }
  };
  useEffect(() => {                                       // keep the highlighted row in view as the keys walk a long list
    const el = at >= 0 && listRef.current && listRef.current.querySelector(".uc-opt.act");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [at]);
  return html`<div class="usercombo" ref=${wrapRef}>
    <input class="uc-input" value=${open ? q : selText} data-enter=${open ? "self" : null}
      placeholder=${placeholder || (allowUnassigned ? T("— unassigned —") : T("Assign to a user…"))}
      onClick=${() => { setOpen(true); setQ(""); setAct(-1); }} onInput=${e => { setQ(e.target.value); setOpen(true); setAct(-1); }}
      onKeyDown=${onKey}/>
    ${open && pos ? html`<${Portal}><div class="uc-list uc-pop" ref=${listRef} style=${popStyle}>
      ${allowUnassigned ? html`<button class=${"uc-opt" + (isAct("u", "") ? " act" : "")} onClick=${() => pick("")}><span class="faint">${T("— unassigned —")}</span></button>` : null}
      ${gshown.map(g => html`<button class=${"uc-opt uc-group" + (isAct("g", g.id) ? " act" : "")} key=${"g:" + g.id} onClick=${() => pickGroup(g.id)}><${Ic} i="users"/><span>${g.name}</span><span class="faint">${plural(g.users.length, "member")}</span></button>`)}
      ${shown.length || gshown.length || dshown.length ? shown.map(u => html`<button class=${"uc-opt" + (isAct("u", u.id) ? " act" : "")} key=${u.id} onClick=${() => pick(u.id)}><span>${u.name}</span>${u.tag ? html`<span class="tagchip">${u.tag}</span>`
          : named[u.name] > 1 ? html`<span class="faint">${u.created_at
            ? T("{devices}, added {date}", { devices: plural(Store.peersOfUser(u.id).length, "device"), date: fmtDate(u.created_at) })
            : plural(Store.peersOfUser(u.id).length, "device")}</span>` : null}</button>`)
        : html`<div class="uc-empty">${pool.length || (groups || []).length || (devices || []).length ? T("no match") : users.length ? T("everyone is already added") : T("no users yet")}</div>`}
      ${dshown.map(d => html`<button class=${"uc-opt uc-group" + (isAct("d", d.id) ? " act" : "")} key=${"d:" + d.id} onClick=${() => pickDevice(d.id)}><${Ic} i="device"/><span>${d.name}</span>${d.sub ? html`<span class="faint">${d.sub}</span>` : null}</button>`)}
    </div><//>` : null}
  </div>`;
}

// Simple assign for an UNASSIGNED peer: just record the owner (roster metadata). The key / PSK /
// config are kept, so a config already handed out keeps working — no fresh credential, no warning.
export function assignPeer(peer, userId) {
  if (!userId) return;
  return mutate({ key: "peer:" + peer.id,
    patch: s => { const p = s.roster.peers[peer.id]; if (p) p.user_id = userId; },
    call: () => api.peerUpdate({ peer_id: peer.id, user_id: userId }),
    onOk: () => { revealAssignedPeer(userId, peer.id); subReconcileUser(userId); } });   // keeps its key, so publish via backfill (prompts to unlock if locked)
}

// Reassign an ALREADY-assigned peer to a different user — this DOES rotate keys (the previous
// holder must be revoked), so it's confirmed and the new owner needs a re-issued config.
export function confirmReassign(peer, userId, back) {
  const to = Store.recon.users.find(u => u.id === userId);
  const toName = to ? to.name : T("the selected user");
  openConfirm({
    title: T("Reassign peer"), confirmLabel: T("Reassign"), danger: true, back,
    body: T("Reassigning to {v1} rotates the peer's keys. The current user loses access immediately and permanently — assigning them back later would still be a brand-new credential.", { v1: toName })
          + " " + T("{v1} gets a fresh QR / config that must be re-distributed.", { v1: toName }),
    onConfirm: () => assignPeerToUser(peer, userId),
  });
}

export function RoleToggle({ peer, t, compact }) {
  useStore();
  const targets = ((Store.recon.peers.find(p => p.id === peer.id) || {}).targets) || peer.targets || [];
  if (targets.length < 2) return null;                       // a lone deployment has nothing to be primary OVER
  const live = targets.find(x => x && x.node === t.node && x.iface === t.iface) || t;
  const role = targetRole(live);
  const next = role === "" ? "primary" : role === "primary" ? "backup" : "";
  const set = (ev) => {
    if (ev) ev.stopPropagation();
    mutate({
      key: "peer:" + peer.id,
      // Patch the ROSTER, not recon: apply() layers the overlays onto a pristine roster clone and only then
      // re-derives recon from it, so a patch written into recon is wiped by the very same pass.
      patch: (store) => {
        const p = ((store.roster && store.roster.peers) || {})[peer.id];
        const lt = p && (p.targets || []).find(x => x && x.node === t.node && x.iface === t.iface);
        if (lt) lt.primary = next || false;                  // "" → false, i.e. unmarked
      },
      call: () => api.peerSetRole({ peer_id: peer.id, node: t.node, iface: t.iface, role: next }),
    });
  };
  const title = role === "primary" ? T("Primary connection — click to mark it a backup")
              : role === "backup"  ? T("Backup connection — click to clear the label")
                                   : T("Unmarked — click to make it the primary connection");
  const word  = role === "primary" ? T("Primary") : role === "backup" ? T("Backup") : T("label|Unmarked");
  return html`<button type="button" class=${"primtog" + (role === "primary" ? " on" : role === "backup" ? " bk" : "")}
    title=${title} onClick=${set}>
    ${role === "backup" ? html`<${Ic} i="shield-fill"/>` : html`<span class="primstar">${role === "primary" ? "★" : "☆"}</span>`}
    ${compact ? null : html`<span>${word}</span>`}</button>`;
}

export async function assignPeerToUser(peer, userId) {
  if (!userId) return;
  const key = "peer:" + peer.id;
  let keys, psk, configs;
  try {
    keys = await genKeys(); psk = genPSK(); configs = {};
    for (const t of (peer.targets || []).filter(t => !isSelfContainedTgt(t))) {   // keyless kinds have no config — see rotatePeerKeys
      const m = Store.ifaceMeta(t.node, t.iface);
      if (!m) { Store.rowErrors[key] = { msg: T("{v1} hasn't reported {v2} yet", { v1: Store.nodeName(t.node), v2: t.iface }), at: Date.now(), node: t.node, iface: t.iface }; Store.apply(); return; }
      configs[tkey(t.node, t.iface)] = buildConf({ privkey: keys.priv, address: t.ip + "/32", dns: m.dns, mtu: 1280, awg_params: m.awg_params, server_pubkey: m.public_key, psk, endpoint: m.endpoint, allowed: "0.0.0.0/0, ::/0", keepalive: 25 });
    }
  } catch (e) { Store.rowErrors[key] = { msg: String(e.message || e), at: Date.now() }; Store.apply(); return; }
  await mutate({
    key,
    call: () => api.peerRekey({ peer_id: peer.id, user_id: userId, pubkey: keys.pub, psk }),   // no plaintext to the server
    onOk: () => { Store.sessionConfigs[keys.pub] = configs; Store.configEpoch++; revealAssignedPeer(userId, peer.id);
      subPublishOrPrompt(userId, peer.id, keys.priv, psk); },
  });
}
