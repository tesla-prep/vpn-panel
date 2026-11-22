
import { resolvedTheme } from "./theme.js";
import { Store, api } from "./store.js";
import { Tag, Panel, rate, niceScaleCeil } from "./ui.js";
import { T, locale } from "./i18n.js";
import { rangeLabel } from "./views.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export function TrendSpark({ data, w = 104, h = 24, color = "var(--brand)" }) {
  const a = (data || []).filter(v => v != null);
  if (a.length < 2) return null;
  const max = Math.max.apply(null, a), min = Math.min.apply(null, a), span = (max - min) || 1, n = a.length;
  const xy = a.map((v, i) => [(i / (n - 1)) * w, h - 1 - ((v - min) / span) * (h - 3)]);
  const line = xy.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  if (max <= 0) return null;
  return html`<svg class="spark" width=${w} height=${h} viewBox=${"0 0 " + w + " " + h} preserveAspectRatio="none" aria-hidden="true">
    <polygon points=${"0," + h + " " + line + " " + w + "," + h} fill=${color} opacity="0.12"/>
    <polyline points=${line} fill="none" stroke=${color} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

export function Sparkline({ points, color, w, h }) {
  w = w || 90; h = h || 22;
  const pts = (points || []).filter(v => v != null);
  if (pts.length < 2) return html`<svg class="spark" width=${w} height=${h}></svg>`;
  const max = 100, n = pts.length;
  const d = pts.map((v, i) => (i / (n - 1) * (w - 2) + 1).toFixed(1) + "," + (h - 1 - Math.min(max, Math.max(0, v)) / max * (h - 2)).toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return html`<svg class="spark" width=${w} height=${h} viewBox=${"0 0 " + w + " " + h} preserveAspectRatio="none">
    <polyline points=${d} fill="none" stroke=${color || "var(--online)"} stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx=${(w - 1).toFixed(1)} cy=${(h - 1 - Math.min(max, Math.max(0, last)) / max * (h - 2)).toFixed(1)} r="1.6" fill=${color || "var(--online)"}/>
  </svg>`;
}
const _md = {};
const monthDay = d => { const k = locale() === "en-GB" ? "en-US" : locale(); try { return (_md[k] || (_md[k] = new Intl.DateTimeFormat(k, { month: "long", day: "numeric" }))).format(d); }
  catch (_) { return d.toISOString().slice(0, 10); } };
export function histTime(ts, range) {
  if (ts == null) return "";
  const d = new Date(ts * 1000), p2 = x => String(x).padStart(2, "0");
  const hm = p2(d.getHours()) + ":" + p2(d.getMinutes());
  const date = monthDay(d);
  if (range === "month") return date;
  if (range === "day" || range === "week") return date + " " + hm;
  if (range === "live") return hm + ":" + p2(d.getSeconds());
  if (/^custom:/.test(range || "")) return hm === "00:00" ? date : date + " " + hm;
  return hm;
}
export function ChartHover({ xp, dots, label }) {
  const anchor = xp < 22 ? "translateX(0)" : xp > 78 ? "translateX(-100%)" : "translateX(-50%)";
  return html`<${Fragment}>
    <div class="ch-guide" style=${"left:" + xp + "%"}></div>
    ${(dots || []).map(d => html`<div class="ch-dot" style=${"left:" + xp + "%;top:" + d.yp + "%;background:" + d.color}></div>`)}
    <div class="ch-tip" style=${"left:" + xp + "%;transform:" + anchor}>${label}</div>
  <//>`;
}
export const LOAD_G_DARK = [63, 216, 154], LOAD_G_LIGHT = [14, 158, 99], LOAD_O = [242, 163, 60], LOAD_R = [242, 84, 91];
export function cpuColor(v) {
  const mix = (a, b, t) => "rgb(" + a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",") + ")";
  const LOAD_G = resolvedTheme() === "light" ? LOAD_G_LIGHT : LOAD_G_DARK;
  if (v <= 60) return mix(LOAD_G, LOAD_G, 0);
  if (v <= 85) return mix(LOAD_G, LOAD_O, (v - 60) / 25);
  if (v <= 100) return mix(LOAD_O, LOAD_R, (v - 85) / 15);
  return mix(LOAD_R, LOAD_R, 0);
}
const LOSS_FLOOR = 0.5;
const LOSS_FLOOR_DARK = [79, 168, 240], LOSS_FLOOR_LIGHT = [43, 124, 211];
const LOSS_STOPS_DARK = [[0.5, [226, 200, 74]], [2, [242, 153, 74]], [5, [242, 107, 130]]];
const LOSS_STOPS_LIGHT = [[0.5, [176, 122, 22]], [2, [217, 119, 42]], [5, [214, 58, 85]]];
const LOSS_FLOOR_MESH = 0.05;
const MESH_STOPS_DARK = [[0.05, [226, 200, 74]], [0.5, [242, 153, 74]], [2, [242, 107, 130]]];
const MESH_STOPS_LIGHT = [[0.05, [176, 122, 22]], [0.5, [217, 119, 42]], [2, [214, 58, 85]]];
export function lossColorMesh(pct) { return lossColor(pct, true); }

export function lossColor(pct, mesh) {
  const light = resolvedTheme() === "light";
  const S = mesh ? (light ? MESH_STOPS_LIGHT : MESH_STOPS_DARK) : (light ? LOSS_STOPS_LIGHT : LOSS_STOPS_DARK);
  const rgb = a => "rgb(" + a.join(",") + ")";
  if (!(pct > (mesh ? LOSS_FLOOR_MESH : LOSS_FLOOR))) return rgb(light ? LOSS_FLOOR_LIGHT : LOSS_FLOOR_DARK);
  for (let i = 1; i < S.length; i++) {
    if (pct <= S[i][0]) {
      const [lo, a] = S[i - 1], [hi, b] = S[i], t = (pct - lo) / (hi - lo);
      return rgb(a.map((x, k) => Math.round(x + (b[k] - x) * t)));
    }
  }
  return rgb(S[S.length - 1][1]);
}

export function MiniArea({ points, h, times, range, cap }) {
  const [hov, setHov] = useState(null);
  const wref = useRef(null);
  const pts = (points || []).filter(v => v != null);
  h = h || 42; const w = 100;
  const n = pts.length;
  const C = Math.max(cap || n || 1, 2);
  const xAt = i => w - (n - 1 - i) * (w / (C - 1));
  const TS = times || [];
  const onMove = e => { const el = wref.current; if (!el) return; const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * w; const i = Math.round((n - 1) - (w - x) * (C - 1) / w);
    setHov(i >= 0 && i < n ? i : null); };
  if (n === 0)
    return html`<div class="harea-wrap" style=${"height:" + h + "px"}></div>`;
  const lo = Math.min(...pts), hi = Math.max(...pts), rng = (hi - lo) || 1, vpad = h * 0.06;
  const scaleMax = hi <= 10 ? 20 : hi <= 30 ? 50 : hi <= 60 ? 80 : 100;
  const Y = v => h - vpad - (Math.min(Math.max(v, 0), scaleMax) / scaleMax) * (h - 2 * vpad);
  const xy = pts.map((v, i) => [xAt(i), Y(v)]);
  const line = xy.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = xy[0][0].toFixed(1) + "," + h + " " + line + " " + xy[n - 1][0].toFixed(1) + "," + h;
  const id = "ha" + (MiniArea._n = (MiniArea._n || 0) + 1);
  const edges = [...new Set([lo, 60, 85, hi].filter(v => v >= lo && v <= hi))].sort((a, b) => b - a);
  const stops = edges.map(v => ({ off: Math.max(0, Math.min(1, (hi - v) / rng)), col: cpuColor(v) }));
  const cur = pts[n - 1];
  return html`<div class="harea-wrap" ref=${wref} style=${"height:" + h + "px"} onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
    <svg class="harea" viewBox=${"0 0 " + w + " " + h} preserveAspectRatio="none" height=${h}>
      <defs>
        <linearGradient id=${id + "s"} x1="0" x2="0" y1="0" y2="1">
          ${stops.map(s => html`<stop offset=${s.off} stop-color=${s.col}/>`)}
        </linearGradient>
        <linearGradient id=${id + "a"} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color=${cpuColor(cur)} stop-opacity="0.30"/><stop offset="1" stop-color=${cpuColor(cur)} stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${n >= 2 ? html`<polygon points=${area} fill=${"url(#" + id + "a)"}/>
      <polyline points=${line} fill="none" stroke=${"url(#" + id + "s)"} stroke-width="1.4" vector-effect="non-scaling-stroke"/>` : null}
    </svg>
    ${n === 1 ? html`<div class="ch-dot" style=${"left:" + xy[0][0] + "%;top:" + (xy[0][1] / h * 100) + "%;background:" + cpuColor(cur)}></div>` : null}
    ${(hov != null && hov < n) ? html`<${ChartHover} xp=${xy[hov][0]} dots=${[{ yp: xy[hov][1] / h * 100, color: cpuColor(pts[hov]) }]}
      label=${histTime(TS[hov], range) + " · " + Math.round(pts[hov]) + "%"}/>` : null}
  </div>`;
}

export function ThroughputChart({ rx, tx, h, head, times, range, cap }) {
  const [hov, setHov] = useState(null);
  const wref = useRef(null);
  const _pov = (Store.panelSettings || {}).throughput_perspective === "peers";
  const dnArr = _pov ? tx : rx, upArr = _pov ? rx : tx;
  const R = (dnArr || []).map(v => v || 0), TS = (upArr || []).map(v => v || 0);
  const n = Math.max(R.length, TS.length);
  const curR = R[R.length - 1] || 0, curT = TS[TS.length - 1] || 0;
  const hi = n ? Math.max(0, ...R, ...TS) : 0;
  const scaleMax = niceScaleCeil(Math.max(hi, 1024) / 0.85);
  const scaleLabel = rate(scaleMax);
  const legend = html`<div class="tp-legend"><span class="tp-k"><i class="sw rx"></i>↓ ${rate(curR)}</span><span class="tp-k"><i class="sw tx"></i>↑ ${rate(curT)}</span><span class="tp-peak">${T("peak {v1}", { v1: rate(hi) })}</span><span class="tp-scale" title=${T("Vertical scale — nearest 1/5/10/50/100/500 unit above the peak (≥15% headroom)")}>${scaleLabel}</span><span class="grow"></span>${head || null}</div>`;
  h = h || 60; const w = 100;
  const C = Math.max(cap || n || 1, 2);
  const xAt = i => w - (n - 1 - i) * (w / (C - 1));
  const top = 0;
  const Y = v => h - (Math.max(0, Math.min(v, scaleMax)) / scaleMax) * (h - top);
  const line = arr => arr.map((v, i) => xAt(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ");
  const rxLine = line(R), rxArea = n >= 2 ? (xAt(0).toFixed(1) + "," + h + " " + rxLine + " " + xAt(n - 1).toFixed(1) + "," + h) : "";
  const gid = "tp" + (ThroughputChart._n = (ThroughputChart._n || 0) + 1);
  const TSX = times || [];
  const onMove = e => { const el = wref.current; if (!el) return; const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * w; const i = Math.round((n - 1) - (w - x) * (C - 1) / w);
    setHov(i >= 0 && i < n ? i : null); };
  return html`<div class="tp-wrap">
    ${legend}
    <div class="harea-wrap" ref=${wref} style=${"height:" + h + "px"} onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
      <svg class="harea" viewBox=${"0 0 " + w + " " + h} preserveAspectRatio="none" height=${h}>
        <defs><linearGradient id=${gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--tp-rx)" stop-opacity="0.30"/><stop offset="1" stop-color="var(--tp-rx)" stop-opacity="0"/>
        </linearGradient></defs>
        ${n >= 2 ? html`<polygon points=${rxArea} fill=${"url(#" + gid + ")"}/>
        <polyline points=${rxLine} fill="none" stroke="var(--tp-rx)" stroke-width="1.3" vector-effect="non-scaling-stroke"/>
        <polyline points=${line(TS)} fill="none" stroke="var(--tp-tx)" stroke-width="1.3" vector-effect="non-scaling-stroke" stroke-dasharray="3 2"/>` : null}
      </svg>
      ${n === 1 ? html`<div class="ch-dot" style=${"left:" + xAt(0) + "%;top:" + (Y(R[0]) / h * 100) + "%;background:var(--tp-rx)"}></div>
        <div class="ch-dot" style=${"left:" + xAt(0) + "%;top:" + (Y(TS[0]) / h * 100) + "%;background:var(--tp-tx)"}></div>` : null}
      ${(hov != null && hov < n) ? html`<${ChartHover} xp=${xAt(hov)}
        dots=${[{ yp: Y(R[hov] || 0) / h * 100, color: "var(--tp-rx)" }, { yp: Y(TS[hov] || 0) / h * 100, color: "var(--tp-tx)" }]}
        label=${histTime(TSX[hov], range) + " · ↓ " + rate(R[hov] || 0) + " · ↑ " + rate(TS[hov] || 0)}/>` : null}
    </div>
  </div>`;
}

export function MultiRing({ rings, size, thick, gap, center, active, onActive }) {
  size = size || 168; thick = thick || 15; gap = gap == null ? 1.1 : gap;
  const cx = size / 2, cy = size / 2;
  const rings2 = (rings || []).filter(Boolean);
  const directional = rings2.some(r => r.unitColor);
  const step = thick + 5;
  const arcs = [];
  rings2.forEach((ring, ri) => {
    const r = (size / 2) - thick / 2 - ri * step;
    const segs = (ring.segments || []).filter(s => s && s.value > 0);
    const total = segs.reduce((a, s) => a + s.value, 0) || (ring.total || 0);
    arcs.push({ ri, r, track: true });
    if (total <= 0) return;
    let acc = 0;
    segs.forEach((s, si) => {
      const pct = s.value / total * 100;
      arcs.push({ ri, si, r, pct, off: acc, seg: s, ring, total });
      acc += pct;
    });
  });
  const arrowOf = dir => dir === "dn" ? "↓ " : dir === "up" ? "↑ " : "";
  const lit = a => active && a.seg.key === active.key && (active.dir == null || a.ri === active.dir);
  const set = t => onActive && onActive(t);
  let readout = center;
  if (active) {
    const ea = arcs.filter(a => !a.track && a.seg && a.seg.key === active.key).sort((p, q) => p.ri - q.ri);
    if (ea.length) {
      const nm = ea[0].seg.name, col = ea[0].seg.color;
      const valLine = a => html`<div class="mrc-val" style=${a.ring.unitColor ? "color:" + a.ring.unitColor : ""}>${arrowOf(a.ring.dir)}${(a.ring.fmt || (v => v))(a.seg.value)}</div>`;
      if (active.dir != null) {
        const a = ea.find(x => x.ri === active.dir) || ea[0];
        readout = html`<div class="mrc-hov"><div class="mrc-name" style=${"color:" + col}>${nm}</div>
          ${valLine(a)}<div class="mrc-sub">${a.ring.label} · ${Math.round(a.pct)}%</div></div>`;
      } else if (directional) {
        readout = html`<div class="mrc-hov"><div class="mrc-name" style=${"color:" + col}>${nm}</div>${ea.map(valLine)}</div>`;
      } else {
        const tot = (ea.find(a => a.ri === 0) || {}).seg, on = (ea[ea.length - 1] || {}).seg;
        readout = html`<div class="mrc-hov"><div class="mrc-name" style=${"color:" + col}>${nm}</div>
          <div class="mrc-val">${on ? on.value : 0}<small style="color:var(--faint)"> / ${tot ? tot.value : 0}</small></div></div>`;
      }
    }
  }
  return html`<div class="mring" style=${"width:" + size + "px;height:" + size + "px"} onMouseLeave=${() => set(null)}>
    <svg width=${size} height=${size} viewBox=${"0 0 " + size + " " + size}>
      <g transform=${"rotate(-90 " + cx + " " + cy + ")"}>
        ${arcs.map((a, i) => a.track
          ? html`<circle key=${"t" + i} cx=${cx} cy=${cy} r=${a.r} fill="none" stroke="var(--track)" stroke-width=${thick} pathLength="100"/>`
          : html`<circle key=${"a" + a.ri + "-" + a.si} cx=${cx} cy=${cy} r=${a.r} fill="none" stroke=${a.seg.color} stroke-width=${thick}
              pathLength="100" stroke-dasharray=${Math.max(0, a.pct - gap) + " " + (100 - Math.max(0, a.pct - gap))} stroke-dashoffset=${-a.off}
              class=${"mring-seg" + (active && !lit(a) ? " dim" : "")}
              onMouseEnter=${() => set({ key: a.seg.key, dir: a.ri })}/>`)}
      </g>
    </svg>
    <div class="mring-center">${readout}</div>
  </div>`;
}
export function RingLegend({ items, cols, active, onActive }) {
  const set = t => onActive && onActive(t);
  return html`<div class=${"mring-leg" + (cols ? " c" + cols : "")}>${(items || []).map(it => {
    const k = it.key || it.name;
    const on = active && active.key === k, rowDim = active && active.key !== k, hasDU = it.down != null;
    return html`<div class=${"mrl-row" + (rowDim ? " dim" : "") + (on ? " on" : "")} key=${k}
        onMouseEnter=${() => set({ key: k, dir: null })} onMouseLeave=${() => set(null)}>
      <span class="mrl-sw" style=${"--sw:" + it.color}></span>
      <span class="mrl-nm">${it.name}</span>
      <span class="grow"></span>
      ${hasDU
        ? html`<span class=${"mrl-dv" + (on && active.dir === 1 ? " vdim" : "")} onMouseEnter=${() => set({ key: k, dir: 0 })} onMouseLeave=${() => set({ key: k, dir: null })}>↓${it.down}</span>
               <span class=${"mrl-uv" + (on && active.dir === 0 ? " vdim" : "")} onMouseEnter=${() => set({ key: k, dir: 1 })} onMouseLeave=${() => set({ key: k, dir: null })}>↑${it.up}</span>`
        : (it.right != null ? html`<span class="mrl-v">${it.right}</span>` : null)}
    </div>`;
  })}</div>`;
}

export function OnlineBlocks({ blocks, step, endTs, times, range, h, color }) {
  const [hov, setHov] = useState(null); const wref = useRef(null);
  color = color || "var(--online)"; h = h || 70;
  const n = blocks.length, hi = Math.max(1, ...blocks.filter(v => v != null));
  const onMove = e => { const el = wref.current; if (!el) return; const r = el.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left) / r.width * n); setHov(i >= 0 && i < n && blocks[i] != null ? i : null); };
  return html`<div class="oblk-wrap" ref=${wref} style=${"height:" + h + "px"} onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
    ${blocks.map((v, i) => html`<div class=${"oblk" + (hov === i ? " hot" : "")} key=${i}>
      ${v == null ? null : html`<i style=${"height:" + Math.max(4, v / hi * 100) + "%;background:" + color}></i>`}</div>`)}
    ${hov != null ? html`<${ChartHover} xp=${(hov + 0.5) / n * 100} dots=${[{ yp: 100 - Math.max(4, blocks[hov] / hi * 100), color }]}
      label=${(times && times[hov] != null ? histTime(times[hov], range) + " · " : endTs != null ? histTime(endTs - (n - 1 - hov) * step, range) + " · " : "") + T("{v1} online", { v1: Math.round(blocks[hov]) })}/>` : null}
  </div>`;
}
export function TrendArea({ points, times, color, h, cap, fmt, range, label }) {
  const [hov, setHov] = useState(null); const wref = useRef(null);
  const pts = (points || []).map(v => v || 0); h = h || 46; const w = 100, n = pts.length;
  color = color || "var(--online)"; fmt = fmt || (v => v);
  const C = Math.max(cap || n || 1, 2), xAt = i => w - (n - 1 - i) * (w / (C - 1)), TS = times || [];
  const onMove = e => { const el = wref.current; if (!el) return; const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * w, i = Math.round((n - 1) - (w - x) * (C - 1) / w); setHov(i >= 0 && i < n ? i : null); };
  if (n === 0) return html`<div class="harea-wrap" style=${"height:" + h + "px"}></div>`;
  const hi = Math.max(1, ...pts), scaleMax = hi * 1.15, vpad = h * 0.08;
  const Y = v => h - vpad - (Math.min(Math.max(v, 0), scaleMax) / scaleMax) * (h - 2 * vpad);
  const xy = pts.map((v, i) => [xAt(i), Y(v)]);
  const line = xy.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const area = xy[0][0].toFixed(1) + "," + h + " " + line + " " + xy[n - 1][0].toFixed(1) + "," + h;
  const id = "ta" + (TrendArea._n = (TrendArea._n || 0) + 1);
  return html`<div class="harea-wrap" ref=${wref} style=${"height:" + h + "px"} onMouseMove=${onMove} onMouseLeave=${() => setHov(null)}>
    <svg class="harea" viewBox=${"0 0 " + w + " " + h} preserveAspectRatio="none" height=${h}>
      <defs><linearGradient id=${id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color=${color} stop-opacity="0.28"/><stop offset="1" stop-color=${color} stop-opacity="0"/></linearGradient></defs>
      ${n >= 2 ? html`<polygon points=${area} fill=${"url(#" + id + ")"}/><polyline points=${line} fill="none" stroke=${color} stroke-width="1.4" vector-effect="non-scaling-stroke"/>` : null}
    </svg>
    ${(hov != null && hov < n) ? html`<${ChartHover} xp=${xy[hov][0]} dots=${[{ yp: xy[hov][1] / h * 100, color }]} label=${histTime(TS[hov], range || "live") + " · " + fmt(pts[hov]) + (label ? " " + label : "")}/>` : null}
  </div>`;
}

export function RankBars({ rows }) {
  const mx = Math.max(1, ...rows.map(r => r.value || 0));
  if (!rows.length) return html`<div class="harea-empty">${T("no data")}</div>`;
  return html`<div class="rankbars">${rows.map(r => {
    const inner = html`<span class="rb-label"><span class="rb-nm">${r.label}</span>${r.count > 1 ? html`<span class="rb-n" title=${T("{v1} peers", { v1: r.count })}>${r.count}</span>` : ""}</span>
      <span class="rb-track"><i style=${"width:" + Math.max(2, (r.value || 0) / mx * 100) + "%;background:" + (r.color || "var(--brand)")}></i></span>
      <span class="rb-val">${r.sub}</span>`;
    const bmx = (r.bub && r.bub.length) ? Math.max(1, ...r.bub.map(b => b.value || 0)) : 1;
    const bub = (r.bub && r.bub.length) ? html`<span class="rb-bub">${r.bub.map(b => html`<${Fragment}>
        <span class="rb-bub-n">${b.kind ? html`<${Tag} kind=${b.kind} label=${b.kind} gen3=${b.gen3}/>` : ""}<span class="rb-bub-nm" title=${b.name}>${b.name}</span></span>
        <span class="rb-bub-track"><i style=${"width:" + Math.max(3, (b.value || 0) / bmx * 100) + "%;background:" + (r.color || "var(--brand)")}></i></span>
        <span class="rb-bub-v">${b.sub}</span><//>`)}</span>` : null;
    const cls = "rb" + (bub ? " hasbub" : "");
    return (r.href || r.onClick)
      ? html`<a class=${cls} href=${r.href || "#"} onClick=${r.onClick || null} key=${r.label}>${inner}${bub}</a>`
      : html`<div class=${T("{v1} static", { v1: cls })} key=${r.label}>${inner}${bub}</div>`;
  })}</div>`;
}

export const HIST_RANGES = ["live", "hour", "day", "week", "month"];
export const RANGE_CAP = { live: 200, hour: 250, day: 300, week: 350, month: 400 };
export const RANGE_WIN = { live: 200 * 15, hour: 3600, day: 86400, week: 7 * 86400, month: 30 * 86400 };
export const axisCap = a => a && a.step ? Math.max(1, Math.ceil((a.until - a.since) / a.step)) : 0;

export function densityCap(times, range) {
  const fallback = RANGE_CAP[range] || 0, win = RANGE_WIN[range];
  const t = (times || []).filter(x => x != null);
  if (!win || t.length < 3) return fallback;
  const gaps = [];
  for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; if (d > 0) gaps.push(d); }
  if (!gaps.length) return fallback;
  gaps.sort((a, b) => a - b);
  const step = gaps[Math.floor(gaps.length / 2)];
  if (!step) return fallback;
  return Math.max(2, Math.min(fallback, Math.round(win / step)));
}
export const tailSeries = (s, n) => { const o = {}; for (const k of ["t", "cpu", "mem", "disk", "rx", "tx", "mrx", "mtx"]) if (Array.isArray((s || {})[k])) o[k] = s[k].slice(-n); return o; };

export function RangeTabs({ range, setRange }) {
  return html`<div class="rangetabs">${HIST_RANGES.map(t => html`<button class=${"rtab" + (range === t ? " on" : "")} onClick=${() => setRange(t)}>${rangeLabel(t)}</button>`)}</div>`;
}
export function RangedHistory({ node, kind, live, h, head, liveFine, fetch, traf, range: cRange, setRange: cSetRange }) {
  const [iRange, iSetRange] = useState("live");
  const controlled = cRange !== undefined;
  const range = controlled ? cRange : iRange, setRange = cSetRange || iSetRange;
  const [fetched, setFetched] = useState(null);
  const custom = !!fetch;
  const fetchRange = custom || range === "day" || range === "week" || range === "month";
  useEffect(() => {
    if (!fetchRange) { setFetched(null); return; }
    let ok = true; setFetched(null);
    const p = custom ? Promise.resolve(fetch(range)) : api.nodeHistory(node, range).then(r => r && r.ok ? r.data : {});
    p.then(d => { if (ok) setFetched(d || {}); }).catch(() => {});
    return () => { ok = false; };
  }, [node, range]);
  const liveBuf = range === "live" && liveFine && (liveFine.t || []).length > 1;
  const s = custom ? (fetched || {})
    : range === "live" ? (liveBuf ? liveFine : tailSeries(live, 70))
    : range === "hour" ? (live || {}) : (fetched || {});
  const cap = custom ? densityCap(s.t, range) : range === "live" ? (liveBuf ? RANGE_CAP.live : 0) : RANGE_CAP[range];
  const hasData = (s.cpu || s.rx || []).some(x => x != null);
  const nlive = Store.recon.nodeStatus[node] === "live";
  const notLive = !nlive && (range === "live" || range === "hour");
  const pausedPill = (notLive && hasData) ? html`<span class="rt-paused" title=${T("This node isn't reporting right now — showing the last data it sent.")}>${T("tag|paused")}</span>` : null;
  const tabs = html`${pausedPill}${controlled ? null : html`<${RangeTabs} range=${range} setRange=${setRange}/>`}`;
  if (kind === "throughput") {
    let rx = s.rx, tx = s.tx;
    if (traf) {
      const pick = (tot, mesh) => (tot || []).map((v, i) => (traf.peers ? Math.max(0, (v || 0) - ((mesh || [])[i] || 0)) : 0) + (traf.mesh ? ((mesh || [])[i] || 0) : 0));
      rx = pick(s.rx, s.mrx); tx = pick(s.tx, s.mtx);
    }
    return html`<${ThroughputChart} rx=${rx} tx=${tx} h=${h} head=${tabs} times=${s.t} range=${range} cap=${cap}/>`;
  }
  return html`<div class="chartwrap">
    <div class="chart-head">${head || null}<span class="grow"></span>${tabs}</div>
    <${MiniArea} points=${s.cpu} h=${h} times=${s.t} range=${range} cap=${cap}/>
  </div>`;
}

export function IfaceThroughput({ node, iface }) {
  const [range, setRange] = useState("live");
  return html`<${Panel} icon="gauge" title=${T("Throughput")} actions=${html`<${RangeTabs} range=${range} setRange=${setRange}/>`}>
    <${RangedHistory} node=${node} kind="throughput" h=${72} fetch=${r => api.ifaceSeries(node, iface, r).then(x => x && x.ok ? x.data : {})} range=${range} setRange=${setRange}/>
  <//>`;
}
