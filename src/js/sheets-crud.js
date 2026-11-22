import { T, Trich, Tsplit, plural, srvText } from "./i18n.js";
import { esc, tkey, V, BASE, seen, panelNowS, configErrors, orderedTargets, isPrimaryTarget, useStableOrder,
         isSelfContainedKind, ipOf, portOf, ipPickerVal, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { NODE_COLOR_DEFAULT, NODE_CREATE_DEFAULT, toThemed } from "./theme.js";
import { go } from "./router.js";
import { targetType, routerCapable, iTypeOf, kindOf, nodeStale, wdttOn, suggestIface, suggestSubnet, suggestPort,
         portHolder, portErrMsg, subnetFleetConflict, subnetServerAddr, cidrNet, ghostIface,
         turnProxiesFor, tgtXfer, tgtSeenAge, kindLabel, platformLabel, peerUncategorised } from "./model.js";
import { turnFork, turnColor, turnForkList, forkLabel } from "./turn-catalog.js";
import { Ic, ICON, Tag, tgt3, Panel, Badge, Sheet, footRow, secTitle, SearchBox, Switch, Dropdown, Disclosure, autoGrow, IpPicker, NodeIpPick, Popover, CapList, capShown, Portal, toast, copy, mutate, sheetSend, openModal, pushModal, closeModal, closeAllModals, openConfirm, openChildOrRoot, ConfirmSheet, subjectBlocked, statusLabel, LogBody, RowError, useAnchoredList, goSettings, ThemedSwatch, modalDepth, rowSingle, rowDouble, rowNoSelect, rateCell, xferCell, gridStatusBadge, uncatPop, badgeWithReason, blockedReason, statusReason, dlul, typeToConfirm, closeModals, ListPager, LIST_PAGE, pageSlice } from "./ui.js";
import {
  genKeys, genPSK, buildConf, parseFullConf, downloadConf, getConfig, configOverrides, QR, qrDataURL,
  subFeatureOn, subPublishOrPrompt, ensureVaultUnlocked, subSKCached, VaultPromptSheet, ensurePeerBlob,
  SubAutoNote, anySessionConf, subAutoGenIfEnabled, subReconcileUser,
} from "./crypto.js";
import {
  confirmDeletePeer, confirmUnassign, peerBlockBtn, userBlockBtn, PeerStatusLine, SubStatusLine,
  fmtDate, expiryInputVal, expiryFromInput, UserCombo, UserPicker, RoleToggle, assignPeer,
  confirmReassign, confirmCorrectDeployment, confirmRestoreDeployment, openRecreateRekey, rotatePeerKeys, rotateOnePeerKeys, rotateOneLabel, rotateParts, PubTag,
  pubState, pubCls,
} from "./peer-actions.js";
import { searchMatch, usersView, revealUser, privateUnenforced, namedFew, privateOffOpens, clearUserFilters } from "./views.js";
import { turnEnabled, WDTT_COLOR, shownTitle } from "./turn.js";
import { openPeerConfigs, ReachedByBody, openUserEdit, openGroup } from "./peer-ui.js";
import { TrafficBlock, goneDevices } from "./traffic-ui.js";
import { trafficTotals, trafficModalView } from "./traffic.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

// New user — identity, then optionally straight into adding peers (one per interface).
export function openCreateUser() { openModal(html`<${CreateUserSheet}/>`); }
export function CreateUserSheet() {
  const [name, setName] = useState(""); const [tag, setTag] = useState(""); const [note, setNote] = useState(""); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const createUser = async () => {
    if (!name.trim()) { setMsg({ k: "err", t: T("Give the user a name.") }); return null; }
    setBusy(true); setMsg({ k: "work", t: T("creating…") });
    const r = await api.userCreate({ name: name.trim(), tag: tag.trim(), note });
    setBusy(false);
    if (!r.ok) { setMsg({ k: "err", t: srvText(r) || T("couldn't create user") }); return null; }
    Store.recentlyCreated[r.data.id] = Date.now(); subAutoGenIfEnabled(r.data.id); await Store.poll();
    return r.data;
  };
  const stayExpanded = uid => { usersView.mode = "users"; clearUserFilters(); usersView.expanded[uid] = true; usersView.q = ""; usersView.page = 1; closeModal(); go("#/users"); };
  const createOnly = async () => { const u = await createUser(); if (u) stayExpanded(u.id); };
  const createAndAdd = async () => { const u = await createUser(); if (u) openModal(html`<${AddPeersSheet} userId=${u.id} userName=${u.name}/>`); };
  return html`<${Sheet} title=${T("New user")}
    foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button><button class="btn btn-ghost m-third" disabled=${busy} onClick=${createOnly}>${T("Create only")}</button><button class="btn btn-primary" disabled=${busy} onClick=${createAndAdd}>${T("Add peers ▸")}</button></>`}>
    <div class="field"><label>${T("Name")}</label><input autofocus value=${name} onInput=${e => setName(e.target.value)} placeholder=${T("Alex")}/></div>
    <div class="field"><label>${T("Tag")}</label><input value=${tag} onInput=${e => setTag(e.target.value)} placeholder=${T("Friend")}/></div>
    <div class="field"><label>${T("Note")}</label><input value=${note} onInput=${e => setNote(e.target.value)} placeholder=${T("Uses iPhone and router")}/></div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function openAddPeers(userId, userName) { openModal(html`<${AddPeersSheet} userId=${userId} userName=${userName}/>`); }
export function PeerBlockGrid({ peers, mode, act }) {
  useStore();
  const gridRef = useRef(null);
  const ids = peers.map(p => p.id).join(",");
  useEffect(() => {                                     // cap the grid at 7 peer blocks (styled scrollbar past that) + centre a just-added/moved peer
    const el = gridRef.current; if (!el) return;
    const kids = el.children;
    el.style.maxHeight = kids.length > 7 ? Math.ceil(kids[6].getBoundingClientRect().bottom - el.getBoundingClientRect().top) + "px" : "";
    const hot = peers.find(p => Store.recentlyCreated[p.id] && Date.now() - Store.recentlyCreated[p.id] < 2500);
    if (hot) requestAnimationFrame(() => { const n = el.querySelector('[data-pid="' + hot.id + '"]'); if (!n) return;
      const gr = el.getBoundingClientRect(), pr = n.getBoundingClientRect();
      el.scrollTo({ top: Math.max(0, el.scrollTop + (pr.top - gr.top) - (el.clientHeight - pr.height) / 2), behavior: "smooth" }); });
  }, [ids]);
  if (!peers.length) return html`<div class="pg2-empty">${mode === "mine" ? T("No peers assigned to this user yet.") : T("No unassigned peers to add.")}</div>`;
  return html`<div class="pg2" ref=${gridRef}>${peers.map(p => {
    const ts = orderedTargets(p.targets || []); const multi = ts.length > 1;
    const fresh = Store.recentlyCreated[p.id] && (Date.now() - Store.recentlyCreated[p.id] < 2500);   // reuse the users/peers-grid glow (recentlyCreated + pcreate)
    return html`<div key=${p.id} data-pid=${p.id} class=${"pg2-peer" + (fresh ? " pcreate" : "")}>${(ts.length ? ts : [{}]).map((t, i) => html`
      <div key=${tkey(t.node, t.iface)} class=${"pg2-dep clk" + (multi && i === 0 ? " primary" : "")} title=${T("Double-click for QR / configs")}
        onMouseDown=${rowNoSelect} onClick=${e => rowSingle(e, () => openPeerView(p.id, t.node, t.iface, true))} onDblClick=${e => rowDouble(e, () => openPeerConfigs(p, { child: true }))}>
        <span class="pg2-c pg2-st">${t.node ? gridStatusBadge(t, p) : null}</span>
        <span class="pg2-c pg2-title">${i === 0
          ? html`<${Fragment}><span class="pg2-nm">${(p.title || "").trim() || html`<span class="faint">${T("tag|untitled")}</span>`}</span>${multi ? html`<span class="pg2-rel primary">${T("Primary")}</span>` : null}<//>`
          : html`<span class="pg2-bk">${T("Backup")}</span>`}</span>
        <span class="pg2-c pg2-tags">${t.node ? (mode === "mine"
          ? html`<${TargetFrontBadge} node=${t.node} iface=${t.iface} peer=${p} dim=${!t.online}/><${PubTag} peer=${p} src=${targetType(t)} label=${targetType(t)} dim=${!t.online} gen3=${tgt3(t)}/>`
          : html`<${TargetFrontBadge} node=${t.node} iface=${t.iface}/><${Tag} kind=${targetType(t)} label=${targetType(t)} gen3=${tgt3(t)}/>`) : null}</span>
        <span class="pg2-c pg2-ifn">${t.node ? t.iface : ""}</span>
        <span class="pg2-c pg2-ip">${t.node ? (String(t.ip || "").split("/")[0] || "—") : ""}</span>
        <span class="pg2-c pg2-ctl">${i === 0 ? html`<${Fragment}>${mode === "mine" ? html`<button type="button" class="pg2-act add" title=${T("Add or edit interface deployments")} onClick=${() => openAddTarget(p)}><${Ic} i="plus"/></button>` : null}<button type="button" class=${"pg2-act " + mode} title=${mode === "mine" ? T("Unassign from this user") : T("Assign to this user (keeps its key)")} onClick=${() => act(p)}><${Ic} i=${mode === "mine" ? "link" : "plus"}/></button><//>` : null}</span>
      </div>`)}</div>`;
  })}</div>`;
}
export function AddPeersSheet({ userId, userName }) {
  useStore();
  const rep = p => orderedTargets(p.targets || [])[0] || {};
  const orderPeers = list => [...list].sort((a, b) =>
    (b.title ? 1 : 0) - (a.title ? 1 : 0) ||                              // named peers first (untitled sink to the bottom)
    String(a.title || "").localeCompare(String(b.title || "")) ||        // then alphabetical by title
    Store.byNode(rep(a).node, rep(b).node) ||
    String(rep(a).ip || "").localeCompare(String(rep(b).ip || ""), undefined, { numeric: true }));
  const mine = orderPeers(userId ? Store.peersOfUser(userId) : []);
  const free = orderPeers(Store.unassignedPeers());

  const doAssign = p => { Store.recentlyCreated[p.id] = Date.now(); return mutate({ key: "peer:" + p.id,   // keep the key, just link — publish the blob (prompts to unlock if locked)
    patch: s => { const pp = s.roster.peers[p.id]; if (pp) pp.user_id = userId; },
    call: () => api.peerUpdate({ peer_id: p.id, user_id: userId }),
    onOk: () => subReconcileUser(userId) }); };
  const doUnassign = p => pushModal(html`<${ConfirmSheet} title=${T("Unassign peer") + (userName ? " · " + userName : "")} confirmLabel=${T("Unassign")} danger=${true}
    body=${userName
      ? Trich("Revoke *{v1}* from {v2}? Access is cut immediately and the key changes — re-adding later needs a fresh QR / config.", { v1: (p.title || "").trim() || T("this peer"), v2: userName })
      : Trich("Revoke *{v1}* from the user? Access is cut immediately and the key changes — re-adding later needs a fresh QR / config.", { v1: (p.title || "").trim() || T("this peer") })}
    onConfirm=${() => { Store.recentlyCreated[p.id] = Date.now(); mutate({ key: "peer:" + p.id,
      patch: s => { const pp = s.roster.peers[p.id]; if (pp) pp.user_id = null; },
      call: () => api.peerUnassign({ peer_id: p.id }),
      onOk: () => { delete Store.sessionConfigs[p.pubkey]; Store.configEpoch++; } }); }}/>`);
  const createFresh = () => openCreatePeer({ user_id: userId, userName, lockUser: true }, true);

  return html`<${Sheet} title=${userName ? T("Add peers · {v1}", { v1: userName }) : T("Add peers")} width=${800}>
    <div class="pg2-sec">
      <div class="pg2-hdr"><label>${T("This user’s peers")}</label><span class="grow"></span>
        <button class="btn btn-mini pg2-fresh" onClick=${createFresh}><${Ic} i="plus"/> ${T("Create fresh peer")}</button></div>
      <${PeerBlockGrid} peers=${mine} mode="mine" act=${doUnassign}/>
    </div>
    <div class="pg2-sec">
      <div class="pg2-hdr"><label>${T("Unassigned peers")}</label></div>
      <${PeerBlockGrid} peers=${free} mode="free" act=${doAssign}/>
    </div>
  <//>`;
}

// All deployable (node, iface) targets known from the consolidated state.
export function allTargets() {
  const out = [];
  for (const node of Object.keys(Store.describe)) for (const iface of Object.keys(Store.describe[node] || {}))
    if (!Store.ifaceIsSystem(node, iface)) out.push({ node, iface });   // never offer a mesh link (swg_*) as a peer target
  for (const n of (Store.nodes || [])) {
    for (const iface of Object.keys(n.wdtt_cfg || {}))
      if (!out.some(t => t.node === n.id && t.iface === iface)) out.push({ node: n.id, iface });
    for (const iface of Object.keys(n.csqtt_cfg || {}))
      if (!out.some(t => t.node === n.id && t.iface === iface)) out.push({ node: n.id, iface });
  }
  return out;
}

// A deployment row's node name ends in an ellipsis when long (app.css .targetopt .nm): its full name as a tooltip then,
// and only then — asked on hover, when the browser has laid it out.
const nmTip = e => { const el = e.currentTarget; el.title = el.scrollWidth > el.clientWidth ? el.textContent : ""; };

export function TargetFrontBadge({ node, iface, peer, dim }) {
  useStore();          // it is a publish switch when `peer` is set — without this it never re-renders after a toggle
  if (!node || !iface) return null;
  if (kindOf(node, iface, null) === "wdtt") {
    const nrec = (Store.nodes || []).find(x => x.id === node) || {};
    const cfg = (nrec.wdtt_cfg || {})[iface] || {};
    const live = ((Store.stats[node] || {}).wdtt || []).find(w => w && w.iface === iface) || {};
    const fork = cfg.fork || live.fork || "";
    const label = shownTitle("w|" + node + "|" + iface, String(cfg.title || live.title || "").trim()) || forkLabel(fork);
    if (!label) return null;
    const col = turnColor(fork) || WDTT_COLOR;
    return html`<span class=${"tg tgt-front" + (dim ? " dim" : "")} style=${"--tgc:" + col} title=${T("WDTT server") + (fork ? " · " + forkLabel(fork) : "")}>${label}</span>`;
  }
  const tps = turnProxiesFor(node, iface);
  if (!tps.length) return null;
  const one = t => shownTitle("t|" + node + "|" + t.service, t.title) || forkLabel(turnFork(t.service));
  const st = peer ? pubState(peer, "turn") : null;
  // Offline dims this the same way it dims the interface badge beside it — they describe one deployment, so
  // one of them fading while the other stays lit read as a difference in state that isn't there.
  const tag = (body, cls, style, title) => st
    ? html`<button type="button" class=${"tg tgt-front " + pubCls(st, ((cls || "") + (dim ? " dim" : "")).trim())} style=${style} title=${st.title}
        aria-pressed=${!st.hidden} onClick=${e => { e.preventDefault(); e.stopPropagation(); st.flip(); }}><span class="tgt-ttl">${body}</span>${st.hidden ? html`<${Ic} i="off"/>` : null}</button>`
    : html`<span class=${"tg tgt-front " + (cls || "") + (dim ? " dim" : "")} style=${style} title=${title}>${body}</span>`;
  if (tps.length === 1) {
    const f = turnFork(tps[0].service);
    return tag(one(tps[0]), "", "--tgc:" + (turnColor(f) || "var(--turn)"), T("Turn-proxy") + (f ? " · " + forkLabel(f) : ""));
  }
  return html`<${Popover} hoverOnly cls="tgt-frontpop" popCls="tgt-frontbub"
    trigger=${tag(html`<${Fragment}>${T("val|turn")}<b class="turnx">×${tps.length}</b><//>`, "tgt-front-many", "",
                  T("{v1} turn-proxies forward to this interface", { v1: tps.length }))}>
    <div class="tgt-frontlist"><span class="tgt-frontlbl">${T("Turn-proxies on this interface")}</span>
      ${tps.map(t => { const f = turnFork(t.service);
        return html`<span class="tg tgt-front" key=${t.service} style=${"--tgc:" + (turnColor(f) || "var(--turn)")}>${one(t)}</span>`; })}</div>
  <//>`;
}

export function TargetPicker({ prefill, exclude, onChange, initial, pubPeer }) {
  const pubHave = useMemo(() => new Set(((pubPeer && pubPeer.targets) || []).map(t => tkey(t.node, t.iface))),
                          [pubPeer && pubPeer.targets]);
  const all = useMemo(allTargets, [Store.describe, Store.stats]);
  // locked: launched from one interface — show only that target, no toggling, just the IP.
  const locked = !!(prefill && prefill.lock && prefill.node && prefill.iface);
  const baseAll = locked ? all.filter(t => t.node === prefill.node && t.iface === prefill.iface)
    : (exclude ? all.filter(t => !exclude.has(tkey(t.node, t.iface))) : all);
  // existing deployments whose interface the node no longer reports (dangling/missing) — still list them so the
  // operator can UNCHECK to drop them; otherwise a dangling deployment is stuck on the peer with no way to remove it.
  const missingExisting = (!locked && initial) ? initial.filter(t => !baseAll.some(a => a.node === t.node && a.iface === t.iface))
    .map(t => ({ node: t.node, iface: t.iface, type: t.type, missing: true })) : [];
  const targets = baseAll.concat(missingExisting);
  const [sel, setSel] = useState({});
  const allocIp = async (node, iface) => {
    const k = tkey(node, iface);
    setSel(s => ({ ...s, [k]: { node, iface, ip: "", ipHint: T("finding a free address…") } }));
    const r = await api.nextIp([node], iface);
    setSel(s => s[k] ? { ...s, [k]: { node, iface, ip: r.ok ? String(r.data.next_ip).split("/")[0] : "", ipHint: r.ok ? "" : (srvText(r) || T("no free address")) } } : s);
  };
  const toggle = (node, iface) => {
    const k = tkey(node, iface);
    if (sel[k]) setSel(s => { const n = { ...s }; delete n[k]; return n; });
    else if (iTypeOf(node, iface) === "wdtt") setSel(s => ({ ...s, [k]: { node, iface, ip: "", wdtt: true } }));   // WDTT mints the client IP on connect — no address to pick
    else if (iTypeOf(node, iface) === "csqtt") setSel(s => ({ ...s, [k]: { node, iface, ip: "", csqtt: true } }));   // csqtt mints the address on connect too
    else allocIp(node, iface);
  };
  const setIp = (k, v) => setSel(s => s[k] ? { ...s, [k]: { ...s[k], ip: v } } : s);
  const setOpts = (k, v) => setSel(s => s[k] ? { ...s, [k]: { ...s[k], opts: v } } : s);
  const seeded = useRef(false);
  useEffect(() => {                                  // seed already-deployed targets (their assigned IP, read-only)
    if (seeded.current || !initial || !initial.length || !all.length) return;
    seeded.current = true;
    const seed = {};
    initial.forEach(t => { seed[tkey(t.node, t.iface)] = { node: t.node, iface: t.iface, ip: String(t.ip || "").split("/")[0], existing: true }; });
    setSel(seed);
  }, [all, initial]);
  useEffect(() => {                                  // preselect from prefill once targets are known
    if (!targets.length || Object.keys(sel).length || (initial && initial.length)) return;
    if (prefill && prefill.node && prefill.iface) {
      if (iTypeOf(prefill.node, prefill.iface) === "wdtt") setSel({ [tkey(prefill.node, prefill.iface)]: { node: prefill.node, iface: prefill.iface, ip: "", wdtt: true } });   // WDTT: select without allocating an address
      else if (iTypeOf(prefill.node, prefill.iface) === "csqtt") setSel({ [tkey(prefill.node, prefill.iface)]: { node: prefill.node, iface: prefill.iface, ip: "", csqtt: true } });
      else allocIp(prefill.node, prefill.iface);
    } else if (prefill && prefill.node) targets.filter(t => t.node === prefill.node).slice(0, 1).forEach(t => allocIp(t.node, t.iface));
  }, [all]);
  useEffect(() => { onChange(Object.values(sel)); }, [sel]);

  if (!targets.length) return html`<div class="hint">${T("No interfaces available — is a node online?")}</div>`;
  const ordered = [...targets].sort((a, b) =>
    Store.byNode(a.node, b.node) || (a.iface || "").localeCompare(b.iface || ""));
  return html`<div class="targetpick">${ordered.map(t => {
    const k = tkey(t.node, t.iface); const s = sel[k];
    const ity = t.missing ? (t.type || "wg") : iTypeOf(t.node, t.iface);   // wg | awg | wdtt (a WDTT iface isn't in `describe`, so key off the name via iTypeOf)
    return html`<div class=${"targetopt " + (s ? "sel " : "") + (locked ? "locked" : "") + (t.missing ? " missing" : "")}>
      <label class="topt-main" onClick=${locked ? null : () => toggle(t.node, t.iface)}>
        <span class="box">${s ? html`<${Ic} i="check"/>` : ""}</span>
        <span class="nm" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")} onMouseEnter=${nmTip}>${Store.nodeName(t.node)}</span>
        <span class="tp">${t.iface}</span>
        ${t.missing ? html`<span class="topt-missing" title=${T("This interface is gone from the node — uncheck to remove this deployment from the peer")}>${T("tag|missing")}</span>` : null}</label>
      <div class="topt-right hasprim">
        ${(pubPeer && pubHave.has(k)) ? html`<${PubTag} peer=${pubPeer} src=${ity} label=${ity} gen3=${tgt3(t)}/>` : html`<${Tag} kind=${ity} label=${ity} gen3=${tgt3(t)}/>`}
        ${t.missing ? null : html`<${TargetFrontBadge} node=${t.node} iface=${t.iface} peer=${(pubPeer && pubHave.has(k)) ? pubPeer : null}/>`}
        ${(s && (s.wdtt || s.csqtt || isSelfContainedKind(ity)))
          ? html`<span class="topt-ip faint" title=${T("The server assigns the address on connect")}>${T("val|auto IP")}</span>`
          : (s ? html`<input class=${"topt-ip " + (s.ip && !V.ipv4(s.ip) ? "bad" : "")} value=${s.ip} placeholder=${s.ipHint || T("address")} title=${s.ip && !V.ipv4(s.ip) ? T("not a valid IPv4 address") : ""} onInput=${e => setIp(k, e.target.value)}/>` : null)}
        ${/* a phone shows no title: the reason goes under the field (MOBILE-PLAN hook 5) */""}
        ${s && isMobile() && s.ip && !V.ipv4(s.ip) ? html`<span class="hint err topt-err">${T("not a valid IPv4 address")}</span>` : null}
        ${(s && !t.missing) ? html`<${TargetGear} node=${t.node} iface=${t.iface} kind=${ity} opts=${s.opts} onSave=${v => setOpts(k, v)} readOnly=${!!s.existing}/>` : null}
      </div>
    </div>`;
  })}</div>`;
}

// ONE DEPLOYMENT's client-config settings
export const tgtDefaults = (meta) => ({
  dns: ((meta || {}).dns || []).join(", "), mtu: String((meta || {}).mtu || 1280),
  // keepalive reads the interface like dns/mtu do. It used to be a hardcoded "25", so the gear seeded 25
  // over an interface set to something else and configOverrides then stored that 25 as a customisation.
  keepalive: String((meta || {}).keepalive != null ? (meta || {}).keepalive : 25),
  allowed: "0.0.0.0/0, ::/0",   // an interface has no AllowedIPs to inherit — routing belongs to the client
});
// Does this deployment differ from its interface's defaults? Drives the gear's "customised" dot, so an
// operator can see which rows carry settings without opening each one.
export const tgtCustomised = (opts, meta) => !!(opts && Object.keys(configOverrides(opts, meta)).length);

export function openTargetSettings({ node, iface, opts, meta, onSave, readOnly }) {
  pushModal(html`<${TargetSettingsSheet} node=${node} iface=${iface} opts=${opts} meta=${meta} onSave=${onSave} readOnly=${readOnly}/>`);
}
export function TargetSettingsSheet({ node, iface, opts, meta, onSave, readOnly }) {
  const d = tgtDefaults(meta);
  const [dns, setDns] = useState((opts && opts.dns != null) ? opts.dns : d.dns);
  const [mtu, setMtu] = useState((opts && opts.mtu != null) ? opts.mtu : d.mtu);
  const [keepalive, setKa] = useState((opts && opts.keepalive != null) ? opts.keepalive : d.keepalive);
  const [allowed, setAllowed] = useState((opts && opts.allowed != null) ? opts.allowed : d.allowed);
  const cur = { dns, mtu, keepalive, allowed };
  const errs = configErrors(cur);
  const awgOn = !!(meta && meta.awg_params && Object.keys(meta.awg_params).length);
  const fld = (k, fallback) => html`<div class=${"hint" + (errs[k] ? " err" : "")}>${errs[k] || fallback}</div>`;
  const save = () => { if (Object.keys(errs).length) return; onSave(cur); closeModal(); };
  return html`<${Sheet} title=${T("Settings — {v1}", { v1: iface })} width=${560} onBack=${closeModal}
    foot=${readOnly ? footRow({ onCancel: closeModal, cancelLabel: T("Close"), action: null })
      : footRow({ left: html`<button class="btn btn-ghost m-wide" onClick=${() => { setDns(d.dns); setMtu(d.mtu); setKa(d.keepalive); setAllowed(d.allowed); }}>${T("Reset to interface defaults")}</button>`,
                  onCancel: closeModal, onAction: save, action: T("Apply"), disabled: !!Object.keys(errs).length })}>
    <div class="hint" style="margin-bottom:10px">${T("These apply to this deployment only — {v1} on {v2}. The peer's other deployments keep their own.", { v1: iface, v2: Store.nodeName(node) })}</div>
    <div class="field"><label>${T("Client allowed IPs (routing)")}</label>
      <input class=${errs.allowed ? "bad" : ""} disabled=${readOnly} value=${allowed} onInput=${e => setAllowed(e.target.value)}/>${fld("allowed", T("Full tunnel by default. Narrow for split tunnel."))}</div>
    <div class="field"><label>DNS</label>
      <input class=${errs.dns ? "bad" : ""} disabled=${readOnly} value=${dns} onInput=${e => setDns(e.target.value)} placeholder=${T("from server, or e.g. 1.1.1.1")}/>${fld("dns", T("Comma-separated IPs. Blank = no DNS line."))}</div>
    <div class="row2">
      <div class="field"><label>MTU</label><input class=${errs.mtu ? "bad" : ""} disabled=${readOnly} value=${mtu} onInput=${e => setMtu(e.target.value)} placeholder="1280"/>${fld("mtu", T("Blank = 1280."))}</div>
      <div class="field"><label>${T("Persistent keepalive (s)")}</label><input class=${errs.keepalive ? "bad" : ""} disabled=${readOnly} value=${keepalive} onInput=${e => setKa(e.target.value)} placeholder="25"/>${fld("keepalive", T("0 disables · blank = 25."))}</div>
    </div>
    <div class="hint">${awgOn
      ? T("AmneziaWG obfuscation parameters come from the interface itself and are the same for every client on it — change them in the interface's settings.")
      : T("This is a plain WireGuard interface, so it carries no AmneziaWG obfuscation parameters.")}</div>
  <//>`;
}
// The gear that opens the sheet above, for ONE wg/awg row. Returns null for a self-contained kind — WDTT and
// csqtt have no client config to open, and that absence IS the affordance.
export function TargetGear({ node, iface, kind, opts, onSave, readOnly }) {
  if (isSelfContainedKind(kind)) return null;
  const meta = Store.ifaceMeta(node, iface);
  const on = tgtCustomised(opts, meta);
  return html`<button type="button" class=${"btn btn-mini ico topt-gear" + (on ? " on" : "")}
    title=${on ? T("Settings for this deployment (customised)") : T("Settings for this deployment (DNS, MTU, routing)")}
    onClick=${e => { e.preventDefault(); e.stopPropagation(); openTargetSettings({ node, iface, opts, meta, onSave, readOnly }); }}><${Ic} i="gear"/></button>`;
}

// New peer (mint a fresh keypair) deployed to one OR MORE (node,iface) targets as ONE
// credential (redundancy / failover). For per-interface devices, use a user's "Add peers".
export function openCreatePeer(prefill, child) { (child ? pushModal : openModal)(html`<${CreatePeerSheet} prefill=${prefill || {}}/>`); }
export function CreatePeerSheet({ prefill }) {
  const [chosen, setChosen] = useState([]);
  const [title, setTitle] = useState("");
  const [userId, setUserId] = useState(prefill.user_id || "");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const kindFor = t => (t.wdtt ? "wdtt" : t.csqtt ? "csqtt" : iTypeOf(t.node, t.iface));
  const keyed = chosen.filter(t => !isSelfContainedKind(kindFor(t)));

  const validate = () => {
    if (!chosen.length) return T("Pick at least one target.");
    const badIp = keyed.find(t => !V.ipv4(String(t.ip || "").trim()));
    if (badIp) return T("Invalid address for {v1}.", { v1: Store.nodeName(badIp.node) + "/" + badIp.iface });
    for (const t of keyed) {                      // each deployment's own settings, validated on its own
      const ce = configErrors(t.opts || tgtDefaults(Store.ifaceMeta(t.node, t.iface)));
      const k = Object.keys(ce)[0];
      if (k) return T("{v1}: {v2}", { v1: t.iface, v2: ce[k] });
    }
    return null;
  };

  const create = async () => {
    const err = validate(); if (err) return setMsg({ k: "err", t: err });
    setBusy(true); setMsg({ k: "work", t: keyed.length ? T("generating key…") : T("creating peer…") });
    let keys = null, pskV = "", tgts, configs, body;
    try {                                            // browser-side crypto/config build is the only awaited part
      if (keyed.length) {
        keys = await genKeys();
        pskV = genPSK();   // PSK is panel-owned & auto-minted; change it via a peer's Rotate keys
      }
      tgts = []; configs = {};
      for (const t of chosen) {
        const kind = kindFor(t);
        if (isSelfContainedKind(kind)) {            // no address, no key, no client config — the server owns all three
          tgts.push({ node: t.node, iface: t.iface, ip: "", type: kind });
          continue;
        }
        const m = Store.ifaceMeta(t.node, t.iface); if (!m) continue;
        const ipClean = String(t.ip).trim().split("/")[0];
        const o = t.opts || tgtDefaults(m);
        const tg = { node: t.node, iface: t.iface, ip: ipClean, type: (m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg" };
        const ov = configOverrides(o, m);           // only what differs from THIS interface's defaults is stored
        if (Object.keys(ov).length) tg.overrides = ov;
        tgts.push(tg);
        configs[tkey(t.node, t.iface)] = buildConf({ privkey: keys.priv, address: ipClean + "/32", dns: o.dns.split(",").map(x => x.trim()).filter(Boolean), mtu: String(o.mtu).trim() || 1280, awg_params: m.awg_params, server_pubkey: m.public_key, psk: pskV, endpoint: m.endpoint, allowed: String(o.allowed).trim() || "0.0.0.0/0, ::/0", keepalive: String(o.keepalive).trim() });
      }
      body = { user_id: userId || null, title: title.trim(), pubkey: keys ? keys.pub : "", psk: pskV, targets: tgts };
      // No plaintext to the server: the key stays in the browser (session config for the immediate QR) and is
      // encrypted into the blob by subMaybePublish (below, after the create POST succeeds).
    } catch (e) { setBusy(false); return setMsg({ k: "err", t: T("Error: {v1}", { v1: e.message })}); }
    // Optimistic: stash the config, drop a "creating" peer onto the grid, close the modal NOW, and let
    // the create POST run in the background (mutate reverts + toasts on failure; the next poll supersedes).
    if (keys) Store.sessionConfigs[keys.pub] = Object.assign(Store.sessionConfigs[keys.pub] || {}, configs);
    const tempId = "tmp_" + (keys ? keys.pub.slice(0, 14) : String(Math.random()).slice(2, 16));
    const optimistic = { id: tempId, pubkey: keys ? keys.pub : "", user_id: userId || null, title: title.trim(), psk: pskV,
      targets: tgts.map(t => ({ node: t.node, iface: t.iface, ip: t.ip, type: t.type })),
      created_at: panelNowS(), _creating: true };   // panel clock: reconcile judges the "creating" grace against it
    closeModal();
    if (prefill.lock && prefill.node && prefill.iface) go("#/node/" + encodeURIComponent(prefill.node) + "/" + encodeURIComponent(prefill.iface));
    else if (userId) revealUser(userId, tempId);
    mutate({
      patch: s => { s.roster.peers[tempId] = optimistic; },        // shows instantly with status "creating"
      call: () => api.peerCreate(body),
      onOk: r => { if (r && r.data && r.data.id) { Store.recentlyCreated[r.data.id] = Date.now();
        if (keys) subPublishOrPrompt(userId || null, r.data.id, keys.priv, pskV); } },   // encrypt {k,p} → blob (prompt to unlock if locked)
    });
  };

  return html`<${Sheet} title=${T("New peer")} width=${620}
    foot=${footRow({ onCancel: closeModal, disabled: busy, onAction: create, action: T("Create peer") })}>
    ${prefill.lockUser
      ? html`<div class="field"><label>${T("col|User")}</label><div class="lockeduser">${prefill.userName || (Store.recon.users.find(u => u.id === userId) || {}).name || "—"}</div></div>`
      : html`<div class="field"><label>${T("col|User")}</label>
      <${UserPicker} value=${userId} allowUnassigned=${true} onChange=${setUserId}/></div>`}
    <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional, to tell devices apart")}</span></label>
      <input value=${title} onInput=${e => setTitle(e.target.value)} maxlength="64" placeholder=${T("iPhone, Router, Laptop…")}/></div>
    <div class="field"><label>${T("Targets")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— one, or several for redundancy (same credential)")}</span></label>
      <${TargetPicker} prefill=${prefill} onChange=${setChosen}/>
      ${keyed.length ? html`<div class="hint">${T("Use the gear on a row for that deployment's DNS, MTU and routing.")}</div>` : null}</div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function openAddTarget(peer, back) {
  const child = modalDepth() > 0;   // opened from another modal (peer view / edit) → child; Cancel pops back to it
  (child ? pushModal : openModal)(html`<${AddTargetSheet} peer=${peer} back=${back || closeModal} child=${child}/>`);
}
export function AddTargetSheet({ peer, back, child }) {
  back = back || closeModal;
  const [chosen, setChosen] = useState([]);
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  // source config (holds the client's private key) so NEW targets can rebuild a QR: session first,
  // then the panel's stored copy when store_configs is on. Any target's config carries the same key.
  const [srcConf, setSrcConf] = useState(() => anySessionConf(peer.pubkey));
  const [confLoaded, setConfLoaded] = useState(() => !!anySessionConf(peer.pubkey) || !Store.storeConfigs);
  useEffect(() => {
    if (srcConf || !Store.storeConfigs) { setConfLoaded(true); return; }
    let ok = true;
    (async () => {
      for (const t of peer.targets) { const c = await getConfig(peer.pubkey, t.node, t.iface); if (c) { if (ok) setSrcConf(c); break; } }
      if (ok) setConfLoaded(true);
    })();
    return () => { ok = false; };
  }, [peer.id]);

  const initial = useMemo(() => peer.targets.map(t => ({ node: t.node, iface: t.iface, ip: t.ip, type: t.type })), [peer.id]);
  const haveKeys = new Set(peer.targets.map(t => tkey(t.node, t.iface)));
  const origIp = {}; peer.targets.forEach(t => origIp[tkey(t.node, t.iface)] = String(t.ip || "").split("/")[0]);
  const chosenKeys = new Set(chosen.map(c => tkey(c.node, c.iface)));
  const added = chosen.filter(c => !haveKeys.has(tkey(c.node, c.iface)));         // newly checked
  const removed = peer.targets.filter(t => !chosenKeys.has(tkey(t.node, t.iface))); // unchecked existing
  const ipChanged = chosen.filter(c => haveKeys.has(tkey(c.node, c.iface)) && c.ip && String(c.ip).split("/")[0] !== origIp[tkey(c.node, c.iface)]);  // existing whose address was edited
  // A peer may now hold a mix of kinds, so a newly-ticked row is only asked for an address when its interface
  // HAS one to give — a wdtt/csqtt server mints the client address on connect.
  const kindFor = c => (c.wdtt ? "wdtt" : c.csqtt ? "csqtt" : iTypeOf(c.node, c.iface));
  const needsIp = c => !isSelfContainedKind(kindFor(c));
  const badIp = added.concat(ipChanged).filter(needsIp).some(c => !c.ip || !V.ipv4(String(c.ip).split("/")[0]));
  const nochange = !added.length && !removed.length && !ipChanged.length;
  // A device that carries networks carries them on EVERY node it is deployed to — so a node added here opens them to that
  // node too, and a node removed takes them away from everyone there. Neither was said.
  const nets = peer.routes || [];
  const netDev = peer.title || ((peer.user_id && Store.user(peer.user_id)) || {}).name || T("This device");
  const netsAdded = nets.length > 0 && added.some(needsIp);
  const netsGone = nets.length ? removed.filter(t => !isSelfContainedKind(targetType(t))) : [];

  const doSave = async () => {
    setBusy(true); setMsg({ k: "work", t: T("applying…") });
    const fails = [];
    for (const t of added) {
      const kind = kindFor(t);
      if (isSelfContainedKind(kind)) {
        // A keyless deployment brings no address and no client config; if this is the peer's first of that
        // kind, the panel mints its access password server-side (mint_keyless_secrets).
        const r = await api.peerAddTarget({ peer_id: peer.id, target: { node: t.node, iface: t.iface, ip: "", type: kind } });
        if (!r.ok) fails.push(Store.nodeName(t.node) + "/" + T("{v1} (add)", { v1: t.iface }));
        continue;
      }
      const info = Store.ifaceMeta(t.node, t.iface);
      const ipClean = String(t.ip || "").split("/")[0];
      const o = t.opts || null;                  // settings the operator set behind this row's gear
      let conf = null;
      if (srcConf) { const s = parseFullConf(srcConf);
        conf = buildConf({ privkey: s.privkey, address: ipClean + "/32", dns: o ? String(o.dns).split(",").map(x => x.trim()).filter(Boolean) : s.dns, mtu: o ? (String(o.mtu).trim() || 1280) : s.mtu, awg_params: info.awg_params, server_pubkey: info.public_key, psk: s.psk || peer.psk, endpoint: info.endpoint, allowed: o ? (String(o.allowed).trim() || "0.0.0.0/0, ::/0") : s.allowed, keepalive: o ? String(o.keepalive).trim() : s.keepalive }); }
      const target = { node: t.node, iface: t.iface, ip: ipClean, type: info.awg_params && Object.keys(info.awg_params).length ? "awg" : "wg" };
      const ov = o ? configOverrides(o, info) : {};
      if (Object.keys(ov).length) target.overrides = ov;
      // Same key as the existing deployments → the peer's blob already covers it; no plaintext to the server.
      const r = await api.peerAddTarget({ peer_id: peer.id, target });
      if (r.ok) { if (conf) (Store.sessionConfigs[peer.pubkey] = Store.sessionConfigs[peer.pubkey] || {})[tkey(t.node, t.iface)] = conf; }
      // a refused deployment says WHY — "(add)" alone left the operator guessing which of this device's networks was in the way
      else fails.push(Store.nodeName(t.node) + "/" + T("{v1} (add)", { v1: t.iface })
        + ((r.refusals || []).length ? " — " + r.refusals.map(x => netWhy(x, Store.nodeName(x.node))).join(" ") : ""));
    }
    for (const t of ipChanged) {
      const info = Store.ifaceMeta(t.node, t.iface);
      const ipClean = String(t.ip || "").split("/")[0];
      const body = { peer_id: peer.id, node: t.node, iface: t.iface, ip: ipClean };
      // address lives in the roster (rendered live); rebuild the session config for the QR, but send no plaintext.
      if (srcConf) { const s = parseFullConf(srcConf); const conf = buildConf({ privkey: s.privkey, address: ipClean + "/32", dns: s.dns, mtu: s.mtu, awg_params: info.awg_params, server_pubkey: info.public_key, psk: s.psk || peer.psk, endpoint: info.endpoint, allowed: s.allowed, keepalive: s.keepalive }); (Store.sessionConfigs[peer.pubkey] = Store.sessionConfigs[peer.pubkey] || {})[tkey(t.node, t.iface)] = conf; }
      const r = await api.peerUpdateTarget(body);
      if (!r.ok) fails.push(Store.nodeName(t.node) + "/" + T("{v1} (address)", { v1: t.iface }));
    }
    for (const t of removed) {
      const r = await api.peerRemoveTarget({ peer_id: peer.id, node: t.node, iface: t.iface });
      if (!r.ok) fails.push(Store.nodeName(t.node) + "/" + T("{v1} (remove)", { v1: t.iface }));
    }
    setBusy(false);
    if (fails.length) { setMsg({ k: "err", t: T("Some changes failed: {v1}", { v1: fails.join(", ") })}); return false; }
    toast(T("Peer targets updated."), "ok"); await Store.poll(); return true;
  };
  const save = () => {
    if (nochange) { back(); return; }
    if (badIp) return setMsg({ k: "err", t: T("A target has an invalid address.") });
    if (chosen.length === 0) {                       // a peer must live on at least one interface — none left = delete it
      pushModal(html`<${ConfirmSheet} title=${T("Delete this peer?")} confirmLabel=${T("Yes, delete")} danger=${true}
        body=${T("You've unchecked every interface, so there's nothing left to deploy this peer to — saving will completely delete it. Its access is revoked everywhere and its config / QR stops working. This action is irreversible. Are you sure you want to continue?")
          + (nets.length ? " " + T("{device} carries {nets} — everyone who reaches them through it loses access.", { device: netDev, nets: nets.join(", ") }) : "")}
        onConfirm=${async () => {
          if (peer.user_id != null) { const u = await api.peerUnassign({ peer_id: peer.id }); if (!u.ok) return setMsg({ k: "err", t: T("Delete failed: {v1}", { v1: srvText(u) || u.code || "" }) }); }
          const r = await api.peerDelete({ peer_id: peer.id });
          if (!r.ok) return setMsg({ k: "err", t: T("Delete failed: {v1}", { v1: srvText(r) || r.code || "" }) });
          closeModal(); back(); toast(T("Peer deleted."), "ok"); await Store.poll();
        }}/>`);
      return;
    }
    if (removed.length || ipChanged.length) {
      const parts = [];
      if (removed.length) {
      const where = removed.map(t => Store.nodeName(t.node) + "/" + t.iface).join(", ");
      parts.push(removed.length > 1
        ? T("Remove the peer from {v1} — those tunnels drop immediately and the client can no longer connect through them.", { v1: where })
        : T("Remove the peer from {v1} — that tunnel drops immediately and the client can no longer connect through it.", { v1: where }));
      if (netsGone.length) parts.push(T("{device} stops carrying {nets} on {where} — everyone who reaches them there loses access.",
        { device: netDev, nets: nets.join(", "), where: [...new Set(netsGone.map(t => Store.nodeName(t.node)))].join(", ") }));
    }
      if (ipChanged.length) {
      const where = ipChanged.map(c => Store.nodeName(c.node) + "/" + c.iface).join(", ");
      parts.push(ipChanged.length > 1
        ? T("Change the peer's address on {v1} — the config / QR already handed out for those interfaces stops connecting, so you'll need to re-issue and re-distribute them.", { v1: where })
        : T("Change the peer's address on {v1} — the config / QR already handed out for that interface stops connecting, so you'll need to re-issue and re-distribute it.", { v1: where }));
    }
      const title = removed.length && ipChanged.length ? T("Apply these changes?")
        : removed.length ? T("Remove from {v1}?", { v1: plural(removed.length, "interface") })
        : T("Change {v1}?", { v1: plural(ipChanged.length, "address") });
      pushModal(html`<${ConfirmSheet} title=${title} confirmLabel=${T("Save changes")} danger=${true} body=${parts.join(" ") + " " + T("This can't be undone.")}
        note=${ipChanged.length ? html`<${SubAutoNote}/>` : null}
        onConfirm=${async () => { if (await doSave()) { closeModal(); back(); } }}/>`);
    } else doSave().then(ok => { if (ok) back(); });
  };

  return html`<${Sheet} title=${T("Peer targets")} width=${620} onClose=${back} onBack=${child ? back : null} subject=${{ kind: "peer", id: peer.id }}
    foot=${footRow({ onCancel: back, actionCls: "btn " + (chosen.length === 0 ? "btn-danger" : "btn-primary"), disabled: busy || !confLoaded || nochange, onAction: save, action: chosen.length === 0 ? T("Delete peer") : ((removed.length || ipChanged.length) ? T("Save changes") : T("Deploy")) })}>
    ${!confLoaded ? html`<div class="loading"><span class="spin"></span>${T("loading config…")}</div>`
      : html`<${Fragment}>
        ${added.length && !srcConf ? html`<div class="notice warn"><${Ic} i="warn"/><span>${Store.storeConfigs
            ? T("This peer's private key isn't available here, so newly-added targets get the same key + PSK but a fresh QR / config can't be generated. Re-issue (rotate keys) for a downloadable config.")
            : T("store_configs is off, so the client's private key isn't kept — new targets get the same key + PSK, but a fresh QR can't be shown.")}</span></div>` : null}
        <div class="field"><label>${T("Targets")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— check to deploy, uncheck to remove")}</span></label>
          <${TargetPicker} initial=${initial} pubPeer=${peer} onChange=${setChosen}/></div>
        ${netsAdded ? html`<div class="notice warn"><${Ic} i="network"/><span>${peer.share
            ? T("{device} carries {nets}. On a node you add, they're carried there too — for the same people as now.", { device: netDev, nets: nets.join(", ") })
            : T("{device} carries {nets}. On a node you add, they're carried there too, and every device on that node can reach them. Open Networks to limit who.", { device: netDev, nets: nets.join(", ") })}</span></div>` : null}
        ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
      </>`}
  <//>`;
}

export function openPeerView(pid, node, iface, child) { (child ? pushModal : openModal)(html`<${PeerViewSheet} pid=${pid} node=${node} iface=${iface}/>`); }
export function PeerViewSheet({ pid, node, iface }) {
  useStore();
  const p = Store.peer(pid);
  const depsOrdered = useStableOrder(p ? p.targets : []);   // frozen at open — toggling ★ won't re-shuffle the cards
  if (!p) return html`<${Sheet} title=${T("sheet|Peer")} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}><div class="empty"><b>${T("Peer not found")}</b>${T("It may have been removed.")}</div><//>`;
  const u = p.user_id ? Store.user(p.user_id) : null;
  const editLocked = p.targets.some(t => t.status === "dangling" || t.status === "broken");
  // Same status treatment as the peer QR modal: in a subscription → subscription status in the header (right) + the
  // peer's own status on a line under it; not in a subscription → the peer's own status takes the header slot.
  const headExtra = u ? html`<${SubStatusLine} user=${u} pos="hr"/>` : html`<${PeerStatusLine} peer=${p} pos="hr"/>`;
  return html`<${Sheet} title=${p.title || (u ? u.name : T("Unassigned peer"))} width=${760} headExtra=${headExtra} subject=${{ kind: "peer", id: pid }}
    foot=${html`<${Fragment}>
      <button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button><span class="grow"></span>
      <button class="btn btn-ghost" onClick=${() => openPeerConfigs(p, { child: true })}><${Ic} i="qr"/>QR</button>
      <button class="btn btn-ghost" onClick=${() => openAddTarget(p)}><${Ic} i="copy"/> ${T("Targets")}</button>
      ${editLocked
        ? html`<button class="btn btn-ghost" disabled title=${T("Fix or remove the problem interface first — see the note above")}><${Ic} i="pencil"/> ${T("Edit")}</button>`
        : html`<button class="btn btn-ghost" onClick=${() => openEditPeer(p, node && iface ? { node, iface } : null)}><${Ic} i="pencil"/> ${T("Edit")}</button>`}
      ${peerBlockBtn(p)}
      ${p.unassigned ? html`<button class="btn btn-danger" onClick=${() => confirmDeletePeer(p, null, true)}>${T("Delete")}</button>`
        : html`<button class="btn btn-danger" onClick=${() => confirmUnassign(p)}>${T("Unassign")}</button>`}
      ${/* a phone: the device's keys from its view, amber as everywhere (operator, 2026-10-29) */""}
      ${isMobile() && !rotateParts(p).none ? html`<button class="btn btn-warn m-pvrot" onClick=${() => rotateOnePeerKeys(p)}><${Ic} i="key"/> ${rotateOneLabel(p)}</button>` : null}<//>`}>
    ${u ? html`<${PeerStatusLine} peer=${p} pos="bar"/>` : null}
    <div class="pv-head">
      <div class="pv-id"><div class="pv-sub">${u ? html`<a class="pv-user" href="#/users" onClick=${e => { e.preventDefault(); closeModal(); revealUser(u.id); }}>${u.name}</a>`
          : html`<${UserCombo} onPick=${uid => assignPeer(p, uid)} placeholder=${T("Assign to a user…")}/>`}</div></div>
      ${(p.routes || []).length && p.targets.some(t => !isSelfContainedKind(targetType(t))) ? html`<${NetworksBadge} peer=${p}/>` : null}
      ${badgeWithReason(p.unassigned ? "unassigned" : p.status, p.reason)}</div>
    <div class="lbl" style="margin:16px 2px 4px">${T("Deployments · {n}", { n: p.targets.length })}</div>
    <div class="pv-deps">${depsOrdered.map(t => {
      const obs = t.observed;
      const xfer = tgtXfer(t);            // wire counters for wg/awg, per-password byte deltas for a keyless server
      const proto = targetType(t);
      return html`<div class=${"pv-dep" + (node === t.node && iface === t.iface ? " hl" : "")} key=${tkey(t.node, t.iface)}>
        <div class="pv-dep-top">${peerUncategorised(t) && t.status !== "blocked" && t.status !== "faulty"
          ? uncatPop(html`<span class="badge b-uncat ic"><${Ic} i="warn"/>${statusLabel(t.status)}</span>`)
          : badgeWithReason(t.status, t.status === "blocked" ? blockedReason(t.type) : statusReason(t.status))}
          <span class="tags">
            <${PubTag} peer=${p} src=${proto} label=${proto} dim=${!t.online} gen3=${tgt3(t)}/>
            ${turnEnabled() ? html`<${TargetFrontBadge} node=${t.node} iface=${t.iface} peer=${p} dim=${!t.online}/>` : null}
          </span>
          <span class="grow"></span>
          <${RoleToggle} peer=${p} t=${t}/>
          ${(() => { const gh = ghostIface(t.node, t.iface); return (gh && gh.ripe)
            ? html`<button class="btn btn-ghost gh" title=${T("Recreate this interface with a NEW key and rekey every peer on it — clients re-import")} onClick=${() => openRecreateRekey(t.node, t.iface)}><${Ic} i="refresh"/> ${T("Recreate & rekey interface")}</button>`
            : t.restorable ? html`<button class="btn btn-ghost restore" title=${T("Recreate this missing interface with its original identity — recovers every peer on it")} onClick=${() => confirmRestoreDeployment(p, t)}><${Ic} i="refresh"/> ${T("Restore interface")}</button>`
            : t.correctable ? html`<button class="btn btn-ghost correct" title=${T("Assign the next free in-subnet address ({ip} is out of range)", { ip: t.ip || "?" })} onClick=${() => confirmCorrectDeployment(p, t)}><${Ic} i="check"/> ${T("Fix address")}</button>` : null; })()}</div>
        <div class="pv-dep-grid">
          <span><span class="k">${T("col|Node")}</span> <span style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")}>${Store.nodeName(t.node)}</span></span>
          <span><span class="k">${T("col|Interface")}</span> ${t.iface}</span>
          ${/* A qWDTT instance running RAW gives the peer a SECOND address, on its own TUN — it holds both at
                once, so this sits BESIDE the wg address rather than replacing it. Absent for every other kind. */""}
          <span class=${t.raw_ip ? "pv-addr-raw" : ""}><span class="k">${T("col|Address")}</span> <span class="addr">${t.ip || "—"}</span>${t.raw_ip
            ? html` <span class="tg tg-raw" title=${T("This peer's address on the RAW datapath — it holds both at once")}>RAW ${t.raw_ip}</span>`
            : null}</span>
          <span><span class="k">${T("col|Rate")}</span> ${rateCell(xfer ? xfer.rx_speed : 0, xfer ? xfer.tx_speed : 0)}</span>
          <span><span class="k">${T("col|Total")}</span> ${xferCell(...dlul(xfer ? xfer.rx_bytes : 0, xfer ? xfer.tx_bytes : 0))}</span>
          <span><span class="k">${T("col|Online")}</span> ${seen(tgtSeenAge(t))}</span>
        </div></div>`;
    })}</div>
    ${editLocked ? html`<div class="notice warn" style="margin-top:14px"><${Ic} i="warn"/><span>${T("Editing is off while a deployment sits on a missing or misconfigured interface. A peer edit (keys, AmneziaWG params, DNS, address) applies to every deployment, so it would leave this peer inconsistent. To edit it, either Restore / Fix the interface above, or open Targets and remove that interface from this peer.")}</span></div>` : null}
    <${TrafficBlock} by="peer" id=${pid}/>
  <//>`;
}

export function openUserView(uid, child) { (child ? pushModal : openModal)(html`<${UserViewSheet} uid=${uid}/>`); }
export function UserViewSheet({ uid }) {
  useStore();
  const [page, setPage] = useState(1);
  const u = Store.user(uid);
  const e = trafficTotals(trafficModalView);
  const d = e && e.data;
  const rows = ((d && d.rows.get(uid)) || []).slice().sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx) || String(a.name).localeCompare(String(b.name)));
  // devices the user holds now but that carried nothing in the window still belong on the list
  const inRows = new Set(rows.map(r => r.id));
  const quiet = u ? Store.peersOfUser(uid).filter(p => !inRows.has(p.id)).map(p => ({ id: p.id, name: p.title || "", rx: 0, tx: 0, quiet: true })) : [];
  const all = rows.concat(quiet);
  const pages = Math.max(1, Math.ceil(all.length / LIST_PAGE));
  const pg = Math.min(page, pages);
  const gone = d ? goneDevices(uid, d) : 0;
  const status = r => {
    const p = Store.peer(r.id);
    if (!p) return html`<span class="tg tg-gone">${T("deleted")}</span>`;
    if (p.user_id !== uid) { const o = p.user_id ? Store.user(p.user_id) : null;
      return html`<span class="tg tg-gone" title=${T("Its traffic from before the handover is still this user's")}>${o ? T("now {v1}'s", { v1: o.name }) : T("unassigned")}</span>`; }
    return null;
  };
  const title = u ? u.name : (rows[0] && rows[0].owner_name) || T("Deleted user");
  return html`<${Sheet} title=${title} width=${760}
    foot=${html`<${Fragment}><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button><span class="grow"></span>
      ${u ? html`<button class="btn btn-ghost" onClick=${() => { closeModal(); openUserEdit(u); }}><${Ic} i="pencil"/> ${T("Edit user")}</button>` : null}<//>`}>
    <${TrafficBlock} by="user" id=${uid}/>
    <div class="lbl" style="margin:18px 2px 6px">${T("Devices · {n}", { n: all.length })}${gone ? html` <span class="faint">${T("({n} no longer theirs)", { n: gone })}</span>` : null}</div>
    ${!all.length ? html`<div class="empty"><b>${T("No devices yet")}</b>${T("Add a peer for this user and its traffic appears here.")}</div>`
      : html`<div class="uv-list">${pageSlice(all, pg).map(r => {
        const p = Store.peer(r.id);
        const open = p ? () => openPeerView(r.id, null, null, true) : null;
        return html`<div class=${"uv-row" + (open ? " clk" : "")} key=${r.id} onClick=${open}>
          <span class="uv-nm">${(p && p.title) || r.name || html`<span class="faint">${T("Untitled")}</span>`}${status(r)}</span>
          <span class="u-total">${xferCell(...dlul(r.rx || 0, r.tx || 0))}</span>
        </div>`; })}</div>
        <${ListPager} page=${pg} setPage=${setPage} total=${all.length}/>`}
  <//>`;
}

export function openGroupView(gid, child) { (child ? pushModal : openModal)(html`<${GroupViewSheet} gid=${gid} child=${!!child}/>`); }
export function GroupViewSheet({ gid, child }) {
  useStore();
  const [page, setPage] = useState(1);
  const g = Store.group(gid);
  const e = trafficTotals(trafficModalView);
  const d = e && e.data;
  const rows = (g ? g.users : []).map(uid => { const a = d && d.user.get(uid); return { uid, name: (Store.user(uid) || {}).name || "", rx: a ? a.rx : 0, tx: a ? a.tx : 0 }; })
    .sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
  const pg = Math.min(page, pages);
  return html`<${Sheet} title=${g ? g.name : T("Deleted group")} width=${760} 
    foot=${html`<${Fragment}><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button><span class="grow"></span>
      ${g ? html`<button class="btn btn-ghost" onClick=${() => { closeModal(); if (!child) openGroup(gid); }}><${Ic} i="pencil"/> ${T("Edit group")}</button>` : null}<//>`}>
    ${g ? html`<${Fragment}>
      <${TrafficBlock} by="group" id=${gid}/>
      <div class="lbl" style="margin:18px 2px 6px">${T("Members · {n}", { n: rows.length })}</div>
      ${!rows.length ? html`<div class="empty"><b>${T("No members yet")}</b>${T("Add people to this group and their traffic appears here.")}</div>`
        : html`<div class="uv-list">${pageSlice(rows, pg).map(r => html`<div class="uv-row clk" key=${r.uid} onClick=${() => openUserView(r.uid, true)}>
            <span class="uv-nm">${r.name || html`<span class="faint">${T("Untitled")}</span>`}</span>
            <span class="u-total">${xferCell(...dlul(r.rx, r.tx))}</span>
          </div>`)}</div>
          <${ListPager} page=${pg} setPage=${setPage} total=${rows.length}/>`}
    <//>` : html`<div class="empty"><b>${T("This group was deleted")}</b></div>`}
  <//>`;
}

export function openEditPeer(peer, focus, done, flash) {
  const child = modalDepth() > 0;   // opened from another modal (peer view) → child; closing pops back to it
  (child ? pushModal : openModal)(html`<${EditPeerSheet} peer=${peer} focus=${focus} done=${done || closeModal} flash=${flash} child=${child}/>`);
}
export function EditPeerSheet({ peer, focus, done, flash, child }) {
  done = done || closeModal;
  useStore();                                        // re-render on poll so a target added via the Targets sheet shows up live
  const live = Store.peer(peer.id) || peer;          // LIVE peer (the `peer` prop is a snapshot from open) — used for the target list
  const targetsOrdered = useStableOrder(live.targets);   // frozen at open — the primary ★ won't re-shuffle rows mid-edit
  const [title, setTitle] = useState(peer.title || "");
  const [ips, setIps] = useState(() => Object.fromEntries(live.targets.map(t => [tkey(t.node, t.iface), (t.ip || "").split("/")[0]])));
  useEffect(() => {                                  // a newly-added target appears live → give it an IP field
    setIps(prev => { const next = { ...prev }; let ch = false;
      live.targets.forEach(t => { const k = tkey(t.node, t.iface); if (!(k in next)) { next[k] = (t.ip || "").split("/")[0]; ch = true; } });
      return ch ? next : prev; });
  }, [live.targets.map(t => tkey(t.node, t.iface)).join(",")]);
  const setIpFor = (k, v) => setIps(m => ({ ...m, [k]: v }));
  const [loaded, setLoaded] = useState(false);
  const [confs, setConfs] = useState({});            // "node|iface" -> conf text (those we can rebuild)
  // "node|iface" -> {dns,mtu,keepalive,allowed} for THAT deployment. Was one set for the whole peer, which
  // stopped being expressible once a peer could span kinds — see TargetSettingsSheet.
  const [topts, setTopts] = useState({});
  const setOptsFor = (k, v) => setTopts(m => ({ ...m, [k]: v }));
  const [userId, setUserId] = useState(peer.user_id || "");   // staged owner (applied on Save for an unassigned peer)
  const [priv, setPriv] = useState(peer.private === true);
  const [router, setRouter] = useState(peer.router === true);   // several devices behind this address (S11b)
  const [expDate, setExpDate] = useState(expiryInputVal(peer.ownExpiry || 0));   // this peer's OWN expiry (blank = inherit the subscription's)
  const [msg, setMsg] = useState(flash || null); const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState(null);          // the loaded config values — Save stays off until one differs
  const [rotating, setRotating] = useState(false); // Rotate in flight → the button disables + says so
  // reopening THIS sheet with a new flash (e.g. rotate: orange "Rotating…" → green "Keys rotated")
  // reuses the instance, so the useState initial above is ignored — sync the prop into state.
  useEffect(() => { if (flash) setMsg(flash); }, [flash]);

  useEffect(() => {
    let ok = true;
    (async () => {
      const found = {};
      const _pk = (live && live.pubkey) || peer.pubkey;
      for (const t of (live.targets || peer.targets)) { const c = await getConfig(_pk, t.node, t.iface); if (c) found[tkey(t.node, t.iface)] = c; }
      if (!ok) return;
      setConfs(found); setLoaded(true);
      const seed = {};
      for (const k of Object.keys(found)) { const c = parseFullConf(found[k]);
        seed[k] = { dns: (c.dns || []).join(", "), mtu: String(c.mtu), keepalive: String(c.keepalive), allowed: c.allowed }; }
      setTopts(seed); setOrig(seed);   // baseline for the "anything changed?" Save gate
    })();
    return () => { ok = false; };
  }, [peer.id, live && live.pubkey, Store.configEpoch]);   // LIVE pubkey / epoch change (e.g. after Rotate) re-reads the now-available config

  const editable = Object.keys(confs).length;
  const ipChangedFor = t => { const v = (ips[tkey(t.node, t.iface)] || "").trim(); return !!v && v !== (t.ip || "").split("/")[0]; };
  const ipBadFor = t => { const v = (ips[tkey(t.node, t.iface)] || "").trim(); return !!v && !V.ipv4(v.split("/")[0]); };
  const anyIpBad = peer.targets.some(ipBadFor);
  const optsErr = Object.keys(topts).map(k => { const e = configErrors(topts[k]); const f = Object.keys(e)[0];
    return f ? { k, msg: T("{v1}: {v2}", { v1: k.split("|")[1], v2: e[f] }) } : null; }).find(Boolean);
  const optsChanged = k => !!orig && !!orig[k] && JSON.stringify(topts[k]) !== JSON.stringify(orig[k]);
  // Save is only offered when something would actually change — otherwise it rewrites the peer with identical
  // values (and, for a user change, walks the operator into a confirm for a no-op).
  const _dirty = (title.trim() !== (peer.title || "").trim())
    || (priv !== (peer.private === true))          // ⚠️ or Save stays disabled: this sheet computes dirty from its OWN
    || (router !== (peer.router === true))
    || ((userId || "") !== (peer.user_id || ""))   //    fields, it does not watch input events
    || (expDate !== expiryInputVal(peer.ownExpiry || 0))
    || (live.targets || []).some(ipChangedFor)
    || Object.keys(topts).some(optsChanged);
  const ownerExp = userId ? +(((Store.recon.users || []).find(u => u.id === userId) || {}).expiry || 0) : 0;
  const save = async () => {
    if (anyIpBad) return setMsg({ k: "err", t: T("Each address must be a valid IPv4.") });
    if (optsErr) return setMsg({ k: "err", t: optsErr.msg });
    const expSec = expiryFromInput(expDate);
    // A peer can't outlive its subscription (the server enforces it too — check here for a clean message).
    if (expSec && ownerExp && expSec > ownerExp) return setMsg({ k: "err", t: T("Expiry can't be later than the subscription's (") + fmtDate(ownerExp) + ")." });
    setBusy(true); setMsg({ k: "work", t: T("saving…") });
    let fails = 0;
    try {
      if (title.trim() !== (peer.title || "")) {
        const r = await api.peerUpdate({ peer_id: peer.id, title: title.trim() }); if (!r.ok) fails++;
      }
      if (expSec !== (peer.ownExpiry || 0)) {   // this peer's own expiry date (independent of the subscription's)
        const r = await api.peerUpdate({ peer_id: peer.id, expiry: expSec }); if (!r.ok) { fails++; if (r.error) setMsg({ k: "err", t: srvText(r) }); }
      }
      if (priv !== (peer.private === true)) {
        const r = await api.peerUpdate({ peer_id: peer.id, private: priv }); if (!r.ok) fails++;
      }
      if (router !== (peer.router === true)) {
        const r = await api.peerUpdate({ peer_id: peer.id, router }); if (!r.ok) fails++;
      }
      for (const t of (live.targets || peer.targets)) {
        const k = tkey(t.node, t.iface);
        if (!topts[k] || !optsChanged(k)) continue;
        const ovNew = configOverrides(topts[k], Store.ifaceMeta(t.node, t.iface));
        const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, overrides: ovNew });
        if (!r.ok) fails++;
      }
      // staged assignment of a previously-unassigned peer — keep the key, just set the owner
      if (peer.unassigned && userId && userId !== (peer.user_id || "")) {
        const r = await api.peerUpdate({ peer_id: peer.id, user_id: userId }); if (!r.ok) fails++;
      }
      // rebuild + persist each target's config; any target whose address changed moves on its iface
      for (const t of (live.targets || peer.targets)) {
        const k = tkey(t.node, t.iface); const cur = confs[k];
        const changed = ipChangedFor(t);
        const newIP = (ips[k] || "").trim().split("/")[0];
        if (!cur) {                                  // no config to rebuild (or a keyless deployment) — IP can still move
          if (changed) { const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, ip: newIP }); if (!r.ok) fails++; }
          continue;
        }
        const s = parseFullConf(cur);
        const o = topts[k] || { dns: (s.dns || []).join(", "), mtu: String(s.mtu), keepalive: String(s.keepalive), allowed: s.allowed };
        const addr = (changed ? newIP : (s.address || "").split("/")[0]) + "/32";
        const conf = buildConf({ privkey: s.privkey, address: addr, dns: String(o.dns).split(",").map(x => x.trim()).filter(Boolean), mtu: (String(o.mtu).trim() || 1280), awg_params: s.awg_params, server_pubkey: s.server_pubkey, psk: s.psk, endpoint: s.endpoint, allowed: (String(o.allowed).trim() || "0.0.0.0/0, ::/0"), keepalive: String(o.keepalive).trim() });
        (Store.sessionConfigs[peer.pubkey] = Store.sessionConfigs[peer.pubkey] || {})[k] = conf;
        // No plaintext to the server: the address moves via the roster, and the DNS/MTU/AllowedIPs edits are
        // persisted as roster overrides (the peerUpdate above); the key is unchanged, so the blob still holds it.
        if (changed) { const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, ip: newIP }); if (!r.ok) fails++; }
      }
    } catch (e) { setBusy(false); return setMsg({ k: "err", t: String(e.message || e) }); }
    setBusy(false); Store.configEpoch++;
    // an already-assigned peer changing owner is destructive (keys rotate) — confirm it now, on
    // Save (so cancelling keeps the previous owner). Title/config above are already persisted.
    const oldUid = peer.user_id || "", newUid = userId || "";
    if (oldUid && newUid !== oldUid) {
      await Store.poll();
      const fresh = (Store.recon.peers.find(x => x.id === peer.id)) || peer;
      return newUid ? confirmReassign(fresh, newUid) : confirmUnassign(fresh);   // stacks over this sheet; Cancel pops back
    }
    toast(fails ? T("Saved (some changes couldn't be persisted).") : T("Peer updated."), fails ? "info" : "ok");
    done(); await Store.poll();
  };

  const { hasWdtt, hasCsqtt, hasKeyed } = rotateParts(peer);   // the live peer's, one copy with the phone's Rotate (review F72)
  const isKeyless = !hasKeyed;   // EVERY deployment is self-contained: panel-owned password, no browser keypair
  const isWdttPeer = hasWdtt, isCsqttPeer = hasCsqtt;   // (rotate-link wording below)
  const rotate = () => {
    if (hasKeyed && (hasWdtt || hasCsqtt)) {
      openConfirm({ title: T("Rotate credentials"), confirmLabel: T("Rotate credentials"), warn: true,
        body: T("This peer holds several credentials — a WireGuard keypair and an access password per turn server. All of them are replaced: every config, QR and link this peer already handed out stops working and must be re-imported."),
        onConfirm: () => {
          setRotating(true);
          (async () => {
            try {
              if (hasCsqtt) await api.csqttPeerRotate({ peer_id: peer.id });
              if (hasWdtt) await api.wdttPeerRotate({ peer_id: peer.id });
              await rotatePeerKeys(peer);   // LAST: this changes the pubkey, and the two above address by id
              await Store.poll();
              const re = Store.rowErrors["peer:" + peer.id];
              toast(re ? (re.msg || T("Rotate failed.")) : T("Credentials rotated — send the user their new QR and links; the old ones no longer work."), re ? "err" : "ok");
            } catch (e) { toast(T("Rotate failed."), "err"); }
            finally { setRotating(false); }
          })();
        } });
      return;
    }
    if (isKeyless) {   // keyless turn peer: no browser keypair — rotate the panel-owned access password (revokes the old link)
      const rotateApi = b => (isCsqttPeer ? api.csqttPeerRotate(b) : api.wdttPeerRotate(b));
      openConfirm({ title: T("Rotate link"), confirmLabel: T("Rotate link"), warn: true,
        body: isCsqttPeer
          ? T("A fresh access password is generated. The current csqtt link stops working — send the user their new link (from the subscription page) to re-import.")
          : T("A fresh access password is generated. The current WDTT link stops working — send the user their new link (from the subscription page) to re-import."),
        onConfirm: () => {
          setRotating(true);
          try {
            rotateApi({ peer_id: peer.id })
              .then(async r => {
                await Store.poll();
                toast(r && r.ok ? T("Link rotated — the old one no longer works.") : (srvText(r) || T("Rotate failed.")),
                      r && r.ok ? "ok" : "err");
              })
              .catch(() => toast(T("Rotate failed."), "err"))
              .finally(() => setRotating(false));
          } catch (e) {
            setRotating(false);
            toast(T("Rotate failed."), "err");
          }
        } });
      return;
    }
    openConfirm({ title: T("Rotate keys"), confirmLabel: T("Rotate keys"), warn: true,
      body: T("A fresh keypair and preshared key are generated. The current config stops working — you'll need to send out the fresh QR / config to re-import. Useful if a config may have leaked."),
      onConfirm: () => {
        setRotating(true);
        rotatePeerKeys(peer).then(async () => {
          await Store.poll();
          setRotating(false);
          const re = Store.rowErrors["peer:" + peer.id];
          toast(re ? (re.msg || T("Rotate failed.")) : T("Keys rotated — send the user the new QR / config; the old one no longer works."), re ? "err" : "ok");
        }).catch(() => setRotating(false));
      } });
  };

  const _rp = Store.peer(peer.id) || peer;
  const _isGhostT = t => { const g = t && ghostIface(t.node, t.iface); return !!(g && g.ripe); };
  const _fixT = (focus && (_rp.targets || []).find(t => t.node === focus.node && t.iface === focus.iface))
             || (_rp.targets || []).find(t => t.restorable || t.correctable || _isGhostT(t)) || null;
  const fixBtn = _isGhostT(_fixT)
    ? html`<button class="btn btn-ghost gh" onClick=${() => openRecreateRekey(_fixT.node, _fixT.iface)}><${Ic} i="refresh"/> ${T("Recreate & rekey interface")}</button>`
    : (_fixT && _fixT.restorable)
      ? html`<button class="btn btn-ghost restore" onClick=${() => confirmRestoreDeployment(_rp, _fixT)}><${Ic} i="refresh"/> ${T("Restore interface")}</button>`
      : (_fixT && _fixT.correctable)
        ? html`<button class="btn btn-ghost correct" onClick=${() => confirmCorrectDeployment(_rp, _fixT)}><${Ic} i="check"/> ${T("Fix address")}</button>`
        : html`<button class="btn btn-ghost m-rotate" disabled=${rotating} onClick=${rotate}><${Ic} i="key"/> ${
            (hasKeyed && (hasWdtt || hasCsqtt)) ? (rotating ? T("Rotating credentials…") : T("Rotate credentials"))
            : isKeyless ? (rotating ? T("Rotating link…") : T("Rotate link"))
            : (rotating ? T("Rotating keys…") : T("Rotate keys"))}</button>`;
  return html`<${Sheet} title=${T("Edit peer")} width=${880} onClose=${done} onBack=${child ? done : null} subject=${{ kind: "peer", id: peer.id }}
    foot=${footRow({ left: html`${editable && hasKeyed ? html`<button class="btn btn-ghost" onClick=${() => openPeerConfigs(peer, { child: true })}><${Ic} i="qr"/>QR</button>` : null}<button class="btn btn-ghost" onClick=${() => openAddTarget(peer)}><${Ic} i="copy"/> ${T("Targets")}</button>${hasKeyed
        ? html`<button class="btn btn-ghost" onClick=${() => openPeerNetworks(live)}><${Ic} i="network"/> ${(live.routes || []).length ? T("Networks · {n}", { n: live.routes.length }) : T("Networks")}</button>` : isMobile() ? html`<button class="btn btn-danger m-pdel" onClick=${() => confirmDeletePeer(peer, null, true)}>${T("Delete")}</button>` : null}${fixBtn}${peerBlockBtn(peer)}`, onCancel: done, disabled: busy || !_dirty, title: _dirty ? "" : T("No changes to save"), onAction: save, action: T("Save") })}>
    <${PeerStatusLine} peer=${peer} pos="bar"/>
    <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input autofocus value=${title} maxlength="64" onInput=${e => setTitle(e.target.value)} placeholder=${T("e.g. iPhone, Work laptop")}/></div>
    <div class="field"><label>${T("col|User")}</label>
      <${UserPicker} value=${userId} allowUnassigned=${!peer.unassigned} onChange=${setUserId}/>
      <div class=${"hint"}>${
        peer.unassigned ? T("Pick a user to assign this peer to — the existing key and config are kept, applied when you Save.")
        : (userId || "") === (peer.user_id || "") ? T("Reassigning rotates the keys; you'll confirm on Save and the new user needs a fresh config.")
        : !userId ? T("On Save you'll confirm unassigning — access is revoked and the keys rotate.")
        : T("On Save you'll confirm reassigning — the current user loses access for good and the new user needs a fresh config.")
      }</div></div>
    <div class="field"><label>${T("Access expires")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— this peer only; blank = {fallback}", { fallback: ownerExp ? T("follows the subscription") : T("never") })}</span></label>
      <div class="daterow"><input type="date" class="datein" max=${ownerExp ? expiryInputVal(ownerExp) : ""} value=${expDate} onInput=${e => setExpDate(e.target.value)}/>${expDate ? html`<button class="btn btn-ghost btn-mini" onClick=${() => setExpDate("")}>${T("Clear")}</button>` : null}</div>
      <div class=${"hint"}>${T("On this date the peer stops working (it reappears if you extend it).")}${ownerExp ? T(" Can't be later than the subscription's expiry ({v1}).", { v1: fmtDate(ownerExp) }) : ""}</div></div>
    ${/* ⚠️ Reuses `Switch` and the .toggle-row label shape the panel already uses for a boolean with an explanation
          under it, rather than drawing a new control. The hint is the whole promise in one line, because "private"
          on its own would leave an operator guessing whether it hides the device or only its networks. */""}
    <div class="field"><label class="toggle-row"><${Switch} on=${priv} onChange=${v => setPriv(v)}/><span>${T("Private")}</span></label>
      <div class="hint">${T("Only this user's own devices reach it and the networks behind it — not the people they share a group with, and not everyone on the node, whatever the interface allows.")}</div>
      ${/* ⚠️ The switch promises "not everyone on the node, whatever the interface allows". On a node too old to enforce,
            or one not reporting now, that promise is not kept and NOTHING said so — and this file's own rule is that
            claiming isolation a box does not have is the one answer worse than no answer. */""}
      ${(priv ? privateUnenforced(live || peer) : []).map(u => html`<div class="notice warn" key=${"nx" + u.node + (u.iface || "")}>
        <${Ic} i="warn"/><span>${u.why === "old"
          ? T("Not enforced on {node} — it runs an older version, or hasn't reported yet. Devices there still reach this one.", { node: Store.nodeName(u.node) })
          : u.why === "no_user"
          ? T("Not enforced for {iface} on {node} — the device has no user, so every device there still reaches it.", { iface: u.iface, node: Store.nodeName(u.node) })
          : T("Not enforced for {iface} on {node} — this server build can't prove which address the device has, so every device there still reaches it.",
              { iface: u.iface, node: Store.nodeName(u.node) })}</span></div>`)}
      ${/* ⚠️ THE DIRECTION THAT OPENS SOMETHING. Turning Private OFF hands the device back to whatever its stored share
            says — and for a device that never had one that means everyone on the node, which is invisible from here.
            The ON direction got a warning because consent belongs to the person clicking; so does this one. */""}
      ${!priv && peer.private === true ? (o => html`<div class="notice warn">
        <${Ic} i="warn"/><span>${[T("Saving this opens it again."),
          o.everyoneAt.length
            ? T("The device opens to everyone on {nodes}.", { nodes: namedFew(o.everyoneAt.map(n => Store.nodeName(n))) })
            : T("The device opens as its interface allows."),
          !o.nets ? ""
            : o.nets.mode === "everyone" ? T("The networks behind it open to everyone on the node.")
            : o.nets.mode === "shared" ? T("The networks behind it open to {who}.",
                { who: namedFew([...o.nets.users.map(u => u.name), ...o.nets.groups.map(g => g.name)]) })
            : T("The networks behind it stay with this user's own devices.")].filter(Boolean).join(" ")}</span></div>`)(privateOffOpens(live || peer)) : null}</div>
    ${/* S11b: a router is several devices behind one address — a torrent flag on it cut every other device's high ports
          (a user's report: a NAT router's OpenVPN). Only where it can mean something: a wg/awg deployment; a keyless one
          is not a router. The hint says the cost in the same breath as the gain. */""}
    ${router || routerCapable(live) ? html`<div class="field">
      <label class="toggle-row"><${Switch} on=${router} onChange=${v => setRouter(v)}/><span>${T("Router — several devices share this address")}</span></label>
      <div class="hint">${T("Torrents are still blocked connection by connection, but one device's torrent no longer cuts the other devices' VPNs, calls and games. The cost: an encrypted torrent behind it with DHT off gets through.")}</div></div>` : null}
    <div class="field"><label>${T("label|Deployments")}</label>
      <div class="targetpick">${targetsOrdered.map(t => {
        const k = tkey(t.node, t.iface);
        const ity = targetType(t);
        const sc = isSelfContainedKind(ity);
        return html`<div class="targetopt sel locked" key=${k}>
          <div class="topt-main"><span class="box"><${Ic} i="check"/></span><span class="nm" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")} onMouseEnter=${nmTip}>${Store.nodeName(t.node)}</span><span class="tp">${t.iface}</span></div>
          <div class="topt-right hasprim">
            ${/* a phone has no hover for the star's title, so its word stays (MOBILE-PLAN hook 9) */""}
            <${RoleToggle} peer=${peer} t=${t} compact=${!isMobile()}/>
            <${PubTag} peer=${live} src=${ity} label=${ity} dim=${!t.online} gen3=${tgt3(t)}/>
            <${TargetFrontBadge} node=${t.node} iface=${t.iface} peer=${live}/>
            ${sc
              ? html`<span class="topt-ip faint" title=${ity === "csqtt" ? T("csqtt assigns the address on connect") : T("WDTT assigns the address on connect")}>${T("val|auto IP")}</span>`
              : html`<input class=${"topt-ip " + (ipBadFor(t) ? "bad" : "")} value=${ips[k] || ""} onInput=${e => setIpFor(k, e.target.value)}/>`}
            ${(!sc && confs[k]) ? html`<${TargetGear} node=${t.node} iface=${t.iface} kind=${ity} opts=${topts[k]} onSave=${v => setOptsFor(k, v)}/>` : null}
          </div>
        </div>`;
      })}</div>
      <div class="hint">${hasKeyed
        ? (editable
            ? T("Changing an address moves the peer on that interface. The gear holds that deployment's DNS, MTU and routing.")
            : T("Changing an address moves the peer on that interface."))
        : T("These servers assign each address on connect; the user's link per server is on their subscription. There's no client config (key/DNS/MTU) — the server owns the datapath.")}</div>
    </div>
    ${(hasKeyed && !loaded) ? html`<div class="loading"><span class="spin"></span>${T("loading config…")}</div>` : null}
    ${(hasKeyed && loaded && !editable) ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("The client's private key isn't available, so DNS / MTU / routing can't be rebuilt")}${Store.storeConfigs ? "" : T(" (enable store_configs, or edit right after creating)")}${T(". Title and address can still change.")}</span></div>` : null}
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

const netList = s => String(s || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
// The ranges home routers hand out by default (TP-Link/D-Link/Asus, Netgear, Huawei, Xiaomi, MikroTik, ISP boxes). A network
// overlapping one is unreachable from any home that uses it — the home LAN's own route wins on the user's device.
const HOME_RANGES = ["192.168.0.0/24", "192.168.1.0/24", "192.168.2.0/24", "192.168.8.0/24", "192.168.31.0/24",
  "192.168.88.0/24", "192.168.100.0/24", "10.0.0.0/24"];
const v4Range = s => {                                        // "a.b.c.d[/n]" → [first, last] as integers, or null
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(String(s).trim());
  if (!m || !V.ipv4(m[1]) || (m[2] !== undefined && +m[2] > 32)) return null;
  const size = 2 ** (32 - (m[2] === undefined ? 32 : +m[2])), a = m[1].split(".").reduce((n, o) => n * 256 + +o, 0);
  const lo = Math.floor(a / size) * size;
  return [lo, lo + size - 1];
};
const homeClash = list => list.filter(p => { const r = v4Range(p);
  return r && HOME_RANGES.some(h => { const q = v4Range(h); return r[0] <= q[1] && q[0] <= r[1]; }); });
const netPeerName = id => {
  const q = Store.peer(id);
  return q ? ([q.name, q.title].filter(Boolean).join(" / ") || T("an unnamed peer")) : T("another peer");
};
function netWhy(r, node) {
  const v = { p: r.prefix, a: r.addr || "", node: node || "", by: r.by ? netPeerName(r.by) : "" };
  switch (r.why) {
    case "invalid": return T("{p} isn't a network address.", v);
    case "not_v4": return T("{p} is IPv6 — only IPv4 networks can be carried.", v);
    case "default_route": return T("{p} would send all of the node's internet traffic into this device.", v);
    case "reserved": return T("{p} is a reserved range — loopback, link-local, multicast or cloud metadata.", v);
    case "node_lan": return ((Store.nodes || []).find(n => n.name === node) || {}).lan_share === false
      ? T("{node} is already on {p} ({a}), but it keeps its clients off that network. Turn on “Clients can reach it” under Local network on {node} to let them in.", v)
      : T("{node} is already on {p} ({a}), so its clients reach it without a gateway device.", v);
    case "iface_subnet": return T("{p} overlaps a tunnel subnet on {node} ({a}).", v);
    case "mesh": return T("{p} overlaps a mesh link on {node} ({a}).", v);
    case "node_gateway": return T("{p} contains {a}, the gateway {node} reaches the internet through.", v);
    case "node_panel": return T("{p} contains {a}, the address {node} reaches this panel by.", v);
    case "node_resolver": return T("{p} contains {a}, the DNS server {node} depends on — it could no longer find this panel.", v);
    case "resolver_unknown": return T("{node} can't tell which DNS server it depends on, so it carries no networks.", v);
    case "node_too_old": return T("{node} runs a version that can't check a route is safe — update it to carry networks.", v);
    case "no_snapshot": return T("{node} hasn't reported yet; the network waits until it does.", v);
    case "panel_unknown": return T("{node} hasn't finished a sync yet; the network waits.", v);
    case "self_contained": return T("A turn server deployment has no key, so nothing can be routed through it.", v);
    case "taken": return T("{by} already carries {a} on {node} — a network has one device per node.", v);
    case "takes": return T("{by} carries {p} on {node}, and deploying this device there would take it over. Remove that network from this device first, or choose another node.", v);
    case "overlap": return T("{p} overlaps {a}, which this device already lists.", v);
    case "cap": return T("A device can front at most 8 networks.", v);
    case "blocked": return T("This device is blocked or expired, so it carries nothing.", v);
    case "rolled_back": return T("{node} installed the route and took it straight back out — it moved the path to {a}.", v);
    case "route_exists": return T("{node} already routes {p} through {a}, and leaves that route alone.", v);
    case "share_unsupported": return T("{node} runs a version that can't restrict who reaches a network, so it carries this one for nobody — update it.", v);
    default: return T("{node} couldn't check the route to {p} safely, so it didn't install it.", v);
  }
}

const shareOf = s => {
  if (!(s && typeof s === "object" && s.users && typeof s.users === "object")) return { mode: "everyone", users: {}, groups: {} };
  const groups = s.groups && typeof s.groups === "object" ? { ...s.groups } : {};
  return { mode: Object.keys(s.users).length || Object.keys(groups).length ? "chosen" : "owner", users: { ...s.users }, groups };
};
const storedGroupsOf = peer => (peer && peer.share && peer.share.groups && typeof peer.share.groups === "object") ? peer.share.groups : {};
// The draft's groups to SHOW: every group that exists, and a deleted one only when this draft added it — the panel refuses that one
// until it is removed, so it has to be on screen to remove. A deleted group the device already had is dropped by the next save.
const shownGroups = (draftGroups, stored) => Object.keys(draftGroups || {}).filter(id => Store.group(id) || !(id in stored));
// Does the draft let anyone besides the owner in right now? A group counts only while it exists and has members.
const draftReaches = (userIds, draftGroups) => userIds.length > 0
  || Object.keys(draftGroups || {}).some(id => ((Store.group(id) || {}).users || []).length > 0);
const shareBody = d => d.mode === "everyone" ? null
  : { users: d.mode === "chosen" ? d.users : {}, groups: d.mode === "chosen" ? (d.groups || {}) : {} };
const signOf = m => Object.keys(m || {}).sort().map(k => k + "=" + (m[k] || 0)).join(",");
const shareKey = d => d.mode === "everyone" ? "off" : "on:" + (d.mode === "chosen" ? signOf(d.users) + "|" + signOf(d.groups) : "");
function shareRefused(why) {
  switch (why) {
    case "unknown_user": return T("One of these people no longer exists — remove them and save again.");
    case "date_passed": return T("A date has already passed — pick a later day or leave it empty.");
    case "unknown_group": return T("One of these groups no longer exists — remove it and save again.");
    case "groups_missing": return T("This page is out of date — reload it, then save again.");
    case "too_many": return T("A network can be shared with at most 500 people and groups.");
    default: return T("Access wasn't saved.");
  }
}
const shareUser = id => { const u = Store.user(id); return u ? u.name : T("a user who no longer exists"); };
// Why a grantee's turn-server devices do not reach it (swg-panel-server keyless_sources, docs/NETWORKS-PLAN.md §16).
function shareKeyless(why, name, devices) {
  const o = { name, devices };
  switch (why) {
    case "unenforced": return T("{name}: {devices} on a turn server whose build can't prove who is sending — they can't reach it.", o);
    case "not_connected": return T("{name}: {devices} not connected yet — they reach it once connected.", o);
    case "not_running": return T("{name}: {devices} on a turn server that isn't running.", o);
    case "raw_excluded": return T("{name}: {devices} in ildarmaga's raw mode, which can't reach a restricted network.", o);
    default: return T("{name}: {devices} not reported by the node yet.", o);
  }
}

function NetShare({ peer, draft, setDraft, nodes, noShare, routes }) {
  const owner = peer.user_id ? Store.user(peer.user_id) : null;
  // The owner is in regardless and never stored as a grantee; after a reassignment the new owner can still sit in the stored
  // list, and was shown twice — once as the owner, once as someone chosen.
  const ids = Object.keys(draft.users).filter(id => id !== peer.user_id).sort((a, b) => shareUser(a).localeCompare(shareUser(b)));
  const gids = shownGroups(draft.groups, storedGroupsOf(peer));
  const reaches = draftReaches(ids, draft.groups);
  const everyone = nodes.length === 1 ? T("Everyone on {node}", { node: nodes[0] }) : T("Everyone on its nodes");
  const modes = [...(owner ? [["owner", T("Only {name}", { name: owner.name })]] : []), ["everyone", everyone], ["chosen", T("People you choose")]];
  const label = T("Who can reach these networks");
  const openList = () => pushModal(html`<${ShareListSheet} peer=${peer} users=${draft.users} groups=${draft.groups || {}} routes=${routes}
    onApply=${(u, g) => setDraft(d => ({ ...d, mode: "chosen", users: u, groups: g }))}/>`);
  const pick = m => { setDraft(d => ({ ...d, mode: m })); if (m === "chosen" && !ids.length && !gids.length) openList(); };
  if (peer && peer.private) {
    return html`<div class="netshare">
      <label class="netshare-l">${label}</label>
      <div class="notice warn"><${Ic} i="warn"/><span>${T("This device is Private, so these networks are its owner's alone. Turn Private off in the device's own settings to share them.")}</span></div>
      ${/* ⚠️ "Its owner's alone" and it has NO owner: share_grants hands out nothing, so these networks reach no one at
            all. The sentence that used to explain an empty audience lives in the control this guard replaces, so
            without it the operator met a Save button that had silently greyed out and no reason anywhere on screen. */""}
      ${!owner ? html`<div class="hint">${T("This device has no owner yet, so nobody reaches these networks. Assign it to a user, or turn Private off.")}</div>` : null}
    </div>`;
  }
  return html`<div class="netshare">
    <label class="netshare-l">${label}</label>
    <div class="netshare-row">
      <div class="dpsw netsw-share" role="radiogroup" aria-label=${label}>${modes.map(([m, l]) => html`<button type="button" role="radio"
        aria-checked=${draft.mode === m} class=${draft.mode === m ? "on" : ""} onClick=${() => pick(m)}>${l}</button>`)}</div>
      ${draft.mode === "chosen" ? html`<button type="button" class=${"netshare-count" + (!reaches && !owner ? " bad" : "")} onClick=${openList}>
        <${Ic} i="users"/><span>${gids.length && ids.length ? T("Shared with {groups} and {users}", { groups: plural(gids.length, "group"), users: plural(ids.length, "user") })
          : gids.length ? T("Shared with {groups}", { groups: plural(gids.length, "group") })
          : ids.length ? T("Shared with {users}", { users: plural(ids.length, "user") }) : T("Choose people")}</span></button>` : null}
    </div>
    ${/* NETWORKS P5 S8: a node that can't enforce a restriction carries a restricted network for NOBODY. Said at the choice,
          before the save — further down it was one reason line among many, and "Only Alice" read as simply broken. */""}
    ${draft.mode !== "everyone" && noShare.length ? html`<div class="notice warn"><${Ic} i="warn"/><span>${owner
        ? T("{nodes} runs an older version that can't limit who reaches a network, so with this choice nobody reaches them there — {name} included. Update {nodes}, or choose “{everyone}”.", { nodes: noShare.join(", "), name: owner.name, everyone })
        : T("{nodes} runs an older version that can't limit who reaches a network, so with this choice nobody reaches them there. Update {nodes}, or choose “{everyone}”.", { nodes: noShare.join(", "), everyone })}</span></div>` : null}
    ${draft.mode === "owner" && owner ? html`<div class="hint">${T("Only {name}'s own devices on the same node reach them.", { name: owner.name })}</div>` : null}
    ${draft.mode === "everyone" ? html`<div class="hint">${T("Every device on the same node reaches them — the report below says how many.")}</div>` : null}
    ${draft.mode === "chosen" ? html`<div class=${"hint" + (!reaches && !owner ? " err" : "")}>${owner
        ? T("{name} always has access, as the owner, and so do the people you choose.", { name: owner.name })
        : reaches ? T("Only the people you choose have access.")
        : T("Nobody has access yet — choose people, or pick “{everyone}”.", { everyone })}</div>` : null}
  </div>`;
}

// a list sized by the fleet, not by the operator
const NET_PAGE = LIST_PAGE, pageOf = pageSlice, NetPager = ListPager;   // the shared pager (js/ui.js), also the user sheet's
// Rows inside a disclosure, paged; `total` is the server's count when it capped the list it sent.
function NetPagedRows({ rows, total, render }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / NET_PAGE)), pg = Math.min(page, pages);
  return html`${pageOf(rows, pg).map(render)}
    ${total > rows.length && pg === pages ? html`<div class="hint">${T("…and {v1} more", { v1: total - rows.length })}</div>` : null}
    <${NetPager} page=${pg} setPage=${setPage} total=${rows.length}/>`;
}

function ShareListSheet({ peer, users: initial, groups: initialGroups, routes, onApply }) {
  useStore();          // a group deleted while this window is open must turn into its "no longer exists" row on the next poll
  const owner = peer.user_id ? Store.user(peer.user_id) : null;
  const [users, setUsers] = useState(() => { const u = { ...(initial || {}) }; delete u[peer.user_id]; return u; });
  const [groups, setGroups] = useState(() => ({ ...(initialGroups || {}) }));
  const [q, setQ] = useState(""), [page, setPage] = useState(1), [rep, setRep] = useState(null), [err, setErr] = useState("");
  const dirtyRef = useRef(false), closeRef = useRef(null), cleanRef = useRef(null), base = useRef(null);
  const key = signOf(users) + "|" + signOf(groups);
  if (base.current === null) base.current = key;
  dirtyRef.current = key !== base.current;
  // The draft is unchanged when someone ELSE deletes one of its groups, so the preview is asked again on that too — the panel's
  // refusal is what tells the operator to remove the row before Apply, instead of the Networks window failing after it.
  const goneKey = Object.keys(groups).filter(id => !Store.group(id)).sort().join(",");
  useEffect(() => {
    let ok = true;
    const h = setTimeout(async () => {
      try {
        const r = await api.peerNetworks({ peer_id: peer.id, routes, share: { users, groups } });
        if (!ok) return;
        if (r && r.ok) { setRep(r.data); setErr(""); } else setErr(r && r.code === "share_refused" ? shareRefused(r.why) : (srvText(r) || T("Couldn't check these networks.")));
      } catch (e) { if (ok) setErr(T("Couldn't check these networks.")); }
    }, 350);
    return () => { ok = false; clearTimeout(h); };
  }, [key, goneKey]);
  const reach = {};                                      // uid → devices that reach it, summed over the device's nodes
  for (const t of (rep && rep.targets) || []) for (const g of ((t.share || {}).grants || [])) {
    const w = g.keyless_why || {}, soon = w.not_connected || 0;
    const r = reach[g.user_id] = reach[g.user_id] || { ok: 0, soon: 0, no: 0, nodes: [] };
    r.ok += g.devices || 0; r.soon += soon; r.no += Math.max(0, (g.keyless || 0) - soon);
    r.nodes.push({ node: Store.nodeName(t.node), g });
  }
  const byName = (a, b) => shareUser(a).localeCompare(shareUser(b));
  const all = Object.keys(users).sort(byName);
  // GROUPS (docs/GROUPS-PLAN.md G11): a group is a row of its own, first; a deleted one is not shown (it grants nothing)
  const gname = id => { const g = Store.group(id); return g ? g.name : T("a group that no longer exists"); };
  const byGroup = (a, b) => gname(a).localeCompare(gname(b));
  const allG = shownGroups(groups, storedGroupsOf(peer)).sort(byGroup);   // a deleted group this window added stays, to be removed
  const list = [...allG.map(id => ({ g: true, id })), ...all.map(id => ({ g: false, id }))];
  const ql = q.trim().toLowerCase();
  const rows = ql ? list.filter(r => (r.g ? gname(r.id) : shareUser(r.id)).toLowerCase().includes(ql)) : list;
  const pages = Math.max(1, Math.ceil(rows.length / NET_PAGE)), pg = Math.min(page, pages);
  const add = id => {
    if (!id || id === peer.user_id || id in users) return;
    setUsers(u => ({ ...u, [id]: 0 })); setQ("");
    setPage(Math.floor((allG.length + [...all, id].sort(byName).indexOf(id)) / NET_PAGE) + 1);   // to the page the new person lands on
  };
  const addGroup = id => {
    if (!id || id in groups) return;
    setGroups(g => ({ ...g, [id]: 0 })); setQ("");
    setPage(Math.floor([...allG, id].sort(byGroup).indexOf(id) / NET_PAGE) + 1);
  };
  const drop = r => (r.g ? setGroups : setUsers)(m => { const n = { ...m }; delete n[r.id]; return n; });
  const apply = () => { onApply(users, groups); dirtyRef.current = false; if (cleanRef.current) cleanRef.current(); closeModal(); };
  const typedOnly = () => { if (cleanRef.current) cleanRef.current(); };
  const devices = id => {
    const r = reach[id];
    if (!rep) return html`<span class="faint">…</span>`;
    if (!r) return html`<span class="faint">—</span>`;
    const parts = [[r.ok, "ok"], [r.soon, "soon"], [r.no, "no"]].filter(([n]) => n);
    const trigger = html`<span class=${"netdev" + (parts.length ? "" : " none")}>${parts.length
      ? parts.map(([n, c]) => html`<span class=${"netdev-n " + c}>${n}</span>`) : T("no device")}<${Ic} i="info"/></span>`;
    return html`<${Popover} hoverOnly cls="netdev-pop" popCls="netroute-bub" trigger=${trigger}>
      <span class="netroute-h">${shareUser(id)}</span>
      ${r.nodes.map(({ node, g }) => html`<div class="netbub-row"><b>${node}</b> — ${g.devices
          ? T("{devices} with access",{ devices: plural(g.devices, "device") }) : (g.keyless ? T("no device reaches it yet") : T("no device here"))}</div>
        ${Object.entries(g.keyless_why || {}).map(([w, n]) => html`<div class="netbub-row sub">${shareKeyless(w, shareUser(id), plural(n, "device"))}</div>`)}`)}
    <//>`;
  };
  // A group's devices: the sum over its members, and the members on hover — ten named, the rest counted.
  const groupDevices = id => {
    if (!Store.group(id)) return html`<span class="faint">—</span>`;
    if (!rep) return html`<span class="faint">…</span>`;
    const mem = (Store.group(id) || { users: [] }).users;
    let ok = 0, soon = 0, no = 0;
    const withDev = [], without = [];
    for (const u of mem) {
      const r = reach[u];
      if (r && r.ok + r.soon + r.no) { ok += r.ok; soon += r.soon; no += r.no; withDev.push([u, r]); } else without.push(u);
    }
    const parts = [[ok, "ok"], [soon, "soon"], [no, "no"]].filter(([n]) => n);
    const trigger = html`<span class=${"netdev" + (parts.length ? "" : " none")}>${parts.length
      ? parts.map(([n, c]) => html`<span class=${"netdev-n " + c}>${n}</span>`) : T("no device")}<${Ic} i="info"/></span>`;
    return html`<${Popover} hoverOnly cls="netdev-pop" popCls="netroute-bub" trigger=${trigger}>
      <span class="netroute-h">${gname(id)}</span>
      ${!mem.length ? html`<div class="netbub-row sub">${T("No members yet.")}</div>` : null}
      <${CapList} items=${withDev} cap=${10} row=${([u, r]) => html`<div class=${"netbub-row nb-dot " + (r.ok ? "ok" : r.soon ? "soon" : "no")} key=${u}><b>${shareUser(u)}</b> — ${r.ok
        ? T("{devices} with access",{ devices: plural(r.ok, "device") }) : T("no device reaches it yet")}</div>`}/>
      ${without.length ? html`<div class="netbub-row sub">${T("{users} with no device here", { users: plural(without.length, "user") })}</div>` : null}
    <//>`;
  };
  return html`<${Sheet} title=${T("People with access")} width=${680} dirtyRef=${dirtyRef} closeRef=${closeRef} cleanRef=${cleanRef}
    subject=${{ kind: "peer", id: peer.id }}
    foot=${html`<${Fragment}><span class="faint">${allG.length && all.length ? T("{groups} and {users} chosen", { groups: plural(allG.length, "group"), users: plural(all.length, "user") })
        : allG.length ? T("{groups} chosen", { groups: plural(allG.length, "group") }) : T("{users} chosen", { users: plural(all.length, "user") })}</span><span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" onClick=${() => (closeRef.current ? closeRef.current() : closeModal())}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${!!err} onClick=${apply}>${T("Apply")}</button><//>`}>
    ${owner ? html`<div class="hint sharelead">${T("{name} always has access, as the owner.", { name: owner.name })}</div>` : null}
    <div class="sharebar" onInput=${typedOnly} onChange=${typedOnly}>
      <div class="sharebar-add"><${UserPicker} value=${null} placeholder=${T("Add a person or group…")} exclude=${[peer.user_id, ...all].filter(Boolean)}
        groups=${Store.groups().filter(g => !(g.id in groups))} onGroup=${addGroup} onChange=${add}/></div>
      ${list.length > NET_PAGE ? html`<input class="sharebar-filter" value=${q} data-enter="self" placeholder=${T("Filter the list…")}
          aria-label=${T("Filter the list…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
    </div>
    ${err ? html`<div class="formmsg err">${err}</div>` : null}
    ${list.length ? html`<div class="sharegrid" role="table" onInput=${typedOnly} onChange=${typedOnly}>
        <div class="sharegrid-h" role="row"><span>${allG.length ? T("col|User or group") : T("col|User")}</span><span>${T("Devices")}</span><span>${T("Access until")}</span><span></span></div>
        ${pageOf(rows, pg).map(r => { const nm = r.g ? gname(r.id) : shareUser(r.id), m = r.g ? groups : users;
          const gone = r.g && !Store.group(r.id);
          return html`<div class=${"sharegrid-r" + (r.g ? " grp" : "") + (gone ? " gone" : "")} role="row" key=${(r.g ? "g:" : "u:") + r.id}>
          <span class="nm">${r.g ? html`<${Ic} i="users"/>${nm}${gone ? null : html`<span class="faint sharegrid-sub">${plural(Store.group(r.id).users.length, "member")}</span>`}` : nm}</span>
          <span>${r.g ? groupDevices(r.id) : devices(r.id)}</span>
          <span><input type="date" class="datein" value=${expiryInputVal(m[r.id])} data-enter="self" data-noautofocus
            aria-label=${T("Last day {name} can reach them — leave empty for no end", { name: nm })}
            onInput=${e => { const v = expiryFromInput(e.target.value); (r.g ? setGroups : setUsers)(x => ({ ...x, [r.id]: v })); }}/></span>
          <span><button type="button" class="btn btn-ghost btn-mini" title=${T("Stop sharing with {name}", { name: nm })}
            aria-label=${T("Stop sharing with {name}", { name: nm })} onClick=${() => drop(r)}><${Ic} i="x"/></button></span></div>`; })}
        ${!rows.length ? html`<div class="sharegrid-empty">${T("Nobody on the list matches “{q}”.", { q })}</div>` : null}
      </div>
      <${NetPager} page=${pg} setPage=${setPage} total=${rows.length}/>
      <div class="hint">${T("A date is the last day they can reach these networks; leave it empty for no end.")}</div>`
    : html`<div class="sharegrid-empty">${T("Nobody yet — add people or groups with the search above.")}</div>`}
  <//>`;
}

function NetCounts({ t, node }) {
  const s = t.share, c = (s && s.cut_off) || {}, st = s && s.node;
  let soonKl = 0, noKl = 0;
  for (const g of (s && s.grants) || []) { const w = g.keyless_why || {}; soonKl += w.not_connected || 0; noKl += Math.max(0, (g.keyless || 0) - (w.not_connected || 0)); }
  const widen = t.widen_total || 0;
  const ok = Math.max(0, (t.audience.peers || 0) - widen), soon = widen + soonKl, no = (s ? c.peers || 0 : 0) + noKl;
  const au = { node, peers: plural(t.audience.peers || 0, "peer"), users: plural(t.audience.users || 0, "gen|user") };
  const lines = [["ok", s ? (t.audience.peers ? T("{peers} of {users} can reach it", au) : T("Nobody on {node} can reach it yet", au))
    : (t.audience.peers ? T("Every client on {node} can reach it: {peers} of {users}", au) : T("No other client is on {node} yet — anyone added there will reach it", au))]];
  if (widen) lines.push(["soon", T("{peers} route around it — see “Narrowed routing” below", { peers: plural(widen, "peer") })]);
  if (soonKl) lines.push(["soon", T("{devices} not connected yet — they reach it once connected", { devices: plural(soonKl, "device") })]);
  if (s && c.peers) lines.push(["no", T("{peers} aren't among the people with access", { peers: plural(c.peers, "peer") })]);
  if (noKl) lines.push(["no", T("{devices} on turn servers that can't reach a restricted network", { devices: plural(noKl, "device") })]);
  // Site to site: a device that fronts a network is a source too, so the devices on ITS network reach this one only when its
  // owner has access. Named, with its networks and the reason — the first three; the rest counted.
  const provs = c.providers || [];
  const provShown = capShown(provs.length, 3);   // four named rather than three and "…and 1 more"
  provs.slice(0, provShown).forEach(o => { const q = Store.peer(o) || {};
    const v = { device: netPeerName(o), nets: (q.routes || []).join(", "), owner: q.user_id ? shareUser(q.user_id) : "" };
    lines.push(["no", q.user_id
      ? T("Devices on the network behind {device} ({nets}) can't reach it either — {owner} isn't among the people with access.", v)
      : T("Devices on the network behind {device} ({nets}) can't reach it either — that device has no owner, so it can't be given access.", v)]); });
  if (provs.length > provShown) lines.push(["no", T("…and {v1} more", { v1: provs.length - provShown })]);
  if (s && (s.lapsed || []).length) lines.push(["off", T("Access has ended for {users}", { users: plural(s.lapsed.length, "user") })]);
  if (s && (s.lapsed_groups || []).length) lines.push(["off", T("Access has ended for {groups}", { groups: plural(s.lapsed_groups.length, "group") })]);
  if (s && !st) lines.push(["off", T("{node} hasn't confirmed the restriction yet — it does on its next sync.", { node })]);
  const aria = T("{total} other peers on {node}: {ok} can reach it, {soon} not yet, {no} can't", { total: ok + soon + no, node, ok, soon, no });
  return html`<${Popover} hoverOnly cls="netcount-pop" popCls="netroute-bub" trigger=${html`<span class="netcount" aria-label=${aria}>
      ${ok ? html`<span class="n ok">${ok}</span>` : null}${soon ? html`<span class="n soon">${soon}</span>` : null}${no ? html`<span class="n no">${no}</span>` : null}${ok + soon + no ? null : html`<span class="n zero">0</span>`}</span>`}>
    <span class="netroute-h">${T("Who can reach it on {node}", { node })}</span>
    ${lines.map(([cls, txt]) => html`<div class=${"netbub-row nb-dot " + cls}>${txt}</div>`)}
  <//>`;
}

function NetworksBadge({ peer }) {
  const n = (peer.routes || []).length;
  const blocked = !!(peer.selfDisabled || peer.userDisabled) || peer.status === "expired";
  const down = blocked || !peer.targets.some(t => !isSelfContainedKind(targetType(t)) && t.online);
  return html`<${Popover} hoverOnly cls="grp-pop" popCls="netroute-bub netbub-wide"
    trigger=${html`<button type="button" class=${"badge ic b-nets " + (down ? "warn" : "on")} onClick=${() => openPeerNetworks(peer)}
      aria-label=${T("Who reaches the networks behind this device")}>
      <${Ic} i=${down ? "warn" : "network"}/>${T("Networks · {n}", { n })}</button>`}>
    <${ReachedByBody} peer=${peer} blocked=${blocked} down=${down} onView=${() => openPeerNetworks(peer)}/>
  <//>`;
}

export function openPeerNetworks(peer) { (modalDepth() > 0 ? pushModal : openModal)(html`<${NetworksSheet} pid=${peer.id}/>`); }

function NetworksSheet({ pid }) {
  useStore();
  const found = Store.peer(pid);
  const peer = found || { id: pid, routes: [], targets: [] };
  const owner = peer.user_id ? Store.user(peer.user_id) : null;
  const stored = peer.routes || [];
  const storedKey = stored.join(",");
  const [draft, setDraft] = useState(stored.join(", "));
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({});
  const [rk, setRk] = useState(0);                             // bumped when a deployment's routing is saved from a node's line
  const dirtyRef = useRef(false), closeRef = useRef(null), cleanRef = useRef(null), base = useRef(null);
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  const want = netList(draft);
  const wantKey = want.join(",");
  // A NEW network starts private to its owner: open to everyone on the node the moment it is saved was the old default,
  // and the report explaining the exposure arrived only after the fact. A stored network keeps its stored audience.
  const [share, setShare] = useState(() => {
    const d = stored.length ? shareOf(peer.share) : { mode: owner ? "owner" : "chosen", users: {}, groups: {} };
    return (!owner && d.mode === "owner") ? { ...d, mode: "chosen" } : d;
  });
  const shareDraftKey = shareKey(share);
  const shareStoredKey = stored.length ? shareKey(shareOf(peer.share)) : "";
  const shareDirty = want.length > 0 && shareDraftKey !== shareStoredKey;
  const nodes = [...new Set((peer.targets || []).filter(t => !isSelfContainedKind(targetType(t))).map(t => Store.nodeName(t.node)))];
  const reqKey = wantKey + "|" + shareDraftKey;                // the draft a report answers — anything else on screen is stale
  useEffect(() => {
    if (!want.length && !stored.length) { setRep(null); return; }
    let ok = true;
    const h = setTimeout(async () => {
      try {
        const r = await api.peerNetworks({ peer_id: pid, routes: want, ...(want.length ? { share: shareBody(share) } : {}) });
        if (ok) setRep(r && r.ok ? { ...r.data, _for: wantKey, _key: reqKey } : { targets: [], refusals: [], _key: reqKey,
          error: r && r.code === "share_refused" ? shareRefused(r.why) : (srvText(r) || T("Couldn't check these networks.")) });
      } catch (e) {
        if (ok) setRep({ targets: [], refusals: [], _key: reqKey, error: T("Couldn't check these networks.") });
      }
    }, 350);
    return () => { ok = false; clearTimeout(h); };
  }, [wantKey, pid, storedKey, shareDraftKey, rk]);
  const refusals = (rep && rep.refusals) || [];
  // Compared NORMALISED: the operator types `172.30.9.9`, the roster stores `172.30.9.9/32`.
  const normKey = (rep && rep.routes && rep._for === wantKey) ? rep.routes.join(",") : wantKey;
  const dirty = normKey !== storedKey || shareDirty;
  dirtyRef.current = dirty;
  if (base.current === null) base.current = storedKey + "|" + shareStoredKey;
  // Someone else saved these networks while this window was open (another operator, another tab): saving now would put the
  // old list back over theirs without a word. Caught on the poll that brings their change, before anything is written.
  const stale = storedKey + "|" + shareStoredKey !== base.current;
  const nobody = want.length > 0 && !owner && !peer.private && share.mode === "chosen" && !draftReaches(Object.keys(share.users), share.groups);
  const noShare = ((rep && rep.targets) || []).filter(x => x.can_share === false).map(x => Store.nodeName(x.node));
  const clash = homeClash(want);
  const checking = (want.length > 0 || stored.length > 0) && (!rep || rep._key !== reqKey);
  const name = peer.title || (owner ? owner.name : T("Unassigned peer"));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.peerUpdate({ peer_id: pid, routes: want, share: shareBody(share) });
      if (r && r.ok) {
        dirtyRef.current = false; if (cleanRef.current) cleanRef.current();
        toast(T("Networks saved."), "ok");
        closeModal(); Store.poll();
      }
      else if (r && r.refusals) setRep(x => ({ ...(x || { targets: [] }), refusals: r.refusals }));
      else toast(r && r.code === "share_refused" ? shareRefused(r.why) : (srvText(r) || T("Networks weren't saved.")), "err");
    } finally { setBusy(false); }
  };
  const remove = () => pushModal(html`<${ConfirmSheet} title=${T("Remove networks?")} confirmLabel=${T("Remove networks")} danger=${true}
    body=${T("{device} stops routing {nets}. Everyone who reaches them through it loses access.", { device: name, nets: stored.join(", ") })}
    onConfirm=${async () => {
      const r = await api.peerUpdate({ peer_id: pid, routes: [], share: null });
      if (r && r.ok) { dirtyRef.current = false; toast(T("Networks removed."), "ok"); closeModals(2); Store.poll(); }
      else toast(srvText(r) || T("Networks weren't saved."), "err");
    }}/>`);
  if (!found) return html`<${Sheet} title=${T("Networks")} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}><div class="empty"><b>${T("Peer not found")}</b>${T("It may have been removed.")}</div><//>`;
  return html`<${Sheet} title=${T("Networks · {name}", { name })} width=${680} dirtyRef=${dirtyRef} closeRef=${closeRef} cleanRef=${cleanRef}
    subject=${{ kind: "peer", id: pid }}
    foot=${html`<${Fragment}>
      ${stored.length ? html`<button class="btn btn-danger" disabled=${busy} onClick=${remove}>${T("Remove networks")}</button>` : null}
      <span class="grow"></span>
      <button class="btn btn-ghost btn-dismiss" onClick=${() => (closeRef.current ? closeRef.current() : closeModal())}>${T("Cancel")}</button>
      ${/* An emptied field saves as a removal, through the same confirm — Save used to just grey out, which read as broken. */""}
      <button class="btn btn-primary" disabled=${busy || !dirty || stale || nobody || (!want.length && !stored.length) || refusals.length > 0}
        onClick=${want.length ? save : remove}>${busy ? T("saving…") : T("Save")}</button><//>`}>
    <div class="field netfield">
      <label>${T("Networks behind this device")}</label>
      <input class=${"mono" + (refusals.length ? " bad" : "")} value=${draft} onInput=${e => setDraft(e.target.value)}
        placeholder="192.168.1.0/24, 10.20.0.0/16" autocomplete="off" spellcheck="false" autofocus/>
      <div class="hint">${T("Networks this device routes for, like the office LAN behind a router. Clients on the same node reach them through it.")}</div>
      ${/* Feature 11: peer-to-peer needs nothing built — two devices on a node reach each other — and operators do not know
            that. Said here, where someone reaching for "connect devices" will look. ⚠️ DEVICE ACCESS (§10.6): only TRUE where
            every interface this device is on is at Everyone; anywhere else its interface decides, and the sentence says so.
            A device deployed nowhere is on no interface, so it gets no peer-to-peer claim either (§11.2 F7). */""}
      <div class="hint">${(ts => ts.length > 0 && ts.every(t => {
          const nr = (Store.nodes || []).find(x => x.id === t.node) || {};
          const c = (nr.wdtt_cfg || {})[t.iface] || (nr.csqtt_cfg || {})[t.iface];
          // ⚠️ …and not for a PRIVATE device: on an Everyone interface every other device still reaches its neighbours, but
          // this one is reached only by its user's own devices, which is not what the claim below promises.
          return ((c ? c.reach : (Store.ifaceMeta(t.node, t.iface) || {}).reach) || "user") === "everyone"; }))(
          peer.private ? [] : (peer.targets || []).filter(t => t && t.node && t.iface))
        ? T("Devices on the same node already reach each other at their tunnel addresses — that needs nothing here.")
        : T("Other devices reach this one at its tunnel address only as its interface allows — “Who can open connections to devices here”, in the interface's settings.")}</div>
      ${!want.length && stored.length ? html`<div class="hint">${T("Saving with no networks removes them — you'll be asked first.")}</div>` : null}
      ${stale ? html`<div class="formmsg err">${T("Someone changed these networks while this window was open. Cancel and open it again to see the latest.")}</div>` : null}
      ${rep && rep.error ? html`<div class="formmsg err">${rep.error}</div>` : null}
      ${refusals.length ? html`<div class="netref">${refusals.map(r => html`<div><${Ic} i="warn"/><span>${netWhy(r, r.node ? Store.nodeName(r.node) : "")}</span></div>`)}</div>` : null}
      ${/* The trap nobody on the panel side can see: a user whose home LAN uses the same range reaches their own printer, not
            the office — "works on mobile data, not at home". Only the common home-router ranges; a hint, never a refusal. */""}
      ${clash.length ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Many home routers use {list}. Anyone whose home network uses the same addresses can't reach it from home — their own network wins — though it still works on mobile data. If you can, renumber this network to something rarer, like 10.57.20.0/24.", { list: clash.join(", ") })}</span></div>` : null}
      ${want.length ? html`<${NetShare} peer=${peer} draft=${share} setDraft=${setShare} nodes=${nodes} noShare=${noShare} routes=${want}/>` : null}
      ${checking ? html`<div class="loading"><span class="spin"></span>${T("Checking these networks…")}</div>` : null}
      ${((rep && rep.targets) || []).map(t => html`<${NetNode} key=${t.node} t=${t} open=${open} toggle=${toggle} stored=${stored} onSaved=${() => setRk(x => x + 1)}
          kaOff=${((rep && rep.keepalive_off) || []).includes(t.node)} pid=${pid} testable=${normKey === storedKey && !shareDirty}/>`)}
    </div>
  <//>`;
}

function netProbeSays(v, node) {
  const r = v.result || {};
  const o = { addr: v.addr, node, port: v.port || "", ms: r.ms, from: r.from || "", dev: r.dev || "", detail: r.detail || "" };
  switch (r.verdict) {
    // Measured on the rig: this device's OWN address on its network answers with forwarding off, so an answer is
    // only proof when it came from something behind it. Said with the answer, the one moment it could mislead.
    case "answered": return ["on", T("{addr} answered through {node} in {ms} ms.", o),
      T("That proves the path only if {addr} is a device on the network — this device's own address there answers even when it passes nothing on.", o)];
    case "refused_port": return ["on", T("{addr} answered through {node} in {ms} ms — port {port} is closed, but the network is reachable.", o), null];
    case "unreachable": return ["blocked", r.from ? T("The device passed it on, and {from} replied that nothing is at {addr}. Check the address.", o)
      : T("The device passed it on, but nothing is at {addr}. Check the address.", o), null];
    case "no_answer": return ["blocked", T("{node} sent it through the device, which is connected, and nothing came back. The device has to pass traffic on to its network and send the answers back — see “Set up the device's side”.", o),
      v.port ? null : T("Some devices ignore pings. If {addr} might, test a port it listens on.", o)];
    case "gateway_offline": return ["off", T("The device isn't connected to {node}, so nothing reaches {addr} through it.", o), null];
    case "no_route": return ["off", T("{node} doesn't carry this network, so nothing was sent.", o),
      netWhy({ prefix: v.prefix, why: r.why, addr: r.raddr }, node)];
    case "route_elsewhere": return ["off", r.dev ? T("{node} would send {addr} out through {dev}, not through this device, so nothing was sent — clients on this interface can't reach it either.", o)
      : T("{node} has no route to {addr} yet, so nothing was sent.", o), null];
    case "no_acl": return ["off", T("{node} doesn't let this device carry {addr} yet, so nothing was sent. It catches up within a sync — test again in a moment.", o), null];
    case "not_carried": return ["off", T("{node} isn't sending {addr} through this device, so it didn't test it.", o), null];
    case "network_address": return ["off", T("{addr} is the network's own address or its broadcast — test a device on it.", o), null];
    case "no_source": return ["off", T("{node} can't read its own address on this interface, so it had nothing to send from.", o), null];
    case "expired": return ["off", r.collected ? T("{node} took the test but never answered — it may run a version that can't test networks. Update it.", o)
      : T("{node} didn't pick up the test in time. Check it's online, then test again.", o), null];
    default: return ["off", r.detail ? T("{node} couldn't run the test: {detail}", o) : T("{node} couldn't run the test.", o), null];
  }
}

// Why the panel would not arm a test (net_probe_refusal), in words. → lines.
function netProbeRefused(b, node, addr) {
  const d = b.detail || {};
  const o = { addr, node, p: d.prefix || "" };
  switch (b.why) {
    case "bad_address": return [T("{addr} isn't an IPv4 address.", o)];
    case "bad_port": return [T("A port is a number from 1 to 65535.", o)];
    case "not_deployed": return [T("This device isn't on {node}.", o)];
    case "node_offline": return [T("{node} isn't syncing, so it can't run a test right now.", o)];
    case "network_address": return [T("{addr} is the network's own address or its broadcast — test a device on it.", o)];
    case "busy": return [T("{node} is already running a test — try again in a few seconds.", o)];
    case "not_carried": return d.because ? [T("{addr} is in {p}, which this device doesn't carry:", o), netWhy({ prefix: d.prefix, ...d.because }, node)]
      : [T("{addr} isn't in a network this device carries on {node}, so it can't be tested from there.", o)];
    default: return [srvText(b) || T("Couldn't start the test.", o)];
  }
}

function NetProbe({ pid, nid, node, nets, restricted }) {
  const [addr, setAddr] = useState("");
  const [port, setPort] = useState("");
  const [test, setTest] = useState(null);       // the panel's view of the latest test on this node
  const [msg, setMsg] = useState(null);          // why a test was not armed, as lines
  const pending = !!test && test.state === "pending";
  useEffect(() => {                              // a test still running, or just answered, when the sheet opens
    let ok = true;
    api.peerNetworkProbe({ peer_id: pid }).then(r => {
      const x = r && r.ok ? (r.data || []).find(q => q.node === nid) : null;
      if (ok && x) setTest(x);
    }).catch(() => {});
    return () => { ok = false; };
  }, [pid, nid]);
  useEffect(() => {                              // the answer arrives within a couple of syncs; the panel expires it at 45 s
    if (!pending) return;
    let ok = true, n = 0;
    const h = setInterval(async () => {
      if (++n > 60) { clearInterval(h); return; }
      try {
        const r = await api.peerNetworkProbe({ peer_id: pid, id: test.id });
        if (!ok) return;
        if (r && r.ok) setTest(r.data);
        else if (r && r.why === "unknown") { setTest(null); setMsg([T("The panel no longer has that test — run it again.")]); }
      } catch (e) { /* the next tick asks again */ }
    }, 1500);
    return () => { ok = false; clearInterval(h); };
  }, [pending, test && test.id]);
  const run = async () => {
    const a = addr.trim();
    setMsg(null);
    try {
      const r = await api.peerNetworkProbe({ peer_id: pid, node: nid, addr: a, ...(port.trim() ? { port: port.trim() } : {}) });
      if (r && r.ok) { setTest(r.data); return; }
      // ⚠️ A refused attempt clears the last answer. Left on screen, "nothing is at 192.168.50.99" sat directly above
      // "192.168.1.1 isn't in a network…" and read as the new address's result — seen in the real sheet, not predicted.
      if (!(r && r.why === "busy")) setTest(null);
      setMsg(r && r.why ? netProbeRefused(r, node, a) : [srvText(r) || T("Couldn't start the test.")]);
    } catch (e) { setTest(null); setMsg([T("Couldn't start the test.")]); }
  };
  // The sheet turns Enter into Save unless an input owns the key (data-enter="self"): here Enter runs the test.
  const key = e => { if (e.key === "Enter") { e.preventDefault(); if (!pending && addr.trim()) run(); } };
  const says = test && !pending ? netProbeSays(test, node) : null;
  return html`<div class="netprobe">
    <div class="netprobe-h">${T("Test that the network answers — {node} sends it through this device:", { node })}</div>
    ${restricted ? html`<div class="hint">${T("It's sent by {node} itself, so it answers the same whoever this is shared with.", { node })}</div>` : null}
    <div class="netrow">
      <input class="mono" value=${addr} onInput=${e => setAddr(e.target.value)} onKeyDown=${key} data-enter="self" data-noautofocus
        placeholder=${T("an address on {p}", { p: nets[0] || "" })} aria-label=${T("Address to test")} autocomplete="off" spellcheck="false"/>
      <input class="mono netprobe-port" value=${port} onInput=${e => setPort(e.target.value)} onKeyDown=${key} data-enter="self" data-noautofocus
        inputmode="numeric" placeholder=${T("port")} aria-label=${T("Port to connect to — leave empty to ping")} autocomplete="off"/>
      <button class="btn btn-ghost" disabled=${pending || !addr.trim()} onClick=${run}>${pending ? T("testing…") : T("Test from the node")}</button>
    </div>
    ${pending ? html`<div class="netgw"><span class="condot"></span><span>${T("Waiting for {node} to send it and report back — a few seconds.", { node })}</span></div>` : null}
    ${says ? html`<div class=${"netgw t-" + says[0]}><span class=${"condot " + says[0]}></span><span>${says[1]}</span></div>` : null}
    ${says && says[2] ? html`<div class="netwhy">${says[2]}</div>` : null}
    ${msg ? msg.map(m => html`<div class="netwhy">${m}</div>`) : null}
  </div>`;
}

const netAddrMask = sub => {                        // Keenetic asks for the network address and the mask separately
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(sub || "");
  if (!m || +m[2] > 32) return [sub, ""];
  const bits = +m[2], mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;
  return [m[1], [24, 16, 8, 0].map(sh => (mask >>> sh) & 255).join(".")];
};
const netSetupSnips = sub => ({
  openwrt: ["uci -q delete network.<peer-section>.allowed_ips",   // i18n-keys: shell commands, not prose
    "uci add_list network.<peer-section>.allowed_ips='" + sub + "'",   // i18n-keys: shell commands, not prose
    "uci set network.<peer-section>.route_allowed_ips='1'", "uci commit network",   // i18n-keys: shell commands, not prose
    "uci -q delete firewall.swg", "uci -q delete firewall.swg_lan",   // i18n-keys: shell commands, not prose
    "uci set firewall.swg=zone", "uci set firewall.swg.name='swg'",   // i18n-keys: shell commands, not prose
    "uci set firewall.swg.input='REJECT'", "uci set firewall.swg.output='ACCEPT'", "uci set firewall.swg.forward='REJECT'",   // i18n-keys: shell commands, not prose
    "uci add_list firewall.swg.network='<wg-interface>'",   // i18n-keys: shell commands, not prose
    "uci set firewall.swg_lan=forwarding", "uci set firewall.swg_lan.src='swg'", "uci set firewall.swg_lan.dest='lan'",   // i18n-keys: shell commands, not prose
    "uci commit firewall", "ifup <wg-interface>", "service firewall reload"].join("\n"),   // i18n-keys: shell commands, not prose
  mikrotik: ["/interface wireguard peers set [find interface=<wg-interface>] allowed-address=" + sub,   // i18n-keys: RouterOS commands, not prose
    "/ip route add dst-address=" + sub + " gateway=<wg-interface>"].join("\n"),   // i18n-keys: RouterOS commands, not prose
  linuxConf: ["# under [Interface]", "# (delete the DNS = line)",   // i18n-keys: config lines, not prose
    "PostUp = iptables -t nat -A POSTROUTING -s " + sub + " -o <lan-device> -j MASQUERADE",   // i18n-keys: config lines, not prose
    "PostUp = iptables -I FORWARD -i %i -o <lan-device> -j ACCEPT",   // i18n-keys: config lines, not prose
    "PostUp = iptables -I FORWARD -i <lan-device> -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",   // i18n-keys: config lines, not prose
    "PostDown = iptables -t nat -D POSTROUTING -s " + sub + " -o <lan-device> -j MASQUERADE",   // i18n-keys: config lines, not prose
    "PostDown = iptables -D FORWARD -i %i -o <lan-device> -j ACCEPT",   // i18n-keys: config lines, not prose
    "PostDown = iptables -D FORWARD -i <lan-device> -o %i -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",   // i18n-keys: config lines, not prose
    "# under [Peer]", "AllowedIPs = " + sub].join("\n"),   // i18n-keys: config lines, not prose
  linuxOnce: ["apt install -y iptables",   // i18n-keys: shell commands, not prose
    "echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-swg-forward.conf",   // i18n-keys: shell commands, not prose
    "sysctl -p /etc/sysctl.d/99-swg-forward.conf",   // i18n-keys: shell commands, not prose
    "wg-quick down <wg-interface> 2>/dev/null", "systemctl enable wg-quick@<wg-interface>",   // i18n-keys: shell commands, not prose
    "systemctl restart wg-quick@<wg-interface>"].join("\n"),   // i18n-keys: shell commands, not prose
});

function NetSetup({ sub }) {
  const [kind, setKind] = useState("openwrt");
  const S = netSetupSnips(sub);
  const [addr, mask] = netAddrMask(sub);
  // Commands go in as variables: T() reads everything before a "|" as a context prefix and would cut the sentence there.
  const uciPeers = "uci show network | grep -E 'wireguard_|amneziawg_'", uciZones = "uci show firewall | grep <wg-interface>";   // i18n-keys: shell commands
  const box = s => html`<div class="netsnip"><pre class="mono nixblock">${s}</pre><button type="button" class="btn btn-ghost btn-mini" onClick=${() => copy(s)}><${Ic} i="copy"/> ${T("Copy")}</button></div>`;
  const kinds = [["openwrt", T("OpenWrt router")], ["mikrotik", "MikroTik"], ["keenetic", "Keenetic"],   // i18n-keys: brand names
    ["linux", T("Linux computer")]];
  return html`<div class="netsetup">
    <div class="hint">${T("The node sends traffic to this device; the device has to pass it on to its network and send the answers back. Where does the tunnel run?")}</div>
    <div class="hint">${T("Every client arrives from {subnet} — the node gives clients of its other interfaces its own address there — so the device only needs to send {subnet} back.", { subnet: sub })}</div>
    <div class="dpsw netsw" role="radiogroup" aria-label=${T("Where the tunnel runs")}>${kinds.map(([k, label]) => html`<button type="button" role="radio"
      aria-checked=${kind === k} class=${kind === k ? "on" : ""} onClick=${() => setKind(k)}>${label}</button>`)}</div>
    ${kind === "openwrt" ? html`
      <div class="hint">${T("On the OpenWrt router itself (22.03 or newer). Put the peer section that “{cmd}” prints in place of <peer-section>, and the tunnel's interface name in place of <wg-interface>. Nothing needs translating — the router is already its network's gateway.", { cmd: uciPeers })}</div>
      ${box(S.openwrt)}
      <div class="hint">${T("Saved to the router's memory, so it survives a reboot, and safe to run again. The tunnel must be in no other firewall zone, wan or lan — “{cmd}” should name only swg.", { cmd: uciZones })}</div>` : null}
    ${kind === "mikrotik" ? html`
      <div class="hint">${T("On the MikroTik itself (RouterOS 7), with its WireGuard interface in place of <wg-interface>. Nothing needs translating, and RouterOS saves changes as you make them.")}</div>
      ${box(S.mikrotik)}
      <div class="hint">${T("Keep the tunnel out of the WAN interface list. The stock firewall then lets it reach the network; if yours isn't the stock one, allow forwarding from <wg-interface> to the LAN.")}</div>` : null}
    ${kind === "keenetic" ? html`
      <div class="hint">${T("In the Keenetic web interface (KeeneticOS 5), no commands:")}</div>
      <ol class="netsteps">
        <li>${T("Internet → Other connections → open this WireGuard connection. Check that “Use for accessing the Internet” is off, and in the peer's settings set “Allowed v4 IPs” to {subnet}. Save.", { subnet: sub })}</li>
        <li>${T("Network Rules → Routing → IPv4 routes → Create: “Route to network”, destination network address {addr}, subnet mask {mask}, Interface: this WireGuard connection, “Add automatically” ticked. Save.", { addr, mask })}</li>
        <li>${T("Network Rules → Firewall → IPv4 → Add rule: Interface: this WireGuard connection, Action “Permit”, Source and Destination “Any”, Protocol “IPV4”. Save. The tunnel blocks incoming traffic until it has this rule.")}</li>
      </ol>` : null}
    ${kind === "linux" ? html`
      <div class="hint">${T("On a Linux computer on that network that runs the tunnel with wg-quick — a Raspberry Pi, a NAS, a server; NetworkManager ignores these lines. Add them to its tunnel config, with its network card (the name after “dev” in “ip route show default”) in place of <lan-device>:")}</div>
      ${box(S.linuxConf)}
      <div class="hint">${T("Then run this once, as root, with the tunnel's name in place of <wg-interface>:")}</div>
      ${box(S.linuxOnce)}
      <div class="hint">${T("The rules come back every time the tunnel starts, and the tunnel starts at boot; the computer's own internet stays off the tunnel. If it runs ufw, also run “ufw allow in on <wg-interface>”.")}</div>` : null}
    ${kind !== "linux" ? html`<div class="hint">${T("Devices on the network see these connections come from {subnet}. Some answer only their own network — Windows file sharing and ping, for example — and a computer running its own VPN may send its answers into that VPN. If one doesn't answer, allow {subnet} in its firewall, or route {subnet} to the router on it.", { subnet: sub })}</div>` : null}
    <div class="hint">${T("Windows and macOS can be set up as the gateway, but not with a few lines that survive a restart — use a router or a Linux computer.")}</div>
  </div>`;
}

function NetRouting({ t, node, sub, pid, onSaved }) {
  const g = t.gateway, p = Store.peer(pid);
  const tg = p && (p.targets || []).find(x => x.node === t.node && x.iface === t.iface);
  const meta = Store.ifaceMeta(t.node, t.iface);
  const fromOv = o => { const r = {}; if (!o) return r;              // roster overrides → the settings sheet's string fields
    if (Array.isArray(o.dns)) r.dns = o.dns.join(", ");
    if (o.mtu != null) r.mtu = String(o.mtu);
    if (o.keepalive != null) r.keepalive = String(o.keepalive);
    if (o.allowed) r.allowed = o.allowed;
    return r; };
  const opts = { ...tgtDefaults(meta), ...fromOv(p && p.overrides), ...fromOv(tg && tg.overrides) };   // target over peer over interface
  const save = async cur => {
    const r = await api.peerUpdateTarget({ peer_id: pid, node: t.node, iface: t.iface, overrides: configOverrides(cur, meta) });
    if (!(r && r.ok)) { toast(srvText(r) || T("Settings weren't saved."), "err"); return; }
    // The QR this panel shows is rebuilt from the stored config, as Edit peer does, so it carries the new routing.
    try {
      const c = p && await getConfig(p.pubkey, t.node, t.iface);
      if (c) { const s = parseFullConf(c);
        (Store.sessionConfigs[p.pubkey] = Store.sessionConfigs[p.pubkey] || {})[tkey(t.node, t.iface)] = buildConf({ privkey: s.privkey, address: s.address,
          dns: String(cur.dns).split(",").map(x => x.trim()).filter(Boolean), mtu: String(cur.mtu).trim() || 1280, awg_params: s.awg_params,
          server_pubkey: s.server_pubkey, psk: s.psk, endpoint: s.endpoint, allowed: String(cur.allowed).trim() || "0.0.0.0/0, ::/0", keepalive: String(cur.keepalive).trim() }); }
    } catch (_) { /* the roster copy is saved; only this browser's QR stays as it was */ }
    Store.configEpoch++;
    toast(T("Saved. The device uses the new settings once its config is re-imported."), "ok");
    await Store.poll();
    if (onSaved) onSaved();
  };
  const says = g.no_return
    ? T("This device's config doesn't route {subnet}, so its answers to clients leave through its own internet connection and never arrive. Add {subnet} with the gear, then re-import its config.", { subnet: sub })
    : g.full_tunnel
      ? T("This device's config sends all its traffic into the tunnel — the usual setup for a phone or laptop. On a router it means every device behind it browses the internet through {node} too; to carry only its networks, set the routing to {subnet}.", { node, subnet: sub })
      : T("This device's config sends only {allowed} into the tunnel; everything else uses its own internet connection.", { allowed: g.allowed });
  return html`<span class="netroute">
    ${/* left-anchored, not alignRight: only that placement is clamped into the viewport, and on a phone the value sits at the
          right edge — alignRight hung the bubble off the left side. */""}
    <${Popover} hoverOnly cls="netroute-pop" popCls="netroute-bub"
      trigger=${html`<span class=${"netroute-v mono" + (g.no_return ? " bad" : "")}>${g.allowed}</span>`}>
      <span class="netroute-h">${T("Client allowed IPs (routing)")}</span>${says}<//>
    <button type="button" class="btn btn-mini ico topt-gear" title=${T("Settings for this deployment (DNS, MTU, routing)")}
      aria-label=${T("Settings for this deployment (DNS, MTU, routing)")} onClick=${() => openTargetSettings({ node: t.node, iface: t.iface, opts, meta, onSave: save })}><${Ic} i="gear"/></button>
  </span>`;
}

function NetNode({ t, open, toggle, kaOff, pid, testable, stored = [], onSaved }) {
  const node = Store.nodeName(t.node);
  // `pending` = sent to the node and not routed there yet (swg-noded net_carried). It still counts as what saving means —
  // who can reach it, whose routing leaves it out, the far-side setup — just not as "carried".
  const active = t.networks.filter(n => n.state === "active" || n.state === "pending");
  const sub = t.subnet || "<tunnel-subnet>";
  return html`<div class="netnode">
    <div class="netnode-h"><span class="nm" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")}>${node}</span><span class="tp">${t.iface}</span>${t.address
        ? html`<span class="tp netaddr" title=${T("This device's address on {node}", { node })}>${t.address}</span>` : null}
      ${t.gateway && t.gateway.allowed != null ? html`<span class="grow"></span><${NetRouting} t=${t} node=${node} sub=${sub} pid=${pid} onSaved=${onSaved}/>` : null}</div>
    ${/* P3 evidence: is the gateway there to carry anything? Its traffic is the device's own and its networks'
          together — wg counts per peer — so it is labelled as traffic THROUGH the device. */""}
    ${t.gateway ? html`<div class=${"netgw" + (t.gateway.online ? " on" : "")}>
      <span class=${"condot " + (t.gateway.online ? "on" : "off")}></span>
      <span>${!t.gateway.reported ? T("{node} doesn't list this device yet.", { node })
        : t.gateway.online ? T("The device is connected — traffic through it:")
        : T("The device is offline, so nothing reaches these networks until it reconnects.")}</span>
      ${t.gateway.online ? html`${rateCell(t.gateway.rx_speed, t.gateway.tx_speed)}${xferCell(...dlul(t.gateway.rx_bytes, t.gateway.tx_bytes))}` : null}
    </div>` : null}
    ${kaOff ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This device's config for {node} sends no keepalive, so {node} loses its session when the device goes quiet — and these networks with it. Set a keepalive on that deployment.", { node })}</span></div>` : null}
    ${/* Only a config that cannot work stays a warning (network_report gateway.no_return); the routing itself is on the line
          above, with its meaning on hover and the gear to change it. */""}
    ${t.gateway && t.gateway.no_return ? html`<div class="notice warn"><${Ic} i="warn"/><span>${
        T("This device's config for {node} doesn't route {subnet}, so its answers to clients leave through its own internet connection and never arrive. Add {subnet} to its routing with the gear above and re-import its config.", { node, subnet: sub })}</span></div>` : null}
    <div class="netlist">${t.networks.map(n => html`<span class=${"nettag s-" + n.state}><span class="mono">${n.prefix}</span><em>${
      n.state === "active" ? T("carried")
      : n.state === "pending" ? (stored.includes(n.prefix) ? T("waiting for {node}", { node }) : T("carried once saved"))
      : n.state === "refused_by_node" ? T("refused by the node") : T("not carried")}</em></span>`)}
      ${active.length ? html`<span class="grow"></span><${NetCounts} t=${t} node=${node}/>` : null}</div>
    ${/* A restriction the node could not apply is not a number — nobody reaches the networks there, so it stays a line. */""}
    ${t.share && t.share.node && t.share.node.ok === false ? html`<div class="netref"><div><${Ic} i="warn"/><span>${T("{node} couldn't apply the restriction, so nobody reaches these networks there until it can: {detail}",
        { node, detail: t.share.node.detail || t.share.node.why || "" })}</span></div></div>` : null}
    ${t.networks.some(n => n.state === "pending" && stored.includes(n.prefix))
      ? html`<div class="netwhy">${T("{node} hasn't routed it yet — it does on its next sync, usually within a minute.", { node })}</div>` : null}
    ${/* One line per REASON, not per network: two networks refused for the same node-wide reason ("can't restrict") printed
          the identical sentence twice, under a warning that had already said it. */""}
    ${/* `share_unsupported` is left to the warning at "Who can reach these networks", which names the node and the way out;
          repeated here it was the same news twice in one window. */""}
    ${[...new Set(t.networks.filter(n => n.state !== "active" && n.state !== "pending" && n.why !== "share_unsupported")
        .map(n => netWhy(n, node)))].map(s => html`<div class="netwhy">${s}</div>`)}
    ${/* NETWORKS §17 F1: the device is blocked or expired, so its networks go nowhere — and the people who used them are
          not told by anything on their side. Said here, where the block is visible, with the list one click away. */""}
    ${t.lost ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Blocked, so {peers} of {users} lose these networks until it is unblocked — their devices keep sending that traffic into the tunnel, where nothing answers.",
        { peers: plural(t.lost.peers, "peer"), users: plural(t.lost.users, "gen|user") })}</span></div>
      <${Disclosure} title=${T("Who loses these networks: {peers}", { peers: plural(t.lost.total, "peer") })}
        open=${!!open[t.node + "|l"]} onToggle=${() => toggle(t.node + "|l")}>
        <${NetPagedRows} rows=${t.lost.list} total=${t.lost.total}
          render=${w => html`<div class="netwiden" key=${w.peer_id}><span class="grow">${netPeerName(w.peer_id)}</span><span class="tp">${w.iface}</span></div>`}/>
      <//>` : null}
    ${/* NETWORKS §17 F5: Force DNS on this node answers every lookup itself; the node lets DNS to this network through, so
          names on it resolve — and a client that uses a resolver there skips Force DNS for everything it looks up. */""}
    ${t.force_dns ? t.force_dns.exempt.map(p => html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Clients of {ifaces} on {node} that use a DNS server on {p} skip Force DNS: those lookups aren't blocked or routed by name.",
        { ifaces: t.force_dns.ifaces.join(", "), node, p })}</span></div>`) : null}
    ${t.widen_total ? html`<${Disclosure} title=${T("Narrowed routing, can't reach it: {peers}", { peers: plural(t.widen_total, "peer") })}
        open=${!!open[t.node + "|w"]} onToggle=${() => toggle(t.node + "|w")}>
      <${NetPagedRows} rows=${t.widen} total=${t.widen_total}
        render=${w => html`<div class="netwiden" key=${w.peer_id + "|" + w.iface}><span class="grow">${netPeerName(w.peer_id)}</span><span class="tp">${w.iface}</span>
          <span class="mono faint">${w.allowed}</span>
          <button class="btn btn-ghost btn-mini" onClick=${() => { const q = Store.peer(w.peer_id); if (q) openEditPeer(q, { node: t.node, iface: w.iface }); }}>${T("Edit routing")}</button></div>`}/>
      <div class="hint">${T("A widened device reaches these networks only after its user re-imports the config or refreshes their subscription.")}</div>
    <//>` : null}
    ${active.length ? html`<${Disclosure} title=${T("Set up the device's side")} open=${!!open[t.node + "|s"]} onToggle=${() => toggle(t.node + "|s")}>
      <${NetSetup} sub=${sub}/>
    <//>` : null}
    ${/* The test is a tool, not a status: it lives last, folded, after the setup it checks. Only for what is SAVED (a draft
          network is carried nowhere, so the panel would refuse the test) and only through a keyed deployment. */""}
    ${testable && t.gateway && t.networks.some(n => n.state !== "inert") ? html`<${Disclosure} title=${T("Connection test")}
        open=${!!open[t.node + "|t"]} onToggle=${() => toggle(t.node + "|t")}>
      <${NetProbe} pid=${pid} nid=${t.node} node=${node} nets=${t.networks.filter(n => n.state !== "inert").map(n => n.prefix)} restricted=${!!t.share}/>
    <//>` : null}
  </div>`;
}

// ── node sheets ──
export function openNodeCreate() { openModal(html`<${NodeCreateSheet}/>`); }
/* Sentences with a styled run (a bold name, a bold warning, a link) inside them. Each is ONE key with a
   marker, split around the styled element — see Tsplit in js/i18n.js. */
function meshElsewhere() {
  const [a, b] = Tsplit("Mesh settings (ingress address, subnet, port, prefix, AWG) for this node are configured in {where} — select this node there.", "where");
  return html`<${Fragment}>${a}<a href="#/panel/settings">${T("Panel settings → Network")}</a>${b}<//>`;
}
function forceRemoveWarn(name, onlyHere) {
  const dropped = onlyHere
    ? T("{n} that live only here are dropped", { n: plural(onlyHere, "peer") })
    : T("peers that live only here are dropped");
  const [a, r1] = Tsplit("This cuts {name} off {now} without waiting for it to confirm — {dropped}. Use this only when the server is unreachable. This can't be undone.", "name", { dropped });
  const [b, c] = [r1.split("{now}")[0], r1.split("{now}").slice(1).join("{now}")];
  return html`<${Fragment}>${a}<b>${name}</b>${b}<b>${T("immediately")}</b>${c}<//>`;
}
function flaggedForRemoval() {
  const [a, r1] = Tsplit("{flagged} Run the command below on the node — it'll sign off and disappear here automatically. If you've lost access to the server, use {force} to cut it off.", "flagged");
  const [b, c] = [r1.split("{force}")[0], r1.split("{force}").slice(1).join("{force}")];
  return html`<${Fragment}>${a}<b>${T("Flagged for removal.")}</b>${b}<b>${T("Force remove now")}</b>${c}<//>`;
}

export function NodeCreateSheet() {
  const [name, setName] = useState(""); const [color, setColor] = useState({ ...NODE_CREATE_DEFAULT }); const [msg, setMsg] = useState(null);
  const nameBad = name.trim() && !V.nodeName(name);
  const create = async () => {
    if (!name.trim()) return setMsg({ k: "err", t: T("Give the node a name.") });
    if (!V.nodeName(name)) return setMsg({ k: "err", t: T("Name: 1–40 chars, letters/digits/-/_ only.") });
    setMsg({ k: "work", t: T("creating…") });
    const r = await api.nodeCreate({ name: name.trim(), endpoint_host: "", color });
    if (!r.ok) return setMsg({ k: "err", t: srvText(r) || T("couldn't create node") });
    await Store.poll(); openModal(html`<${NodeTokenSheet} name=${r.data.name} token=${r.data.token} isNew=${true}/>`);
  };
  return html`<${Sheet} title=${T("Add node")}
    foot=${footRow({ onCancel: closeModal, onAction: create, action: T("Create node") })}>
    <div class="field"><label>${T("Name")}</label>
      <div class="namerow"><input autofocus class=${nameBad ? "bad" : ""} value=${name} onInput=${e => setName(e.target.value)} placeholder="msk-edge1" autocomplete="off"/>
        <${ThemedSwatch} val=${color} title=${T("Node colour")} onChange=${setColor} sample=${(c) => html`<span class="tg" style=${"background:color-mix(in srgb," + c + " 16%,transparent);color:" + c}>${name.trim() || T("tag|node")}</span>`}/></div>
      <div class=${"hint" + (nameBad ? " err" : "")}>${nameBad ? T("1–40 chars: letters, digits, - or _ only.") : T("A label for this node — you can rename it anytime. The swatches set its colour per theme.")}</div></div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
const INSTALL_SCRIPT = "https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/swg.sh";
const installNodeCmd = `curl -fsSLo swg.sh ${INSTALL_SCRIPT} && sudo bash swg.sh install node`;

export function NodeTokenSheet({ name, token, isNew }) {
  const host = Store.panelPublicUrl || location.origin + BASE;
  const install = installNodeCmd;
  const copyField = (label, value) => html`<div class="field"><label>${label}</label>
    <div class="cmdrow"><div class="tokenbox">${value}</div>
      <button class="copyaction" onClick=${() => copy(value, T("Copied"))}><${Ic} i="copy"/> ${T("Copy")}</button></div></div>`;
  return html`<${Sheet} title=${(isNew ? T("Node created") : T("New token")) + " · " + name}
    foot=${html`<button class="btn btn-primary" onClick=${closeModal}>${T("Done")}</button>`}>
    ${copyField("PANEL_URL", host)}
    ${copyField("NODE_TOKEN", token)}
    ${isNew ? copyField(T("Run on the node"), install) : null}
    <p class="hint">${T("Set PANEL_URL, NODE_TOKEN and the public NODE_ENDPOINT in /opt/swg-node/.env.")}</p>
    ${isNew ? html`<p class="hint">${T("After saving .env, run the installer again.")}</p>`
             : html`<p class="hint">${T("After saving .env, run sudo docker compose up -d in /opt/swg-node.")}</p>`}
  <//>`;
}
export function openNodeEdit(node) { openModal(html`<${NodeEditSheet} node=${node}/>`); }

export function NodeEditSheet({ node }) {
  const rsv = (Store.panelSettings || {}).reserved || {};   // panel-wide defaults (used when the node has no override)
  const dSub = rsv.mesh_subnet || "10.255.0.0/16", dPort = String(rsv.mesh_port_base || 9999), dPfx = rsv.iface_prefix || "swg_";
  const [name, setName] = useState(node.name || ""); const [color, setColor] = useState(() => toThemed(node.color, NODE_COLOR_DEFAULT)); const [msg, setMsg] = useState(null);
  const [ingress, setIngress] = useState(node.endpoint_host || "");
  // mesh fields show the EFFECTIVE value in use (the node's override, else the panel default). Leaving it at
  // the default normalizes to "inherit" on save (no spurious override / re-provision).
  const [meshPort, setMeshPort] = useState(node.mesh_port ? String(node.mesh_port) : dPort);
  const [meshSubnet, setMeshSubnet] = useState(node.mesh_subnet || dSub);
  const [meshPrefix, setMeshPrefix] = useState(node.mesh_prefix || dPfx);
  const [defEgress, setDefEgress] = useState(node.default_egress_ip || "");
  const [panelIp, setPanelIp] = useState(node.panel_ip || "");
  const [meshEgress, setMeshEgress] = useState(node.mesh_egress_ip || "");
  const ips = node.ips || [];
  const ovSub = meshSubnet.trim() === dSub ? "" : meshSubnet.trim();   // normalized overrides (default → inherit)
  const ovPort = meshPort.trim() === dPort ? "" : meshPort.trim();
  const ovPfx = meshPrefix.trim() === dPfx ? "" : meshPrefix.trim();
  const nameBad = name.trim() && !V.nodeName(name);
  // Only a subnet or PREFIX change re-provisions (re-addresses / renames the iface → rebuild). A port-only
  // change is applied LIVE (the node re-ports in place + peers re-dial), so it needs no re-provision confirm.
  const reprovChanged = ovSub !== (node.mesh_subnet || "") || ovPfx !== (node.mesh_prefix || "");
  const [busy, setBusy] = useState(false);
  const doSave = async () => {
    // Sent before the sheet closes (q189 SPA-3): a refusal stays here, in the panel's words, with every edit kept — it used to
    // close the sheet (and the re-provision confirm on top) first and lose them all. Accepted, both close.
    const r = await sheetSend(() => api.nodeUpdate({ id: node.id, name: name.trim(), color, endpoint_host: ingress, mesh_port: ovPort,
        mesh_egress_ip: meshEgress, mesh_subnet: ovSub, mesh_prefix: ovPfx, default_egress_ip: defEgress, panel_ip: panelIp }),
      t => setMsg(t ? { k: "err", t } : null), setBusy);
    if (!r.ok) return;
    closeAllModals(); Store.poll().catch(() => {});
  };
  const save = async () => {
    if (!name.trim() || !V.nodeName(name)) return setMsg({ k: "err", t: T("Name: 1–40 chars, letters/digits/-/_ only.") });
    if (reprovChanged) {   // re-provisioning bounces this node's mesh links → confirm first
      return pushModal(html`<${ConfirmSheet} title=${T("Re-provision this node's mesh links?")} confirmLabel=${T("Re-provision")} warn=${true}
        body=${T("Changing the mesh subnet / port / prefix of {v1} rebuilds all of its node-to-node links with the new settings.", { v1: node.name }) + " " + T("{v1} will briefly drop off the mesh (and any cascade/smart traffic routed through it pauses) until every peer pulls the new config and reconnects — usually a few seconds. Other nodes' links to each other are unaffected.", { v1: node.name })}
        onConfirm=${doSave}/>`);
    }
    doSave();
  };
  const [showAwg, setShowAwg] = useState(false);
  return html`<${Sheet} title=${T("Node settings · {v1}", { v1: node.name })}
    foot=${footRow({ left: html`<${Fragment}>
        <button class="btn btn-ghost" title=${T("Rotate this node's enrollment token")} onClick=${() => openNodeRotate(node)}><${Ic} i="key"/> ${T("Rotate key")}</button>
      <//>`, onCancel: closeModal, disabled: busy, onAction: save, action: T("Save") })}>
    <div class="field"><label>${T("Name")}</label>
      <div class="namerow"><input autofocus class=${nameBad ? "bad" : ""} value=${name} onInput=${e => setName(e.target.value)} autocomplete="off"/>
        <${ThemedSwatch} val=${color} title=${T("Node colour")} onChange=${setColor} sample=${(c) => html`<span class="tg" style=${"background:color-mix(in srgb," + c + " 16%,transparent);color:" + c}>${name.trim() || node.name || T("tag|node")}</span>`}/></div>
      <div class=${"hint" + (nameBad ? " err" : "")}>${nameBad ? T("1–40 chars: letters, digits, - or _ only.") : T("A label for this node — rename anytime, nothing else changes. The swatches set its colour per theme.")}</div></div>
    <div class="seclabel">${T("Egress")}</div>
    <div class="field"><label>${T("Default egress IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— direct internet exit")}</span></label>
      <${NodeIpPick} ips=${ips} value=${defEgress} onChange=${setDefEgress} auto=${T("Auto (MASQUERADE)")}/>
      <div class="hint">${T("The fallback source IP this node SNATs to when traffic exits to the internet here — applied to any interface (and traffic received from other nodes) that doesn't set its own egress IP. Interfaces with their own egress IP, and cascading traffic that exits elsewhere, are unaffected.")}</div></div>
    <div class="field"><label>${T("Panel egress connection IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— source to reach the panel")}</span></label>
      <${NodeIpPick} ips=${ips} value=${panelIp} onChange=${setPanelIp} auto=${T("Auto (default route)")}/>
      <div class="hint">${T("Source IP this node uses to reach the panel. Ignored on same-server installs; falls back to auto if it can't connect.")}</div></div>
    ${/* The third outbound role, beside the other two rather than under Mesh: an operator asking "which of
          this box's addresses does it go OUT from?" wants all three answers in one place. It is a node-level
          DEFAULT because the per-connection override cannot be one — re-provisioning wipes `links` wholesale
          and rebuilds them without it, so a value set on a single card is dropped by the next migration. */ null}
    <div class="field"><label>${T("Mesh egress IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— source to dial other nodes")}</span></label>
      <${NodeIpPick} ips=${ips} value=${meshEgress} onChange=${setMeshEgress} auto=${T("Auto (default route)")}/>
      <div class="hint">${T("Which of this node's addresses it dials the other nodes' mesh links from. A single connection can still override it on its own card.")}</div></div>
    <div class="hint" style="margin-top:14px">${meshElsewhere()}</div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
export function openNodeRotate(node) { openModal(html`<${NodeRotateSheet} node=${node}/>`); }
export function NodeRotateSheet({ node }) {
  const go2 = async () => { const r = await api.nodeRotate({ id: node.id }); if (!r.ok) { toast(srvText(r) || T("rotate failed"), "err"); return; } openModal(html`<${NodeTokenSheet} name=${node.name} token=${r.data.token} isNew=${false} kind=${node.kind} platform=${node.platform}/>`); };
  return html`<${Sheet} title=${T("Rotate token · {v1}", { v1: node.name })}
    foot=${footRow({ onCancel: closeModal, onAction: go2, action: T("Rotate") })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${T("The current token stops working immediately. Re-enroll the node with the new token or it will go offline.")}</span></div>
  <//>`;
}
export function openNodeRemove(node) { openModal(html`<${NodeRemoveSheet} node=${node}/>`); }
export function unflagNode(n) {   // cancel a pending soft removal — keep the node
  mutate({
    key: "node:" + n.id,
    patch: s => { const x = s.nodes.find(y => y.id === n.id); if (x) { delete x.removing; delete x.removing_at; } },
    call: () => api.nodeUnflagRemove({ id: n.id }),
  });
}
// Force-remove a node — destructive (cuts it off immediately + drops peers that live only here), so gated behind typing "DELETE <name>" (case-sensitive), like deleting an interface/turn-proxy.
export function ForceRemoveNodeSheet({ node }) {
  const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false);
  const phrase = T("DELETE {v1}", { v1: node.name });
  const ok = txt === phrase;
  const here = Store.recon.peers.filter(p => p.targets.some(t => t.node === node.id));
  const onlyHere = here.filter(p => new Set(p.targets.map(t => t.node)).size === 1).length;
  const del = () => {
    if (!ok || busy) return;
    setBusy(true); closeAllModals();
    mutate({
      key: "node:" + node.id,
      patch: s => {                                  // optimistic: drop the node + purge its targets (mirrors the cascade)
        s.nodes = s.nodes.filter(x => x.id !== node.id);
        for (const id of Object.keys(s.roster.peers)) {
          const p = s.roster.peers[id]; p.targets = p.targets.filter(t => t.node !== node.id);
          if (!p.targets.length) delete s.roster.peers[id];
        }
      },
      call: () => api.nodeDelete({ id: node.id }),
    });
    toast(T("Node force-removed."), "ok");
  };
  return html`<${Sheet} title=${T("Force remove · {v1}", { v1: node.name })}
    foot=${footRow({ onCancel: closeModal, danger: true, disabled: !ok || busy, onAction: del, action: T("Force remove") })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${forceRemoveWarn(node.name, onlyHere)}</span></div>
    <div class="field"><label>${typeToConfirm(phrase)}</label><input autofocus value=${txt} onInput=${e => setTxt(e.target.value)} placeholder=${phrase} autocomplete="off" spellcheck="false"/></div>
  <//>`;
}
export function NodeRemoveSheet({ node }) {
  const [flagged, setFlagged] = useState(!!node.removing);
  const here = Store.recon.peers.filter(p => p.targets.some(t => t.node === node.id));
  const onlyHere = here.filter(p => new Set(p.targets.map(t => t.node)).size === 1).length;
  const note = !here.length ? T("No peers reference it.")
    : onlyHere ? T("{v1} reference it; {n} live only here and will be dropped.", { v1: plural(here.length, "peer"), n: onlyHere })
    : T("{v1} reference it.", { v1: plural(here.length, "peer") });
  const declarative = !!node.declarative;
  const nixos = node.platform === "nixos";
  const uninstall = declarative
    ? (nixos ? "services.swg-node.enable = false;   # then: sudo nixos-rebuild switch" : "")   // i18n-keys: generated Nix — file text, copied verbatim
    : "cd /opt/swg-node && sudo docker compose down";
  const flag = () => { setFlagged(true); mutate({
    key: "node:" + node.id,
    patch: s => { const n = s.nodes.find(x => x.id === node.id); if (n) n.removing = true; },
    call: () => api.nodeFlagRemove({ id: node.id }),
  }); };
  const force = () => pushModal(html`<${ForceRemoveNodeSheet} node=${node}/>`);   // typed "DELETE <name>" confirmation (matches interface/turn-proxy deletes)
  return html`<${Sheet} title=${T("Remove {v1}", { v1: node.name })}
    foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>
      ${flagged ? null : html`<button class="btn btn-primary" onClick=${flag}>${T("Flag for removal")}</button>`}
      <button class="btn btn-danger" onClick=${force}>${T("Force remove now")}</button></>`}>
    ${flagged
      ? html`<div class="notice"><${Ic} i="info"/><span>${flaggedForRemoval()}</span></div>`
      : html`<div class="notice"><${Ic} i="info"/><span>${declarative
          ? T("This node is managed declaratively. Remove it from the configuration that declares it and rebuild — it won't sign off on its own, so Force-remove it here afterwards. It keeps serving its {v1} until then.", { v1: plural(here.length, "peer") })
          : T("Clean removal: flag the node, then run the uninstall command on the server. The node keeps serving its {v1} until it confirms, then drops itself from the panel.", { v1: plural(here.length, "peer") })} ${note}</span></div>`}
    ${uninstall ? html`<div class="field" style="margin-top:14px"><label>${declarative ? T("Set in the node's configuration, then rebuild") : T("Run on the node to uninstall + sign off")}</label>
      <div class="cmdrow"><div class=${"tokenbox" + (declarative ? " block" : "")}>${uninstall}</div><button class="copyaction" onClick=${() => copy(uninstall, T("Copied"))}><${Ic} i="copy"/> ${T("Copy")}</button></div>
      <div class="hint">${declarative ? T("Removing the module stops swg-noded / swg-agent but does not tell the panel — Force remove clears it here.") : T("Removes swg-noded / swg-agent and tells the panel it's gone. Force remove is for when the server is unreachable.")}</div></div>` : null}
  <//>`;
}
