import { openLogs, NODE_SOURCES } from "./journal.js";
import { $, esc, seen, dur, ago, fmtBytes, tkey, ipOf, portOf, listenAddr, panelNowS, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { go } from "./router.js";
import { pickThemed, NODE_COLOR_DEFAULT, toThemed, themeMode } from "./theme.js";
import { kindOf, iTypeOf, targetType, nodeStale, nodeStatusOf, lastHeard, ifaceNotUp, wdttOn, ghostIface, ghostPeers, turnDown,
         turnProxiesFor, ifaceIsAwg, kindLabel, platformLabel, scKindByName, awgDict3, awg3Cls, awg3Tip, tip3 } from "./model.js";
import { turnFork, turnColor, turnForkList, forkLabel, forkProduct, forkPickLabel } from "./turn-catalog.js";
import {
  Ic, ICON, Tag, Panel, Badge, StatusTag, CmdErr, Sheet, footRow, secTitle, SearchBox, Switch, Dropdown,
  Popover, Portal, toast, copy, mutate, openModal, pushModal, closeModal, openConfirm, ConfirmSheet,
  opTag, procTag, procErr, inProc, procFailed, procSuccess, procAborted, isUpdateState, procInClass,
  dismissNodeProc, dismissHostProc, statusLabel, LogBody, logRaw, useReorder, GRIP_SVG,
  orderById, rowSingle, rowDouble, rowNoSelect, RowError, goSettings, ifaceReady, ifaceWasBusy, ifaceFlash,
  trackIfaceOps, StoreOffBanner, ifaceColor, meshGenColor, meshGenLabel, dlul, ifopBusy, applyThemeMode, paintThemeBtn,
  rate, awgSwitchTag, rateCell,
} from "./ui.js";
import { T, Trich, Tsplit, plural, pluralWord, srvText, srvVars } from "./i18n.js";
import { Sparkline, MiniArea, MultiRing, RingLegend, TrendArea, TrendSpark, RankBars, RangeTabs,
         RangedHistory, ThroughputChart, OnlineBlocks, cpuColor, histTime, ChartHover, IfaceThroughput,
         RANGE_CAP, axisCap, lossColorMesh } from "./charts.js";
import { orphCount, OnlinePeersTag, OnlineUsersTag, MeshStat, meshHealth, DropsPop, DropsFigure, dropsEnough, LossPop, onlineUserRows, onlinePeerRows,
         serviceIssues, recentActivity, evItem, evAction, evClick, evDecorate, dashState, DASH_RANGES, reachSkipText, reachStaleText } from "./views.js";
import { TurnProxiesBlock, turnEnabled, WdttCard, WDTT_COLOR, ForkTag, ifaceTurnBadges, openEditWdtt, openEditCsqtt,
         openSetupTurn, wdttRecreateFresh, wdttRestoreIdentity, WdttDeleteSheet, csqttRunLine } from "./turn.js";
import { PeerGrid, NodeRail, NodesRailPanel } from "./grids.js";
import { openCreateIface, openEditIface, openConnectionEdit, OrphanRow } from "./iface.js";
import { ifTrafficBadge } from "./routing.js";
import { openNodeCreate, openNodeEdit, openNodeRemove, openNodeRotate, unflagNode } from "./sheets-crud.js";
import { confirmRestoreInterface, confirmRestoreAllInterfaces, openRecreateRekey } from "./peer-actions.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

function fullUpdateIntro(side) {
  const [a, b] = Tsplit("For a {what} — including third-party components (docker / wg-awg / turn-proxies) — run this on the {side} box:", "what", { side });
  return html`<${Fragment}>${a}<b>${T("full, controlled update")}</b>${b}<//>`;
}
function autoUpdateIntro(side) {
  const one = T("For an {what}, press {press} below. This also {repairs} the {side} box — reinstalls anything missing, re-enables services, and rebuilds the datapath (e.g. the AmneziaWG kernel module) — so it's worth running even when you're already up to date.", { side });
  const [a, r1] = [one.split("{what}")[0], one.split("{what}").slice(1).join("{what}")];
  const [b, r2] = [r1.split("{press}")[0], r1.split("{press}").slice(1).join("{press}")];
  const [c, d] = [r2.split("{repairs}")[0], r2.split("{repairs}").slice(1).join("{repairs}")];
  return html`<${Fragment}>${a}<b>${T("automatic update of SWG components only")}</b>${b}<b>${T("Update now")}</b>${c}<b>${T("repairs")}</b>${d}<//>`;
}
function declUpdateIntro(side, hasCmd) {
  const [a, b] = hasCmd
    ? Tsplit("This box's installation comes from its {what}, so an update is a rebuild of it — run this on the {side} box:", "what", { side })
    : Tsplit("This box's installation comes from its {what}, so an update is a rebuild of it — do that on the {side} box, however that configuration is applied.", "what", { side });
  return html`<${Fragment}>${a}<b>${T("own configuration")}</b>${b}<//>`;
}
function declAutoIntro(auto) {
  if (!auto) return html`<${Fragment}>${Trich("There is no rebuild wired to this button on this host, so it can't start one — that is deliberate: a button that reported success and changed nothing would be worse. Set the module's *selfUpdate* option to wire it, or run the command above.")}<//>`;
  return html`<${Fragment}>${Trich("*Update now* asks this host to rebuild itself from that configuration. What it lands on is whatever the configuration's lock pins, so refresh the swg input first if you want a newer version — and the rebuild's own errors come back here if it fails.")}<//>`;
}
function updatedFromTo(from, to) {
  const one = T("The panel was updated from {from} to {to}.");
  const [a, r1] = [one.split("{from}")[0], one.split("{from}").slice(1).join("{from}")];
  const [b, c] = [r1.split("{to}")[0], r1.split("{to}").slice(1).join("{to}")];
  return html`<${Fragment}>${a}<b>v${from}</b>${b}<b>v${to}</b>${c}<//>`;
}
function entryServersRun() {
  const [a, b] = Tsplit("All servers run {daemon}, which syncs to this panel over HTTPS — the node needs no inbound access.", "daemon");
  return html`<${Fragment}>${a}<span class="mono">swg-noded</span>${b}<//>`;
}

function goneSentence(text, ok, verdict) {
  const [before, after] = [text.split("{verdict}")[0], text.split("{verdict}").slice(1).join("{verdict}")];
  return html`<${Fragment}>${before}<span class=${ok ? "mi-ok" : "mi-bad"}>${verdict}</span>${after}<//>`;
}

function platformPill(nrec) {
  if (!nrec || !nrec.platform) return null;
  const decl = !!nrec.declarative, i = nrec.platform_info || {};
  const tone = decl ? "nix" : "os";
  const head = i.name || (platformLabel(nrec.platform) + (i.version ? " " + i.version : ""));
  return html`<${Popover} hoverOnly cls="platwrap" popCls="osbub" trigger=${html`
      <span class=${"tport " + tone}>${platformLabel(nrec.platform)}</span>`}>
    <span class="osbub-h" style=${"color:var(--tport-" + tone + ")"}>${head}</span>
    ${i.kernel ? html`<span class="osbub-r"><span class="osbub-k">${T("Kernel")}</span><span class="osbub-v">${i.kernel}</span></span>` : null}
    ${nrec.arch ? html`<span class="osbub-r"><span class="osbub-k">${T("Architecture")}</span><span class="osbub-v">${nrec.arch}</span></span>` : null}
  <//>`;
}

export function HealthDot({ issues, i18n }) {
  if (!issues || !issues.length) return null;
  const n = issues.length;
  const line = i => (i18n && i18n[i]) ? srvText(i18n[i]) : issues[i];
  const trigger = html`<span class="badge b-issue ic"><${Ic} i="warn"/>${plural(n, "nom|issue")}</span>`;
  return html`<${Popover} cls="onlinetag bare healthpop" trigger=${trigger}>
    <div class="onpop-h">${T("{v1} on this node", { v1: plural(n, "nom|issue") })}</div>
    ${issues.map((it, i) => html`<div class="onrow hrow"><span class="on-name">${line(i)}</span></div>`)}
  </${Popover}>`;
}

export function NodeDetail({ node: rawName }) {
  const name = decodeURIComponent(rawName);
  const node = Store.node(name);
  const nrec = Store.nodes.find(x => x.id === name) || {};
  const meta = Store.describe[name] || null;
  const metaErr = node && !meta;

  const seenRef = useRef(false);
  useEffect(() => { if (node) seenRef.current = true; else if (seenRef.current) go("#/nodes"); }, [node]);

  const meshPfx = (nrec.mesh_prefix || (Store.panelSettings || {}).reserved?.iface_prefix || "swg_");
  const isSysName = k => k.startsWith(meshPfx) || k.startsWith("swg_");
  const isSysIface = k => (meta[k] && meta[k].system) || isSysName(k);
  const userKeys = meta ? Object.keys(meta).filter(k => !isSysIface(k)) : [];
  const _unmanaged = new Set(nrec.unmanaged_ifaces || []);
  const ifaceIds = nodeIfaces(name, { gone: true }).map(x => x.ifn);
  const ifReorder = useReorder(ifaceIds, ids => mutate({
    patch: s => { const nn = (s.nodes || []).find(x => x.id === name); if (nn) nn.iface_order = ids; },
    call: () => api.saveOrder({ kind: "iface", node: name, order: ids }),
  }));

  if (!node) return html`<div class="screen"><div class="crumb"><a href="#/nodes">${T("col|Nodes")}</a><span class="sep">/</span><b>${name}</b></div>
    <div class="empty"><b>${T("Unknown server")}</b>${T("this server isn't in the fleet.")}</div></div>`;
  const dname = node.name || name;

  const live = Store.recon.nodeStatus[name] === "live";
  const blocked = !live || inProc(nrec.proc_status);
  const snap = Store.stats[name];
  const hasTurns = !!((snap && (snap.turn_proxies || []).length) || Object.keys(nrec.turn_pending || {}).length);
  const wdttIfaces = (snap && snap.wdtt || []).filter(w => w && w.iface);
  const hasWdtt = wdttIfaces.length > 0;
  const csqttIfaces = (snap && snap.csqtt || []).filter(c => c && c.iface);
  const hasCsqtt = csqttIfaces.length > 0;
  const canFrontTurn = userKeys.some(k => (meta[k] || {}).listen_port);
  const here = Store.recon.peers.filter(p => p.targets.some(t => t.node === name));
  const onl = here.filter(p => p.targets.some(t => t.node === name && t.online)).length;
  let nrx = 0, ntx = 0; if (snap) for (const blk of Object.values(snap.interfaces || {})) for (const pp of blk.peers || []) { nrx += pp.rx_speed || 0; ntx += pp.tx_speed || 0; }
  if (snap) for (const w of (snap.wdtt || [])) { nrx += w.rx_speed || 0; ntx += w.tx_speed || 0; }
  if (snap) for (const c of (snap.csqtt || [])) { nrx += c.rx_speed || 0; ntx += c.tx_speed || 0; }
  let syncTxt = T("no snapshot yet");
  const _seenAt = lastHeard(nrec, snap);
  if (_seenAt) { const a = Math.floor(panelNowS() - _seenAt); syncTxt = live ? T("{ago} ago", { ago: seen(a) }) : T("stale for {ago}", { ago: seen(a) }); }

  return html`<div class="screen">
    <${NodeRail} active=${name}/>
    <div class="crumb"><a href="#/nodes">${T("col|Nodes")}</a><span class="sep">/</span><b>${dname}</b></div>
    <div class="detail-head">
      <div class="title"><h1>${dname}</h1>${nrec.kind ? html`<span class=${"tport " + nrec.kind}>${kindLabel(nrec.kind, nrec.runtime)}</span>` : null}${platformPill(nrec)}${nrec.uninstalled ? html`<span class="nstat uninst"><${Ic} i="info"/> ${T("tag|uninstalled")}</span>` : live ? html`<span class="reporting">${T("reporting")}</span>` : nrec.status === "dangling" ? html`<span class="nstat enroll"><${Ic} i="clock"/> ${T("awaiting enroll")}</span>` : html`<span class="nstat stale"><${Ic} i="info"/> ${T("stale")}</span>`}${nrec.proc_status && !isUpdateState(nrec.proc_status) ? procTag(nrec.proc_status, () => dismissNodeProc(nrec.id), procErr(nrec), !live && nrec.status === "dangling") : null}<${HealthDot} issues=${nrec.issues} i18n=${nrec.issues_i18n}/></div>
      <div class="grow"></div>
      <div class="dh-ver">
        ${nrec.version && !nrec.uninstalled ? html`<span class=${"nm-ver" + (nrec.ahead ? " out" : "")} title=${nrec.ahead ? T("Node is running a newer version than the panel — update the panel to catch up") : ""}>v${nrec.version}</span>` : null}
        <span class="dh-sep"></span>
        <button class="iconbtn" disabled=${blocked} data-lbl=${T("Settings")} title=${blocked ? T("Unavailable while the node is down / converting") : T("Node settings")} onClick=${() => openNodeEdit(nrec)}><${Ic} i="gear"/></button>
        <button class="iconbtn" data-lbl=${T("Logs")} title=${T("This node's live logs")} onClick=${() => openLogs({ nodes: [nrec.id], src: NODE_SOURCES })}><${Ic} i="doc"/></button>
        ${
 null}
        ${isMobile() ? html`<button class="iconbtn" data-lbl=${T("More")} title=${T("More")} onClick=${() => openModal(html`<${NodeMoreSheet} id=${nrec.id}/>`)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>` : html`<${Fragment}>
        <button class="iconbtn" title=${nrec.status === "dangling" ? T("Rotate token and get a new install command") : T("Rotate token")} onClick=${() => openNodeRotate(nrec)}><${Ic} i="key"/></button>
        <button class="iconbtn danger" title=${nrec.removing ? T("Force remove node") : T("Remove node")} onClick=${() => openNodeRemove(nrec)}><${Ic} i="trash"/></button>
        <//>`}
      </div>
    </div>

    ${!snap ? html`<div class="node-nodata"><${Ic} i="activity"/><p>${T("This node isn't sending any data right now")}</p></div>` : html`<div class="noderibbon">
      <div class="nr-tags">
        ${isMobile() ? ifaceSummary(name, turnEnabled() ? nodeTurns(name).length : 0) : html`${nodeIfaces(name).map(x => IfaceTag(name, x))}
        ${turnEnabled() ? nodeTurns(name).map(tp => TurnTag(name, tp)) : null}`}
      </div>
      <span class="grow"></span>
      <div class="nr-sync"><span class="when">${syncTxt}</span>${nrec.health && nrec.health.uptime != null ? html`<span class="when">${T("up {v1}", { v1: dur(nrec.health.uptime) })}</span>` : null}</div>
    </div>

    ${nrec.health ? html`<${NodeHealthPanel} name=${name} nrec=${nrec}/>` : null}

    ${nrec.health_history ? html`<${NodeThroughput} name=${name} nrec=${nrec}/>` : null}

    <${NodeLanPanel} nrec=${nrec}/>

    ${(nrec.mesh_peers || []).length ? html`<${Panel} icon="network" title=${T("Node connections")} tone="pending" count=${(nrec.mesh_peers || []).length}
        actions=${html`<${MeshStat} nodeId=${name} mode="in"/>`}>
      <div class="ifgrid">${[...(nrec.mesh_peers || [])].sort((a, b) => Store.byNode(a.peer, b.peer)).map(mp => {
        const peer = mp.peer;
        const ifn = mp.iface;
        const m = (ifn && meta) ? meta[ifn] : null;
        const col = Store.nodeColor(peer);
        const reprov = !!mp.reprovisioning || (!!ifn && !m);
        const lk = reprov ? "reprov" : (nodeStale(name) || nodeStale(peer)) ? "down" : (!m || m.handshake_age == null ? "connecting" : (m.handshake_age < 180 ? "up" : "down"));
        const lkTitle = { up: T("Link up"), connecting: T("Connecting…"), down: T("Link down") }[lk];
        const muted = lk === "down" || reprov;
        const carried = reprov ? [] : userKeys.filter(k => meta[k].egress_mode === "forward" && meta[k].egress_node === peer);
        const smartCarried = reprov ? [] : userKeys.filter(k => meta[k].egress_mode === "smart" && (meta[k].routing || []).some(r => r.action === "exit" && r.node === peer));
        const _lkErr = ifn ? (nrec.cmd_errors || {})[ifn] : null;
        const canOpen = !reprov && !!ifn && !blocked;
        return html`<div key=${peer} class=${"ifcard tp" + (canOpen ? " clickable" : "") + (muted ? " down" : "") + (blocked ? " locked" : "")} onClick=${canOpen ? () => openConnectionEdit(name, ifn) : null}>
          <div class="ifcard-top"><span class="iftype turn" style=${"--tfc:" + col}><${Ic} i="server"/></span><span class="ifname">${Store.nodeName(peer)}</span><span class="grow"></span>${smartCarried.length ? html`<span class="egb egb-smart" title=${T("Smart cascade: routes selected destinations out via {node}", { node: Store.nodeName(peer) })}><${Ic} i="cascade"/>${T("smart cascade")}</span>` : carried.length ? html`<span class="egb egb-cascade" title=${T("Cascade: relays {v1} out via {v2}", { v1: plural(carried.length, "interface"), v2: Store.nodeName(peer) })}><${Ic} i="cascade"/>${T("tag|cascade")}</span>` : null}${_lkErr ? html`<${CmdErr} err=${_lkErr}/>` : null}${(!reprov && !blocked && (_lkErr || lk === "down")) ? html`<button class="mi-restore" title=${T("Rebuild this link under a new interface name — for a name, address or port that clashes with something else on that server")}
              onClick=${e => { e.preventDefault(); e.stopPropagation(); openConfirm({
                title: T("Re-provision this node's mesh links?"), confirmLabel: T("Re-provision"), warn: true,
                body: T("{v1} will briefly drop off the mesh (and any cascade/smart traffic routed through it pauses) until every peer pulls the new config and reconnects — usually a few seconds. Other nodes' links to each other are unaffected.", { v1: Store.nodeName(name) }),
                onConfirm: async () => { const r = await api.nodeRemesh({ id: name });
                  toast(r && r.ok ? T("Rebuilding this node's mesh links…") : (srvText(r) || T("Couldn't re-provision the mesh links.")), r && r.ok ? "ok" : "err");
                  if (r && r.ok) await Store.poll(); } }); }}><${Ic} i="refresh"/> ${T("Re-provision")}</button>` : null}${reprov ? html`<span class="tg tg-busy" title=${T("Rebuilding this node's mesh link — it reconnects in a few seconds")}><${Ic} i="clock"/>${T("tag|re-provisioning")}</span>` : html`<span class=${"lkdot " + lk} title=${lkTitle}></span>`}</div>
          <div class="ifcard-rows">
            <div class="ifrow"><span class="l">${T("col|Endpoint")}</span><span class="r addr">${(m && m.peer_endpoint) || "—"}</span></div>
            <div class="ifrow"><span class="l">${T("Tunnel")}</span><span class="r addr">${(m && m.subnet) || "—"}</span></div>
            <div class="ifrow"><span class="l">${T("Type")}</span><span class="r">${mp.type_set || mp.awg_set ? html`<span class="faint" style="margin-right:6px">${mp.type_set && mp.awg_set
              ? T("type and AWG params set on this link") : mp.type_set ? T("set on this link") : T("AWG params set on this link")}</span>` : null}<span class="tg-proto" style=${"--c:" + meshGenColor(mp.type)}>${meshGenLabel(mp.type)}</span></span></div>
            ${(() => {
              const _lk = m && m.link;
              if (!_lk || _lk.rtt_ms == null) return null;
              const _ls = typeof _lk.loss === "number" ? _lk.loss : null;
              const _pl = ((meshHealth(name).peers.find(x => x.peer === peer)) || {}).plink || null;
              const _warn = _ls != null && _ls > 0;
              const _val = html`<${Fragment}>${Math.round(_lk.rtt_ms)}${T("unit|ms")}${_warn
                ? html` <span class="dp-num" style=${"color:" + lossColorMesh(_ls)}>${T("(Loss {v1}%)", { v1: _ls })}</span>` : null}<//>`;
              return html`<div class="ifrow"><span class="l">${T("col|Latency")}</span><span class="r addr"
                onClick=${e => { e.preventDefault(); e.stopPropagation(); }}><${LossPop} l=${_lk} pl=${_pl}
                  peerName=${Store.nodeName(peer)} node=${name} iface=${ifn} trigger=${_val}/></span></div>`;
            })()}
            ${carried.length ? html`<div class="ifrow"><span class="l">${T("Carrying")}</span><span class="r"><span class="carry-tags">${carried.map(k => html`<span class=${"tg tg-" + ((meta[k].awg_params && Object.keys(meta[k].awg_params).length) ? "awg" : "wg") + awg3Cls(name, k)} ...${awg3Tip(name, k)}>${k}</span>`)}</span></span></div>` : null}
          </div></div>`;
      })}</div>
    <//>` : null}

    <${Panel} icon="globe" title=${T("User interfaces")} tone="ready" count=${userKeys.length + wdttIfaces.length + Object.keys(nrec.wdtt_cfg || {}).filter(ifn => !wdttIfaces.some(w => w.iface === ifn)).length + csqttIfaces.length + Object.keys(nrec.csqtt_cfg || {}).filter(ifn => !csqttIfaces.some(c => c.iface === ifn)).length}
        actions=${html`<${Fragment}>${(() => { const mr = Object.values(nrec.missing_ifaces || {}).filter(mi => mi && mi.ripe).length; return mr ? html`<button class="btn btn-mini restore" title=${T("Recreate this node's missing interfaces with their original identities — node-rebuild recovery")} onClick=${() => confirmRestoreAllInterfaces(name)}><${Ic} i="refresh"/> ${mr > 1 ? T("Restore {v1}", { v1: plural(mr, "interface") }) : T("Restore interface")}</button>` : null; })()}${turnEnabled() && nrec.turn_manage && !hasTurns && !hasWdtt && !hasCsqtt && canFrontTurn ? html`<button class="btn btn-mini" disabled=${blocked || nrec.turn_arch_ok === false} title=${blocked ? T("Unavailable while the node is down / converting") : nrec.turn_arch_ok === false ? T("No turn-proxy build for this node's architecture{arch} — only amd64 and arm64 are supported.", { arch: nrec.arch ? " (" + nrec.arch + ")" : "" }) : T("Set up the node's first turn-proxy")} onClick=${() => openSetupTurn(name)}><${Ic} i="plus"/> ${isMobile() ? T("New proxy") : T("Setup turn-proxy")}</button>` : null}${isMobile() ? html`<button class="btn btn-mini ico" title=${T("These interfaces' live logs")} onClick=${() => openLogs({ nodes: [nrec.id], src: ["iface:*"] })}><${Ic} i="doc"/></button>` : null}<button class="btn btn-mini ico" title=${T("Interface defaults in Settings → Interfaces")} onClick=${() => goSettings("defaults")}><${Ic} i="gear"/></button><button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down / converting") : ""} onClick=${() => openCreateIface(name)}><${Ic} i="plus"/> ${isMobile() ? T("rowact|New") : T("Create new interface")}</button><//>`}>
      ${(() => {
        const pcard = (ifn, label, type) => html`<div class="ifcard pending" key=${label + ":" + ifn}>
          <div class="ifcard-top"><span class=${"iftype " + (type || "turn")}>${type || T("tag|load")}</span><span class="ifname">${ifn}</span><span class="grow"></span>${(() => {
              const _ce = (nrec.cmd_errors || {})[ifn];
              const _held = (nrec.awaiting_key || []).includes(ifn);
                return html`<${CmdErr} err=${_ce}/><${StatusTag}
                cls=${_ce ? "tg tg-warn" : _held ? "tg tg-pending" : "tg-busy"} icon=${_ce ? "warn" : _held ? "shield" : "clock"}
                label=${_ce ? T("tag|failed") : _held ? T("tag|needs the vault") : (label === "creating" ? T("tag|creating") : T("tag|onboarding"))}
                title=${_ce ? T("The node could not set it up — open the error for what to do")
                  : _held ? T("The node is waiting rather than minting a new key: unlock the Encryption Vault and restore this interface, and every existing client config keeps working")
                  : T("Setting it up on the node")}/>`;
            })()}</div>
          <div class="ifcard-rows"><div class="ifrow"><span class="l faint">${(nrec.cmd_errors || {})[ifn]
              ? T("the node refused — open the error above")
              : (nrec.awaiting_key || []).includes(ifn) ? T("waiting for the Encryption Vault — its original key is escrowed")
              : label === "creating" ? T("the node is creating it…") : T("the node is adding it…")}</span>${html`<button class="btn btn-mini warn" title=${T("Drop this pending request")} onClick=${() => mutate({ key: "ifcancel:" + name + "|" + ifn, call: () => api.ifaceCancel({ node: name, iface: ifn }) })}>${T("Cancel")}</button>`}</div>${html`<${RowError} k=${"ifcancel:" + name + "|" + ifn}/>`}</div></div>`;
        const optIfCard = (ifn, e) => html`<div class="ifcard down" key=${"new:" + ifn}>
          <div class="ifcard-top"><span class=${"iftype " + (e.type || "turn") + (e.gen === "3.1" ? " awg3" : "")} ...${tip3(e.gen === "3.1")}>${e.type || T("tag|load")}</span><span class="ifname">${ifn}</span><span class="grow"></span>${(() => {
              const _ce = (nrec.cmd_errors || {})[ifn];
              return html`<${CmdErr} err=${_ce}/><${StatusTag}
                cls=${_ce ? "tg tg-warn" : "tg-busy"} icon=${_ce ? "warn" : "clock"}
                label=${_ce ? T("tag|failed") : (e.type ? T("tag|creating") : T("tag|onboarding"))}
                title=${_ce ? T("The node could not set it up — open the error for what to do") : T("Setting it up on the node")}/>`;
            })()}<button class="xbtn" title=${T("Cancel this request")} onClick=${() => { delete Store.ifaceNew[name + "|" + ifn]; mutate({ key: "ifcancel:" + name + "|" + ifn, call: () => api.ifaceCancel({ node: name, iface: ifn }) }); }}><${Ic} i="x"/></button></div>
          <div class="ifcard-rows">
            ${(e.endpoint || e.port) ? html`<div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${(e.endpoint || "") + (e.port ? ":" + e.port : "") || "—"}</span></div>` : null}
            ${e.subnet ? html`<div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${e.subnet}</span></div>` : null}
            <${RowError} k=${"ifcancel:" + name + "|" + ifn}/></div></div>`;
        const delCard = (ifn, g) => { const _m = (meta && meta[ifn]) || {};
          const _w = wdttIfaces.find(w => w.iface === ifn);
          const _t = g.type || (_w ? "wdtt" : (_m.awg_params && Object.keys(_m.awg_params).length) ? "awg" : "wg");
          const _port = _w ? String(_w.listen || "").split(":").pop() : "";
          return html`<div class=${"ifcard pending down"} key=${"del:" + ifn}>
            <div class="ifcard-top"><span class=${"iftype " + _t + (_t === "awg" && (g.gen3 || awgDict3(_m.awg_params)) ? " awg3" : "")} ...${tip3(_t === "awg" && (g.gen3 || awgDict3(_m.awg_params)))}>${_t === "wdtt" ? "WDTT" : _t}</span><span class="ifname">${ifn}</span><span class="grow"></span><${CmdErr} err=${(nrec.cmd_errors || {})[ifn]}/><${StatusTag} cls="tg-del" icon="clock" label="deleting" title=${T("The node tears it down on its next sync")}/></div>
            <div class="ifcard-rows">
              <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${g.listen || (_w
                ? (_w.fork || "wdtt") + (_port ? ":" + _port : "")
                : (_m.endpoint || ((_m.address || "").split("/")[0] + (_m.listen_port ? ":" + _m.listen_port : "")))) || "—"}</span></div>
              <div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${g.subnet || (_w ? _w.wg_addr : _m.subnet) || "—"}</span></div>
              <div class="ifrow"><span class="l faint">${T("the node is tearing it down…")}</span></div>
            </div></div>`; };
        const _pfx = name + "|";
        const _wLive = new Set([...((Store.stats[name] || {}).wdtt || []), ...((Store.stats[name] || {}).csqtt || [])].filter(w => w && w.iface).map(w => w.iface));
        const _reported = i => (meta && meta[i]) || _wLive.has(i);
        for (const k of Object.keys(Store.ifaceNew)) {
          if (!k.startsWith(_pfx)) continue;
          const i = k.slice(_pfx.length);
          if (_reported(i)) { ifaceReady[name + "|" + i] = Date.now() + 5000; delete Store.ifaceNew[k]; }
          else if (Date.now() - (Store.ifaceNew[k].at || 0) > 900000) delete Store.ifaceNew[k];
        }
        const optNames = Object.keys(Store.ifaceNew).filter(k => k.startsWith(_pfx)).map(k => k.slice(_pfx.length));
        const _stillOnNode = i => _reported(i) || !!(nrec.wdtt_cfg || {})[i] || !!(nrec.csqtt_cfg || {})[i];
        for (const k of Object.keys(Store.ifaceGone)) {
          if (!k.startsWith(_pfx)) continue;
          const i = k.slice(_pfx.length);
          if (!_stillOnNode(i)) delete Store.ifaceGone[k];
          else if (Date.now() - (Store.ifaceGone[k].at || 0) > 900000) delete Store.ifaceGone[k];
        }
        const goneNames = Object.keys(Store.ifaceGone).filter(k => k.startsWith(_pfx)).map(k => k.slice(_pfx.length));
        const cr = nrec.creating || {};
        const pendCr = Object.keys(cr).filter(ifn => !_reported(ifn) && !optNames.includes(ifn) && !isSysName(ifn));
        const optCards = optNames.filter(ifn => !_reported(ifn)).map(ifn => optIfCard(ifn, Store.ifaceNew[_pfx + ifn]));
        const pending = pendCr.concat(optNames);
        pending.forEach(ifn => { ifaceWasBusy[name + "|" + ifn] = true; });
        pending.push(...goneNames);
        const pcards = pendCr.map(ifn => pcard(ifn, "creating", cr[ifn]))
          .concat(optCards);
        const mcard = (ifn, mi) => { const mtype = (mi.awg_params && Object.keys(mi.awg_params).length) ? "awg" : "wg";
          const sentence = mi.key_source
            ? goneSentence(T("The node no longer reports interface {iface} (subnet {subnet}). {verdict}, so Restore recreates it cleanly — no client changes.",
                { iface: ifn, subnet: mi.subnet || "?" }), true, T("Its original server key is recoverable"))
            : goneSentence(T("The node no longer reports interface {iface} (subnet {subnet}). {verdict}, so Restore recreates it with a new key — clients re-import.",
                { iface: ifn, subnet: mi.subnet || "?" }), false, T("Its original server key can't be recovered"));
          return html`<a class="ifcard missing" key=${"missing:" + ifn} href=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)} title=${T("Open the interface (read-only) — peers, saved config, and Restore")}>
            <div class="ifcard-top"><span class=${"iftype " + mtype + (awgDict3(mi.awg_params) ? " awg3" : "")} ...${tip3(awgDict3(mi.awg_params))}>${mtype}</span><span class="ifname">${ifn}</span><span class="grow"></span>
              <button class="mi-restore" disabled=${blocked || !mi.ripe} title=${mi.ripe ? T("Recreate this interface with its original identity — recovers every peer on it") : T("Confirming it's really gone (a couple of minutes) before Restore is offered")} onClick=${e => { e.preventDefault(); e.stopPropagation(); confirmRestoreInterface(name, ifn, mi); }}><${Ic} i="refresh"/> ${T("Restore")}</button>
              <${StatusTag} cls="tg-del" icon="warn" label="missing" title=${T("This interface is gone from the node")}/></div>
            <div class="ifcard-rows"><div class="mi-text">${sentence}</div></div></a>`; };
        const gcard = (ifn, g) => { const gp = ghostPeers(name, ifn);
          return html`<a class="ifcard ghost" key=${"ghost:" + ifn} href=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)} title=${T("Open the interface (read-only) — recreate & rekey")}>
            <div class="ifcard-top"><span class="iftype gh">${T("tag|gone")}</span><span class="ifname">${ifn}</span><span class="grow"></span>
              <button class="mi-restore ghost" disabled=${blocked || !g.ripe} title=${g.ripe ? T("Recreate this interface with a NEW key and rekey every peer on it (clients re-import)") : T("Confirming it's really gone (a couple of minutes) before Recreate is offered")} onClick=${e => { e.preventDefault(); e.stopPropagation(); openRecreateRekey(name, ifn); }}><${Ic} i="refresh"/> ${T("Recreate")}</button>
              <${StatusTag} cls="tg-del" icon="warn" label="ghost" title=${T("Gone with no recoverable key — recreate fresh + rekey")}/></div>
            <div class="ifcard-rows"><div class="mi-text">${goneSentence(T("The node no longer reports {iface}, and {verdict} — there's nothing to restore. Recreate it with a new key; {count} get fresh configs to re-import.", { iface: ifn, count: plural(gp.length, "peer") }), false, T("its server key can't be recovered"))}</div></div></a>`; };
        const wmcard = (ifn, wc) => { const vaulted = !!((nrec.wdtt_vault || {})[ifn]);
          const restoring = (nrec.wdtt_restoring || []).includes(ifn);
          const fork = wc.fork || "amurcanov";
          const dtls = String(wc.listen || "").split(":").pop() || "";
          const ifn0 = ifn;
          const nerr = (nrec.cmd_errors || {})[ifn] || "";
          const never = !!nerr && !vaulted;
          const sentence = never
            ? T("The node refused to install WDTT server {iface}: {err}", { iface: ifn, err: T(nerr) })
            : vaulted
            ? goneSentence(T("The node no longer reports WDTT server {iface} (subnet {subnet}). {verdict}, so Restore brings it back unchanged — no user re-imports.",
                { iface: ifn, subnet: wc.wg_addr || "?" }), true, T("Its identity is escrowed in your Encryption Vault"))
            : goneSentence(T("The node no longer reports WDTT server {iface} (subnet {subnet}). {verdict}, so it can only come back with a new key — every user re-imports.",
                { iface: ifn, subnet: wc.wg_addr || "?" }), false, T("No escrowed identity is stored"));
          return html`<a class=${"ifcard missing" + (never ? " failed" : "")} key=${"wdtt-missing:" + ifn} href=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)} title=${never ? T("This server was never installed — remove it or fix the cause") : T("Open the WDTT server (read-only) — details and Restore")}>
            <div class="ifcard-top"><span class="iftype wdtt">WDTT</span><span class="ifname">${ifn}</span><span class="grow"></span>
              ${never ? null : html`<button class="mi-restore" disabled=${blocked || restoring} title=${vaulted ? T("Bring this WDTT server back with its original identity — no user re-imports") : T("Recreate this WDTT server with a NEW identity — every user re-imports")}
                onClick=${e => { e.preventDefault(); e.stopPropagation(); vaulted ? wdttRestoreIdentity(name, ifn) : wdttRecreateFresh(name, ifn); }}><${Ic} i=${vaulted ? "shield" : "refresh"}/> ${restoring ? T("Restoring…") : vaulted ? T("Restore") : T("Recreate")}</button>`}
              <button class="mi-restore danger" disabled=${blocked} title=${T("Remove this WDTT server from the panel")}
                onClick=${e => { e.preventDefault(); e.stopPropagation(); openModal(html`<${WdttDeleteSheet} node=${name} iface=${ifn}/>`); }}><${Ic} i="trash"/> ${T("Delete")}</button>
              <${StatusTag} cls="tg-del" icon="warn" label=${never ? T("not installed") : "missing"} title=${never ? nerr : T("This WDTT server is gone from the node")}/></div>
            <div class="ifcard-rows"><div class="mi-text">${sentence}</div></div></a>`; };
        const wmcards = Object.entries(nrec.wdtt_cfg || {})
          .filter(([ifn]) => !wdttIfaces.some(w => w.iface === ifn) && !pending.includes(ifn))
          .map(([ifn, wc]) => wmcard(ifn, wc || {}));
        const mcards = Object.entries(nrec.missing_ifaces || {})
          .filter(([ifn, mi]) => mi.key_source && !(meta && meta[ifn]) && !pending.includes(ifn) && !isSysName(ifn))
          .map(([ifn, mi]) => mcard(ifn, mi));
        const _gset = {};
        for (const ifn of Object.keys(nrec.ghost_ifaces || {})) if (!(meta && meta[ifn]) && !pending.includes(ifn) && !isSysName(ifn)) _gset[ifn] = 1;
        for (const [ifn, mi] of Object.entries(nrec.missing_ifaces || {})) if (!mi.key_source && !(meta && meta[ifn]) && !pending.includes(ifn) && !isSysName(ifn)) _gset[ifn] = 1;
        const gcards = Object.keys(_gset).map(ifn => [ifn, ghostIface(name, ifn)]).filter(([, g]) => g).map(([ifn, g]) => gcard(ifn, g));
        const wcard = w => {
          const active = w.active === "active"; const awaiting = !!w.await_restore;
          const restoring = (nrec.wdtt_restoring || []).includes(w.iface);
          const fork = w.fork || "amurcanov";
          const wcfg = (nrec.wdtt_cfg || {})[w.iface] || {};
          const dtls = String(w.listen || "").split(":").pop() || "";
          const ifn0 = w.iface;
          const ps = here.filter(p => p.targets.some(t => t.node === name && t.iface === w.iface));
          const onlc = ps.filter(p => p.targets.some(t => t.node === name && t.iface === w.iface && t.online)).length;
          const _wop = Store.ifaceOp[name + "|" + w.iface];
          const _wopTag = opTag(name + "|" + w.iface);
          const wconverting = (nrec.proc_status || "").startsWith("converting");
          const idim = wconverting || awaiting || restoring || !active || (_wop && _wop.phase === "busy");
          const href = "#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(w.iface);
          const it = ifReorder.item(w.iface);
          const badge = html`<span class="iftype wdtt">WDTT</span><span class="ifname">${w.iface}</span>`;
          return html`<a key=${"wdtt-if:" + w.iface} class=${"ifcard" + (idim ? " down" : "") + (blocked ? " locked" : "") + it.cls} href=${href} draggable=${false} data-rid=${it.rid}>
            <div class="ifcard-top"><span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.preventDefault()} ...${ifReorder.grip(w.iface)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>${(blocked || (_wop && _wop.phase === "busy")) ? badge
              : html`<button class="ifc-edit" title=${T("Edit WDTT server · {v1}", { v1: w.iface })} onClick=${e => { e.preventDefault(); e.stopPropagation(); openEditWdtt(name, w.iface); }}>${badge}<span class="ifc-pic"><${Ic} i="pencil"/></span></button>`}<span class="grow"></span><${ForkTag} fork=${fork}/>${wconverting
                ? html`<${StatusTag} cls="tg-convert" icon="clock" label="converting" title=${T("The node is converting between bare-metal and docker")}/>`
                : _wopTag
                ? _wopTag
                : awaiting
                ? html`<${StatusTag} cls="tg-busy del" icon="shield" label=${T("Restore")} title=${T("Server wiped — its identity is escrowed; open to Restore or Recreate fresh")}/>`
                : restoring ? html`<span class="tg tg-busy"><${Ic} i="clock"/>${T("tag|restoring")}</span>`
                : !(nrec.wdtt_cfg || {})[w.iface] ? html`<span class="tg tg-pending" title=${T("This panel holds no record of this {v1} server, though the node still has it — so nothing starts it, its users aren't in the roster, and a rebuild can't bring it back.", { v1: "WDTT" })}><${Ic} i="info"/>${T("tag|unclaimed")}</span>`
                : active ? null
                : wcfg.stopped ? html`<span class="tg-off" title=${T("Stopped by you — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
                : html`<span class="tg tg-busy"><${Ic} i="clock"/>${T("tag|starting")}</span>`}</div>
            <div class="ifcard-rows">
              <div class="ifrow"><span class="l">${T("Listen (local)")}</span><span class="r addr">${ifn0}${dtls ? ":" + dtls : ""}</span></div>
              <div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${w.wg_addr || "—"}</span></div>
              <div class="ifrow"><span class="l">${T("Traffic")}</span><span class="r">${ifTrafficBadge(wcfg, name)}</span></div>
              <div class="ifrow"><span class="l">${T("Peers reachable by")}</span><span class="r">${reachChip(name, w.iface, wcfg.reach)}</span></div>
              <div class="ifrow"><span class="l">${T("Peers")}</span><span class="r">${ps.length
                ? html`<${OnlinePeersTag} nodeId=${name} iface=${w.iface} orphans=${0} orphHref=${href}
                    trigger=${() => html`<b class=${"oncount" + (onlc ? " on" : "")}>${onlc}</b><span class="faint">/${ps.length}</span>`}/>`
                : html`<span class="faint">${T("None")}</span>`}</span></div>
            </div></a>`; };
        const cmcard = (ifn, cc) => (html`<a class="ifcard down" key=${"csqtt-cfg:" + ifn} href=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)} title=${T("Open the csqtt server — details and settings")}>
          <div class="ifcard-top"><span class="iftype csqtt">CSQTT</span><span class="ifname">${(cc.title || "").trim() || ifn}</span><span class="grow"></span>
            ${cc.stopped ? html`<span class="tg-off" title=${T("Stopped by you — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
              : html`<${StatusTag} cls="tg tg-pending" icon="clock" label="starting" title=${T("The node brings it up on its next sync")}/>`}</div>
          <div class="ifcard-rows">
            <div class="ifrow"><span class="l">${T("Listen (local)")}</span><span class="r addr">${ifn + (portOf(cc.listen) ? ":" + portOf(cc.listen) : "")}</span></div>
            <div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${cc.tun_addr || "—"}</span></div>
            <div class="ifrow"><span class="l faint">${T("waiting for the node to bring it up…")}</span></div>
          </div></a>`);
        const cmcards = Object.entries(nrec.csqtt_cfg || {})
          .filter(([ifn]) => !csqttIfaces.some(c => c.iface === ifn) && !pending.includes(ifn))
          .map(([ifn, cc]) => cmcard(ifn, cc || {}));
        const csqCard = c => {
          const active = c.active === "active";
          const ccfg = (nrec.csqtt_cfg || {})[c.iface] || {};
          const ps = here.filter(p => p.targets.some(t => t.node === name && t.iface === c.iface));
          const onlc = ps.filter(p => p.targets.some(t => t.node === name && t.iface === c.iface && t.online)).length;
          const _cop = Store.ifaceOp[name + "|" + c.iface];
          const _copTag = opTag(name + "|" + c.iface);
          const cconverting = (nrec.proc_status || "").startsWith("converting");
          const idim = cconverting || !active || (_cop && _cop.phase === "busy");
          const href = "#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(c.iface);
          const it = ifReorder.item(c.iface);
          const badge = html`<span class="iftype csqtt">CSQTT</span><span class="ifname">${c.iface}</span>`;
          return html`<a key=${"csqtt-if:" + c.iface} class=${"ifcard" + (idim ? " down" : "") + (blocked ? " locked" : "") + it.cls} href=${href} draggable=${false} data-rid=${it.rid}>
            <div class="ifcard-top"><span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.preventDefault()} ...${ifReorder.grip(c.iface)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>${(blocked || (_cop && _cop.phase === "busy")) ? badge
              : html`<button class="ifc-edit" title=${T("Edit csqtt server · {v1}", { v1: c.iface })} onClick=${e => { e.preventDefault(); e.stopPropagation(); openEditCsqtt(name, c.iface); }}>${badge}<span class="ifc-pic"><${Ic} i="pencil"/></span></button>`}<span class="grow"></span><${ForkTag} fork=${c.fork || "csqtt"} suffix=${" " + csqttRunLine(name, c.iface)}/>${cconverting
                ? html`<${StatusTag} cls="tg-convert" icon="clock" label="converting" title=${T("The node is converting between bare-metal and docker")}/>`
                : _copTag ? _copTag
                : !(nrec.csqtt_cfg || {})[c.iface] ? html`<span class="tg tg-pending" title=${T("This panel holds no record of this {v1} server, though the node still has it — so nothing starts it, its users aren't in the roster, and a rebuild can't bring it back.", { v1: "csqtt" })}><${Ic} i="info"/>${T("tag|unclaimed")}</span>`
                : active ? null
                : ccfg.stopped ? html`<span class="tg-off" title=${T("Stopped by you — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>`
                : html`<span class="tg tg-busy"><${Ic} i="clock"/>${T("tag|starting")}</span>`}</div>
            <div class="ifcard-rows">
              <div class="ifrow"><span class="l">${T("Listen (local)")}</span><span class="r addr">${c.iface + (portOf(c.listen) ? ":" + portOf(c.listen) : "")}</span></div>
              <div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${c.tun_addr || "—"}</span></div>
              <div class="ifrow"><span class="l">${T("Traffic")}</span><span class="r">${ifTrafficBadge(ccfg, name)}</span></div>
              <div class="ifrow"><span class="l">${T("Peers reachable by")}</span><span class="r">${reachChip(name, c.iface, ccfg.reach)}</span></div>
              <div class="ifrow"><span class="l">${T("Peers")}</span><span class="r">${ps.length
                ? html`<${OnlinePeersTag} nodeId=${name} iface=${c.iface} orphans=${0} orphHref=${href}
                    trigger=${() => html`<b class=${"oncount" + (onlc ? " on" : "")}>${onlc}</b><span class="faint">/${ps.length}</span>`}/>`
                : html`<span class="faint">${T("None")}</span>`}</span></div>
            </div></a>`; };
        return metaErr ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This node hasn't reported in yet — its interfaces will show up here once it runs the installer and syncs.")}<br/><br/>${T("Lost the enrollment token or the install command? Rotate the node's token to generate a fresh install command.")}</span></div>`
          : !meta ? html`<div class="loading"><span class="spin"></span>${T("reading server…")}</div>`
          : (!userKeys.length && !pending.length && !mcards.length && !gcards.length && !wdttIfaces.length && !csqttIfaces.length && !wmcards.length && !cmcards.length) ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("No managed interfaces reported.")}</span></div>`
          : html`<div class="ifgrid" ...${ifReorder.container()}>${mcards}${wmcards}${cmcards}${gcards}${ifaceIds.map(ifn => {
              if (Store.ifaceGone[_pfx + ifn]) return delCard(ifn, Store.ifaceGone[_pfx + ifn]);
              const _w = wdttIfaces.find(w => w.iface === ifn);
              if (_w) return wcard(_w);
              const _c = csqttIfaces.find(c => c.iface === ifn);
              if (_c) return csqCard(_c);
              const m = meta[ifn];
              if (!m) return null;
              const it = ifReorder.item(ifn);
              if (ifaceWasBusy[name + "|" + ifn]) { ifaceReady[name + "|" + ifn] = Date.now() + 5000; ifaceWasBusy[name + "|" + ifn] = false; }
              const type = (m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg";
              const ps = here.filter(p => p.targets.some(t => t.node === name && t.iface === ifn));
              const onlc = ps.filter(p => p.targets.some(t => t.node === name && t.iface === ifn && t.online)).length;
              const orph = Store.recon.orphans.filter(o => o.node === name && o.iface === ifn).length;
              const deleting = (nrec.deleting || []).includes(ifn);
              const istate = (((Store.stats[name] || {}).interfaces || {})[ifn] || {});
              const istopped = !!istate.stopped;
              const idown = !istopped && istate.down;
              const irestarting = (nrec.restarting || []).includes(ifn);
              const iconverting = (nrec.proc_status || "").startsWith("converting");
              const fwdTurns = turnProxiesFor(name, ifn);
              const iprog = (nrec.cmd_progress || {})[ifn];
              const iop = Store.ifaceOp[name + "|" + ifn];
              const iopBusy = iop && iop.phase === "busy";
              const tight = iopBusy || iconverting || deleting || idown || irestarting || !!(nrec.cmd_errors || {})[ifn];
              const idim = deleting || idown || istopped || irestarting || iopBusy || !!iprog || !!(nrec.cmd_errors || {})[ifn];
              const iflash = ifaceFlash[name + "|" + ifn] && Date.now() < ifaceFlash[name + "|" + ifn];
              return html`<a key=${ifn} class=${"ifcard" + (deleting ? " pending" : "") + (idim ? " down" : "") + (blocked ? " locked" : "") + (iflash ? " flash" : "") + it.cls} href=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)} draggable=${false} data-rid=${it.rid}>
                <div class="ifcard-top"><span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.preventDefault()} ...${ifReorder.grip(ifn)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>${(blocked || iopBusy || deleting || irestarting) ? html`<span class=${"iftype " + type + awg3Cls(name, ifn)} ...${awg3Tip(name, ifn)}>${type}</span><span class="ifname">${ifn}</span>` : html`<button class="ifc-edit" title=${T("Edit interface · {v1}", { v1: type.toUpperCase() })} onClick=${e => { e.preventDefault(); e.stopPropagation(); openEditIface(name, ifn); }}><span class=${"iftype " + type + awg3Cls(name, ifn)} ...${awg3Tip(name, ifn)}>${type}</span><span class="ifname">${ifn}</span><span class="ifc-pic"><${Ic} i="pencil"/></span></button>`}<span class="grow"></span>${_unmanaged.has(ifn) ? html`<span class="tg tg-pending" title=${T("The node runs this interface, but this panel holds no record of it: nothing here manages its peers or its settings, and the panel cannot restore it.")}><${Ic} i="info"/>${T("tag|unclaimed")}</span>` : null}${ifaceTurnBadges(name, fwdTurns, tight)}${iprog ? html`<${CmdErr} err=${iprog} cls="warn" title=${T("Working on the node")}/>` : null}${iopBusy ? html`<span class="tg tg-busy"><${Ic} i="clock"/>${ifopBusy(iop.verb)}</span>` : iconverting ? html`<span class="tg tg-convert" title=${T("The node is converting between bare-metal and docker")}><${Ic} i="clock"/>${T("tag|converting")}</span>` : deleting ? html`<${StatusTag} cls="tg-del" icon="clock" label="deleting" msg=${(nrec.cmd_errors || {})[ifn]} title=${T("Command failed on the node")}/>` : istopped ? html`<span class="tg-off" title=${T("Stopped by you — open to Start it")}><${Ic} i="stop"/>${T("tag|stopped")}</span>` : idown ? html`<${StatusTag} cls="tg-busy del" icon="warn" label="down" msg=${(nrec.cmd_errors || {})[ifn] || (T("interface is down on the node — awg-quick couldn't bring it up: {v1}", { v1: idown }))} title=${T("Interface down on the node")}/>` : irestarting ? html`<span class="tg tg-busy"><${Ic} i="clock"/>${T("tag|restarting")}</span>` : ((nrec.cmd_errors || {})[ifn] ? html`<${StatusTag} cls="tg-busy del" icon="warn" label="error" msg=${(nrec.cmd_errors || {})[ifn]} title=${T("Command failed on the node")}/>` : awgSwitchTag(name, ifn, true) ? awgSwitchTag(name, ifn, true) : (m.drift && Object.keys(m.drift).length) ? html`<span class="tg tg-pending" title=${T("A setting was edited directly on the server — open to Adopt or Restore")}><${Ic} i="warn"/>${T("tag|modified")}</span>` : (ifaceReady[name + "|" + ifn] && Date.now() < ifaceReady[name + "|" + ifn]) ? html`<span class="tg tg-ready"><${Ic} i="check"/>${T("tag|ready")}</span>` : null)}</div>
                <div class="ifcard-rows">
                  <div class="ifrow"><span class="l">${T("Listen")}</span><span class="r addr">${m.endpoint || ((m.address || "").split("/")[0] + (m.listen_port ? ":" + m.listen_port : "")) || "—"}</span></div>
                  <div class="ifrow"><span class="l">${T("Subnet")}</span><span class="r addr">${m.subnet || "—"}</span></div>
                  ${(() => {
                    const _d = m.drops;
                    if (!_d || !dropsEnough(_d) || !(_d.pct >= 0.05)) return null;
                    return html`<div class="ifrow"><span class="l">${T("col|Drops")}</span><span class="r addr"><${DropsPop} d=${_d} iface=${ifn} node=${name}
                      trigger=${html`<${DropsFigure} d=${_d}/>`}/></span></div>`;
                  })()}
                  <div class="ifrow"><span class="l">${T("Traffic")}</span><span class="r">${ifTrafficBadge(m, name)}</span></div>
                  <div class="ifrow"><span class="l">${T("Peers reachable by")}</span><span class="r">${reachChip(name, ifn, m.reach)}</span></div>
                  <div class="ifrow"><span class="l">${T("Peers")}</span><span class="r">${ps.length
                    ? html`<${OnlinePeersTag} nodeId=${name} iface=${ifn} orphans=${orph} orphHref=${"#/node/" + encodeURIComponent(name) + "/" + encodeURIComponent(ifn)}
                        trigger=${() => html`<b class=${"oncount" + (onlc ? " on" : "")}>${onlc}</b><span class="faint">/${ps.length}</span>${orph ? html` <span class="ifc-orph" title=${T("{v1} unmanaged (orphan)", { v1: plural(orph, "peer") })}>(${orph})</span>` : null}`}/>`
                    : (orph ? html`<span class="ifc-orph" title=${T("{v1} unmanaged (orphan)", { v1: plural(orph, "peer") })}>${orph}</span>` : html`<span class="faint">${T("None")}</span>`)}</span></div>
                </div></a>`;
            })}${pcards}</div>`; })()}
    <//>

    ${(hasTurns || hasWdtt || hasCsqtt) && turnEnabled() ? html`<${TurnProxiesBlock} node=${name} nrec=${nrec} snap=${snap} metas=${meta} title=${T("Turn proxies")}/>` : null}
    `}
  </div>`;
}



try { matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (themeMode() === "auto") { applyThemeMode(); const b = document.getElementById("theme-btn"); if (b) paintThemeBtn(b); } }); } catch (_) {}






export function reachChip(node, iface, lv) {
  lv = lv || "user";
  const snap = Store.stats[node] || {};
  const st = snap.dev_reach;
  const live = Store.recon.nodeStatus[node] === "live";
  const guarded = live && lv !== "everyone";
  const off = guarded && !((snap.net_deps || {}).reach >= 2);
  const stale = guarded && !off && !!(st && st.ok === false && st.stale);
  const failed = guarded && !off && !stale && !!(st && st.ok === false && (st.ifaces || []).includes(iface));
  const skipped = guarded && !off && st && st.skipped ? st.skipped[iface] : null;
  const nrec = (Store.nodes || []).find(x => x.id === node) || {};
  const unv = lv === "user" && (nrec.reach_unvouched || []).includes(iface);
  const unvRaw = lv === "user" && !unv && (nrec.reach_unvouched_raw || []).includes(iface);
  if (stale) return html`<span class="egb egb-reach-bad" title=${reachStaleText(Store.nodeName(node), st)}><${Ic} i="warn"/>${T("reach|not updated")}</span>`;
  if (off || failed || skipped) return html`<span class="egb egb-reach-bad" title=${off ? T("Not enforced on {node} — update it", { node: Store.nodeName(node) })
    : failed ? T("Couldn't apply on {node}: {detail}", { node: Store.nodeName(node), detail: st.detail || st.why || "" })
    : reachSkipText(Store.nodeName(node), skipped)}><${Ic} i="warn"/>${T("reach|not enforced")}</span>`;
  return lv === "everyone" ? html`<span class="egb egb-reach-everyone" title=${T("Everyone on this node can open connections to devices here")}><${Ic} i="globe"/>${T("reach|everyone")}</span>`
    : lv === "none" || unv ? html`<span class="egb egb-reach-none" title=${unv ? T("This server build can't prove which user a device belongs to, so no other device can reach any device here.")
      : T("Nobody can open connections to devices here")}><${Ic} i="stop"/>${T("reach|nobody")}</span>`
    : html`<span class="egb egb-reach-user" title=${unvRaw ? T("This server build can't prove which user a device connected over RAW belongs to, so no other device can reach those devices.")
      : T("Only the same user's devices can open connections to devices here")}><${Ic} i="users"/>${T("reach|same user")}</span>`;
}
const REACH_NOTICE_KEY = "swg_reach_notice_dismissed";
let reachNoticeGone = (() => { try { return localStorage.getItem(REACH_NOTICE_KEY) === "1"; } catch (_) { return false; } })();
function ReachNotice() {
  if (reachNoticeGone) return null;
  const n = (Store.nodes || []).reduce((a, nd) => { const st = (Store.stats[nd.id] || {}).dev_reach;
    return a + (st && (st.ok || st.stale) ? Object.values(st.blocked || {}).reduce((x, v) => x + (v || 0), 0) : 0); }, 0);
  if (!n) return null;
  const dismiss = () => { reachNoticeGone = true; try { localStorage.setItem(REACH_NOTICE_KEY, "1"); } catch (_) {   } Store.apply(); };
  return html`<div class="notice reach-notice"><${Ic} i="info"/><span>${T("Access to devices follows each interface's settings. Packets blocked so far: {n}.", { n })}</span>
    <button type="button" class="iconbtn" title=${T("Dismiss")} aria-label=${T("Dismiss")} onClick=${dismiss}><${Ic} i="x"/></button></div>`;
}
export function NodesScreen() {
  useStore();
  const ns = Store.nodes || [];
  const nReorder = useReorder(ns.map(n => n.id), ids => mutate({
    patch: s => { s.nodes = orderById(s.nodes, ids, n => n.id); },
    call: () => api.saveOrder({ kind: "node", order: ids }),
  }), "y");
  return html`<div class="screen">
    <div class="section-title" style="margin:6px 2px 16px"><h2>${T("col|Nodes")}</h2><span class="count">${plural(ns.length, "server")}</span>
      <span class="nodehint">${entryServersRun()}</span><span class="grow"></span>
      <button class=${"btn btn-primary" + (isMobile() ? " mfab" : "")} onClick=${openNodeCreate}><span class="plus"><${Ic} i="plus"/></span> ${T("Add node")}</button></div>
    <${ReachNotice}/>
    ${!ns.length ? html`<div class="empty"><b>${T("No nodes yet")}</b>${T("Add your first entry server — you'll get a one-time command to run on it.")}</div>`
      : html`<div class="nodegrid" ...${nReorder.container()}>${ns.map(n => html`<${NodeCard} key=${n.id} n=${n} reorder=${nReorder}/>`)}</div>`}
  </div>`;
}
export function htone(pct) { return pct >= 90 ? "hot" : (pct >= 70 ? "warn" : "ok"); }
export function healthAlerts(health) {
  const out = [];
  for (const d of (health && health.disk || [])) if (d.total && d.used / d.total > 0.9) out.push({ sev: "hot", msg: "disk " + d.mount + " " + Math.round(d.used / d.total * 100) + "%" });
  const m = health && health.mem;
  if (m && m.total && m.used / m.total > 0.9) out.push({ sev: "hot", msg: "memory " + Math.round(m.used / m.total * 100) + "%" });
  const ncpu = (health && health.ncpu) || 1;
  if (health && typeof health.cpu_pct === "number") {
    const cores = cpuCores(health), hot = hotCores(health), tot = cores.length;
    const pk = tot ? T(" (peak {v1}%)", { v1: Math.max(...cores) }) : "";
    if (!tot) {
      if (health.cpu_pct >= SAT_PCT) out.push({ sev: "hot", msg: T("CPU {v1}%", { v1: Math.round(health.cpu_pct) }) });
    } else if (hot && tot === 1) {
      out.push({ sev: "hot", msg: T("1 {v1} saturated{v2}", { v1: cpuName(health), v2: pk }) });
    } else if (hot && hot === tot) {
      out.push({ sev: "hot", msg: T("All {v1} saturated{v2}", { v1: cpuNamePl(health, tot), v2: pk }) });
    } else if (hot) {
      out.push({ sev: health.cpu_pct >= SAT_PCT ? "hot" : "warn",
                 msg: T("{v1} of {v2} {v3} saturated{v4}", { v1: hot, v2: tot, v3: cpuNamePl(health, tot), v4: pk }) });
    }
  }
  const cpuKnown = health && typeof health.cpu_pct === "number";
  const cpuBusy = !cpuKnown || health.cpu_pct >= 50 || (health.cpu_iowait_pct || 0) >= 10;
  if (health && Array.isArray(health.load) && (health.load[0] || 0) / ncpu > 1.5 && cpuBusy)
    out.push({ sev: "warn", msg: "load " + health.load[0].toFixed(1) + " / " + ncpu + " " + cpuNamePl(health, ncpu) });
  return out;
}
export const SAT_PCT = 90;
export const cpuCores = h => (h && Array.isArray(h.cpu_cores)) ? h.cpu_cores : [];
export const hotCores = h => cpuCores(h).reduce((n, c) => n + (c >= SAT_PCT ? 1 : 0), 0);
export const cpuName = h => (h && h.virt) ? T("vCPU") : T("CPU");
export const cpuNamePl = (h, n) => pluralWord(n, (h && h.virt) ? "vCPU" : "CPU");

export function CpuPop({ health, trigger, alignRight }) {
  const cores = cpuCores(health);
  if (!cores.length) return trigger;
  const hot = hotCores(health), iow = health.cpu_iowait_pct;
  const l1 = Array.isArray(health.load) ? (health.load[0] || 0) : null;
  return html`<${Popover} cls="cpupop" popCls="cpu-bubble" alignRight=${alignRight} trigger=${trigger}>
    <div class="onpop-h">${cores.length} ${cpuNamePl(health, cores.length)}${T(" · mean {v1}%", { v1: Math.round(health.cpu_pct) })}${l1 !== null ? T(" · load {v1}", { v1: l1.toFixed(2) }) : ""}${typeof iow === "number" && iow >= 1 ? T(" · iowait {v1}%", { v1: Math.round(iow) }) : ""}${hot ? html` · <b class="cpu-hot-n">${T("{n} saturated", { n: hot })}</b>` : ""}</div>
    ${cores.map((c, i) => html`<div class=${"onrow cpu-row" + (c >= SAT_PCT ? " hot" : "")} key=${i}>
      <span class="on-name">${cpuName(health)} ${i}</span>
      <span class="hm-bar cpu-corebar"><i class="hm-fill" style=${"width:" + Math.min(100, c) + "%;background:" + cpuColor(c)}></i></span>
      <span class="cpu-use" style=${"color:" + cpuColor(c)}>${c}%</span>
      <span class="cpu-idle">${T("idle {n}%", { n: Math.max(0, 100 - c) })}</span>
      <span class="cpu-sat">${c >= SAT_PCT ? html`<${Ic} i="warn"/>` : null}</span>
    </div>`)}
  </${Popover}>`;
}
export const CpuWarnIc = ({ health }) => hotCores(health) ? html`<span class="cpu-warn" aria-label=${T("{v1} saturated", { v1: cpuNamePl(health, hotCores(health)) })}><${Ic} i="warn"/></span>` : null;



export function nodeIfaces(node, { gone = false } = {}) {
  const meta = Store.describe[node] || {};
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const pfx = nrec.mesh_prefix || (Store.panelSettings || {}).reserved?.iface_prefix || "swg_";
  const isSys = k => (meta[k] && meta[k].system) || k.startsWith(pfx) || k.startsWith("swg_");
  const wdtt = new Map(((Store.stats[node] || {}).wdtt || []).filter(w => w && w.iface).map(w => [w.iface, w]));
  const csqtt = new Map(((Store.stats[node] || {}).csqtt || []).filter(c => c && c.iface).map(c => [c.iface, c]));
  const gonePfx = node + "|";
  const goneOn = gone ? Object.keys(Store.ifaceGone).filter(k => k.startsWith(gonePfx)).map(k => k.slice(gonePfx.length)) : [];
  const names = [...new Set([...Object.keys(meta).filter(k => !isSys(k)), ...wdtt.keys(), ...csqtt.keys(), ...goneOn.filter(k => !isSys(k))])];
  return orderById(names, nrec.iface_order, x => x).map(ifn => {
    const w = wdtt.get(ifn), cc = csqtt.get(ifn), m = meta[ifn];
    return {
      ifn, wdtt: !!w, csqtt: !!cc,
      type: (w || scKindByName(ifn) === "wdtt") ? "wdtt" : (cc || scKindByName(ifn) === "csqtt") ? "csqtt" : (m && m.awg_params && Object.keys(m.awg_params).length) ? "awg" : "wg",
      muted: nodeStale(node) || (w ? (w.active !== "active" && !w.await_restore) : cc ? (cc.active !== "active") : ifaceNotUp(node, ifn)),
    };
  });
}
export const IfaceTag = (node, { ifn, type, muted }) => {
  const op = Store.ifaceOp[node + "|" + ifn];
  const href = "#/node/" + encodeURIComponent(node) + "/" + encodeURIComponent(ifn);
  const stop = e => e.stopPropagation();
  return (op && op.phase === "busy")
    ? html`<a class="tg tg-busy" href=${href} onClick=${stop}><${Ic} i="clock"/>${ifn} ${ifopBusy(op.verb)}</a>`
    : html`<a class=${"tg tg-" + type + (type === "awg" ? awg3Cls(node, ifn) : "") + (muted ? " muted" : "")} ...${type === "awg" ? awg3Tip(node, ifn) : {}} href=${href} onClick=${stop}>${ifn}</a>`;
};
export const ifaceTags = node => nodeIfaces(node).map(x => IfaceTag(node, x));
function ifaceSummary(node, nTurn) {
  const c = {};
  nodeIfaces(node).forEach(x => { const k = x.type === "awg" && awg3Cls(node, x.ifn) ? "awg3" : x.type; c[k] = (c[k] || 0) + 1; });
  const order = ["wg", "awg", "awg3", "wdtt", "csqtt"];
  const keys = [...order.filter(k => c[k]), ...Object.keys(c).filter(k => !order.includes(k))];
  const tags = keys.map(k => html`<span class=${"tg m-sum tg-" + (k === "awg3" ? "awg awg3" : k)}>${k === "awg3" ? "awg 3.1" : k}${c[k] > 1 ? " ×" + c[k] : ""}</span>`);
  if (nTurn) tags.push(html`<span class="tg m-sum tg-turn">turn${nTurn > 1 ? " ×" + nTurn : ""}</span>`);
  return tags;
}

export const nodeTurns = node => {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  return orderById(((Store.stats[node] || {}).turn_proxies) || [], nrec.turn_order, tp => tp.service);
};
export const TurnTag = (node, tp) =>
  html`<span class=${"tg tg-turn tf-" + turnFork(tp.service) + ((nodeStale(node) || turnDown(tp)) ? " muted" : "")}>${forkLabel(turnFork(tp.service))}</span>`;


function NodeLanPanel({ nrec }) {
  const lans = nrec.lans || [];
  if (!lans.length || (Store.panelSettings || {}).show_node_lans === false) return null;
  const share = nrec.lan_share !== false;
  const lb = nrec.lan_block;
  const set = on => mutate({ key: "node:" + nrec.id, call: () => api.nodeUpdate({ id: nrec.id, lan_share: on }),
    onOk: () => toast(on ? T("Clients of this node can reach its local network again.")
                         : T("Clients of this node are now kept off its local network."), "ok") });
  const status = share ? null
    : !nrec.net_capable ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This node runs a version that can't close its local network — update it. Until then its clients still reach it.")}</span></div>`
    : !lb ? html`<div class="lanstat"><${Ic} i="clock"/> ${T("Waiting for the node to close it.")}</div>`
    : lb.ok ? html`<div class="lanstat ok"><${Ic} i="check"/> ${T("Closed on the node.")}</div>`
    : lb.why === "addresses_unreadable" ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("The node couldn't read its own addresses, so it left the block as it was.")}</span></div>`
    : html`<div class="notice warn"><${Ic} i="warn"/><span>${T("The node couldn't close it, so its clients still reach it: {why}", { why: lb.detail || lb.why || "" })}</span></div>`;
  const lanMsg = share
      ? T("Clients of this node can reach the private network it sits on — every device on it, not only this node — and so can clients of other nodes whose traffic leaves through this one. A client whose traffic this node sends on to another node reaches that node's network instead. Nobody set this up: it is what routing does when the node's local network is also its way out.")
      : T("Clients of this node, and of other nodes whose traffic leaves through it, are kept off the private network it sits on. They still reach the internet and this node itself.");
  return html`<${Panel} icon="shield" title=${T("Local network")} tone=${share ? "pending" : "online"}
      actions=${html`<span class="lanswitch">${T("Clients can reach it")}<${Switch} on=${share} onChange=${set}
        title=${share ? T("Keep this node's clients off its local network") : T("Let this node's clients reach its local network")}/></span>`}>
    <div class="lanlist">${lans.map(l => html`<span class="lanaddr"><span class="mono">${l.ip}</span>${l.iface ? html`<span class="faint">${l.iface}</span>` : null}</span>`)}</div>
    ${isMobile() ? html`<details class="lanfold"><summary>${T("What this switch does")}</summary><p class="lanmsg">${lanMsg}</p></details>`
      : html`<p class="lanmsg">${lanMsg}</p>`}
    ${status}
  <//>`;
}

function NodeMoreSheet({ id }) {
  useStore();
  const nrec = (Store.nodes || []).find(n => n.id === id);
  useEffect(() => { if (!nrec) closeModal(); }, [!nrec]);
  if (!nrec) return null;
  const blocked = Store.recon.nodeStatus[id] !== "live" || inProc(nrec.proc_status);
  const row = (icon, label, on, off, cls) => html`<button class=${"msheet-it" + (cls ? " " + cls : "")} disabled=${off} onClick=${() => { closeModal(); on(); }}>
    <${Ic} i=${icon}/><span class="msheet-l">${label}</span></button>`;
  return html`<${Sheet} title=${Store.nodeName(id)} noGuard=${true}>
    <div class="msheet"><div class="msheet-g">
      ${row("key", T("Rotate token"), () => openNodeRotate(nrec))}
      ${nrec.removing ? row("refresh", T("Cancel removal — keep this node"), () => unflagNode(nrec)) : null}
      ${row("trash", nrec.removing ? T("Force remove node") : T("Remove node"), () => openNodeRemove(nrec), false, "danger")}
    </div>${blocked ? html`<p class="hint msheet-note">${T("Unavailable while the node is down / converting")}</p>` : null}</div>
  <//>`;
}
export function NodeHealthPanel({ name, nrec }) {
  const [range, setRange] = useState("live");
  if (isMobile()) return html`<${Panel} icon="activity" title=${T("Health")} tone="online" actions=${html`<span class="faint">${T("range|live")}</span>`}>
    <${HealthAlerts} health=${nrec.health}/><${HealthMeters} health=${nrec.health}/><//>`;
  const removing = nrec.removing ? html`<span class="nstat removing"><${Ic} i="trash"/> ${T("tag|flagged for removal")}</span><button class="btn btn-mini" style="margin-left:9px" title=${T("Cancel removal — keep this node")} onClick=${() => unflagNode(nrec)}>${T("Cancel")}</button>` : null;
  const actions = html`<div class="panel-tools">${removing}${nrec.health_history ? html`<${RangeTabs} range=${range} setRange=${setRange}/>` : null}</div>`;
  return html`<${Panel} icon="activity" title=${T("Health")} tone="online" actions=${actions}>
    <${HealthAlerts} health=${nrec.health}/>
    ${nrec.health_history
      ? html`<${RangedHistory} node=${name} kind="cpu" live=${nrec.health_history} liveFine=${nrec.health_live} h=${52} head=${html`<${HealthMeters} health=${nrec.health}/>`} range=${range} setRange=${setRange}/>`
      : html`<${HealthMeters} health=${nrec.health}/>`}
  <//>`;
}
export function NodeThroughput({ name, nrec }) {
  const [peers, setPeers] = useState(true);
  const [mesh, setMesh] = useState(true);
  const [range, setRange] = useState("live");
  const togP = () => { if (peers && !mesh) { setPeers(false); setMesh(true); } else setPeers(!peers); };
  const togM = () => { if (mesh && !peers) { setMesh(false); setPeers(true); } else setMesh(!mesh); };
  const lead = html`<div class="dcard-traf hdr-lead">
    <button class=${"tbadge peers" + (peers ? " on" : "")} onClick=${togP} title=${peers ? T("Hide client (peer) traffic") : T("Show client (peer) traffic")}>${T("Peers")}</button>
    <button class=${"tbadge mesh" + (mesh ? " on" : "")} onClick=${togM} title=${mesh ? T("Hide mesh (node-to-node relay) traffic") : T("Show mesh (node-to-node relay) traffic")}>${T("Mesh")}</button>
  </div>`;
  return html`<${Panel} icon="gauge" title=${T("Throughput")} lead=${lead} actions=${html`<${RangeTabs} range=${range} setRange=${setRange}/>`}>
    <${RangedHistory} node=${name} kind="throughput" live=${nrec.health_history} liveFine=${nrec.health_live} h=${72} traf=${{ peers, mesh }} range=${range} setRange=${setRange}/>
  <//>`;
}

export function healthCols(health) {
  const cols = [];
  const ncpu = health.ncpu || 1;
  const l1 = Array.isArray(health.load) ? (health.load[0] || 0) : null;
  const loadTxt = () => l1.toFixed(2) + " / " + ncpu + " " + cpuNamePl(health, ncpu);
  if (typeof health.cpu_pct === "number") {
    cols.push({ label: T("CPU"), heat: true, cpu: true, pct: health.cpu_pct, text: Math.round(health.cpu_pct) + "%" });
  } else if (l1 !== null) {
    cols.push({ label: T("CPU load"), heat: true, pct: l1 / ncpu * 100, text: loadTxt() });
  }
  const m = health.mem;
  if (m && m.total) cols.push({ label: T("Memory"), pct: m.used / m.total * 100, text: fmtBytes(m.used) + " / " + fmtBytes(m.total) });
  const d0 = (health.disk || [])[0];
  if (d0 && d0.total) cols.push({ label: T("Disk"), pct: d0.used / d0.total * 100, text: fmtBytes(d0.used) + " / " + fmtBytes(d0.total) });
  return cols;
}
export function HealthMeters({ health }) {
  return html`<div class="health-cols">${healthCols(health).map(c => {
    const p = Math.min(100, Math.max(0, c.pct || 0));
    const heat = !!c.heat;
    const col = heat ? cpuColor(c.pct) : null;
    const body = html`<div class="hcol">
      <div class="hcol-top"><span class="hcol-l">${c.label}</span><span class="hcol-v" style=${col ? "color:" + col : ""}>${c.text}${c.cpu ? html`<${CpuWarnIc} health=${health}/>` : null}</span></div>
      <div class="hm-bar"><i class=${"hm-fill" + (heat ? "" : " " + htone(p))} style=${"width:" + p + "%" + (col ? ";background:" + col : "")}></i></div>
    </div>`;
    return c.cpu ? html`<${CpuPop} health=${health} trigger=${body}/>` : body;
  })}</div>`;
}
export function HealthAlerts({ health }) {
  const alerts = healthAlerts(health);
  return alerts.length ? html`<div class="halerts">${alerts.map(a => html`<span class=${"halert " + a.sev}><${Ic} i="warn"/> ${a.msg}</span>`)}</div>` : null;
}
export function NodeHealth({ health, node, compact, history, range, nodeHist }) {
  if (!health) return compact ? null : html`<div class="hint" style="margin:2px">${T("No health data reported yet.")}</div>`;
  const hh = (node && (Store.nodes || []).find(n => n.id === node) || {}).health_history || null;
  const useRanged = range && range !== "live" && nodeHist && Array.isArray(nodeHist.cpu) && nodeHist.cpu.some(x => x != null);
  const liveCpu = (hh && Array.isArray(hh.cpu) && hh.cpu.length > 1) ? hh.cpu : null;
  const cpuHist = useRanged ? nodeHist.cpu : liveCpu;
  const cpuTimes = useRanged ? nodeHist.t : (hh ? hh.t : null);
  const cpuRange = useRanged ? range : "live", cpuCap = useRanged ? (RANGE_CAP[range] || axisCap(nodeHist.axis) || 0) : 0;
  const showHist = history !== false && !!cpuHist;
  return html`<div class="health">
    <${HealthAlerts} health=${health}/>
    <${HealthMeters} health=${health}/>
    ${showHist ? html`<div class="health-hist">
      <span class="hist-cap">${T("CPU history")}</span>
      <${MiniArea} points=${cpuHist} h=${compact ? 36 : 52} times=${cpuTimes} range=${cpuRange} cap=${cpuCap}/>
    </div>` : null}
  </div>`;
}

export const UPD_SPIN_SVG = `<svg class="updspin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v4h-4"/></svg>`;
export const WARN_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;
export const X_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
export const CHECK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
export const INFO_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
function dismissOnOutsideTap(el, anchor, hide) {
  const onDown = ev => {
    if (el.contains(ev.target) || (anchor && anchor.contains(ev.target))) return;
    hide();
    const eat = e2 => { e2.stopPropagation(); e2.preventDefault(); };
    document.addEventListener("click", eat, true);
    setTimeout(() => document.removeEventListener("click", eat, true), 350);
  };
  document.addEventListener("pointerdown", onDown, true);
  return () => document.removeEventListener("pointerdown", onDown, true);
}
function parkTitles(anchor) {
  const parked = [];
  const park = el => {
    if (el && el.hasAttribute && el.hasAttribute("title")) { parked.push([el, el.getAttribute("title")]); el.removeAttribute("title"); }
  };
  for (let el = anchor; el && el !== document.body; el = el.parentElement) park(el);
  anchor.querySelectorAll("[title]").forEach(park);
  return () => parked.forEach(([el, v]) => { try { el.setAttribute("title", v); } catch (_) {   } });
}
export function hostHoverBubble(anchor, contentFn, onAction) {
  if (isMobile()) return;
  let bub = null, t = null, detach = null, untitle = null;
  const drop = () => { if (untitle) { untitle(); untitle = null; } if (detach) { detach(); detach = null; } if (bub) { bub.remove(); bub = null; } };
  const hide = () => {
    if (bub && bub.matches(":hover")) { later(); return; }
    clearTimeout(t); drop();
  };
  const later = () => { clearTimeout(t); t = setTimeout(hide, 140); };
  const show = () => {
    clearTimeout(t);
    if (bub && bub.isConnected) return;
    document.querySelectorAll(".hostupd-bub").forEach(x => x.remove());
    const bind = () => { if (onAction && bub) bub.querySelectorAll(".hub-act").forEach(b => b.addEventListener("click", ev => {
      ev.stopPropagation(); ev.preventDefault(); clearTimeout(t); drop(); onAction(); })); };
    const repaint = () => { if (!bub || !bub.isConnected) return; const h = contentFn(repaint); if (h) { bub.innerHTML = h; bind(); } };
    const inner = contentFn(repaint); if (!inner) return;
    untitle = parkTitles(anchor);
    bub = document.createElement("div");
    bub.className = "deppop hostupd-bub";
    bub.innerHTML = inner;
    document.body.appendChild(bub);
    const r = anchor.getBoundingClientRect();
    bub.style.top = Math.round(r.bottom + 8) + "px";
    bub.style.left = Math.round(r.right) + "px";
    bub.style.transform = "translateX(-100%)";
    bub.addEventListener("mouseenter", () => clearTimeout(t));
    bub.addEventListener("mouseleave", later);
    bind();
    detach = dismissOnOutsideTap(bub, anchor, () => { clearTimeout(t); drop(); });
  };
  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("mouseleave", later);
  anchor.addEventListener("click", () => { clearTimeout(t); drop(); });
}
const CHANGELOG_TTL = 5 * 60 * 1000;
const CHANGELOG_WANT_RETRY = 30 * 1000;
let _changelogCache = null;
let _changelogAt = 0;
let _changelogIdx = 0;
let _changelogReq = null;
export function loadChangelog(want) {
  const es = (_changelogCache && _changelogCache.entries) || [];
  const age = Date.now() - _changelogAt;
  const has = !want || es.some(e => e.version === want);
  if (_changelogCache && age <= CHANGELOG_TTL && (has || age < CHANGELOG_WANT_RETRY)) return Promise.resolve(_changelogCache);
  if (!_changelogReq) _changelogReq = api.changelog(want).then(res => {
    _changelogCache = (res && res.ok) ? res.data : (_changelogCache || { entries: [] });
    _changelogAt = Date.now();
    return _changelogCache;
  }).finally(() => { _changelogReq = null; });
  return _changelogReq;
}
export const changelogEntry = (version) => ((_changelogCache && _changelogCache.entries) || []).find(e => e.version === version) || null;
export function versionHoverBubble(anchor) {
  if (isMobile()) return;
  let bub = null, t = null, detach = null, untitle = null;
  const drop = () => { if (untitle) { untitle(); untitle = null; } if (detach) { detach(); detach = null; } if (bub) { bub.remove(); bub = null; } };
  const hide = () => { if (bub && bub.matches(":hover")) { later(); return; } clearTimeout(t); drop(); };
  const later = () => { clearTimeout(t); t = setTimeout(hide, 140); };
  const paint = () => {
    if (!bub) return;
    if (!_changelogCache) { bub.innerHTML = `<div class="hub-list"><div class="hub-row faint"><span class="hub-txt">${esc(T("Loading changelog…"))}</span></div></div>`; return; }
    const es = _changelogCache.entries || [];
    if (!es.length) { bub.innerHTML = `<div class="hub-h"><span class="hub-title">${esc(T("Changelog"))}</span></div><div class="hub-list"><div class="hub-row faint"><span class="hub-txt">${esc(T("No changelog available."))}</span></div></div>`; return; }
    _changelogIdx = Math.max(0, Math.min(_changelogIdx, es.length - 1));
    const e = es[_changelogIdx], cur = _changelogCache.current || "";
    bub.innerHTML = hubEntryHtml({
      titleHtml: `<b>${esc(e.version)}</b>${e.version === cur ? ` <span class="hub-cur">${esc(T("installed"))}</span>` : ""}`,
      date: e.date, notes: e.notes, nav: { older: _changelogIdx < es.length - 1, newer: _changelogIdx > 0 } });
    bub.querySelectorAll(".hub-nav").forEach(b => b.addEventListener("click", ev => { ev.stopPropagation(); if (b.disabled) return; _changelogIdx += (+b.dataset.nav); paint(); }));
  };
  const show = () => {
    clearTimeout(t);
    if (bub && bub.isConnected) return;
    document.querySelectorAll(".hostupd-bub.verbub").forEach(x => x.remove());
    untitle = parkTitles(anchor);
    bub = document.createElement("div"); bub.className = "deppop hostupd-bub verbub";
    document.body.appendChild(bub);
    const r = anchor.getBoundingClientRect();
    bub.style.top = Math.round(r.bottom + 8) + "px";
    bub.style.left = Math.round(r.left) + "px";
    bub.addEventListener("mouseenter", () => clearTimeout(t));
    bub.addEventListener("mouseleave", later);
    detach = dismissOnOutsideTap(bub, anchor, () => { clearTimeout(t); drop(); });
    const atInstalled = () => { const i = ((_changelogCache || {}).entries || []).findIndex(x => x.version === ((_changelogCache || {}).current || ""));
      _changelogIdx = i >= 0 ? i : 0; };
    if (_changelogCache) atInstalled();
    paint();
    if (!_changelogCache || Date.now() - _changelogAt > CHANGELOG_TTL) loadChangelog().then(() => { atInstalled(); if (bub) paint(); });
  };
  anchor.addEventListener("mouseenter", show);
  anchor.addEventListener("mouseleave", later);
}
export function noteLead(n) {
  n = String(n).trim();
  const dot = n.indexOf(". "), dash = n.search(/\s[—–-]\s/);
  let cut = -1, keep = 0;
  if (dot >= 0 && dot <= 54 && (dash < 0 || dot < dash)) { cut = dot; keep = 1; }
  else if (dash >= 0 && dash <= 54) { cut = dash; keep = 0; }
  if (cut < 0) { const w = n.split(" "); return [w.slice(0, 3).join(" "), w.slice(3).join(" ")]; }
  return [n.slice(0, cut + keep).trim(), n.slice(cut + keep).replace(/^\s*[—–-]\s*/, "").trim()];
}
export function hubEntryHtml({ titleHtml, date, notes, emptyNote, footer, nav, action }) {
  const rows = (notes && notes.length) ? notes.map(n => { const [lead, rest] = noteLead(n);
      return `<div class="hub-row"><span class="hub-bul"></span><span class="hub-txt"><b>${esc(lead)}</b>${rest ? " " + esc(rest) : ""}</span></div>`; }).join("")
    : `<div class="hub-row faint"><span class="hub-txt">${esc(emptyNote || T("No notes for this release."))}</span></div>`;
  const navGroup = nav ? `<span class="hub-nav-group"><button class="hub-nav" data-nav="1"${nav.older ? "" : " disabled"} title="${esc(T("Older release"))}">${esc(T("‹ Prev"))}</button><button class="hub-nav" data-nav="-1"${nav.newer ? "" : " disabled"} title="${esc(T("Newer release"))}">${esc(T("Next ›"))}</button></span>` : "";
  const dateHtml = date ? `<span class="hub-date">${esc(date)}</span>` : "";
  const endCell = action
    ? `<span class="hub-end">${dateHtml}<button class="hub-act" data-act="1" title="${esc(action.title || action.label)}">${esc(action.label)}</button></span>`
    : dateHtml;
  return `<div class="hub-h"><span class="hub-title">${titleHtml}</span>${navGroup}${endCell}</div>`
    + `<div class="hub-list">${rows}</div>`
    + (footer ? `<div class="hub-foot">${esc(footer)}</div>` : "");
}
export function turnUpdBubbleHtml() {
  const rows = Store.turnUpdates || []; if (!rows.length) return "";
  const groups = [];
  for (const r of rows) {
    let g = groups.find(x => x.fork === r.fork);
    if (!g) groups.push(g = { fork: r.fork, latest: r.latest, nodes: [], same: r.installed });
    if (!g.nodes.includes(r.node)) g.nodes.push(r.node);
    if (g.same !== r.installed) g.same = "";
  }
  groups.sort((a, b) => forkPickLabel(a.fork).localeCompare(forkPickLabel(b.fork), undefined, { sensitivity: "base" }));
  const head = `<div class="hub-h">${esc(T("{v1} available", { v1: plural(groups.length, "update") }))}</div>`;
  const body = groups.map(g => {
    const where = g.nodes.length === 1 ? esc(Store.nodeName(g.nodes[0])) : esc(plural(g.nodes.length, "node"));
    const ver = g.same
      ? `<span class="mono">${esc(g.same)}</span><span class="verarrow">\u2192</span><span class="mono vernew">${esc(g.latest)}</span>`
      : `<span class="verarrow">\u2192</span><span class="mono vernew">${esc(g.latest)}</span>`;
    return `<div class="hub-row"><span class="hub-dot" style="background:${esc(turnColor(g.fork))}"></span><span><b style="color:${esc(turnColor(g.fork))}">${esc(forkPickLabel(g.fork))}</b> <span class="dim">${where}</span><span class="verarrow">\u00b7</span>${ver}</span></div>`;
  }).join("");
  return head + body + `<button class="hub-foot hub-act hub-foot-act" data-act="1">${esc(T("Review & update"))}</button>`;
}
export function NodeCard({ n, reorder }) {
  const it = reorder ? reorder.item(n.id) : null;
  const st = nodeStatusOf(n);
  const here = Store.recon.peers.filter(p => p.targets.some(t => t.node === n.id));
  const onl = here.filter(p => p.targets.some(t => t.node === n.id && t.online)).length;
  const snap = Store.stats[n.id];
  const tps = nodeTurns(n.id);
  const ifTags = ifaceTags(n.id);
  const h = n.health, cpuUtil = h && typeof h.cpu_pct === "number";
  const hasCpu = cpuUtil || (h && Array.isArray(h.load));
  const l1 = (h && Array.isArray(h.load)) ? (h.load[0] || 0) : 0;
  const cpctRaw = cpuUtil ? h.cpu_pct : l1 / ((h && h.ncpu) || 1) * 100, cpct = Math.min(100, cpctRaw);
  const cpuLabel = cpuUtil ? T("CPU") : T("CPU load"), cpuText = cpuUtil ? Math.round(cpctRaw) + "%" : l1.toFixed(2);
  const removing = n.removing;
  const proc = n.proc_status;
  const nblocked = st !== "online" || inProc(proc);
  const nav = () => go("#/node/" + encodeURIComponent(n.id));
  return html`<div class=${"ncard clk" + (removing ? " removing" : "") + (it ? it.cls : "")} onClick=${nav} data-rid=${it ? it.rid : null}>
    <div class="nc-gutter">${reorder ? html`<span class="drag-grip" title=${T("Drag to reorder")} onClick=${e => e.stopPropagation()} ...${reorder.grip(n.id)} dangerouslySetInnerHTML=${{ __html: GRIP_SVG }}></span>` : null}</div>
    <div class="nc-name">
      <span class="nname">${n.name}</span>
      ${n.kind ? html`<span class=${"tport " + n.kind}>${kindLabel(n.kind, n.runtime)}</span>` : null}
      ${platformPill(n)}
      ${n.uninstalled ? html`<span class="nstat uninst"><${Ic} i="info"/> ${T("tag|uninstalled")}</span>`
        : st === "online" ? html`<span class="reporting">${T("reporting")}</span>`
        : st === "offline" ? html`<span class="nstat offline"><${Ic} i="info"/> ${T("tag|offline")}</span>`
        : html`<span class="nstat enroll"><${Ic} i="clock"/> ${T("awaiting enroll")}</span>`}${proc && !isUpdateState(proc) ? procTag(proc, e => { e.stopPropagation(); e.preventDefault(); dismissNodeProc(n.id); }, procErr(n), st !== "online" && st !== "offline") : null}
      <span style="margin-left:8px"><${HealthDot} issues=${n.issues} i18n=${n.issues_i18n}/></span>
      ${removing ? html`<span class="nstat removing" style="margin-left:14px"><${Ic} i="trash"/> ${T("tag|flagged for removal")}</span>` : null}
    </div>
    <div class="nc-mesh nm-item">${(n.mesh_peers || []).length ? html`<${MeshStat} nodeId=${n.id} mode="both"/>` : null}</div>
    <div class="nc-cpu nm-item"><span class="nm-l">${cpuLabel}</span>${hasCpu ? html`<${CpuPop} health=${h} alignRight=${true} trigger=${html`<span class="nm-cpu"><span class="hm-bar"><i class="hm-fill" style=${"width:" + cpct + "%;background:" + cpuColor(cpctRaw)}></i></span><span class="nm-v" style=${"color:" + cpuColor(cpctRaw)}>${cpuText}</span><${CpuWarnIc} health=${h}/></span>`}/>` : html`<span class="nm-v faint">—</span>`}</span>
    <button class="iconbtn nc-ctl" disabled=${nblocked} title=${nblocked ? T("Unavailable while the node is down / converting") : T("Node settings")} onClick=${e => { e.stopPropagation(); openNodeEdit(n); }}><${Ic} i="gear"/></button>

    <span class="nc-peers nm-item">${here.length
      ? html`<${OnlinePeersTag} nodeId=${n.id} orphans=${orphCount(n.id, null)} cls="nm-peerpop"
          trigger=${() => html`<span class="nm-l">${T("Peers")}</span><span class="nm-v nm-peers"><b class=${"oncount" + (onl ? " on" : "")}>${onl}</b><small>/${here.length}</small></span>`}/>`
      : html`<span class="nm-l">${T("Peers")}</span><span class="nm-v nm-peers faint">${T("val|none")}</span>`}</span>
    <div class="nc-ifaces nm-item"><span class="nm-l">${T("Interfaces")}</span><span class="tags">${isMobile() ? ifaceSummary(n.id, turnEnabled() ? tps.length : 0)
      : ifTags.length ? ifTags : html`<span class="nm-v faint">—</span>`}</span></div>
    <span class="nc-thru nm-thru"><span class="nm-l">${T("Throughput")}</span>${st === "online"
      ? html`<span class=${"nm-v thru" + ((n.rx_speed || 0) + (n.tx_speed || 0) > 0 ? "" : " idle")}><span class="down">↓ ${rate(dlul(n.rx_speed, n.tx_speed)[0])}</span><span class="up">↑ ${rate(dlul(n.rx_speed, n.tx_speed)[1])}</span></span>`
      : html`<span class="nm-v faint">—</span>`}</span>
    <button class="iconbtn nc-ctl danger" title=${removing ? T("Force remove") : T("Remove node")} onClick=${e => { e.stopPropagation(); openNodeRemove(n); }}><${Ic} i="trash"/></button>

    ${turnEnabled() && tps.length && !isMobile() ? html`<div class="nc-turn nm-item"><span class="nm-l">${T("Turn-proxies")}</span><span class="tags">${tps.map(tp => TurnTag(n.id, tp))}</span></div>` : null}
  </div>`;
}

