import { fmtBytes } from "./util.js";
import { T, locale } from "./i18n.js";
import { Store, useStore, bus } from "./store.js";
import { Ic, Popover, Portal, xferCell, dlul } from "./ui.js";
import { ChartHover } from "./charts.js";
import { trafficRangeLabel, peerTraffic, userTraffic, groupTraffic } from "./views.js";
import { trafficView, trafficModalView, trafficTotals, trafficData, trafficSeries, panelToday, volumeColumns, customWindow } from "./traffic.js";
import { h, Fragment } from "preact";
import { useState, useRef } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

const _fmt = {};
function panelDate(ts, withTime) {
  if (!ts) return "";
  const off = ((Store.panelSettings || {}).time_zone_now || {}).offset || 0;
  const d = new Date((ts + off) * 1000);
  try {
    const k = locale() + (withTime ? "|t" : "|d");
    const f = _fmt[k] || (_fmt[k] = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }), timeZone: "UTC" }));
    return f.format(d);
  } catch (_) { return d.toISOString().slice(0, withTime ? 16 : 10).replace("T", " "); }
}
const pair = (rx, tx) => { const [d, u] = dlul(rx, tx); return "↓ " + fmtBytes(d) + "  ↑ " + fmtBytes(u); };

const RANGE_ROWS = [["all", "clock"], ["today", "daycal"], ["7d", "weekcal"], ["30d", "monthcal"]];
const rangeName = r => ({ all: T("All time"), today: T("range|Day"), "7d": T("range|Week"), "30d": T("range|Month") })[r];
const setRange = patch => { Object.assign(trafficView, patch); bus.emit(); };
const customStart = today => ({ range: "custom", from: trafficView.from || today.slice(0, 8) + "01",
  to: trafficView.to && trafficView.to <= today ? trafficView.to : today });

export function TrafficRange({ view }) {
  const [, force] = useState(0);
  const v = view || trafficModalView, today = panelToday();
  const set = patch => { Object.assign(v, patch); bus.emit(); force(x => x + 1); };
  const pick = r => set(r !== "custom" ? { range: r } : { range: "custom", from: v.from || today.slice(0, 8) + "01", to: v.to && v.to <= today ? v.to : today });
  const tab = (r, label) => html`<button type="button" class=${"rtab" + (v.range === r ? " on" : "")} aria-pressed=${v.range === r} onClick=${() => pick(r)}>${label}</button>`;
  return html`<span class="trange" title=${T("The window the traffic figures count — in the panel's days (Settings → Display)")}>
    <span class="rangetabs">${RANGE_ROWS.filter(([r]) => r !== "all").map(([r]) => tab(r, rangeName(r)))}${tab("custom", T("range|Custom"))}</span>
    ${v.range === "custom" ? html`<${DateWindow} key=${v.from + v.to} from=${v.from} to=${v.to} max=${today} check=${true} onApply=${(from, to) => set({ from, to })}/>` : null}
  </span>`;
}

export function TrafficRail() {
  useStore();
  const v = trafficView, today = panelToday();
  const on = v.range === "custom";
  const draft = on ? v : customStart(today);
  return html`<${Portal}><div class="dashrail trafficrail"><div class="dashrail-stack">
    <div class="railpanel railmenu" role="group" aria-label=${T("Traffic window")}>
      ${RANGE_ROWS.map(([r, ic]) => html`<button type="button" key=${r} class=${"railmenu-b" + (v.range === r ? " on" : "")} aria-pressed=${v.range === r}
          title=${trafficRangeLabel({ range: r })} onClick=${() => setRange({ range: r })}>
        <span class="railmenu-ic"><${Ic} i=${ic}/></span><span class="railmenu-t">${rangeName(r)}</span></button>`)}
      <${RailCustom} key=${v.range + v.from + v.to} on=${on} label=${on ? trafficRangeLabel() : ""} from=${draft.from} to=${draft.to} max=${today}
        onApply=${(from, to) => setRange({ range: "custom", from, to })}/>
    </div>
  </div></div><//>`;
}

export function RailCustom({ on, label, from, to, min, max, onApply }) {
  const name = on && label ? label : T("range|Custom");
  const trig = html`<span class=${"railmenu-b" + (on ? " on" : "")} role="button" tabindex="0" title=${name}>
    <span class="railmenu-ic"><${Ic} i="cal"/></span><span class="railmenu-t">${name}</span></span>`;
  return html`<${Popover} clickOnly cls="railcustom" popCls="railcustom-pop trail-pop" trigger=${trig}>
    <span class="netroute-h">${T("range|Custom")}</span>
    <${DateWindow} from=${from} to=${to} min=${min} max=${max} pending=${!on} onApply=${onApply}/>
  <//>`;
}

export function DateWindow({ from, to, min, max, onApply, pending, check }) {
  const [draft, setDraft] = useState(null);
  const dr = draft || { from, to };
  const pick = e => { if (e.button !== 0 || typeof e.currentTarget.showPicker !== "function") return;
    e.preventDefault(); try { e.currentTarget.showPicker(); } catch (_) { e.currentTarget.focus(); } };
  const date = k => html`<input type="date" class="datein" value=${dr[k]} min=${min || "1970-01-01"} max=${max}
    aria-label=${k === "from" ? T("From") : T("To")} data-nodirty data-noautofocus
    onMouseDown=${pick} onInput=${e => setDraft({ ...dr, [k]: e.target.value })}/>`;
  const w = customWindow(dr.from, dr.to, max, min);
  const bad = !w.ok && w.why !== "incomplete";
  const changed = !!pending || (!!draft && (dr.from !== from || dr.to !== to));
  const apply = () => { if (w.ok) { setDraft(null); onApply(w.from, w.to); } };
  return html`<${Fragment}><span class="trange-dates" onKeyDown=${e => { if (e.key === "Enter") apply(); }}>${date("from")}<span class="faint">–</span>${date("to")}
      ${!changed ? null : check
        ? html`<button type="button" class="iconbtn iconbtn-ok" disabled=${!w.ok} title=${T("Apply")} aria-label=${T("Apply")} onClick=${apply}><${Ic} i="check"/></button>`
        : html`<button type="button" class="btn btn-mini" disabled=${!w.ok} onClick=${apply}>${T("Apply")}</button>`}</span>
    ${bad ? html`<span class="hint warn">${w.why === "future" ? T("The start is after today.") : w.why === "early"
      ? T("The charts go back to {v1}.", { v1: trafficRangeLabel({ range: "custom", from: min, to: min }) }) : T("The start is after the end.")}</span>` : null}<//>`;
}

export function TrafficCell({ a, e, ctx, user }) {
  if (e && e.off) return html`<span class="faint" title=${T("Traffic totals are off — Settings → Display says why.")}>—</span>`;
  if (!e || !e.data) return html`<span class="faint">…</span>`;
  const rx = a ? a.rx : 0, tx = a ? a.tx : 0;
  const cell = xferCell(...dlul(rx, tx));
  return html`<${Popover} hoverOnly cls="tcellpop" popCls="netroute-bub tbub" trigger=${cell}><${TrafficBubble} a=${a} rx=${rx} tx=${tx} ctx=${ctx} user=${user}/><//>`;
}
function TrafficBubble({ a, rx, tx, ctx, user }) {
  const c = ctx || {};
  const notes = user ? [] : [
    !c.owner && a && a.owners > 1 ? T("The whole device — including what it carried for an earlier owner.") : null,
    c.group ? T("Every member's devices added together — someone in two groups counts in both.") : null,
    c.ungrouped ? T("This peer's total across all its deployments — every row of it repeats it.") : null,
    c.filtered ? T("The whole peer, not only the deployments this filter shows.") : null,
    c.wire ? T("On {v1} now: {v2} — since the interface came up", { v1: c.iface, v2: pair(c.wire.rx_bytes || 0, c.wire.tx_bytes || 0) }) : null,
  ];
  const d = user ? trafficData() : null;
  const gone = d ? goneDevices(user, d) : 0;
  return html`<${Fragment}>
    <span class="netroute-h">${trafficRangeLabel()}</span>
    <div class="tb-row"><b>${pair(rx, tx)}</b></div>
    ${a ? html`<div class="tb-row">${T("Lifetime")}: ${pair(a.lifetime_rx, a.lifetime_tx)}</div>
      ${a.opening_rx || a.opening_tx ? html`<div class="tb-row sub">${T("Of which {v1} was already on the counters.", { v1: pair(a.opening_rx, a.opening_tx) })}</div>` : null}`
      : html`<div class="tb-row sub">${T("Nothing counted yet.")}</div>`}
    ${gone ? html`<div class="tb-row">${T("Includes devices no longer theirs (deleted or handed on): {n}", { n: gone })}</div>` : null}
    ${notes.filter(Boolean).map(n => html`<div class="tb-row">${n}</div>`)}
  <//>`;
}

export function PeerTrafficCell({ pid, owner, ungrouped, filtered, wire, iface }) {
  return html`<${TrafficCell} a=${peerTraffic(pid, owner)} e=${trafficTotals()} ctx=${{ owner, ungrouped, filtered, wire, iface }}/>`;
}
export function UserTrafficCell({ uid }) {
  return html`<${TrafficCell} a=${userTraffic(uid)} e=${trafficTotals()} user=${uid}/>`;
}
export function goneDevices(uid, d) {
  let n = 0;
  for (const r of (d.rows.get(uid) || [])) { const p = Store.peer(r.id); if (!p || p.user_id !== uid) n++; }
  return n;
}

export function VolumeBars({ series, h }) {
  const [hov, setHov] = useState(null); const wref = useRef(null);
  h = h || 84;
  if (!series) return html`<div class="harea-wrap vbars-empty" style=${"height:" + h + "px"}></div>`;
  const cols = volumeColumns(series.points, series.since, series.until);
  const oriented = cols.map(c => { const [d, u] = dlul(c.rx, c.tx); return { ...c, d, u }; });
  const hi = Math.max(1, ...oriented.map(c => c.d + c.u));
  const n = oriented.length;
  const onMove = ev => { const el = wref.current; if (!el) return; const r = el.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left) / r.width * n); setHov(i >= 0 && i < n ? i : null); };
  const label = c => (c.step >= 86400 ? panelDate(c.start + 43200) : panelDate(c.start, true)) + " · ↓ " + fmtBytes(c.d) + " · ↑ " + fmtBytes(c.u);
  const any = oriented.some(c => c.d + c.u > 0);
  return html`<div class="vbars" ref=${wref} style=${"height:" + h + "px"} onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
    ${!any ? html`<div class="vbars-none faint">${T("No traffic in this window.")}</div>` : null}
    ${oriented.map((c, i) => html`<div class=${"vbar" + (hov === i ? " hot" : "")} key=${i}>
      ${c.u ? html`<i class="u" style=${"height:" + (c.u / hi * 100) + "%"}></i>` : null}
      ${c.d ? html`<i class="d" style=${"height:" + (c.d / hi * 100) + "%"}></i>` : null}</div>`)}
    ${hov != null ? html`<${ChartHover} xp=${(hov + 0.5) / n * 100} dots=${[]} label=${label(oriented[hov])}/>` : null}
  </div>`;
}

export function TrafficBlock({ by, id }) {
  useStore();
  const mv = trafficModalView;
  const e = trafficTotals(mv);
  const s = trafficSeries(by, id, mv, by === "group" ? ((Store.group(id) || {}).users || []).slice().sort().join(",") : "");
  const td = e && e.data;
  const a = !td ? null : by === "peer" ? td.peer.get(id) || null : by === "user" ? td.user.get(id) || null : groupTraffic(td, id);
  const d = s.data;
  const gaps = d && d.gaps ? Object.keys(d.gaps).filter(k => (d.gaps[k] || []).some(g => g[0] > d.since)) : [];
  return html`<div class="tblock">
    <div class="tblock-head"><span class="lbl">${T("Traffic")}</span><span class="grow"></span><${TrafficRange} view=${mv}/></div>
    ${e && e.off ? html`<div class="notice warn">${T("Traffic totals are off — Settings → Display says why.")}</div>` : html`<${Fragment}>
      <div class="tp-legend tblock-sum">
        <span class="tp-k"><i class="sw rx"></i>↓ ${fmtBytes(a ? dlul(a.rx, a.tx)[0] : 0)}</span>
        <span class="tp-k"><i class="sw tx"></i>↑ ${fmtBytes(a ? dlul(a.rx, a.tx)[1] : 0)}</span>
        <span class="tp-peak">${trafficRangeLabel(mv)}</span>
        ${a ? html`<span class="tp-peak">${T("Lifetime")} ${pair(a.lifetime_rx, a.lifetime_tx)}</span>` : null}
      </div>
      <${VolumeBars} series=${d}/>
      ${gaps.length ? html`<div class="hint">${T("A server this traffic crosses was not reporting for part of the window: what it carried meanwhile lands in the column where it reported again.")}</div>` : null}
      ${s.err && !d ? html`<div class="hint warn">${T("The graph could not be loaded.")}</div>` : null}
    <//>`}
  </div>`;
}
