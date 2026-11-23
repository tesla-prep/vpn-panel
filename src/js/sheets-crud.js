import { T, Trich, Tsplit, plural, srvText } from "./i18n.js";
import { esc, tkey, V, BASE, seen, panelNowS, configErrors, orderedTargets, isPrimaryTarget, useStableOrder,
         isSelfContainedKind, ipOf, portOf, ipPickerVal, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { NODE_COLOR_DEFAULT, NODE_CREATE_DEFAULT, toThemed } from "./theme.js";
import { go } from "./router.js";
import { targetType, iTypeOf, kindOf, nodeStale, wdttOn, suggestIface, suggestSubnet, suggestPort,
         portHolder, portErrMsg, subnetFleetConflict, subnetServerAddr, cidrNet, ghostIface,
         turnProxiesFor, tgtXfer, tgtSeenAge, kindLabel, platformLabel, peerUncategorised } from "./model.js";
import { turnFork, turnColor, turnForkList, forkLabel } from "./turn-catalog.js";
import { Ic, ICON, Tag, tgt3, Panel, Badge, Sheet, footRow, secTitle, SearchBox, Dropdown, autoGrow, IpPicker, NodeIpPick, Popover, Portal, toast, copy, mutate, sheetSend, openModal, pushModal, closeModal, closeAllModals, openConfirm, openChildOrRoot, ConfirmSheet, subjectBlocked, statusLabel, LogBody, RowError, useAnchoredList, goSettings, ThemedSwatch, modalDepth, rowSingle, rowDouble, rowNoSelect, rateCell, xferCell, gridStatusBadge, uncatPop, badgeWithReason, blockedReason, statusReason, dlul, typeToConfirm, ListPager, LIST_PAGE, pageSlice } from "./ui.js";
import {
  genKeys, genPSK, buildConf, parseFullConf, downloadConf, getConfig, configOverrides, QR, qrDataURL,
  subFeatureOn, subPublishOrPrompt, ensureVaultUnlocked, subSKCached, VaultPromptSheet, ensurePeerBlob,
  SubAutoNote, anySessionConf, subAutoGenIfEnabled, subReconcileUser,
} from "./crypto.js";
import {
  confirmDeletePeer, confirmUnassign, peerBlockBtn, userBlockBtn, PeerStatusLine, SubStatusLine,
  UserCombo, UserPicker, RoleToggle, assignPeer,
  confirmReassign, confirmCorrectDeployment, confirmRestoreDeployment, openRecreateRekey, rotatePeerKeys, rotateOnePeerKeys, rotateOneLabel, rotateParts, PubTag,
  pubState, pubCls,
} from "./peer-actions.js";
import { searchMatch, usersView, revealUser, clearUserFilters } from "./views.js";
import { turnEnabled, WDTT_COLOR, shownTitle } from "./turn.js";
import { openPeerConfigs, openUserEdit } from "./peer-ui.js";
import { TrafficBlock, goneDevices } from "./traffic-ui.js";
import { trafficTotals, trafficModalView } from "./traffic.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export function openCreateUser() { openModal(html`<${CreateUserSheet}/>`); }
export function CreateUserSheet() {
  const [name, setName] = useState(""); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const createUser = async () => {
    if (!name.trim()) { setMsg({ k: "err", t: T("Give the user a name.") }); return null; }
    setBusy(true); setMsg({ k: "work", t: T("creating…") });
    const r = await api.userCreate({ name: name.trim() });
    setBusy(false);
    if (!r.ok) { setMsg({ k: "err", t: srvText(r) || T("couldn't create user") }); return null; }
    Store.recentlyCreated[r.data.id] = Date.now(); subAutoGenIfEnabled(r.data.id); await Store.poll();
    return r.data;
  };
  const stayExpanded = uid => { clearUserFilters(); usersView.expanded[uid] = true; usersView.q = ""; usersView.page = 1; closeModal(); go("#/users"); };
  const createOnly = async () => { const u = await createUser(); if (u) stayExpanded(u.id); };
  const createAndAdd = async () => { const u = await createUser(); if (u) openModal(html`<${AddPeersSheet} userId=${u.id} userName=${u.name}/>`); };
  return html`<${Sheet} title=${T("New user")}
    foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button><button class="btn btn-ghost m-third" disabled=${busy} onClick=${createOnly}>${T("Create only")}</button><button class="btn btn-primary" disabled=${busy} onClick=${createAndAdd}>${T("Add peers ▸")}</button></>`}>
    <div class="field"><label>${T("Name")}</label><input autofocus value=${name} onInput=${e => setName(e.target.value)} placeholder=${T("Alex")}/></div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function openAddPeers(userId, userName) { openModal(html`<${AddPeersSheet} userId=${userId} userName=${userName}/>`); }
export function PeerBlockGrid({ peers, mode, act }) {
  useStore();
  const gridRef = useRef(null);
  const ids = peers.map(p => p.id).join(",");
  useEffect(() => {
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
    const fresh = Store.recentlyCreated[p.id] && (Date.now() - Store.recentlyCreated[p.id] < 2500);
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
    (b.title ? 1 : 0) - (a.title ? 1 : 0) ||
    String(a.title || "").localeCompare(String(b.title || "")) ||
    Store.byNode(rep(a).node, rep(b).node) ||
    String(rep(a).ip || "").localeCompare(String(rep(b).ip || ""), undefined, { numeric: true }));
  const mine = orderPeers(userId ? Store.peersOfUser(userId) : []);
  const free = orderPeers(Store.unassignedPeers());

  const doAssign = p => { Store.recentlyCreated[p.id] = Date.now(); return mutate({ key: "peer:" + p.id,
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

export function allTargets() {
  const out = [];
  for (const node of Object.keys(Store.describe)) for (const iface of Object.keys(Store.describe[node] || {}))
    if (!Store.ifaceIsSystem(node, iface)) out.push({ node, iface });
  for (const n of (Store.nodes || [])) {
    for (const iface of Object.keys(n.wdtt_cfg || {}))
      if (!out.some(t => t.node === n.id && t.iface === iface)) out.push({ node: n.id, iface });
    for (const iface of Object.keys(n.csqtt_cfg || {}))
      if (!out.some(t => t.node === n.id && t.iface === iface)) out.push({ node: n.id, iface });
  }
  return out;
}

const nmTip = e => { const el = e.currentTarget; el.title = el.scrollWidth > el.clientWidth ? el.textContent : ""; };

export function TargetFrontBadge({ node, iface, peer, dim }) {
  useStore();
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
  const locked = !!(prefill && prefill.lock && prefill.node && prefill.iface);
  const baseAll = locked ? all.filter(t => t.node === prefill.node && t.iface === prefill.iface)
    : (exclude ? all.filter(t => !exclude.has(tkey(t.node, t.iface))) : all);
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
    else if (iTypeOf(node, iface) === "wdtt") setSel(s => ({ ...s, [k]: { node, iface, ip: "", wdtt: true } }));
    else if (iTypeOf(node, iface) === "csqtt") setSel(s => ({ ...s, [k]: { node, iface, ip: "", csqtt: true } }));
    else allocIp(node, iface);
  };
  const setIp = (k, v) => setSel(s => s[k] ? { ...s, [k]: { ...s[k], ip: v } } : s);
  const setOpts = (k, v) => setSel(s => s[k] ? { ...s, [k]: { ...s[k], opts: v } } : s);
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !initial || !initial.length || !all.length) return;
    seeded.current = true;
    const seed = {};
    initial.forEach(t => { seed[tkey(t.node, t.iface)] = { node: t.node, iface: t.iface, ip: String(t.ip || "").split("/")[0], existing: true }; });
    setSel(seed);
  }, [all, initial]);
  useEffect(() => {
    if (!targets.length || Object.keys(sel).length || (initial && initial.length)) return;
    if (prefill && prefill.node && prefill.iface) {
      if (iTypeOf(prefill.node, prefill.iface) === "wdtt") setSel({ [tkey(prefill.node, prefill.iface)]: { node: prefill.node, iface: prefill.iface, ip: "", wdtt: true } });
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
    const ity = t.missing ? (t.type || "wg") : iTypeOf(t.node, t.iface);
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
        ${s && isMobile() && s.ip && !V.ipv4(s.ip) ? html`<span class="hint err topt-err">${T("not a valid IPv4 address")}</span>` : null}
        ${(s && !t.missing) ? html`<${TargetGear} node=${t.node} iface=${t.iface} kind=${ity} opts=${s.opts} onSave=${v => setOpts(k, v)} readOnly=${!!s.existing}/>` : null}
      </div>
    </div>`;
  })}</div>`;
}

export const tgtDefaults = (meta) => ({
  dns: ((meta || {}).dns || []).join(", "), mtu: String((meta || {}).mtu || 1280),
  keepalive: String((meta || {}).keepalive != null ? (meta || {}).keepalive : 25),
  allowed: "0.0.0.0/0, ::/0",
});
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
export function TargetGear({ node, iface, kind, opts, onSave, readOnly }) {
  if (isSelfContainedKind(kind)) return null;
  const meta = Store.ifaceMeta(node, iface);
  const on = tgtCustomised(opts, meta);
  return html`<button type="button" class=${"btn btn-mini ico topt-gear" + (on ? " on" : "")}
    title=${on ? T("Settings for this deployment (customised)") : T("Settings for this deployment (DNS, MTU, routing)")}
    onClick=${e => { e.preventDefault(); e.stopPropagation(); openTargetSettings({ node, iface, opts, meta, onSave, readOnly }); }}><${Ic} i="gear"/></button>`;
}

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
    for (const t of keyed) {
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
    try {
      if (keyed.length) {
        keys = await genKeys();
        pskV = genPSK();
      }
      tgts = []; configs = {};
      for (const t of chosen) {
        const kind = kindFor(t);
        if (isSelfContainedKind(kind)) {
          tgts.push({ node: t.node, iface: t.iface, ip: "", type: kind });
          continue;
        }
        const m = Store.ifaceMeta(t.node, t.iface); if (!m) continue;
        const ipClean = String(t.ip).trim().split("/")[0];
        const o = t.opts || tgtDefaults(m);
        const tg = { node: t.node, iface: t.iface, ip: ipClean, type: (m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg" };
        const ov = configOverrides(o, m);
        if (Object.keys(ov).length) tg.overrides = ov;
        tgts.push(tg);
        configs[tkey(t.node, t.iface)] = buildConf({ privkey: keys.priv, address: ipClean + "/32", dns: o.dns.split(",").map(x => x.trim()).filter(Boolean), mtu: String(o.mtu).trim() || 1280, awg_params: m.awg_params, server_pubkey: m.public_key, psk: pskV, endpoint: m.endpoint, allowed: String(o.allowed).trim() || "0.0.0.0/0, ::/0", keepalive: String(o.keepalive).trim() });
      }
      body = { user_id: userId || null, title: title.trim(), pubkey: keys ? keys.pub : "", psk: pskV, targets: tgts };
    } catch (e) { setBusy(false); return setMsg({ k: "err", t: T("Error: {v1}", { v1: e.message })}); }
    if (keys) Store.sessionConfigs[keys.pub] = Object.assign(Store.sessionConfigs[keys.pub] || {}, configs);
    const tempId = "tmp_" + (keys ? keys.pub.slice(0, 14) : String(Math.random()).slice(2, 16));
    const optimistic = { id: tempId, pubkey: keys ? keys.pub : "", user_id: userId || null, title: title.trim(), psk: pskV,
      targets: tgts.map(t => ({ node: t.node, iface: t.iface, ip: t.ip, type: t.type })),
      created_at: panelNowS(), _creating: true };
    closeModal();
    if (prefill.lock && prefill.node && prefill.iface) go("#/node/" + encodeURIComponent(prefill.node) + "/" + encodeURIComponent(prefill.iface));
    else if (userId) revealUser(userId, tempId);
    mutate({
      patch: s => { s.roster.peers[tempId] = optimistic; },
      call: () => api.peerCreate(body),
      onOk: r => { if (r && r.data && r.data.id) { Store.recentlyCreated[r.data.id] = Date.now();
        if (keys) subPublishOrPrompt(userId || null, r.data.id, keys.priv, pskV); } },
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
  const child = modalDepth() > 0;
  (child ? pushModal : openModal)(html`<${AddTargetSheet} peer=${peer} back=${back || closeModal} child=${child}/>`);
}
export function AddTargetSheet({ peer, back, child }) {
  back = back || closeModal;
  const [chosen, setChosen] = useState([]);
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
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
  const added = chosen.filter(c => !haveKeys.has(tkey(c.node, c.iface)));
  const removed = peer.targets.filter(t => !chosenKeys.has(tkey(t.node, t.iface)));
  const ipChanged = chosen.filter(c => haveKeys.has(tkey(c.node, c.iface)) && c.ip && String(c.ip).split("/")[0] !== origIp[tkey(c.node, c.iface)]);
  const kindFor = c => (c.wdtt ? "wdtt" : c.csqtt ? "csqtt" : iTypeOf(c.node, c.iface));
  const needsIp = c => !isSelfContainedKind(kindFor(c));
  const badIp = added.concat(ipChanged).filter(needsIp).some(c => !c.ip || !V.ipv4(String(c.ip).split("/")[0]));
  const nochange = !added.length && !removed.length && !ipChanged.length;
  const doSave = async () => {
    setBusy(true); setMsg({ k: "work", t: T("applying…") });
    const fails = [];
    for (const t of added) {
      const kind = kindFor(t);
      if (isSelfContainedKind(kind)) {
        const r = await api.peerAddTarget({ peer_id: peer.id, target: { node: t.node, iface: t.iface, ip: "", type: kind } });
        if (!r.ok) fails.push(Store.nodeName(t.node) + "/" + T("{v1} (add)", { v1: t.iface }));
        continue;
      }
      const info = Store.ifaceMeta(t.node, t.iface);
      const ipClean = String(t.ip || "").split("/")[0];
      const o = t.opts || null;
      let conf = null;
      if (srcConf) { const s = parseFullConf(srcConf);
        conf = buildConf({ privkey: s.privkey, address: ipClean + "/32", dns: o ? String(o.dns).split(",").map(x => x.trim()).filter(Boolean) : s.dns, mtu: o ? (String(o.mtu).trim() || 1280) : s.mtu, awg_params: info.awg_params, server_pubkey: info.public_key, psk: s.psk || peer.psk, endpoint: info.endpoint, allowed: o ? (String(o.allowed).trim() || "0.0.0.0/0, ::/0") : s.allowed, keepalive: o ? String(o.keepalive).trim() : s.keepalive }); }
      const target = { node: t.node, iface: t.iface, ip: ipClean, type: info.awg_params && Object.keys(info.awg_params).length ? "awg" : "wg" };
      const ov = o ? configOverrides(o, info) : {};
      if (Object.keys(ov).length) target.overrides = ov;
      const r = await api.peerAddTarget({ peer_id: peer.id, target });
      if (r.ok) { if (conf) (Store.sessionConfigs[peer.pubkey] = Store.sessionConfigs[peer.pubkey] || {})[tkey(t.node, t.iface)] = conf; }
      else fails.push(Store.nodeName(t.node) + "/" + T("{v1} (add)", { v1: t.iface })
        + (r.error ? " — " + srvText(r) : ""));
    }
    for (const t of ipChanged) {
      const info = Store.ifaceMeta(t.node, t.iface);
      const ipClean = String(t.ip || "").split("/")[0];
      const body = { peer_id: peer.id, node: t.node, iface: t.iface, ip: ipClean };
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
    if (chosen.length === 0) {
      pushModal(html`<${ConfirmSheet} title=${T("Delete this peer?")} confirmLabel=${T("Yes, delete")} danger=${true}
        body=${T("You've unchecked every interface, so there's nothing left to deploy this peer to — saving will completely delete it. Its access is revoked everywhere and its config / QR stops working. This action is irreversible. Are you sure you want to continue?")
          }
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
        ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
      </>`}
  <//>`;
}

export function openPeerView(pid, node, iface, child) { (child ? pushModal : openModal)(html`<${PeerViewSheet} pid=${pid} node=${node} iface=${iface}/>`); }
export function PeerViewSheet({ pid, node, iface }) {
  useStore();
  const p = Store.peer(pid);
  const depsOrdered = useStableOrder(p ? p.targets : []);
  if (!p) return html`<${Sheet} title=${T("sheet|Peer")} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}><div class="empty"><b>${T("Peer not found")}</b>${T("It may have been removed.")}</div><//>`;
  const u = p.user_id ? Store.user(p.user_id) : null;
  const editLocked = p.targets.some(t => t.status === "dangling" || t.status === "broken");
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
      ${isMobile() && !rotateParts(p).none ? html`<button class="btn btn-warn m-pvrot" onClick=${() => rotateOnePeerKeys(p)}><${Ic} i="key"/> ${rotateOneLabel(p)}</button>` : null}<//>`}>
    ${u ? html`<${PeerStatusLine} peer=${p} pos="bar"/>` : null}
    <div class="pv-head">
      <div class="pv-id"><div class="pv-sub">${u ? html`<a class="pv-user" href="#/users" onClick=${e => { e.preventDefault(); closeModal(); revealUser(u.id); }}>${u.name}</a>`
          : html`<${UserCombo} onPick=${uid => assignPeer(p, uid)} placeholder=${T("Assign to a user…")}/>`}</div></div>
      ${badgeWithReason(p.unassigned ? "unassigned" : p.status, p.reason)}</div>
    <div class="lbl" style="margin:16px 2px 4px">${T("Deployments · {n}", { n: p.targets.length })}</div>
    <div class="pv-deps">${depsOrdered.map(t => {
      const obs = t.observed;
      const xfer = tgtXfer(t);
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

export function openEditPeer(peer, focus, done, flash) {
  const child = modalDepth() > 0;
  (child ? pushModal : openModal)(html`<${EditPeerSheet} peer=${peer} focus=${focus} done=${done || closeModal} flash=${flash} child=${child}/>`);
}
export function EditPeerSheet({ peer, focus, done, flash, child }) {
  done = done || closeModal;
  useStore();
  const live = Store.peer(peer.id) || peer;
  const targetsOrdered = useStableOrder(live.targets);
  const [title, setTitle] = useState(peer.title || "");
  const [ips, setIps] = useState(() => Object.fromEntries(live.targets.map(t => [tkey(t.node, t.iface), (t.ip || "").split("/")[0]])));
  useEffect(() => {
    setIps(prev => { const next = { ...prev }; let ch = false;
      live.targets.forEach(t => { const k = tkey(t.node, t.iface); if (!(k in next)) { next[k] = (t.ip || "").split("/")[0]; ch = true; } });
      return ch ? next : prev; });
  }, [live.targets.map(t => tkey(t.node, t.iface)).join(",")]);
  const setIpFor = (k, v) => setIps(m => ({ ...m, [k]: v }));
  const [loaded, setLoaded] = useState(false);
  const [confs, setConfs] = useState({});
  const [topts, setTopts] = useState({});
  const setOptsFor = (k, v) => setTopts(m => ({ ...m, [k]: v }));
  const [userId, setUserId] = useState(peer.user_id || "");
  const [msg, setMsg] = useState(flash || null); const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState(null);
  const [rotating, setRotating] = useState(false);
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
      setTopts(seed); setOrig(seed);
    })();
    return () => { ok = false; };
  }, [peer.id, live && live.pubkey, Store.configEpoch]);

  const editable = Object.keys(confs).length;
  const ipChangedFor = t => { const v = (ips[tkey(t.node, t.iface)] || "").trim(); return !!v && v !== (t.ip || "").split("/")[0]; };
  const ipBadFor = t => { const v = (ips[tkey(t.node, t.iface)] || "").trim(); return !!v && !V.ipv4(v.split("/")[0]); };
  const anyIpBad = peer.targets.some(ipBadFor);
  const optsErr = Object.keys(topts).map(k => { const e = configErrors(topts[k]); const f = Object.keys(e)[0];
    return f ? { k, msg: T("{v1}: {v2}", { v1: k.split("|")[1], v2: e[f] }) } : null; }).find(Boolean);
  const optsChanged = k => !!orig && !!orig[k] && JSON.stringify(topts[k]) !== JSON.stringify(orig[k]);
  const _dirty = (title.trim() !== (peer.title || "").trim())
    || ((userId || "") !== (peer.user_id || ""))
    || (live.targets || []).some(ipChangedFor)
    || Object.keys(topts).some(optsChanged);
  const save = async () => {
    if (anyIpBad) return setMsg({ k: "err", t: T("Each address must be a valid IPv4.") });
    if (optsErr) return setMsg({ k: "err", t: optsErr.msg });
    setBusy(true); setMsg({ k: "work", t: T("saving…") });
    let fails = 0;
    try {
      if (title.trim() !== (peer.title || "")) {
        const r = await api.peerUpdate({ peer_id: peer.id, title: title.trim() }); if (!r.ok) fails++;
      }
      for (const t of (live.targets || peer.targets)) {
        const k = tkey(t.node, t.iface);
        if (!topts[k] || !optsChanged(k)) continue;
        const ovNew = configOverrides(topts[k], Store.ifaceMeta(t.node, t.iface));
        const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, overrides: ovNew });
        if (!r.ok) fails++;
      }
      if (peer.unassigned && userId && userId !== (peer.user_id || "")) {
        const r = await api.peerUpdate({ peer_id: peer.id, user_id: userId }); if (!r.ok) fails++;
      }
      for (const t of (live.targets || peer.targets)) {
        const k = tkey(t.node, t.iface); const cur = confs[k];
        const changed = ipChangedFor(t);
        const newIP = (ips[k] || "").trim().split("/")[0];
        if (!cur) {
          if (changed) { const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, ip: newIP }); if (!r.ok) fails++; }
          continue;
        }
        const s = parseFullConf(cur);
        const o = topts[k] || { dns: (s.dns || []).join(", "), mtu: String(s.mtu), keepalive: String(s.keepalive), allowed: s.allowed };
        const addr = (changed ? newIP : (s.address || "").split("/")[0]) + "/32";
        const conf = buildConf({ privkey: s.privkey, address: addr, dns: String(o.dns).split(",").map(x => x.trim()).filter(Boolean), mtu: (String(o.mtu).trim() || 1280), awg_params: s.awg_params, server_pubkey: s.server_pubkey, psk: s.psk, endpoint: s.endpoint, allowed: (String(o.allowed).trim() || "0.0.0.0/0, ::/0"), keepalive: String(o.keepalive).trim() });
        (Store.sessionConfigs[peer.pubkey] = Store.sessionConfigs[peer.pubkey] || {})[k] = conf;
        if (changed) { const r = await api.peerUpdateTarget({ peer_id: peer.id, node: t.node, iface: t.iface, ip: newIP }); if (!r.ok) fails++; }
      }
    } catch (e) { setBusy(false); return setMsg({ k: "err", t: String(e.message || e) }); }
    setBusy(false); Store.configEpoch++;
    const oldUid = peer.user_id || "", newUid = userId || "";
    if (oldUid && newUid !== oldUid) {
      await Store.poll();
      const fresh = (Store.recon.peers.find(x => x.id === peer.id)) || peer;
      return newUid ? confirmReassign(fresh, newUid) : confirmUnassign(fresh);
    }
    toast(fails ? T("Saved (some changes couldn't be persisted).") : T("Peer updated."), fails ? "info" : "ok");
    done(); await Store.poll();
  };

  const { hasWdtt, hasCsqtt, hasKeyed } = rotateParts(peer);
  const isKeyless = !hasKeyed;
  const isWdttPeer = hasWdtt, isCsqttPeer = hasCsqtt;
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
              await rotatePeerKeys(peer);
              await Store.poll();
              const re = Store.rowErrors["peer:" + peer.id];
              toast(re ? (re.msg || T("Rotate failed.")) : T("Credentials rotated — send the user their new QR and links; the old ones no longer work."), re ? "err" : "ok");
            } catch (e) { toast(T("Rotate failed."), "err"); }
            finally { setRotating(false); }
          })();
        } });
      return;
    }
    if (isKeyless) {
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
    foot=${footRow({ left: html`${editable && hasKeyed ? html`<button class="btn btn-ghost" onClick=${() => openPeerConfigs(peer, { child: true })}><${Ic} i="qr"/>QR</button>` : null}<button class="btn btn-ghost" onClick=${() => openAddTarget(peer)}><${Ic} i="copy"/> ${T("Targets")}</button>${isMobile() ? html`<button class="btn btn-danger m-pdel" onClick=${() => confirmDeletePeer(peer, null, true)}>${T("Delete")}</button>` : null}${fixBtn}${peerBlockBtn(peer)}`, onCancel: done, disabled: busy || !_dirty, title: _dirty ? "" : T("No changes to save"), onAction: save, action: T("Save") })}>
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
    <div class="field"><label>${T("label|Deployments")}</label>
      <div class="targetpick">${targetsOrdered.map(t => {
        const k = tkey(t.node, t.iface);
        const ity = targetType(t);
        const sc = isSelfContainedKind(ity);
        return html`<div class="targetopt sel locked" key=${k}>
          <div class="topt-main"><span class="box"><${Ic} i="check"/></span><span class="nm" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")} onMouseEnter=${nmTip}>${Store.nodeName(t.node)}</span><span class="tp">${t.iface}</span></div>
          <div class="topt-right hasprim">
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

export function openNodeCreate() { openModal(html`<${NodeCreateSheet}/>`); }
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
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const nameBad = name.trim() && !V.nodeName(name);
  const endpointOk = validNodeInstallEndpoint(endpoint);
  const create = async () => {
    if (!name.trim()) return setMsg({ k: "err", t: T("Give the node a name.") });
    if (!V.nodeName(name)) return setMsg({ k: "err", t: T("Name: 1–40 chars, letters/digits/-/_ only.") });
    if (!endpointOk) return setMsg({ k: "err", t: T("Enter the node's public hostname or IPv4 address.") });
    const r = await sheetSend(() => api.nodeCreate({ name: name.trim(), endpoint_host: endpoint.trim(), color }),
      t => setMsg(t ? { k: "err", t } : null), setBusy);
    if (!r.ok) return;
    openModal(html`<${NodeTokenSheet} enrollment=${r.data} isNew=${true} canInstall=${true}/>`);
    Store.poll().catch(() => {});
  };
  return html`<${Sheet} title=${T("Add node")}
    foot=${footRow({ onCancel: closeModal, disabled: busy || !!nameBad || !name.trim() || !endpointOk, onAction: create, action: T("Create node") })}>
    <div class="field"><label>${T("Name")}</label>
      <div class="namerow"><input autofocus class=${nameBad ? "bad" : ""} value=${name} onInput=${e => setName(e.target.value)} placeholder="msk-edge1" autocomplete="off"/>
        <${ThemedSwatch} val=${color} title=${T("Node colour")} onChange=${setColor} sample=${(c) => html`<span class="tg" style=${"background:color-mix(in srgb," + c + " 16%,transparent);color:" + c}>${name.trim() || T("tag|node")}</span>`}/></div>
      <div class=${"hint" + (nameBad ? " err" : "")}>${nameBad ? T("1–40 chars: letters, digits, - or _ only.") : T("A label for this node — you can rename it anytime. The swatches set its colour per theme.")}</div></div>
    ${nodeInstallEndpointField(endpoint, setEndpoint)}
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
const validNodeInstallEndpoint = value => !value.trim() || /^[a-z0-9][a-z0-9.-]*$/i.test(value.trim());

function nodeInstallEndpointField(value, onChange) {
  return html`<div class="field"><label>${T("Public hostname or IPv4 address (optional)")}</label>
    <input value=${value} onInput=${e => onChange(e.target.value)} placeholder="vpn.example.org" autocomplete="off"
      class=${!validNodeInstallEndpoint(value) ? "bad" : ""}/>
    <div class="hint">${T("Leave blank to detect the node's public IPv4 during installation.")}</div></div>`;
}

const quoteShell = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
const nodeInstallBootstrap = "https://raw.githubusercontent.com/tesla-prep/vpn-panel/main/bootstrap.sh";

function installNodeCmd(enrollment, endpoint) {
  const revision = /^[a-f0-9]{40}$/.test(enrollment.install_revision) ? enrollment.install_revision : "";
  const host = enrollment.panel_url || Store.panelPublicUrl || location.origin + BASE;
  let args = `-host ${quoteShell(host)}`;
  if (endpoint.trim()) args += ` -endpoint ${quoteShell(endpoint.trim())}`;
  if (revision) args += ` -revision ${revision}`;
  return `swg_bootstrap=$(curl -q -fsSL --proto '=https' ${nodeInstallBootstrap}) && printf '%s\\n' ${quoteShell(enrollment.token)} | sudo bash -c "$swg_bootstrap" -- node ${args}`;
}

export function NodeTokenSheet({ enrollment, isNew, canInstall }) {
  const [endpoint, setEndpoint] = useState(enrollment.endpoint_host || "");
  const install = canInstall && validNodeInstallEndpoint(endpoint) ? installNodeCmd(enrollment, endpoint) : "";
  const copyField = (label, value) => html`<div class="field"><label>${label}</label>
    <div class="cmdrow"><div class="tokenbox">${value}</div>
      <button class="copyaction" onClick=${() => copy(value, T("Copied"))}><${Ic} i="copy"/> ${T("Copy")}</button></div></div>`;
  return html`<${Sheet} title=${(isNew ? T("Node created") : T("New token")) + " · " + enrollment.name}
    foot=${html`<button class="btn btn-primary" onClick=${closeModal}>${T("Done")}</button>`}>
    ${canInstall && !isNew && (!enrollment.endpoint_host || !validNodeInstallEndpoint(enrollment.endpoint_host)) ? nodeInstallEndpointField(endpoint, setEndpoint) : null}
    ${install ? copyField(T("Node install command"), install) : null}
    ${canInstall ? html`<p class="hint">${T("Run the command on the Ubuntu node with curl and sudo. It contains the node token.")}</p>`
      : html`${copyField("NODE_TOKEN", enrollment.token)}
        <p class="hint">${T("Set NODE_TOKEN in /opt/swg-node/.env, then run sudo docker compose up -d in that directory.")}</p>`}
  <//>`;
}
export function openNodeEdit(node) { openModal(html`<${NodeEditSheet} node=${node}/>`); }

export function NodeEditSheet({ node }) {
  const rsv = (Store.panelSettings || {}).reserved || {};
  const dSub = rsv.mesh_subnet || "10.255.0.0/16", dPort = String(rsv.mesh_port_base || 9999), dPfx = rsv.iface_prefix || "swg_";
  const [name, setName] = useState(node.name || ""); const [color, setColor] = useState(() => toThemed(node.color, NODE_COLOR_DEFAULT)); const [msg, setMsg] = useState(null);
  const [ingress, setIngress] = useState(node.endpoint_host || "");
  const [meshPort, setMeshPort] = useState(node.mesh_port ? String(node.mesh_port) : dPort);
  const [meshSubnet, setMeshSubnet] = useState(node.mesh_subnet || dSub);
  const [meshPrefix, setMeshPrefix] = useState(node.mesh_prefix || dPfx);
  const [defEgress, setDefEgress] = useState(node.default_egress_ip || "");
  const [panelIp, setPanelIp] = useState(node.panel_ip || "");
  const [meshEgress, setMeshEgress] = useState(node.mesh_egress_ip || "");
  const ips = node.ips || [];
  const ovSub = meshSubnet.trim() === dSub ? "" : meshSubnet.trim();
  const ovPort = meshPort.trim() === dPort ? "" : meshPort.trim();
  const ovPfx = meshPrefix.trim() === dPfx ? "" : meshPrefix.trim();
  const nameBad = name.trim() && !V.nodeName(name);
  const reprovChanged = ovSub !== (node.mesh_subnet || "") || ovPfx !== (node.mesh_prefix || "");
  const [busy, setBusy] = useState(false);
  const doSave = async () => {
    const r = await sheetSend(() => api.nodeUpdate({ id: node.id, name: name.trim(), color, endpoint_host: ingress, mesh_port: ovPort,
        mesh_egress_ip: meshEgress, mesh_subnet: ovSub, mesh_prefix: ovPfx, default_egress_ip: defEgress, panel_ip: panelIp }),
      t => setMsg(t ? { k: "err", t } : null), setBusy);
    if (!r.ok) return;
    closeAllModals(); Store.poll().catch(() => {});
  };
  const save = async () => {
    if (!name.trim() || !V.nodeName(name)) return setMsg({ k: "err", t: T("Name: 1–40 chars, letters/digits/-/_ only.") });
    if (reprovChanged) {
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
    ${
 null}
    <div class="field"><label>${T("Mesh egress IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— source to dial other nodes")}</span></label>
      <${NodeIpPick} ips=${ips} value=${meshEgress} onChange=${setMeshEgress} auto=${T("Auto (default route)")}/>
      <div class="hint">${T("Which of this node's addresses it dials the other nodes' mesh links from. A single connection can still override it on its own card.")}</div></div>
    <div class="hint" style="margin-top:14px">${meshElsewhere()}</div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
export function openNodeRotate(node) { openModal(html`<${NodeRotateSheet} node=${node}/>`); }
export function NodeRotateSheet({ node }) {
  const go2 = async () => {
    const r = await api.nodeRotate({ id: node.id });
    if (!r.ok) { toast(srvText(r) || T("rotate failed"), "err"); return; }
    openModal(html`<${NodeTokenSheet} enrollment=${r.data} canInstall=${node.status === "dangling"}/>`);
  };
  return html`<${Sheet} title=${T("Rotate token · {v1}", { v1: node.name })}
    foot=${footRow({ onCancel: closeModal, onAction: go2, action: T("Rotate") })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${T("The current token stops working immediately. Re-enroll the node with the new token or it will go offline.")}</span></div>
  <//>`;
}
export function openNodeRemove(node) { openModal(html`<${NodeRemoveSheet} node=${node}/>`); }
export function unflagNode(n) {
  mutate({
    key: "node:" + n.id,
    patch: s => { const x = s.nodes.find(y => y.id === n.id); if (x) { delete x.removing; delete x.removing_at; } },
    call: () => api.nodeUnflagRemove({ id: n.id }),
  });
}
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
      patch: s => {
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
    ? (nixos ? "services.swg-node.enable = false;   # then: sudo nixos-rebuild switch" : "")
    : "cd /opt/swg-node && sudo docker compose down";
  const flag = () => { setFlagged(true); mutate({
    key: "node:" + node.id,
    patch: s => { const n = s.nodes.find(x => x.id === node.id); if (n) n.removing = true; },
    call: () => api.nodeFlagRemove({ id: node.id }),
  }); };
  const force = () => pushModal(html`<${ForceRemoveNodeSheet} node=${node}/>`);
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
