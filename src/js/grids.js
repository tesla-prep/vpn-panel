import { esc, tkey, seen, dur, fmtBytes, isMobile } from "./util.js";
import { T } from "./i18n.js";
import { Store, api, useStore } from "./store.js";
import { targetType, nodeStale, ghostIface, ifaceIsAll, ifaceMatch, tgtXfer, tgtSeenAge } from "./model.js";
import {
  Ic, Tag, Badge, Dropdown, SearchBox, secTitle, footRow, toast, openModal, openConfirm,
  rowSingle, rowDouble, rowNoSelect, RowError, rateCell, xferCell, DepBadge,
  gridIfaceTag, gridStatusBadge, lifecycleIcon, statusLabel, dlul, rowError,
  Portal, Sheet, closeModal,
} from "./ui.js";
import {
  sortPeerRows, peerSortBy, pageScroll, pageSizeOpts, searchMatch, peerMatchesQ, ifaceOptGroups,
  nodeFilterOptions, ifaceFilterOptions, orphCount, OnlinePeersTag, revealUser,
  dashNodes, dashNodeOn, dashToggleNode, trafficRangeLabel, PEER_DEFDIR,
} from "./views.js";
import {
  UserCombo, assignPeer, confirmUnassign, confirmDeletePeer, confirmRestoreDeployment,
  confirmCorrectDeployment, openRecreateRekey, peerBlockBtn,
} from "./peer-actions.js";
import { PeerTrafficCell } from "./traffic-ui.js";
import { openPeerConfigs } from "./peer-ui.js";
import { openEditPeer, openPeerView } from "./sheets-crud.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export function PeerGrid({ rows, agg, node, iface, shownByPeer, q, blocked, hideUser, loc, sort, dir, onSort, ranged, owner }) {
  const arrow = c => sort === c ? (dir < 0 ? "↓ " : "↑ ") : "";
  const th = (c, label, cls) => onSort ? html`<th class=${(cls ? cls + " " : "") + "clk"} onClick=${() => onSort(c)}>${arrow(c)}${label}</th>` : html`<th class=${cls || ""}>${label}</th>`;
  const matchedOf = p => (p.targets || []).filter(d => (node === "*" || d.node === node) && ifaceMatch(d.iface, iface, d));
  return html`<div class="tablewrap"><table class=${"peergrid" + (loc ? " loc" : "")}>
    <thead><tr>${th("status", T("col|Status"), "h-status")}${loc
      ? html`${hideUser ? null : th("user", T("col|User"), "h-user")}${th("title", T("col|Title"), "h-title")}${th("address", T("col|Address"), "h-addr")}${th("server", T("col|Node"), "h-node")}`
      : html`${hideUser ? null : th("user", T("col|User"), "h-user")}${th("title", T("col|Title"), "h-title")}${agg ? th("server", node === "*" ? T("col|Node") : T("col|IF"), "h-node") : null}${th("address", T("col|Address"), "h-addr")}`
    }${th("online", T("col|Online"), "h-online")}${th("rate", T("col|Rate") + " ↓↑", "h-rate")}${ranged ? th("rtotal", trafficRangeLabel() + " ↓↑", "h-total") : th("total", T("col|Total") + " ↓↑", "h-total")}<th class="h-acts"></th></tr></thead>
    <tbody>
      ${rows.length ? rows.map(({ p, t }) => {
        const u = p.user_id ? Store.user(p.user_id) : null;
        const hidden = p.targets.filter(d => !(shownByPeer[p.id] || new Set()).has(tkey(d.node, d.iface)));
        const fresh = Store.recentlyCreated[p.id] && (Date.now() - Store.recentlyCreated[p.id] < 2500);
        const re = rowError("peer:" + p.id);
        return html`<tr key=${p.id + "|" + tkey(t.node, t.iface)} data-peer=${p.id} class=${"clk" + (fresh ? " pcreate" : "")} title=${T("Double-click for QR / configs")} onMouseDown=${rowNoSelect} onClick=${e => rowSingle(e, () => openPeerView(p.id, t.node, t.iface))} onDblClick=${e => rowDouble(e, () => openPeerConfigs(p))}>
          <td data-label=${T("col|Status")} class="c-status">${gridStatusBadge(t, p, re)}${loc ? gridIfaceTag(t) : null}</td>
          ${(() => {
            const titleCell = html`<td data-label=${T("col|Title")} class="c-name">${lifecycleIcon(p, t.status)}${p.title ? html`<b>${p.title}</b>` : html`<span class="faint">${T("Untitled")}</span>`}</td>`;
            const addrCell = html`<td data-label=${T("col|Address")} class="c-addr"><span class="addr">${t.ip || "—"}</span>${hidden.length ? html`<${DepBadge} others=${hidden}/>` : null}</td>`;
            const nodeCell = html`<td data-label=${T("col|Node")} class="c-node"><div class="srvcell"><span class="srv-name" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")}>${Store.nodeName(t.node)}</span></div></td>`;
            const userCell = hideUser ? null : html`<td data-label=${T("col|User")} class=${"usercell" + (u ? " linked" : "")}
              title=${u ? T("Click to open this user's details") : T("Assign this peer to a user")}
              onClick=${u ? (e => { e.stopPropagation(); revealUser(u.id); }) : (e => e.stopPropagation())}>
              ${u ? html`<a class="namecell" href="#/users" onClick=${e => { e.preventDefault(); e.stopPropagation(); revealUser(u.id); }}><span>${u.name}</span><${Ic} i="user"/></a>`
                  : html`<div class="assigncell"><${UserCombo} onPick=${uid => assignPeer(p, uid)}/></div>`}</td>`;
            if (loc) return html`${userCell}${titleCell}${addrCell}${nodeCell}`;
            const srvAgg = agg ? html`<td data-label=${node === "*" ? T("col|Node") : T("col|IF")} class="c-node"><div class="srvcell">
              ${node === "*" ? html`<span class="srv-name" style=${"color:" + (Store.nodeColor(t.node) || "var(--ink)")}>${Store.nodeName(t.node)}</span>` : null}
              ${ifaceIsAll(iface) ? gridIfaceTag(t) : null}
            </div></td>` : null;
            return html`${userCell}${titleCell}${srvAgg}${addrCell}`;
          })()}
          <td data-label=${T("col|Online")} class="c-online"><span class="when">${seen(tgtSeenAge(t))}</span></td>
          ${(() => { const xf = tgtXfer(t); return html`
          <td data-label=${T("col|Rate")} class="c-rate">${rateCell(xf ? xf.rx_speed : 0, xf ? xf.tx_speed : 0)}</td>
          <td data-label=${T("col|Total")} class="c-total">${ranged
            ? html`<${PeerTrafficCell} pid=${p.id} owner=${owner} wire=${xf} iface=${t.iface}
                ungrouped=${!loc && p.targets.length > 1}
                filtered=${loc && matchedOf(p).length < p.targets.length}/>`
            : xferCell(...dlul(xf ? xf.rx_bytes : 0, xf ? xf.tx_bytes : 0))}</td>`; })()}
          <td data-label="" class="rowacts" onClick=${e => e.stopPropagation()}>
            ${(() => { const gh = ghostIface(t.node, t.iface); return (gh && gh.ripe)
              ? html`<button class="iconbtn ghost" data-lbl=${T("Recreate")} title=${T("Recreate & rekey — {iface} is gone with no recoverable key; recreate it fresh and reissue every client's config", { iface: t.iface })} onClick=${() => openRecreateRekey(t.node, t.iface)}><${Ic} i="refresh"/></button>`
              : t.restorable
                ? html`<button class="iconbtn restore" data-lbl=${T("Restore")} title=${T("Restore interface {iface} (recreate the missing interface with its original identity — recovers every peer on it)", { iface: t.iface })} onClick=${() => confirmRestoreDeployment(p, t)}><${Ic} i="refresh"/></button>`
                : t.correctable
                  ? html`<button class="iconbtn correct" data-lbl=${T("Fix")} title=${T("Fix address — {ip} is outside {iface}'s subnet", { ip: t.ip || "?", iface: t.iface })} onClick=${() => confirmCorrectDeployment(p, t)}><${Ic} i="check"/></button>`
                  : html`<button class="iconbtn qr" data-lbl="QR" title=${T("Show QR / configs")} onClick=${() => openPeerConfigs(p)}><${Ic} i="qr"/></button>`; })()}
            <button class="iconbtn" disabled=${blocked} data-lbl=${T("Edit")} title=${blocked ? T("Unavailable while the node is down / converting") : T("Edit peer")} onClick=${() => openEditPeer(p, { node: t.node, iface: t.iface })}><${Ic} i="pencil"/></button>
            ${p.unassigned
              ? html`<button class="iconbtn danger" disabled=${blocked} data-lbl=${T("Delete")} title=${blocked ? T("Unavailable while the node is down / converting") : T("Delete peer")} onClick=${() => confirmDeletePeer(p)}><${Ic} i="trash"/></button>`
              : html`<button class="iconbtn danger" disabled=${blocked} data-lbl=${T("Unassign")} title=${blocked ? T("Unavailable while the node is down / converting") : T("Unassign peer")} onClick=${() => confirmUnassign(p)}><${Ic} i="link"/></button>`}
          </td></tr>`;
      }) : html`<tr><td colspan=${((agg || loc) ? 9 : 8) - (hideUser ? 1 : 0)} class="empty"><b>${q ? T("No matches") : T("No peers here")}</b>${q ? T("Try a different search.") : (!agg ? T("Create one, or copy an existing peer onto this interface.") : T("No peers deployed yet."))}</td></tr>`}
    </tbody></table></div>`;
}

export function UsersHeader({ sort, dir, onSort }) {
  const arrow = c => sort === c ? (dir < 0 ? "↓ " : "↑ ") : "";
  const th = (c, label, cls) => html`<span class=${"clk" + (cls ? " " + cls : "")} onClick=${() => onSort(c)}>${arrow(c)}${label}</span>`;
  return html`<div class="uhead">
    <span></span>${th("status", T("col|Status"))}${th("name", T("col|User"))}
    <span class="u-right">${th("peers", T("col|Peers"), "uh-pc")}${th("nodes", T("col|Nodes"), "uh-srv")}${th("last", T("col|Online"))}${th("rate", T("col|Rate") + " ↓↑", "uh-r uh-rate")}${th("rtotal", trafficRangeLabel() + " ↓↑", "uh-r")}<span></span></span>
  </div>`;
}

let _fsCtl = null, _fsRedraw = null, _fsKey = null;
export function FilterSheet({ controls }) {
  useStore();
  const [, redraw] = useState(0);
  useEffect(() => { _fsRedraw = () => redraw(x => x + 1); return () => { _fsRedraw = null; _fsCtl = null; _fsKey = null; }; }, []);
  return html`<${Sheet} title=${T("Filters")} noGuard=${true}
    foot=${html`<button class="btn btn-primary" onClick=${closeModal}>${T("Done")}</button>`}>
    <div class="mfilters">${(_fsCtl || controls)(() => redraw(x => x + 1))}</div>
  <//>`;
}
export function sortField(view, sk, dk, cols, defdir, reset) {
  return html`<div class="msort"><span class="msort-l">${T("Sort by")}</span>
    <${Dropdown} className="selwrap" ariaLabel=${T("Sort by")} value=${view[sk]} options=${cols.map(([value, label]) => ({ value, label }))}
      onChange=${v => { view[sk] = v; view[dk] = defdir[v] || 1; reset(); }}/>
    <button type="button" class="btn btn-ghost msort-dir" aria-label=${view[dk] < 0 ? T("Descending") : T("Ascending")} title=${view[dk] < 0 ? T("Descending") : T("Ascending")}
      onClick=${() => { view[dk] = -(view[dk] || 1); reset(); }}>${view[dk] < 0 ? "↓" : "↑"}</button></div>`;
}
export const PEER_SORT = () => [["status", T("col|Status")], ["title", T("col|Title")], ["user", T("col|User")], ["server", T("col|Node")],
  ["address", T("col|Address")], ["online", T("col|Online")], ["rate", T("col|Rate")], ["total", T("col|Total")]];
export const USER_SORT = () => [["status", T("col|Status")], ["name", T("col|User")], ["peers", T("col|Peers")], ["nodes", T("col|Nodes")],
  ["last", T("col|Online")], ["rate", T("col|Rate")]];
export const filterBtn = (on, controls, key) => {
  const k = key || String(controls);
  if (_fsRedraw && _fsKey === k && _fsCtl !== controls) { _fsCtl = controls; queueMicrotask(_fsRedraw); }
  return html`<button class=${"iconbtn mfilter-btn" + (on ? " on" : "")} title=${T("Filters")} aria-label=${T("Filters")}
    onClick=${() => { _fsKey = k; _fsCtl = controls; openModal(html`<${FilterSheet} controls=${controls}/>`); }}><${Ic} i="sliders"/></button>`; };

export function EmbeddedPeers({ peers, view, onNew, newLabel, hideUser, hideToolbar, collapse, onlineOnly, freezeKey, owner }) {
  const [, force] = useState(0);
  const bump = () => force(x => x + 1);
  const nodeSet = new Set(), ifByNode = {};
  for (const p of peers) for (const t of p.targets) { nodeSet.add(t.node); (ifByNode[t.node] = ifByNode[t.node] || new Set()).add(t.iface); }
  const nodes = [...nodeSet].sort((a, b) => Store.byNode(a, b));
  const multiServer = nodes.length > 1;
  if (view.node && view.node !== "*" && !nodeSet.has(view.node)) view.node = "";
  if (!view.node) view.node = multiServer ? "*" : (nodes[0] || "*");
  const node = hideToolbar ? "*" : view.node;
  const ifaceOpts = node === "*"
    ? [...new Set(Object.values(ifByNode).flatMap(s => [...s]))].sort()
    : [...(ifByNode[node] || [])].sort();
  const ifaceDefault = () => (node === "*" || ifaceOpts.length > 1) ? "*" : (ifaceOpts[0] || "*");
  if (!view.iface) view.iface = ifaceDefault();
  if (!ifaceIsAll(view.iface) && !ifaceOpts.includes(view.iface)) view.iface = ifaceDefault();
  const iface = hideToolbar ? "*" : view.iface;
  const agg = node === "*" || ifaceIsAll(iface);
  const q = (view.q || "").toLowerCase();

  let rows = [];
  const shownByPeer = {};
  if (collapse) {
    for (const p of peers) {
      let ts = p.targets.filter(t => (node === "*" || t.node === node) && ifaceMatch(t.iface, iface, t));
      if (onlineOnly) ts = ts.filter(t => t.online);
      if (!ts.length) continue;
      if (!searchMatch((p.title || "") + " " + (p.name || "") + " " + p.targets.map(t => (t.ip || "") + " " + Store.nodeName(t.node) + " " + t.iface).join(" "), q)) continue;
      const rep = ts.slice().sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0))[0];
      rows.push({ p, t: rep, o: owner });
      shownByPeer[p.id] = new Set([tkey(rep.node, rep.iface)]);
    }
  } else {
    for (const p of peers) for (const t of p.targets) {
      if (node !== "*" && t.node !== node) continue;
      if (!ifaceMatch(t.iface, iface, t)) continue;
      if (onlineOnly && !t.online) continue;
      rows.push({ p, t, o: owner });
    }
    if (q) rows = rows.filter(({ p, t }) => searchMatch((p.title || "") + " " + (p.name || "") + " " + (t.ip || "") + " " + Store.nodeName(t.node) + " " + t.iface, q));
    for (const { p, t } of rows) (shownByPeer[p.id] = shownByPeer[p.id] || new Set()).add(tkey(t.node, t.iface));
  }
  if (!view.sort) { view.sort = "status"; view.dir = -1; }
  rows = sortPeerRows(rows, view.sort, view.dir, freezeKey ? freezeKey + "|" + node + "|" + iface : null);

  const pageSize = view.pageSize || 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, view.page || 1), totalPages);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const setPage = p => { view.page = p; bump(); };

  return html`<div class="peerspanel">
    ${hideToolbar ? null : html`<div class=${"toolbar sub" + (isMobile() ? " mtoolbar" : "")}>
      <${SearchBox} placeholder=${T("Search title, address…")} value=${view.q || ""} onInput=${e => { view.q = e.target.value; view.page = 1; bump(); }}/>
      ${(() => { const dd = r => html`${multiServer ? html`<${Dropdown} className="selwrap" ariaLabel=${T("All nodes")} value=${node}
        onChange=${v => { view.node = v; view.iface = ""; view.page = 1; bump(); if (r) r(); }}
        options=${[{ value: "*", label: T("All nodes") }, ...nodes.map(n => ({ value: n, label: Store.nodeName(n) }))]}/>` : null}
      ${ifaceOpts.length > 1 ? html`<${Dropdown} className="selwrap" ariaLabel=${T("All interfaces")} value=${iface}
        onChange=${v => { view.iface = v; view.page = 1; bump(); if (r) r(); }}
        options=${[{ value: "*", label: T("All interfaces") }, ...ifaceOptGroups(ifaceOpts)]}/>` : null}`;
        return isMobile() ? filterBtn(node !== (multiServer ? "*" : (nodes[0] || "*")) || iface !== ifaceDefault(), r => html`${dd(r)}${sortField(view, "sort", "dir", PEER_SORT(), PEER_DEFDIR, () => { view.page = 1; bump(); r(); })}`, view) : dd(); })()}
      ${onNew ? html`<span class="grow"></span><button class="btn btn-primary btn-mini" onClick=${onNew}><${Ic} i="plus"/> ${newLabel || T("New peer")}</button>` : null}
    </div>`}
    <${PeerGrid} rows=${pageRows} agg=${agg} node=${node} iface=${iface} shownByPeer=${shownByPeer} q=${view.q} hideUser=${hideUser} loc=${collapse} ranged=${!isMobile()} owner=${owner} sort=${view.sort} dir=${view.dir} onSort=${c => { peerSortBy(view, c); view.page = 1; bump(); }}/>
    ${rows.length > pageSize ? html`<div class="pager">
      <label class="pager-size">${T("Rows per page")}
        <${Dropdown} className="selwrap" ariaLabel=${T("Rows per page")} value=${pageSize} options=${pageSizeOpts()}
          onChange=${v => { view.pageSize = v; view.page = 1; bump(); }}/></label>
      <span class="pager-info">${T("{from}–{to} of {total}", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, rows.length), total: rows.length })}</span>
      <button class="btn btn-ghost" disabled=${page <= 1} onClick=${e => { setPage(page - 1); pageScroll(e, -1); }}>${T("‹ Prev")}</button>
      <span class="pager-pg">${page} / ${totalPages}</span>
      <button class="btn btn-ghost" disabled=${page >= totalPages} onClick=${e => { setPage(page + 1); pageScroll(e, 1); }}>${T("Next ›")}</button>
    </div>` : null}
  </div>`;
}

export function NodesRailPanel({ nav, active }) {
  const ns = Store.nodes || [];
  return html`<div class="railpanel railmenu railmenu-nodes">
    ${ns.map(n => {
      const down = Store.recon.nodeStatus[n.id] !== "live";
      const on = nav ? (n.id === active) : dashNodeOn(n.id);
      const cls = "railmenu-b node" + (on ? " on" : (nav ? "" : " off")) + (down ? " down" : "");
      const styl = "--c:" + Store.nodeColor(n.id);
      const inner = html`<span class="railmenu-ic"><span class="railnode-dot"></span></span><span class="railmenu-t">${n.name}</span>`;
      const notRep = down ? " · " + T("not reporting") : "";
      if (!nav)
        return html`<button key=${n.id} class=${cls} style=${styl} onClick=${() => dashToggleNode(n.id)} title=${(on ? T("Hide {v1}", { v1: n.name }) : T("Show {v1}", { v1: n.name })) + notRep}>${inner}</button>`;
      return on
        ? html`<span key=${n.id} class=${cls} style=${styl} title=${n.name + notRep}>${inner}</span>`
        : html`<a key=${n.id} class=${cls} style=${styl} href=${"#/node/" + encodeURIComponent(n.id)} title=${down ? T("Down — {v1}", { v1: n.name }) : T("Go to {v1}", { v1: n.name })}>${inner}</a>`;
    })}
  </div>`;
}

export function NodeRail({ active }) {
  if ((Store.nodes || []).length < 2 || isMobile()) return null;
  return html`<${Portal}><div class="dashrail noderail"><div class="dashrail-stack">
    <${NodesRailPanel} nav=${true} active=${active}/>
  </div></div><//>`;
}
