import { ago, seen, isMobile } from "./util.js";
import { T, Tsplit, Trich, plural, srvVerb, srvDetail, srvName } from "./i18n.js";
import { Store, api, useStore } from "./store.js";
import { ifaceIsAll, targetType } from "./model.js";
import { Dropdown, Ic, RowError, SearchBox, Sheet, StoreOffBanner, Tag, closeModal,
  lifecycleIcon, openConfirm, openModal, rateCell, rowDouble, rowNoSelect, rowSingle, secTitle, tgt3 } from "./ui.js";
import {
  EV_ACTIONS, EV_ITEMS, evItemLabel, evActionLabel, USER_DEFDIR, activityView, evDecorate,
  ifaceFilterOptions, nodeFilterOptions, pageScroll, pageSizeOpts, peerMatchesQ, peerInRosterStatus,
  peerStatusFilters, sortColToggle, sortUsers, unassignedView, userIdentityMatchesQ,
  userMatchesQ, userOnNodeIface, userPeerViews, userStatTag, userStats, usersView,
} from "./views.js";
import { openUserConfigs, openUserEdit, UserCounts } from "./peer-ui.js";
import { openAddPeers, openCreateUser, openUserView } from "./sheets-crud.js";
import { TrafficRail, UserTrafficCell } from "./traffic-ui.js";
import { EmbeddedPeers, UsersHeader, filterBtn, sortField, USER_SORT } from "./grids.js";
import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

function RowsPager({ total, page, pageSize, onPage, onSize }) {
  if (total <= 20) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return html`<div class="pager">
    <label class="pager-size">${T("Rows per page")}
      <${Dropdown} className="selwrap" ariaLabel=${T("Rows per page")} value=${pageSize} options=${pageSizeOpts()} onChange=${onSize}/>
    </label>
    <span class="pager-info">${T("{from}–{to} of {total}", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}</span>
    <button class="btn btn-ghost" disabled=${page <= 1} onClick=${e => { onPage(page - 1); pageScroll(e, -1); }}>${T("‹ Prev")}</button>
    <span class="pager-pg">${page} / ${pages}</span>
    <button class="btn btn-ghost" disabled=${page >= pages} onClick=${e => { onPage(page + 1); pageScroll(e, 1); }}>${T("Next ›")}</button>
  </div>`;
}

function noPeersYet(onAdd) {
  const [before, after] = Tsplit("No peers yet — {add}.", "add");
  return html`<${Fragment}>${before}<button class="linkbtn" onClick=${onAdd}>${T("add one")}</button>${after}<//>`;
}

export function ActivityHistoryScreen() {
  const [rows, setRows] = useState(null);
  const [, force] = useState(0);
  const bump = () => force(x => x + 1);
  const load = () => api.events(1000).then(r => setRows(Array.isArray(r.data) ? r.data : [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  const all = (rows || []).map(evDecorate);
  const q = activityView.q.toLowerCase();
  let list = all;
  if (activityView.item) list = list.filter(e => e.item === activityView.item);
  if (activityView.action) list = list.filter(e => e.action === activityView.action);
  if (q) list = list.filter(e => (e.verb + " " + srvVerb(e.verb) + " " + e.name + " " + (e.detail || "") + " " + srvDetail(e))
    .toLowerCase().includes(q));
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const page = Math.min(Math.max(1, activityView.page), totalPages);
  const pageRows = list.slice((page - 1) * pageSize, page * pageSize);
  const setPage = p => { activityView.page = p; bump(); };
  const delOne = e => openConfirm({ title: T("Delete this entry?"), confirmLabel: T("Delete"), danger: true,
    body: Trich("Remove this record — *{v1}{v2}*? This can't be undone.", { v1: srvVerb(e.verb), v2: e.name ? " · " + e.name : "" }),
    onConfirm: async () => { await api.eventDelete(e.eid); await load(); } });
  const clearAll = () => openConfirm({ title: T("Clear all activity?"), confirmLabel: T("Clear history"), danger: true,
    body: Trich("Delete *all {v1}* from the activity log? This can't be undone.", { v1: plural(all.length, "record") }),
    onConfirm: async () => { await api.eventsClear(); activityView.page = 1; await load(); } });
  const m = isMobile();
  const clearBtn = html`<button class="btn btn-danger" disabled=${!all.length} onClick=${clearAll}><${Ic} i="trash"/> ${T("Clear history")}</button>`;
  return html`<div class="screen">
    <div class="crumb"><a href="#/">${T("Overview")}</a><span class="sep">/</span><b>${T("Activity history")}</b></div>
    <div class=${"toolbar" + (m ? " mtoolbar" : "")}>
      <${SearchBox} placeholder=${T("Search action, name, detail…")} value=${activityView.q} onInput=${e => { activityView.q = e.target.value; activityView.page = 1; bump(); }}/>
      ${(() => { const dd = r => html`<${Dropdown} className="selwrap" ariaLabel=${T("All items")} value=${activityView.item}
        onChange=${v => { activityView.item = v; activityView.page = 1; bump(); if (r) r(); }}
        options=${[{ value: "", label: T("All items") }, ...EV_ITEMS.map(i => ({ value: i, label: evItemLabel(i) }))]}/>
      <${Dropdown} className="selwrap" ariaLabel=${T("All actions")} value=${activityView.action}
        onChange=${v => { activityView.action = v; activityView.page = 1; bump(); if (r) r(); }}
        options=${[{ value: "", label: T("All actions") }, ...EV_ACTIONS.map(a => ({ value: a, label: evActionLabel(a) }))]}/>`;
        return m ? filterBtn(!!(activityView.item || activityView.action), dd) : dd(); })()}
      ${m ? null : clearBtn}
    </div>
    ${secTitle(T("Activity history"), html`${list.length}${list.length !== all.length ? " / " + all.length : ""}`, false)}
    ${rows === null ? html`<div class="loading"><${Ic} i="refresh"/> ${T("Loading…")}</div>`
      : !all.length ? html`<div class="empty"><b>${T("No activity yet")}</b>${T("Operator actions across the panel will show up here.")}</div>`
      : !list.length ? html`<div class="empty"><b>${T("No matches")}</b>${T("Try a different search or filter.")}</div>`
      : html`<div class="acthist">${pageRows.map(e => html`<div class=${"act-row" + (e.click ? "" : " noclk")} key=${e.key}>
          <span class=${"act-ic t-" + e.slug}><${Ic} i=${e.icon}/></span>
          ${e.click
            ? html`<a class="act-link" href=${e.click.href} onClick=${e.click.on ? (ev => { ev.preventDefault(); e.click.on(); }) : null}><span class="act-what">${srvVerb(e.verb)}</span>${e.name ? html`<span class="act-name">${srvName(e)}</span>` : null}</a>`
            : html`<span class="act-what">${srvVerb(e.verb)}</span>${e.name ? html`<span class="act-name">${srvName(e)}</span>` : null}`}
          ${e.detail || e.detail_key ? html`<span class="act-detail">${srvDetail(e)}</span>` : null}
          <span class="grow"></span>
          <span class="act-cat">${e.itemLabel || e.item}</span>
          <span class="when">${ago(e.ts)}</span>
          <button class="iconbtn danger" title=${T("Delete entry")} data-lbl=${T("Delete")} onClick=${() => delOne(e)}><${Ic} i="x"/></button>
        </div>`)}</div>`}
    ${list.length > pageSize ? html`<div class="pager">
      <span class="pager-info">${T("{from}–{to} of {total}", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, list.length), total: list.length })}</span>
      <button class="btn btn-ghost" disabled=${page <= 1} onClick=${() => setPage(page - 1)}>${T("‹ Prev")}</button>
      <span class="pager-pg">${page} / ${totalPages}</span>
      <button class="btn btn-ghost" disabled=${page >= totalPages} onClick=${() => setPage(page + 1)}>${T("Next ›")}</button>
    </div>` : null}
    ${m && all.length ? html`<div class="m-actclear">${clearBtn}</div>` : null}
  </div>`;
}

function nodesOfPeers(peers) {
  const nm = {};
  for (const p of peers) for (const t of p.targets) {
    const nn = nm[t.node] = nm[t.node] || {};
    if (!nn[t.iface]) nn[t.iface] = { iface: t.iface, type: targetType(t), gen3: tgt3(t), count: 0 };
    nn[t.iface].count++;
  }
  return Object.keys(nm).map(nid => ({ node: nid, ifaces: Object.values(nm[nid]).sort((a, b) => a.iface.localeCompare(b.iface)) }))
    .sort((a, b) => Store.byNode(a.node, b.node));
}
function nodesTap(srvNodes, title) {
  if (!isMobile() || !srvNodes.length) return null;
  const nif = srvNodes.reduce((a, n) => a + n.ifaces.length, 0);
  const label = plural(srvNodes.length, "node") + " · " + plural(nif, "interface");
  return html`<span class="u-srvtap" role="button" aria-label=${label} onClick=${e => { e.stopPropagation(); openModal(html`<${NodesSheet} title=${title} label=${label} srvNodes=${srvNodes}/>`); }}
    onDblClick=${e => e.stopPropagation()}><span class="u-srv-n"><${Ic} i="server"/>${srvNodes.length}</span><span class="u-srv-i"><${Ic} i="globe"/>${nif}</span></span>`;
}
function NodesSheet({ title, label, srvNodes }) {
  const to = h => { closeModal(); location.hash = h; };
  return html`<${Sheet} title=${title} noGuard=${true} foot=${html`<button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Close")}</button>`}>
    <div class="m-nodesheet">
      <div class="m-ns-sum">${label}</div>
      ${srvNodes.map(n => html`<div class="m-ns-node" key=${n.node}>
        <button class="m-ns-nm" onClick=${() => to("#/node/" + encodeURIComponent(n.node))}><span class="nsrv" style=${"--c:" + Store.nodeColor(n.node)}>${Store.nodeName(n.node)}</span><${Ic} i="arrow"/></button>
        ${n.ifaces.map(f => html`<button class="m-ns-if" key=${f.iface} onClick=${() => to("#/node/" + encodeURIComponent(n.node) + "/" + encodeURIComponent(f.iface))}>
          <${Tag} kind=${f.type} label=${f.iface} gen3=${f.gen3}/><span class="m-ns-pc">${plural(f.count, "cap|Peer")}</span><${Ic} i="arrow"/></button>`)}
      </div>`)}
    </div>
  <//>`;
}
function nodesChip(srvNodes) {
  if (!srvNodes.length) return html`<span class="faint">—</span>`;
  return html`<span class="turnwrap srvwrap" title="" onClick=${e => e.stopPropagation()}>
    <span class="srvchips">
      ${srvNodes.length === 1 ? html`<span class="nsrv" style=${"--c:" + Store.nodeColor(srvNodes[0].node)}>${Store.nodeName(srvNodes[0].node)}</span>`
        : html`<span class="nsrv-agg"><${Ic} i="server"/>${plural(srvNodes.length, "cap|Node")}</span>`}
    </span>
    <span class="turnbub servbub">${srvNodes.flatMap(n => n.ifaces.map(f => html`<span class="servbub-row">
      <span class="nsrv" style=${"--c:" + Store.nodeColor(n.node)}>${Store.nodeName(n.node)}</span>
      <${Tag} kind=${f.type} label=${f.iface} gen3=${f.gen3}/>
      <span class="servbub-pc">${plural(f.count, "cap|Peer")}</span>
    </span>`))}</span>
  </span>`;
}

export function UserRow({ user, onlineOnly, q, nested }) {
  const [, force] = useState(0);
  const searching = !!q;
  const idMatch = userIdentityMatchesQ(user, q);
  const expanded = searching ? (usersView.expanded[user.id] !== false) : !!usersView.expanded[user.id];
  const toggle = () => { usersView.expanded[user.id] = !expanded; force(x => x + 1); };
  const allPeers = Store.peersByUser(user.id);
  const shownPeers = allPeers.filter(p => (!searching || idMatch || peerMatchesQ(p, q))
    && peerInRosterStatus(p, nested ? "" : usersView.status));
  const srvNodes = nodesOfPeers(allPeers);
  const st = userStats(user.id);
  const view = userPeerViews[user.id] || (userPeerViews[user.id] = { node: "", iface: "", q: "", page: 1, pageSize: 20, sort: "status", dir: -1 });
  return html`<div class=${"urow" + (expanded ? " open" : "")} id=${nested ? null : "urow-" + user.id}>
    <div class="urow-head" title=${T("Double-click for QR / configs")} onMouseDown=${rowNoSelect} onClick=${e => rowSingle(e, toggle)} onDblClick=${e => rowDouble(e, () => openUserConfigs(user))}>
      <span class="u-exp"><${Ic} i="arrow"/></span>
      ${userStatTag(user)}
      <span class="u-name">${lifecycleIcon(user, user.peerCount ? user.status : "empty")}<span class="un">${user.name}</span><${UserCounts} user=${user}/></span>
      <span class="u-right">
        <span class="u-counts">${(() => {
          const onc = html`<span class=${"u-onc" + (user.onlineCount ? " on" : "")}>${T("{n} Online", { n: user.onlineCount })}</span>`;
          const pc = html`<span class="u-pc">${plural(user.peerCount, "cap|Peer")}</span>`;
          const sep = html`<span class="u-dot"> · </span>`;
          return html`${pc}${user.peerCount ? html`${sep}${onc}` : null}`;
        })()}</span>
        <span class="u-servers">${nodesChip(srvNodes)}</span>${nodesTap(srvNodes, user.name)}
        <span class="u-last">${st.last == null ? html`<span class="u-never">${T("Never")}</span>` : html`<span class="when">${seen(st.last)}</span>`}</span>
        <span class="u-thru">${rateCell(st.rx, st.tx)}</span>
        ${  isMobile() ? null
          : html`<span class="u-total clk" role="button" tabindex="0" title=${T("Open this user's traffic — graph and devices")}
              onClick=${e => { e.stopPropagation(); openUserView(user.id); }} onDblClick=${e => e.stopPropagation()}
              onKeyDown=${e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openUserView(user.id); } }}><${UserTrafficCell} uid=${user.id}/></span>`}
        <span class="u-acts" onClick=${e => e.stopPropagation()}>
          <button class="iconbtn qr" title=${T("Show QR / configs")} data-lbl="QR" onClick=${() => openUserConfigs(user)}><${Ic} i="qr"/></button>
          <button class="iconbtn" title=${T("Traffic — graph and devices")} aria-label=${T("Traffic — graph and devices")} data-lbl=${T("Traffic")} onClick=${() => openUserView(user.id)}><${Ic} i="bars"/></button>
          <button class="iconbtn" title=${T("Edit user")} data-lbl=${T("Edit")} onClick=${() => openUserEdit(user)}><${Ic} i="pencil"/></button>
          <button class="iconbtn iconbtn-add" title=${T("Add peer")} data-lbl=${T("rowact|Device")} onClick=${() => openAddPeers(user.id, user.name)}><${Ic} i="plus"/></button>
        </span>
      </span>
    </div>
    ${expanded ? html`<div class="urow-body">
      ${shownPeers.length ? html`<${EmbeddedPeers} peers=${shownPeers} view=${view} hideUser=${true} hideToolbar=${true} collapse=${true} onlineOnly=${onlineOnly} owner=${user.id} freezeKey=${"uembed|" + user.id}/>`
        : html`<div class="ug-empty">${user.peerCount ? T("No peers match.") : noPeersYet(() => openAddPeers(user.id, user.name))}</div>`}
    </div>` : null}
    <${RowError} k=${"user:" + user.id}/>
  </div>`;
}

const userPassesFilters = u => userOnNodeIface(u, usersView.node, usersView.iface)
  && (!usersView.online || u.onlineCount > 0)
  && (!usersView.status || Store.peersByUser(u.id).some(p => peerInRosterStatus(p, usersView.status)));
const filtersOn = () => !!(usersView.node || usersView.iface || usersView.online || usersView.status);
function RosterFilters({ reset }) {
  const allIfaces = Array.from(new Set(Object.keys(Store.describe).flatMap(n => Store.userIfacesOf(n)))).sort();
  const ifaceOpts = usersView.node ? Store.userIfacesOf(usersView.node) : allIfaces;
  if (!ifaceIsAll(usersView.iface) && !ifaceOpts.includes(usersView.iface)) usersView.iface = "";
  return html`<${Fragment}>
    <${Dropdown} className="selwrap" ariaLabel=${T("All nodes")} value=${usersView.node}
      onChange=${v => { usersView.node = v; usersView.iface = ""; reset(); }}
      options=${nodeFilterOptions("")}/>
    <${Dropdown} className="selwrap" ariaLabel=${T("All interfaces")} value=${usersView.iface}
      onChange=${v => { usersView.iface = v; reset(); }}
      options=${ifaceFilterOptions(ifaceOpts, "")}/>
    <${Dropdown} className="selwrap" ariaLabel=${T("All statuses")} value=${usersView.status}
      onChange=${v => { usersView.status = v; reset(); }} options=${peerStatusFilters()}/>
    <button class=${"onlbtn" + (usersView.online ? " on" : "")} aria-pressed=${!!usersView.online} title=${T("Show only users with a device online")}
      onClick=${() => { usersView.online = !usersView.online; reset(); }}>${T("status|Online")}</button>
  <//>`;
}

export function UsersScreen() {
  useStore();
  const [, force] = useState(0);
  const q = usersView.q.toLowerCase();
  const allUsers = Store.recon.users;
  const users = sortUsers(allUsers, usersView.sort, usersView.dir, "users").filter(u => userMatchesQ(u, q) && userPassesFilters(u));
  const unassigned = Store.unassignedPeers().filter(p => peerInRosterStatus(p, usersView.status)
    && (!usersView.online || p.targets.some(t => t.online)));

  const pageSize = usersView.pageSize || 20;
  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  const page = Math.min(Math.max(1, usersView.page || 1), totalPages);
  const pageUsers = users.slice((page - 1) * pageSize, page * pageSize);
  const setPage = p => { usersView.page = p; force(x => x + 1); };

  return html`<div class="screen">
    <${StoreOffBanner}/>
    ${isMobile() ? null : html`<${TrafficRail}/>`}
    ${isMobile() ? html`<div class="toolbar mtoolbar">
      <${SearchBox} placeholder=${T("Search users and peers…")} value=${usersView.q} onInput=${e => { usersView.q = e.target.value; usersView.page = 1; force(x => x + 1); }}/>
      ${filterBtn(filtersOn(), redraw => { const reset = () => { usersView.page = 1; redraw(); force(x => x + 1); };
        return html`<${Fragment}>
          <${RosterFilters} reset=${reset}/>
          ${sortField(usersView, "sort", "dir", USER_SORT(), USER_DEFDIR, reset)}<//>`; })}
      <button class="btn btn-primary mfab" onClick=${openCreateUser}><span class="plus"><${Ic} i="plus"/></span> ${T("New user")}</button>
    </div>` : html`<div class="toolbar">
      <${SearchBox} placeholder=${T("Search users and peers…")} value=${usersView.q} onInput=${e => { usersView.q = e.target.value; usersView.page = 1; force(x => x + 1); }}/>
      <${RosterFilters} reset=${() => { usersView.page = 1; force(x => x + 1); }}/>
      <button class="btn btn-primary" onClick=${openCreateUser}><span class="plus"><${Ic} i="plus"/></span> ${T("New user")}</button>
    </div>`}

    ${secTitle(T("Total users"), users.length, false)}
    ${!allUsers.length ? html`<div class="empty"><b>${T("No users yet")}</b>${T("Create a user, then add their devices.")}</div>`
      : !users.length ? html`<div class="empty"><b>${T("Nothing matches")}</b>${filtersOn() ? T("Clear the filters.") : T("Clear the search.")}</div>`
      : html`<${Fragment}>
        <${UsersHeader} sort=${usersView.sort} dir=${usersView.dir} onSort=${c => { sortColToggle(usersView, "sort", "dir", c, USER_DEFDIR); usersView.page = 1; force(x => x + 1); }}/>
        <div class="urows">${pageUsers.map(u => html`<${UserRow} key=${u.id} user=${u} q=${q} onlineOnly=${usersView.online}/>`)}</div>
      <//>`}
    <${RowsPager} total=${users.length} page=${page} pageSize=${pageSize} onPage=${setPage}
      onSize=${v => { usersView.pageSize = v; usersView.page = 1; force(x => x + 1); }}/>

    ${unassigned.length ? html`<${Fragment}>
      <div class="section-title" id="unassigned-peers"><h2 style="color:var(--faint)">${T("Unassigned peers")}</h2><span class="count">${unassigned.length}</span></div>
      <${EmbeddedPeers} peers=${unassigned} view=${unassignedView} collapse=${true} freezeKey=${"unassigned-embed"}/>
    <//>` : null}
  </div>`;
}
