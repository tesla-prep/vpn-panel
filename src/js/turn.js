import { openLogs, TURN_SOURCES } from "./journal.js";
import { T, Trich, Tsplit, plural, pluralWord, srvText } from "./i18n.js";
import { esc, portOf, ipOf, ipChoices, ipPickerVal, seen, ago, dur, fmtBytes, isSelfContainedKind, isPrivIp, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { pickThemed, toThemed } from "./theme.js";
import {
  TURN_FORKS_FALLBACK, turnFork, turnOwner, turnForkList, turnForksVisible, forkLabel, forkPickLabel,
  forkSupportsAwg, forkSupportsAwg3, turnColor, turnClientColor, turnClientAuthor, CSQTT_DEFAULT_LINE,
} from "./turn-catalog.js";
import { kindOf, iTypeOf, targetType, nodeStale, ifaceNotUp, turnDown, turnLooping, turnLoopMins, turnProxiesFor, wdttOn, awg3Cls, awg3Tip, awgGen,
         isWdttName, isSelfContainedName, turnIfaceNameError,
         suggestPort, portHolder, portErrMsg, nextWdttName, cidrNet, subnetsOverlap, subnetFleetConflict,
         subnetServerAddr, suggestSubnet, ghostIface, ghostPeers } from "./model.js";
import { Ic, ICON, Tag, Panel, Badge, StatusTag, CmdErr, Sheet, sheetSend, footRow, secTitle, SearchBox, Switch, Dropdown, Disclosure, autoGrow, IpPicker, NodeIpPick, useHostOnNode, Popover, Portal, toast, copy, mutate, rowError, openModal, pushModal, closeModal, closeAllModals, openConfirm, openChildOrRoot, useReorder, GRIP_SVG, opTag, procTag, inProc, statusLabel, goSettings, goSettingsTurnIps, takePendingTurnIps, trackIfaceOps, startOrRestartWdtt, startOrRestartCsqtt, ifaceReady, ifaceWasBusy, RowError, LogBody, logRaw, logRendered, rowSingle, rowDouble, rowNoSelect, ConfirmSheet, orderById, procLabel, typeToConfirm } from "./ui.js";
import { EgressPicker, NatSourcePick, natPinApplies, egressInit, egressSaveBlock, egressBody, ifTrafficBadge, BlockTraffic, blockActiveN, RoutingRules, rulesTitle, reportDropped, rulesSummary,
  WhoPicker, peersOn, whoCount, whoEntries, whoEntryName } from "./routing.js";
import { canonWho, newGid } from "./rulerows.js";
import { turnConnRows, wdttConnRows, OnlPop, OnlinePeersTag, orphCount, ProxyDropsPop, dropRate, ReachField, namedFew } from "./views.js";
import { IfaceThroughput, RangedHistory, lossColor } from "./charts.js";
import { buildConf, downloadConf, QR, qrDataURL, turnArtifact, subFeatureOn,
         ensureVaultUnlocked, wdttResealForNode } from "./crypto.js";
import { idnHost } from "./idn.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

const mTurnHead = (kind, name, fork, ver, gear, extras) => ({
  title: html`<span class="m-th-kind">${kind}</span>${name}`,
  headExtra: html`<span class="m-th-fork">${fork}${ver ? html` <span class="sheet-ver">${ver}</span>` : ""}</span>${gear}${extras || null}` });
export function turnSheetTitle(fork, title) { return T("Turn-proxy · {v1}", { v1: ((title || "").trim() ? (title.trim() + " · ") : "") + fork }); }
const errMsg = setMsg => t => setMsg(t ? { k: "err", t } : null);
export function randWrapKey() { const a = new Uint8Array(32); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, "0")).join(""); }

export function listenHostInit(epIp, ips, nodeIps, bridge) {
  const have = (nodeIps || []).filter(Boolean);
  if (have.length && !bridge && !have.some(ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !isPrivIp(ip)))
    return (ips || []).find(ip => !have.includes(ip) && !isPrivIp(ip)) || (ips || [])[0] || "__custom__";
  const own = (ips || []).filter(ip => have.includes(ip));
  if (epIp && (have.includes(epIp) || !own.length)) return epIp;
  if (own.length) return own[0];
  return (ips || [])[0] || "__custom__";
}

const _WILD = ["0.0.0.0", "::", "[::]", "*"];
export function useListenState(node, host, saved, bound, pin) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const h = String(host || "").trim();
  const pred = useHostOnNode(_WILD.includes(h) ? "" : h, nrec.ips || []);
  if (!h) return {};
  if (pin && nrec.turn_bind_any && (nrec.ips || []).includes(pin)) return {};
  if (_WILD.includes(h)) return { wild: true };
  const b = bound && h === String(saved || "").trim() ? ipOf(bound) : "";
  if (b && !_WILD.includes(b) && b !== h.replace(/^\[|\]$/g, "")) return {};
  if (!(_WILD.includes(b) && b) && pred !== "bad") return {};
  if (nrec.kind === "docker" && (nrec.net_mode || "host") === "bridge") return { bridge: true };
  if (!nrec.turn_bind_any) return { old: true };
  if (b && !_WILD.includes(b)) return { stale: true };
  return { any: true, multi: wanV4(nrec).length > 1 };
}

const wanV4 = nrec => {
  const v4 = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip || "");
  const onWan = nrec.wan_iface ? (nrec.ip_ifaces || []).filter(p => p && p.iface === nrec.wan_iface && v4(p.ip)).map(p => p.ip) : [];
  return onWan.length ? onWan : (nrec.ips || []).filter(v4);
};

export function turnDialFallback(node, fwdIface) {
  if (fwdIface !== undefined) {
    const ep = String((((Store.describe || {})[node] || {})[fwdIface] || {}).endpoint || "");
    const i = ep.lastIndexOf(":");
    return i >= 0 ? ep.slice(0, i) : ep;
  }
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const pub = (((Store.stats[node] || {}).node_ips) || []).find(ip => ip && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) || "";
  return (nrec.endpoint_host || "").trim() || pub;
}

const fwdByPort = (list, hp) => ((list || []).find(i => i.port && i.port === portOf(hp)) || {}).name || "";

const _toIngress = () => html`<button class="linkbtn" onClick=${() => goSettings("mesh")}>${T("Panel settings → Network")}</button>`;

export function ListenHint({ st, hint, fallback }) {
  if (st.wild) return html`<div class="hint">${fallback
    ? Trich("Listens on all addresses (0.0.0.0); clients dial `{v1}`.", { v1: fallback })
    : Trich("Listens on all addresses (0.0.0.0), and clients have no host to dial — set the node's ingress address in {v1}.", { v1: _toIngress() })}</div>`;
  if (st.any) return html`<div class="hint">${T("Not an address of this node, so it listens on all addresses (0.0.0.0).")}</div>`;
  return html`<div class="hint">${hint || T("What clients dial")}</div>`;
}

export function ListenNotice({ st }) {
  if (st.bridge) return html`<div class="notice" style="margin:-6px 0 16px"><${Ic} i="info"/><span>${Trich("Bridge node: the proxy binds `0.0.0.0` inside the container and this port is published, so enter the node's *public* IP/host (what clients dial) here.")}</span></div>`;
  if (st.old) return html`<div class="notice warn" style="margin:-6px 0 16px"><${Ic} i="warn"/><span>${Trich("Not an address of this node, and this node's version binds it as typed, so the server would fail with `bind: cannot assign requested address`. Update the node, or enter one of its own addresses.")}</span></div>`;
  if (st.stale) return html`<div class="notice warn" style="margin:-6px 0 16px"><${Ic} i="warn"/><span>${Trich("This server still binds the address as typed — it was set up before this node could listen on all addresses — so it cannot start. *Restart service* to apply it.")}</span></div>`;
  if (st.any && st.multi) return html`<div class="notice warn" style="margin:-6px 0 16px"><${Ic} i="warn"/><span>${Trich("This node has several IPv4 addresses. Listening on all of them, a reply can leave from one clients didn't dial, and the VK relay drops it. Pick the address to listen on under *Listen on* — behind NAT, the one your router forwards this port to.")}</span></div>`;
  return null;
}

const _v4 = ip => /^\d+\.\d+\.\d+\.\d+$/.test(ip || "");
export function ListenOnField({ node, value, onChange }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const nicOf = ip => ((nrec.ip_ifaces || []).find(p => p && p.ip === ip) || {}).iface || "";
  const tun = dev => !!dev && (Store.ifacesOf(node).includes(dev) || isSelfContainedName(dev));
  const v4 = (nrec.ips || []).filter(ip => _v4(ip) && !tun(nicOf(ip)));
  if ((nrec.kind === "docker" && (nrec.net_mode || "host") === "bridge") || !nrec.turn_bind_any) return null;
  if (v4.length < 2 && !value) return null;
  const opts = [{ value: "", label: T("val|Auto") },
    ...v4.map(ip => ({ value: ip, label: [ip, nicOf(ip), isPrivIp(ip) ? T("private") : ""].filter(Boolean).join(" · ") })),
    ...(value && !v4.includes(value) ? [{ value, label: value + " · " + T("not on this node") }] : [])];
  return html`<div class="field"><label>${T("Listen on")}</label>
    <${Dropdown} value=${value || ""} onChange=${onChange} options=${opts} ariaLabel=${T("Listen on")}/>
    <div class="hint">${value
      ? T("Only this address — replies leave from it. Clients still dial the endpoint above.")
      : T("The endpoint's own address when it is on this node, otherwise all addresses.")}</div></div>`;
}








export function turnListRows(list) {
  return list.map(tp => { const f = turnFork(tp.service); return html`<div class=${"turnlist-row" + (turnDown(tp) ? " muted" : "")}>
    <span class="tg tg-turn" style=${"--tfc:" + turnColor(f)}>${forkLabel(f)}</span>${tp.title ? html`<span class="turnlist-ttl">${tp.title}</span>` : null}</div>`; });
}
export function ifaceTurnBadges(node, fwdTurns, compact) {
  if (!fwdTurns || !fwdTurns.length) return null;
  const stale = nodeStale(node);
  const bubble = (trigger, list) => html`<${Popover} hoverOnly cls="turncollwrap" popCls="turnlist" trigger=${trigger}>${turnListRows(list)}<//>`;
  if (fwdTurns.length > 3) {
    const allDown = fwdTurns.every(turnDown);
    const trigger = html`<span class=${"tg tg-turn tf-gen turncoll" + ((stale || allDown) ? " muted" : "") + (compact ? " mini" : "")}>${compact ? "t" : "turn"}<b class="turnx">×${fwdTurns.length}</b></span>`;
    return bubble(trigger, fwdTurns);
  }
  const groups = {};
  fwdTurns.forEach(tp => { const f = turnFork(tp.service); (groups[f] = groups[f] || []).push(tp); });
  return Object.entries(groups).map(([f, list]) => {
    const allDown = list.every(turnDown);
    const trigger = html`<span class=${"tg tg-turn tf-" + f + ((stale || allDown) ? " muted" : "") + (compact ? " mini" : "")}>${compact ? "t" : "turn"}</span>`;
    return bubble(trigger, list);
  });
}

const _optTitle = {};
export function pushOptTitle(key, title) { _optTitle[key] = { title: (title || "").trim(), at: Date.now() }; Store.apply(); }
export function shownTitle(key, real) {
  const o = _optTitle[key];
  if (!o) return real || "";
  if ((real || "") === o.title || Date.now() - o.at > 20000) { delete _optTitle[key]; return real || ""; }
  return o.title;
}
export function turnLoopText(tp) {
  return T("{v1}: crash-looping — {v2} restarts in {v3} min", { v1: tp.service, v2: tp.flapping, v3: turnLoopMins(tp) })
    + ". " + T("Clients can reach it, but every session through it is cut each time it dies. Its journal on the node says why.");
}

export function TurnCard({ node, tp, nrec, metas, showForwards = true, reorder }) {
  metas = metas || {};
  const it = reorder ? reorder.item(tp.service) : null;
  const lp = portOf(tp.connect);
  const fronted = Object.keys(metas).find(i => String((metas[i] || {}).listen_port) === lp);
  const ftype = (fronted && metas[fronted].awg_params && Object.keys(metas[fronted].awg_params).length) ? "awg" : "wg";
  const off3 = !!fronted && !forkSupportsAwg3(turnFork(tp.service)) && awgGen(node, fronted) === "3.1";
  const _pendRaw = (nrec.turn_pending || {})[tp.service];
  const pend = _pendRaw === "title" ? undefined : _pendRaw;
  const err = (nrec.cmd_errors || {})[tp.service];
  const prog = (nrec.cmd_progress || {})[tp.service];
  const installing = !!tp.installing;
  const queued = !!tp.pending;
  const failed = !!tp.failed;
  const stopped = !!tp.stopped;
  const looping = turnLooping(tp) && !installing && !queued && !failed;
  const down = turnDown(tp) && !looping && !installing && !queued && !failed && !stopped;
  const converting = (nrec.proc_status || "").startsWith("converting");
  const k = node + "|" + tp.service;
  const justRestarted = !pend && turnRestarted[k] && Date.now() < turnRestarted[k];
  const updating = pend && turnUpdating[k] && Date.now() < turnUpdating[k];
  const pendLabel = updating ? ((installing || prog) ? T("updating") : T("turn|pending"))
    : (pend && pend !== "install" && pend !== "reinstall") ? (turnPendLabel(pend) || T("turn|creating")) : T("turn|creating");
  const dim = !justRestarted && (installing || queued || pend || failed || looping || down || stopped || err);
  const nblocked = nodeStale(node) || inProc(nrec.proc_status);
  const _busy = !!(queued || installing || (pend && pend !== "delete"));
  const _bad = !!(failed || looping || down || converting || stopped);
  const _settled = !!fronted && !_bad && !_busy;
  if (turnWasInstalling[k] && !installing && !_bad) turnReady[k] = Date.now() + 5000;
  if (turnWasBusy[k] && _settled) {
    turnReady[k] = Date.now() + 5000;
    if (turnWasUpd[k]) { turnUpdatedFlash[k] = Date.now() + 5000; delete turnUpdating[k]; }
  }
  turnWasUpd[k] = updating;
  turnWasInstalling[k] = !!installing;
  turnWasBusy[k] = _busy;
  const turnReadyNow = !_bad && !!fronted && !!turnReady[k] && Date.now() < turnReady[k];
  const conn = fronted ? turnConnRows(node, fronted, tp.service) : [];
  const canOpen = nrec.turn_manage && !nblocked && !_busy && pend !== "delete";
  return html`<div class=${"ifcard tp" + (canOpen ? " clickable" : "") + (dim ? " down" : "") + (nblocked ? " locked" : "") + (it ? it.cls : "")} onClick=${canOpen ? () => openTurnManage(node, tp) : null} data-rid=${it ? it.rid : null}>
    <div class="ifcard-top">${reorder ? html`<span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.stopPropagation()} ...${reorder.grip(tp.service)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>` : null}<span class=${"iftype turn tf-" + turnFork(tp.service)}>${T("val|turn")}</span><span class="ifname">${shownTitle("t|" + node + "|" + tp.service, tp.title) || forkLabel(turnFork(tp.service))}</span><span class="grow"></span>${conn.length ? html`<${OnlPop} peer title=${T("Via this turn-proxy")} cls="ifc-conn" rows=${conn} trigger=${c => html`<b class="oncount on">${c}</b>`}/>` : null}${converting
      ? html`<${StatusTag} cls="tg-convert" icon="clock" label="converting" title=${T("The node is converting between bare-metal and docker")}/>`
      : pend === "delete"
      ? html`<${StatusTag} cls="tg-busy del" label=${T("deleting…")} msg=${err || prog} title=${err ? T("Command failed on the node") : T("Working on the node")}/><button class="xbtn" title=${T("Cancel this request")} onClick=${e => { e.stopPropagation(); cancelTurn(node, { service: tp.service }); }}><${Ic} i="x"/></button>`
      : installing ? html`<${StatusTag} cls=${"tg-busy" + (prog ? " warn" : "")} icon="clock" label=${pendLabel} msg=${prog} title=${T("The node is setting it up right now")}/>`
      : turnReadyNow ? html`<span class=${"tg " + ((turnUpdatedFlash[k] && Date.now() < turnUpdatedFlash[k]) ? "tg-ok" : "tg-ready")}><${Ic} i="check"/>${(turnUpdatedFlash[k] && Date.now() < turnUpdatedFlash[k]) ? T("updated") : T("turn|ready")}</span>`
      : (pend || queued) ? html`<${StatusTag} cls="tg-busy" icon="clock" label=${pend ? pendLabel : "creating"} msg=${err} title=${pend ? T("The node is setting it up") : T("Queued — the node creates these one at a time")}/>${pend ? html`<button class="xbtn" title=${T("Cancel this request")} onClick=${e => { e.stopPropagation(); cancelTurn(node, { service: tp.service }); }}><${Ic} i="x"/></button>` : null}`
      : failed ? html`<${StatusTag} cls="tg-busy del" icon="warn" label=${T("install failed")} msg=${err || T("the install failed on the node")} title=${T("Command failed on the node")}/>`
      : justRestarted ? html`<span class="tg tg-ok"><${Ic} i="check"/>${T("tag|restarted")}</span>`
      : stopped ? html`<span class="tg-off" title=${T("Stopped from the panel — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
      : looping ? html`<${StatusTag} cls="tg-busy del" icon="warn" label=${T("tag|crash-looping")} msg=${err || turnLoopText(tp)} title=${T("Service keeps crashing on the node")}/>`
      : down ? html`<${StatusTag} cls="tg-busy del" label="down" msg=${err || T("service is not running on the node")} title=${T("Service down on the node")}/>`
      : (!fronted ? html`<span class="tg tg-warn" title=${T("Forwards to a port with no managed interface behind it — likely a misconfiguration.")}>${T("tag|unbound")}</span>` : null)}</div>
    <div class="ifcard-rows">
      <div class="ifrow"><span class="l">${T("Turn-proxy fork")}</span><span class="r">${forkLabel(turnFork(tp.service))}</span></div>
      <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${tp.listen || "—"}</span></div>
      ${(() => {
        const _pd = ((Store.stats[node] || {}).turn_drops || {})[tp.service];
        if (!_pd || !(_pd.win_drops > 0)) return null;
        return html`<div class="ifrow"><span class="l">${T("col|Drops")}</span><span class="r addr"
          onClick=${e => { e.preventDefault(); e.stopPropagation(); }}><${ProxyDropsPop} d=${_pd} service=${tp.service}
            trigger=${html`<span class="dp-num" style=${"color:" + lossColor(Math.min(5, (_pd.per_min || 0) / 20))}>${dropRate(_pd.per_min)}${T("unit|/min")}</span>`}/></span></div>`;
      })()}
      ${showForwards ? html`<div class="ifrow"><span class="l">${T("Forwards to")}</span><span class="r">${fronted ? html`<a class=${"tg tg-" + ftype + awg3Cls(node, fronted) + ((nodeStale(node) || ifaceNotUp(node, fronted)) ? " muted" : "")} ...${awg3Tip(node, fronted)} href=${"#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(fronted)} onClick=${e => e.stopPropagation()}>${fronted}</a>` : (tp.connect || "—")}${off3 ? html` <span class="tg tg-warn" title=${T("{v1} runs AmneziaWG 3.1, and this proxy's app carries AmneziaWG 2.0 only — its clients cannot connect. Point it at a 2.0 interface.", { v1: fronted })}><${Ic} i="warn"/>${T("tag|2.0 app")}</span>` : null}</span></div>` : null}
    </div></div>`;
}

export function TurnProxiesBlock({ node, nrec, snap, metas, title, iface }) {
  snap = snap || Store.stats[node] || {}; metas = metas || Store.describe[node] || {}; nrec = nrec || {};
  const all = snap.turn_proxies || [];
  const _canFrontTurn = Object.entries(metas).some(([n, b]) => (b || {}).listen_port && !((b || {}).system || String(n).startsWith("swg_") || isSelfContainedName(n)));
  const cards = iface ? turnProxiesFor(node, iface) : orderById(all, nrec.turn_order, tp => tp.service);
  const wdttInsts = !iface ? (snap.wdtt || []).filter(w => w && w.iface)
                           : (snap.wdtt || []).filter(w => w && w.iface === iface);
  const csqttInsts = !iface ? (snap.csqtt || []).filter(c => c && c.iface)
                            : (snap.csqtt || []).filter(c => c && c.iface === iface);
  const _turnOrder = orderById([...cards.map(tp => tp.service), ...wdttInsts.map(w => "wdtt:" + w.iface), ...csqttInsts.map(c => "csqtt:" + c.iface)], nrec.turn_order, x => x);
  const tReorder = useReorder(iface ? [] : _turnOrder, ids => mutate({
    patch: s => { const nn = (s.nodes || []).find(x => x.id === node); if (nn) nn.turn_order = ids; },
    call: () => api.saveOrder({ kind: "turn", node, order: ids }),
  }));
  if (iface && !cards.length && !wdttInsts.length) return null;
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const archNo = nrec.turn_arch_ok === false;
  const archTip = T("No turn-proxy build for this node's architecture{v1} — only amd64 and arm64 are supported.", { v1: nrec.arch ? " (" + nrec.arch + ")" : "" });
  const _tpfx = node + "|";
  for (const k of Object.keys(Store.turnNew)) { if (!k.startsWith(_tpfx)) continue; const s = k.slice(_tpfx.length); if (all.some(t => t.service === s) || (Date.now() - (Store.turnNew[k].at || 0) > 900000)) delete Store.turnNew[k]; }
  const optTurns = iface ? [] : Object.keys(Store.turnNew).filter(k => k.startsWith(_tpfx)).map(k => ({ svc: k.slice(_tpfx.length), d: Store.turnNew[k] })).filter(o => !all.some(t => t.service === o.svc));
  const optSvcs = new Set(optTurns.map(o => o.svc));
  const optCard = (svc, d) => { const lp = portOf(d.connect); const fronted = Object.keys(metas).find(i => String((metas[i] || {}).listen_port) === lp); const ftype = (fronted && metas[fronted].awg_params && Object.keys(metas[fronted].awg_params).length) ? "awg" : "wg";
    return html`<div class="ifcard tp down" key=${"new:" + svc}>
      <div class="ifcard-top"><span class=${"iftype turn tf-" + turnFork(svc)}>${T("val|turn")}</span><span class="ifname">${d.title || forkLabel(turnFork(svc))}</span><span class="grow"></span><${CmdErr} err=${(nrec.cmd_errors || {})[svc]}/><${StatusTag} cls="tg-pending" icon="clock" label="pending" title=${T("Assigned — waiting for the node to pick it up and install it")}/><button class="xbtn" title=${T("Cancel this request")} onClick=${() => { delete Store.turnNew[node + "|" + svc]; cancelTurn(node, { service: svc }); }}><${Ic} i="x"/></button></div>
      <div class="ifcard-rows">
        <div class="ifrow"><span class="l">${T("Turn-proxy fork")}</span><span class="r">${forkLabel(turnFork(svc))}</span></div>
        <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${d.listen || "—"}</span></div>
        <div class="ifrow"><span class="l">${T("Forwards to")}</span><span class="r">${fronted ? html`<a class=${"tg tg-" + ftype + awg3Cls(node, fronted)} ...${awg3Tip(node, fronted)} href=${"#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(fronted)} onClick=${e => e.stopPropagation()}>${fronted}</a>` : (d.connect || "—")}</span></div>
      </div></div>`; };
  return html`<${Panel} icon="relay" title=${title} tone="turn" count=${cards.length + optTurns.length + wdttInsts.length + csqttInsts.length}
      actions=${nrec.turn_manage ? html`<${Fragment}>${(() => {
        const _u = iface ? [] : (Store.turnUpdates || []).filter(r => r.node === node);
        return _u.length ? html`<button class="btn btn-mini updbtn" title=${T("Deployed servers on this node are behind their newest build — review and update")} onClick=${() => openTurnUpdates(node)}><${Ic} i="download"/> ${plural(_u.length, "update")}</button>` : null;
      })()}<button class="btn btn-mini ico" title=${T("These turn proxies' live logs")} onClick=${() => openLogs({ nodes: [node], src: TURN_SOURCES })}><${Ic} i="doc"/></button><button class="btn btn-mini ico" title=${T("Turn-proxy settings in Settings → Turn proxies")} onClick=${() => goSettings("turn")}><${Ic} i="gear"/></button>${_canFrontTurn && !(iface && isSelfContainedName(iface)) ? html`<button class="btn btn-mini" disabled=${blocked || archNo} title=${blocked ? T("Unavailable while the node is down / converting") : archNo ? archTip : ""} onClick=${() => openSetupTurn(node, iface)}><${Ic} i="plus"/> ${isMobile() ? T("rowact|New") : T("Setup new proxy")}</button>` : null}<//>` : null}>
    ${(!iface && !nrec.turn_manage) ? html`<div class="notice"><${Ic} i="info"/><span>${nrec.declarative
      ? Trich("Turn-proxy management is *off* on this node — its configuration has it off (*turnManage*), so these are read-only here. Turn it on there and rebuild, or manage them on the box directly.")
      : Trich("Turn-proxy management is *off* on this node — no Docker socket was mounted at install (*TURN_MANAGE=manual*), so these are read-only here. Add, edit or restart them on the box directly.")}</span></div>` : null}
    <div class="ifgrid" ...${iface ? {} : tReorder.container()}>${iface
      ? html`<${Fragment}>
          ${wdttInsts.map(w => html`<${WdttCard} key=${"wdtt:" + w.iface} node=${node} w=${w} reorder=${null}/>`)}
          ${csqttInsts.map(c => html`<${CsqttCard} key=${"csqtt:" + c.iface} node=${node} c=${c} reorder=${null}/>`)}
          ${cards.map(tp => html`<${TurnCard} key=${tp.service} node=${node} tp=${tp} nrec=${nrec} metas=${metas} showForwards=${false} reorder=${null}/>`)}
        <//>`
      : _turnOrder.map(id => {
          const w = id.indexOf("wdtt:") === 0 ? wdttInsts.find(x => "wdtt:" + x.iface === id) : null;
          if (w) return html`<${WdttCard} key=${id} node=${node} w=${w} reorder=${tReorder}/>`;
          const c = id.indexOf("csqtt:") === 0 ? csqttInsts.find(x => "csqtt:" + x.iface === id) : null;
          if (c) return html`<${CsqttCard} key=${id} node=${node} c=${c} reorder=${tReorder}/>`;
          const tp = cards.find(t => t.service === id);
          return tp ? html`<${TurnCard} key=${tp.service} node=${node} tp=${tp} nrec=${nrec} metas=${metas} showForwards=${true} reorder=${tReorder}/>` : null;
        })}
    ${optTurns.map(o => optCard(o.svc, o.d))}
    ${!iface ? Object.entries(nrec.turn_pending || {}).filter(([s]) => !all.some(t => t.service === s) && !optSvcs.has(s)).map(([s, act]) => html`<div class="ifcard tp pending"><div class="ifcard-top"><span class="iftype turn">${T("val|turn")}</span><span class="ifname">${forkLabel(turnFork(s))}</span><span class="grow"></span><${CmdErr} err=${(nrec.cmd_errors || {})[s]}/>${act === "delete" ? html`<span class="tg-busy del">${T("deleting…")}</span>` : html`<span class="tg tg-pending"><${Ic} i="clock"/>${T("tag|pending")}</span>`}<button class="xbtn" title=${T("Cancel this request")} onClick=${() => cancelTurn(node, { service: s })}><${Ic} i="x"/></button></div></div>`) : null}
    ${!iface ? (nrec.turn_onboarding || []).map(p => html`<div class="ifcard tp pending"><div class="ifcard-top"><span class="iftype turn">${T("val|turn")}</span><span class="ifname">${T("adopting…")}</span><span class="grow"></span><${CmdErr} err=${(nrec.cmd_errors || {})[p]}/><span class="tg-busy">${T("adopting…")}</span><button class="xbtn" title=${T("Cancel this request")} onClick=${() => cancelTurn(node, { path: p })}><${Ic} i="x"/></button></div><div class="ifcard-rows"><div class="ifrow"><span class="l faint" style="word-break:break-all">${p}</span></div></div></div>`) : null}
    </div>
  <//>`;
}



const _forkTag = svc => {
  const scm = /^swg-(wdtt|csqtt)-/.exec(String(svc || ""));
  if (scm) {
    const kind = scm[1];
    let fork = "";
    for (const nid of Object.keys(Store.stats || {})) {
      const inst = ((Store.stats[nid] || {})[kind] || []).find(x => x && x.service === svc);
      if (inst) { fork = inst.fork || ""; break; }
    }
    if (!fork) fork = kind === "csqtt" ? "csqtt" : "amurcanov";
    const label = forkLabel(fork);
    return html`<span class="tg tg-turn" style=${"--tfc:" + (turnColor(fork) || WDTT_COLOR)}>${label}</span>`;
  }
  return html`<span class="tg tg-turn" style=${"--tfc:" + turnColor(turnFork(svc))}>${forkLabel(turnFork(svc))}</span>`;
};
const _lastSeen = last => last ? T("{v1} ago", { v1: seen(Math.max(0, Math.floor(Date.now() / 1000) - last)) }) : "—";

export function ProxyDropsHeader({ node, svc }) {
  useStore();
  const d = ((Store.stats[node] || {}).turn_drops || {})[svc];
  if (!d) return null;
  const r = d.per_min || 0;
  return html`<${ProxyDropsPop} d=${d} service=${svc} alignRight=${true}
    trigger=${html`<span class="turnips-hd pxdrop-hd">${T("Drops")} · <b style=${"color:" + lossColor(Math.min(5, r / 20))}>${
      r ? dropRate(r) + T("unit|/min") : "0"}</b></span>`}/>`;
}

function useTurnIps(node, svc) {
  useStore();
  const [data, setData] = useState(null);
  const load = () => api.turnIps().then(r => setData(r && r.ok ? ((r.data.nodes || {})[node] || {}) : {})).catch(() => setData({}));
  useEffect(() => { load(); }, [node]);
  const _snap = Store.stats[node] || {};
  const _ent = (_snap.turn_proxies || []).find(t => t.service === svc)
            || (_snap.wdtt || []).find(w => w && w.service === svc)
            || (_snap.csqtt || []).find(c => c && c.service === svc);
  const active = new Set(_ent ? (_ent.src_ips || []) : []);
  const recs = data || {};
  const ips = new Set([...Object.keys(recs).filter(ip => (recs[ip].by || []).includes(svc)), ...active]);
  const all = [...ips].map(ip => ({ ip, last: (recs[ip] || {}).last, on: active.has(ip) }))
    .sort((a, b) => (a.on === b.on ? (b.last || 0) - (a.last || 0) : a.on ? -1 : 1));
  const rows = all.slice(0, 10);
  const offlineN = all.filter(r => !r.on).length;
  const flush = () => openConfirm({ title: T("Flush offline recorded IPs"), confirmLabel: T("Flush"), danger: true,
    body: Trich(T("Remove {count} offline recorded for *this turn-proxy only*. Currently-online relays are kept, and other proxies are untouched.", { count: plural(offlineN, "IP") })),
    onConfirm: async () => { await api.turnIpsFlush({ node, service: svc }); load(); } });
  const tipRows = () => html`${rows.length ? html`<${Fragment}>
      ${rows.map(r => html`<div class="tipbub-row" key=${r.ip}><span class=${"tipdot" + (r.on ? " on" : "")}></span><span class="tipbub-ip">${r.ip}</span><span class="grow"></span><span class="tipbub-when">${r.on ? T("val|online") : _lastSeen(r.last)}</span></div>`)}
      ${all.length > rows.length ? html`<div class="tipbub-more">${T("+{n} more in Settings", { n: all.length - rows.length })}</div>` : null}
      ${offlineN ? html`<button class=${"tipbub-flush" + (isMobile() ? " btn btn-danger" : "")} onClick=${flush}><${Ic} i="trash"/> ${T("Flush offline recorded IPs")}</button>` : null}
    <//>`
      : html`<div class="tipbub-empty">${data === null ? T("Loading…") : T("No connections seen yet.")}</div>`}`;
  return { active, tipRows };
}
function TurnIpsSheet({ node, svc }) {
  const { tipRows } = useTurnIps(node, svc);
  return html`<${Sheet} title=${T("Collected VK IPs")} noGuard=${true} foot=${html`<button class="btn btn-ghost" onClick=${() => goSettingsTurnIps()}><${Ic} i="gear"/> ${T("Open Settings")}</button>
      <button class="btn btn-ghost" onClick=${closeModal}>${T("Close")}</button>`}>
    <div class="m-tiplist">${tipRows()}</div><//>`;
}
export function TurnIpsHeader({ node, svc }) {
  const { active, tipRows } = useTurnIps(node, svc);
  const label = html`${T("Turn IPs")}${active.size ? html` · <b>${active.size}</b>` : ""}`;
  if (isMobile()) return html`<span class="turnips-wrap"><span class="turnips-hd" role="button" onClick=${() => pushModal(html`<${TurnIpsSheet} node=${node} svc=${svc}/>`)}>${label}</span></span>`;
  const trigger = html`<span class="turnips-hd" onClick=${() => goSettingsTurnIps()}>${label}</span>`;
  return html`<${Popover} hoverOnly cls="turnips-wrap" popCls="turnips-pop" trigger=${trigger}>
    <div class="onpop-h">${T("Collected VK IPs")}</div>
    ${tipRows()}
  <//>`;
}

export function TurnCollectedIps() {
  const [show, setShow] = useState(false);
  const [data, setData] = useState(null);
  const secRef = useRef(null);
  const load = () => api.turnIps().then(r => setData(r && r.ok ? (r.data.nodes || {}) : {})).catch(() => setData({}));
  useEffect(() => { if (show && data === null) load(); }, [show]);
  useEffect(() => {
    if (takePendingTurnIps()) { setShow(true); setTimeout(() => secRef.current && secRef.current.scrollIntoView({ behavior: "smooth", block: "center" }), 150); }
  }, []);
  const rows = [];
  for (const [nid, ips] of Object.entries(data || {}))
    for (const [ip, rec] of Object.entries(ips))
      rows.push({ nid, ip, last: rec.last, by: rec.by || [], on: (rec.active_by || []).length > 0 });
  rows.sort((a, b) => (a.on === b.on ? (b.last || 0) - (a.last || 0) : a.on ? -1 : 1));
  const del = async (nid, ip) => { await api.turnIpsFlush({ node: nid, ip }); load(); };
  const flushAll = () => openConfirm({ title: T("Flush recorded IP history"), confirmLabel: T("Flush"), danger: true,
    body: T("Flush the collected turn-proxy IP history across the fleet? The currently-online IPs are kept."),
    onConfirm: async () => { await api.turnIpsFlush({}); load(); } });
  return html`<${Fragment}>
    <button type="button" ref=${secRef} class="advtoggle" style="margin-top:18px" onClick=${() => setShow(a => !a)}><span class="advcaret">${show ? "▾" : "▸"}</span> ${T("Collected IPs")}${show && rows.length ? html` <span class="count">${rows.length}</span>` : ""}</button>
    ${show ? html`<${Fragment}>
    <p class="hint" style="margin:8px 0 10px">${T("Unique VK server IPs the nodes collected via turn-proxies.")}</p>
    ${data === null ? html`<div class="hint">${T("Loading…")}</div>`
      : rows.length ? html`<${Fragment}>
        <div class="tipgrid">
          <div class="tipgrid-h"><span>${T("Turn IP")}</span><span>${T("Last")}</span><span>${T("Collected by")}</span><span></span></div>
          ${rows.map(r => html`<div class="tiprow" key=${r.nid + "|" + r.ip}>
            <span class="tip-ip"><span class=${"tipdot" + (r.on ? " on" : "")}></span>${r.ip}</span>
            <span class="tip-last">${r.on ? T("val|online") : _lastSeen(r.last)}</span>
            <span class="tip-by">${r.by.map(_forkTag)}</span>
            <button class="xbtn" title=${T("Delete this IP record")} onClick=${() => del(r.nid, r.ip)}><${Ic} i="x"/></button>
          </div>`)}
        </div>
        <div class="tipfoot"><button class="btn btn-mini warn" onClick=${flushAll}><${Ic} i="trash"/> ${T("Flush turn-proxies history")}</button></div>
      <//>`
      : html`<div class="hint">${T("No turn-proxy connections collected yet.")}</div>`}
    <//>` : null}
  <//>`;
}

export function openTurnManage(node, tp) { openModal(html`<${TurnManageSheet} node=${node} tp=${tp}/>`); }
export function TurnManageSheet({ node, tp }) {
  const svc = tp.service;
  const lis = tp.listen || "";
  const lh = lis.includes(":") ? lis.slice(0, lis.lastIndexOf(":")) : lis;
  const lp = lis.includes(":") ? lis.slice(lis.lastIndexOf(":") + 1) : "";
  const con = tp.connect || "";
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const snap = Store.stats[node] || {};
  const isBridge = nrec.kind === "docker" && (nrec.net_mode || "host") === "bridge";
  const epIp = (() => { for (const b of Object.values(snap.interfaces || {})) { const ep = (b.meta || {}).endpoint || ""; if (ep) return ep.includes(":") ? ep.slice(0, ep.lastIndexOf(":")) : ep; } return ""; })();
  const ips = ipChoices(nrec, epIp);
  const lInit = ips.includes(lh) ? lh : "__custom__";
  const [lsel, setLsel] = useState(lInit);
  const [lcustom, setLcustom] = useState(lInit === "__custom__" ? lh : "");
  const [lport, setLport] = useState(lp);
  const tperr = portErrMsg(node, lport, [lp]);
  const allIfaces = Object.entries(snap.interfaces || {})
    .map(([n, b]) => ({ name: n, port: String((b.meta || {}).listen_port || ""), sys: !!(b.meta || {}).system || n.startsWith("swg_") || isSelfContainedName(n), awg: !!Object.keys((b.meta || {}).awg_params || {}).length,
                        awg3: awgGen(node, n) === "3.1" }))
    .filter(i => i.port && !i.sys);
  const fork = turnFork(svc);
  const ifaces = allIfaces.filter(i => (forkSupportsAwg(fork) || !i.awg) && (forkSupportsAwg3(fork) || !i.awg3));
  const hideAwg = !forkSupportsAwg(fork) && allIfaces.some(i => i.awg);
  const hideAwg3 = forkSupportsAwg(fork) && !forkSupportsAwg3(fork) && allIfaces.some(i => i.awg3);
  const conPort = con.includes(":") ? con.slice(con.lastIndexOf(":") + 1) : con;
  const conHost = con.includes(":") ? con.slice(0, con.lastIndexOf(":")) : "";
  const match = /^(127(\.\d{1,3}){3}|localhost|\[::1\]|::1|0\.0\.0\.0)?$/.test(conHost) ? ifaces.find(i => i.port === conPort) : null;
  const [fwd, setFwd] = useState(match ? match.name : "__custom__");
  const [custom, setCustom] = useState(con || "127.0.0.1:");
  const [params, setParams] = useState(tp.params != null ? tp.params : (tp.wrap_key ? "-wrap-key " + tp.wrap_key : ""));
  const [openSec, setOpenSec] = useState(null);
  const origParams = tp.params != null ? tp.params : (tp.wrap_key ? "-wrap-key " + tp.wrap_key : "");
  const [title, setTitle] = useState(shownTitle("t|" + node + "|" + svc, tp.title));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const dis = busy || blocked;
  const fail = t => { setBusy(false); setMsg({ k: "err", t }); };
  const isCustom = fwd === "__custom__";
  const lhost = ipPickerVal(lsel, lcustom);
  const [pin, setPin] = useState(tp.bind_ip || "");
  const lst = useListenState(node, lhost, lh, tp.bind, pin);
  const installed = tp.version || "";
  const installing = !!tp.installing;
  const failed = !!tp.failed;
  const stopped = !!tp.stopped;
  const looping = turnLooping(tp);
  const owner = turnOwner(svc);
  const doReinstall = async (verb, tag) => {
    const shown = verb === "update" ? T("val|update") : T("val|reinstall");
    setBusy(true); setMsg({ k: "work", t: shown + "…" });
    if (verb === "update") turnUpdating[node + "|" + svc] = Date.now() + 120000;
    const r = await api.turnReinstall({ node, service: svc, owner, ...(tag ? { tag } : {}) });
    if (!r.ok) { delete turnUpdating[node + "|" + svc]; return fail(srvText(r) || T("Request failed.")); }
    closeModal(); await Store.poll();
    toast(T("Turn-proxy {verb} requested — applies on the node's next sync.", { verb: shown }), "ok");
  };
  const save = async () => {
    if (!lhost) return fail(T("Listen IP is required."));
    if (!/^\d+$/.test(lport.trim())) return fail(T("Listen port must be a number."));
    let connect;
    if (isCustom) { connect = custom.trim(); if (!/:\d+$/.test(connect)) return fail(T("Forward-to must be host:port.")); }
    else {
      const fi = ifaces.find(i => i.name === fwd);
      if (!fi) return fail(T("That interface is no longer on this node — pick another."));
      connect = (match && fwd === match.name) ? con : "127.0.0.1:" + fi.port;
    }
    const newListen = lhost + ":" + lport.trim();
    const titleOnly = newListen === (tp.listen || "") && connect === (tp.connect || "") && params.trim() === origParams.trim() && pin === (tp.bind_ip || "");
    if (titleOnly) {
      if (title.trim() === (tp.title || "")) { closeModal(); return toast(T("No changes."), "ok"); }
      const r = await sheetSend(() => api.turnTitle({ node, service: svc, title: title.trim() }), errMsg(setMsg), setBusy);
      if (!r.ok) return;
      pushOptTitle("t|" + node + "|" + svc, title.trim());
      closeModal(); await Store.poll(); toast(T("Title saved — the proxy keeps running."), "ok");
      return;
    }
    setBusy(true); setMsg({ k: "work", t: T("saving…") });
    const body = { node, service: svc, listen: newListen, connect, params: params.trim(), title: title.trim(),
                   ...(pin !== (tp.bind_ip || "") ? { bind_ip: pin } : {}) };
    const r = await api.turnManage(body);
    if (!r.ok) return fail(srvText(r) || T("Request failed."));
    closeModal(); await Store.poll();
    toast(T("Turn-proxy update requested — applies on the node's next sync."), "ok");
  };
  const randKey = () => {
    const a = new Uint8Array(32); crypto.getRandomValues(a);
    copy(Array.from(a, b => b.toString(16).padStart(2, "0")).join(""), T("Random 64-hex key copied — paste it into the parameters"));
  };
  const _mConnect = isCustom ? custom.trim() : (match && fwd === match.name) ? con
    : (((ifaces.find(i => i.name === fwd)) || {}).port ? "127.0.0.1:" + ifaces.find(i => i.name === fwd).port : (tp.connect || ""));
  const turnDirty = (lhost + ":" + lport.trim()) !== (tp.listen || "")
    || _mConnect !== (tp.connect || "")
    || params.trim() !== origParams.trim()
    || pin !== (tp.bind_ip || "")
    || title.trim() !== (tp.title || "");
  const gear = html`<button class="iconbtn sheet-verset" title=${T("Version, rollback & server defaults for {v1}", { v1: forkLabel(turnFork(svc)) })} onClick=${() => openServerDefaults(turnFork(svc))}><${Ic} i="gear"/></button>`;
  const extras = html`<${ProxyDropsHeader} node=${node} svc=${svc}/><${TurnIpsHeader} node=${node} svc=${svc}/>`;
  const mh = isMobile() ? mTurnHead("TURN", (title || "").trim() || forkLabel(turnFork(svc)), forkLabel(turnFork(svc)), installed, gear, extras) : null;
  return html`<${Sheet} title=${mh ? mh.title : html`${turnSheetTitle(forkLabel(turnFork(svc)), title)}${installed ? html` <span class="sheet-ver">${installed}</span>` : ""}${gear}`} width=${664} headExtra=${mh ? mh.headExtra : extras}
    foot=${html`<${Fragment}>
      <button class="btn btn-ghost danger" disabled=${dis} onClick=${() => openModal(html`<${DeleteTurnSheet} node=${node} service=${svc} label=${forkLabel(turnFork(svc))}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
      ${stopped
        ? html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${dis} title=${T("Start the service on the node")} onClick=${() => { startTurn(node, svc); closeModal(); }}><${Ic} i="play"/> ${(isMobile() ? T("rowact|Start") : T("Start service"))}</button>`
        : installing
        ? html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${true} title=${T("Installing…")}><${Ic} i="refresh"/> ${T("Reinstall service")}</button>`
        : ((!turnDown(tp) || looping) && !failed)
        ? html`<${Fragment}>
            <button class="btn btn-ghost" style="margin-left:8px" disabled=${dis} title=${T("Stop the service on the node (stays down until started)")} onClick=${() => { stopTurn(node, svc); closeModal(); }}><${Ic} i="stop"/> ${(isMobile() ? T("rowact|Stop") : T("Stop service"))}</button>
            <button class="btn btn-ghost" style="margin-left:8px" disabled=${dis} title=${T("Restart the service on the node")} onClick=${() => { restartTurn(node, svc); closeModal(); }}><${Ic} i="refresh"/> ${(isMobile() ? T("rowact|Restart") : T("Restart service"))}</button>
          <//>`
        : html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${dis} title=${T("Re-download the binary and start the service on the node")} onClick=${() => doReinstall("reinstall")}><${Ic} i="refresh"/> ${T("Reinstall service")}</button>`}
      <span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${dis || !!tperr || !turnDirty} title=${tperr || (!turnDirty ? T("No changes to save") : "")} onClick=${save}>${T("Save")}</button></>`}>
    ${looping ? html`<div class="notice warn" style="margin-bottom:16px"><${Ic} i="warn"/><span>${turnLoopText(tp)}</span></div>` : null}
    ${blocked ? html`<div class="notice warn" style="margin-bottom:16px"><${Ic} i="warn"/><span>${T("This node is busy or offline")}${nrec.proc_status ? html` (${procLabel(nrec.proc_status)})` : ""}${T(" — turn-proxy actions are disabled until it's reporting again.")}</span></div>` : null}
    <${RangedHistory} node=${node} kind="throughput" h=${60} fetch=${r => api.turnSeries(node, turnFork(svc), r).then(x => x && x.ok ? x.data : {})}/>
    <div class="iface-intro" style="margin-top:8px">
      <div>${T("Changing any field rewrites the unit's ExecStart on the node and restarts it.")}</div>
      <div>${Trich("The parameters below are placed verbatim after `-connect` — wrap key, wrap mode, any flags the fork supports.")}</div>
    </div>
    <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${forkLabel(fork)} autocomplete="off"/></div>
    <div class="row2">
      <div class="field"><label>${T("Endpoint host / IP")}</label>
        <${IpPicker} ips=${ips} sel=${lsel} setSel=${setLsel} custom=${lcustom} setCustom=${setLcustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/>
        <${ListenHint} st=${lst} fallback=${turnDialFallback(node, isCustom ? fwdByPort(allIfaces, custom) : fwd)}/></div>
      <div class="field"><label>${T("Listen port")}</label><input class=${tperr ? "bad" : ""} value=${lport} onInput=${e => setLport(e.target.value)} placeholder="57000"/>${tperr ? html`<div class="hint err">${tperr}</div>` : null}</div>
    </div>
    <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
    <${ListenNotice} st=${lst}/>
    <div class="field"><label>${T("Forwards to")}</label>
      <${Dropdown} className="selwrap" value=${fwd} onChange=${v => setFwd(v)} ariaLabel=${T("Forward to")}
        options=${[...ifaces.map(i => ({ value: i.name, label: i.name + " · 127.0.0.1:" + i.port })),
                   { value: "__custom__", label: T("Custom IP:Port…") }]}/>
      ${hideAwg ? html`<div class="hint">${T("{v1} is WireGuard-only — AmneziaWG interfaces are hidden.", { v1: forkLabel(fork) })}</div>` : null}
      ${hideAwg3 ? html`<div class="hint">${T("{v1} serves an app that carries AmneziaWG 2.0 only — AmneziaWG 3.1 interfaces are hidden.", { v1: forkLabel(fork) })}</div>` : null}
    </div>
    ${isCustom ? html`<${Fragment}>
      <div class="field"><input value=${custom} onInput=${e => setCustom(e.target.value)} placeholder="127.0.0.1:51820" autocomplete="off"/></div>
      <div class="notice warn" style="margin:-6px 0 16px"><${Ic} i="warn"/><span>${T("This forwards to a port with no managed interface behind it. Make sure a wg/awg interface is really listening there, or clients reach the proxy but get no tunnel.")}</span></div>
    <//>` : null}
    <${Disclosure} title=${T("Server parameters")} open=${openSec === "server"} onToggle=${() => setOpenSec(s => s === "server" ? null : "server")}>
      <${TurnParamsEditor} fork=${fork} node=${node} value=${params} onChange=${setParams} listen=${(lhost || "server_ip") + ":" + (lport || "port")} connect=${isCustom ? (custom || "interface_ip:port") : ("127.0.0.1:" + (((ifaces.find(i => i.name === fwd)) || {}).port || "port"))}/>
    <//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
export function DeleteTurnSheet({ node, service, label }) {
  const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false);
  const phrase = T("DELETE {v1}", { v1: label });
  const ok = txt === phrase;
  const del = async () => {
    if (!ok || busy) return; setBusy(true);
    const r = await api.turnDelete({ node, service });
    if (!r.ok) { setBusy(false); return toast(srvText(r) || T("Failed."), "err"); }
    closeModal(); await Store.poll();
    toast(T("Turn-proxy removal requested — the node stops + removes it on its next sync."), "ok");
  };
  return html`<${Sheet} title=${T("Delete turn-proxy · {v1}", { v1: label })}
    foot=${footRow({ onCancel: closeModal, danger: true, disabled: !ok || busy, onAction: del, action: T("Delete turn-proxy") })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${Trich("This *stops, disables and removes* the turn-proxy service *{label}* on the node. Clients pointed at it stop connecting. This can't be undone. (To keep the service running and only unlink it from the panel, use *Disconnect*.)", { label })}</span></div>
    <div class="field"><label>${typeToConfirm(phrase)}</label><input autofocus value=${txt} onInput=${e => setTxt(e.target.value)} placeholder=${phrase} autocomplete="off" spellcheck="false"/></div>
  <//>`;
}

export const RAW_PORT = 56003;
const _listenIp = s => { const v = String(s || ""); const i = v.lastIndexOf(":"); const ip = i > 0 ? v.slice(0, i).trim() : ""; return (ip === "0.0.0.0" || ip === "::" || ip === "[::]") ? "" : ip; };
export function rawOwnerOn(node, iface) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cfgs = nrec.wdtt_cfg || {};
  const snap = ((Store.stats[node] || {}).wdtt || []).filter(Boolean);
  const listenOf = ifn => (cfgs[ifn] || {}).listen || (snap.find(w => w.iface === ifn) || {}).listen || "";
  const mine = _listenIp(listenOf(iface));
  const names = new Set([...Object.keys(cfgs), ...snap.map(w => w.iface)]);
  for (const ifn of names) {
    if (ifn === iface) continue;
    const w = cfgs[ifn] || snap.find(x => x.iface === ifn) || {};
    if (!w.raw_port) continue;
    const theirs = _listenIp(listenOf(ifn));
    if (theirs === mine || !theirs || !mine) return ifn;
  }
  return "";
}
export function turnEnabled() { return !(Store.panelSettings && Store.panelSettings.turn_enabled === false); }
export const TURN_FORKS_DEFAULT = ["samosvalishe", "WINGS-N"];
export function enabledTurnForkIds() {
  const ids = new Set((Store.panelSettings && Store.panelSettings.enabled_turn_forks) || TURN_FORKS_DEFAULT);
  for (const f of turnForkList()) if (f.hidden) ids.add(f.id);
  return ids;
}
export function enabledTurnForks(keep) {
  const set = enabledTurnForkIds();
  return turnForkList().filter(f => (set.has(f.id) && !f.hidden) || (keep && f.id === keep));
}

export function forkSettings(forkId) {
  const f = turnForkList().find(x => x.id === forkId);
  return (f && Array.isArray(f.settings)) ? f.settings : [];
}
export function defaultSettingValues(schema, opts) {
  opts = opts || {}; const dflt = !!(opts.fresh || opts.key); const v = {};
  for (const d of schema) {
    if (d.type === "hexkey") v[d.key] = opts.key || (opts.fresh ? randWrapKey() : "");
    else if (d.type === "bool") v[d.key] = dflt ? !!d.default : false;
    else v[d.key] = dflt ? (d.default != null ? d.default : "") : "";
  }
  return v;
}
export function settingShown(d, values) {
  return !d.showIf || Object.keys(d.showIf).every(k => values[k] === d.showIf[k]);
}
export const turnOptions = d => (d.values || []).map(o => {
  const [value, raw] = d.type === "flagenum" ? [o.value, o.label] : [o, null];
  return { value, label: raw ? T(raw) : String(value) };
});
export function serializeTurnSettings(schema, values) {
  const parts = [];
  for (const d of schema) {
    if (!settingShown(d, values)) continue;
    const v = values[d.key];
    if (d.type === "bool") { if (v) parts.push(d.flag); }
    else if (d.type === "flagenum") { const o = (d.values || []).find(x => x.value === v); if (o && o.flag) parts.push(o.flag); }
    else if (v !== "" && v != null) { parts.push(d.flag + " " + v); }
  }
  return parts.join(" ");
}
export const TURN_KEYLESS = new Set(["off", "none", "plain", "false"]);
export function turnKeyUsed(schema, vals) {
  const keyField = schema.find(d => d.type === "hexkey"); if (!keyField) return false;
  return schema.filter(d => d.type !== "hexkey").every(d => d.type === "bool" ? (vals[d.key] === true || vals[d.key] === "true") : !TURN_KEYLESS.has(String(vals[d.key])));
}
export function parseTurnSettings(schema, params) {
  const toks = String(params || "").trim().split(/\s+/).filter(Boolean);
  const values = defaultSettingValues(schema, {});
  const boolFlag = {}, valFlag = {}, feFlag = {};
  for (const d of schema) {
    if (d.type === "bool") boolFlag[d.flag] = d.key;
    else if (d.type === "flagenum") (d.values || []).forEach(o => { if (o.flag) feFlag[o.flag] = { key: d.key, value: o.value }; });
    else valFlag[d.flag] = d.key;
  }
  const leftover = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (boolFlag[t] != null) values[boolFlag[t]] = true;
    else if (feFlag[t]) values[feFlag[t].key] = feFlag[t].value;
    else if (valFlag[t] != null && i + 1 < toks.length) values[valFlag[t]] = toks[++i];
    else leftover.push(t);
  }
  return { values, ok: leftover.length === 0, leftover };
}
export function TurnServerFields({ schema, vals, setV, extra, setExtra, listen, connect, template, wdtt, noHint }) {
  const keyField = schema.find(d => d.type === "hexkey");
  const obfFields = schema.filter(d => d.type !== "hexkey");
  const keyUsed = turnKeyUsed(schema, vals);
  const obfTail = serializeTurnSettings(schema, (keyUsed || !keyField) ? vals : { ...vals, [keyField.key]: "" });
  const autoLine = wdtt
    ? "-iface wdttN -wg-addr 10.66.N.1/24 -listen server_ip:dtls_port -wg-port internal_port -no-nat -fixed-config -password <node-minted>" + (obfTail ? " " + obfTail : "")
    : "-listen " + (listen || "server_ip:port") + " -connect " + (connect || "interface_ip:port") + (obfTail ? " " + obfTail : "");
  return html`<${Fragment}>
    ${obfFields.length ? html`<div class="field"><label>${T("Obfuscation")}</label>
      <div class="obfrow">
        ${obfFields.map(d => d.type === "bool"
          ? html`<label class="obfctl" key=${d.key}><${Switch} on=${!!vals[d.key]} onChange=${v => setV(d.key, v)}/> <span class="obfctl-lbl">${d.label ? T(d.label) : d.key}</span></label>`
          : html`<label class="obfctl" key=${d.key}><${Dropdown} className="selwrap" value=${vals[d.key]}
              onChange=${v => setV(d.key, v)} options=${turnOptions(d)} ariaLabel=${d.label ? T(d.label) : d.key}/></label>`)}
        ${keyField && keyUsed ? html`<button type="button" class="btn btn-mini" onClick=${() => setV(keyField.key, randWrapKey())}><${Ic} i="refresh"/> ${T("Generate key")}</button>${!vals[keyField.key] ? html`<span class="notgen">${T("Not generated yet")}</span>` : null}` : null}
      </div></div>` : null}
    <div class="field"><label>${T("ExecStart parameters")}</label>
      <div class="execbox">
        <div class="execbox-auto" title=${template ? T("Auto-filled for each real proxy — read-only") : T("This proxy's command — read-only")}>${autoLine}</div>
        <textarea class="execbox-extra" value=${extra} onInput=${e => setExtra(e.target.value)} placeholder=${T("extra flags — appended verbatim, e.g. -debug")} spellcheck="false"></textarea>
      </div>
      ${noHint ? null : html`<div class="hint">${wdtt
        ? Trich("WDTT servers are *self-contained* — each owns its own WireGuard interface. The interface name, subnet, endpoint / DTLS port, internal WG port, egress, routing and filters are set *per interface* (in the interface's create / edit modal), and the WRAP password is minted on the node — everything on the top line is a placeholder. Only the extra flags below pre-fill a new WDTT instance.")
        : template
        ? Trich("You're setting the *default* parameters for the actual turn-proxies you'll create on nodes later — nothing is deployed now. The top line is filled in per real proxy: the node's *listen* address (`server_ip:port`), the *interface* it forwards to (`interface_ip:port`), and the obfuscation you set above — those are placeholders here. Whatever you type below is appended to the command as-is.")
        : Trich("The top line is this proxy's actual command — the *listen* address and *interface* you set above, plus the obfuscation here. Whatever you type below is appended verbatim.")}</div>`}
    </div>
  <//>`;
}
export function TurnParamsEditor({ fork, node, value, onChange, listen, connect }) {
  const schema = forkSettings(fork);
  const [obfVals, setObfVals] = useState(() => parseTurnSettings(schema, value).values);
  const [extra, setExtra] = useState(() => (parseTurnSettings(schema, value).leftover || []).join(" "));
  const serialize = (ov, ex) => { const t = serializeTurnSettings(schema, ov); const e = (ex || "").trim(); return t + (e ? (t ? " " : "") + e : ""); };
  useEffect(() => { if (value !== serialize(obfVals, extra)) { const p = parseTurnSettings(schema, value); setObfVals(p.values); setExtra((p.leftover || []).join(" ")); } }, [value, fork]);
  const setV = (k, v) => { const nv = { ...obfVals, [k]: v }; setObfVals(nv); onChange(serialize(nv, extra)); };
  const onEx = s => { setExtra(s); onChange(serialize(obfVals, s)); };
  return html`<${TurnServerFields} schema=${schema} vals=${obfVals} setV=${setV} extra=${extra} setExtra=${onEx} listen=${listen} connect=${connect} template=${false}/>`;
}
export function TurnDefaultsForm({ schema, values, onSet, busy }) {
  const cur = d => { const v = (values || {})[d.key]; return (v === undefined || v === null) ? d.default : v; };
  return html`<div class="fld2">${(schema || []).filter(d => settingShown(d, values || {})).map(d => html`<div class=${"field" + (d.type === "textarea" ? " span2" : "")} key=${d.key}>
    <label>${d.label ? T(d.label) : d.key}</label>
    ${d.type === "bool"
      ? html`<div style="display:flex;align-items:center;gap:10px"><${Switch} on=${!!cur(d)} disabled=${busy} onChange=${v => onSet(d.key, v)}/> <span class="faint">${cur(d) ? T("on") : T("off")}</span></div>`
      : (d.type === "enum" || d.type === "flagenum")
      ? html`<${Dropdown} className="selwrap" value=${cur(d)} disabled=${busy} onChange=${v => onSet(d.key, v)}
          options=${turnOptions(d)} ariaLabel=${d.label ? T(d.label) : d.key}/>`
      : d.type === "hexkey"
      ? html`<div style="display:flex;gap:8px;align-items:center">
          <input class="mono" style="flex:1" value=${cur(d)} spellcheck="false" autocomplete="off" placeholder=${T("64 hex chars — blank = a fresh key per proxy")} disabled=${busy} onInput=${e => onSet(d.key, e.target.value.trim())}/>
          <button type="button" class="linkbtn" disabled=${busy} onClick=${() => onSet(d.key, randWrapKey())}>${T("Generate")}</button></div>`
      : d.type === "int"
      ? html`<input type="number" value=${cur(d)} min=${d.min != null ? d.min : undefined} max=${d.max != null ? d.max : undefined} disabled=${busy} placeholder=${d.default === "" ? T("app default") : String(d.default)} onInput=${e => onSet(d.key, e.target.value)}/>`
      : d.type === "textarea"
      ? html`<textarea class="ta" rows="3" value=${cur(d) || ""} disabled=${busy} spellcheck="false" placeholder=${d.placeholder || ""} onInput=${e => onSet(d.key, e.target.value)}></textarea>`
      : html`<input value=${cur(d)} disabled=${busy} spellcheck="false" autocomplete="off" autocorrect="off"
          autocapitalize="off" onInput=${e => onSet(d.key, e.target.value)}/>`}
    ${d.help ? html`<div class="hint">${T(d.help)}</div>` : null}
  </div>`)}</div>`;
}
export const _OS_TABS = [["android", "Android"], ["ios", "iOS"], ["linux", "Linux"], ["windows", "Windows"], ["macos", "macOS"]];
const _OS_ICON = { android: "android", ios: "apple", linux: "os_linux", windows: "windows", macos: "finder" };
export function OsDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const opts = _OS_TABS.filter(([o]) => (options || []).includes(o));
  const cur = _OS_TABS.find(([o]) => o === value) || opts[0] || _OS_TABS[0];
  useEffect(() => { if (!open) return; const h = () => setOpen(false); document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [open]);
  return html`<div class="osdd" onClick=${e => e.stopPropagation()}>
    <button type="button" class=${"osdd-btn" + (open ? " open" : "")} onClick=${() => setOpen(o => !o)}>
      <span class="osdd-ic"><${Ic} i=${_OS_ICON[cur[0]]}/></span><span class="osdd-lbl">${cur[1]}</span><span class="osdd-car">${open ? "▴" : "▾"}</span></button>
    ${open ? html`<div class="osdd-menu">${opts.map(([o, label]) => html`<button key=${o} type="button"
      class=${"osdd-opt" + (o === cur[0] ? " on" : "")} onClick=${() => { onChange(o); setOpen(false); }}>
      <span class="osdd-ic"><${Ic} i=${_OS_ICON[o]}/></span><span class="osdd-lbl">${label}</span>${o === cur[0] ? html`<${Ic} i="check"/>` : null}</button>`)}</div>` : null}
  </div>`;
}
const _APP_REL_COLOR = { native: "var(--online)", friendly: "#5FA8E0", friendly_core: "#5FA8E0", plain: "var(--dangling)" };
export function appNameColor(rel, isCli) { return isCli ? "#D9B84A" : (_APP_REL_COLOR[rel] || "#5FA8E0"); }
export function AppDropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const opts = options || [];
  const cur = opts.find(o => o.id === value) || opts[0];
  useEffect(() => { if (!open) return; const h = () => setOpen(false); document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [open]);
  if (!cur) return null;
  const lbl = o => html`<span class="osdd-lbl"><b style=${o.nameColor ? "color:" + o.nameColor : ""}>${o.name}</b><span class="app-by">${Trich("by {v1}", { v1: html`<span class="app-by-who" style=${"color:" + o.color}>${o.author ? forkLabel(o.author) : "—"}</span>` })}</span>${o.plain ? html`<span class="app-plain">${T("tag|plain").toUpperCase()}</span>` : null}${autostartIcon(o.autostart)}</span>`;
  return html`<div class="osdd appdd" onClick=${e => e.stopPropagation()}>
    <button type="button" class=${"osdd-btn" + (open ? " open" : "")} onClick=${() => setOpen(o => !o)}>
      ${lbl(cur)}<span class="osdd-car">${open ? "▴" : "▾"}</span></button>
    ${open ? html`<div class="osdd-menu">${opts.map(o => html`<button key=${o.id} type="button"
      class=${"osdd-opt" + (o.id === cur.id ? " on" : "")} onClick=${() => { onChange(o.id); setOpen(false); }}>
      ${lbl(o)}${o.id === cur.id ? html`<${Ic} i="check"/>` : null}</button>`)}</div>` : null}
  </div>`;
}
export function openServerClients(fork, os, line) { pushModal(html`<${ServerClientsSheet} fork=${fork} initialOs=${os} initialLine=${line}/>`); }
export function ServerClientsSheet({ fork, initialOs, initialLine }) {
  const f = turnForkList().find(x => x.id === fork) || {};
  return html`<${Sheet} title=${html`${T("Default client apps")} <span class="faint" style="text-transform:none;letter-spacing:0">— <b style=${"color:" + (turnColor(fork) || "var(--fg)") + ";font-weight:700"}>${f.label}</b></span>`} width=${880} noGuard=${true} onClose=${closeModal} onBack=${closeModal}>
    <${ServerClientsBody} fork=${fork} initialOs=${initialOs} initialLine=${initialLine}/>
  <//>`;
}
export const TURN_OBF_LABEL = { "Moroka8": "WRAP", "samosvalishe": "rtpopus", "anton48": "SRTP", "MYSOREZ": "WRAP", "WINGS-N": "WRAP",
                         "amurcanov": "WRAP-A", "ildarmaga": "WRAP-A", "wdttplus": "WRAP-A", "xxcipherx": "WRAP-A", "qwdtt": "WRAP-A",
                         "csqtt": "RTP-AEAD" };
const _FORK_GUI_OBF = { "Moroka8": 1, "samosvalishe": 1, "anton48": 1, "MYSOREZ": 1, "WINGS-N": 1,
                        "amurcanov": 1, "ildarmaga": 1, "wdttplus": 1, "xxcipherx": 1, "qwdtt": 1, "csqtt": 1 };
const _FORK_CLI_OBF = { "Moroka8": 1, "samosvalishe": 1, "anton48": 1, "MYSOREZ": 1 };
export const NONE_KEY = "none";
export function pickerEntries(f, os) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const fork = f.id, compat = f.compat || {}, obfLabel = TURN_OBF_LABEL[fork] || "";
  const out = [];
  Object.keys(cmap).forEach(cid => {
    const cl = cmap[cid] || {};
    if (cid === "sidecar" || cl.encoder === "sidecar") return;
    const rel = compat[cid];
    if (!rel || !(cl.platforms && cl.platforms[os])) return;
    const isCore = rel === "friendly_core", native = rel === "native";
    const obf = ((native || rel === "friendly" || isCore) && _FORK_GUI_OBF[fork]) ? obfLabel : "";
    out.push({ key: cid, cid, isCli: !!cl.cli, native, obf,
      autostart: !!(((cl.platforms || {})[os] || {}).autostart),
      coreFork: cid === "mysorez" ? fork : null,
      author: (turnClientAuthor(cid) || {}).fork || fork,
      name: ((cl.platforms || {})[os] || {}).name || cl.name || cid,
      color: turnClientColor(cid) || turnColor(fork) });
  });
  const sc = cmap.sidecar;
  if (sc && sc.platforms && sc.platforms[os] && compat.sidecar) (f.cli_authors || ["samosvalishe"]).forEach(author => {
    out.push({ key: "sidecar@" + author, cid: "sidecar", isCli: true, native: author === fork, autostart: false,
      obf: _FORK_CLI_OBF[fork] ? obfLabel : "", coreFork: null, author, name: sc.name || "Sidecar", color: turnColor(author) });
  });
  const rank = e => e.obf ? (e.native ? (e.isCli ? 3 : 1) : (e.isCli ? 4 : 2)) : (e.isCli ? 6 : 5);
  return out.sort((a, b) => rank(a) - rank(b) || ((b.autostart ? 1 : 0) - (a.autostart ? 1 : 0)) || ((b.native ? 1 : 0) - (a.native ? 1 : 0)) || String(a.name).localeCompare(String(b.name)));
}
const _TURN_OS = [["android", "Android"], ["ios", "iOS"], ["windows", "Windows"], ["macos", "macOS"], ["linux", "Linux"]];
export function turnForkPlatforms(f) {
  const defs = ((Store.panelSettings || {}).turn_client_default || {})[f.id] || {};
  return _TURN_OS.map(([os, label]) => {
    const es = pickerEntries(f, os);
    if (!es.length) return { os, label, disabled: true };
    const sd = defs[os];
    if (sd === NONE_KEY) return { os, label, notOffered: true };
    const e = (sd && es.find(x => x.key === sd)) || es[0];
    return { os, label, native: !!e.native, obf: !!e.obf, isCli: !!e.isCli, name: e.name, author: e.author, color: e.color, coreFork: e.coreFork || null, obfLabel: e.obf || "" };
  });
}
export function ClientEntryLabel({ e }) {
  const _auth = html`<span class="ce-auth" style=${"color:" + e.color}>${forkLabel(e.author)}</span>`;
  const _core = html`<span class="ce-auth" style=${"color:" + turnColor(e.coreFork)}>${forkLabel(e.coreFork)}</span>`;
  return html`<span class="ce-name"><b>${e.name}</b> ${e.coreFork
    ? Trich("by {v1} with {v2} core", { v1: _auth, v2: _core })
    : Trich("by {v1}", { v1: _auth })}</span>`;
}
export function ClientEntryBadges({ e }) {
  return html`<span class="ce-badges">
    <span class=${"ce-tag " + (e.obf ? "ce-obf" : "ce-plain")}>${e.obf || T("tag|plain")}</span>
    <span class=${"ce-tag " + (e.native ? "ce-native" : "ce-cross")}>${e.native ? T("tag|Native") : T("tag|crossplatform")}</span>
    <span class=${"ce-tag " + (e.isCli ? "ce-cli" : "ce-app")}>${e.isCli ? "CLI" : T("tag|app")}</span>
    ${autostartIcon(e.autostart)}
  </span>`;
}
export function autostartIcon(on) {
  return html`<span class=${"ce-auto " + (on ? "on" : "off")} title=${on ? T("Opens the app automatically") : T("Manual import — copy the link, then paste or scan it in the app")}><${Ic} i=${on ? "bolt" : "copy"}/></span>`;
}
export function useTurnClients(fork, commitRef, initialOs, initialLine) {
  useStore();
  const f = turnForkList().find(x => x.id === fork) || {};
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const isCsq = fork === "csqtt";
  const linesOn = isCsq && (csqttLinesOn() || (Store.nodes || []).some(n => Object.values(n.csqtt_cfg || {}).some(c => c && c.line && c.line !== CSQTT_DEFAULT_LINE)));
  const [line, setLineRaw] = useState(linesOn && initialLine === "2.5" ? "2.5" : CSQTT_DEFAULT_LINE);
  const dkey = isCsq && line === "2.5" ? "csqtt@2.5" : fork;
  const speaks = cid => (((cmap[cid] || {}).csqtt_lines) || [CSQTT_DEFAULT_LINE]).includes(line);
  const byOs = {};
  _OS_TABS.forEach(([o]) => { byOs[o] = pickerEntries(f, o).filter(en => !linesOn || speaks(en.cid)); });
  const first = (_OS_TABS.find(([o]) => byOs[o].length) || [])[0] || "android";
  const [os, setOs] = useState((initialOs && (byOs[initialOs] || []).length) ? initialOs : first);
  const [sel, setSel] = useState({});
  const [drafts, setDrafts] = useState({});
  const [flash, setFlash] = useState(null); const [busy, setBusy] = useState(false);
  const entries = byOs[os] || [];
  const savedOf = (k, o) => (((Store.panelSettings || {}).turn_client_default || {})[k] || {})[o];
  const savedDefault = (o) => savedOf(dkey, o);
  const inherited = (o) => dkey === "csqtt@2.5" && savedDefault(o) === undefined;
  const noneEntry = (o) => ({ key: NONE_KEY, cid: null, none: true, isCli: false, native: false, obf: "",
                              autostart: false, coreFork: null, author: "", color: "",
                              name: T("Not offered on {v1}", { v1: (_OS_TABS.find(([x]) => x === o) || [])[1] || o }) });
  const validDefault = (o) => { const sd = inherited(o) ? savedOf(fork, o) : savedDefault(o), es = byOs[o] || []; if (sd === NONE_KEY) return NONE_KEY; if (sd && es.some(e => e.key === sd)) return sd; return (es[0] || {}).key || null; };
  const selEntry = (o) => { const es = byOs[o] || []; if (!es.length) return null; const k = sel[o] !== undefined ? sel[o] : validDefault(o); if (k === NONE_KEY) return noneEntry(o); return es.find(x => x.key === k) || es[0]; };
  const selKey = sel[os] !== undefined ? sel[os] : validDefault(os);
  const e = selKey === NONE_KEY ? noneEntry(os) : (entries.find(x => x.key === selKey) || entries[0] || null);
  const cid = e ? e.cid : null; const c = cid ? cmap[cid] : null;
  const cSchema = (cid && f.client_schemas && f.client_schemas[cid]) || (c && c.settings) || [];
  const osLabel = (_OS_TABS.find(([o]) => o === os) || [])[1];
  const cName = e ? e.name : "";
  const appColor = e ? e.color : null;
  const savedVals = ((((Store.panelSettings || {}).turn_client_settings || {})[fork] || {})[cid] || {})[os] || {};
  const draftKey = os + "|" + cid;
  const effVals = drafts[draftKey] !== undefined ? drafts[draftKey] : savedVals;
  const stageSetting = (key, value) => setDrafts(m => ({ ...m, [draftKey]: { ...(m[draftKey] !== undefined ? m[draftKey] : savedVals), [key]: value } }));
  const norm = v => JSON.stringify(v || {});
  const isDefault = e && e.key === validDefault(os);
  const settingsDirty = drafts[draftKey] !== undefined && norm(drafts[draftKey]) !== norm(savedVals);
  const dirty = !!(e && (!isDefault || settingsDirty));
  const save = async (close) => {
    setBusy(true);
    const def = { ...((Store.panelSettings || {}).turn_client_default || {}) };
    const dfo = { ...(def[dkey] || {}) }; dfo[os] = e.key; def[dkey] = dfo;
    const all = { ...((Store.panelSettings || {}).turn_client_settings || {}) };
    if (!e.none) {
      const fo = { ...(all[fork] || {}) }; const co = { ...(fo[cid] || {}) };
      co[os] = effVals; fo[cid] = co; all[fork] = fo;
    }
    const r = await api.panelSettings({ turn_client_default: def, turn_client_settings: all });
    if (r && r.ok) {
      setDrafts(m => { const n = { ...m }; delete n[draftKey]; return n; }); await Store.poll();
      if (close) { closeModal(); return true; }
      setBusy(false); setFlash(T("Saved · {v1} · {v2}", { v1: cName, v2: osLabel })); setTimeout(() => setFlash(null), 2400);
      return true;
    }
    setBusy(false); setFlash(srvText(r) || T("Save failed"));
    return false;
  };
  if (commitRef) commitRef.current = () => (dirty && !busy ? save().then(() => true) : Promise.resolve(false));
  const setLine = l => { setSel({}); setLineRaw(l); };
  return { f, byOs, os, setOs, setSel, selEntry, entries, e, cSchema, osLabel, cName, appColor, effVals, stageSetting, dirty, isDefault, settingsDirty, save, busy, flash,
           linesOn, line, setLine, inherited };
}
export function clientAppLabel(e) {
  if (!e) return "";
  const _a = html`<span style=${"color:" + e.color}>${forkLabel(e.author)}</span>`;
  const _c = html`<span style=${"color:" + turnColor(e.coreFork)}>${forkLabel(e.coreFork)}</span>`;
  return html`<b>${e.name}</b> ${e.coreFork
    ? Trich("by {v1} with {v2} core", { v1: _a, v2: _c })
    : Trich("by {v1}", { v1: _a })}`;
}
export function TurnAppsPicker({ ctl, offered }) {
  const { f, byOs, os, setOs, setSel, selEntry, linesOn, line, setLine } = ctl;
  const [openOs, setOpenOs] = useState(null);
  useEffect(() => { if (!openOs) return; const h = () => setOpenOs(null); document.addEventListener("click", h); document.addEventListener("m-outside-tap", h);
    return () => { document.removeEventListener("click", h); document.removeEventListener("m-outside-tap", h); }; }, [openOs]);
  const anyApp = _OS_TABS.some(([o]) => byOs[o].length);
  const openEntries = openOs ? (byOs[openOs] || []) : [];
  const openLabel = openOs ? (_OS_TABS.find(([o]) => o === openOs) || [])[1] : "";
  const openCur = openOs ? selEntry(openOs) : null;
  const pick = (o, key) => { setSel(m => ({ ...m, [o]: key })); setOs(o); setOpenOs(null); };
  return html`<${Fragment}>
    ${linesOn ? html`<div class="dpsw awgsw csq-linesw" role="radiogroup" aria-label=${T("csqtt version")}>${["2.1", "2.5"].map(l =>
        html`<button type="button" role="radio" aria-checked=${line === l} class=${line === l ? "on" : ""} onClick=${() => { setOpenOs(null); setLine(l); }}>csqtt ${l}</button>`)}</div>
      <div class="hint csq-linehint">${line === "2.5"
        ? T("The apps 2.5 servers hand out. Where you haven't chosen, 2.5 gets 2.1's app if it speaks 2.5, else the first that does — shown below.")
        : T("The apps 2.1 servers hand out — and 2.5 servers too, where you haven't chosen for 2.5 and the app speaks it.")}</div>` : null}
    <div class="osapp-hd">${T("Select an app for each OS")}</div>
    <div class=${"osapp" + (openOs ? " menuopen" : "")} onClick=${ev => ev.stopPropagation()}>
      ${_OS_TABS.map(([o, label]) => {
        const has = byOs[o].length, oe = selEntry(o), many = has > 1;
        return html`<button key=${o} type="button" disabled=${!has}
          class=${"osapp-cell" + (o === os ? " on" : "") + (has ? "" : " off") + (o === openOs ? " open" : "")}
          title=${has ? "" : T("No {v1} app for {v2} yet", { v1: f.label, v2: label })}
          onClick=${() => { if (!has) return; setOs(o); setOpenOs(c => c === o ? null : o); }}>
          <span class="osapp-ic"><${Ic} i=${_OS_ICON[o]}/></span>
          <span class="osapp-col">
            ${oe && oe.none ? html`<span class="osapp-name osapp-dim">${label}</span><span class="osapp-auth osapp-dim">${T("not offered")}</span>`
                 : oe ? html`<span class="osapp-name">${oe.name}</span><span class="osapp-auth"><span style=${"color:" + oe.color}>${forkLabel(oe.author)}</span>${oe.coreFork && oe.coreFork !== oe.author ? html`<span class="ce-by"> · </span><span style=${"color:" + turnColor(oe.coreFork)}>${forkLabel(oe.coreFork)}</span>` : null}</span>`
                 : html`<span class="osapp-name osapp-dim">${label}</span><span class="osapp-auth osapp-dim">${T("no client")}</span>`}
          </span>
          ${many ? html`<span class="osapp-car">▾</span>` : null}
          ${oe && oe.none ? html`<span class="osapp-bub"><span class="osapp-bub-txt"><b>${T("Not offered")}</b><span class="ce-by">${T(" — {os} users get no card for this server", { os: label })}</span></span></span>`
            : oe ? html`<span class="osapp-bub"><span class="osapp-bub-txt"><b>${oe.name}</b>${oe.coreFork ? html`<span class="ce-by"> ${T("val|with")} </span><span style=${"color:" + turnColor(oe.coreFork)}>${forkLabel(oe.coreFork)}</span><span class="ce-by"> ${T("val|core")}</span>` : html`<span class="ce-by"> ${Trich("by {v1}", { v1: html`<span style=${"color:" + oe.color}>${forkLabel(oe.author)}</span>` })}</span>`}${offered ? html`<span class="ce-by">${T(" offered to {v1} users", { v1: label })}</span>` : null}</span><${ClientEntryBadges} e=${oe}/></span>` : null}
        </button>`;
      })}
    </div>
    ${openOs && openEntries.length ? html`<div class="osapp-menu" onClick=${ev => ev.stopPropagation()}>
      <div class="osapp-menu-hd">${T("Choose the {v1} app", { v1: openLabel })}</div>
      ${openEntries.map(en => html`<button key=${en.key} type="button"
        class=${"cpick-opt" + (openCur && en.key === openCur.key ? " on" : "")} onClick=${() => pick(openOs, en.key)}>
        <${ClientEntryLabel} e=${en}/><${ClientEntryBadges} e=${en}/></button>`)}
      <button type="button" class=${"cpick-opt cpick-none" + (openCur && openCur.none ? " on" : "")}
        onClick=${() => pick(openOs, NONE_KEY)}>
        <span><b>${T("Don't offer")}</b><span class="ce-by">${T(" for {os}", { os: openLabel })}</span></span>
        <span class="cpick-none-hint">${T("no card on their page")}</span></button>
    </div>` : null}
    ${!anyApp ? html`<div class="notice" style="margin-top:12px"><${Ic} i="info"/><span>${T("No {v1} client app yet.", { v1: f.label })}</span></div>` : null}
  <//>`;
}
export function TurnClientParams({ ctl, embedded }) {
  const { cSchema, cName, osLabel, effVals, stageSetting, dirty, save, busy, flash, e } = ctl;
  if (!e) return html`<div class="hint">${T("Pick a client app above first.")}</div>`;
  return html`<${Fragment}>
    ${e.none
      ? html`<div class="hint">${T("This server isn't offered on {v1} — those users won't see a card for it, so there's nothing to configure. Pick an app above to start offering it again.", { v1: osLabel })}</div>`
      : (cSchema && cSchema.length)
      ? html`<${TurnDefaultsForm} schema=${cSchema} values=${effVals} onSet=${stageSetting} busy=${busy}/>`
      : html`<div class="hint">${T("{v1} has no settings the panel can preset — its options are set in the app itself.", { v1: cName })}</div>`}
    ${embedded ? null : html`<div style="display:flex;align-items:center;gap:12px;margin-top:16px">
        <span class="faint" style="font-size:12px">${e.none ? T("{v1} users will be offered nothing for this server", { v1: osLabel }) : Trich("{v1} users will be offered {v2}", { v1: osLabel, v2: clientAppLabel(e) })}</span>
        <span class="grow"></span>
        ${flash ? html`<span class="vk-status ok">${flash}</span>` : null}
        <button class="btn btn-primary" disabled=${busy || !dirty} onClick=${() => save(true)}>${busy ? T("Saving…") : T("Save")}</button>
      </div>`}
  <//>`;
}
export function ServerClientsBody({ fork, initialOs, initialLine }) {
  const ctl = useTurnClients(fork, null, initialOs, initialLine);
  return html`<${Fragment}>
    <${TurnAppsPicker} ctl=${ctl}/>
    <div style="margin-top:16px"><${TurnClientParams} ctl=${ctl} embedded=${false}/></div>
  <//>`;
}
export function openRosterCheck() { pushModal(html`<${RosterCheckSheet}/>`); }
export function RosterCheckSheet() {
  const [data, setData] = useState(null); const [err, setErr] = useState(null);
  const [checking, setChecking] = useState(false); const [busy, setBusy] = useState({});
  const load = async (refresh) => {
    setChecking(true); setErr(null);
    try {
      const [p4, p1] = await Promise.all([api.p4Report(refresh), api.rosterCheck()]);
      if (p4 && p4.ok && p1 && p1.ok) setData({ p4: p4.data.clients || {}, p1: p1.data.clients || {} });
      else setErr(srvText(p4) || srvText(p1) || T("check failed"));
    } catch (e) { setErr((e && e.message) || T("check failed")); }
    finally { setChecking(false); }
  };
  useEffect(() => { load(false); }, []);
  const reload = () => load(false);
  const withBusy = async (cid, fn) => { setBusy(m => ({ ...m, [cid]: true })); try { await fn(); } catch (_) {} setBusy(m => { const n = { ...m }; delete n[cid]; return n; }); };
  const ack = (cid) => withBusy(cid, async () => { const r = await api.rosterAck(cid); if (r && r.ok) await load(false); });
  const setVersion = (cid, index) => withBusy(cid, async () => { await api.p4SetVersion(cid, index); await load(false); });
  const p1c = (data && data.p1) || {}, p4c = (data && data.p4) || {};
  const cids = Object.keys(p1c).length ? Object.keys(p1c) : Object.keys(p4c);
  const TAG = { up_to_date: ["tg-ready", "check", T("up to date")], changed: ["tg-pending", "warn", T("changed")],
                unknown: ["tg-off", "info", T("couldn't check")], unwatched: ["tg-off", "info", T("not watched")] };
  return html`<${Sheet} title=${T("Client rosters")} width=${740} noGuard=${true} onClose=${closeModal} onBack=${closeModal}
      foot=${footRow({ left: html`<button class="btn btn-mini" disabled=${checking} onClick=${() => load(true)}><span class=${checking ? "ic-spin" : ""}><${Ic} i="refresh"/></span> ${checking ? T("Checking…") : T("Re-check")}</button>`, cancelLabel: T("Close"), onCancel: closeModal })}>
    <p class="hint" style="margin:2px 0 14px">${T("Each client app's config schema vs upstream on GitHub.")} <b style="color:var(--online)">+n</b> ${T("new adoptable fields ·")} <b style="color:var(--ready)">+y</b> ${T("new values ·")} <b style="color:var(--dangling)">−</b> ${T("removed ·")} <b style="color:var(--fault)">+x</b> ${T("new items that need a panel update (encoder wiring) before they work.")} <b>${T("Set version")}</b> ${T("rolls a client back to a previous app version.")}</p>
    ${!data && !err ? html`<div class="loading"><span class="spin"></span>${T("loading…")}</div>`
      : err ? html`<div class="notice warn"><${Ic} i="warn"/><span>${err}</span></div>`
      : html`<${Fragment}>
        ${!data.rate_limited ? null
            : data.watch_via !== "api"
            ? html`<div class="notice warn" style="margin-bottom:12px"><${Ic} i="warn"/><span>${Trich(
                "*GitHub is rate-limiting this panel* for the few sources the published list does not cover, so those rows could not be checked — it is the budget, not the sources. It clears in about {v1} min.",
                { v1: Math.max(1, Math.ceil((data.rate_limited * 1000 - Date.now()) / 60000)) })}</span></div>`
            : html`<div class="notice warn" style="margin-bottom:12px"><${Ic} i="warn"/><span>${Trich(
                "*This panel could not fetch the published client fingerprints*, so it fell back to asking GitHub directly and hit the 60-an-hour limit. Check that the panel can reach *raw.githubusercontent.com* — with it, these rows cost no GitHub budget at all. It clears in about {v1} min.",
                { v1: Math.max(1, Math.ceil((data.rate_limited * 1000 - Date.now()) / 60000)) })}</span></div>`}
        <div class="rosterlist">
          ${cids.map(cid => {
            const p4 = p4c[cid], p1 = p1c[cid], t = p1 ? (TAG[p1.status] || TAG.unknown) : null;
            const color = turnClientColor(cid), author = (turnClientAuthor(cid) || {}).fork;
            const name = (p4 && p4.name) || (p1 && p1.name) || cid;
            const p4has = p4 && rcTotal(p4.counts) > 0;
            return html`<div class="roster-row" key=${cid}>
              <div class="roster-hd">
                <span class="roster-nm" style=${color ? "color:" + color : ""}>${name}</span>${author ? html`<span class="roster-by">${T("by {v1}", { v1: forkLabel(author) })}</span>` : null}
                ${p4 ? RosterCounts(p4.counts) : (t ? html`<span class=${"tg " + t[0]} title=${p1.status === "unwatched" ? T("No upstream source is tracked for this client — a format change here would not raise a flag.") : (p1.status === "unknown" ? T("The tracked file could not be fetched — the check did not run.") : "")}><${Ic} i=${t[1]}/>${t[2]}</span>` : null)}
                <span class="grow"></span>
                ${p4 && (p4.versions || []).length ? SetVersionPicker(p4, i => setVersion(cid, i), busy[cid]) : null}
                ${p4has ? html`<button class="btn btn-mini" disabled=${busy[cid]} onClick=${() => openRosterP4Review(cid, p4, reload)}>${T("Review")}</button>` : null}
                ${!p4 && p1 && p1.status === "changed" ? html`<button class="btn btn-mini" disabled=${busy[cid]} onClick=${() => openRosterReview(cid, p1, ack)}>${busy[cid] ? T("saving…") : T("Review")}</button>` : null}
              </div>
              ${p4 ? null : (p1 ? RosterP1Files(p1) : null)}
            </div>`;
          })}
          <div class="hint faint" style="margin-top:10px">${Trich("Rate-limited by GitHub (60/hour unauthenticated); set `SWG_GH_TOKEN` to lift it. A field tagged \"needs wiring\" becomes usable after a panel update.")}</div>
        </div><//>`}
  <//>`;
}
export function rcTotal(c) { return c ? (c.n + c.x + c.m + (c.y || 0) + (c.z || 0)) : 0; }
export function RosterCounts(c) {
  if (rcTotal(c) === 0) return html`<span class="tg tg-ready"><${Ic} i="check"/>${T("up to date")}</span>`;
  return html`<span class="rc-counts">${c.n ? html`<span class="rc-cnt add" title=${T("new adoptable fields")}>+${c.n}</span>` : null}${c.y ? html`<span class="rc-cnt val" title=${T("new values for existing settings")}>+${c.y}</span>` : null}${c.m ? html`<span class="rc-cnt rem" title=${T("fields removed upstream")}>−${c.m}</span>` : null}${c.z ? html`<span class="rc-cnt rem" title=${T("values removed upstream")}>−${c.z}</span>` : null}${c.x ? html`<span class="rc-cnt wire" title=${T("new fields/values — need a panel update to use")}>+${c.x}</span>` : null}</span>`;
}
export function SetVersionPicker(p4, onPick, busy) {
  const vs = p4.versions || [], pin = p4.pinned_snapshot;
  return html`<${Dropdown} className="rc-ver" disabled=${busy} value=${pin === null || pin === undefined ? "" : pin}
    onChange=${v => onPick(v === "" ? null : v)} title=${T("Roll this client's schema to a previous app version")}
    ariaLabel=${T("Roll this client's schema to a previous app version")}
    options=${[{ value: "", label: T("↻ Track latest") },
               ...vs.map((v, i) => ({ value: i, label: (v.app_version || ("v" + (i + 1))) + (i === vs.length - 1 ? " " + T("(latest)") : "") }))]}/>`;
}
export function RosterP1Files(p1) {
  return html`${(p1.files || []).map(f => html`<div class="roster-file"><span class="mono">${f.path.split("/").pop()}</span>
    ${f.status === "changed" ? html`<a href=${f.compare_url || f.url} target="_blank" rel="noopener">${T("view change → {v1}", { v1: f.latest_commit })}</a>`
      : f.status === "unknown" ? html`<a class="faint" href=${f.url} target="_blank" rel="noopener">${T("couldn't fetch")}</a>`
      : html`<span class="faint">${f.latest_commit || T("file|current")}</span>`}</div>`)}`;
}
export function openRosterP4Review(cid, rep, onDone) { pushModal(html`<${RosterP4ReviewSheet} cid=${cid} rep=${rep} onDone=${onDone}/>`); }
export function turnClientFieldLabel(cid, key) {
  const cs = ((((Store.turnCatalog || {}).clients || {})[cid] || {}).settings) || [];
  const s = cs.find(x => x.key === key);
  return (s && s.label) || key;
}
export function RosterP4ReviewSheet({ cid, rep, onDone }) {
  const lbl = f => turnClientFieldLabel(cid, f);
  const items = [];
  (rep.added || []).forEach(f => items.push({ key: "a:" + f, kind: "add", field: f, adoptable: true }));
  (rep.removed || []).forEach(f => items.push({ key: "r:" + f, kind: "rem", field: f, adoptable: true }));
  (rep.value_diff || []).forEach(v => {
    (v.added || []).forEach(val => items.push({ key: "va:" + v.field + ":" + val, kind: v.adoptable_add ? "vadd" : "vwire", field: v.field, value: val, adoptable: !!v.adoptable_add }));
    (v.removed || []).forEach(val => items.push({ key: "vr:" + v.field + ":" + val, kind: "vrem", field: v.field, value: val, adoptable: true }));
  });
  (rep.needs_wiring || []).forEach(f => items.push({ key: "w:" + f, kind: "wire", field: f, adoptable: false }));
  const adoptable = items.filter(i => i.adoptable);
  const [checked, setChecked] = useState(() => { const m = {}; adoptable.forEach(i => m[i.key] = true); return m; });
  const [busy, setBusy] = useState(false);
  const allOn = adoptable.length > 0 && adoptable.every(i => checked[i.key]);
  const someOn = adoptable.some(i => checked[i.key]);
  const toggleAll = () => { const v = !allOn; setChecked(() => { const m = {}; adoptable.forEach(i => m[i.key] = v); return m; }); };
  const toggle = k => setChecked(m => ({ ...m, [k]: !m[k] }));
  const adopt = async () => {
    setBusy(true);
    const add = items.filter(i => i.kind === "add" && checked[i.key]).map(i => i.field);
    const remove = items.filter(i => i.kind === "rem" && checked[i.key]).map(i => i.field);
    const vadd = {}, vrem = {};
    items.filter(i => i.kind === "vadd" && checked[i.key]).forEach(i => (vadd[i.field] = vadd[i.field] || []).push(i.value));
    items.filter(i => i.kind === "vrem" && checked[i.key]).forEach(i => (vrem[i.field] = vrem[i.field] || []).push(i.value));
    try { await api.p4Adopt(cid, { add, remove, vadd, vrem }); } finally { closeModal(); onDone && onDone(); }
  };
  const color = turnClientColor(cid);
  return html`<${Sheet} title=${T("Review changes")} width=${580} noGuard=${true} onClose=${closeModal} onBack=${closeModal}
      foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" disabled=${busy} onClick=${closeModal}>${T("Preserve current")}</button><button class="btn btn-primary" disabled=${busy || !adoptable.length} onClick=${adopt}>${busy ? T("adopting…") : T("Adopt changes")}</button><//>`}>
    <p class="hint" style="margin:2px 0 12px">${T("Schema changes for")} <b style=${color ? "color:" + color : ""}>${rep.name || cid}</b>${rep.app_version ? T(" (upstream {ver})", { ver: rep.app_version }) : ""}. <b style="color:var(--fault)">${T("Needs-wiring")}</b> ${T("items can't be adopted until a panel update teaches the encoder to emit them.")}</p>
    <div class="revlist">
      ${adoptable.length ? html`<label class="rev-all"><input type="checkbox" checked=${allOn} ref=${el => el && (el.indeterminate = !allOn && someOn)} onChange=${toggleAll}/><span>${T("Check all")}</span></label>` : null}
      ${items.map(i => html`<label class=${"rev-item " + i.kind + (i.adoptable ? "" : " disabled")} key=${i.key}>
        <input type="checkbox" disabled=${!i.adoptable} checked=${i.adoptable ? !!checked[i.key] : false} onChange=${() => i.adoptable && toggle(i.key)}/>
        ${i.kind === "add" ? html`<span class="fd-sum add">${T("Add {v1}", { v1: i.field })}</span>`
          : i.kind === "rem" ? html`<span class="fd-sum rem">${T("Remove {v1}", { v1: i.field })}</span>`
          : i.kind === "vadd" || i.kind === "vwire" ? html`<span class="fd-sum val">${T("Add {value} to {field}", { value: i.value, field: lbl(i.field) })}</span>`
          : i.kind === "vrem" ? html`<span class="fd-sum rem">${T("Remove {value} from {field}", { value: i.value, field: lbl(i.field) })}</span>`
          : html`<span class="rev-file mono">${i.field}</span>`}
        <span class="grow"></span>
        ${i.kind === "wire" || i.kind === "vwire" ? html`<span class="rc-wtag">${T("Needs wiring")}</span>` : null}
      </label>`)}
    </div>
  <//>`;
}
export function rosterChanges(client) {
  const items = [];
  for (const f of (client.files || [])) {
    if (f.status !== "changed") continue;
    const fname = f.path.split("/").pop(), fd = f.field_diff;
    const na = fd ? (fd.added || []) : [], nr = fd ? (fd.removed || []) : [];
    if (na.length || nr.length) {
      na.forEach(x => items.push({ key: fname + ":+" + x, file: fname, kind: "add", field: x, assisted: !!fd.assisted }));
      nr.forEach(x => items.push({ key: fname + ":-" + x, file: fname, kind: "rem", field: x, assisted: !!fd.assisted }));
    } else {
      items.push({ key: fname + ":src", file: fname, kind: "src", field: null });
    }
  }
  return items;
}
export function openRosterReview(cid, client, onAdopt) { pushModal(html`<${RosterReviewSheet} cid=${cid} client=${client} onAdopt=${onAdopt}/>`); }
export function RosterReviewSheet({ cid, client, onAdopt }) {
  const items = rosterChanges(client);
  const [checked, setChecked] = useState(() => { const m = {}; items.forEach(i => m[i.key] = true); return m; });
  const [busy, setBusy] = useState(false);
  const allOn = items.length > 0 && items.every(i => checked[i.key]);
  const someOn = items.some(i => checked[i.key]);
  const toggleAll = () => { const v = !allOn; setChecked(() => { const m = {}; items.forEach(i => m[i.key] = v); return m; }); };
  const toggle = k => setChecked(m => ({ ...m, [k]: !m[k] }));
  const adopt = async () => { setBusy(true); try { await onAdopt(cid); } finally { closeModal(); } };
  const color = turnClientColor(cid);
  return html`<${Sheet} title=${T("Review changes")} width=${520} noGuard=${true} onClose=${closeModal} onBack=${closeModal}
      foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-ghost btn-dismiss" disabled=${busy} onClick=${closeModal}>${T("Preserve current")}</button><button class="btn btn-primary" disabled=${busy} onClick=${adopt}>${busy ? T("adopting…") : T("Adopt changes")}</button><//>`}>
    <p class="hint" style="margin:2px 0 12px">${T("Upstream changes to")} <b style=${color ? "color:" + color : ""}>${client.name}</b>${T("'s config schema since you last reviewed it. Adopting records you've caught up — the schema edit itself, if one's needed, is a code change.")}</p>
    ${!items.length
      ? html`<div class="notice"><${Ic} i="info"/><span>${T("The source moved but nothing field-level was parsed — adopt to acknowledge the new commit.")}</span></div>`
      : html`<div class="revlist">
          <label class="rev-all"><input type="checkbox" checked=${allOn} ref=${el => el && (el.indeterminate = !allOn && someOn)} onChange=${toggleAll}/><span>${T("Check all")}</span></label>
          ${items.map(i => html`<label class=${"rev-item " + i.kind} key=${i.key}><input type="checkbox" checked=${!!checked[i.key]} onChange=${() => toggle(i.key)}/>
            <span class="rev-file mono">${i.file}</span>
            ${i.kind === "add" ? html`<span class="fd-sum add">+ ${i.field}</span>` : i.kind === "rem" ? html`<span class="fd-sum rem">− ${i.field}</span>` : html`<span class="faint">${T("source changed")}</span>`}
            ${i.assisted ? html`<span class="fd-approx" title=${T("Best-effort parse (Python/Go source)")}>≈</span>` : null}</label>`)}
        </div>`}
  <//>`;
}
export function verCmp(a, b) {
  const seg = s => String(s).replace(/^v/i, "").split(/[^0-9]+/).filter(x => x !== "").map(Number);
  const pa = seg(a), pb = seg(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
export function ForkVersionPanel({ f, commitRef, onDirty }) {
  useStore();
  const fork = f.id, kind = f.kind, owner = f.owner;
  const wdtt = kind === "wdtt";
  const csqtt = kind === "csqtt";
  const running = {};
  for (const [nid, snap] of Object.entries(Store.stats || {})) {
    if (csqtt) { for (const c of (snap.csqtt || [])) if (c && c.iface) { const ln = c.line || CSQTT_DEFAULT_LINE, k = ln === CSQTT_DEFAULT_LINE ? nid : nid + "@" + ln;
      const m = running[k] = running[k] || { version: "", ids: [], node: nid, line: ln }; if (c.version) m.version = c.version; m.ids.push(c.iface); } }
    else if (wdtt) { for (const w of (snap.wdtt || [])) if (w && w.fork === fork && w.iface) { const m = running[nid] = running[nid] || { version: "", ids: [] }; if (w.version) m.version = w.version; m.ids.push(w.iface); } }
    else { for (const tp of (snap.turn_proxies || [])) if (tp.service && turnFork(tp.service) === fork) { const m = running[nid] = running[nid] || { version: "", ids: [] }; if (tp.version) m.version = tp.version; m.ids.push(tp.service); } }
  }
  const nodeOf = k => (running[k] || {}).node || k;
  const nids = Object.keys(running).sort((a, b) => Store.byNode(nodeOf(a), nodeOf(b)) || a.localeCompare(b));
  const [vmap, setVmap] = useState({});
  const [sel, setSel] = useState({});
  const heldOf = k => { const r = running[k] || {}; return (Store.turnHolds[nodeOf(k)] || {})[r.line && r.line !== CSQTT_DEFAULT_LINE ? fork + "@" + r.line : fork] || ""; };
  const curSel = nid => (nid in sel ? sel[nid] : heldOf(nid));
  const key = nids.join(",");
  useEffect(() => { let live = true; (async () => {
    const out = {};
    for (const nid of nids) {
      if (csqtt) { const r = await api.csqttVersions({ node: nodeOf(nid), iface: running[nid].ids[0] || "" }); if (r && r.ok) out[nid] = r.data.versions || []; }
      else if (wdtt) { const r = await api.wdttVersions({ node: nid, iface: running[nid].ids[0] || "", fork }); if (r && r.ok) out[nid] = r.data.versions || []; }
      else { const r = await api.turnVersions({ owner, node: nid, fork }); if (r && r.ok) out[nid] = (r.data.tags || []).map(t => t.tag); }
    }
    if (live) setVmap(out);
  })(); return () => { live = false; }; }, [key, fork]);
  const dirty = nids.some(nid => curSel(nid) !== heldOf(nid));
  useEffect(() => { if (onDirty) onDirty(dirty); }, [dirty]);
  if (commitRef) commitRef.current = async () => {
    const errs = [];
    for (const nid of nids) {
      const want = curSel(nid), cur = heldOf(nid);
      if (want === cur) continue;
      if (csqtt) { const r = await api.csqttVersion({ node: nodeOf(nid), iface: running[nid].ids[0] || "", ver: want }); if (r && !r.ok) errs.push(Store.nodeName(nodeOf(nid)) + ": " + (srvText(r) || "failed")); }
      else if (wdtt) { const r = await api.wdttVersion({ node: nid, iface: running[nid].ids[0], ver: want }); if (r && !r.ok) errs.push(Store.nodeName(nid) + ": " + (srvText(r) || "failed")); }
      else { for (const svc of running[nid].ids) { const r = await api.turnReinstall({ node: nid, service: svc, owner, ...(want ? { tag: want } : {}) }); if (r && !r.ok) { errs.push(Store.nodeName(nid) + ": " + (srvText(r) || "failed")); break; } } }
    }
    return errs;
  };
  if (!nids.length) return html`<div class="hint">${T("Not deployed on any node yet — version & rollback appear once a {v1} server is running.", { v1: f.label || fork })}</div>`;
  return html`<div class="fvp">${nids.map(nid => { const versions = vmap[nid] || []; const inst = running[nid].version || "—"; const held = heldOf(nid);
    const sorted = versions.slice().sort((a, b) => verCmp(b, a));
    const latest = sorted[0] || "";
    let opts = sorted.filter(x => x !== latest);
    if (held && !opts.includes(held)) opts = [held, ...opts].sort((a, b) => verCmp(b, a));
    const mismatch = held && inst !== "—" && inst !== held;
    return html`<div class="fvp-node" key=${nid}>
      <div class="fvp-head">
        <span class="fvp-dot" style=${"background:" + (Store.nodeColor(nodeOf(nid)) || "var(--ink)")}></span>
        <b class="fvp-nm">${Store.nodeName(nodeOf(nid))}</b>${csqtt && (csqttLinesOn() || running[nid].line !== CSQTT_DEFAULT_LINE) ? html` <span class="faint">csqtt ${running[nid].line}</span>` : null}
        <span class="fvp-ver">${T("Installed")} <span class="mono">${inst}</span>${running[nid].ids.length > 1 ? html` · <span class="faint">${plural(running[nid].ids.length, "server")}</span>` : ""}</span>
        ${held ? html`<span class="tg" style=${"color:var(--" + (mismatch ? "dangling" : "warn") + ");background:color-mix(in srgb,var(--" + (mismatch ? "dangling" : "warn") + ") 16%,transparent)"}>${T("held · {v1}", { v1: held })}</span>` : null}
      </div>
      <div class="fvp-act">
        <${Dropdown} className="selwrap fvp-sel" value=${curSel(nid)} ariaLabel=${T("Use latest version")}
          onChange=${v => setSel(m => ({ ...m, [nid]: v }))}
          options=${[{ value: "", label: T("Use latest version") }, ...opts.map(x => ({ value: x, label: x }))]}/>
        ${curSel(nid) !== heldOf(nid) ? html`<span class="fvp-pend"><${Ic} i="pencil"/> ${T("tag|unsaved")}</span>` : null}
      </div>
      ${mismatch ? html`<div class="notice warn" style="margin:2px 0 0"><${Ic} i="warn"/><span>${Trich("Pinned to *{held}* but the node is still running *{inst}* — the version swap failed on the node (often a checksum mismatch). Check the proxy's status, then re-try or pick a different version.", { held, inst })}</span></div>` : null}
    </div>`; })}
  </div>`;
}
export async function applyTurnUpdate(row) {
  const { fork, kind, node, ids = [], latest } = row || {};
  if (kind === "csqtt") { const r = await api.csqttVersion({ node, iface: ids[0] || "", ver: "" }); return (r && r.ok) ? "" : (srvText(r) || T("failed")); }
  if (kind === "wdtt")  { const r = await api.wdttVersion({ node, iface: ids[0] || "", ver: "" });  return (r && r.ok) ? "" : (srvText(r) || T("failed")); }
  const owner = (turnForkList().find(x => x.id === fork) || {}).owner || "";
  for (const svc of ids) {
    const r = await api.turnReinstall({ node, service: svc, owner, ...(latest ? { tag: latest } : {}) });
    if (r && !r.ok) return srvText(r) || T("failed");
  }
  return "";
}

export function TurnUpdateSheet({ node }) {
  const rows = (Store.turnUpdates || []).filter(r => !node || r.node === node);
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState({});
  const key = r => r.fork + (r.line ? "@" + r.line : "") + "|" + r.node;
  const idLabel = (kind, id) => {
    if (kind !== "turn") return id;
    const m = String(id).match(/-(\d+)$/);
    return m ? ":" + m[1] : id;
  };
  const run = async (list, tok) => {
    for (const r of list) {
      setBusy(tok || (list.length > 1 ? "*" : key(r)));
      const err = await applyTurnUpdate(r);
      setDone(d => ({ ...d, [key(r)]: err }));
    }
    setBusy(""); await Store.poll();
  };
  const pending = rows.filter(r => done[key(r)] === undefined);
  const servers = rows.reduce((n, r) => n + (r.ids || []).length, 0);
  const nodes = new Set(rows.map(r => r.node)).size;
  const groups = [];
  for (const r of rows) {
    let g = groups.find(x => x.fork === r.fork && x.line === r.line);
    if (!g) groups.push(g = { fork: r.fork, line: r.line, latest: r.latest, rows: [] });
    g.rows.push(r);
  }
  groups.sort((a, b) => forkPickLabel(a.fork).localeCompare(forkPickLabel(b.fork), undefined, { sensitivity: "base" }) || String(a.line || "").localeCompare(String(b.line || "")));
  for (const g of groups) {
    g.same = g.rows.every(r => r.installed === g.rows[0].installed) ? g.rows[0].installed : "";
    g.pend = g.rows.filter(r => done[key(r)] === undefined);
  }
  const pair = (inst, latest) => html`<span class="mono">${inst}</span><span class="verarrow">→</span><span class="mono vernew">${latest}</span>`;
  const solo = groups.length === 1 && groups[0].rows.length === 1 ? groups[0].rows[0] : null;
  const forkHoisted = groups.length === 1 && groups[0].rows.length > 1;
  const act = (r, hoisted) => { const st = done[key(r)]; return st === "" ? html`<span class="tf-chk ok"><${Ic} i="check"/> ${T("updated")}</span>`
    : st ? html`<span class="tf-chk"><${Ic} i="warn"/> ${st}</span>`
    : hoisted ? null
      : html`<button class="btn btn-mini" disabled=${!!busy} onClick=${() => run([r])}>${busy === key(r) ? T("Updating…") : T("Update")}</button>`; };
  return html`<${Sheet} title=${T("Server updates")} width=${640} onClose=${closeModal}
      foot=${footRow({ cancelLabel: T("Close"), onCancel: closeModal,
                       disabled: !!busy || !pending.length,
                       onAction: () => run(pending, "*"),
                       action: busy === "*" ? T("Updating…") : solo ? T("Update") : T("Update all") })}>
    <p class="hint" style="margin:2px 0 14px">${node
      ? Trich("Each update swaps the server's binary and *restarts it*, which briefly drops that server's clients. This one covers {v1} on {v2} — pick a quiet moment, or update them one at a time.", { v1: plural(servers, "server"), v2: Store.nodeName(node) })
      : Trich("Each update swaps the server's binary and *restarts it*, which briefly drops that server's clients. This one covers {v1} across {v2} — pick a quiet moment, or update them one at a time.", { v1: plural(servers, "server"), v2: plural(nodes, "prep|node") })}</p>
    <div class="fvp">${groups.map(g => html`<div class="fvp-node" key=${g.fork + (g.line || "")} style=${"--tfc:" + turnColor(g.fork)}>
      <div class="fvp-head">
        <span class="fvp-dot" style="background:var(--tfc)"></span>
        <b class="fvp-nm" style="color:var(--tfc)">${forkPickLabel(g.fork)}${g.line ? " " + g.line : ""}</b>
        ${g.rows.length === 1
          ? html`<span class="fvp-ver">${T("on")} ${Store.nodeName(g.rows[0].node)}<span class="verarrow">·</span>${pair(g.rows[0].installed, g.latest)}</span>`
          : html`<span class="fvp-ver">${g.same ? pair(g.same, g.latest) : html`<span class="verarrow">→</span><span class="mono vernew">${g.latest}</span>`}</span>`}
        <span class="grow"></span>
        ${g.rows.length === 1 ? act(g.rows[0], !!solo)
          : forkHoisted || !g.pend.length ? null
            : html`<button class="btn btn-mini" disabled=${!!busy} onClick=${() => run(g.pend, "g:" + g.fork + (g.line || ""))}>${busy === "g:" + g.fork + (g.line || "") ? T("Updating…") : T("Update {v1}", { v1: plural(g.pend.length, "node") })}</button>`}
      </div>
      ${g.rows.length === 1
        ? html`<div class="tus-ids">${(g.rows[0].ids || []).map(id => html`<span class="iftype tus-id" key=${id}>${idLabel(g.rows[0].kind, id)}</span>`)}</div>`
        : html`<div class="tus-nodes">${g.rows.map(r => html`<div class="tus-node" key=${r.node}>
            <span class="tus-nn"><span class="tus-ndot" style=${"background:" + (Store.nodeColor(r.node) || "var(--muted)")}></span>${Store.nodeName(r.node)}</span>
            ${g.same ? null : html`<span class="fvp-ver">${pair(r.installed, g.latest)}</span>`}
            <span class="tus-ids">${(r.ids || []).map(id => html`<span class="iftype tus-id" key=${id}>${idLabel(r.kind, id)}</span>`)}</span>
            <span class="grow"></span>${act(r)}
          </div>`)}</div>`}
    </div>`)}</div>
    ${!rows.length ? html`<div class="hint">${T("Everything is on its newest build.")}</div>` : null}
  <//>`;
}
export function openTurnUpdates(node) { openModal(html`<${TurnUpdateSheet} node=${typeof node === "string" ? node : undefined}/>`); }

export function openServerDefaults(fork) { pushModal(html`<${ServerDefaultsSheet} fork=${fork}/>`); }
export function ServerDefaultsSheet({ fork }) {
  useStore();
  const f = turnForkList().find(x => x.id === fork) || {};
  const schema = f.settings || [];
  const stored = ((Store.panelSettings || {}).turn_server_defaults || {})[fork] || {};
  const keyField = schema.find(d => d.type === "hexkey");
  const baseTyped = () => { const v = {}; schema.forEach(d => { const s = stored[d.key]; v[d.key] = (s === undefined || s === null) ? (d.default === undefined ? "" : d.default) : s; }); return v; };
  const [vals, setVals] = useState(baseTyped);
  const [extra, setExtra] = useState(stored._extra || "");
  const [busy, setBusy] = useState(false); const [flash, setFlash] = useState(null); const [savedOnce, setSavedOnce] = useState(false);
  const [verOpen, setVerOpen] = useState(true);
  const verCommitRef = useRef(null); const [verDirty, setVerDirty] = useState(false);
  const setV = (k, v) => setVals(o => ({ ...o, [k]: v }));
  const rawCap = !!f.raw;
  const rawSaved = typeof stored.raw === "boolean" ? stored.raw : ((Store.panelSettings || {}).wdtt_raw_default !== false);
  const [rawDef, setRawDef] = useState(rawSaved);
  const rawDirty = rawCap && rawDef !== rawSaved;
  const defaultsDirty = JSON.stringify({ ...vals, _extra: extra }) !== JSON.stringify({ ...baseTyped(), _extra: (stored._extra || "") });
  const dirty = defaultsDirty || verDirty || rawDirty;
  const save = async () => {
    setBusy(true); setFlash(null);
    if (defaultsDirty || rawDirty) {
      const keyUsed = turnKeyUsed(schema, vals);
      const all = { ...((Store.panelSettings || {}).turn_server_defaults || {}) };
      const clean = {}; schema.forEach(d => { if (d === keyField && !keyUsed) return; const vv = vals[d.key]; if (vv !== undefined && vv !== null && vv !== "") clean[d.key] = vv; });
      if (extra.trim()) clean._extra = extra.trim();
      if (rawCap) clean.raw = rawDef;
      all[fork] = clean;
      const r = await api.panelSettings({ turn_server_defaults: all });
      if (!r.ok) { setBusy(false); setFlash(srvText(r) || T("Save failed")); return false; }
    }
    if (verDirty && verCommitRef.current) {
      const errs = await verCommitRef.current();
      if (errs && errs.length) { setBusy(false); setFlash(errs.join(" · ")); return false; }
    }
    await Store.poll(); closeModal();
    toast(verDirty ? T("Version change requested — applies on each node's next sync.") : T("Server defaults saved — used when creating new {v1} proxies.", { v1: f.label || fork }), "ok");
    return true;
  };
  return html`<${Sheet} title=${html`${T("Server defaults")} <span class="faint" style="text-transform:none;letter-spacing:0">— ${forkPickLabel(fork)}</span>`} width=${680} noGuard=${true} onClose=${closeModal} onBack=${closeModal}
      foot=${footRow({ left: flash ? html`<span class="vk-status ok savedmsg"><${Ic} i="check"/> ${flash}</span>` : null, cancelLabel: (savedOnce && !dirty) ? T("Close") : T("Cancel"), onCancel: closeModal, disabled: busy || !dirty, onAction: save, action: busy ? T("Saving…") : T("Save") })}>
    <p class="hint" style="margin:2px 0 14px">${isSelfContainedKind(f.kind)
      ? Trich("Extra command-line flags that *pre-fill* a new {v1} server. It's self-contained — its real config lives per interface — so there's little to default here beyond advanced flags.", { v1: f.label || fork })
      : Trich("The ExecStart flags that *pre-fill* a new {v1} proxy. Nothing here changes proxies you've already deployed.", { v1: f.label || fork })}</p>
    <${TurnServerFields} schema=${schema} vals=${vals} setV=${setV} extra=${extra} setExtra=${setExtra} listen="server_ip:port" connect="interface_ip:port" template=${true} wdtt=${isSelfContainedKind(f.kind)}/>
    ${rawCap ? html`<${Fragment}>
      <div class="seclabel" style="margin-top:18px">${T("RAW-IP mode")}</div>
      <p class="hint" style="margin:0 0 10px">${Trich("A second, WireGuard-free listener that is roughly *6x* faster through the same VK relay. The server keeps its normal WireGuard listener either way, so each user picks per device — but RAW has *no forward secrecy and no replay protection*. This only sets what a NEWLY created server starts with; every server can be switched afterwards.")}</p>
      <div class="cl-row" style="margin-bottom:4px"><span class="cl-name">${T("Enable RAW on new servers")}</span><span class="grow"></span>
        <label class="swt" title=${rawDef ? T("New servers start with RAW on") : T("New servers start with RAW off")}><input type="checkbox" checked=${rawDef} onChange=${e => setRawDef(e.target.checked)}/><span class="track"></span><span class="knob"></span></label></div>
    <//>` : null}
    <${Disclosure} title=${T("Version & rollback")} sumCls="route" open=${verOpen} onToggle=${() => setVerOpen(o => !o)}>
      <p class="hint" style="margin:0 0 10px">${Trich("{fork} servers share one binary per node, so the version is per node — every {fork} instance on a node moves together. Pinning an older version *holds* it (no auto-update); *Use latest* follows new releases.", { fork: f.kind === "csqtt" ? (f.product || fork) : (f.label || fork) })}</p>
      <${ForkVersionPanel} f=${f} commitRef=${verCommitRef} onDirty=${setVerDirty}/>
    <//>
  <//>`;
}
let _turnPend = null;
export function turnPendLabel(act) {
  if (!_turnPend) _turnPend = { install: T("ifop|installing"), manage: T("ifop|applying"), rotate: T("ifop|rotating"), delete: T("ifop|deleting"),
    onboard: T("ifop|adopting"), restart: T("ifop|restarting"), reinstall: T("ifop|installing"), start: T("ifop|starting"), stop: T("ifop|stopping") };
  return _turnPend[act] || "";
}
const _turnRestartPend = {};
export const turnRestarted = {};
export const turnUpdating = {};
export const turnUpdateTarget = {};
export const turnReady = {};
export const turnUpdatedFlash = {};
export const turnWasUpd = {};
export const turnWasBusy = {};
export const turnWasInstalling = {};
export function trackTurnRestarts() {
  const seen = {};
  for (const n of (Store.nodes || [])) {
    for (const [svc, act] of Object.entries(n.turn_pending || {})) if (act === "restart") seen[n.id + "|" + svc] = true;
  }
  for (const k of Object.keys(_turnRestartPend)) if (!seen[k]) {
    turnRestarted[k] = Date.now() + 5000; delete _turnRestartPend[k];
    setTimeout(() => Store.apply(), 0);
    setTimeout(() => Store.apply(), 5100);
  }
  for (const k of Object.keys(seen)) _turnRestartPend[k] = true;
}

export async function cancelTurn(node, body) {
  const r = await api.turnCancel({ node, ...body });
  if (!r.ok) return toast(srvText(r) || T("Failed to cancel."), "err");
  await Store.poll(); toast(T("Pending turn-proxy request cancelled."), "ok");
}
export async function restartTurn(node, service) {
  const r = await api.turnRestart({ node, service });
  if (!r.ok) return toast(srvText(r) || T("Failed to restart."), "err");
  await Store.poll(); toast(T("Restart requested — applies on the node's next sync."), "ok");
}
export async function stopTurn(node, service) {
  const r = await api.turnStop({ node, service });
  if (!r.ok) return toast(srvText(r) || T("Failed to stop."), "err");
  await Store.poll(); toast(T("Stop requested — applies on the node's next sync."), "ok");
}
export async function startTurn(node, service) {
  const r = await api.turnStart({ node, service });
  if (!r.ok) return toast(srvText(r) || T("Failed to start."), "err");
  await Store.poll(); toast(T("Start requested — applies on the node's next sync."), "ok");
}
export function openSetupTurn(node, forwardIface) { openModal(html`<${SetupTurnSheet} node=${node} forwardIface=${forwardIface}/>`); }
export function SetupTurnSheet({ node, forwardIface }) {
  const FORKS = enabledTurnForks().filter(f => !isSelfContainedKind(f.kind));
  const [mode, setMode] = useState("new");
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const snap = Store.stats[node] || {};
  const isBridge = nrec.kind === "docker" && (nrec.net_mode || "host") === "bridge";
  const allIfaces = Object.entries(snap.interfaces || {})
    .map(([n, b]) => ({ name: n, port: String((b.meta || {}).listen_port || ""), sys: !!(b.meta || {}).system || n.startsWith("swg_") || isSelfContainedName(n), awg: !!Object.keys((b.meta || {}).awg_params || {}).length,
                        awg3: awgGen(node, n) === "3.1" }))
    .filter(i => i.port && !i.sys);
  const fwdPre = forwardIface ? allIfaces.find(i => i.name === forwardIface) : null;
  const [fork, setFork] = useState(((fwdPre && fwdPre.awg ? FORKS.find(x => forkSupportsAwg(x.id) && (!fwdPre.awg3 || forkSupportsAwg3(x.id))) : null) || FORKS[0] || turnForkList()[0]).id);
  const epIp = (() => {
    for (const b of Object.values(snap.interfaces || {})) {
      const ep = (b.meta || {}).endpoint || "";
      if (ep) return ep.includes(":") ? ep.slice(0, ep.lastIndexOf(":")) : ep;
    }
    return "";
  })();
  const ips = ipChoices(nrec, epIp);
  const fits = (id, i) => (forkSupportsAwg(id) || !i.awg) && (forkSupportsAwg3(id) || !i.awg3);
  const ifaces = allIfaces.filter(i => fits(fork, i));
  const hideAwg = !forkSupportsAwg(fork) && allIfaces.some(i => i.awg);
  const hideAwg3 = forkSupportsAwg(fork) && !forkSupportsAwg3(fork) && allIfaces.some(i => i.awg3);
  const lInit = listenHostInit(epIp, ips, (nrec || {}).ips, isBridge);
  const [lsel, setLsel] = useState(lInit);
  const [lcustom, setLcustom] = useState(lInit === "__custom__" ? epIp : "");
  const [lport, setLport] = useState(String(suggestPort(node, "turn")));
  const tsperr = portErrMsg(node, lport, []);
  const [fwd, setFwd] = useState(fwdPre ? fwdPre.name : (ifaces[0] ? ifaces[0].name : "__custom__"));
  const [custom, setCustom] = useState("127.0.0.1:51820");
  const [title, setTitle] = useState("");
  const [wrapKey] = useState(randWrapKey);
  const dflParams = fk => { const sch = forkSettings(fk.id); const sd = ((Store.panelSettings || {}).turn_server_defaults || {})[fk.id] || {};
    const base = serializeTurnSettings(sch, { ...defaultSettingValues(sch, { key: wrapKey }), ...sd });
    return base + (sd._extra ? (base ? " " : "") + sd._extra : ""); };
  const [params, setParams] = useState(dflParams(FORKS[0] || turnForkList()[0]));
  const [openSec, setOpenSec] = useState(null);
  const [path, setPath] = useState("");
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const fail = t => { setBusy(false); setMsg({ k: "err", t }); };
  const isCustom = fwd === "__custom__";
  const f = turnForkList().find(x => x.id === fork) || FORKS[0] || turnForkList()[0];
  const lhost = ipPickerVal(lsel, lcustom);
  const [pin, setPin] = useState("");
  const lst = useListenState(node, lhost, "", "", pin);
  const isWdtt = f.kind === "wdtt";
  const isCsqtt = f.kind === "csqtt";
  const isSelfContained = isWdtt || isCsqtt;
  const wdttSaveRef = useRef(null);
  const csqttSaveRef = useRef(null);
  const pickFork = id => {
    const cf = turnForkList().find(x => x.id === fork) || turnForkList()[0];
    const nf = turnForkList().find(x => x.id === id) || turnForkList()[0];
    if (params === dflParams(cf)) setParams(dflParams(nf));
    if (fwd !== "__custom__" && !allIfaces.some(i => i.name === fwd && fits(id, i))) {
      const first = allIfaces.find(i => fits(id, i)); setFwd(first ? first.name : "__custom__");
    }
    setFork(id);
  };
  const randKey = () => copy(randWrapKey(), T("Random 64-hex key copied — paste it into the parameters"));
  const save = async () => {
    if (mode === "existing") {
      const p = path.trim();
      if (!p.startsWith("/") || !p.endsWith(".service")) return fail(T("Enter the absolute path to the .service unit."));
      setBusy(true); setMsg({ k: "work", t: T("requesting…") });
      const r = await api.turnOnboard({ node, path: p });
      if (!r.ok) return fail(srvText(r) || T("Request failed."));
      closeModal(); await Store.poll();
      return toast(T("Turn-proxy adopt requested — the node reads it on its next sync."), "ok");
    }
    if (!lhost) return fail(T("Listen IP is required."));
    if (!/^\d+$/.test(lport.trim())) return fail(T("Listen port must be a number."));
    if (isCsqtt) return csqttSaveRef.current ? csqttSaveRef.current(lhost, lport.trim(), pin) : fail(T("csqtt fields aren't ready yet."));
    if (isWdtt) return wdttSaveRef.current ? wdttSaveRef.current(lhost, lport.trim(), pin) : fail(T("WDTT fields aren't ready yet."));
    let connect;
    if (isCustom) { connect = custom.trim(); if (!/:\d+$/.test(connect)) return fail(T("Forwards-to must be host:port.")); }
    else { connect = "127.0.0.1:" + ifaces.find(i => i.name === fwd).port; }
    const svc = "vk-turn-proxy-" + f.id + "-" + lport.trim();
    const _tkey = node + "|" + svc;
    Store.turnNew[_tkey] = { listen: lhost + ":" + lport.trim(), connect, title: title.trim(), at: Date.now() };
    closeModal(); Store.apply();
    const r = await api.turnInstall({ node, fork: f.id, owner: f.owner, wrap_flags: f.wrap,
      listen: lhost + ":" + lport.trim(), connect, title: title.trim(), params: params.trim(), ...(pin ? { bind_ip: pin } : {}) });
    if (!r || !r.ok) { delete Store.turnNew[_tkey]; Store.apply(); return toast(srvText(r) || T("Turn-proxy install failed."), "err"); }
    const _real = (r.data && r.data.service) || svc;
    if (_real !== svc) { Store.turnNew[node + "|" + _real] = Store.turnNew[_tkey]; delete Store.turnNew[_tkey]; }
    await Store.poll();
    toast(T("Turn-proxy install requested — the node downloads + starts it on its next sync."), "ok");
  };
  return html`<${Sheet} title=${mode === "new" ? turnSheetTitle(f.label, title) : T("Adopt turn-proxy")} width=${880}
    foot=${footRow({ onCancel: closeModal, disabled: busy || !!tsperr || (mode === "new" && !FORKS.length), title: tsperr || "", onAction: save, action: mode === "existing" ? T("Adopt") : (isSelfContained ? T("Create") : T("Install")) })}>
    <div class="field"><label>${T("Source")}</label>
      <div class="chiprow proto3">
        <button class=${"chip c-awg" + (mode === "new" ? " on" : "")} onClick=${() => setMode("new")}>${T("Install a fork")}</button>
        <button class=${"chip c-ex" + (mode === "existing" ? " on" : "")} onClick=${() => setMode("existing")}>${T("Adopt existing service")}</button>
      </div></div>
    ${mode === "existing" ? html`<${Fragment}>
      <div class="iface-intro big">
        <div>${T("Adopt a turn-proxy already running as a systemd service on this node.")}</div>
        <div>${T("The node reads the unit's ExecStart (listen, forwards-to, wrap key) on its next sync and it shows up here.")}</div>
      </div>
      <div class="field"><label>${T("Service unit path")}</label><input autofocus value=${path} onInput=${e => setPath(e.target.value)} placeholder="/etc/systemd/system/vk-turn-proxy-...service" autocomplete="off"/></div>
    <//>` : html`<${Fragment}>
      <div class="row2">
        <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${f.label} autocomplete="off"/></div>
        <div class="field"><label>${T("Fork")}</label>
          <${Dropdown} className="selwrap" value=${fork} disabled=${!FORKS.length} onChange=${v => pickFork(v)}
            ariaLabel=${T("Server fork")}
            options=${FORKS.map(x => ({ value: x.id, label: x.label + ((x.wrap || x.keyflag) ? "" : " · " + T("no obfuscation")) }))}/>
          <div class="hint">${FORKS.length ? f.owner : T("No forks enabled — turn them on in Panel settings → Turn proxies.")}</div></div>
      </div>
      <div class="row2">
        <div class="field"><label>${T("Endpoint host / IP")}</label>
          <${IpPicker} ips=${ips} sel=${lsel} setSel=${setLsel} custom=${lcustom} setCustom=${setLcustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/>
          <${ListenHint} st=${lst} fallback=${turnDialFallback(node, isSelfContained ? undefined : (isCustom ? fwdByPort(allIfaces, custom) : fwd))}/></div>
        <div class="field"><label>${T("Listen port")}</label><input class=${tsperr ? "bad" : ""} value=${lport} onInput=${e => setLport(e.target.value)} placeholder="56000"/>${tsperr ? html`<div class="hint err">${tsperr}</div>` : null}</div>
      </div>
      <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
      <${ListenNotice} st=${lst}/>
      ${isCsqtt ? html`<${CsqttInstanceBody} node=${node} snap=${snap} saveRef=${csqttSaveRef} setBusy=${setBusy} setMsg=${setMsg} fail=${fail}/>`
       : isWdtt ? html`<${WdttInstanceBody} node=${node} snap=${snap} saveRef=${wdttSaveRef} setBusy=${setBusy} setMsg=${setMsg} fail=${fail}/>` : html`<${Fragment}>
      <div class="field"><label>${T("Forwards to")}</label>
        <${Dropdown} className="selwrap" value=${fwd} onChange=${v => setFwd(v)} ariaLabel=${T("Forward to")}
          options=${[...ifaces.map(i => ({ value: i.name, label: i.name + " · 127.0.0.1:" + i.port })),
                     { value: "__custom__", label: T("Custom IP:Port…") }]}/>
        ${hideAwg ? html`<div class="hint">${T("{v1} is WireGuard-only — AmneziaWG interfaces are hidden.", { v1: forkLabel(fork) })}</div>` : null}
        ${hideAwg3 ? html`<div class="hint">${T("{v1} serves an app that carries AmneziaWG 2.0 only — AmneziaWG 3.1 interfaces are hidden.", { v1: forkLabel(fork) })}</div>` : null}
      </div>
      ${isCustom ? html`<div class="field"><input value=${custom} onInput=${e => setCustom(e.target.value)} placeholder="127.0.0.1:51820" autocomplete="off"/></div>` : null}
      <${Disclosure} title=${T("Server parameters")} summary=${forkSettings(fork).length ? null : html`<span class="faint">${T("val|none")}</span>`} open=${openSec === "server"} onToggle=${() => setOpenSec(s => s === "server" ? null : "server")}>
        <${TurnParamsEditor} fork=${fork} node=${node} value=${params} onChange=${setParams} listen=${(lhost || "server_ip") + ":" + (lport || "port")} connect=${isCustom ? (custom || "interface_ip:port") : ("127.0.0.1:" + (((ifaces.find(i => i.name === fwd)) || {}).port || "port"))}/>
      <//>
    <//>`}
    <//>`}
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function WdttInstanceBody({ node, snap, saveRef, setBusy, setMsg, fail }) {
  const used = (() => {
    const ifaces = new Set(), subs = new Set(), ports = new Set();
    Object.entries(snap.interfaces || {}).forEach(([n, b]) => {
      if (isWdttName(n)) ifaces.add(n);
      const p = parseInt((b.meta || {}).listen_port, 10); if (p) ports.add(p);
    });
    (snap.turn_proxies || []).forEach(tp => { const p = parseInt(String(tp.listen || "").split(":").pop(), 10); if (p) ports.add(p); });
    (snap.wdtt || []).forEach(w => { if (!w) return;
      if (w.iface) ifaces.add(w.iface);
      if (w.wg_addr) subs.add(String(w.wg_addr).split("/")[0].split(".").slice(0, 3).join("."));
      const wp = parseInt(w.wg_port, 10); if (wp) ports.add(wp);
      const lp = parseInt(String(w.listen || "").split(":").pop(), 10); if (lp) ports.add(lp);
    });
    return { ifaces, subs, ports };
  })();
  const nextIface = (() => { for (let i = 0; i < 100; i++) if (!used.ifaces.has("wdtt" + i)) return "wdtt" + i; return "wdtt0"; })();
  const nextSubnet = (() => { for (let i = 66; i < 230; i++) { const b = "10.66." + i; if (!used.subs.has(b)) return b + ".1/24"; } return "10.66.66.1/24"; })();
  const nextWgPort = (() => { for (let p = 56001; p < 56999; p++) if (!used.ports.has(p)) return String(p); return "56001"; })();
  const [iface, setIface] = useState(nextIface);
  const [subnet, setSubnet] = useState(nextSubnet);
  const [wgPort, setWgPort] = useState(nextWgPort);
  const [adv, setAdv] = useState(false);
  const wgperr = portErrMsg(node, wgPort, []);
  saveRef.current = async (lhost, lport, pin) => {
    const _ne = turnIfaceNameError(node, iface, "wdtt"); if (_ne) return fail(_ne);
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(subnet.trim())) return fail(T("Subnet must be an IPv4 CIDR (e.g. 10.66.66.1/24)."));
    if (!/^\d+$/.test(String(wgPort).trim())) return fail(T("Internal WG port must be a number."));
    if (wgperr) return fail(wgperr);
    if (lport && String(lport).trim() === String(wgPort).trim()) return fail(T("The DTLS listen port and internal WG port must differ."));
    setBusy(true); setMsg({ k: "work", t: T("creating WDTT server… (the node installs it on its next sync)") });
    const r = await api.wdttSet({ node, iface: iface.trim(), wg_addr: subnet.trim(),
      listen: lhost + ":" + lport, wg_port: parseInt(String(wgPort).trim(), 10), max_passwords: 200, stopped: false, ...(pin ? { bind_ip: pin } : {}) });
    if (!r.ok) return fail(srvText(r) || T("Request failed."));
    closeModal(); Store.apply(); await Store.poll();
    toast(T("WDTT server requested — the node installs it on its next sync. Add users from Peers."), "ok");
  };
  return html`<${Fragment}>
    <div class="field"><label>${T("Serves")}</label>
      <div class="selwrap" style="display:flex;align-items:center;justify-content:space-between;opacity:.9">
        <span>${T("Built-in userspace WireGuard")}</span>
        <span class="mono faint">${iface} · ${subnet}</span>
      </div>
      <div class="hint">${T("WDTT owns its own WireGuard interface — users attach to it directly (no forwards-to). WDTT mints each user's key + IP on connect; you add + manage users from Peers.")}</div>
    </div>
    <${Disclosure} title=${T("Advanced — built-in interface")} open=${adv} onToggle=${() => setAdv(a => !a)}>
      <div class="row2">
        <div class="field"><label>${T("col|Interface")}</label><input value=${iface} onInput=${e => setIface(e.target.value)} placeholder="wdtt1" autocomplete="off"/></div>
        <div class="field"><label>${T("Internal WG port")}</label><input class=${wgperr ? "bad" : ""} value=${wgPort} onInput=${e => setWgPort(e.target.value)} placeholder="56001" autocomplete="off"/>${wgperr ? html`<div class="hint err">${wgperr}</div>` : null}</div>
      </div>
      <div class="field"><label>${T("Internal subnet")}</label><input value=${subnet} onInput=${e => setSubnet(e.target.value)} placeholder="10.66.66.1/24" autocomplete="off"/>
        <div class="hint">${T("Auto-assigned to avoid collisions with this node's other WDTT servers, interfaces, and ports.")}</div></div>
    <//>
  <//>`;
}

export const WDTT_COLOR = "#A78BFA";
export function WdttCard({ node, w, reorder }) {
  const active = w.active === "active";
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const converting = (nrec.proc_status || "").startsWith("converting");
  const nblocked = nodeStale(node) || inProc(nrec.proc_status);
  const restoring = (nrec.wdtt_restoring || []).includes(w.iface);
  const awaiting = !!w.await_restore;
  const rid = "wdtt:" + w.iface;
  const it = reorder ? reorder.item(rid) : null;
  const wstopped = !!((nrec.wdtt_cfg || {})[w.iface] || {}).stopped;
  const _wop = Store.ifaceOp[node + "|" + w.iface];
  const _wopTag = opTag(node + "|" + w.iface);
  const deleting = !!Store.ifaceGone[node + "|" + w.iface];
  const adopting = (nrec.wdtt_adopting || []).includes(w.iface);
  const tag = deleting ? html`<${StatusTag} cls="tg-del" icon="clock" label="deleting" title=${T("The node tears it down on its next sync")}/>`
    : adopting ? html`<${StatusTag} cls="tg-busy" icon="clock" label=${T("tag|adopting")} title=${T("The node applies the take-over on its next sync")}/>`
    : converting ? html`<${StatusTag} cls="tg-convert" icon="clock" label="converting" title=${T("The node is converting between bare-metal and docker")}/>`
    : _wopTag ? _wopTag
    : restoring ? html`<${StatusTag} cls="tg tg-pending" icon="clock" label="restoring…" title=${T("Restoring the vaulted server identity")}/>`
    : awaiting ? html`<${StatusTag} cls="tg-busy del" icon="shield" label=${T("Restore")} title=${T("A vaulted identity exists — restore it to bring this server back with its original key")}/>`
    : active ? null
    : wstopped ? html`<span class="tg-off" title=${T("Stopped from the panel — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
    : html`<${StatusTag} cls="tg tg-pending" icon="clock" label="starting" title=${T("Installing / starting on the node")}/>`;
  const _wopBusy = _wop && _wop.phase === "busy";
  const wdim = deleting || adopting || converting || awaiting || restoring || !active || _wopBusy;
  const wCanOpen = !_wopBusy && !nblocked && !deleting && !adopting;
  return html`<div class=${"ifcard tp" + (wCanOpen ? " clickable" : "") + (wdim ? " down" : "") + (nblocked ? " locked" : "") + (it ? it.cls : "")} data-rid=${it ? it.rid : null} onClick=${() => { if (!wCanOpen) return; openModal(html`<${WdttManageSheet} node=${node} w=${w}/>`); }}>
    <div class="ifcard-top">${reorder ? html`<span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.stopPropagation()} ...${reorder.grip(rid)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>` : null}
      <span class="iftype wdtt">WDTT</span>
      <span class="ifname">${shownTitle("w|" + node + "|" + w.iface, (((nrec.wdtt_cfg || {})[w.iface] || {}).title || "").trim()) || w.iface}</span><span class="grow"></span>
      ${(() => { const conn = wdttConnRows(node, w.iface); return conn.length ? html`<${OnlPop} peer title=${T("Connected to this WDTT server")} cls="ifc-conn" rows=${conn} trigger=${c => html`<b class="oncount on">${c}</b>`}/>` : null; })()}
      ${tag}
    </div>
    <div class="ifcard-rows">
      <div class="ifrow"><span class="l">${T("WDTT fork")}</span><span class="r">${forkLabel(w.fork || "amurcanov")}</span></div>
      ${
 null}
      <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${w.listen || "—"}${w.raw_port
        ? html` <b class="rawport" title=${T("RAW-IP port — no WireGuard, no forward secrecy")}>(${w.raw_port})</b>` : null}</span></div>
      <div class="ifrow"><span class="l">${T("Forwards to")}</span><span class="r"><a class="tg tg-wdtt" href=${"#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(w.iface)} onClick=${e => e.stopPropagation()}>${w.iface}</a></span></div>
    </div></div>`;
}
const _dnsParts = v => String(v || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
const _dnsUsable = x => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(x)
  && !/^(0|127)\./.test(x) && !/^169\.254\./.test(x) && +x.split(".")[0] < 224;
function turnDnsErr(v) {
  const p = [...new Set(_dnsParts(v))];
  if (p.length > 2) return T("Client DNS takes at most two addresses.");
  const bad = p.find(x => !_dnsUsable(x));
  return bad ? T("Client DNS must be IPv4 addresses — {v1} is not one a phone can use.", { v1: bad }) : "";
}
const _dnsNorm = v => [...new Set(_dnsParts(Array.isArray(v) ? v.join(",") : v))].join(",");
const turnDnsDefault = fork => ((turnForkList().find(x => x.id === fork) || {}).client_dns || "").split(",").join(", ");
function turnDnsBaseline(cfg, fork, rep) {
  if ((cfg.dns_orig || []).length) return { v: cfg.dns_orig.join(", "), own: true };
  if (!(cfg.dns || []).length && rep && rep.dns_server) return { v: String(rep.dns_server).split(",").join(", "), own: true };
  return { v: turnDnsDefault(fork), own: false };
}
function useTurnDns(cfg, fork, rep) {
  const base = turnDnsBaseline(cfg, fork, rep);
  const stored = (cfg.dns || []).join(", ");
  const cur = _dnsNorm(stored) === _dnsNorm(base.v) ? "" : stored;
  const [val, set] = useState(cur);
  const dirty = _dnsNorm(val) !== _dnsNorm(cur);
  return { val, set, dirty, cur: stored, base, err: dirty ? turnDnsErr(val) : "", body: dirty ? { dns: [...new Set(_dnsParts(val))] } : {} };
}
const advSum = eg => "DNS" + (natPinApplies(eg) ? " · NAT" : "");
function TurnDnsField({ node, fork, rep, dns, params }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const dflt = dns.base.v;
  const oldNode = !!rep && ("active" in rep) && !("dns" in rep);
  const unsupported = !!(rep && rep.dns_unsupported);
  const inParams = /(^|\s)--?dns(\s|=|$)/.test(params || "");
  const pending = !oldNode && !!rep && ("dns" in rep) && _dnsNorm(rep.dns) !== _dnsNorm(dns.cur);
  const hint = unsupported ? T("This fork's build can't set client DNS yet — its clients get {v1}.", { v1: dflt || "1.1.1.1" })
    : inParams ? T("Extra flags set their own DNS, and that one wins over this field.")
    : oldNode ? T("Saved now, applied once this node updates.")
    : pending ? T("Saved — not on the server yet. The node applies it on its next sync.")
    : nrec.routing_mode === "forcedns" ? T("This node runs Force-DNS: if this server's routing matches by domain, the node's own resolver answers its clients' plain DNS instead.")
    : (dflt && dns.base.own) ? T("Given to every client when it connects. Empty = not set by the panel; this server gives {v1}. Saving restarts the server.", { v1: dflt })
    : dflt ? T("Given to every client when it connects. Empty = not set by the panel; this fork's default is {v1}. Saving restarts the server.", { v1: dflt })
    : T("Given to every client when it connects. Saving restarts the server.");
  return html`<div class="field"><label>${T("Client DNS")}</label>
    <input class=${dns.err ? "bad" : ""} value=${dns.val} disabled=${unsupported} onInput=${e => dns.set(e.target.value)} placeholder=${dflt || "1.1.1.1"} autocomplete="off"/>
    <div class=${"hint" + (dns.err ? " err" : "")}>${dns.err || hint}</div></div>`;
}
export function WdttManageSheet({ node, w: w0 }) {
  useStore();
  const iface = w0.iface;
  const w = ((Store.stats[node] || {}).wdtt || []).find(x => x && x.iface === iface) || w0;
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cfg = (nrec.wdtt_cfg || {})[iface] || {};
  const fork = w.fork || cfg.fork || "amurcanov";
  const forkLabel = (turnForkList().find(x => x.id === fork) || {}).label || fork;
  const [title, setTitle] = useState(shownTitle("w|" + node + "|" + iface, (cfg.title || "").trim()));
  const [params, setParams] = useState((cfg.params || "").trim());
  const [srvOpen, setSrvOpen] = useState(false);
  const awaiting = !!w.await_restore;
  const restoring = (nrec.wdtt_restoring || []).includes(iface);
  const recreating = (nrec.wdtt_recreating || []).includes(iface);
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const notup = w.active !== "active" && !awaiting;
  const ips = ipChoices(nrec);
  const oldListen = cfg.listen || w.listen || "";
  const lhost = oldListen.includes(":") ? oldListen.slice(0, oldListen.lastIndexOf(":")) : oldListen;
  const lport = oldListen.includes(":") ? oldListen.slice(oldListen.lastIndexOf(":") + 1) : "";
  const initHost = lhost || "";
  const [hostSel, setHostSel] = useState(initHost ? (ips.includes(initHost) ? initHost : "__custom__") : (ips[0] || "__custom__"));
  const [hostCustom, setHostCustom] = useState(initHost && !ips.includes(initHost) ? initHost : "");
  const pinCur = cfg.bind_ip || w.bind_ip || "";
  const [pin, setPin] = useState(pinCur);
  const lst = useListenState(node, ipPickerVal(hostSel, hostCustom), lhost, w.bind, pin);
  const [port, setPort] = useState(lport || "");
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const rawCapable = !!(turnForkList().find(x => x.id === fork) || {}).raw;
  const rawCur = String(cfg.raw_port || w.raw_port || "");
  const [rawOn, setRawOn] = useState(!!rawCur);
  const rawHolder = rawOwnerOn(node, iface);
  const wgCur = String(cfg.wg_port || w.wg_port || "56001");
  const [wgIn, setWgIn] = useState(wgCur);
  const wgPort = (wgIn.trim() && /^\d+$/.test(wgIn.trim())) ? wgIn.trim() : wgCur;
  const wgDirty = wgPort !== wgCur;
  const wgErr = !wgIn.trim() ? T("The internal WG port is required.")
    : !/^\d+$/.test(wgIn.trim()) ? T("The internal WG port must be a number.")
    : wgIn.trim() === port.trim() ? T("The DTLS port and the internal WG port must differ.")
    : portErrMsg(node, wgIn, [wgCur, lport]);
  const newListen = (ipPickerVal(hostSel, hostCustom).trim() || "0.0.0.0") + ":" + (port.trim() || "56000");
  const endpointDirty = !!oldListen && newListen !== oldListen;
  const titleDirty = title.trim() !== (cfg.title || "").trim();
  const paramsDirty = params.trim() !== (cfg.params || "").trim();
  const rawWant = !!(rawOn && rawCapable);
  const rawDirty = rawWant !== !!rawCur;
  const pinDirty = pin !== pinCur;
  const anyDirty = endpointDirty || titleDirty || paramsDirty || rawDirty || wgDirty || pinDirty;
  const wperr = (port.trim() && Number(port) === Number(wgPort)) ? T("The DTLS port and the internal WG port must differ.")
    : portErrMsg(node, port, [lport, wgCur]);
  const rawErr = (!rawOn || !rawCapable) ? ""
    : (port.trim() === String(RAW_PORT) || String(wgPort) === String(RAW_PORT))
      ? T("This server is using port {v1} itself — move its listen or internal WG port before turning RAW on.", { v1: RAW_PORT })
      : "";
  const doSave = async () => {
    const r = await sheetSend(() => api.wdttSet({ node, iface, listen: newListen, wg_port: wgPort, fork, title: title.trim(), params: params.trim(), raw: rawWant, block: cfg.block || [], ...(pinDirty ? { bind_ip: pin } : {}), ...egressBody(egressInit(cfg)) }),
      errMsg(setMsg), setBusy);
    if (!r.ok) return;
    Store.ifaceOp[node + "|" + iface] = { verb: "apply", phase: "busy", started: Date.now() }; Store.apply(); closeAllModals();
    reportDropped(r);
    const mv = ((r.data || {}).raw_moved || "");
    if (mv) toast(T("RAW-IP moved from {v1} to {v2} — one raw listener per address.", { v1: mv, v2: iface }), "ok", 5000);
    Store.poll();
  };
  const save = async () => {
    if (port.trim() && !/^\d+$/.test(port.trim())) return setMsg({ k: "err", t: T("Listen port must be a number.") });
    if (endpointDirty) {
      pushModal(html`<${ConfirmSheet} title=${T("Change the endpoint or port?")} confirmLabel=${T("Apply change")} warn=${true}
        body=${T("This rewrites every user's link — the endpoint and DTLS port are part of it. Existing users must re-import from their subscription page. The server key and users are kept; the server briefly reconnects.")} onConfirm=${doSave}/>`);
      return;
    }
    if (rawErr) return setMsg({ k: "err", t: rawErr });
    if (wgErr) return setMsg({ k: "err", t: wgErr });
    if (rawWant && rawHolder) {
      pushModal(html`<${ConfirmSheet} title=${T("Move RAW-IP to this server?")} confirmLabel=${T("Move RAW here")} warn=${true}
        body=${Trich("*{holder}* offers RAW-IP on this address today. The app dials one fixed port for every server, so an address can only run one raw listener — turning it on here turns it off on *{holder}*. Its users keep their links and fall back to WireGuard mode. Servers on this node's other IPs are untouched.", { holder: rawHolder })} onConfirm=${doSave}/>`);
      return;
    }
    if (paramsDirty || rawDirty || wgDirty || pinDirty) { doSave(); return; }
    const r = await sheetSend(() => api.wdttSet({ node, iface, listen: oldListen, wg_port: wgPort, fork, title: title.trim(), params: params.trim(), raw: rawWant, block: cfg.block || [], ...egressBody(egressInit(cfg)) }),
      errMsg(setMsg), setBusy);
    if (!r.ok) return;
    pushOptTitle("w|" + node + "|" + iface, title.trim());
    closeModal(); Store.poll(); reportDropped(r); toast(T("Title saved."), "ok");
  };
  const control = (verb, icon, label, title) => html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${blocked || awaiting} title=${title} onClick=${() => { startOrRestartWdtt(node, iface, verb); closeModal(); }}><${Ic} i=${icon}/> ${label}</button>`;
  const gear = html`<button class="iconbtn sheet-verset" title=${T("Version, rollback & server defaults for {v1}", { v1: forkPickLabel(fork) })} onClick=${() => openServerDefaults(fork)}><${Ic} i="gear"/></button>`;
  const extras = w.service ? html`<${ProxyDropsHeader} node=${node} svc=${w.service}/><${TurnIpsHeader} node=${node} svc=${w.service}/>` : null;
  const mh = isMobile() ? mTurnHead("WDTT", title.trim() || iface, forkLabel, w.version, gear, extras) : null;
  return html`<${Sheet}
    title=${mh ? mh.title : html`${T("WDTT-proxy")} · ${(title.trim() || iface)} · ${forkLabel}${w.version ? html` <span class="sheet-ver">${w.version}</span>` : ""}${gear}`}
    width=${664}
    headExtra=${mh ? mh.headExtra : extras}
    foot=${footRow({ left: html`<${Fragment}>
        <button class="btn btn-ghost danger" onClick=${() => openModal(html`<${WdttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
        ${notup ? control("start", "play", (isMobile() ? T("rowact|Start") : T("Start service")), T("Bring this WDTT server up on the node"))
          : html`<${Fragment}>${control("stop", "stop", (isMobile() ? T("rowact|Stop") : T("Stop service")), T("Take this WDTT server down (stays down until started)"))}${control("restart", "refresh", (isMobile() ? T("rowact|Restart") : T("Restart service")), T("Bounce this WDTT server on the node"))}<//>`}
      <//>`, onCancel: closeModal, disabled: busy || !anyDirty || !!wperr, onAction: save, action: T("Save") })}>
    ${awaiting ? html`<div class="notice warn"><${Ic} i="shield"/><span>${Trich("This server was wiped. Its identity (server keypair + owner password) is *escrowed in your Encryption Vault*. *Restore* to bring it back with its original identity — no user re-imports.")}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" disabled=${restoring || recreating} onClick=${() => wdttRestoreIdentity(node, iface)}><${Ic} i="shield"/> ${restoring ? T("Restoring…") : T("Restore server identity")}</button>
        <button class="btn btn-ghost" disabled=${restoring || recreating} onClick=${() => wdttRecreateFresh(node, iface)}>${recreating ? T("Recreating…") : T("Recreate fresh")}</button>
      </div></span></div>`
    : html`<${Fragment}>
      <${IfaceThroughput} node=${node} iface=${iface}/>
      <div class="iface-intro" style="margin-top:10px"><div>${T("Changing the endpoint or port rewrites the unit's ExecStart on the node and restarts it — every user's link is re-issued.")}</div></div>
      <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${iface} autocomplete="off"/></div>
      <div class="row2">
        <div class="field"><label>${T("Endpoint host / IP")}</label><${IpPicker} ips=${ips} sel=${hostSel} setSel=${setHostSel} custom=${hostCustom} setCustom=${setHostCustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/><${ListenHint} st=${lst} fallback=${turnDialFallback(node)}/></div>
        <div class="field"><label>${T("Listen port")}</label><input class=${wperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder="56000"/>${wperr ? html`<div class="hint err">${wperr}</div>` : html`<div class="hint">${T("DTLS listen (outside)")}</div>`}</div>
      </div>
      <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
      <${ListenNotice} st=${lst}/>
      <div class="field"><label>${T("Forwards to")}</label><div class="ro-field ro-act"><span class="mono">${iface} · 127.0.0.1:${wgPort}</span> <span class="faint ro-note" title=${T("— self-contained (its own userspace-WireGuard)")}>${T("— self-contained (its own userspace-WireGuard)")}</span><button class="btn btn-mini" disabled=${blocked || awaiting} title=${T("Egress, routing & filters")} onClick=${() => pushModal(html`<${EditWdttSheet} node=${node} iface=${iface}/>`)}><${Ic} i="pencil"/> ${T("Edit interface")}</button></div></div>
      ${
 null}
      <${Disclosure} title=${T("Server parameters")}
        summary=${rawCur ? html`<span class="tg tg-raw">${T("RAW mode on")}</span><span class="faint" style="margin-left:6px">${rawCur}</span>`
                         : html`<span class="faint">${T("tag|advanced")}</span>`}
        open=${srvOpen} onToggle=${() => setSrvOpen(o => !o)}>
        ${rawCapable ? html`<${Fragment}>
          <div class="lbl" style="margin:0 0 6px">${T("RAW-IP mode")}</div>
          <div class="notice warn" style="margin:0 0 12px"><${Ic} i="warn"/><span>${Trich("RAW drops WireGuard's handshake: *no forward secrecy and no replay protection*. Anyone who later learns a peer's password can read traffic they recorded earlier. Turn it on for people who need the speed and accept that.")}</span></div>
          <label class="obfctl" style="margin-bottom:10px"><${Switch} on=${rawOn} onChange=${v => setRawOn(v)}/> <span class="obfctl-lbl">${T("Accept RAW connections")}</span> <span class="tg tg-raw" style="margin-left:8px">${T("port {v1}", { v1: RAW_PORT })}</span></label>
          ${rawErr ? html`<div class="hint err" style="margin-bottom:10px">${rawErr}</div>` : null}
          ${rawOn ? html`<div class="notice" style="margin-bottom:10px"><${Ic} i="info"/><span>${Trich("The user switches connection mode to *raw* in the app — nothing else. The port isn't theirs to set: the app dials *{v1}* for every server and no link or subscription can carry another one, which is why the panel fixes it. Their link keeps working for WireGuard mode.", { v1: RAW_PORT })}</span></div>` : null}
          ${(rawOn && rawHolder) ? html`<div class="notice warn" style="margin-bottom:10px"><${Ic} i="warn"/><span>${Trich("*{v1}* offers RAW on this address today. One address can only run one raw listener, so saving moves it here and turns it off there.", { v1: rawHolder })}</span></div>` : null}
        <//>` : null}
        <div class="lbl" style="margin:${rawCapable ? "18px" : "0"} 0 6px">${T("Internal WireGuard port")}</div>
        <div class="field"><input class=${wgErr ? "bad" : ""} value=${wgIn} onInput=${e => setWgIn(e.target.value)} placeholder="56001" autocomplete="off"/>
          ${wgErr ? html`<div class="hint err">${wgErr}</div>` : html`<div class="hint">${T("Where the DTLS half forwards, on loopback. No client dials it and no link carries it, so changing it only restarts the server — but it must not sit on the RAW port.")}</div>`}</div>
        <div class="lbl" style="margin:18px 0 6px">${T("Extra flags")}</div>
        <p class="hint" style="margin:0 0 12px">${T("Extra command-line flags for this {v1} server. It's self-contained — its real config lives per interface — so there's little here beyond advanced flags.", { v1: forkLabel })}</p>
        <${TurnServerFields} schema=${[]} vals=${{}} setV=${() => {}} extra=${params} setExtra=${setParams} template=${false} wdtt=${true} noHint=${true}/>
      <//>
      ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
    <//>`}
  <//>`;
}
export async function wdttRestoreIdentity(node, iface) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const kb = (nrec.wdtt_vault || {})[iface];
  if (!kb) return toast(T("No escrowed identity is stored for this server."), "err");
  if (!(await ensureVaultUnlocked({
        title: T("Unlock to restore this server's identity"),
        reason: T("This server's original keypair and owner password are escrowed under your encryption key — the panel only ever held the ciphertext. Unlock it to bring the server back exactly as it was, with every existing user config still working."),
        consequence: T("nothing is restored. The server stays down until you unlock the key, or you can Recreate fresh instead — which mints a new server key and makes every user re-import."),
      }))) return;
  try {
    const sealed = await wdttResealForNode(node, kb);
    const r = await api.wdttRestore({ node, iface, sealed_identity: sealed });
    if (!r.ok) return toast(srvText(r) || T("Restore failed."), "err");
    toast(T("Restoring the original server identity — the node applies it on its next sync."), "ok");
    Store.poll();
  } catch (e) { toast(e.message || T("Restore failed."), "err"); }
}
export function wdttRecreateFresh(node, iface) {
  openConfirm({ title: T("Recreate with a fresh identity?"), danger: true, requireType: iface, confirmLabel: T("Recreate fresh"),
    body: Trich("This *abandons the vaulted server identity* and generates a NEW server key for *{iface}*. Every existing user must *re-import* their link. Use this only if the Encryption Vault can't be unlocked. Type *{iface}* to confirm.", { iface }),
    onConfirm: async () => { const r = await api.wdttRecreateFresh({ node, iface });
      toast(r && r.ok ? T("Recreating with a fresh identity — users must re-import.") : (srvText(r) || T("Failed.")), r && r.ok ? "ok" : "err");
      await Store.poll(); } });
}
export function WdttDeleteSheet({ node, iface }) {
  const phrase = T("DELETE {v1}", { v1: iface });
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const del = async () => {
    setBusy(true); setMsg({ k: "work", t: "removing…" });
    const r = await api.wdttDelete({ node, iface });
    if (!r.ok) { setBusy(false); return setMsg({ k: "err", t: srvText(r) || T("Request failed.") }); }
    const _w = ((Store.stats[node] || {}).wdtt || []).find(x => x && x.iface === iface) || {};
    const _c = (((Store.nodes || []).find(n => n.id === node) || {}).wdtt_cfg || {})[iface] || {};
    const _port = String(_w.listen || _c.listen || "").split(":").pop();
    Store.ifaceGone[node + "|" + iface] = { at: Date.now(), type: "wdtt",
      listen: (_w.fork || _c.fork || "wdtt") + (_port ? ":" + _port : ""), subnet: _w.wg_addr || _c.wg_addr || "" };
    closeModal(); Store.apply(); await Store.poll();
    toast(T("WDTT server removed — the node tears it down on its next sync."), "ok");
  };
  return html`<${Sheet} title=${T("Delete WDTT server · {v1}", { v1: iface })}
    foot=${footRow({ onCancel: closeModal, disabled: busy || confirm !== phrase, onAction: del, action: T("Delete server"), danger: true })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${Trich("This stops and removes the WDTT server *{iface}* on this node and disconnects its users. Each user's credential is a password on *this* server, so its peers go with it (a peer also deployed elsewhere keeps those deployments). Type *{iface}* to confirm.", { iface })}</span></div>
    <div class="field"><label>${typeToConfirm(phrase)}</label><input autofocus value=${confirm} onInput=${e => setConfirm(e.target.value)} placeholder=${phrase} autocomplete="off" spellcheck="false"/></div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
export function openEditWdtt(node, iface) { openModal(html`<${EditWdttSheet} node=${node} iface=${iface}/>`); }
export function EditWdttSheet({ node, iface }) {
  useStore();
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cfg = (nrec.wdtt_cfg || {})[iface] || {};
  const w = ((Store.stats[node] || {}).wdtt || []).filter(Boolean).find(x => x.iface === iface) || {};
  const wgAddr = cfg.wg_addr || w.wg_addr || "";
  const oldListen = cfg.listen || w.listen || "";
  const ips = ipChoices(nrec);
  const emode = nrec.routing_mode || "kernel";
  const adopting = (nrec.wdtt_adopting || []).includes(iface);
  const fork = cfg.fork || w.fork || "amurcanov";
  const forkLabel = (turnForkList().find(x => x.id === fork) || {}).label || fork;
  const [wgPort, setWgPort] = useState(String(cfg.wg_port || "56001"));
  const _dtls = oldListen.includes(":") ? oldListen.slice(oldListen.lastIndexOf(":") + 1) : "";
  const wgperr = portErrMsg(node, wgPort, [cfg.wg_port, w.wg_port, _dtls]);
  const [eg, setEg] = useState(() => egressInit(cfg));
  const [blk, setBlk] = useState(() => [...(cfg.block || [])]);
  const [reach, setReach] = useState(cfg.reach || "user");
  const [disc, setDisc] = useState({ routing: true, filters: false });
  const tog = k => setDisc(d => ({ ...d, [k]: !d[k] }));
  const dns = useTurnDns(cfg, fork, w);
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const doSave = async () => {
    const r = await sheetSend(() => api.wdttSet({ node, iface, listen: oldListen, wg_port: wgPort.trim() || "56001", fork, block: blk, reach, ...dns.body, ...egressBody(eg) }),
      errMsg(setMsg), setBusy);
    if (!r.ok) return;
    Store.ifaceOp[node + "|" + iface] = { verb: "apply", phase: "busy", started: Date.now() };
    Store.apply(); closeAllModals();
    reportDropped(r); Store.poll();
  };
  const save = () => {
    const ee = egressSaveBlock(eg, emode); if (ee) return setMsg({ k: "err", t: ee });
    if (dns.err) return setMsg({ k: "err", t: dns.err });
    if (wgPort.trim() && !/^\d+$/.test(wgPort.trim())) return setMsg({ k: "err", t: T("Internal WG port must be a number.") });
    if (!!oldListen && (wgPort.trim() || "56001") !== String(cfg.wg_port || "56001")) {
      pushModal(html`<${ConfirmSheet} title=${T("Change the internal WG port?")} confirmLabel=${T("Apply change")} warn=${true}
        body=${T("This rewrites every user's link — the internal WG port is part of it. Existing users must re-import from their subscription page. The server key and users are kept; the server briefly reconnects.")}
        onConfirm=${doSave}/>`);
      return;
    }
    doSave();
  };
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const awaiting = !!w.await_restore;
  const notup = w.active !== "active" && !awaiting;
  const control = (verb, icon, label, title) => html`<button class="btn btn-ghost" style="margin-left:8px"
    disabled=${blocked || awaiting} title=${title}
    onClick=${() => { startOrRestartWdtt(node, iface, verb); closeModal(); }}><${Ic} i=${icon}/> ${label}</button>`;
  return html`<${Sheet} title=${T("Edit WDTT interface · {v1}", { v1: iface })} width=${720}
    foot=${footRow({ left: html`<${Fragment}>
        <button class="btn btn-ghost danger" onClick=${() => openModal(html`<${WdttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
        ${notup ? control("start", "play", (isMobile() ? T("rowact|Start") : T("Start service")), T("Bring this WDTT server up on the node"))
          : html`<${Fragment}>${control("stop", "stop", (isMobile() ? T("rowact|Stop") : T("Stop service")), T("Take this WDTT server down (stays down until started)"))}${control("restart", "refresh", (isMobile() ? T("rowact|Restart") : T("Restart service")), T("Bounce this WDTT server on the node"))}<//>`}
      <//>`, onCancel: closeModal, disabled: busy || adopting || !!wgperr || !!egressSaveBlock(eg, emode), title: (adopting ? T("This server is being adopted — wait for the node to finish") : wgperr || egressSaveBlock(eg, emode)) || "", onAction: save, action: T("Save") })}>
    ${adopting ? html`<div class="notice"><${Ic} i="clock"/><span>${Trich("This server is being *taken over* right now — its settings are read-only until the node reports the result.")}</span></div>` : null}
    <div class="iface-intro"><div>${Trich("*WDTT* owns its own *WireGuard* interface *({iface} · {addr})* and mints each user's key on connect.", { iface, addr: wgAddr || "—" })}</div></div>
    <div class="row2">
      <div class="field"><label>${T("WDTT server")}</label>
        <div class="ro-field" style="display:flex;align-items:center;gap:10px"><span class="mono">${forkLabel}</span><span class="grow"></span><span class="mono">${oldListen || "—"}</span></div>
        <div class="hint">${T("Fork is set at create. Endpoint & listen port are edited from the WDTT-proxy modal.")}</div></div>
      <div class="field"><label>${T("Internal WG port")}</label><input class=${wgperr ? "bad" : ""} value=${wgPort} onInput=${e => setWgPort(e.target.value)} placeholder="56001"/>${wgperr ? html`<div class="hint err">${wgperr}</div>` : html`<div class="hint">${T("Loopback userspace-WG port (server-internal)")}</div>`}</div>
    </div>
    <${EgressPicker} node=${node} value=${eg} onChange=${setEg} noRules=${true}/>
    ${eg.mode === "smart" ? html`<${Disclosure} title=${rulesTitle(node)} sumCls="route"
      summary=${rulesSummary(node, eg.rows, eg.catchAll)}
      open=${disc.routing} onToggle=${() => tog("routing")}>
      <${RoutingRules} node=${node} iface=${iface} blk=${blk} rows=${eg.rows || []} catchAll=${eg.catchAll} exitIps=${eg.exitIps} directIp=${eg.ip || ""} onChange=${(rows, catchAll, exitIps, ip) => setEg({ ...eg, rows, catchAll, exitIps, ip })}/>
    <//>` : null}
    <${ReachField} node=${node} iface=${iface} value=${reach} onChange=${setReach} unvouched=${(nrec.reach_unvouched || []).includes(iface)} unvouchedRaw=${(nrec.reach_unvouched_raw || []).includes(iface)}/>
    <${Disclosure} title=${T("Filters & abuse")} sumCls="on"
      summary=${blockActiveN(node, blk, eg.p2p) ? T("{v1} active", { v1: blockActiveN(node, blk, eg.p2p) }) : html`<span class="faint">${T("val|none")}</span>`}
      open=${disc.filters} onToggle=${() => tog("filters")}>
      <${BlockTraffic} node=${node} value=${blk} onChange=${setBlk} p2p=${eg.p2p} onP2p=${p => setEg(e => ({ ...e, p2p: p }))}/>
    <//>
    <${Disclosure} title=${T("Advanced settings")} summary=${advSum(eg)}
      open=${disc.advanced} onToggle=${() => tog("advanced")}>
      <${TurnDnsField} node=${node} fork=${fork} rep=${w} dns=${dns} params=${cfg.params || ""}/>
      ${natPinApplies(eg) ? html`<${NatSourcePick} node=${node} value=${eg} onChange=${setEg}/>` : null}
    <//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export const CSQTT_COLOR = "#F97316";

export { CSQTT_DEFAULT_LINE };
export const csqttLineOf = cfg => { const l = String((cfg && cfg.line) || "").trim(); return (Store.csqttLines || []).includes(l) ? l : CSQTT_DEFAULT_LINE; };
export const csqttLinesOn = () => (Store.csqttLines || []).length > 1;
const csqttNodeLines = node => (Store.stats[node] || {}).csqtt_lines || [CSQTT_DEFAULT_LINE];
const csqttLineNote = l => l === CSQTT_DEFAULT_LINE ? T("Stable. For the csqtt {v1} apps, iPhone included.", { v1: l })
  : T("Needs the csqtt {v1} app on every device. No {v2} app connects to it, the iPhone app included.", { v1: l, v2: CSQTT_DEFAULT_LINE });
export function csqttSwitchState(node, iface) {
  const cfg = (((Store.nodes || []).find(n => n.id === node) || {}).csqtt_cfg || {})[iface] || {};
  const c = ((Store.stats[node] || {}).csqtt || []).filter(Boolean).find(x => x.iface === iface) || {};
  const want = csqttLineOf(cfg), run = c.line || CSQTT_DEFAULT_LINE;
  const failed = c.line_failed && c.line_failed.line === want ? c.line_failed : null;
  const moving = want !== run && !failed && !!c.iface;
  const blocked = moving && !csqttNodeLines(node).includes(want);
  return { want, run, failed, blocked, switching: moving && !blocked };
}
export const csqttRunLine = (node, iface) => {
  const s = csqttSwitchState(node, iface);
  const seen = ((Store.stats[node] || {}).csqtt || []).some(x => x && x.iface === iface);
  return seen ? s.run : s.want;
};
export function CsqttVersionField({ node, value, onChange }) {
  if (!csqttLinesOn() && value === CSQTT_DEFAULT_LINE) return null;
  const can = csqttNodeLines(node);
  const ids = (Store.csqttLines || []).includes(value) ? (Store.csqttLines || []) : [...(Store.csqttLines || []), value];
  const opts = ids.map(id => ({ value: id, label: "csqtt " + id,
    ...(id !== value && !can.includes(id) ? { refuse: T("Update this node to run csqtt {v1}.", { v1: id }) } : {}) }));
  const old = !can.some(l => l !== CSQTT_DEFAULT_LINE);
  return html`<div class="field"><label>${T("Version")}</label>
    <${Dropdown} value=${value} onChange=${onChange} options=${opts} ariaLabel=${T("Version")}/>
    <div class="hint">${old ? T("Update this node to run another csqtt version.") : csqttLineNote(value)}</div></div>`;
}
export const csqttArLine = line => (line || CSQTT_DEFAULT_LINE) !== CSQTT_DEFAULT_LINE;
export const csqttArDropAsk = (cfg, line) => !csqttArLine(line) && !!(cfg && (cfg.app_routing || (cfg.app_routing_except || []).length));
function confirmCsqttSwitch(node, iface, cfg, from, to, onConfirm) {
  const n = ghostPeers(node, iface).length;
  const arOn = csqttArDropAsk(cfg, CSQTT_DEFAULT_LINE);
  pushModal(html`<${ConfirmSheet} title=${T("Switch to csqtt {v1}?", { v1: to })} confirmLabel=${T("Switch to {v1}", { v1: to })} warn=${true}
    body=${n ? T("The server restarts on csqtt {v1}. Its {v2} keep their passwords, but every device needs the csqtt {v1} app: a csqtt {v3} app cannot connect to it. If {v1} won't start, the node puts the server back on {v3} by itself.", { v1: to, v2: plural(n, "user"), v3: from })
      : T("The server restarts on csqtt {v1}. If it won't start, the node puts the server back on {v2} by itself.", { v1: to, v2: from })}
    note=${!csqttArLine(to) ? (arOn ? html`<p class="hint">${T("Its App routing is removed: csqtt {v1} has none.", { v1: to })}</p>` : null)
      : !n ? null : html`<p class="hint">${T("The iPhone app (Anton48) does not connect to csqtt {v1}: iPhone users lose access until you switch back.", { v1: to })}</p>`}
    onConfirm=${onConfirm}/>`);
}
export function askCsqttLine(sw, node, iface, cfg, line, go) {
  if (line !== sw.run) { confirmCsqttSwitch(node, iface, cfg, sw.run, line, go); return true; }
  if (csqttArDropAsk(cfg, line)) {
    pushModal(html`<${ConfirmSheet} title=${T("Remove App routing?")} confirmLabel=${T("Remove and save")} warn=${true}
      body=${T("Its App routing is removed: csqtt {v1} has none.", { v1: line })} onConfirm=${go}/>`);
    return true;
  }
  return false;
}
export const csqttPickState = (picked, cfg) => { const cur = csqttLineOf(cfg), line = picked || cur; return { line, lineDirty: line !== cur }; };
export const csqttPickOf = (v, cfg) => (v && v !== csqttLineOf(cfg) ? v : null);
export function useCsqttPick(cfg, pick) {
  const [picked, setPicked] = useState(() => csqttPickOf(pick, cfg));
  return { ...csqttPickState(picked, cfg), setLine: v => setPicked(csqttPickOf(v, cfg)) };
}
export const CsqttLineNotices = ({ sw, dirty }) => dirty ? null : html`
  ${sw.blocked ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This node can't run csqtt {v1}, so the server stays on {v2}. Update the node, or pick {v2}.", { v1: sw.want, v2: sw.run })}</span></div>` : null}
  ${sw.failed ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Switching to csqtt {v1} failed: {v2}. The server is back on {v3}. Restart the service to try again, or pick {v3} to stay there.", { v1: sw.want, v2: sw.failed.why || T("it did not start"), v3: sw.run })}</span></div>` : null}`;

export function CsqttInstanceBody({ node, snap, saveRef, setBusy, setMsg, fail }) {
  const used = (() => {
    const ifaces = new Set(), subs = new Set(), ports = new Set();
    Object.entries(snap.interfaces || {}).forEach(([n, b]) => { const p = parseInt((b.meta || {}).listen_port, 10); if (p) ports.add(p); });
    (snap.turn_proxies || []).forEach(tp => { const p = parseInt(String(tp.listen || "").split(":").pop(), 10); if (p) ports.add(p); });
    (snap.wdtt || []).forEach(w => { if (!w) return; if (w.wg_addr) subs.add(String(w.wg_addr).split("/")[0].split(".").slice(0, 3).join(".")); const lp = parseInt(String(w.listen || "").split(":").pop(), 10); if (lp) ports.add(lp); });
    (snap.csqtt || []).forEach(c => { if (!c) return; if (c.iface) ifaces.add(c.iface); if (c.tun_addr) subs.add(String(c.tun_addr).split("/")[0].split(".").slice(0, 3).join(".")); const lp = parseInt(String(c.listen || "").split(":").pop(), 10); if (lp) ports.add(lp); });
    return { ifaces, subs, ports };
  })();
  const nextIface = (() => { for (let i = 0; i < 1000; i++) if (!used.ifaces.has("csqtt" + i)) return "csqtt" + i; return "csqtt0"; })();
  const nextSubnet = (() => { for (let i = 66; i < 230; i++) { const b = "10.66." + i; if (!used.subs.has(b)) return b + ".1/24"; } return "10.66.67.1/24"; })();
  const [iface, setIface] = useState(nextIface);
  const [subnet, setSubnet] = useState(nextSubnet);
  const [adv, setAdv] = useState(false);
  const [line, setLine] = useState(CSQTT_DEFAULT_LINE);
  saveRef.current = async (lhost, lport, pin) => {
    const _ne = turnIfaceNameError(node, iface, "csqtt"); if (_ne) return fail(_ne);
    if (!/^\d{1,3}(\.\d{1,3}){3}\/24$/.test(subnet.trim())) return fail(T("Subnet must be an IPv4 /24 CIDR (e.g. 10.66.67.1/24)."));
    setBusy(true); setMsg({ k: "work", t: T("creating csqtt server… (the node installs it on its next sync)") });
    const r = await api.csqttSet({ node, iface: iface.trim(), tun_addr: subnet.trim(), listen: lhost + ":" + lport, max_passwords: 500, stopped: false, ...(pin ? { bind_ip: pin } : {}), ...(line !== CSQTT_DEFAULT_LINE ? { line } : {}) });
    if (!r.ok) return fail(srvText(r) || T("Request failed."));
    closeModal(); Store.apply(); await Store.poll();
    toast(T("csqtt server requested — the node installs it on its next sync. Add users from Peers."), "ok");
  };
  return html`<${Fragment}>
    <div class="field"><label>${T("Serves")}</label>
      <div class="selwrap" style="display:flex;align-items:center;justify-content:space-between;opacity:.9">
        <span>${T("Built-in raw-IP tunnel")}</span>
        <span class="mono faint">${iface} · ${subnet}</span>
      </div>
      <div class="hint">${T("csqtt owns its own raw-IP TUN interface — users attach to it directly (no forwards-to). It mints each user's address on connect; add + manage users from Peers.")}</div>
    </div>
    <${CsqttVersionField} node=${node} value=${line} onChange=${setLine}/>
    <${Disclosure} title=${T("Advanced — built-in interface")} open=${adv} onToggle=${() => setAdv(a => !a)}>
      <div class="field"><label>${T("col|Interface")}</label><input value=${iface} onInput=${e => setIface(e.target.value)} placeholder="csqtt1" autocomplete="off"/></div>
      <div class="field"><label>${T("Tunnel subnet")}</label><input value=${subnet} onInput=${e => setSubnet(e.target.value)} placeholder="10.66.67.1/24" autocomplete="off"/>
        <div class="hint">${T("Auto-assigned to avoid collisions with this node's other servers, interfaces, and ports. /24 only.")}</div></div>
    <//>
  <//>`;
}

export function CsqttCard({ node, c, reorder }) {
  const active = c.active === "active";
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const converting = (nrec.proc_status || "").startsWith("converting");
  const nblocked = nodeStale(node) || inProc(nrec.proc_status);
  const rid = "csqtt:" + c.iface;
  const it = reorder ? reorder.item(rid) : null;
  const _op = Store.ifaceOp[node + "|" + c.iface];
  const _opTag = opTag(node + "|" + c.iface);
  const deleting = !!Store.ifaceGone[node + "|" + c.iface];
  const cstopped = !!((nrec.csqtt_cfg || {})[c.iface] || {}).stopped;
  const sw = csqttSwitchState(node, c.iface);
  const tag = deleting ? html`<${StatusTag} cls="tg-del" icon="clock" label="deleting" title=${T("The node tears it down on its next sync")}/>`
    : converting ? html`<${StatusTag} cls="tg-convert" icon="clock" label="converting" title=${T("The node is converting between bare-metal and docker")}/>`
    : _opTag ? _opTag
    : sw.switching ? html`<${StatusTag} cls="tg tg-pending" icon="clock" label=${T("tag|switching")} title=${T("Moving to csqtt {v1} on the node's next sync", { v1: sw.want })}/>`
    : sw.failed ? html`<${StatusTag} cls="tg tg-warn" icon="warn" label=${T("tag|switch failed")} title=${T("Switch to csqtt {v1} failed", { v1: sw.want })} msg=${sw.failed.why || ""}/>`
    : sw.blocked ? html`<${StatusTag} cls="tg tg-warn" icon="warn" label=${T("tag|update node")} title=${T("This node can't run csqtt {v1} — update the node", { v1: sw.want })}/>`
    : active ? null
    : cstopped ? html`<span class="tg-off" title=${T("Stopped from the panel — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
    : html`<${StatusTag} cls="tg tg-pending" icon="clock" label="starting" title=${T("Installing / starting on the node")}/>`;
  const _opBusy = _op && _op.phase === "busy";
  const cdim = deleting || converting || !active || _opBusy;
  const canOpen = !_opBusy && !nblocked && !deleting;
  return html`<div class=${"ifcard tp" + (canOpen ? " clickable" : "") + (cdim ? " down" : "") + (nblocked ? " locked" : "") + (it ? it.cls : "")} data-rid=${it ? it.rid : null} onClick=${() => { if (!canOpen) return; openModal(html`<${CsqttManageSheet} node=${node} c=${c}/>`); }}>
    <div class="ifcard-top">${reorder ? html`<span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.stopPropagation()} ...${reorder.grip(rid)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>` : null}
      <span class="iftype csqtt">CSQTT</span>
      <span class="ifname">${shownTitle("c|" + node + "|" + c.iface, (((nrec.csqtt_cfg || {})[c.iface] || {}).title || "").trim()) || c.iface}</span><span class="grow"></span>
      ${(() => { const conn = wdttConnRows(node, c.iface); return conn.length ? html`<${OnlPop} peer title=${T("Connected to this csqtt server")} cls="ifc-conn" rows=${conn} trigger=${cnt => html`<b class="oncount on">${cnt}</b>`}/>` : null; })()}
      ${tag}
    </div>
    <div class="ifcard-rows">
      <div class="ifrow"><span class="l">${T("CSQTT fork")}</span><span class="r">${forkLabel(c.fork || "csqtt")} ${sw.run}</span></div>
      <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${c.listen || "—"}</span></div>
      <div class="ifrow"><span class="l">${T("Forwards to")}</span><span class="r"><a class="tg tg-csqtt" href=${"#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(c.iface)} onClick=${e => e.stopPropagation()}>${c.iface}</a></span></div>
    </div></div>`;
}

export function CsqttManageSheet({ node, c: c0 }) {
  useStore();
  const iface = c0.iface;
  const c = ((Store.stats[node] || {}).csqtt || []).filter(Boolean).find(x => x.iface === iface) || c0;
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cfg = (nrec.csqtt_cfg || {})[iface] || {};
  const [title, setTitle] = useState(shownTitle("c|" + node + "|" + iface, (cfg.title || "").trim()));
  const [params, setParams] = useState((cfg.params || "").trim());
  const [srvOpen, setSrvOpen] = useState(false);
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const notup = c.active !== "active";
  const ips = ipChoices(nrec);
  const oldListen = cfg.listen || c.listen || "";
  const lhost = oldListen.includes(":") ? oldListen.slice(0, oldListen.lastIndexOf(":")) : oldListen;
  const lport = oldListen.includes(":") ? oldListen.slice(oldListen.lastIndexOf(":") + 1) : "";
  const initHost = lhost || "";
  const [hostSel, setHostSel] = useState(initHost ? (ips.includes(initHost) ? initHost : "__custom__") : (ips[0] || "__custom__"));
  const [hostCustom, setHostCustom] = useState(initHost && !ips.includes(initHost) ? initHost : "");
  const pinCur = cfg.bind_ip || c.bind_ip || "";
  const [pin, setPin] = useState(pinCur);
  const lst = useListenState(node, ipPickerVal(hostSel, hostCustom), lhost, c.bind, pin);
  const [port, setPort] = useState(lport || "");
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const newListen = (ipPickerVal(hostSel, hostCustom).trim() || "0.0.0.0") + ":" + (port.trim() || "46000");
  const endpointDirty = !!oldListen && newListen !== oldListen;
  const titleDirty = title.trim() !== (cfg.title || "").trim();
  const paramsDirty = params.trim() !== (cfg.params || "").trim();
  const pinDirty = pin !== pinCur;
  const { line, setLine, lineDirty } = useCsqttPick(cfg);
  const sw = csqttSwitchState(node, iface);
  const anyDirty = endpointDirty || titleDirty || paramsDirty || pinDirty || lineDirty;
  const wperr = portErrMsg(node, port, [lport]);
  const doSave = async () => {
    const r = await sheetSend(() => api.csqttSet({ node, iface, listen: newListen, title: title.trim(), params: params.trim(), block: cfg.block || [], ...(pinDirty ? { bind_ip: pin } : {}), ...(lineDirty ? { line } : {}), ...egressBody(egressInit(cfg)) }),
      errMsg(setMsg), setBusy);
    if (!r.ok) return;
    Store.ifaceOp[node + "|" + iface] = { verb: "apply", phase: "busy", started: Date.now() }; Store.apply(); closeAllModals();
    reportDropped(r); Store.poll();
  };
  const save = async () => {
    if (port.trim() && !/^\d+$/.test(port.trim())) return setMsg({ k: "err", t: T("Listen port must be a number.") });
    const askEndpoint = () => pushModal(html`<${ConfirmSheet} title=${T("Change the endpoint or port?")} confirmLabel=${T("Apply change")} warn=${true}
        body=${T("This rewrites every user's link — the endpoint and DTLS port are part of it. Existing users must re-import from their subscription page. The server key and users are kept; the server briefly reconnects.")} onConfirm=${doSave}/>`);
    if (lineDirty && askCsqttLine(sw, node, iface, cfg, line, endpointDirty ? askEndpoint : doSave)) return;
    if (endpointDirty) { askEndpoint(); return; }
    if (lineDirty) { doSave(); return; }
    if (paramsDirty || pinDirty) { doSave(); return; }
    const r = await sheetSend(() => api.csqttSet({ node, iface, listen: oldListen, title: title.trim(), params: params.trim(), block: cfg.block || [], ...egressBody(egressInit(cfg)) }),
      errMsg(setMsg), setBusy);
    if (!r.ok) return;
    pushOptTitle("c|" + node + "|" + iface, title.trim());
    closeModal(); Store.poll(); reportDropped(r); toast(T("Title saved."), "ok");
  };
  const control = (verb, icon, label, title) => html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${blocked} title=${title} onClick=${() => { startOrRestartCsqtt(node, iface, verb); closeModal(); }}><${Ic} i=${icon}/> ${label}</button>`;
  const gear = html`<button class="iconbtn sheet-verset" title=${T("Version, rollback & server defaults for {v1}", { v1: "CSQTT" })} onClick=${() => openServerDefaults("csqtt")}><${Ic} i="gear"/></button>`;
  const extras = c.service ? html`<${ProxyDropsHeader} node=${node} svc=${c.service}/><${TurnIpsHeader} node=${node} svc=${c.service}/>` : null;
  const mh = isMobile() ? mTurnHead("CSQTT", title.trim() || iface, "csqtt", c.version, gear, extras) : null;
  return html`<${Sheet}
    title=${mh ? mh.title : html`${T("csqtt-proxy")} · ${(title.trim() || iface)}${c.version ? html` <span class="sheet-ver">${c.version}</span>` : ""}${gear}`}
    width=${664}
    headExtra=${mh ? mh.headExtra : extras}
    foot=${footRow({ left: html`<${Fragment}>
        <button class="btn btn-ghost danger" onClick=${() => openModal(html`<${CsqttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
        ${notup ? control("start", "play", (isMobile() ? T("rowact|Start") : T("Start service")), T("Bring this csqtt server up on the node"))
          : html`<${Fragment}>${control("stop", "stop", (isMobile() ? T("rowact|Stop") : T("Stop service")), T("Take this csqtt server down (stays down until started)"))}${control("restart", "refresh", (isMobile() ? T("rowact|Restart") : T("Restart service")), T("Bounce this csqtt server on the node"))}<//>`}
      <//>`, onCancel: closeModal, disabled: busy || !anyDirty || !!wperr, onAction: save, action: T("Save") })}>
    <${IfaceThroughput} node=${node} iface=${iface}/>
    <div class="iface-intro" style="margin-top:10px"><div>${T("Changing the endpoint or port rewrites the unit's ExecStart on the node and restarts it — every user's link is re-issued.")}</div></div>
    <div class="field"><label>${T("col|Title")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input value=${title} onInput=${e => setTitle(e.target.value)} placeholder=${iface} autocomplete="off"/></div>
    <div class="row2">
      <div class="field"><label>${T("Endpoint host / IP")}</label><${IpPicker} ips=${ips} sel=${hostSel} setSel=${setHostSel} custom=${hostCustom} setCustom=${setHostCustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/><${ListenHint} st=${lst} fallback=${turnDialFallback(node)}/></div>
      <div class="field"><label>${T("Listen port")}</label><input class=${wperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder="46000"/>${wperr ? html`<div class="hint err">${wperr}</div>` : html`<div class="hint">${T("DTLS listen (outside)")}</div>`}</div>
    </div>
    <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
    <${ListenNotice} st=${lst}/>
    <${CsqttVersionField} node=${node} value=${line} onChange=${setLine}/>
    <${CsqttLineNotices} sw=${sw} dirty=${lineDirty}/>
    <div class="field"><label>${T("Forwards to")}</label><div class="ro-field ro-act"><span class="mono">${iface} · ${c.tun_addr || "raw TUN"}</span> <span class="faint ro-note" title=${T("— self-contained (its own raw-IP tunnel)")}>${T("— self-contained (its own raw-IP tunnel)")}</span><button class="btn btn-mini" disabled=${blocked} title=${T("Egress, routing & filters")} onClick=${() => pushModal(html`<${EditCsqttSheet} node=${node} iface=${iface} pick=${lineDirty ? line : null}/>`)}><${Ic} i="pencil"/> ${T("Edit interface")}</button></div></div>
    <${Disclosure} title=${T("Server parameters")} summary=${html`<span class="faint">${T("tag|advanced")}</span>`} open=${srvOpen} onToggle=${() => setSrvOpen(o => !o)}>
      <p class="hint" style="margin:0 0 12px">${T("Extra command-line flags for this csqtt server. It's self-contained — its real config lives per interface — so there's little here beyond advanced flags.")}</p>
      <${TurnServerFields} schema=${[]} vals=${{}} setV=${() => {}} extra=${params} setExtra=${setParams} template=${false} wdtt=${true} noHint=${true}/>
    <//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function CsqttDeleteSheet({ node, iface }) {
  const phrase = T("DELETE {v1}", { v1: iface });
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  const del = async () => {
    setBusy(true); setMsg({ k: "work", t: "removing…" });
    const r = await api.csqttDelete({ node, iface });
    if (!r.ok) { setBusy(false); return setMsg({ k: "err", t: srvText(r) || T("Request failed.") }); }
    Store.ifaceGone[node + "|" + iface] = { at: Date.now(), type: "csqtt" };
    closeAllModals(); Store.apply(); await Store.poll();
    toast(T("csqtt server removed — the node tears it down on its next sync."), "ok");
  };
  return html`<${Sheet} title=${T("Delete csqtt server · {v1}", { v1: iface })}
    foot=${footRow({ onCancel: closeModal, danger: true, disabled: busy || confirm !== phrase, onAction: del, action: T("Delete server") })}>
    <div class="notice warn"><${Ic} i="shield"/><span>${Trich("This removes the *{iface}* csqtt server and *unassigns + deletes* every user on it — their credential is a password on this server, so it means nothing once the server is gone. Type *{iface}* to confirm.", { iface })}</span></div>
    <div class="field"><label>${typeToConfirm(phrase)}</label><input autofocus value=${confirm} onInput=${e => setConfirm(e.target.value)} placeholder=${phrase} autocomplete="off" spellcheck="false"/></div>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

const AR_LINES = s => String(s || "").split(/[\s,;]+/).filter(Boolean);
export const arInit = cfg => { const a = (cfg && cfg.app_routing) || {};
  return { apps_mode: a.apps_mode || "all", domains_mode: a.domains_mode || "direct", ips_mode: a.ips_mode || "direct",
           template_domains: !!a.template_domains,
           packages: (a.packages || []).join("\n"), domains: (a.domains || []).map(idnHost).join("\n"), ips: (a.ips || []).join("\n") }; };
export const arBody = a => ({ apps_mode: a.apps_mode, packages: AR_LINES(a.packages),
  domains_mode: a.domains_mode, domains: AR_LINES(a.domains), template_domains: a.domains_mode === "direct" && !!a.template_domains,
  ips_mode: a.ips_mode, ips: AR_LINES(a.ips) });
const AR_ANY = s => /[^\s,;.*]/.test(s || "");
const arOn = a => { const on = [];
  if (a.apps_mode === "only" || (a.apps_mode === "except" && AR_ANY(a.packages))) on.push(T("Apps"));
  if (AR_ANY(a.domains) || a.domains_mode === "tunnel") on.push(T("Domains"));
  if (a.domains_mode === "direct" && a.template_domains) on.push(T("built-in list"));
  if (AR_ANY(a.ips) || a.ips_mode === "tunnel") on.push(T("Addresses"));
  return on; };
const arSummary = a => { const on = arOn(a);
  return on.length ? on.join(", ") : html`<span class="faint">${T("val|none")}</span>`; };
function AppRoutingFields({ value: a, onChange }) {
  const set = (k, v) => onChange({ ...a, [k]: v });
  const list = (k, ph, hint) => html`<textarea class="ta" rows="3" spellcheck="false" autocomplete="off" placeholder=${ph} style="margin-top:8px"
      value=${a[k]} onInput=${e => set(k, e.target.value)}></textarea><div class="hint">${hint}</div>`;
  const where = [{ value: "direct", label: T("These go direct") }, { value: "tunnel", label: T("Only these use the tunnel") }];
  return html`<div class="field"><label>${T("Apps")}</label>
      <${Dropdown} value=${a.apps_mode} onChange=${v => set("apps_mode", v)} ariaLabel=${T("Apps")} options=${[
        { value: "all", label: T("Every app uses the tunnel") }, { value: "except", label: T("Every app except these") },
        { value: "only", label: T("Only these apps") }]}/>
      ${a.apps_mode === "all" ? null : list("packages", "org.telegram.messenger", T("Android app IDs, one per line — the part after id= in the app's Google Play link."))}</div>
    <div class="field"><label>${T("Domains")}</label>
      <${Dropdown} value=${a.domains_mode} onChange=${v => set("domains_mode", v)} ariaLabel=${T("Domains")} options=${where}/>
      ${list("domains", "ya.ru\ngosuslugi.ru", T("One per line. Subdomains are included."))}
      ${a.domains_mode === "direct" ? html`<div style="display:flex;align-items:center;gap:10px;margin-top:8px">
        <${Switch} on=${a.template_domains} onChange=${v => set("template_domains", v)}/>
        <span>${T("Also the built-in list of Russian sites (about 500 domains)")}</span></div>` : null}</div>
    <div class="field"><label>${T("Addresses")}</label>
      <${Dropdown} value=${a.ips_mode} onChange=${v => set("ips_mode", v)} ariaLabel=${T("Addresses")} options=${where}/>
      ${list("ips", "149.154.160.0/20\n91.108.4.0-91.108.7.255", T("One IPv4 address, network or range (a-b) per line."))}</div>`;
}

const AR_EXC_MAX = 20;
export const arxEntry = (sel, own, ar) => ({ who: Object.fromEntries(["users", "groups", "peers"].filter(k => (sel[k] || []).length).map(k => [k, sel[k]])),
  app_routing: own && arOn(ar).length ? arBody(ar) : null });
export const arxSend = ax => ax.map(({ who, app_routing }) => ({ who, app_routing }));
const arxGone = e => e.k === "g" ? !Store.group(e.id) : e.k === "u" ? !Store.user(e.id) : !Store.peer(e.id);
const arxNobody = who => whoEntries(who || {}).every(arxGone);
const arxWho = who => namedFew(whoEntries(who || {}).map(whoEntryName));
const arxWhoRow = who => { const es = whoEntries(who || {});
  return html`${es.slice(0, 3).map((e, i) => html`${i ? ", " : ""}${e.k === "g" ? html`<${Ic} i="users"/>` : e.k === "p" ? html`<${Ic} i="device"/>` : null}${whoEntryName(e)}`)}${
    es.length > 3 ? html`<span class="faint"> ${T("and {n} more", { n: es.length - 3 })}</span>` : null}`; };
function ArExceptions({ node, iface, value, onChange }) {
  const rs = useReorder(value.map(e => e._id), ids => onChange(ids.map(id => value.find(e => e._id === id))), "y", { container: ".arx-list", card: ".arx-row" });
  const edit = e => pushModal(html`<${ArExceptionSheet} node=${node} iface=${iface} entry=${e}
    onApply=${ne => onChange(e ? value.map(x => x._id === e._id ? { ...ne, _id: e._id } : x) : [...value, { ...ne, _id: newGid() }])}/>`);
  const snap = Store.stats[node];
  return html`<div class="field arx"><label>${T("Exceptions")}</label>
    ${value.length ? html`<div class="arx-list" ...${rs.container()}>${value.map((e, i) => { const it = rs.item(e._id), nobody = arxNobody(e.who);
      return html`<div key=${e._id} class=${"arx-row" + it.cls} data-rid=${it.rid}>
        <span class="drag-grip" title=${T("Drag to reorder")} ...${rs.grip(e._id)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>
        <span class=${"arx-who" + (nobody ? " none" : "")} title=${nobody ? "" : arxWho(e.who)}><span class="arx-n">${i + 1}.</span>${nobody
          ? T("nobody — they no longer exist") : arxWhoRow(e.who)}</span>
        <span class=${"arx-rule" + (e.app_routing ? "" : " none")}>${e.app_routing
          ? html`${T("Own rule")}: ${arSummary(arInit({ app_routing: e.app_routing }))}` : T("No App routing")}</span>
        <button type="button" class="btn btn-ghost btn-mini" title=${T("Edit exception")} aria-label=${T("Edit exception")} onClick=${() => edit(e)}><${Ic} i="pencil"/></button>
        <button type="button" class="btn btn-ghost btn-mini" title=${T("Remove exception")} aria-label=${T("Remove exception")}
          onClick=${() => onChange(value.filter(x => x !== e))}><${Ic} i="x"/></button></div>`; })}</div>` : null}
    <button type="button" class="btn btn-ghost arx-add" disabled=${value.length >= AR_EXC_MAX}
      title=${value.length >= AR_EXC_MAX ? T("At most {v1} exceptions.", { v1: AR_EXC_MAX }) : ""} onClick=${() => edit(null)}><${Ic} i="plus"/>${T("Add exception")}</button>
    <div class="hint">${T("Chosen people get their own rule, or none. A device's exception beats its user's, and a user's beats a group's; a person in two groups gets the upper one. Applies at each user's next connect.")}</div>
    ${value.length && snap && !snap.csqtt_ar_pw ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("Exceptions need a node update — until then everyone gets the server rule.")}</span></div>` : null}
  </div>`;
}
function ArExceptionSheet({ node, iface, entry, onApply }) {
  useStore();
  const [sel, setSel] = useState(() => canonWho((entry || {}).who || {}));
  const [own, setOwn] = useState(!!(entry && entry.app_routing));
  const [ar, setAr] = useState(() => arInit({ app_routing: entry && entry.app_routing }));
  const dirtyRef = useRef(false), closeRef = useRef(null), cleanRef = useRef(null), base = useRef(null);
  const key = JSON.stringify(arxEntry(sel, own, ar));
  if (base.current === null) base.current = key;
  dirtyRef.current = key !== base.current;
  const typedOnly = () => { if (cleanRef.current) cleanRef.current(); };
  const here = peersOn(node, iface);
  const empty = !whoCount(sel);
  const apply = () => { if (empty) return;
    onApply(arxEntry(sel, own, ar)); dirtyRef.current = false; if (cleanRef.current) cleanRef.current(); closeModal(); };
  const cell = e => { const m = e.k === "g" ? (Store.group(e.id) || {}).users || [] : null;
    const n = here.filter(p => e.k === "p" ? p.id === e.id : e.k === "u" ? p.user_id === e.id : !!p.user_id && m.includes(p.user_id)).length;
    return html`<span class=${"netdev" + (n ? "" : " none")} title=${n ? T("{devices} on this server", { devices: plural(n, "device") }) : ""}>${n
      ? html`<span class="netdev-n ok">${n}</span>` : T("no device here")}</span>`; };
  return html`<${Sheet} title=${entry ? T("Edit exception") : T("Add exception")} width=${680} dirtyRef=${dirtyRef} closeRef=${closeRef} cleanRef=${cleanRef}
    foot=${footRow({ onCancel: () => (closeRef.current ? closeRef.current() : closeModal()), onAction: apply, action: T("Apply"), disabled: empty,
                     title: empty ? T("Choose at least one person, group or device.") : "" })}>
    <div class="field"><label>${T("For whom")}</label>
      <${WhoPicker} sel=${sel} setSel=${setSel} here=${here} cell=${cell} onTyped=${typedOnly} empty=${T("Choose at least one person, group or device.")}/></div>
    <div class="field"><label>${T("App routing")}</label>
      <div class="dpsw netsw-share" role="radiogroup" aria-label=${T("App routing")}>${[[false, T("No App routing")], [true, T("Own rule")]].map(([v, l]) => html`<button type="button" role="radio"
        aria-checked=${own === v} class=${own === v ? "on" : ""} onClick=${() => setOwn(v)}>${l}</button>`)}</div>
      <div class="hint">${own ? T("Used instead of the server's rule.") : T("Everything they send uses the tunnel, whatever the server's rule says.")}</div></div>
    ${own ? html`<${AppRoutingFields} value=${ar} onChange=${setAr}/>` : null}
  <//>`;
}

export function openEditCsqtt(node, iface) { openModal(html`<${EditCsqttSheet} node=${node} iface=${iface}/>`); }
export function EditCsqttSheet({ node, iface, pick }) {
  useStore();
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const cfg = (nrec.csqtt_cfg || {})[iface] || {};
  const c = ((Store.stats[node] || {}).csqtt || []).filter(Boolean).find(x => x.iface === iface) || {};
  const tunAddr = cfg.tun_addr || c.tun_addr || "";
  const [reach, setReach] = useState(cfg.reach || "user");
  const oldListen = cfg.listen || c.listen || "";
  const emode = nrec.routing_mode || "kernel";
  const [eg, setEg] = useState(() => egressInit(cfg));
  const [blk, setBlk] = useState(() => [...(cfg.block || [])]);
  const [disc, setDisc] = useState({ routing: true, filters: false });
  const tog = k => setDisc(d => ({ ...d, [k]: !d[k] }));
  const dns = useTurnDns(cfg, c.fork || cfg.fork || "csqtt", c);
  const [ar, setAr] = useState(() => arInit(cfg));
  const [ax, setAx] = useState(() => (Array.isArray(cfg.app_routing_except) ? cfg.app_routing_except : []).map(e => ({ ...e, _id: newGid() })));
  const arKey = useRef(null), axKey = useRef(null), dirtyRef = useRef(false), closeRef = useRef(null);
  const arNow = JSON.stringify(arBody(ar)), axNow = JSON.stringify(arxSend(ax));
  if (arKey.current === null) { arKey.current = arNow; axKey.current = axNow; }
  const { line, setLine, lineDirty } = useCsqttPick(cfg, pick);
  const clickKey = useRef(null), clickNow = JSON.stringify([reach, egressBody(eg), [...(blk || [])].sort()]);
  if (clickKey.current === null) clickKey.current = clickNow;
  dirtyRef.current = arNow !== arKey.current || axNow !== axKey.current || clickNow !== clickKey.current || !!lineDirty;
  const sw = csqttSwitchState(node, iface);
  const is25 = csqttArLine(lineDirty ? line : cfg.line);
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const doSave = async () => {
    const r = await sheetSend(() => api.csqttSet({ node, iface, listen: oldListen, block: blk, reach, ...dns.body, ...egressBody(eg),
      ...(lineDirty ? { line } : {}), ...(is25 && arNow !== arKey.current ? { app_routing: arBody(ar) } : {}),
      ...(is25 && axNow !== axKey.current ? { app_routing_except: arxSend(ax) } : {}) }), errMsg(setMsg), setBusy);
    if (!r.ok) return;
    Store.ifaceOp[node + "|" + iface] = { verb: "apply", phase: "busy", started: Date.now() }; Store.apply(); closeAllModals();
    reportDropped(r); Store.poll();
  };
  const save = () => { const ee = egressSaveBlock(eg, emode); if (ee) return setMsg({ k: "err", t: ee });
    if (dns.err) return setMsg({ k: "err", t: dns.err });
    if (lineDirty && askCsqttLine(sw, node, iface, { ...cfg, app_routing: arOn(ar).length ? arBody(ar) : null, app_routing_except: ax }, line, doSave)) return;
    doSave(); };
  const blocked = (Store.recon.nodeStatus[node] !== "live") || inProc(nrec.proc_status);
  const notup = c.active !== "active";
  const control = (verb, icon, label, title) => html`<button class="btn btn-ghost" style="margin-left:8px"
    disabled=${blocked} title=${title}
    onClick=${() => { startOrRestartCsqtt(node, iface, verb); closeModal(); }}><${Ic} i=${icon}/> ${label}</button>`;
  return html`<${Sheet} title=${T("Edit csqtt interface · {v1}", { v1: iface })} width=${720} dirtyRef=${dirtyRef} closeRef=${closeRef}
    foot=${footRow({ left: html`<${Fragment}>
        <button class="btn btn-ghost danger" onClick=${() => openModal(html`<${CsqttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
        ${notup ? control("start", "play", (isMobile() ? T("rowact|Start") : T("Start service")), T("Bring this csqtt server up on the node"))
          : html`<${Fragment}>${control("stop", "stop", (isMobile() ? T("rowact|Stop") : T("Stop service")), T("Take this csqtt server down (stays down until started)"))}${control("restart", "refresh", (isMobile() ? T("rowact|Restart") : T("Restart service")), T("Bounce this csqtt server on the node"))}<//>`}
      <//>`, onCancel: () => (closeRef.current ? closeRef.current() : closeModal()), disabled: busy || !!egressSaveBlock(eg, emode), title: egressSaveBlock(eg, emode) || "", onAction: save, action: T("Save") })}>
    <div class="iface-intro"><div>${Trich("*csqtt* owns its own raw-IP tunnel *({iface} · {addr})* and mints each user's address on connect.", { iface, addr: tunAddr || "—" })}</div></div>
    <div class="row2">
      <div class="field"><label>${T("csqtt server")}</label>
        <div class="ro-field" style="display:flex;align-items:center;gap:10px"><span class="mono">${cfg.title || "csqtt"}</span><span class="grow"></span><span class="mono">${oldListen || "—"}</span></div>
        <div class="hint">${T("Endpoint & listen port are edited from the csqtt-proxy modal.")}</div></div>
      <${CsqttVersionField} node=${node} value=${line} onChange=${setLine}/>
    </div>
    <${CsqttLineNotices} sw=${sw} dirty=${lineDirty}/>
    <${EgressPicker} node=${node} value=${eg} onChange=${setEg} noRules=${true}/>
    ${eg.mode === "smart" ? html`<${Disclosure} title=${rulesTitle(node)} sumCls="route"
      summary=${rulesSummary(node, eg.rows, eg.catchAll)}
      open=${disc.routing} onToggle=${() => tog("routing")}>
      <${RoutingRules} node=${node} iface=${iface} blk=${blk} rows=${eg.rows || []} catchAll=${eg.catchAll} exitIps=${eg.exitIps} directIp=${eg.ip || ""} onChange=${(rows, catchAll, exitIps, ip) => setEg({ ...eg, rows, catchAll, exitIps, ip })}/>
    <//>` : null}
    <${ReachField} node=${node} iface=${iface} value=${reach} onChange=${setReach} unvouched=${(nrec.reach_unvouched || []).includes(iface)}/>
    <${Disclosure} title=${T("Filters & abuse")} sumCls="on"
      summary=${blockActiveN(node, blk, eg.p2p) ? T("{v1} active", { v1: blockActiveN(node, blk, eg.p2p) }) : html`<span class="faint">${T("val|none")}</span>`}
      open=${disc.filters} onToggle=${() => tog("filters")}>
      <${BlockTraffic} node=${node} value=${blk} onChange=${setBlk} p2p=${eg.p2p} onP2p=${p => setEg(e => ({ ...e, p2p: p }))}/>
    <//>
    ${is25 ? html`<${Disclosure} title=${T("App routing")} open=${disc.approuting} onToggle=${() => tog("approuting")}
      summary=${ax.length ? html`${arSummary(ar)}<span class="faint"> + ${plural(ax.length, "exception")}</span>` : arSummary(ar)}>
      <${AppRoutingFields} value=${ar} onChange=${setAr}/>
      <${ArExceptions} node=${node} iface=${iface} value=${ax} onChange=${setAx}/>
    <//>` : null}
    <${Disclosure} title=${T("Advanced settings")} summary=${advSum(eg)}
      open=${disc.advanced} onToggle=${() => tog("advanced")}>
      <${TurnDnsField} node=${node} fork=${c.fork || cfg.fork || "csqtt"} rep=${c} dns=${dns} params=${cfg.params || ""}/>
      ${natPinApplies(eg) ? html`<${NatSourcePick} node=${node} value=${eg} onChange=${setEg}/>` : null}
    <//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}

export function ForkTag({ fork, suffix, title }) {
  if (!fork) return null;
  const col = turnColor(fork) || WDTT_COLOR;
  const fk = turnForkList().find(x => x.id === fork) || {};
  const label = forkLabel(fork);
  const defTitle = fk.kind === "csqtt" ? T("CSQTT fork: {v1}", { v1: label }) : T("WDTT fork: {v1}", { v1: label });
  return html`<span class="tg" style=${"color:" + col + ";background:color-mix(in srgb," + col + " 16%,transparent)"}
    title=${title || defTitle}>${label}${suffix || ""}</span>`;
}