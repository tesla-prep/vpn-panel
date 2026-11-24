import { T, Trich, Tsplit, plural, pluralWord, srvText, fmtNum } from "./i18n.js";
import { esc, tkey, seen, dur, ago, fmtBytes, ipOf, ipChoices, portOf, listenAddr, ipPickerVal, V, agoAge, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { go } from "./router.js";
import {
  kindOf, iTypeOf, targetType, nodeStale, ifaceNotUp, wdttOn, ghostIface, ghostPeers, turnProxiesFor,
  suggestIface, suggestSubnet, suggestPort, portHolder, portErrMsg, subnetFleetConflict, subnetServerAddr,
  cidrNet, nextWdttName, nextCsqttName, ifaceIsAwg, turnIfaceNameError, awgDict3, awgGen, awg3Cls, awg3Tip, tip3, awg31No,
} from "./model.js";
import { turnFork, turnColor, turnForkList, forkSupportsAwg, forkOpts, forkLabel } from "./turn-catalog.js";
import { Ic, ICON, Tag, Panel, Badge, StatusTag, CmdErr, Sheet, footRow, secTitle, SearchBox, Switch, Dropdown, Disclosure, autoGrow, IpPicker, NodeIpPick, useHostOnNode, Popover, Portal, toast, copy, mutate, sheetSend, openModal, pushModal, closeModal, closeAllModals, openConfirm, ConfirmSheet, opTag, procTag, inProc, statusLabel, LogBody, useReorder, GRIP_SVG, orderById, trackIfaceOps, startOrRestartWdtt, startOrRestartCsqtt, ifaceReady, ifaceWasBusy, RowError, goSettings, rowSingle, rowDouble, rowNoSelect, ifopBusy, ifopDone, ifopFail, STATUS_RANK, adoptOrphanPatch, dlul, rateCell, xferCell, typeToConfirm, LIST_PAGE, pageSlice, ListPager, awgSwitchTag, meshGenLabel, meshGenColor } from "./ui.js";
import { RangedHistory, IfaceThroughput, lossColorMesh } from "./charts.js";
import { AWG_ORDER, SubAutoNote, ensureVaultUnlocked, ivkResealForNode, subSKCached, subFeatureOn } from "./crypto.js";
import { EgressPicker, NatSourcePick, natPinApplies, egressInit, egressSaveBlock, egressBody, ifTrafficBadge, BlockTraffic, blockActiveN, RoutingRules, rulesTitle,
         catLabelOf, defaultBlockFor, loadBlockCatalog, reportDropped, rulesSummary, targetLabel } from "./routing.js";
import { rulesToRows } from "./rulerows.js";
import { MIMIC_KEYS, MIMIC_PRESETS, MIMIC_BUILTIN_SIZE, mimicOf, mimicCheck, awgFieldCheck, mimicRender, mimicLines, mimicFill, mimicAfter } from "./mimic.js";
import { orphCount, OnlinePeersTag, searchMatch, DropsPop, DropsFigure, LossPop, meshHealth, ReachField } from "./views.js";
import { confirmRestoreInterface, confirmRestoreAllInterfaces, confirmRebuildInterface, brokenIface, openRecreateRekey, fmtDate } from "./peer-actions.js";
import { TurnProxiesBlock, turnEnabled, WDTT_COLOR, wdttRestoreIdentity, wdttRecreateFresh,
         WdttDeleteSheet, openEditWdtt, CsqttDeleteSheet, openEditCsqtt, ForkTag, shownTitle,
         enabledTurnForks, useListenState, ListenHint, ListenNotice, ListenOnField, turnDialFallback, CsqttVersionField, CSQTT_DEFAULT_LINE, csqttRunLine } from "./turn.js";
import { PeerGrid, NodeRail } from "./grids.js";
import { openCreatePeer } from "./sheets-crud.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

function ifaceDownNote(reason, type, docker) {
  if (type === "awg" && /unknown device type|protocol not supported|amneziawg kernel module is unavailable/i.test(reason)) {
    return html`<${Fragment}>${Trich("The interface is *down*. Its saved *.conf* is shown below. The AmneziaWG kernel module is unavailable on the node host.")}
      ${" "}${docker ? Trich("On the node host, run *sudo modprobe amneziawg*. If it fails, use *swg.sh update node*. Then click *Start interface*.") : Trich("Check the module for the running kernel on the node host, then click *Start interface*.")}
      ${" "}<code>${reason}</code><//>`;
  }
  const [a, b] = Tsplit("This interface is *down* on the node — its config below is read from the *.conf* (not live). The node reported: {reason}. Use *Start interface* — if the bring-up fails, the exact reason (port clash, a left-over kernel interface of the same name, an unsupported AmneziaWG parameter, …) shows here.", "reason");
  const rich = t => t.split("*").map((p, i) => (i % 2 ? html`<b>${p}</b>` : p));
  return html`<${Fragment}>${rich(a)}<code>${T(reason)}</code>${rich(b)}<//>`;
}
function ifaceGoneNote(iface, nodeName, verdict) {
  const [a, b] = Tsplit("Interface *{iface}* is gone from {node} — the panel no longer sees it, so this view is *read-only* and shows the panel's saved config. {verdict} The only action here is *Restore interface*.", "verdict", { iface, node: nodeName });
  const rich = t => t.split("*").map((p, i) => (i % 2 ? html`<b>${p}</b>` : p));
  return html`<${Fragment}>${rich(a)}${verdict}${rich(b)}<//>`;
}

function restoreFailed(err) {
  const [a, b] = Tsplit("*Restore failed.* The node couldn't revert to its backed-up key: {err} — try again, or adopt the new key instead.", "err");
  const rich = t => t.split("*").map((p, i) => (i % 2 ? html`<b style="color:var(--dangling)">${p}</b>` : p));
  return html`<${Fragment}>${rich(a)}<span class="mono" style="color:var(--dangling)">${err}</span>${rich(b)}<//>`;
}

function subnetTaken(iface, node) {
  const one = T("Subnet already used by {iface} on {node} — interface subnets must be unique across the fleet.");
  const [a, r1] = [one.split("{iface}")[0], one.split("{iface}").slice(1).join("{iface}")];
  const [b, c] = [r1.split("{node}")[0], r1.split("{node}").slice(1).join("{node}")];
  return html`<${Fragment}>${a}<b>${iface}</b>${b}<b>${node}</b>${c}<//>`;
}

function dockerPortsStep() {
  const [a, b] = Tsplit("1. Add under {key} in the node's docker-compose.yml", "key");
  return html`<${Fragment}>${a}<span class="mono">swg-node → ports:</span>${b}<//>`;
}

const awgFold = body => isMobile()
  ? html`<details class="iface-amnezia m-awgfold"><summary><span class="ig-l">AmneziaWG</span></summary>${body}</details>`
  : html`<div class="iface-amnezia"><span class="ig-l">AmneziaWG</span>${body}</div>`;

export function IfaceDetail({ node: rawNode, iface: rawIface }) {
  useStore();
  const [q, setQ] = useState("");
  const node = decodeURIComponent(rawNode);
  const iface = decodeURIComponent(rawIface);
  const nrec = (Store.nodes || []).find(n => n.id === node);
  if (!nrec) return html`<div class="screen"><div class="crumb"><a href="#/nodes">${T("col|Nodes")}</a><span class="sep">/</span><b>${T("val|server")}</b></div>
    <div class="empty"><b>${T("Unknown server")}</b>${T("this server isn't in the fleet.")}</div></div>`;
  const _wInst = ((Store.stats[node] || {}).wdtt || []).find(w => w && w.iface === iface);
  const _wCfg = !_wInst && ((nrec.wdtt_cfg || {})[iface] || null);
  if (_wInst || _wCfg) return html`<${WdttIfaceDetail} node=${node} iface=${iface} w=${_wInst || { iface }} nrec=${nrec} missing=${!_wInst}/>`;
  const _cInst = ((Store.stats[node] || {}).csqtt || []).find(c => c && c.iface === iface);
  const _cCfg = !_cInst && ((nrec.csqtt_cfg || {})[iface] || null);
  if (_cInst || _cCfg) return html`<${WdttIfaceDetail} node=${node} iface=${iface} w=${_cInst || { iface }} nrec=${nrec} missing=${!_cInst} kind="csqtt"/>`;
  const dname = nrec.name || node;
  const meta = Store.ifaceMeta(node, iface);
  const _rawMiss = (!meta && nrec.missing_ifaces && nrec.missing_ifaces[iface]) || null;
  const missIf = (_rawMiss && _rawMiss.key_source) ? _rawMiss : null;
  const ghostIf = (!meta && !missIf && ghostIface(node, iface)) || null;
  const live = Store.recon.nodeStatus[node] === "live";
  const blocked = !live || inProc(nrec.proc_status) || !!missIf;
  const updating = !!(meta && meta.desired_port && meta.listen_port && Number(meta.desired_port) !== Number(meta.listen_port));
  const type = ghostIf
    ? (Store.recon.peers.some(p => (p.targets || []).some(t => t.node === node && t.iface === iface && t.type === "awg")) ? "awg" : "wg")
    : ((((meta && meta.awg_params) || (missIf && missIf.awg_params)) && Object.keys((meta && meta.awg_params) || (missIf && missIf.awg_params) || {}).length) ? "awg" : "wg");
  const peers = Store.recon.peers.filter(p => p.targets.some(t => t.node === node && t.iface === iface));
  const onl = peers.filter(p => p.targets.some(t => t.node === node && t.iface === iface && t.online)).length;
  const orphans = Store.recon.orphans.filter(o => o.node === node && o.iface === iface);
  const restarting = (nrec.restarting || []).includes(iface);
  const istate = (((Store.stats[node] || {}).interfaces || {})[iface] || {});
  const istopped = !!istate.stopped;
  const idown = !istopped && istate.down;
  const notup = !!idown || istopped;
  const op = Store.ifaceOp[node + "|" + iface];
  const ap = (meta && meta.awg_params) || (missIf && missIf.awg_params) || {};
  const apNone = meta && meta.awg_exact ? AWG_ORDER.filter(k => !AWG3_KEYS.includes(k) && ap[k] == null) : [];
  const awgGrp = pred => [...Object.entries(ap).filter(([k]) => pred(k) && !AWG3_KEYS.includes(k)).map(([k, v]) => k + "=" + v),
    ...apNone.filter(pred).map(k => html`<span class="awg-none-v">${k}=${T("val|none")}</span>`)];
  const awgCols = [awgGrp(k => k[0] === "J"), awgGrp(k => k[0] === "S"), awgGrp(k => k[0] === "H"), awgGrp(k => !"JSH".includes(k[0]))];
  const rows = peers.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || String(a.name).localeCompare(String(b.name)));
  const ifaceRows = rows.map(p => ({ p, t: p.targets.find(d => d.node === node && d.iface === iface) || {} }));
  const ifaceShown = {};
  for (const { p, t } of ifaceRows) (ifaceShown[p.id] = ifaceShown[p.id] || new Set()).add(tkey(t.node, t.iface));
  const ql = q.trim().toLowerCase();
  const ifaceFiltered = !ql ? ifaceRows : ifaceRows.filter(({ p, t }) => {
    const u = p.user_id ? Store.user(p.user_id) : null;
    return searchMatch((p.title || "") + " " + (p.name || "") + " " + (t.ip || "") + " " + (u ? u.name : ""), ql);
  });

  return html`<div class="screen">
    <${NodeRail} active=${node}/>
    <div class="crumb"><a href="#/nodes">${T("col|Nodes")}</a><span class="sep">/</span><a href=${"#/node/" + encodeURIComponent(node)}>${dname}</a><span class="sep">/</span><b>${iface}</b></div>
    <div class="detail-head">
      <div class="title"><h1>${iface}</h1><span class=${"iftype " + type + (type === "awg" && awgDict3(ap) ? " awg3" : "")} ...${tip3(type === "awg" && awgDict3(ap))}>${type}</span>${meta ? awgSwitchTag(node, iface) : null}${missIf ? html`<span class="nstat down"><${Ic} i="warn"/> ${T("tag|missing")}</span>` : ghostIf ? html`<span class="nstat down"><${Ic} i="warn"/> ${T("tag|ghost")}</span>` : istopped ? html`<span class="nstat stopped" title=${T("Stopped by you — Start it whenever you're ready")}><${Ic} i="stop"/> ${T("tag|stopped")}</span>` : idown ? html`<span class="nstat down" style="cursor:pointer" title=${(nrec.cmd_errors || {})[iface] || (T("down on the node — {v1}", { v1: idown }))} onClick=${() => openConfirm({ title: T("Interface down on the node"), log: (nrec.cmd_errors || {})[iface] || (T("down on the node — {v1}", { v1: idown })), confirmLabel: T("Close") })}><${Ic} i="warn"/> ${T("tag|down")}</span>` : live ? html`<span class="reporting">${T("reporting")}</span>` : html`<span class="nstat stale"><${Ic} i="info"/> ${T("stale")}</span>`}<span class="when"><${OnlinePeersTag} nodeId=${node} iface=${iface} total=${peers.length} orphans=${orphCount(node, iface)}/></span></div>
      <div class="grow"></div>
    </div>
    ${idown ? html`<div class="notice warn"><${Ic} i="warn"/><span>${ifaceDownNote((nrec.cmd_errors || {})[iface] || idown, type, nrec.kind === "docker")}</span>
      ${
        (() => { const bi = brokenIface(node, iface); return bi ? html`<button class="btn btn-mini restore" style="margin-left:auto;flex:none" disabled=${!bi.ripe}
          title=${bi.ripe ? T("The device is gone from the node — rebuild it from the saved config with its original server key") : T("Confirming it's really down (a couple of minutes) before Rebuild is offered")}
          onClick=${() => confirmRebuildInterface(node, iface, bi)}><${Ic} i="refresh"/> ${T("Rebuild interface")}</button>` : null; })()}
      </div>` : null}

    ${missIf ? html`<${Fragment}>
        <div class="notice warn"><${Ic} i="warn"/><span>${ifaceGoneNote(iface, dname, missIf.key_source
      ? T("Its original server key is recoverable, so Restore recreates it cleanly and every peer below reconnects with no changes.")
      : T("Its original server key can't be recovered, so Restore recreates it with a NEW key and the peers below must re-import a fresh config."))}</span></div>
        <${Panel} icon="key" title=${T("Interface details (saved)")} tone=""
          actions=${html`<button class="btn btn-mini restore" disabled=${!missIf.ripe} title=${missIf.ripe ? T("Recreate this interface with its original identity — recovers every peer on it") : T("Confirming it's really gone (a couple of minutes) before Restore is offered")} onClick=${() => confirmRestoreInterface(node, iface, missIf)}><${Ic} i="refresh"/> ${T("Restore interface")}</button>`}>
          <div class="iface-grid">
            <div class="ig-item"><span class="ig-l">${T("col|Endpoint")}</span><span class="ig-v">${((missIf.address ? missIf.address.split("/")[0] : "") + (missIf.listen_port ? ":" + missIf.listen_port : "")) || "—"}</span></div>
            <div class="ig-item"><span class="ig-l">${T("Server address")}</span><span class="ig-v">${missIf.address || "—"}</span></div>
            <div class="ig-item"><span class="ig-l">${T("Subnet")}</span><span class="ig-v">${missIf.subnet || "—"}</span></div>
            <div class="ig-item"><span class="ig-l">${T("Listen port")}</span><span class="ig-v">${missIf.listen_port || "—"}</span></div>
          </div>
          ${type === "awg" ? awgFold(html`<div class="iface-grid" style="margin-top:8px">${awgCols.map(g => html`<div class="ig-item"><span class="ig-v">${g.length ? g.map(l => html`<span>${l}</span>`) : "—"}</span></div>`)}</div><${Awg3Row} ap=${ap}/>`) : null}
        <//></>`
      : ghostIf ? html`<${Fragment}>
          <div class="notice danger"><${Ic} i="warn"/><span>${Trich("Interface *{iface}* is gone from {node} with *no recoverable key*, so it can't be restored — this view is *read-only*. Recreating it means a *new server key*, and every peer below must *re-import* a fresh QR / config. The only action here is *Recreate and rekey interface*.", { iface, node: dname })}</span></div>
        <${Panel} icon="key" title=${T("Interface (lost — no recoverable key)")} tone=""
          actions=${html`<button class="btn btn-mini ghost" disabled=${!ghostIf.ripe} title=${ghostIf.ripe ? T("Recreate this interface with a NEW key and rekey every peer on it (clients re-import)") : T("Confirming it's really gone (a couple of minutes) before Recreate is offered")} onClick=${() => openRecreateRekey(node, iface)}><${Ic} i="refresh"/> ${T("Recreate and rekey interface")}</button>`}>
          <div class="iface-grid">
            <div class="ig-item"><span class="ig-l">${T("Subnet")}</span><span class="ig-v">${ghostIf.subnet || "—"}</span></div>
            <div class="ig-item"><span class="ig-l">${T("Peers affected")}</span><span class="ig-v">${ghostPeers(node, iface).length}</span></div>
          </div>
        <//></>`
      : !meta ? html`<div class="notice warn"><${Ic} i="warn"/><span>${T("This interface hasn't been reported in a snapshot yet.")}</span></div>`
      : html`<${Panel} icon="key" title=${T("Interface details")} tone=${type === "awg" ? "" : "online"}
          actions=${Store.ifaceGone[node + "|" + iface]
            ? html`<${StatusTag} cls="tg-del" icon="clock" label="deleting" title=${T("The node tears it down on its next sync")}/>`
            : html`<${Fragment}>${op && op.phase === "busy" ? html`<span class="tg-busy"><${Ic} i="clock"/>${ifopBusy(op.verb)}…</span>` : op && op.phase === "ok" ? html`<span class="tg-ok"><${Ic} i="check"/>${ifopDone(op.verb)}</span>` : op && op.phase === "fail" ? html`<${StatusTag} cls="tg-del" icon="warn" label=${ifopFail(op.verb)} msg=${op.err || T("the action failed on the node")} title=${T("Action failed on the node")}/>` : null}${(op && op.phase === "busy") ? null : notup
              ? html`<button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down / converting") : T("Bring this interface up on the node")} onClick=${() => startOrRestartIface(node, iface, "start")}><${Ic} i="play"/> ${(isMobile() ? T("rowact|Start") : T("Start service"))}</button>`
              : html`<${Fragment}><button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down / converting") : T("Take this interface down on the node (stays down until started)")} onClick=${() => startOrRestartIface(node, iface, "stop")}><${Ic} i="stop"/> ${(isMobile() ? T("rowact|Stop") : T("Stop service"))}</button><button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down / converting") : T("Bounce this interface's service on the node")} onClick=${() => startOrRestartIface(node, iface, "restart")}><${Ic} i="refresh"/> ${(isMobile() ? T("rowact|Restart") : T("Restart service"))}</button><//>`}<button class="btn btn-mini" disabled=${blocked || (op && op.phase === "busy")} title=${blocked ? T("Unavailable while the node is down / converting") : ""} onClick=${() => openEditIface(node, iface)}><${Ic} i="pencil"/>${(isMobile() ? T("Edit") : T("Edit interface"))}</button><button class="btn btn-mini danger" disabled=${blocked || (op && op.phase === "busy")} title=${T("Stop + remove this interface and its peers' deployments on it")} onClick=${() => openModal(html`<${DeleteIfaceSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button><//>`}>
        <div class="iface-grid">
          <div class="ig-item"><span class="ig-l">${T("col|Endpoint")}</span><span class="ig-v">${meta.endpoint || "—"}</span></div>
          <div class="ig-item"><span class="ig-l">${T("Server address")}</span><span class="ig-v">${meta.address || "—"}</span></div>
          <div class="ig-item"><span class="ig-l">${T("Traffic")}</span><span class="ig-v">${ifTrafficBadge(meta, node)}</span></div>
          ${(() => {
            const d = meta.drops;
            return html`<div class="ig-item"><span class="ig-l">${T("col|Drops")}</span><span class="ig-v">${d
              ? html`<${DropsPop} d=${d} iface=${iface} node=${node} alignRight=${false}
                  trigger=${html`<${DropsFigure} d=${d}/>`}/>`
              : html`<span class="faint" title=${T("This node hasn't reported drop counters for this interface yet.")}>—</span>`}</span></div>`;
          })()}
        </div>
        ${type === "awg" ? awgFold(html`<div class="iface-grid" style="margin-top:8px">
            ${awgCols.map(g => html`<div class="ig-item"><span class="ig-v">${g.length ? g.map(l => html`<span>${l}</span>`) : "—"}</span></div>`)}
          </div>
          <${Awg3Row} ap=${ap}/>`) : null}
      <//>`}

    ${meta ? html`<${IfaceThroughput} node=${node} iface=${iface}/>` : null}

    ${turnEnabled() ? html`<${TurnProxiesBlock} node=${node} nrec=${nrec} metas=${Store.describe[node] || {}} title=${isMobile() ? T("Reachable via") : T("Reachable via turn-proxy")} iface=${iface}/>` : null}

    <${Panel} icon="users" title=${T("Peers on this interface")} count=${peers.length} pad=${false}
        lead=${html`<div class="search hdr"><${Ic} i="search"/><input placeholder=${T("Search title, user, address…")} value=${q} onInput=${e => setQ(e.target.value)}/></div>`}
        actions=${Store.ifaceGone[node + "|" + iface] ? null
          : html`<button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down / converting") : ""} onClick=${() => openCreatePeer({ node, iface, lock: true })}><${Ic} i="plus"/> ${T("Add peer")}</button>`}>
      <${PeerGrid} rows=${ifaceFiltered} agg=${false} node=${node} iface=${iface} shownByPeer=${ifaceShown} q=${q} blocked=${blocked}/>
    <//>

    ${orphans.length ? html`<div id="iface-orphans"><${Panel} icon="warn" title=${T("Unmanaged on this interface")} tone="warn" pad=${false}
        actions=${html`<button class="btn btn-mini" onClick=${() => orphans.forEach(o => mutate({
          key: "orphan:" + o.node + "|" + o.iface + "|" + o.pubkey,
          patch: adoptOrphanPatch(o),
          call: () => api.peerAdopt({ pubkey: o.pubkey, psk: o.preshared_key || "", target: { node: o.node, iface: o.iface, ip: (o.allowed_ips || "").split("/")[0] } }),
        }))}><${Ic} i="link"/> ${T("Adopt all")}</button>`}>
      <table><tbody>
        ${orphans.map(o => html`<${OrphanRow} key=${o.node + "|" + o.iface + "|" + o.pubkey} o=${o}/>`)}
      </tbody></table>
    <//></div>` : null}
  </div>`;
}

export function WdttIfaceDetail({ node, iface, w, nrec, missing, kind }) {
  useStore();
  const [q, setQ] = useState("");
  const isCsq = kind === "csqtt";
  const dname = nrec.name || node;
  const live = Store.recon.nodeStatus[node] === "live";
  const blocked = !live || inProc(nrec.proc_status);
  const cfg = (isCsq ? (nrec.csqtt_cfg || {}) : (nrec.wdtt_cfg || {}))[iface] || {};
  const unclaimed = w ? (w.unclaimed === true || (w.unclaimed === undefined && !Object.keys(cfg).length)) : false;
  const fork = w.fork || cfg.fork || (isCsq ? "csqtt" : "amurcanov");
  const active = w.active === "active";
  const awaiting = !!w.await_restore || !!missing;
  const stopped = !!cfg.stopped;
  const failErr = (nrec.cmd_errors || {})[iface] || "";
  const never = !!missing && !!failErr && !((nrec.wdtt_vault || {})[iface]);
  const restorableK = !isCsq && !!((nrec.wdtt_vault || {})[iface]);
  const notup = !active && !awaiting;
  const restoring = (nrec.wdtt_restoring || []).includes(iface);
  const restorable = restorableK;
  const op = Store.ifaceOp[node + "|" + iface];
  const peers = Store.recon.peers.filter(p => p.targets.some(t => t.node === node && t.iface === iface));
  const rows = peers.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || String(a.name).localeCompare(String(b.name)));
  const ifaceRows = rows.map(p => ({ p, t: p.targets.find(d => d.node === node && d.iface === iface) || {} }));
  const ifaceShown = {}; for (const { p, t } of ifaceRows) (ifaceShown[p.id] = ifaceShown[p.id] || new Set()).add(tkey(t.node, t.iface));
  const ql = q.trim().toLowerCase();
  const ifaceFiltered = !ql ? ifaceRows : ifaceRows.filter(({ p, t }) => { const u = p.user_id ? Store.user(p.user_id) : null; return searchMatch((p.title || "") + " " + (p.name || "") + " " + (t.ip || "") + " " + (u ? u.name : ""), ql); });
  const opFlash = op && op.phase === "busy" ? html`<span class="tg-busy"><${Ic} i="clock"/>${ifopBusy(op.verb)}…</span>`
    : op && op.phase === "ok" ? html`<span class="tg-ok"><${Ic} i="check"/>${ifopDone(op.verb)}</span>`
    : op && op.phase === "fail" ? html`<${StatusTag} cls="tg-del" icon="warn" label=${ifopFail(op.verb)} msg=${op.err || T("the action failed on the node")} title=${T("Action failed on the node")}/>` : null;
  const kindLabel = isCsq ? "CSQTT" : "WDTT";
  const lineSuffix = isCsq ? " " + csqttRunLine(node, iface) : "";
  return html`<div class="screen">
    <${NodeRail} active=${node}/>
    <div class="crumb"><a href="#/nodes">${T("col|Nodes")}</a><span class="sep">/</span><a href=${"#/node/" + encodeURIComponent(node)}>${dname}</a><span class="sep">/</span><b>${iface}</b></div>
    <div class="detail-head">
      <div class="title"><h1>${iface}</h1><span class=${"iftype " + (isCsq ? "csqtt" : "wdtt")}>${kindLabel}</span><${ForkTag} fork=${fork} suffix=${lineSuffix}/>${awaiting ? html`<span class="nstat down"><${Ic} i="shield"/> ${missing ? T("tag|missing") : T("awaiting restore")}</span>` : (op && op.phase === "busy") ? html`<span class="tg-busy"><${Ic} i="clock"/>${ifopBusy(op.verb)}</span>` : stopped ? html`<span class="nstat stopped" title=${T("Stopped by you — Start it whenever you're ready")}><${Ic} i="stop"/> ${T("tag|stopped")}</span>` : active ? html`<span class="reporting">${T("tag|running")}</span>` : html`<span class="nstat stale"><${Ic} i="clock"/> ${T("tag|starting")}</span>`}<span class="when"><${OnlinePeersTag} nodeId=${node} iface=${iface} total=${peers.length} orphans=${0}/></span></div>
      <div class="grow"></div>
    </div>
    ${never ? html`<div class="notice warn"><${Ic} i="warn"/><span>${Trich("The node refused to install this server, so it was never created: *{err}*. Fix that and create it again, or remove it — there is no identity to restore and nothing to recreate.", { err: failErr })}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary danger" onClick=${() => openModal(isCsq ? html`<${CsqttDeleteSheet} node=${node} iface=${iface}/>` : html`<${WdttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/> ${T("Remove this server")}</button></div></span></div>`
    : awaiting ? html`<div class="notice warn"><${Ic} i="shield"/><span>${missing ? T("This node isn't reporting this server — it's gone from the box (a rebuild, or a node running a build without WDTT support).") : T("This server was wiped.")} ${restorable
      ? Trich("Its identity is escrowed in your Encryption Vault, so it's held offline rather than coming back with a fresh key that would break every user. *Restore* to bring it back with its original identity, or *Recreate fresh* (every user re-imports).")
      : Trich("*No identity is escrowed for it*, so it can only come back with a new key — every user re-imports.")}
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">${restorable ? html`<button class="btn btn-primary" disabled=${restoring} onClick=${() => wdttRestoreIdentity(node, iface)}><${Ic} i="shield"/> ${restoring ? T("Restoring…") : T("Restore server identity")}</button>` : null}<button class=${restorable ? "btn btn-ghost" : "btn btn-primary"} disabled=${restoring} onClick=${() => wdttRecreateFresh(node, iface)}>${T("Recreate fresh")}</button></div></span></div>` : null}
    <${Panel} icon="key" title=${T("Interface details")} tone="online"
        actions=${Store.ifaceGone[node + "|" + iface]
          ? html`<${StatusTag} cls="tg-del" icon="clock" label="deleting" title=${T("The node tears it down on its next sync")}/>`
          : unclaimed ? null
          : html`<${Fragment}>${opFlash}${(op && op.phase === "busy") || awaiting ? null : notup
          ? html`<button class="btn btn-mini" disabled=${blocked || awaiting} title=${blocked ? T("Unavailable while the node is down") : (isCsq ? T("Bring this csqtt server up on the node") : T("Bring this WDTT server up on the node"))} onClick=${() => (isCsq ? startOrRestartCsqtt : startOrRestartWdtt)(node, iface, "start")}><${Ic} i="play"/> ${(isMobile() ? T("rowact|Start") : T("Start service"))}</button>`
          : html`<${Fragment}><button class="btn btn-mini" disabled=${blocked} title=${(isCsq ? T("Take this csqtt server down (stays down until started)") : T("Take this WDTT server down (stays down until started)"))} onClick=${() => (isCsq ? startOrRestartCsqtt : startOrRestartWdtt)(node, iface, "stop")}><${Ic} i="stop"/> ${(isMobile() ? T("rowact|Stop") : T("Stop service"))}</button><button class="btn btn-mini" disabled=${blocked} title=${(isCsq ? T("Bounce this csqtt server on the node") : T("Bounce this WDTT server on the node"))} onClick=${() => (isCsq ? startOrRestartCsqtt : startOrRestartWdtt)(node, iface, "restart")}><${Ic} i="refresh"/> ${(isMobile() ? T("rowact|Restart") : T("Restart service"))}</button><//>`}<button class="btn btn-mini" disabled=${blocked || awaiting || (op && op.phase === "busy")} title=${blocked ? T("Unavailable while the node is down") : ""} onClick=${() => (isCsq ? openEditCsqtt(node, iface) : openEditWdtt(node, iface))}><${Ic} i="pencil"/>${(isMobile() ? T("Edit") : T("Edit interface"))}</button><button class="btn btn-mini danger" disabled=${blocked || (op && op.phase === "busy")} title=${(isCsq ? T("Stop + remove this csqtt server and disconnect its users") : T("Stop + remove this WDTT server and disconnect its users"))} onClick=${() => openModal(isCsq ? html`<${CsqttDeleteSheet} node=${node} iface=${iface}/>` : html`<${WdttDeleteSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button><//>`}>
      <div class="iface-grid">
        <div class="ig-item"><span class="ig-l">${T("col|Endpoint")}</span><span class="ig-v">${w.listen || cfg.listen || "—"}</span></div>
        <div class="ig-item"><span class="ig-l">${T("Server address")}</span><span class="ig-v">${(isCsq ? (w.tun_addr || cfg.tun_addr) : w.wg_addr) || "—"}</span></div>
        <div class="ig-item"><span class="ig-l">${T("Traffic")}</span><span class="ig-v">${ifTrafficBadge(cfg, node)}</span></div>
        <div class="ig-item"><span class="ig-l">${T("Fork")}</span><span class="ig-v"><${ForkTag} fork=${fork} suffix=${lineSuffix}/></span></div>
      </div>
    <//>

    <${IfaceThroughput} node=${node} iface=${iface}/>

    ${turnEnabled() ? html`<${TurnProxiesBlock} node=${node} nrec=${nrec} metas=${Store.describe[node] || {}} title=${isCsq ? T("CSQTT proxy") : T("WDTT proxy")} iface=${iface}/>` : null}

    <${Panel} icon="users" title=${T("Peers on this interface")} count=${peers.length} pad=${false}
        lead=${html`<div class="search hdr"><${Ic} i="search"/><input placeholder=${T("Search title, user, address…")} value=${q} onInput=${e => setQ(e.target.value)}/></div>`}
        actions=${Store.ifaceGone[node + "|" + iface] ? null
          : html`<button class="btn btn-mini" disabled=${blocked} title=${blocked ? T("Unavailable while the node is down") : ""} onClick=${() => openCreatePeer({ node, iface, lock: true })}><${Ic} i="plus"/> ${T("Add peer")}</button>`}>
      <${PeerGrid} rows=${ifaceFiltered} agg=${false} node=${node} iface=${iface} shownByPeer=${ifaceShown} q=${q} blocked=${blocked}/>
    <//>
  </div>`;
}

export function OrphanRow({ o }) {
  return html`<tr>
    <td data-label=${T("col|Status")}><${Badge} s="orphan"/></td>
    <td data-label=${T("Key")} class="addr">${o.pubkey.slice(0, 22)}…</td>
    <td data-label=${T("col|Address")}><span class="addr">${o.iface} · ${o.allowed_ips || "—"}</span></td>
    <td data-label="" style="text-align:right" class="rowacts">
      <button class="btn btn-mini" onClick=${() => mutate({
        key: "orphan:" + o.node + "|" + o.iface + "|" + o.pubkey,
        patch: adoptOrphanPatch(o),
        call: () => api.peerAdopt({ pubkey: o.pubkey, psk: o.preshared_key || "", target: { node: o.node, iface: o.iface, ip: (o.allowed_ips || "").split("/")[0] } }),
      })}>${T("Adopt")}</button>
      <${RowError} k=${"orphan:" + o.node + "|" + o.iface + "|" + o.pubkey}/>
    </td></tr>`;
}

export function openCreateIface(node) { openModal(html`<${LoadIfaceSheet} node=${node}/>`); }
export function BridgePortSheet({ iface, port }) {
  const p = port || "PORT";
  const portsLine = `- "${p}:${p}/udp"`;
  return html`<${Sheet} title=${T("Publish port · {v1}", { v1: iface })}>
    <div class="iface-intro big"><div>${Trich("Creation requested — it applies on the node's next sync. This node runs on `bridge` networking, so this interface's UDP port isn't reachable from outside until you publish it on the host (otherwise peers won't handshake — rx stays 0).")}</div></div>
    <div class="field"><label>${dockerPortsStep()}</label><div class="ipk-field"><span class="ipk-val" style="text-align:left">${portsLine}</span><button class="copybtn" onClick=${() => copy(portsLine, T("Copied"))}><${Ic} i="copy"/></button></div></div>
    <div class="field"><label>${T("2. Apply (in the node's compose dir)")}</label><div class="ipk-field"><span class="ipk-val" style="text-align:left">docker compose up -d</span><button class="copybtn" onClick=${() => copy("docker compose up -d", T("Copied"))}><${Ic} i="copy"/></button></div><div class="hint">${T("Re-installing the node with host networking avoids per-port publishing entirely.")}</div></div>
  <//>`;
}

const AWG3_KEYS = AWG_ORDER.slice(AWG_ORDER.indexOf("HeaderProtectionKey"));
function Awg3Row({ ap }) {
  const has = k => String((ap || {})[k] ?? "").trim() !== "";
  if (!AWG3_KEYS.some(has)) return null;
  const words = k => k.split(/(?=[A-Z])/).flatMap((w, i) => i ? [html`<wbr/>`, w] : [w]);
  const kv = k => html`<span>${words(k)}=<wbr/><span class="awg3-v">${k === "HeaderProtectionKey" ? T("val|set") : k === "RandomTrailers" ? T("val|on") : ap[k]}</span></span>`;
  const cols = [["HeaderProtectionKey", "RandomTrailers", "DisableCookies"], ...AWG3_EDIT_COLS].map(g => g.filter(has).map(kv));
  return html`<div class="awg3-cap">${T("AmneziaWG 3.1")}</div><div class="iface-grid awg3-row">
    ${cols.map(g => html`<div class="ig-item"><span class="ig-v">${g.length ? g : "—"}</span></div>`)}
  </div>`;
}
export const AWG3_EDIT_COLS = [["ContentPaddingAddition", "MaxHandshakeAttempts"], ["RekeyAfterTime", "RekeyTimeout"], ["RejectAfterTime", "KeepaliveTimeout"]];
export const awgIsNone = v => String(v == null ? "" : v).trim() === "-";
export const AWG_COLS = [["Jc", "Jmin", "Jmax"], ["S1", "S2", "S3", "S4"], ["H1", "H2", "H3", "H4"], ["I1", "I2", "I3", "I4", "I5"]];
export function awgOmitIssue(d, template) {
  const n = AWG_COLS[0].filter(k => awgIsNone((d || {})[k])).length;
  if (n && n < 3) return T("Jc, Jmin and Jmax go together — set all three to -, or none of them.");
  if (template && AWG_ORDER.slice(0, AWG_ORDER.indexOf("HeaderProtectionKey")).every(k => awgIsNone((d || {})[k])))
    return T("Every field is - — leave at least one, or use WireGuard interfaces.");
  return "";
}
export const awgW1 = (d, rtOn) => rtOn && awgIsNone((d || {}).ContentPaddingAddition)
  ? T("ContentPaddingAddition is none while RandomTrailers is on — every small packet is padded about five times over.") : "";
export function Awg3Grid({ value, onKey, hpk, rt, hpkTip, rtTip, hint, placeholders }) {
  const v = value || {};
  return html`<div class="awg3-cap">${T("AmneziaWG 3.1")}</div>${hint ? html`<p class="hint awg3-hint">${hint}</p>` : null}<div class="awg-cols awg3-cols">
    <div class="awg-col"><label class="awg-f"><span>HeaderProtectionKey</span><input class="awg-ro" readonly value=${hpk} title=${hpkTip}/></label>
      <label class="awg-f"><span>RandomTrailers</span><input class="awg-ro" readonly value=${rt} title=${rtTip}/></label></div>
    ${AWG3_EDIT_COLS.map(grp => html`<div class="awg-col">${grp.map(k => html`<label class="awg-f"><span>${k}</span><input value=${v[k] == null ? "" : v[k]}
      class=${awgIsNone(v[k]) ? "awg-none" : null} ...${placeholders ? { placeholder: placeholders[k] || "" } : {}} onInput=${e => onKey(k, e.target.value)}/></label>`)}</div>`)}
  </div>${awgW1(v, !!rt && rt !== "—") ? html`<p class="hint warnish awg-omit-hint">${awgW1(v, true)}</p>` : null}`;
}
const awgLowS = d => ["S1", "S2", "S3", "S4"].some(k => { const v = String((d || {})[k] ?? "").trim(); return v !== "" && (!/^\d+$/.test(v) || +v < 12); });
const awg3Apps = () => T("Only apps that carry AmneziaWG 3.1 can connect: Amnezia VPN 5.0.1.5 or newer, AmneziaWG from the App Store or from GitHub (not the Google Play build), WG Tunnel 5.6 or newer. WINGS V, Keenetic and MikroTik cannot.");
export function AwgLoadLine({ node, nrec }) {
  const st = (nrec || {}).awg_load || null;
  const name = (nrec || {}).name || node;
  const pending = !!st && st.state === "pending";
  const res = st && st.msg && (st.age || 0) < 3600 ? srvText(st.msg) : "";
  if (!nrec || (!nrec.awg31_loadable && !pending && !res)) return null;
  const ask = () => openConfirm({ title: T("Load AmneziaWG 3.1 · {name}", { name }), confirmLabel: T("Load now"), warn: true,
    body: T("Every AmneziaWG interface on {name} restarts on the new kernel module. Connected devices lose traffic for about 15 seconds while they reconnect; nothing else changes. Or leave it: the module loads at the next reboot if the kernel accepts it; the node page says why when it does not.", { name }),
    onConfirm: async () => { const r = await api.awgLoad({ id: node }); if (!r.ok) return toast(srvText(r) || T("Failed"), "err"); await Store.poll(); } });
  if (pending) return html`<div class="hint warnish">${T("Loading the AmneziaWG module on {name}…", { name })}</div>`;
  return html`<div class="awgload">${res ? html`<div class=${"hint" + (st.state !== "done" ? " err" : "")}>${res}</div>` : null}${nrec.awg31_loadable
    ? html`<div class="hint"><button type="button" class="linkbtn" onClick=${ask}>${T("Load now")}</button></div>` : null}</div>`;
}
export function AwgGenField({ value, onChange, no3, no2, label, hint, was, node, nrec }) {
  label = label || T("AmneziaWG version");
  const why = value === "3.1" ? no2 : no3;
  const say = why || hint || ((was == null || value !== was)
    ? (value === "3.1" ? (was == null ? awg3Apps() : "") : T("Every AmneziaWG app can connect.")) : "");
  return html`<div class="field awggen"><label>${label}</label>
    <div class="dpsw awgsw" role="radiogroup" aria-label=${label}>${[["2.0", no2], ["3.1", no3]].map(([g, no]) => html`<button type="button" role="radio" key=${g}
      aria-checked=${value === g} class=${(value === g ? "on" : "") + (g === "3.1" ? " sw-awg3" : "")} disabled=${value !== g && !!no}
      title=${value !== g && no ? no : null} onClick=${() => onChange(g)}>${g}</button>`)}</div>
    ${say ? html`<div class="hint">${say}</div>` : null}
    ${nrec ? html`<${AwgLoadLine} node=${node} nrec=${nrec}/>` : null}
  </div>`;
}
function AwgDevicesSheet({ node, iface }) {
  useStore();
  const [q, setQ] = useState(""), [page, setPage] = useState(1);
  const all = Store.recon.peers.map(p => ({ p, t: p.targets.find(t => t.node === node && t.iface === iface) })).filter(x => x.t)
    .sort((a, b) => String(a.p.title || "").localeCompare(String(b.p.title || "")));
  const who = x => { const u = x.p.user_id != null ? Store.user(x.p.user_id) : null; return u ? u.name : ""; };
  const ql = q.trim().toLowerCase();
  const rows = ql ? all.filter(x => ((x.p.title || "") + " " + who(x) + " " + (x.t.ip || "")).toLowerCase().includes(ql)) : all;
  const pg = Math.min(page, Math.max(1, Math.ceil(rows.length / LIST_PAGE)));
  return html`<${Sheet} title=${T("Devices on {v1}", { v1: iface })} width=${560} noGuard=${true}
    foot=${html`<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Back")}</button>`}>
    ${all.length > LIST_PAGE ? html`<input class="reachev-filter awgdev-filter" value=${q} placeholder=${T("Filter by device, user or address…")}
      aria-label=${T("Filter by device, user or address…")} onInput=${e => { setQ(e.target.value); setPage(1); }}/>` : null}
    ${rows.length ? html`<div class="reachev-list">${pageSlice(rows, pg).map(x => html`<div class="reachev-row awgdev" key=${x.p.id}>
        <span class="ifname">${x.p.title || T("Untitled")}</span><span class="faint">${who(x) || T("status|Unassigned")}</span><span class="grow"></span>
        <span class="mono faint">${x.t.ip || ""}</span></div>`)}</div>`
      : html`<div class="hint">${all.length ? T("No device matches “{q}”.", { q }) : T("No device is on this interface.")}</div>`}
    <${ListPager} page=${pg} setPage=${setPage} total=${rows.length}/>
  <//>`;
}
function AwgSwitchSheet({ node, iface, to, commit, sent }) {
  useStore();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [srvBlk, setSrvBlk] = useState(null);
  const meta = Store.ifaceMeta(node, iface) || {};
  const peers = Store.recon.peers.filter(p => p.targets.some(t => t.node === node && t.iface === iface));
  const users = new Set(peers.filter(p => p.user_id != null).map(p => p.user_id)).size;
  const fwd = turnProxiesFor(node, iface);
  const cant = svc => (turnForkList().find(f => f.id === turnFork(svc)) || {}).awg3 === false;
  const blk = to !== "3.1" ? [] : (srvBlk || fwd.filter(tp => cant(tp.service)).map(tp => ({ service: tp.service, title: tp.title || "", fork: turnFork(tp.service) })));
  const others = fwd.filter(tp => !blk.some(b => b.service === tp.service)).length;
  const lowS = to === "3.1" && awgLowS({ ...(meta.awg_params || {}), ...(sent || {}) });
  const go = async () => {
    if (busy || blk.length) return;
    setBusy(true); setErr("");
    let r;
    try { r = await commit(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && !r.ok) {
      setBusy(false);
      if (r.code === "turn_awg3" && Array.isArray(r.turn_proxies)) setSrvBlk(r.turn_proxies);
      else setErr(srvText(r) || T("save failed"));
    }
  };
  const devBtn = html`<button type="button" class="linkbtn" onClick=${() => pushModal(html`<${AwgDevicesSheet} node=${node} iface=${iface}/>`)}>${plural(peers.length, "device")}</button>`;
  const line = (tone, icon, body) => html`<div class=${"notice" + (tone ? " " + tone : "")}><${Ic} i=${icon}/><span>${body}</span></div>`;
  return html`<${Sheet} title=${to === "3.1" ? T("Switch {v1} to AmneziaWG 3.1", { v1: iface }) : T("Switch {v1} back to AmneziaWG 2.0", { v1: iface })} width=${620} noGuard=${true}
    foot=${html`<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button><button class="btn btn-danger"
      disabled=${busy || !!blk.length} title=${blk.length ? T("A turn proxy whose app carries AmneziaWG 2.0 only points here") : null} onClick=${go}>${busy
        ? html`<span class="spin sm"></span>${T("Working…")}` : to === "3.1" ? T("Switch to 3.1") : T("Switch back to 2.0")}</button>`}>
    ${blk.length ? html`<div class="notice danger"><${Ic} i="warn"/><div>
      <div>${T("The panel refuses this switch while these turn proxies point at {v1} — their app carries AmneziaWG 2.0 only:", { v1: iface })}</div>
      <ul class="awgsw-list">${blk.map(b => { const lp = (String(b.service).match(/-(\d+)$/) || [])[1];
        return html`<li key=${b.service}><b>${b.title || forkLabel(b.fork)}</b> <span class="faint">${forkLabel(b.fork)}${lp ? " · :" + lp : ""}</span></li>`; })}</ul>
      <div>${T("Point each at a 2.0 interface, or delete it, and switch once the node has applied that.")}</div></div></div>` : null}
    ${line("warn", "users", peers.length
      ? html`${T("Every device on {v1} needs the new config and cannot connect until it imports it.", { v1: iface })} ${users
          ? Trich("Affected: {v1} of {v2}.", { v1: devBtn, v2: plural(users, "gen|user") }) : Trich("Affected: {v1}.", { v1: devBtn })}`
      : T("No device is on this interface yet — nothing to re-import."))}
    ${nodeStale(node) ? line("warn", "clock", T("{v1} is not reporting — the switch applies when it is back. Until then its clients keep working on the old config, and new QR codes already show the new one.", { v1: Store.nodeName(node) })) : null}
    <div class="notice"><${Ic} i="info"/><ul class="awgsw-list awgsw-facts">
      <li>${subFeatureOn() ? T("Subscription pages and the panel's QR codes show the new config at once; each device still has to import it.")
        : T("The panel's QR codes show the new config at once; each device still has to import it.")}</li>
      ${others ? html`<li>${T("Turn proxies forwarding here: {v1} — their links carry the new config, and their users re-import it too.", { v1: others })}</li>` : null}
      ${lowS ? html`<li>${T("One of S1–S4 is below 12, which header protection refuses — the switch draws new ones.")}</li>` : null}
      ${to === "3.1" ? html`<li>${awg3Apps()}</li>` : null}
    </ul></div>
    ${err ? html`<div class="formmsg err">${err}</div>` : null}
  <//>`;
}
const awgTail = " · AWG";
const natTail = " · NAT";
const MIMIC_NAME = { off: () => T("mimic|Off"), quic: () => "QUIC (HTTP/3)", dns: () => T("DNS query"),
  builtin: () => T("Built-in"), custom: () => T("mimic|Custom") };
const MIMIC_TAIL = { off: () => T("disguise: off"), quic: () => T("disguise: QUIC"), dns: () => T("disguise: DNS"),
  builtin: () => T("disguise: built-in"), custom: () => T("disguise: custom") };
const mimicWhy = (k, c) => c.why === "big" ? T("{v1}: a random part is at most 1000 bytes — split it, like <r 1000><r 214>.", { v1: k })
  : c.why === "c" ? T("{v1}: <c> is gone from AmneziaWG 3.x, and apps refuse the whole config.", { v1: k })
  : c.why === "t2" ? T("{v1}: <t> appears twice — once per packet at most.", { v1: k })
  : c.why === "ctl" ? T("{v1}: holds a character apps cannot read — a line break, a tab, or anything outside plain ASCII.", { v1: k })
  : c.why === "huge" ? T("{v1}: more than one UDP packet can carry (65,507 bytes).", { v1: k })
  : c.why === "long" ? T("{v1}: longer than 4096 characters.", { v1: k })
  : T("{v1}: apps cannot read {v2} — use <b 0x…>, <r N>, <rc N>, <rd N> or <t>.", { v1: k, v2: c.tag });
const MIMIC_BIG = 1232;
const MIMIC_MONTH = 30 * 24 * 30;
export function MimicPick({ eff, was, port, peers, restart, bad, onPick }) {
  const mim = mimicOf(eff), changed = MIMIC_KEYS.some(k => String(eff[k] ?? "") !== String(was[k] ?? ""));
  const size = ([a, b]) => T("1 packet, {v1}–{v2} bytes", { v1: fmtNum(a), v2: fmtNum(b) });
  const opts = [
    { value: "off", label: html`${MIMIC_NAME.off()} <span class="faint">${T("no packets before the handshake")}</span>` },
    { value: "quic", label: html`${MIMIC_NAME.quic()} <span class="faint">${size(MIMIC_PRESETS.quic.sizes)}</span>` },
    { value: "dns", label: html`${MIMIC_NAME.dns()} <span class="faint">${size(MIMIC_PRESETS.dns.sizes)}</span>` },
    { value: "builtin", label: html`${MIMIC_NAME.builtin()} <span class="faint">${plural(MIMIC_BUILTIN_SIZE[0], "packet")}, ${fmtNum(MIMIC_BUILTIN_SIZE[1])} ${pluralWord(MIMIC_BUILTIN_SIZE[1], "byte")}</span>` },
    ...(mim === "custom" ? [{ value: "custom", label: MIMIC_NAME.custom(), disabled: true }] : []),
  ];
  const pk = MIMIC_KEYS.map(k => [k, mimicCheck(eff[k])]).filter(([, c]) => c.ok && c.bytes);
  const bytes = pk.reduce((n, [, c]) => n + c.bytes, 0), big = pk.find(([, c]) => c.bytes > MIMIC_BIG);
  const lp = String(port || "").trim(), fit = MIMIC_PRESETS[mim] && MIMIC_PRESETS[mim].port;
  const line = (t, cls) => html`<p class=${"hint mimic-line" + (cls ? " " + cls : "")}>${t}</p>`;
  const dev = plural(peers, "device"), preset = mim === "quic" || mim === "dns";
  const savedLine = () => !peers
    ? (mim === "off" ? T("Configs issued from now on carry no disguise.") : preset ? T("Configs issued from now on are disguised as {v1}.", { v1: MIMIC_NAME[mim]() })
      : T("Configs issued from now on carry the I1–I5 below."))
    : mim === "off" ? T("On Save, devices keep working. Configs issued or re-imported from now on carry no disguise. Devices on this interface keep their current one until re-imported ({v1}).", { v1: dev })
    : preset ? T("On Save, devices keep working. Configs issued or re-imported from now on are disguised as {v1}. Devices on this interface keep their current disguise until re-imported ({v2}).", { v1: MIMIC_NAME[mim](), v2: dev })
    : T("On Save, devices keep working. Configs issued or re-imported from now on carry the I1–I5 below. Devices on this interface keep their current ones until re-imported ({v1}).", { v1: dev });
  return html`<div class="mimic">
    <div class="mimic-row"><span class="mimic-lbl">${T("Disguise as")}</span>
      <${Dropdown} className="selwrap mimic-dd" value=${mim} options=${opts} short=${() => MIMIC_NAME[mim]()} ariaLabel=${T("Disguise as")} onChange=${onPick}/></div>
    ${bad ? line(bad, "err") : html`
      ${line(pk.length ? T("The disguise sends before each handshake: {v1}, {v2} — about {v3} a month for a device that stays connected.",
        { v1: plural(pk.length, "packet"), v2: fmtNum(bytes) + " " + pluralWord(bytes, "byte"), v3: fmtBytes((bytes + 28 * pk.length) * MIMIC_MONTH) }) : T("No packets before the handshake."))}
      ${big ? line(T("{v1} is {v2} — above 1232 it may be split on a 1280-byte path, and split packets stand out.", { v1: big[0], v2: fmtNum(big[1].bytes) + " " + pluralWord(big[1].bytes, "byte") }), "warnish") : null}
      ${mim === "builtin" ? line(T("The set every swgPanel install ships, the same on every server.")) : null}
      ${fit && lp && +lp !== fit ? line(T("QUIC looks most natural on UDP 443 — this interface listens on {v1}.", { v1: lp })) : null}
      ${mim !== "off" ? line(T("Changes only what the packets before each handshake look like. It does not help where only listed addresses are allowed — a TURN server is the way there.")) : null}
      ${changed ? line(html`${savedLine()}${restart
          ? " " + T("The interface restarts; connected devices reconnect in about 15 seconds.")   : ""}`, "mimic-save") : null}`}
  </div>`;
}
export function LoadIfaceSheet({ node, pre, ghost, back }) {
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const isBridge = nrec.kind === "docker" && (nrec.net_mode || "host") === "bridge";
  const _defProto = (pre && pre.proto) || "awg";
  const [proto, setProto] = useState(_defProto);
  const sugAwg = suggestIface(node, "awg"), sugWg = suggestIface(node, "wg");
  const sugWdtt = nextWdttName(node);
  const sugWdttNet = suggestSubnet(node);
  const sugWdttListen = suggestPort(node, "turn");
  const sugWdttWg = suggestPort(node, "turn", [sugWdttListen]);
  const [iface, setIface] = useState((pre && pre.iface) || (_defProto === "wdtt" ? sugWdtt : _defProto === "awg" ? sugAwg : sugWg)); const [subnet, setSubnet] = useState((pre && pre.subnet) || ((pre && pre.proto) === "wdtt" ? sugWdttNet : suggestSubnet(node)));
  const [port, setPort] = useState(String((pre && pre.port) || ((pre && pre.proto) === "wdtt" ? sugWdttListen : suggestPort(node, "iface"))));
  const _wdttForks = enabledTurnForks().filter(f => f.kind === "wdtt");
  const _forkBuildable = f => (f.wdtt_versions || []).length > 0;
  const [wgPort, setWgPort] = useState(String(sugWdttWg)); const [fork, setFork] = useState(((_wdttForks.find(f => (f.wdtt_versions || []).length) || _wdttForks[0] || {}).id) || "amurcanov");
  const wdttOk = turnEnabled() && nrec.turn_manage && nrec.turn_arch_ok !== false && enabledTurnForks().some(f => f.kind === "wdtt");
  const isWdtt = proto === "wdtt";
  const sugCsqtt = nextCsqttName(node);
  const sugCsqttNet = suggestSubnet(node);
  const sugCsqttListen = suggestPort(node, "turn");
  const [maxPw, setMaxPw] = useState("500");
  const _csqttForks = enabledTurnForks().filter(f => f.kind === "csqtt");
  const csqttOk = turnEnabled() && nrec.turn_manage && nrec.turn_arch_ok !== false && _csqttForks.length > 0;
  const [cfork, setCfork] = useState((_csqttForks[0] || {}).id || "csqtt");
  const [cline, setCline] = useState(CSQTT_DEFAULT_LINE);
  const isCsqtt = proto === "csqtt";
  const _idf = (Store.panelSettings || {}).interface_defaults || {};
  const [dns, setDns] = useState(pre && pre.dns != null ? pre.dns : (_idf.dns || ["1.1.1.1"]).join(", ")); const [mtu, setMtu] = useState(String((pre && pre.mtu) || _idf.mtu || 1280)); const [ka, setKa] = useState(String(pre && pre.keepalive != null ? pre.keepalive : (_idf.keepalive || 25)));
  const [reach, setReach] = useState((pre && pre.reach) || _idf.reach || "user");
  const no31 = nrec.awg31_no ? srvText(nrec.awg31_no) : "";
  const [genPick, setGen] = useState(null);
  const missing = (nrec.missing_ifaces || {})[iface.trim()];
  const gen = genPick || (pre && pre.gen) || (missing ? (awgDict3(missing.awg_params) ? "3.1" : "2.0")
    : no31 ? "2.0" : _idf.awg_gen || DEFAULT_AWG_GEN);
  const ips = ipChoices(nrec);
  const [eg, setEg] = useState(() => egressInit({}));
  const [blk, setBlk] = useState(() => defaultBlockFor(node));
  const blkSeeded = useRef(false);
  useEffect(() => { loadBlockCatalog().then(() => { if (blkSeeded.current) return; blkSeeded.current = true; setBlk(defaultBlockFor(node)); }); }, []);
  const [disc, setDisc] = useState({ routing: true, filters: false, advanced: false });
  const tog = k => setDisc(d => ({ ...d, [k]: !d[k] }));
  const _preEp = pre && pre.endpoint;
  const [hostSel, setHostSel] = useState(_preEp ? (ips.includes(_preEp) ? _preEp : "__custom__") : (ips[0] || "__custom__"));
  const [hostCustom, setHostCustom] = useState(_preEp && !ips.includes(_preEp) ? _preEp : "");
  const [pin, setPin] = useState("");
  const lst = useListenState(node, (isWdtt || isCsqtt) ? ipPickerVal(hostSel, hostCustom) : "", "", "", pin);
  const pickProto = p => {
    const untouched = iface === sugAwg || iface === sugWg || iface === sugWdtt || iface === sugCsqtt || !iface.trim();
    if (untouched) setIface(p === "wg" ? sugWg : p === "wdtt" ? sugWdtt : p === "csqtt" ? sugCsqtt : sugAwg);
    if (p === "wdtt") {
      if (!subnet.trim() || subnet === suggestSubnet(node)) setSubnet(sugWdttNet);
      if (!port.trim() || port === String(suggestPort(node, "iface"))) setPort(String(sugWdttListen));
      setWgPort(String(sugWdttWg));
    } else if (p === "csqtt") {
      if (!subnet.trim() || subnet === suggestSubnet(node)) setSubnet(sugCsqttNet);
      if (!port.trim() || port === String(suggestPort(node, "iface"))) setPort(String(sugCsqttListen));
    } else if (port === String(sugWdttListen) || port === String(sugCsqttListen)) {
      setPort(String(suggestPort(node, "iface")));
    }
    setProto(p);
  };
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const fail = t => { setBusy(false); setMsg({ k: "err", t }); };
  const save = async () => {
    setBusy(true); setMsg({ k: "work", t: T("requesting…") });
    const ee = egressSaveBlock(eg, nrec.routing_mode || "kernel"); if (ee) return fail(ee);
    if (ghost && Store.storeMode === "encrypted" && (ghost.peers || []).length && !subSKCached()) {
      const n = ghost.peers.length;
      await ensureVaultUnlocked({
        title: T("Unlock to capture the rekeyed configs"),
        reason: T("Recreating {v1} gives its {v2} brand-new keys once it's back. Unlock your encryption key now so each fresh config is captured the moment it's rekeyed — then it stays re-viewable in the panel and is served on the users' subscription pages.", { v1: ghost.iface, v2: plural(n, "peer") }),
        consequence: T("the interface is recreated and its peers are rekeyed, but their new configs are NOT captured — they can't be re-viewed or served on subscription pages, and you'd have to hand every client a fresh QR by other means. (Unlock later in this same tab before reloading and they're still saved; after a reload the new keys are gone for good.)"),
      });
      setMsg({ k: "work", t: T("requesting…") });
    }
    let r;
    if (isWdtt) {
      const nm = iface.trim();
      const _ne = turnIfaceNameError(node, nm, "wdtt"); if (_ne) return fail(_ne);
      if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(subnet.trim())) return fail(T("Enter the tunnel subnet as CIDR, e.g. 10.8.0.0/24."));
      if (wgPort.trim() && !/^\d+$/.test(wgPort.trim())) return fail(T("Internal WG port must be a number."));
      const _dtlsHost = ipPickerVal(hostSel, hostCustom).trim() || "0.0.0.0";
      r = await api.wdttSet({ node, iface: nm, wg_addr: subnetServerAddr(subnet.trim()), listen: _dtlsHost + ":" + (port.trim() || "56000"),
        wg_port: wgPort.trim() || "56001", fork, block: blk, reach, ...(pin ? { bind_ip: pin } : {}), ...egressBody(eg) });
    } else if (isCsqtt) {
      const nm = iface.trim();
      const _ne = turnIfaceNameError(node, nm, "csqtt"); if (_ne) return fail(_ne);
      if (!/\/24$/.test(subnet.trim())) return fail(T("csqtt needs a /24 tunnel subnet, e.g. 10.66.67.0/24."));
      if (maxPw.trim() && !/^\d+$/.test(maxPw.trim())) return fail(T("Max passwords must be a number."));
      const _lHost = ipPickerVal(hostSel, hostCustom).trim() || "0.0.0.0";
      r = await api.csqttSet({ node, iface: nm, tun_addr: subnetServerAddr(subnet.trim()), listen: _lHost + ":" + (port.trim() || "46000"),
        fork: cfork, max_passwords: maxPw.trim() || "500", block: blk, reach, ...(pin ? { bind_ip: pin } : {}), ...(cline !== CSQTT_DEFAULT_LINE ? { line: cline } : {}), ...egressBody(eg) });
    } else {
      const nm = iface.trim();
      if (!nm || /[\s/]/.test(nm)) return fail(T("Interface name is required (no spaces or /)."));
      if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(subnet.trim())) return fail(T("Enter the tunnel subnet as CIDR, e.g. 10.8.0.0/24."));
      if (port.trim() && !/^\d+$/.test(port.trim())) return fail(T("Listen port must be a number."));
      const hostVal = ipPickerVal(hostSel, hostCustom);
      r = await api.ifaceCreate({ node, iface: nm, protocol: proto, subnet: subnet.trim(), endpoint_host: hostVal,
        listen_port: port.trim(), dns: dns.trim(), mtu: mtu.trim(), keepalive: ka.trim(), block: blk, reach, ...egressBody(eg),
        ...(proto === "awg" ? { awg_gen: gen } : {}) });
    }
    if (!r.ok) return fail(srvText(r) || T("Request failed."));
    reportDropped(r);
    const _newName = iface.trim();
    Store.ifaceNew[node + "|" + _newName] = {
      type: proto, subnet: subnet.trim(), port: port.trim(), endpoint: ipPickerVal(hostSel, hostCustom), at: Date.now(),
      ...(proto === "awg" && gen === "3.1" ? { gen: "3.1" } : {}),
    };
    if (ghost) Store.ghostRekey[node + "|" + _newName] = { peers: ghost.peers || [], at: Date.now() };
    closeModal(); Store.apply(); await Store.poll();
    if (!isWdtt && !isCsqtt && isBridge) { openModal(html`<${BridgePortSheet} iface=${_newName} port=${port.trim()}/>`); return; }
    toast(ghost ? ((ghost.peers || []).length === 1
        ? T("Recreating {v1} — keep this tab open and its 1 peer is rekeyed automatically once it's back; otherwise rekey it from its peer view. Then hand out the fresh config.", { v1: _newName })
        : T("Recreating {v1} — keep this tab open and its {v2} are rekeyed automatically once it's back; otherwise rekey each from its peer view. Then hand out the fresh configs.", { v1: _newName, v2: plural((ghost.peers || []).length, "peer") }))
                : T("Interface creation requested — applies on the node's next sync."), "ok", ghost ? 6000 : 3600);
  };
  const _subConflict = (!ghost && subnet.trim()) ? subnetFleetConflict(subnet.trim(), null, null) : null;
  const _nameTaken = (!ghost && iface.trim()) ? (() => { const nm = iface.trim();
    if ((Store.describe[node] || {})[nm] || (nrec.wdtt_cfg || {})[nm] || (nrec.csqtt_cfg || {})[nm]
        || ((Store.stats[node] || {}).wdtt || []).some(w => w && w.iface === nm)
        || ((Store.stats[node] || {}).csqtt || []).some(c => c && c.iface === nm)) return "managed";
    return null; })() : null;
  const nameErr = _nameTaken === "managed" ? T("An interface named {v1} already exists on this node.", { v1: iface.trim() })
    : null;
  const pperr = portErrMsg(node, port, []);
  const wgperr = isWdtt ? ((port.trim() && wgPort.trim() && Number(port) === Number(wgPort)) ? T("The DTLS port and internal WG port must differ.") : portErrMsg(node, wgPort, [])) : null;
  return html`<${Sheet} title=${ghost ? T("Recreate & rekey · {iface}", { iface: ghost.iface }) : T("Create new interface")} onBack=${back || null}
    foot=${footRow({ onCancel: back || closeModal, disabled: busy || !!nameErr || !!_subConflict || !!pperr || !!wgperr || (!!egressSaveBlock(eg, nrec.routing_mode || "kernel")), title: (nameErr || pperr || wgperr || (_subConflict ? T("This subnet is already in use in the fleet") : (egressSaveBlock(eg, nrec.routing_mode || "kernel")))) || "", onAction: save, action: ghost ? T("Recreate & rekey") : T("Create") })}>
    ${ghost ? html`<div class="notice danger" style="margin-bottom:16px"><${Ic} i="warn"/><span>${
      ghost.warm && !ghost.total
        ? Trich("Interface *{iface}* is gone from {node} with *no recoverable key*, so it can't be restored — only recreated with a *new server key*. Nothing is deployed on it, so no client is affected. The settings below are its *last saved config* — review them and recreate.", { iface: ghost.iface, node: Store.nodeName(node) })
      : ghost.warm
        ? Trich("Interface *{iface}* is gone from {node} with *no recoverable key*, so it can't be restored — only recreated with a *new server key*. Its *{count}* will be rekeyed once it's back, so *every client must re-import* a fresh QR / config. The settings below are its *last saved config* — review them and recreate.", { iface: ghost.iface, node: Store.nodeName(node), count: plural(ghost.total, "peer") })
        : Trich("Interface *{iface}* is gone from {node} with *no recoverable key*, so it can't be restored — only recreated with a *new server key*. Its *{count}* will be rekeyed once it's back, so *every client must re-import* a fresh QR / config. Review the settings below (inferred from the peers) and recreate.", { iface: ghost.iface, node: Store.nodeName(node), count: plural(ghost.total, "peer") })
    }</span></div>` : null}
    <div class="field"><label>${T("Protocol")}</label>
      <div class=${"chiprow" + (ghost ? "" : " proto3")}>
        <button class=${"chip c-wg" + (proto === "wg" ? " on" : "")} onClick=${() => pickProto("wg")}>WireGuard</button>
        <button class=${"chip c-awg" + (proto === "awg" ? " on" : "")} onClick=${() => pickProto("awg")}>AmneziaWG</button>
        ${ghost || !wdttOk ? null : html`<button class=${"chip c-wdtt" + (proto === "wdtt" ? " on" : "")} onClick=${() => pickProto("wdtt")}>WDTT</button>`}
        ${ghost || !csqttOk ? null : html`<button class=${"chip c-csqtt" + (proto === "csqtt" ? " on" : "")} onClick=${() => pickProto("csqtt")}>CSQTT</button>`}
      </div>
    </div>
    ${proto === "awg" ? html`<${AwgGenField} value=${gen} onChange=${setGen} no3=${no31} no2="" node=${node} nrec=${nrec}/>` : null}
      <div class="row2">
        <div class="field"><label>${T("Interface name")}</label><input autofocus=${!ghost} class=${nameErr ? "bad" : ""} value=${iface} onInput=${e => { if (!ghost) setIface(e.target.value); }} readOnly=${!!ghost} placeholder=${proto === "wg" ? "wg1" : proto === "wdtt" ? "wdtt1" : proto === "csqtt" ? "csqtt1" : "awg1"} autocomplete="off"/>${ghost ? html`<div class="hint">${T("Fixed — must match the peers that reference it.")}</div>` : nameErr ? html`<div class="hint err">${nameErr}</div>` : null}</div>
        <div class="field"><label>${T("Tunnel subnet (CIDR)")}</label><input class=${_subConflict ? "bad" : ""} value=${subnet} onInput=${e => setSubnet(e.target.value)} placeholder="10.8.0.0/24" autocomplete="off"/>${_subConflict ? html`<div class="hint err">${subnetTaken(_subConflict.iface, Store.nodeName(_subConflict.node))}</div>` : null}</div>
      </div>
      ${(!isWdtt && !isCsqtt) ? html`<div class="row2">
        <div class="field"><label>${T("Endpoint host / IP")}</label>
          <${IpPicker} ips=${ips} sel=${hostSel} setSel=${setHostSel} custom=${hostCustom} setCustom=${setHostCustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/>
          <div class="hint">${T("What clients dial")}</div></div>
        <div class="field"><label>${T("Listen port")}</label><input class=${pperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder="51820"/>${pperr ? html`<div class="hint err">${pperr}</div>` : null}</div>
      </div>` : null}
      ${isCsqtt ? html`<div class="row2">
        <div class="field"><label>${T("Endpoint host / IP")}</label>
          <${IpPicker} ips=${ips} sel=${hostSel} setSel=${setHostSel} custom=${hostCustom} setCustom=${setHostCustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/>
          <${ListenHint} st=${lst} hint=${T("What clients dial (over the VK relay)")} fallback=${turnDialFallback(node)}/></div>
        <div class="field"><label>${T("Listen port")}</label><input class=${pperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder="46000"/>${pperr ? html`<div class="hint err">${pperr}</div>` : html`<div class="hint">${T("UDP DTLS listen (outside)")}</div>`}</div>
      </div>
      <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
      <${ListenNotice} st=${lst}/>
      <div class="row2">
        <div class="field"><label>${T("Server fork")}</label><${Dropdown} value=${cfork} onChange=${v => setCfork(v)} options=${forkOpts(_csqttForks)} ariaLabel=${T("Server fork")}/><div class="hint">${T("Which csqtt server implements this instance")}</div></div>
        <div class="field"><label>${T("Max users")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— optional")}</span></label><input value=${maxPw} onInput=${e => setMaxPw(e.target.value)} placeholder="500"/><div class="hint">${T("Cap on simultaneous access passwords · blank = 500")}</div></div>
      </div>
      <${CsqttVersionField} node=${node} value=${cline} onChange=${setCline}/>` : null}
      ${isBridge ? html`<div class="notice warn" style="margin:-6px 0 16px"><${Ic} i="warn"/><span>${Trich("This docker node uses `bridge` networking — after creating you must publish this port in the node's `docker-compose.yml` ({ports}) and `up -d`, or clients can't reach it. (A host-networking node needs none of this.)", { ports: 'ports: "' + (port || "PORT") + ":" + (port || "PORT") + '/udp"' })}</span></div>` : null}
      ${isWdtt ? html`<div class="row2">
        <div class="field"><label>${T("Server fork")}</label><${Dropdown} value=${fork} onChange=${v => setFork(v)} ariaLabel=${T("Server fork")}
          options=${forkOpts(_wdttForks, f => _forkBuildable(f) ? "" : T("no build published yet"))}/><div class="hint">${T("Which WDTT server implements this instance")}</div></div>
        <div class="field"><label>${T("Endpoint host / IP")}</label>
          <${IpPicker} ips=${ips} sel=${hostSel} setSel=${setHostSel} custom=${hostCustom} setCustom=${setHostCustom} placeholder=${T("vpn.xyz.com or 203.0.113.7")}/>
          <${ListenHint} st=${lst} fallback=${turnDialFallback(node)}/></div>
      </div>
      <${ListenOnField} node=${node} value=${pin} onChange=${setPin}/>
      <${ListenNotice} st=${lst}/>
      <div class="row2">
        <div class="field"><label>${T("Listen port")}</label><input class=${pperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder="51820"/>${pperr ? html`<div class="hint err">${pperr}</div>` : html`<div class="hint">${T("DTLS listen (outside)")}</div>`}</div>
        <div class="field"><label>${T("Internal WG port")}</label><input class=${wgperr ? "bad" : ""} value=${wgPort} onInput=${e => setWgPort(e.target.value)} placeholder="56001"/>${wgperr ? html`<div class="hint err">${wgperr}</div>` : html`<div class="hint">${T("Loopback userspace-WG port (server-internal)")}</div>`}</div>
      </div>` : null}
      <${Fragment}><${EgressPicker} node=${node} value=${eg} onChange=${setEg} noRules=${true}/>
      ${eg.mode === "smart" ? html`<${Disclosure} title=${rulesTitle(node)} sumCls="route"
        summary=${rulesSummary(node, eg.rows, eg.catchAll)}
        open=${disc.routing} onToggle=${() => tog("routing")}>
        <${RoutingRules} node=${node} iface=${iface} blk=${blk} rows=${eg.rows || []} catchAll=${eg.catchAll} exitIps=${eg.exitIps} directIp=${eg.ip || ""} onChange=${(rows, catchAll, exitIps, ip) => setEg({ ...eg, rows, catchAll, exitIps, ip })}/>
      <//>` : null}
      <${ReachField} value=${reach} onChange=${setReach} create=${true}
        unvouched=${  isWdtt ? !(_wdttForks.find(f => f.id === fork) || {}).reach_vouched
          : isCsqtt ? !(_csqttForks.find(f => f.id === cfork) || {}).reach_vouched : false}/>
      <${Disclosure} title=${T("Filters & abuse")} sumCls="on"
        summary=${blockActiveN(node, blk, eg.p2p) ? T("{v1} active", { v1: blockActiveN(node, blk, eg.p2p) }) : html`<span class="faint">${T("val|none")}</span>`}
        open=${disc.filters} onToggle=${() => tog("filters")}>
        <${BlockTraffic} node=${node} value=${blk} onChange=${setBlk} p2p=${eg.p2p} onP2p=${p => setEg(e => ({ ...e, p2p: p }))}/>
      <//>
      ${(!isWdtt && !isCsqtt) ? html`<${Disclosure} title=${T("Advanced settings")} summary=${T("MTU · keepalive · DNS") + (natPinApplies(eg) ? natTail : "")}
        open=${disc.advanced} onToggle=${() => tog("advanced")}>
        <div class="field secdiv"><label>${proto === "awg" ? T("AmneziaWG settings") : T("WireGuard settings")}</label></div>
        <div class="row2">
          <div class="field"><label>MTU</label><input value=${mtu} onInput=${e => setMtu(e.target.value)} placeholder="1280"/><div class="hint">${T("Blank = 1280")}</div></div>
          <div class="field"><label>${T("Persistent keepalive (s)")}</label><input value=${ka} onInput=${e => setKa(e.target.value)} placeholder="25"/><div class="hint">${T("0 disables · blank = 25")}</div></div>
        </div>
        <div class="field"><label>DNS</label><input value=${dns} onInput=${e => setDns(e.target.value)} placeholder="1.1.1.1"/><div class="hint">${T("Comma-separated")}</div></div>
        <${NatSourcePick} node=${node} value=${eg} onChange=${setEg}/>
      <//>` : null}<//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
export function DeleteIfaceSheet({ node, iface }) {
  const [txt, setTxt] = useState(""); const [busy, setBusy] = useState(false);
  const phrase = T("DELETE {v1}", { v1: iface });
  const ok = txt === phrase;
  const del = async () => {
    if (!ok || busy) return;
    setBusy(true);
    const r = await api.ifaceDelete({ node, iface });
    if (!r.ok) { setBusy(false); return toast(srvText(r) || T("Failed to delete interface."), "err"); }
    const _m = Store.ifaceMeta(node, iface) || {};
    Store.ifaceGone[node + "|" + iface] = { at: Date.now(),
      type: (_m.awg_params && Object.keys(_m.awg_params).length) ? "awg" : "wg", gen3: awgDict3(_m.awg_params),
      listen: _m.endpoint || ((_m.address || "").split("/")[0] + (_m.listen_port ? ":" + _m.listen_port : "")), subnet: _m.subnet || "" };
    closeAllModals(); await Store.poll();
    toast(T("Interface deletion requested — the node tears it down on its next sync."), "ok");
    go("#/node/" + encodeURIComponent(node));
  };
  return html`<${Sheet} title=${T("Delete interface · {v1}", { v1: iface })}
    foot=${footRow({ onCancel: closeModal, danger: true, disabled: !ok || busy, onAction: del, action: T("Delete interface") })}>
    <div class="notice warn"><${Ic} i="warn"/><span>${Trich("This permanently tears down *{iface}* on the node: the interface goes *down*, its *.conf and server key are removed*, and *every peer on this interface is destroyed*. Peers deployed only here are deleted from the panel and their configs/QRs stop working. This can't be undone.", { iface })}</span></div>
    <div class="field"><label>${typeToConfirm(phrase)}</label><input autofocus value=${txt} onInput=${e => setTxt(e.target.value)} placeholder=${phrase} autocomplete="off" spellcheck="false"/></div>
  <//>`;
}
export async function startOrRestartIface(node, iface, verb) {
  const key = node + "|" + iface;
  Store.ifaceOp[key] = { verb, phase: "busy", started: Date.now() }; Store.apply();
  const m = verb === "stop" ? "ifaceStop" : verb === "start" ? "ifaceStart" : "ifaceRestart";
  const r = await api[m]({ node, iface });
  if (!r.ok) {
    Store.ifaceOp[key] = { verb, phase: "fail", until: Date.now() + 10000, err: srvText(r) || T("request failed") };
    Store.apply(); setTimeout(() => Store.apply(), 10100); return;
  }
  await Store.poll();
}
export function openEditIface(node, iface) { openModal(html`<${EditIfaceSheet} node=${node} iface=${iface}/>`); }

export function openIfaceEditor(node, iface) {
  const k = iTypeOf(node, iface);
  if (k === "csqtt") return openEditCsqtt(node, iface);
  if (k === "wdtt") return openEditWdtt(node, iface);
  return openEditIface(node, iface);
}
export const DEFAULT_AWG_GEN = "3.1";
const AWG31_MIN_S = 12, AWG31_MAX_S = 20;
const AWG31_BASE = { Jmin: 40, Jmax: 70, H1: 1, H2: 2, H3: 3, H4: 4 };
export const AWG_KEYS = AWG_ORDER.slice(0, AWG_ORDER.indexOf("HeaderProtectionKey"));

function awgRandomBelow(count) {
  const byte = new Uint8Array(1), limit = 256 - 256 % count;
  do { crypto.getRandomValues(byte); } while (byte[0] >= limit);
  return byte[0] % count;
}

export function genAwg(gen = DEFAULT_AWG_GEN, sMax = AWG31_MAX_S) {
  if (gen === "3.1") {
    const cap = Math.max(AWG31_MIN_S, Math.min(AWG31_MAX_S, sMax));
    const s = AWG31_MIN_S + awgRandomBelow(cap - AWG31_MIN_S + 1);
    return { ...AWG31_BASE, Jc: 4 + awgRandomBelow(3), S1: s, S2: s, S3: s, S4: s };
  }
  const r = n => Math.floor(Math.random() * n), w = 15;
  let s1 = 15 + r(136), s2 = 15 + r(136);
  while (s2 === s1 || s2 === s1 + 56) s2 = 15 + r(136);
  const b = [5, 1e9, 2e9, 3e9].map(base => base + r(9e8));
  return { Jc: 4, Jmin: 40, Jmax: 70, S1: s1, S2: s2, S3: 15 + r(86), S4: 15 + r(86),
    H1: `${b[0]}-${b[0] + w}`, H2: `${b[1]}-${b[1] + w}`, H3: `${b[2]}-${b[2] + w}`, H4: `${b[3]}-${b[3] + w}`,
    I1: "<b 0xc000000001><r 64><t>", I2: "<r 24><t>", I3: "<r 32>",
    I4: "<b 0xc000000001><r 32><t>", I5: "<t><r 48>" };
}
export function awgBlankHints(gen = DEFAULT_AWG_GEN) {
  if (gen === "3.1") {
    const s = `${AWG31_MIN_S}–${AWG31_MAX_S}`;
    return { ...Object.fromEntries(Object.entries(AWG31_BASE).map(([k, v]) => [k, String(v)])),
      Jc: "4–6", S1: s, S2: s, S3: s, S4: s };
  }
  const g = genAwg(gen);
  const out = {};
  for (const k of AWG_KEYS) out[k] = /^[SH][1-4]$/.test(k) ? T("blank = random") : String(g[k]);
  return out;
}
export function AwgGrid({ value, onChange, readOnly, placeholders, omit }) {
  const v = value || {};
  const issue = !readOnly && omit ? awgOmitIssue(v, true) : "";
  return html`<div class="awg-cols">${AWG_COLS.map(grp => html`<div class="awg-col">${grp.map(k => html`<label class="awg-f"><span>${k}</span>${readOnly
    ? (awgIsNone(v[k]) ? html`<span class="awg-val awg-none">${T("val|none")}</span>`
      : html`<span class="awg-val">${v[k] != null && v[k] !== "" ? v[k] : "—"}</span>`)
    : html`<input value=${v[k] ?? ""} placeholder=${(placeholders || {})[k] || ""} class=${awgIsNone(v[k]) ? "awg-none" : null}
        onInput=${e => onChange({ ...v, [k]: e.target.value })} spellcheck="false"/>`}</label>`)}</div>`)}</div>${omit
    ? html`<p class=${"hint awg-omit-hint" + (issue ? " err" : "")}>${issue || omit}</p>` : null}`;
}

export function MeshAwgParams({ title, eff, value, onChange, placeholders, about, ph3 }) {
  const v = value || {};
  const set2 = AWG_KEYS.some(k => String(v[k] ?? "").trim() !== ""), set3 = AWG3_EDIT_COLS.flat().some(k => String(v[k] ?? "").trim() !== "");
  const show3 = eff === "3.1";
  const keptLine = eff === "2.0" && set3
    ? html`<div class="hint">${T("The AmneziaWG 3.1 values set here are kept for AWG 3.1 links — select AWG 3.1 to see them.")}</div>` : null;
  if (eff === "wg") return null;
  const isSet = set2 || (show3 && set3);
  return html`<div style="margin-top:6px"><button type="button" class="advtoggle" onClick=${e => { const d = e.currentTarget.nextElementSibling; d.style.display = d.style.display === "none" ? "" : "none"; }}><span class="advcaret">▸</span> ${title}${isSet ? "" : html` <span class="faint" style="font-weight:400">${T("(auto)")}</span>`}</button>
    <div class="field" style="display:none;margin-top:8px">
      <${AwgGrid} value=${v} onChange=${onChange} placeholders=${placeholders}
        omit=${T("Type - in a cell for no such line on the links made from these; a blank cell stays automatic.")}/>
      <div class="hint" style="margin:8px 0 0">${about}</div>${keptLine}
      ${show3 ? html`<div style="margin-top:14px"><${Awg3Grid} value=${v} onKey=${(k, x) => onChange({ ...v, [k]: x })} placeholders=${ph3}
        hpk=${T("val|per link")} rt=${T("val|on")} hpkTip=${T("Each link gets a key of its own.")} rtTip=${T("On for every AmneziaWG 3.1 link.")}
        hint=${T("What AmneziaWG 3.1 links add to the fields above. A blank cell takes the value shown in it — the mesh default, or the 3.1 defaults in Settings → Interfaces; - for no such line.")}/></div>` : null}
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-mini"
        title=${show3 ? T("S1–S4 share one random value, H1–H4 are 1–4, and the 3.1 fields use their inherited defaults.") : null}
        onClick=${() => onChange({ ...v, ...genAwg(eff), ...(show3 ? Object.fromEntries(AWG3_EDIT_COLS.flat()
          .filter(k => String(v[k] ?? "").trim() === "" && String((ph3 || {})[k] ?? "").trim())
          .map(k => [k, ph3[k] === T("val|none") ? "-" : String(ph3[k])])) : {}) })}><${Ic} i="refresh"/>${T("Generate a set")}</button>${isSet ? html`<button type="button" class="btn btn-mini" onClick=${() => onChange(Object.fromEntries(Object.entries(v)
          .filter(([k]) => !AWG_KEYS.includes(k) && !(show3 && AWG3_EDIT_COLS.flat().includes(k)))))}>${T("Clear (auto)")}</button>` : null}</div>
    </div></div>`;
}
export function mesh3Hints(fromPanel) {
  const ps = Store.panelSettings || {}, pm = fromPanel ? (ps.mesh_awg || {}) : {}, d = (ps.interface_defaults || {}).awg3_params || {};
  const one = k => [pm[k], d[k], (ps.awg31_builtin || {})[k]].map(x => String(x ?? "").trim()).find(Boolean) || "";
  return Object.fromEntries(AWG3_EDIT_COLS.flat().map(k => [k, awgIsNone(one(k)) ? T("val|none") : one(k)]));
}
export function meshAwgHints(live, gen) {
  const pt = (Store.panelSettings || {}).mesh_awg || {}; live = live || {};
  const hints = awgBlankHints(gen);
  return Object.fromEntries(AWG_KEYS.map(k => [k, awgIsNone(pt[k]) ? T("val|none")
    : String(pt[k] ?? "").trim() || String(live[k] ?? "").trim() || hints[k]]));
}
export function MeshGenField({ value, onChange, inherit, hint, label, after }) {
  const opts = [...(inherit ? [["", T("Default ({v1})", { v1: meshGenLabel(inherit) })]] : []), ...["wg", "2.0", "3.1"].map(g => [g, meshGenLabel(g)])];
  const eff = value || inherit || DEFAULT_AWG_GEN;
  label = label || T("Mesh link type");
  return html`<div class="field awggen meshgen"><label>${label}</label>
    <div class="dpsw awgsw" role="radiogroup" aria-label=${label}>${opts.map(([g, l]) => html`<button type="button" role="radio" key=${g || "inherit"}
      aria-checked=${value === g} class=${(value === g ? "on " : "") + "sw-proto"} style=${"--c:" + meshGenColor(g || inherit || DEFAULT_AWG_GEN)}
      onClick=${() => onChange(g)}>${l}</button>`)}</div>
    <div class="hint">${hint}${eff === "3.1" ? " " + T("A pair where either node cannot run AmneziaWG 3.1 is linked at 2.0, and its node says why.") : ""}${
      eff === "wg" ? " " + T("No obfuscation — DPI can block it across borders.") : ""}</div>${after || null}
  </div>`;
}

export function openConnectionEdit(node, iface) { openModal(html`<${ConnectionEditSheet} node=${node} iface=${iface}/>`); }
export function ConnectionEditSheet({ node, iface }) {
  useStore();
  const meta = Store.ifaceMeta(node, iface) || {};
  const peer = meta.link_node;
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const prec = (Store.nodes || []).find(n => n.id === peer) || {};
  const [dialSrc, setDialSrc] = useState(meta.dial_src || "");
  const [dialEp, setDialEp] = useState(meta.dial_endpoint || "");
  const relayOn0 = ((meta.relay || {}).mode || "forward") === "relay";
  const quota0 = String(((nrec.relay || {}).quota_pct) || 50);
  const [relayPick, setRelayPick] = useState(null);
  const [quotaPick, setQuotaPick] = useState(null);
  const relayOn = relayPick === null ? relayOn0 : relayPick;
  const typeSet0 = ((nrec.mesh_peers || []).find(p => p.peer === peer) || {}).type_set || "";
  const [typePick, setTypePick] = useState(null);
  const typeSet = typePick === null ? typeSet0 : typePick;
  const typeDflt = (Store.panelSettings || {}).mesh_awg_gen || DEFAULT_AWG_GEN;
  const awgSet0 = ((nrec.mesh_peers || []).find(p => p.peer === peer) || {}).awg_set || {};
  const [awgPick, setAwgPick] = useState(null);
  const awgSet = awgPick === null ? awgSet0 : awgPick;
  const tplKey = o => JSON.stringify(Object.entries(o || {}).map(([k, x]) => [k, String(x ?? "").trim()]).filter(([, x]) => x).sort());
  const awgChanged = tplKey(awgSet) !== tplKey(awgSet0);
  const relink = typeSet !== typeSet0 || awgChanged;
  const live = meta.awg_params || {};
  const ph3 = (() => { const h = mesh3Hints(true); return Object.fromEntries(AWG3_EDIT_COLS.flat().map(k => [k, String(live[k] ?? "").trim() || h[k]])); })();
  const quota = quotaPick === null ? quota0 : quotaPick;
  const setRelayOn = setRelayPick, setQuota = setQuotaPick;
  const nodeDown = nodeStale(node) || inProc(nrec.proc_status);
  const lk = nodeStale(node) ? "down" : (meta.handshake_age == null ? "connecting" : (meta.handshake_age < 180 ? "up" : "down"));
  const lkLabel = { up: "connected", connecting: "connecting", down: "down" }[lk];
  const proto = (meta.awg_params && Object.keys(meta.awg_params).length) ? "awg" : "wg";
    const Cell = (l, v) => html`<div class="conn-cell"><span class="cl">${l}</span><span class="cv">${v}</span></div>`;
  const [busy, setBusy] = useState(false), [saveErr, setSaveErr] = useState("");
  const saveDial = async () => {
    const r = await sheetSend(() => api.connectionUpdate({ node, peer, dial_src: dialSrc, dial_endpoint: dialEp,
                                         relay_mode: relayOn ? "relay" : "forward", relay_quota_pct: Number(quota) || 50,
                                         ...(typeSet !== typeSet0 ? { mesh_awg_gen: typeSet } : {}),
                                         ...(awgChanged ? { mesh_awg: Object.fromEntries(JSON.parse(tplKey(awgSet))) } : {}) }), setSaveErr, setBusy);
    if (!r.ok) return;
    closeModal();
    Store.poll().catch(() => {});
  };
  const QUOTA_MAX = 90;
  const quotaErr = (() => { const q = Number(quota); return (!Number.isInteger(q) || q < 5 || q > QUOTA_MAX) ? T("CPU cap must be between {v1} and {v2}", { v1: "5", v2: String(QUOTA_MAX) }) : ""; })();
  const connDirty = dialSrc !== (meta.dial_src || "") || dialEp !== (meta.dial_endpoint || "")
    || relayOn !== relayOn0 || quota !== quota0 || relink;
  const allMeta = Store.describe[node] || {};
  const carried = Object.keys(allMeta).filter(k => !allMeta[k].system
    && allMeta[k].egress_mode === "forward" && allMeta[k].egress_node === peer)
    .map(k => ({ iface: k, subnet: allMeta[k].subnet, ip: allMeta[k].egress_ip }));
  const smartCarried = Object.keys(allMeta).filter(k => !allMeta[k].system && allMeta[k].egress_mode === "smart")
    .map(k => ({ iface: k, cats: (allMeta[k].routing || []).filter(r => r.action === "exit" && r.node === peer)
      .map(r => r.category === "custom"
        ? ((rulesToRows([r]).rows[0] || {}).badges || []).map(b => targetLabel(b.kind, b.value)).join(", ") || "custom"
        : catLabelOf(r.category)) }))
    .filter(x => x.cats.length);
  const ifBadge = k => html`<span class=${"tg tg-" + ((allMeta[k].awg_params && Object.keys(allMeta[k].awg_params).length) ? "awg" : "wg") + awg3Cls(node, k)} ...${awg3Tip(node, k)}>${k}</span>`;
  const peerNm = html`<b style=${"color:" + Store.nodeColor(peer)}>${Store.nodeName(peer)}</b>`;
  return html`<${Sheet} title=${T("Connection to {v1}", { v1: Store.nodeName(peer) })} width=${680} onClose=${closeModal} err=${saveErr}
      foot=${footRow({ onCancel: closeModal, disabled: busy || nodeDown || !connDirty || !!quotaErr, title: nodeDown ? T("{v1} isn't reporting — reconnect it before changing this link", { v1: Store.nodeName(node) }) : (quotaErr || (!connDirty ? T("No changes to save") : "")), onAction: saveDial, action: T("Save") })}>
    <div class="conncard">
      <div class="conncard-top">
        <span class=${"iftype " + proto}>${T("System {v1}", { v1: proto.toUpperCase() })}</span>
        <span class=${"lkpill " + lk}><span class=${"lkdot " + lk}></span>${lkLabel}</span>
      </div>
      <div class="conn-grid">
        ${Cell(T("Node"), html`<a href=${"#/node/" + encodeURIComponent(peer)} onClick=${closeModal}>${Store.nodeName(peer)}</a>`)}
        ${Cell(T("This end"), meta.address || "—")}
        ${Cell(T("col|Endpoint"), meta.peer_endpoint || T("— (not dialed yet)"))}
        ${Cell(T("col|Rate"), rateCell(meta.rx_speed, meta.tx_speed))}
        ${meta.rx_bytes != null || meta.tx_bytes != null ? Cell(T("col|Total"), xferCell(...dlul(meta.rx_bytes, meta.tx_bytes))) : null}
        ${Cell(T("col|Latency"), (() => {
          const _lk = meta.link;
          if (!_lk || _lk.rtt_ms == null) return "—";
          const _ls = typeof _lk.loss === "number" ? _lk.loss : null;
          const _pl = ((meshHealth(node).peers.find(x => x.peer === peer)) || {}).plink || null;
          const _warn = _ls != null && _ls > 0;
          const _val = html`<${Fragment}>${Math.round(_lk.rtt_ms)}${T("unit|ms")}${_warn
            ? html` <span class="dp-num" style=${"color:" + lossColorMesh(_ls)}>${T("(Loss {v1}%)", { v1: _ls })}</span>` : null}<//>`;
          return html`<${LossPop} l=${_lk} pl=${_pl} peerName=${Store.nodeName(peer)} node=${node} iface=${iface} trigger=${_val}/>`;
        })())}
      </div>
    </div>
    <div style="margin-top:12px"><${RangedHistory} node=${node} kind="throughput" h=${60} fetch=${r => api.meshSeries(node, peer, r).then(x => x && x.ok ? x.data : {})}/></div>
    <div style="margin-top:16px"><${MeshGenField} label=${T("Link type")} value=${typeSet} onChange=${setTypePick} inherit=${typeDflt}
      hint=${relink ? T("Saving rebuilds this link on both ends — it drops for a few seconds while they reconnect.")
        : T("This link only, both ends. Default follows the fleet's type in Settings → Mesh.")}
      after=${(nrec.mesh_gen_reasons || []).filter(r => r.iface === iface).map(r => html`<div class="hint warnish" key=${r.iface}>${srvText(r.msg)}</div>`)}/>
      <${MeshAwgParams} title=${T("This link's AWG params")} eff=${typeSet || typeDflt} value=${awgSet} onChange=${setAwgPick}
        placeholders=${meshAwgHints(live, typeSet || typeDflt)} ph3=${ph3}
        about=${T("Both ends of this link use these. A blank cell takes the fleet's default in Settings → Mesh, else a fresh value when the link is rebuilt.")}/></div>
    <div class="row2" style="margin-top:14px">
      <div class="field"><label>${T("Dial source IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— {node}'s IP", { node: Store.nodeName(node) })}</span></label>
        <${NodeIpPick} ips=${nrec.ips || []} value=${dialSrc} onChange=${setDialSrc} auto=${T("Auto (default route)")}/></div>
      <div class="field"><label>${T("Dial endpoint IP")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— {node}'s IP", { node: Store.nodeName(peer) })}</span></label>
        <${NodeIpPick} ips=${prec.ips || []} value=${dialEp} onChange=${setDialEp} auto=${T("Auto ({v1}'s ingress)", { v1: Store.nodeName(peer) })}/></div>
    </div>
    ${(carried.length || smartCarried.length) ? html`<div style="margin-top:16px">
      ${carried.length ? html`<div class="fwd-head"><span class="egb egb-cascade"><${Ic} i="cascade"/>${T("tag|cascade")}</span><span class="fwd-to">${T("fwd|to")}</span>${peerNm}</div>
        <div class="fwd-ifaces">${carried.map(c => ifBadge(c.iface))}</div>` : null}
      ${smartCarried.length ? html`<div class="fwd-head" style=${carried.length ? "margin-top:14px" : ""}><span class="egb egb-smart"><${Ic} i="cascade"/>${T("smart cascade")}</span><span class="fwd-to">${T("fwd|to")}</span>${peerNm}</div>
        <div class="fwd-list">${smartCarried.map(s => html`<div class="fwd-row">${ifBadge(s.iface)} <span class="faint">(${s.cats.map(catLabelOf).join(", ")})</span></div>`)}</div>` : null}
      <div class="hint" style="margin-top:16px">${Trich("These interfaces' client traffic exits the fleet through *{node}*{smart}.", { node: Store.nodeName(peer), smart: smartCarried.length ? T(" — smart-routed by destination") : "" })}</div>
    </div>` : null}
    ${(() => {
      const rst = ((Store.stats[node] || {}).relay) || {};
      const elig = Object.entries(((nrec.relay || {}).eligibility) || {}).filter(([, e]) => e.via === peer);
      const canRelay = elig.filter(([, e]) => !e.why).map(([k]) => k);
      const barred = elig.filter(([, e]) => e.why);
      const smartLegs = elig.filter(([, e]) => !e.why && e.mark);
      const legIfaces = [...new Set(smartLegs.map(([k, e]) => e.iface || k))];
      if (!elig.length) {
        const _fromPeer = Object.entries(((prec.relay || {}).eligibility) || {}).filter(([, e]) => e.via === node);
        const _why = _fromPeer.length
          ? Trich("The traffic on this leg comes from *{peer}*, so its datapath is chosen there — open this link from {peer}'s page.",
                  { peer: Store.nodeName(peer) })
          : smartCarried.length
            ? Trich("The panel hasn't worked out this link's routes yet, so there is nothing to accelerate here. The choice appears after *{node}*'s next sync.",
                    { node: Store.nodeName(node) })
            : Trich("Nothing sends its whole traffic through this link yet. Set an interface's egress to *Forward to {peer}* and the datapath choice appears here.",
                    { peer: Store.nodeName(peer) });
        return html`<div class="dp-sec">
          <div class="dp-row"><span class="dp-l">${T("Datapath")}</span>
            <span class="faint">${T("Forward")}</span></div>
          <div class="hint" style="margin-top:6px">${_why}</div>
        </div>`;
      }
      const live = canRelay.map(k => [k, ((rst.ifaces || {})[k]) || null]);
      const running = live.filter(([, v]) => v && v.ok);
      const stalled = live.map(([, v]) => (v && !v.ok && v.why) || "").filter(Boolean)[0] || rst.why || "";
      const conns = running.reduce((a, [, v]) => a + (v.live || 0), 0);
      const down = running.reduce((a, [, v]) => a + (v.bytes_down || 0), 0);
      const up = running.reduce((a, [, v]) => a + (v.bytes_up || 0), 0);
      return html`<div class="dp-sec">
        <div class="dp-row">
          <span class="dp-l">${T("Datapath")}</span>
          <div class="dpsw" role="radiogroup" aria-label=${T("Datapath")}>
            <button type="button" role="radio" aria-checked=${!relayOn} class=${!relayOn ? "on" : ""}
              onClick=${() => setRelayOn(false)}>${T("Forward")}</button>
            <button type="button" role="radio" aria-checked=${relayOn} disabled=${!canRelay.length}
              title=${!canRelay.length ? T("No interface on this link can be relayed") : ""}
              class=${"sw-relay" + (relayOn ? " on" : "")} onClick=${() => setRelayOn(true)}>${T("Relay")}</button>
          </div>
          ${relayOn ? html`<div class="dp-cpu">
            <span class="dp-l">${T("CPU cap")}</span>
            <input type="number" min="5" max=${QUOTA_MAX} value=${quota} onInput=${e => setQuota(e.target.value)}/>
            <span class="u">%</span>
          </div>` : null}
        </div>
        ${(() => {
          const _l = (meta.link || {});
          const _ls = typeof _l.loss === "number" ? _l.loss : null;
          if (_l.rtt_ms == null || _ls === null) return null;
          return _ls > 0
            ? html`<div class="hint dp-verdict warn"><${Ic} i="warn"/> ${Trich("This leg is losing *{v1}%* right now — that is the case for Relay.", { v1: String(_ls) })}</div>`
            : html`<div class="hint dp-verdict ok"><${Ic} i="check"/> ${Trich("This leg is clean right now — *Forward* is the cheaper choice.")}</div>`;
        })()}
        ${relayOn && smartLegs.length ? html`<div class="hint" style="margin-top:9px">${
          Trich("Only the destinations *{ifaces}* routes over this link are relayed — the rest of that traffic is untouched. And the relay terminates TCP, so UDP keeps forwarding either way.",
                { ifaces: legIfaces.join(", ") })}</div>` : null}
        <div class="hint dp-why">${relayOn
          ? Trich("*{node}* answers the client itself and opens its own connection to {peer}. Loss on the link stops reaching the client, so a bad leg costs the user far less. In exchange it uses noticeably more CPU, and on a link that is already healthy it buys nothing. The cap is {node}'s whole relay budget, shared by every leg it accelerates.", { node: Store.nodeName(node), peer: Store.nodeName(peer) })
          : Trich("Packets cross this link untouched. The simplest and cheapest option — *{node}* barely spends CPU on them and there is nothing in the path to fail. Right while the link to {peer} is healthy.", { node: Store.nodeName(node), peer: Store.nodeName(peer) })}</div>
        ${relayOn0 ? html`<div class="conncard" style="margin-top:11px"><div class="conn-grid">
            ${Cell(T("col|State"), running.length
              ? html`<span class="lkpill up"><span class="lkdot up"></span>${T("relaying")}</span>`
              : html`<span class="lkpill down"><span class="lkdot down"></span>${T("not relaying")}</span>`)}
            ${running.length
              ? Cell(T("Connections"), String(conns))
              : Cell(T("Reason"), html`<span class="faint">${stalled || T("waiting for the node")}</span>`)}
            ${running.length ? Cell(T("Carried"), fmtBytes(down) + " ↓  " + fmtBytes(up) + " ↑") : null}
            ${(() => {
              const eff = live.map(([, v]) => v && v.quota_pct).find(v => v != null);
              return (eff != null && String(eff) !== quota0)
                ? Cell(T("CPU cap"), html`<span class="dp-num" style="color:var(--warn)">${T("{v1}% enforced, {v2}% set", { v1: eff, v2: quota0 })}</span>`)
                : null;
            })()}
        </div></div>` : null}
        ${barred.length ? html`<div class="notice warn" style="margin-top:11px"><${Ic} i="warn"/><span>
          ${
            barred.map(([k, e]) => html`<div>${Trich("*{v1}* can't be relayed — {v2}. It keeps forwarding.", { v1: e.iface || k, v2: e.why })}</div>`)}
        </span></div>` : null}
        ${quotaErr ? html`<div class="notice err" style="margin-top:9px"><${Ic} i="warn"/><span>${quotaErr}</span></div>` : null}
        ${relayOn !== relayOn0 ? html`<div class="notice warn" style="margin-top:11px"><${Ic} i="warn"/><span>
          ${Trich("Saving this drops every TCP connection currently crossing this link. Clients reconnect on their own.")}</span></div>` : null}
      </div>`;
    })()}
    <div class="hint" style="margin-top:14px">${(Store.panelSettings || {}).mesh_effective === "demand"
      ? Trich("This is a panel-managed mesh link to *{node}*. On demand, a link exists while a forward, a smart rule or its own settings use it, and is removed an hour after nothing does.", { node: Store.nodeName(peer) })
      : Trich("This is a panel-managed mesh link to *{node}*. It's created and torn down automatically as nodes are added or removed.", { node: Store.nodeName(peer) })}
      ${" "}${Trich("To send all traffic from an interface through this node, set *Interface rules → Everything else → Forward to {node}* and leave the rule list empty.", { node: Store.nodeName(peer) })}</div>
  <//>`;
}
export function EditIfaceSheet({ node, iface }) {
  useStore();
  const meta = Store.ifaceMeta(node, iface) || {};
  const emode = ((Store.nodes || []).find(n => n.id === node) || {}).routing_mode || "kernel";
  const ep = meta.endpoint || "";
  const epHost = ep.includes(":") ? ep.slice(0, ep.lastIndexOf(":")) : ep;
  const [host, setHost] = useState(epHost);
  const [port, setPort] = useState(String(meta.desired_port || meta.listen_port || ""));
  const iperr = portErrMsg(node, port, [meta.listen_port, meta.desired_port]);
  const [dns, setDns] = useState((meta.dns || []).join(", "));
  const [mtu, setMtu] = useState(String(meta.mtu || 1280));
  const [ka, setKa] = useState(String(meta.keepalive || 25));
  const [disc, setDisc] = useState({ routing: true, filters: false, advanced: false });
  const tog = k => setDisc(d => ({ ...d, [k]: !d[k] }));
  const [driftDone, setDriftDone] = useState(null);
  const nrec = (Store.nodes || []).find(n => n.id === node) || {};
  const [eg, setEg] = useState(() => egressInit(meta));
  const [blk, setBlk] = useState(() => [...(meta.block || [])]);
  const [reach, setReach] = useState(meta.reach || "user");
  const isAwg = !!(meta.awg_params && Object.keys(meta.awg_params).length);
  const [awg, setAwg] = useState(() => Object.assign({}, meta.awg_params || {}));
  const setAwgK = (k, v) => setAwg(a => ({ ...a, [k]: v }));
  const pickMimic = id => { const f = mimicFill(mimicRender(id), meta.awg_params); setAwg(a => ({ ...a, ...f })); };
  const mimWas = mimicLines(meta.awg_params), mimEff = mimicAfter(awg, meta.awg_params);
  const _apT = k => String((meta.awg_params || {})[k] ?? "").trim();
  const mimBad = isAwg ? AWG_ORDER.filter(k => { const d = String(awg[k] ?? "").trim(); return d && !awgIsNone(d) && d !== _apT(k); })
    .map(k => [k, awgFieldCheck(k, awg[k])]).find(([, c]) => !c.ok) : null;
  const _rm = isAwg && AWG_ORDER.some(k => awgIsNone(awg[k]) && (meta.awg_params || {})[k] != null);
  const _snapN = Store.stats[node] || {};
  const omitNo = !_rm ? "" : (((_snapN.datapath || {}).awg || {}).exact !== 1)
    ? T("{v1} cannot hold an empty AmneziaWG field yet — it is offline or needs an update", { v1: Store.nodeName(node) })
    : !meta.awg_exact && !Object.keys(((((_snapN.interfaces || {})[iface] || {}).meta || {}).awg_params) || {}).length
      ? T("{v1}: wait for the node to report this interface, then set a field to none", { v1: iface }) : "";
  const genWas = awgGen(node, iface) || "2.0";
  const genSw = isAwg && !meta.system && (meta.tool || "awg") === "awg";
  const [gen, setGen0] = useState(genWas);
  const genChanged = genSw && gen !== genWas;
  const mimErr = mimBad ? mimicWhy(mimBad[0], mimBad[1]) : omitNo;
  const setGen = g => { setGen0(g);
    if (g !== "3.1" && genWas !== "3.1") return setAwg(a => Object.fromEntries(Object.entries(a).filter(([k]) => !AWG3_KEYS.includes(k))));
    if (g !== "3.1" || genWas === "3.1") return;
    setDisc(d => ({ ...d, advanced: true }));
    const ps = Store.panelSettings || {}, d = { ...(ps.awg31_builtin || {}), ...((ps.interface_defaults || {}).awg3_params || {}) };
    setAwg(a => AWG3_EDIT_COLS.flat().reduce((o, k) => (String(o[k] ?? "").trim() || d[k] == null ? o : { ...o, [k]: String(d[k]) }), a)); };
  const no3 = awg31No(nrec, iface) ? srvText(awg31No(nrec, iface)) : "";
  const no2 = (((Store.stats[node] || {}).datapath || {}).awg || {}).gen ? "" : no3;
  const ist = (((Store.stats[node] || {}).interfaces || {})[iface] || {});
  const istopped = !!ist.stopped;
  const idown = !istopped && ist.down;
  const notup = !!idown || istopped;
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false); const [saveErr, setSaveErr] = useState("");
  const doSave = async (switched) => {
    const body = { node, iface, endpoint_host: host.trim(), listen_port: port.trim(), dns: dns.trim(), mtu: mtu.trim(), keepalive: ka.trim(), block: blk, reach, ...egressBody(eg) };
    if (isAwg) body.awg_params = AWG_ORDER.reduce((o, k) => { const v = String(awg[k] == null ? "" : awg[k]).trim();
      if (v && (gen === "3.1" || !AWG3_KEYS.includes(k))) o[k] = v; return o; }, {});
    const r = switched ? await api.ifaceUpdate({ ...body, awg_gen: gen }) : await sheetSend(() => api.ifaceUpdate(body), setSaveErr, setBusy);
    if (!r || !r.ok) return r;
    const key = node + "|" + iface, verb = notup ? "start" : "apply";
    if (!(switched && !notup)) Store.ifaceOp[key] = { verb, phase: "busy", started: Date.now() };
    Store.apply(); closeAllModals();
    const fail = (m) => { Store.ifaceOp[key] = { verb, phase: "fail", until: Date.now() + 5000, err: m }; Store.apply(); setTimeout(() => Store.apply(), 5100); };
    reportDropped(r);

    if (notup) { const r2 = await api.ifaceStart({ node, iface }); if (!r2.ok) return fail(srvText(r2) || T("start failed")); }
    await Store.poll();
    toast(notup ? T("Interface saved — starting…") : T("Interface saved."), "ok");
  };
  const save = () => {
    const ee = egressSaveBlock(eg, emode); if (ee) return toast(ee, "err");
    if (genChanged) return pushModal(html`<${AwgSwitchSheet} node=${node} iface=${iface} to=${gen} commit=${() => doSave(true)} sent=${awg}/>`);
    const portChanged = port.trim() !== String(meta.desired_port || meta.listen_port || "");
    const epChanged = host.trim() !== epHost;
    const awgRm = isAwg ? AWG_ORDER.filter(k => awgIsNone(awg[k]) && (meta.awg_params || {})[k] != null && !MIMIC_KEYS.includes(k)) : [];
    if (portChanged || epChanged || awgRm.length) {
      const what = portChanged && epChanged ? T("endpoint and listen port") : portChanged ? T("listen port") : "endpoint";
      const title = !awgRm.length ? T("Change {what}?", { what }) : (portChanged || epChanged)
        ? T("Change {what} and remove {v1}?", { what, v1: awgRm.join(", ") }) : T("Remove {v1}?", { v1: awgRm.join(", ") });
      pushModal(html`<${ConfirmSheet} title=${title} confirmLabel=${T("Apply change")} warn=${true}
        body=${T("This reconfigures the interface on the node. Existing peers will NOT be able to connect using their old configs — you'll need to re-issue and re-distribute the QR codes. The interface's keys and peers are kept.")}
        note=${html`<${SubAutoNote}/>`}
        onConfirm=${() => doSave()}/>`);
      return;
    }
    doSave();
  };
  const _ifBody = { endpoint_host: host.trim(), listen_port: port.trim(), dns: dns.trim(), mtu: mtu.trim(), keepalive: ka.trim(), reach, ...egressBody(eg) };
  const _ifOrig = { endpoint_host: epHost, listen_port: String(meta.desired_port || meta.listen_port || ""), dns: (meta.dns || []).join(", "), mtu: String(meta.mtu || 1280), keepalive: String(meta.keepalive || 25), reach: meta.reach || "user", ...egressBody(egressInit(meta)) };
  const _awgTrim = src => AWG_ORDER.reduce((o, k) => { const v = String((src || {})[k] == null ? "" : (src || {})[k]).trim(); if (v) o[k] = v; return o; }, {});
  const edited = JSON.stringify(_ifBody) !== JSON.stringify(_ifOrig)
    || JSON.stringify([...blk].sort()) !== JSON.stringify([...(meta.block || [])].sort())
    || (isAwg && Object.entries(_awgTrim(awg)).some(([k, v]) => v !== (_awgTrim(meta.awg_params)[k] || ""))) || genChanged;
  const ifaceDirty = notup || edited;
  const dirtyRef = useRef(false), closeRef = useRef(null);
  dirtyRef.current = edited;
  return html`<${Sheet} title=${T("Edit {v1} interface · {v2}", { v1: kindOf(node, iface).toUpperCase(), v2: iface })} width=${720} dirtyRef=${dirtyRef} closeRef=${closeRef} err=${saveErr}
    foot=${html`<${Fragment}><button class="btn btn-ghost danger" onClick=${() => pushModal(html`<${DeleteIfaceSheet} node=${node} iface=${iface}/>`)}><${Ic} i="trash"/>${T("Delete")}</button>
      ${notup
        ? html`<button class="btn btn-ghost" style="margin-left:8px" disabled=${busy} title=${T("Bring this interface up on the node")} onClick=${() => { closeModal(); startOrRestartIface(node, iface, "start"); }}><${Ic} i="play"/> ${(isMobile() ? T("rowact|Start") : T("Start service"))}</button>`
        : html`<${Fragment}><button class="btn btn-ghost" style="margin-left:8px" disabled=${busy} title=${T("Take this interface down on the node (stays down until started)")} onClick=${() => { closeModal(); startOrRestartIface(node, iface, "stop"); }}><${Ic} i="stop"/> ${(isMobile() ? T("rowact|Stop") : T("Stop service"))}</button><button class="btn btn-ghost" style="margin-left:8px" disabled=${busy} title=${T("Bounce this interface's service on the node (down then up)")} onClick=${() => { closeModal(); startOrRestartIface(node, iface, "restart"); }}><${Ic} i="refresh"/> ${(isMobile() ? T("rowact|Restart") : T("Restart service"))}</button><//>`}
      <span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${() => (closeRef.current ? closeRef.current() : closeModal())}>${T("Cancel")}</button><button class="btn btn-primary" disabled=${busy || !!egressSaveBlock(eg, emode) || !!iperr || !!mimErr || !ifaceDirty} title=${iperr || egressSaveBlock(eg, emode) || mimErr || (!ifaceDirty ? T("No changes to save") : "")} onClick=${save}>${T("Save")}</button></>`}>
    <div class="iface-intro"><div>${Trich("Changing the *endpoint* or *port* will break the existing clients' connections; you will need to re-distribute the configs / QR codes.")}</div></div>
    ${idown ? html`<div class="notice warn"><${Ic} i="warn"/><span>${Trich("This interface is *down* on the node. Change the *Listen port* to a free one and *Save* — the panel will write the new port and restart the interface to bring it up.")}</span></div>` : null}
    ${((meta.drift && meta.drift.public_key) || driftDone) ? (() => {
      const rerr = driftDone === "restoring" ? (nrec.cmd_errors || {})[iface] : null;
      if (driftDone === "adopted") return html`<div class="notice ok"><${Ic} i="check"/><span>${Trich("*New server key adopted.* Re-issue and re-distribute the QR codes / configs — *subscribed users update automatically*.")}</span></div>`;
      if (driftDone === "restoring" && !rerr) {
        return (meta.drift && meta.drift.public_key)
          ? html`<div class="notice ok"><${Ic} i="check"/><span>${Trich("*Restoring the original key…* The node reverts to its backed-up key on its next sync — existing clients keep working, no re-distribution.")}</span></div>`
          : html`<div class="notice ok"><${Ic} i="check"/><span>${Trich("*Original key restored.* The node reverted to its backed-up key — existing clients keep working, no re-distribution needed.")}</span></div>`;
      }
      const canRestore = meta.drift_restorable !== false;
      const vaultRestore = !canRestore && !!meta.drift_key_blob;
      const vaultAct = html`<div class="kd-act">
        <button type="button" class="kd-btn kd-restore" onClick=${async () => {
          let sealed;
          try {
            await ensureVaultUnlocked();
            sealed = await ivkResealForNode(node, { key_source: "vault", key_blob: meta.drift_key_blob });
          } catch (e) { return toast((e && e.message) || T("Failed"), "err"); }
          if (!sealed) return toast(T("No escrowed key is stored for this interface."), "err");
          const r = await api.ifaceRestore({ node, iface, key: "public_key", sealed_key: sealed });
          if (!r.ok) return toast(srvText(r) || T("Failed"), "err");
          setDriftDone("restoring"); await Store.poll();
        }}>${T("Restore from the vault")}</button>
        <span class="faint kd-hint">${T("Puts the original key back from your Encryption Vault — existing clients keep working, no re-distribution.")}</span>
      </div>`;
      const restoreAct = html`<div class="kd-act">
        <button type="button" class="kd-btn kd-restore" onClick=${async () => { const r = await api.ifaceRestore({ node, iface, key: "public_key" }); if (!r.ok) return toast(srvText(r) || T("Failed"), "err"); setDriftDone("restoring"); await Store.poll(); openConfirm({ title: T("Restoring the original key"), confirmLabel: T("Got it"), body: T("The node is reverting this interface to its backed-up original server key on its next sync. Existing clients keep working — no re-distribution needed.") }); }}>${T("Restore original key")}</button>
        <span class="faint kd-hint">${T("Reverts to the backed-up key — existing clients keep working, no re-distribution.")}</span>
      </div>`;
      const adoptAct = html`<div class="kd-act">
        <button type="button" class="kd-btn kd-adopt" onClick=${() => pushModal(html`<${ConfirmSheet} title=${T("Adopt the new server key?")} confirmLabel=${T("Adopt new key")} warn=${true} body=${T("Every client on this interface will stop connecting with their current config. You must re-issue and re-distribute every QR code / config. The original key is discarded.")} onConfirm=${async () => { const r = await api.ifaceAdopt({ node, iface, key: "public_key" }); if (!r.ok) return toast(srvText(r) || T("Failed"), "err"); setDriftDone("adopted"); await Store.poll(); openModal(html`<${ConfirmSheet} title=${T("New server key adopted")} confirmLabel=${T("Got it")} note=${html`<${SubAutoNote}/>`} body=${T("The node's new server key is now the panel's key for this interface. Every client's existing config / QR for this interface has stopped working — re-issue and re-distribute the new QR codes / configs to them.")}/>`); }}/>`)}>${T("Adopt new key")}</button>
        <span class="faint kd-hint">${canRestore ? T("Accept the node's new key — you'll re-distribute every QR.")
            : vaultRestore ? T("Accept the node's new key instead of restoring the original — you'll re-distribute every QR.")
            : T("The node was re-created and no longer holds the original key, so Restore can't recover it — Adopt is the only option. You'll re-distribute every QR.")}</span>
      </div>`;
      return html`<div class="notice warn">
        <${Ic} i="warn"/><span>${rerr
          ? restoreFailed(rerr)
          : html`${Trich("*Server key changed on the node.* This interface's server keypair was rotated directly on the server, so *every client's existing config / QR for this interface no longer connects*.")} ${canRestore ? T("The node kept a backup of the original key.")
             : vaultRestore ? Trich("*The box no longer holds the original key* (it was re-created), but your *Encryption Vault does* — restore it from there and every existing config keeps working.")
             : Trich("*The node no longer holds the original key* (it was re-created), so it can't be restored — only adopted.")}`}
          <div class=${"keydrift-acts" + ((canRestore || vaultRestore) ? "" : " one")}>
            ${canRestore ? restoreAct : vaultRestore ? vaultAct : null}
            ${adoptAct}
          </div>
        </span></div>`;
    })() : null}
    ${Object.entries(meta.drift || {}).filter(([k]) => k !== "public_key").length ? html`<div class="notice warn">
      <${Ic} i="warn"/><span>${Trich("*Edited directly on the server.* The panel paused pushing these so your change survives — Adopt to keep the server value, or Restore to re-apply the panel's:")}
      ${Object.entries(meta.drift).filter(([k]) => k !== "public_key").map(([k, v]) => html`<div style="margin-top:7px"><span class="mono">${k === "awg_params" ? T("AWG params") : k}</span> ${T("on node =")} <span class="mono">${k === "awg_params" ? Object.entries(v).map(([a, b]) => a + "=" + b).join(" ") : v}</span>
        <button type="button" class="linkbtn" style="margin-left:8px" onClick=${async () => { const r = await api.ifaceAdopt({ node, iface, key: k }); if (!r.ok) return toast(srvText(r) || T("Failed"), "err"); closeModal(); await Store.poll(); toast(T("Adopted the server value."), "ok"); }}>${T("Adopt")}</button>
        · <button type="button" class="linkbtn" onClick=${async () => { const r = await api.ifaceRestore({ node, iface, key: k }); if (!r.ok) return toast(srvText(r) || T("Failed"), "err"); closeModal(); await Store.poll(); toast(T("Restoring the panel value on the next sync."), "ok"); }}>${T("Restore panel value")}</button></div>`)}
      </span></div>` : null}
    <div class="field ipk-field subnet-row"><label>${T("Host tunnel IP")}</label><span class="ipk-val"><b>${(meta.address || "").split("/")[0] || meta.subnet || "—"}</b> <span class="faint">${T("(set at creation — delete & recreate to change)")}</span></span></div>
    <div class="row2">
      <div class="field"><label>${T("Endpoint host / IP")}</label>
        <${NodeIpPick} ips=${ipChoices(nrec)} value=${host} onChange=${setHost} auto=${T("Auto (node's detected address)")} customPlaceholder=${T("IP or hostname — e.g. vpn.example.com")}/>
        <div class="hint">${T("What clients dial — config-facing only")}</div></div>
      <div class="field"><label>${T("Listen port")}</label><input class=${iperr ? "bad" : ""} value=${port} onInput=${e => setPort(e.target.value)} placeholder=${String(meta.listen_port || "")}/>${iperr ? html`<div class="hint err">${iperr}</div>` : html`<div class="hint">${T("Applied to the node (currently {v1})", { v1: meta.listen_port || "—" })}</div>`}</div>
    </div>
    ${genSw ? html`<${AwgGenField} value=${gen} onChange=${setGen} no3=${no3} no2=${no2} was=${genWas} node=${node} nrec=${nrec}/>` : null}
    <${EgressPicker} node=${node} value=${eg} onChange=${setEg} noRules=${true}/>
    ${eg.mode === "smart" ? html`<${Disclosure} title=${rulesTitle(node)} sumCls="route"
      summary=${rulesSummary(node, eg.rows, eg.catchAll)}
      open=${disc.routing} onToggle=${() => tog("routing")}>
      <${RoutingRules} node=${node} iface=${iface} blk=${blk} rows=${eg.rows || []} catchAll=${eg.catchAll} exitIps=${eg.exitIps} directIp=${eg.ip || ""} onChange=${(rows, catchAll, exitIps, ip) => setEg({ ...eg, rows, catchAll, exitIps, ip })}/>
    <//>` : null}
    <${ReachField} node=${node} iface=${iface} value=${reach} onChange=${setReach}/>
    <${Disclosure} title=${T("Filters & abuse")} sumCls="on"
      summary=${blockActiveN(node, blk, eg.p2p) ? T("{v1} active", { v1: blockActiveN(node, blk, eg.p2p) }) : html`<span class="faint">${T("val|none")}</span>`}
      open=${disc.filters} onToggle=${() => tog("filters")}>
      <${BlockTraffic} node=${node} value=${blk} onChange=${setBlk} p2p=${eg.p2p} onP2p=${p => setEg(e => ({ ...e, p2p: p }))}/>
    <//>
    <${Disclosure} title=${T("Advanced settings")} summary=${T("MTU · keepalive · DNS") + (isAwg ? awgTail + " · " + MIMIC_TAIL[mimicOf(mimEff)]() : "") + (natPinApplies(eg) ? natTail : "")}
      open=${disc.advanced} onToggle=${() => tog("advanced")}>
      <div class="field secdiv"><label>${isAwg ? T("AmneziaWG settings") : T("WireGuard settings")}</label></div>
      <div class="row2">
        <div class="field"><label>MTU</label><input value=${mtu} onInput=${e => setMtu(e.target.value)} placeholder="1280"/><div class="hint">${T("Default for new peers")}</div></div>
        <div class="field"><label>${T("Persistent keepalive (s)")}</label><input value=${ka} onInput=${e => setKa(e.target.value)} placeholder="25"/><div class="hint">${T("0 disables · blank = 25")}</div></div>
      </div>
      <div class="field"><label>DNS</label><input value=${dns} onInput=${e => setDns(e.target.value)} placeholder=${T("https://8.8.8.8/dns-query, 1.1.1.1")}/><div class="hint">${T("Comma-separated")}</div></div>
      ${isAwg ? html`<div class="field"><label>${T("AmneziaWG parameters")}</label>
        <div class="hint" style="margin:0 0 8px">${T("Pushed to the node's interface and rendered into configs/QRs. Existing devices must re-import after a change, except a change of disguise: each side sends its own.")}</div>
        <${MimicPick} eff=${mimEff} was=${mimWas} port=${port} bad=${mimErr} onPick=${pickMimic}
          peers=${Store.recon.peers.filter(p => p.targets.some(t => t.node === node && t.iface === iface)).length}
          restart=${gen === "3.1" || AWG_ORDER.some(k => awgIsNone(awg[k]) && (meta.awg_params || {})[k] != null)}/>
        <div class="awg-cols">${AWG_COLS.map(grp => html`<div class="awg-col">${grp.map(k => html`<label class="awg-f"><span>${k}</span><input value=${awg[k] == null ? "" : awg[k]}
          class=${awgIsNone(awg[k]) ? "awg-none" : null} ...${meta.awg_exact && (meta.awg_params || {})[k] == null ? { placeholder: T("val|none") } : {}}
          onInput=${e => setAwgK(k, e.target.value)}/></label>`)}</div>`)}</div>
        <p class=${"hint awg-omit-hint" + (awgOmitIssue(awg) ? " err" : "")}>${awgOmitIssue(awg) || T("Type - in a cell to remove that line — every device re-imports, as with any change here outside I1–I5.")}</p>
        ${
          gen === "3.1" ? html`<${Awg3Grid} value=${awg} onKey=${setAwgK}
            hpk=${awg.HeaderProtectionKey ? T("val|set") : genChanged ? T("val|new on switch") : "—"} rt=${awg.RandomTrailers || genChanged ? T("val|on") : "—"}
            hpkTip=${T("Changes only through the version switch — every device has to re-import after it.")}
            rtTip=${T("Changes only through the version switch — every device has to re-import after it.")}
            hint=${genChanged && awgLowS(awg)
              ? T("One of S1–S4 is below 12, which header protection refuses — the switch draws new ones.") : null}/>` : null}</div>` : null}
      <${NatSourcePick} node=${node} value=${eg} onChange=${setEg}/>
    <//>
    ${msg ? html`<div class=${"formmsg " + msg.k}>${msg.t}</div>` : null}
  <//>`;
}
