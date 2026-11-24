import { T, Trich, Tsplit, plural, srvText } from "./i18n.js";
import { esc, tkey, dur, ago, seen, fmtBytes, ipOf, portOf, orderedTargets, isPrimaryTarget, targetRole,
         useStableOrder, isSelfContainedKind, isMobile } from "./util.js";
import { Store, api, bus, useStore } from "./store.js";
import { targetType, iTypeOf, kindOf, ghostIface, turnProxiesFor, tgtXfer, isSelfContainedTgt, peerUncategorised } from "./model.js";
import { go } from "./router.js";
import { turnFork, turnColor, turnClientColor, turnClientAuthor, turnForkList, forkLabel } from "./turn-catalog.js";
import {
  Ic, ICON, Tag, Panel, Badge, Sheet, secTitle, SearchBox, Switch, Dropdown, Disclosure, autoGrow,
  Popover, CapList, useCapped, toast, copy, mutate, sheetSend, openModal, pushModal, closeModal, closeAllModals, closeModals, openConfirm,
  openChildOrRoot, ConfirmSheet, subjectBlocked, statusLabel, rowSingle, rowDouble, rowNoSelect, RowError, goSettings, LogBody, rateCell, uncatPop, ListPager, LIST_PAGE, pageSlice, tgt3,
} from "./ui.js";
import {
  QR, qrDataURL, qrZoom, copyQrImage, buildConf, parseFullConf, downloadConf, getConfig, configOverrides,
  anySessionConf, rerenderConf, effectiveClientParams, turnArtifact, turnClientsFor, turnClientSettingsFor,
  subFeatureOn, subSKCached, subBaseUrl, subUsersMap, useSubRec, ensureVaultUnlocked, subUrlFor,
  subEnableUser, subRotateUser, subBackfillUser, subKeyB64, VaultPromptSheet, ensurePeerBlob,
  subPersistOn, subSetPersist, subUnlock, subRecover, subUsersForget, confWasUnreachable, confWasSealedOld,
} from "./crypto.js";
import {
  confirmDeletePeer, confirmUnassign, confirmBlockPeer, confirmUnblockPeer, confirmBlockUser,
  confirmUnblockUser, peerBlockBtn, userBlockBtn, rotateAllUserKeys, PeerStatusLine, SubStatusLine,
  RoleToggle, UserCombo,
  confirmReassign, assignPeerToUser, openRecreateRekey, confirmRestoreDeployment, confirmCorrectDeployment,
} from "./peer-actions.js";
import { userStats, userStatTag, deviceNameAt, userReach, reachTally,
         netsCached, netsFetch, netTally, netRowOnline, wantNetsCount } from "./views.js";
import { AppDropdown, OsDropdown, ForkTag, turnForkPlatforms, WDTT_COLOR, appNameColor, turnEnabled,
         _OS_TABS } from "./turn.js";
import { h, Fragment } from "preact";
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import htm from "htm";

const html = htm.bind(h);

export function openPeerConfigs(peer, opts) {
  opts = opts || {};
  const child = !!opts.child;
  const hideVk = !!opts.hideVk;
  const cols = Math.min(peer.targets.length || 1, 3);
  const wcols = Math.max(cols, 2);
  const width = wcols * QR_ITEM + (wcols - 1) * QR_GAP + 56;
  const vkUser = peer.user_id ? Store.recon.users.find(u => u.id === peer.user_id) : null;
  const ipShort = (((peer.targets || [])[0] || {}).ip || "").split("/")[0];
  const parts = []; parts.push(vkUser ? vkUser.name : T("Unassigned peer"));
  if (peer.title) parts.push(peer.title);
  else if (!vkUser && ipShort) parts.push(ipShort);
  const nm = parts.join(" · ");
  const title = html`<span class="qrhd"><span class="qrhd-nm">${nm}</span></span>`;
  const headExtra = vkUser ? html`<${SubStatusLine} user=${vkUser} pos="hr"/>` : html`<${PeerStatusLine} peer=${peer} pos="hr"/>`;
  (child ? pushModal : openModal)(html`<${Sheet} title=${title} width=${width} headExtra=${headExtra} noGuard=${true} onClose=${closeModal} onBack=${child && !isMobile() ? closeModal : null}
    subject=${{ kind: "peer", id: peer.id }} foot=${html`<${QRPeerFoot} pid=${peer.id}/>`}>
    ${vkUser ? html`<${PeerStatusLine} peer=${peer} pos="bar"/>` : null}
    <${VaultUnlockPanel} need=${(peer.targets || []).some(t => !isSelfContainedKind(targetType(t)))}/>
    ${!hideVk && vkUser && targetsWantVk(peer.targets) ? html`<${VkLinkField} user=${vkUser}/>` : null}
    <${QRRow} cards=${orderedTargets(peer.targets).map(t => html`<${TargetCard} key=${tkey(t.node, t.iface)} peer=${peer} t=${t} bare=${true} primary=${peer.targets.length > 1 ? targetRole(t) : ""}/>`)}/>
  <//>`);
}

export const QR_ITEM = 292, QR_GAP = 14;
const _qrNavStack = [];
function _qrNavKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  const step = _qrNavStack[_qrNavStack.length - 1];
  if (!step) return;
  e.preventDefault();
  step(e.key === "ArrowLeft" ? -1 : 1);
}
export function QRRow({ cards }) {
  const ref = useRef(null);
  const [m, setM] = useState({ l: 0, cw: 0, sw: 0, step: QR_ITEM + QR_GAP });
  useEffect(() => { const el = ref.current; if (!el) return;
    const measure = () => {
      const first = el.firstElementChild;
      const cardW = first ? first.getBoundingClientRect().width : QR_ITEM;
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap || cs.gap) || QR_GAP;
      setM({ l: el.scrollLeft, cw: el.clientWidth, sw: el.scrollWidth, step: cardW + gap });
    };
    measure(); el.addEventListener("scroll", measure, { passive: true });
    let ro; try { ro = new ResizeObserver(measure); ro.observe(el); } catch (_) {}
    return () => { el.removeEventListener("scroll", measure); if (ro) ro.disconnect(); }; }, [cards.length]);
  const n = cards.length;
  const step = m.step || (QR_ITEM + QR_GAP);
  const paged = m.sw > m.cw + 4;
  const atStart = m.l <= 2;
  const atEnd = m.sw > 0 && m.l + m.cw >= m.sw - 2;
  const per = Math.max(1, Math.round(m.cw / step));
  let first = Math.max(0, Math.min(Math.round(m.l / step), n - per));
  if (atEnd) first = Math.max(0, n - per);
  const last = Math.min(n - 1, first + per - 1);
  const range = first === last ? `${first + 1} of ${n}` : `${first + 1}–${last + 1} of ${n}`;
  const go = d => { const el = ref.current; if (el) el.scrollBy({ left: d * step, behavior: "smooth" }); };
  const goRef = useRef(go); goRef.current = go;
  useEffect(() => {
    if (!paged) return;
    const stepper = d => goRef.current(d);
    if (!_qrNavStack.length) window.addEventListener("keydown", _qrNavKey);
    _qrNavStack.push(stepper);
    return () => { const i = _qrNavStack.lastIndexOf(stepper); if (i >= 0) _qrNavStack.splice(i, 1);
      if (!_qrNavStack.length) window.removeEventListener("keydown", _qrNavKey); };
  }, [paged]);
  return html`<div class=${"qrrowwrap" + (paged ? " paged" : "")}>
    <div class="qrrow" ref=${ref}>${cards}</div>
    ${paged ? html`<div class="qrnav">
      <button class="qrnavbtn" disabled=${atStart} onClick=${() => go(-1)} aria-label=${T("Previous")}>‹</button>
      <span class="qrnavcount">${range}</span>
      <button class="qrnavbtn" disabled=${atEnd} onClick=${() => go(1)} aria-label=${T("Next")}>›</button>
    </div>` : null}
  </div>`;
}


export function VaultUnlockPanel({ need } = {}) {
  const [exists, setExists] = useState(null);
  const [ready, setReady] = useState(!!subSKCached());
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false);
  const [keep, setKeep] = useState(subPersistOn());
  useEffect(() => { if (subSKCached()) { setReady(true); return; }
    let ok = true; api.subVault().then(r => { if (ok) setExists(!!(r && r.ok && r.data && r.data.exists)); }).catch(() => { if (ok) setExists(false); });
    return () => { ok = false; }; }, []);
  if (need === false || ready || subSKCached() || !exists) return null;
  const unlock = async () => {
    if (!pw || busy) return; setBusy(true);
    try { await subUnlock(pw); subSetPersist(keep); setPw(""); setReady(true); Store.configEpoch++; bus.emit(); }
    catch (e) { toast((e && e.message) || T("That password didn’t unlock the Encryption Vault."), "err"); }
    setBusy(false);
  };
  return html`<div class="unlockpanel">
    <div class="unlockpanel-msg"><${Ic} i="key"/><span>${T("Unlock the Encryption Vault to see configs, QR codes and the subscription link.")}</span></div>
    <form class="unlockpanel-row" onSubmit=${e => e.preventDefault()}>
      <input class="subpw" type="password" autofocus autocomplete="current-password" placeholder=${T("Panel password")} value=${pw}
        onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); unlock(); } }} onInput=${e => setPw(e.target.value)}/>
      <button type="button" class="btn btn-primary" disabled=${busy || !pw} onClick=${unlock}>${busy ? T("Unlocking…") : T("Unlock")}</button>
    </form>
    <label class="vp-keep-row"><input type="checkbox" checked=${keep} onChange=${e => setKeep(e.target.checked)}/> <span>${T("Trust this device and keep it unlocked")}</span></label>
  </div>`;
}
export function SubLinkActions({ user }) {
  useStore();
  const rec = useSubRec(user.id);
  const [url, setUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [optim, setOptim] = useState(false);
  const base = subBaseUrl();
  useEffect(() => { let ok = true;
    (async () => { if (rec && rec.enabled && subSKCached()) { try { const u = await subUrlFor(rec); if (ok) setUrl(u); } catch (_) { if (ok) setUrl(null); } } else if (ok) setUrl(null); })();
    return () => { ok = false; }; }, [rec && rec.enabled, Store.configEpoch]);
  if (!subFeatureOn() || !subSKCached() || rec === undefined) return null;
  const after = async () => { setOptim(false); subUsersForget(); Store.configEpoch++; bus.emit(); };
  const settingsLink = html`<a href="#/panel/settings" onClick=${() => closeAllModals()}>${T("Settings → Subscriptions")}</a>`;
  const confirm = opts => pushModal(html`<${ConfirmSheet} ...${opts}/>`);
  const act = fn => async () => { setBusy(true); try { await fn(); } catch (e) { toast((e && e.message) || T("Failed"), "err"); } setBusy(false); await after(); };
  const enableBg = async () => {
    try { await subEnableUser(user.id); const r2 = (await subUsersMap(true))[user.id]; if (r2 && r2.enabled && r2.unlock_by_sk) { const { unlockKey } = await subRecover(r2); await subBackfillUser(user.id, unlockKey); } }
    catch (e) { setOptim(false); toast((e && e.message) || T("Couldn't create the subscription link"), "err"); }
    finally { await after(); }
  };
  const enable = () => confirm({ title: T("Enable subscription"), confirmLabel: T("Enable"),
    body: T("Create a shareable link to this user's QR codes. New peers appear on it automatically; the unlock secret rides in the link and never reaches the server."),
    onConfirm: () => { setOptim(true); enableBg(); } });
  const rotate = () => confirm({ title: T("Rotate subscription link"), confirmLabel: T("Rotate"), warn: true,
    body: T("Issue a fresh link and invalidate the current one. A config already scanned keeps working until you rekey or remove the peer."),
    onConfirm: act(() => subRotateUser(user.id)) });
  const disable = () => confirm({ title: T("Disable subscription"), confirmLabel: T("Disable"), warn: true,
    body: T("This only turns off this user's subscription LINK — the page stops resolving. It does NOT disconnect their peers: existing connections keep working, and a config already scanned keeps working until you rekey or remove the peer. To actually cut this user's access, use Block instead. Re-enabling later issues a fresh link over the same configs."),
    onConfirm: act(() => api.subUserDisable({ user_id: user.id })) });
  const enabled = !!(rec && rec.enabled) || optim;
  if (!enabled) return html`<div class="sublink sublink-off">
    <span class="sublink-off-msg">${T("No subscription link yet — enable one to share this user's QRs.")}</span>
    <button class="btn btn-primary btn-mini" disabled=${busy} onClick=${enable}>${T("Enable subscription")}</button>
  </div>`;
  return html`<div class="field sublink-field">
    <label>${T("Subscription link")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— this user's shareable QR page")}</span></label>
    <div class="sublink sublink-row">
      ${url ? html`<${SubUrlBar} url=${url}/>` : !base
        ? html`<div class="hint warn">${Trich("Set a public base URL in {v1} to build the link.", { v1: settingsLink })}</div>`
        : html`<div class="hint">${T("Building link…")}</div>`}
      <span class="fieldbtns">
        ${isMobile() ? html`<button class="btn btn-ghost btn-mini fbtn m-icob" disabled=${busy} onClick=${rotate} title=${T("Rotate token")} aria-label=${T("Rotate token")}><${Ic} i="refresh"/></button>
          <button class="btn btn-ghost btn-mini fbtn m-icob" disabled=${busy} onClick=${disable} title=${T("Disable URL")} aria-label=${T("Disable URL")}><${Ic} i="off"/></button>`
        : html`<button class="btn btn-ghost btn-mini fbtn" disabled=${busy} onClick=${rotate}>${T("Rotate token")}</button>
        <button class="btn btn-ghost btn-mini fbtn" disabled=${busy} onClick=${disable}>${T("Disable URL")}</button>`}
      </span>
    </div>
  </div>`;
}
export function UserPeerCard({ peer, onOpen }) {
  useStore();
  const targets = peer.targets || [];
  const t = orderedTargets(targets)[0] || {};
  const kinds = [...new Set(targets.map(targetType))];
  const col = Store.nodeColor(t.node);
  const dnode = Store.nodeName(t.node);
  const ltype = targetType(t);
  const oct = String(t.ip || "").split("/")[0].split(".").pop() || "";
  const nm = peer.title || (oct ? T("Peer .{v1}", { v1: oct }) : T("Peer"));
  const lt = ((Store.recon.peers.find(p => p.id === peer.id) || {}).targets || []).find(d => d.node === t.node && d.iface === t.iface) || t;
  const head = html`<div class="upc-head">
    <div class="upc-l1"><span class="upc-nm">${nm}</span><span class="grow"></span>${peerUncategorised(lt) && lt.status !== "blocked" && lt.status !== "faulty"
      ? uncatPop(html`<span class="badge b-uncat ic"><${Ic} i="warn"/>${statusLabel(lt.status)}</span>`)
      : html`<${Badge} s=${lt.status}/>`}${isMobile() && targets.length > 1 ? html`<span class="upc-xn" title=${kinds.join(" · ")}>×${targets.length}</span>` : null}</div>
    <div class="upc-l2"><span class="upc-srv" style=${"color:" + col}>${dnode}</span><${Tag} kind=${ltype} label=${t.iface} gen3=${tgt3(t)}/><span class="grow"></span>${targets.length > 1 && !isMobile() ? html`<span class="upc-deps" title=${kinds.join(" · ")}>${kinds.length > 1 ? kinds.join(" · ") : plural(targets.length, "deployment")}</span>` : null}</div>
  </div>`;
  if (!onOpen) return html`<div class="upc-wrap upc-static">
    <${TargetCard} peer=${peer} t=${t} bare=${true} head=${head}/>
  </div>`;
  const own = el => el && el.closest(".qr, button, a");
  const onClick = e => { if (own(e.target)) return; onOpen(peer); };
  const onMove = e => e.currentTarget.classList.toggle("hot", !own(e.target));
  const onLeave = e => e.currentTarget.classList.remove("hot");
  return html`<div class="upc-wrap" onClick=${onClick} onMouseMove=${onMove} onMouseLeave=${onLeave} title=${T("Open this peer's configs")}>
    <${TargetCard} peer=${peer} t=${t} bare=${true} head=${head}/>
  </div>`;
}
export function userVkLink(user) {
  return userVkLinks(user)[0] || "";
}
export function userVkLinks(user) {
  let arr = (user && Array.isArray(user.vk_links) && user.vk_links.length) ? user.vk_links.slice()
          : (user && (user.vk_link || "").trim() ? [user.vk_link] : []);
  return arr.map(s => (s || "").trim()).filter(Boolean);
}
export function vkOwnHash(peer, user) {
  if (((peer || {}).vk_hash || "").trim()) return true;
  const own = (user && Array.isArray(user.vk_links) && user.vk_links.length) ? user.vk_links
            : (user && (user.vk_link || "").trim() ? [user.vk_link] : []);
  return own.some(s => (s || "").trim());
}
export function targetsWantVk(targets) {
  if (turnEnabled() && (targets || []).some(t => turnProxiesFor(t.node, t.iface).length > 0)) return true;
  return (targets || []).some(isSelfContainedTgt);
}
export const _VK_CALL_RE = /^https:\/\/(?:[\w.-]+\.)?vk(?:ontakte)?\.(?:com|ru)\/call\/join\/[\w-]+/i;
export const VK_JOIN_URL = "https://vk.ru/call/join/";
export function normVkLink(s) { s = (s || "").trim(); if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return VK_JOIN_URL + s;
  return s && !/^https?:\/\//i.test(s) ? "https://" + s : s; }
export function VkLinkField({ user }) {
  useStore();
  const lu = (Store.recon.users || []).find(x => x.id === user.id) || user;
  const primary = (lu.vk_links && lu.vk_links.length) ? lu.vk_links[0] : (lu.vk_link || "");
  const [saved, setSaved] = useState(primary);
  const [val, setVal] = useState(primary);
  const [busy, setBusy] = useState(false);
  const [subd, setSubd] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const savedTimer = useRef(null);
  const flashStatus = s => { setSaveStatus(s); if (savedTimer.current) clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setSaveStatus(null), 5000); };
  useEffect(() => { setVal(primary); setSaved(primary); }, [user.id, primary]);
  useEffect(() => { let ok = true; if (subFeatureOn()) subUsersMap().then(m => { if (ok) setSubd(!!(m[user.id] && m[user.id].enabled)); }).catch(() => {}); return () => { ok = false; }; }, [user.id]);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);
  const v = normVkLink(val);
  const invalid = !!v && !_VK_CALL_RE.test(v);
  const empty = !v;
  const set = !empty && !invalid;
  const dirty = v !== saved;
  const add = async () => {
    if (!dirty || invalid || empty) return;
    setBusy(true);
    const existing = (lu.vk_links && lu.vk_links.length ? lu.vk_links : (lu.vk_link ? [lu.vk_link] : []));
    const ordered = [v, ...existing.filter(u => u !== v)];
    const r = await api.userUpdate({ id: user.id, vk_links: ordered, vk_link: v });
    setBusy(false);
    if (!r || !r.ok) { flashStatus("failed"); toast(srvText(r) || T("Couldn't add the VK link"), "err"); return; }
    setSaved(v);
    flashStatus("saved");
    Store.poll(); Store.configEpoch++; bus.emit();
  };
  return html`<div class=${"field vkfield" + (invalid ? " warn" : set ? " set" : " warn")} style="margin-bottom:14px">
    <label>${T("VK call link")} <span class="faint" style="text-transform:none;letter-spacing:0">${T("— for this user's configs that ride a VK call")}</span></label>
    <div class="vkfield-row">
      <div class="vkbox">
        <${Ic} i="link"/>
        <input class="vkbox-input" data-noautofocus value=${val} placeholder=${T("A hash, or vk.ru/call/join/…")} disabled=${busy}
          onInput=${e => setVal(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}/>
      </div>
      <span class="fieldbtns">
        ${saveStatus === "saved" ? html`<span class="vk-status ok"><${Ic} i="check"/> ${T("Saved")}</span>`
          : saveStatus === "failed" ? html`<span class="vk-status err"><${Ic} i="warn"/> ${T("Failed")}</span>` : null}
        ${isMobile() ? html`<button class="btn btn-ghost btn-mini fbtn m-icob" disabled=${busy || !dirty || invalid || empty} onClick=${add} title=${T("Add link")} aria-label=${T("Add link")}><${Ic} i="plus"/></button>
          <button class="btn btn-ghost btn-mini fbtn m-icob" onClick=${() => pushModal(html`<${VkLinksSheet} user=${user}/>`)} title=${T("Manage")} aria-label=${T("Manage")}><${Ic} i="pencil"/>${(lu.vk_links && lu.vk_links.length > 1) ? html`<span class="m-icob-n">${lu.vk_links.length}</span>` : null}</button>`
        : html`<button class="btn btn-ghost btn-mini fbtn" disabled=${busy || !dirty || invalid || empty} onClick=${add}>${busy ? T("Adding…") : T("Add link")}</button>
        <button class="btn btn-ghost btn-mini fbtn" onClick=${() => pushModal(html`<${VkLinksSheet} user=${user}/>`)} title=${T("Manage all of this user's VK call links (add more, set primary)")}>${T("Manage")}${(lu.vk_links && lu.vk_links.length > 1) ? ` (${lu.vk_links.length})` : ""}</button>`}
      </span>
    </div>
    ${invalid ? html`<div class="hint err">${T("Expected a VK call link or its hash, like")} <span class="mono">https://vk.ru/call/join/…</span></div>`
      : empty ? html`<div class="hint vk-warn">${noVkLinks()}${subd ? html` ${noVkSubbed()}` : ""}</div>` : null}
  </div>`;
}
export function VkLinksSheet({ user }) {
  useStore();
  const lu = (Store.recon.users || []).find(x => x.id === user.id) || user;
  const start = (lu.vk_links && lu.vk_links.length ? lu.vk_links : (lu.vk_link ? [lu.vk_link] : [])).slice();
  const [rows, setRows] = useState(start.length ? start.map(u => ({ url: u })) : [{ url: "" }]);
  const seeded = useRef(start);
  const [primary, setPrimary] = useState(0);
  const [busy, setBusy] = useState(false);
  const setUrl = (i, v) => setRows(rs => rs.map((r, j) => j === i ? { url: v } : r));
  const addRow = () => setRows(rs => [...rs, { url: "" }]);
  const delRow = (i) => { setRows(rs => { const n = rs.filter((_, j) => j !== i); return n.length ? n : [{ url: "" }]; });
    setPrimary(p => (i === p ? 0 : i < p ? p - 1 : p)); };
  const norm = rows.map(r => normVkLink(r.url));
  const bad = norm.some(u => u && !_VK_CALL_RE.test(u));
  const dirty = JSON.stringify(norm.filter(Boolean)) !== JSON.stringify(start);
  const persist = async (close) => {
    if (JSON.stringify(start) !== JSON.stringify(seeded.current)) {
      seeded.current = start;
      setRows(start.length ? start.map(u => ({ url: u })) : [{ url: "" }]); setPrimary(0);
      toast(T("This user's links changed while the sheet was open — check them and save again."), "err");
      return false;
    }
    const clean = norm.filter(Boolean);
    if (clean.some(u => !_VK_CALL_RE.test(u))) { toast(T("One of the links isn't a VK call link or its hash."), "err"); return false; }
    const uniq = [...new Set(clean)];
    const primUrl = norm[primary];
    const ordered = primUrl && uniq.includes(primUrl) ? [primUrl, ...uniq.filter(u => u !== primUrl)] : uniq;
    setBusy(true);
    const r = await api.userUpdate({ id: user.id, vk_links: ordered });
    setBusy(false);
    if (!r || !r.ok) { toast(srvText(r) || T("Couldn't save the VK links"), "err"); return false; }
    seeded.current = ordered;
    if (close) closeModal();
    Store.poll(); Store.configEpoch++; bus.emit();
    if (close) toast(ordered.length ? T("Saved {v1}.", { v1: plural(ordered.length, "VK link") }) : T("VK links cleared."), "ok");
    return true;
  };
  const save = () => persist(true);
  return html`<${Sheet} title=${html`${T("VK call links")} <span class="faint" style="text-transform:none;letter-spacing:0">— ${user.name}</span>`} width=${560} onClose=${closeModal}
    foot=${html`<${Fragment}><button class="btn btn-ghost" onClick=${addRow}><${Ic} i="plus"/> ${T("Add link")}</button>
      <span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${closeModal}>${T("Cancel")}</button>
      <button class="btn btn-primary" disabled=${busy || bad} onClick=${save}>${busy ? T("Saving…") : T("Save")}</button></>`}>
    <div class="iface-intro" style="margin-top:2px"><div>${vkLinksIntro()}</div></div>
    <div class="vklinks-grid">
      ${rows.map((r, i) => { const nv = norm[i]; const rbad = nv && !_VK_CALL_RE.test(nv); return html`
        <div class=${"vklinks-row" + (rbad ? " warn" : "")}>
          <button type="button" class=${"primtog vklinks-star" + (primary === i ? " on" : "")}
            title=${primary === i ? T("The primary link — single-link apps use this one") : T("Set as the primary link")}
            onClick=${() => setPrimary(i)}><span class="primstar">${primary === i ? "★" : "☆"}</span></button>
          <div class="vkbox" style="flex:1">
            <${Ic} i="link"/>
            <input class="vkbox-input" value=${r.url} placeholder=${T("A hash, or vk.ru/call/join/…")}
              onInput=${e => setUrl(i, e.target.value)}/>
          </div>
          <button class="iconbtn" title=${T("Remove this link")} onClick=${() => delRow(i)}><${Ic} i="trash"/></button>
        </div>`; })}
    </div>
    ${bad ? html`<div class="hint err">${T("Every link must be a VK call link or its hash, like")} <span class="mono">https://vk.ru/call/join/…</span></div>` : null}
    ${norm.filter(Boolean).length > (((typeof SWGTurn !== "undefined" && SWGTurn.vkLinkCaps) || {}).wdtt || 4)
      ? html`<div class="hint">${T("Apps differ: some use every link, some only the first few, some only the primary — the star sets which comes first.")}</div>` : null}
  </div>`;
}
export function QRPeerFoot({ pid }) {
  useStore();
  const p = Store.peer(pid);
  if (!p) return null;
  return html`<${Fragment}><span class="grow"></span>${peerBlockBtn(p)}<//>`;
}
export function QRUserFoot({ uid }) {
  useStore();
  const u = Store.user(uid);
  if (!u) return null;
  const peers = Store.peersOfUser(uid);
  const nCfg = peers.reduce((a, p) => a + ((p.targets || []).length || 0), 0);
  const count = plural(peers.length, "peer") + (nCfg > 1 ? " (" + T("{v1} configs)", { v1: nCfg }) : "");
  return html`<${Fragment}><span class="qrfoot-count">${count}</span><${UserCounts} user=${u} className="qrfoot-ucounts"/><span class="grow"></span><button class="btn btn-warn" onClick=${() => rotateAllUserKeys(u)} title=${T("Rotate the keys of every peer this user holds — all configs/links must be re-imported")}><${Ic} i="key"/> ${T("Rotate all keys")}</button>${userBlockBtn(u)}<//>`;
}
export function openUserEdit(user) {
  openModal(html`<${Sheet} title=${T("Edit · {v1}", { v1: user.name })} width=${780} subject=${{ kind: "user", id: user.id }}><${UserEditCard} user=${user} done=${closeModal}/><//>`);
}

function keyOnlyCopy() {
  const [a, b] = Tsplit("Config encryption is on. This key protects every stored client config and subscription link — the panel only ever stores it wrapped under your password, so {only}.", "only");
  return html`<${Fragment}>${a}<b>${T("this is the only copy in the clear")}</b>${b}<//>`;
}
function keyWhere() {
  const [a, b] = Tsplit("Store it in a password manager. It's what gets you back to your configs if your panel password is ever reset from the server — and anyone who holds it can read them, so treat it like a password. You can see it again any time from {where} while the vault is unlocked.", "where");
  return html`<${Fragment}>${a}<b>${T("Settings → Client configs")}</b>${b}<//>`;
}
function noVkSet(onNav) {
  const [a, b] = Tsplit("No VK call link set — configs carry a placeholder. Set it in {where}.", "where");
  return html`<${Fragment}>${a}<a href="#/panel/settings" onClick=${onNav}>${T("Panel settings → Turn proxies")}</a>${b}<//>`;
}
function noVkLinks() {
  const [a, b] = Tsplit("No VK links for this user yet — panel is using your {test} link to build turn configs. Fix before distributing.", "test");
  return html`<${Fragment}>${a}<b>${T("test")}</b>${b}<//>`;
}
function noVkSubbed() {
  const [a, b] = Tsplit("Right now their subscription page will show the turn configs {without} a VK link, so they'd have to add one in their turn app.", "without");
  return html`<${Fragment}>${a}<b>${T("without")}</b>${b}<//>`;
}
function vkLinksIntro() {
  const [a, b] = Tsplit("Each link is a VK call room the user's turn proxy pulls TURN credentials from. Mark one {primary} — apps that take a single link use it; some proxies use all of them (more links = more capacity).", "primary");
  return html`<${Fragment}>${a}<b>${T("primary")}</b>${b}<//>`;
}

export function VaultKeySheet() {
  const k = subKeyB64();
  if (!k) return null;
  return html`<${Sheet} title=${T("Save your encryption key")} width=${560} onClose=${closeModal} noSwipe=${true}
    foot=${html`<${Fragment}><span class="grow"></span><button class="btn btn-primary" onClick=${closeModal}>${T("I've saved it")}</button></>`}>
    <div class="vaultprompt">
      <p class="vp-reason">${keyOnlyCopy()}</p>
      <div class="tokenbox" style="margin:8px 0;word-break:break-all">${k}</div>
      <div class="chiprow">
        <button class="btn btn-mini" onClick=${() => copy(k, T("Encryption key copied"))}><${Ic} i="copy"/> ${T("Copy")}</button>
        <button class="btn btn-mini" onClick=${() => downloadConf(k, "swg-config-key")}><${Ic} i="download"/> ${T("Download")}</button>
      </div>
      <div class="notice warn vp-skip" style="margin-top:10px"><${Ic} i="info"/><span>${keyWhere()}</span></div>
    </div>
  <//>`;
}

export function SubUrlBar({ url }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  const copy = () => { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
    .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {}); };
  return html`<div class="suburl" onClick=${copy} title=${T("Copy subscription link")}>
    <${Ic} i="link"/><span class="suburl-txt">${url}</span>
    <span class=${"suburl-copy" + (copied ? " ok" : "")}><${Ic} i=${copied ? "check" : "copy"}/></span>
  </div>`;
}

export function openUserConfigs(user, back) {
  const peers = Store.peersOfUser(user.id);
  const cols = Math.min(peers.length || 1, 3);
  const wcols = Math.max(cols, 2);
  const width = wcols * QR_ITEM + (wcols - 1) * QR_GAP + 56;
  const anyTurn = peers.some(p => targetsWantVk(p.targets));
  const title = html`<span class="qrhd"><span class="qrhd-nm">${user.name}</span></span>`;
  const headExtra = html`<${SubStatusLine} user=${user} pos="hr"/>`;
  openModal(html`<${Sheet} title=${title} width=${width} headExtra=${headExtra} noGuard=${true} onClose=${back || closeModal}
    subject=${{ kind: "user", id: user.id }} foot=${html`<${QRUserFoot} uid=${user.id}/>`}>
    <${VaultUnlockPanel}/>
    <${SubLinkActions} user=${user}/>
    ${anyTurn ? html`<${VkLinkField} user=${user}/>` : null}
    ${peers.length ? html`<${QRRow} cards=${peers.map(p => html`<${UserPeerCard} key=${p.id} peer=${p} onOpen=${(p.targets || []).length > 1 ? () => openPeerConfigs(p, { child: true, hideVk: true }) : null}/>`)}/>`
      : html`<div class="empty" style="padding:24px">${T("This user has no peers yet.")}</div>`}
  <//>`);
}
export function openTurnConfigs(peer, t, conf) {
  pushModal(html`<${Sheet} title=${T("Turn configs · {v1}", { v1: peer.title || peer.name || T("val|peer") })} width=${560} noGuard=${true} onClose=${closeModal} onBack=${closeModal} subject=${{ kind: "peer", id: peer.id }}>
    <${TurnConfigSheet} peer=${peer} t=${t} conf=${conf}/>
  <//>`);
}
export function TurnConfigSheet({ peer, t, conf }) {
  const [selFork, setSelFork] = useState(0);
  const [inst, setInst] = useState({});
  const [selClient, setSelClient] = useState({});
  const [selOs, setSelOs] = useState({});
  const lt = ((Store.recon.peers.find(p => p.id === peer.id) || {}).targets || []).find(d => d.node === t.node && d.iface === t.iface) || t;
  const all = turnProxiesFor(t.node, t.iface);
  const sorted = lt.viaTurn ? [...all].sort((a, b) => (b.service === lt.viaTurn ? 1 : 0) - (a.service === lt.viaTurn ? 1 : 0)) : all;
  const order = [], byFork = {};
  sorted.forEach(p => { const f = turnFork(p.service); if (!byFork[f]) { byFork[f] = []; order.push(f); } byFork[f].push(p); });
  const vkUser = peer.user_id ? Store.recon.users.find(u => u.id === peer.user_id) : null;
  const vk = userVkLink(vkUser);
  const vkLinks = userVkLinks(vkUser);
  const base = (peer.title || peer.name || "peer") + "-" + Store.nodeName(t.node);
  if (!order.length) return html`<div class="hint">${T("No turn-proxy forwards to this interface.")}</div>`;
  const fi = Math.min(selFork, order.length - 1); const fork = order[fi];
  const list = byFork[fork]; const ii = Math.min(inst[fork] || 0, list.length - 1); const cur = list[ii];
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const allClients = turnClientsFor(fork).filter(c => !(targetType(t) === "awg" && (cmap[c.id] || {}).awg === false));
  const osOf = c => Object.keys((cmap[c.id] || {}).platforms || {});
  const osList = _OS_TABS.map(([o]) => o).filter(o => allClients.some(c => osOf(c).includes(o)));
  const curOs = (selOs[fork] && osList.includes(selOs[fork])) ? selOs[fork] : (osList[0] || "");
  const clients = allClients.filter(c => osOf(c).includes(curOs));
  const okey = fork + "|" + curOs;
  const ci = Math.min(selClient[okey] || 0, Math.max(0, clients.length - 1));
  const client = clients[ci] || null;
  const clientOsName = c => (((cmap[c.id] || {}).platforms || {})[curOs] || {}).name || c.name;
  return html`<div class="turncfg">
    ${order.length > 1 ? html`<div class="turntabs">${order.map((f, k) => html`<button key=${f}
      class=${"snbadge turntab" + (k === fi ? " on" : "")} style=${"--c:" + turnColor(f)} onClick=${() => setSelFork(k)}>${forkLabel(f)}</button>`)}</div>` : null}
    ${list.length > 1 ? html`<div class="turninst">
      <label>${T("Which {v1} proxy", { v1: forkLabel(fork) })}</label>
      <${Dropdown} className="selwrap" value=${ii} onChange=${v => setInst(m => ({ ...m, [fork]: v }))}
        ariaLabel=${T("Which {v1} proxy", { v1: forkLabel(fork) })}
        options=${list.map((p, k) => ({ value: k, label: (p.listen || ("proxy " + (k + 1))) + (p.title ? " (" + p.title + ")" : "") }))}/></div>` : null}
    ${(osList.length > 1 || clients.length > 1) ? html`<div class="turncfg-devrow">
      ${osList.length > 1 ? html`<div class="turncfg-os"><label>${T("Device")}</label><${OsDropdown} value=${curOs} options=${osList} onChange=${o => setSelOs(m => ({ ...m, [fork]: o }))}/></div>` : null}
      ${clients.length > 1 ? html`<div class="turncfg-app"><label>${T("App")}</label><${AppDropdown} value=${client ? client.id : null}
        options=${clients.map(c => { const rel = ((turnForkList().find(x => x.id === fork) || {}).compat || {})[c.id]; const isCli = (c.encoder === "sidecar" || c.id === "sidecar");
          return { id: c.id, name: clientOsName(c), author: (turnClientAuthor(c.id) || {}).fork || fork, color: turnClientColor(c.id) || turnColor(fork), nameColor: appNameColor(rel, isCli), plain: rel === "plain",
            autostart: !!((((cmap[c.id] || {}).platforms || {})[curOs] || {}).autostart) }; })}
        onChange=${id => setSelClient(m => ({ ...m, [okey]: Math.max(0, clients.findIndex(c => c.id === id)) }))}/></div>` : null}
    </div>` : null}
    ${!vk ? html`<div class="notice warn"><${Ic} i="warn"/><span>${noVkSet(() => closeAllModals())}</span></div>` : null}
    <${TurnCfgItem} key=${cur.service + "|" + (client ? client.encoder : "") + "|" + curOs} conf=${conf} tp=${cur} vk=${vk} vkLinks=${vkLinks} base=${base} client=${client} os=${curOs}/>
  </div>`;
}
export function TurnCfgItem({ conf, tp, vk, vkLinks, base, client, os }) {
  const a = turnArtifact(conf, tp, vk, vkLinks, client ? client.encoder : undefined, os);
  const [text, setText] = useState(a.text != null ? a.text : null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState(a.qr ? "qr" : "text");
  const taRef = useRef(null);
  useEffect(() => {
    if (a.text != null) { setText(a.text); return; }
    let ok = true; setText(null); setErr(null);
    Promise.resolve().then(a.buildAsync).then(t => { if (ok) setText(t); }).catch(e => { if (ok) setErr((e && e.message) || T("couldn't generate")); });
    return () => { ok = false; };
  }, [tp.service, conf, vk, client && client.encoder, os]);
  useEffect(() => { setView(a.qr ? "qr" : "text"); }, [tp.service, client && client.encoder]);
  useEffect(() => { if (view === "text") autoGrow(taRef.current); }, [text, view]);
  const ready = text != null;
  const qrView = a.qr && view === "qr";
  return html`<div class="turncfg-item">
    <div class="turncfg-head"><span class="tcf-label">${artLabel(a)}</span></div>
    ${a.hint ? html`<div class="hint" style="margin:2px 0 6px">${T(a.hint, a.hintArgs)}</div>` : null}
    ${err ? html`<div class="hint err">${err}</div>`
      : qrView ? (ready ? html`<div class="turncfg-qr"><${QR} conf=${text} label=${artLabel(a)}/></div>` : html`<div class="turncfg-qr qr-pending">${T("generating…")}</div>`)
      : html`<div class="turncfg-tawrap"><textarea class="turncfg-ta" readonly spellcheck="false" data-noautofocus ref=${taRef} onClick=${e => { e.target.select(); copy(text, a.uri ? T("Link copied") : T("Config copied")); }}>${ready ? text : T("generating…")}</textarea>
          <button class="cmd-copy" title=${T("Copy")} disabled=${!ready} onClick=${() => copy(text, a.uri ? T("Link copied") : T("Config copied"))}><${Ic} i="copy"/></button></div>`}
    ${a.cmd ? html`<div class="turncfg-cmd"><div class="tokenbox">${a.cmd}</div>
      <button class="cmd-copy" title=${T("Copy command")} onClick=${() => copy(a.cmd, T("Command copied"))}><${Ic} i="copy"/></button></div>` : null}
    <div class="turncfg-foot">
      ${a.qr ? html`<button class="btn btn-mini" onClick=${() => setView(v => v === "qr" ? "text" : "qr")}><${Ic} i=${qrView ? "doc" : "qr"}/> ${qrView ? T("Show config") : T("Show QR")}</button>` : null}
      <span class="grow"></span>
      <button class="btn btn-mini" disabled=${!ready} onClick=${() => qrView ? copyQrImage(text, T("QR image")) : copy(text, a.uri ? T("Link copied") : T("Config copied"))}><${Ic} i="copy"/> ${T("Copy")}</button>
      <button class="btn btn-mini" disabled=${!ready} onClick=${() => downloadConf(text, base + "-" + forkLabel(a.fork) + (portOf(tp.listen) ? "-" + portOf(tp.listen) : ""), a.ext)}><${Ic} i="download"/> ${T("Download .{v1}", { v1: a.ext || "conf" })}</button>
    </div>
  </div>`;
}



function UserNetworksPanel({ user }) {
  const [data, setData] = useState(null), [page, setPage] = useState(1);
  useEffect(() => {
    let ok = true;
    api.userNetworks({ user_id: user.id }).then(r => { if (ok && r && r.ok) setData(r.data); }).catch(() => {});
    return () => { ok = false; };
  }, [user.id]);
  const devName = (p, t) => {
    const q = Store.peer(p.peer_id), tg = q && (q.targets || []).find(x => x.node === t.node && x.iface === t.iface);
    const where = tg && tg.ip ? String(tg.ip).split("/")[0] : t.iface;
    return p.title ? p.title + " (" + where + ")" : where;
  };
  const rank = c => (c === true ? 2 : c === null ? 1 : 0);
  const rows = new Map();
  for (const p of ((data && data.peers) || [])) for (const t of p.targets) {
    const put = (key, seed, covered) => {
      const r = rows.get(key) || Object.assign({ key, node: t.node, devs: new Map() }, seed);
      const d = r.devs.get(p.peer_id);
      if (!d) r.devs.set(p.peer_id, { name: devName(p, t), covered });
      else if (rank(covered) > rank(d.covered)) d.covered = covered;
      rows.set(key, r);
    };
    if (t.lan) put(t.node + "|lan", { prefix: t.lan.addrs.join(", "), lan: t.lan }, t.lan.covered === undefined ? null : t.lan.covered);
  }
  const list = [...rows.values()].sort((a, b) => Store.nodeName(a.node).localeCompare(Store.nodeName(b.node))
    || a.prefix.localeCompare(b.prefix));
  if (!list.length) return null;
  const pages = Math.max(1, Math.ceil(list.length / LIST_PAGE)), pg = Math.min(page, pages);
  const how = r => r.lan.open ? T("the node's local network") : T("the node's local network, closed");
  const row = r => {
    const devs = [...r.devs.values()], node = Store.nodeName(r.node);
    const ok = devs.filter(d => d.covered === true).length, no = devs.filter(d => d.covered === false).length;
    const unk = devs.length - ok - no;
    const state = d => d.covered === true ? T("reachable") : d.covered === false ? T("not in this device's routing") : T("routing unknown");
    const cls = d => d.covered === true ? "ok" : d.covered === false ? "soon" : "off";
    return html`<div class="unet" key=${r.key}>
      <span class=${"mono unet-p" + (r.lan && !r.lan.open ? " off" : "")}>${r.prefix}</span>
      <span class="unet-how">${how(r)}</span>
      <span class="nm unet-node" style=${"color:" + (Store.nodeColor(r.node) || "var(--ink)")}>${node}</span>
      <span class="grow"></span>
      <${Popover} hoverOnly cls="netcount-pop" popCls="netroute-bub" trigger=${html`<span class="netcount"
          aria-label=${T("{total} of this user's devices on {node}: {ok} reach it, {no} leave it out of their routing, {unk} unknown", { total: devs.length, node, ok, no, unk })}>
        ${ok ? html`<span class="n ok">${ok}</span>` : null}${no ? html`<span class="n soon">${no}</span>` : null}${unk ? html`<span class="n unk">${unk}</span>` : null}</span>`}>
        <span class="netroute-h">${T("{prefix} on {node}", { prefix: r.prefix, node })}</span>
        <${CapList} items=${devs} cap=${10} row=${d => html`<div class=${"netbub-row nb-dot " + cls(d)} key=${d.name}><b>${d.name}</b> <span class="faint">${state(d)}</span></div>`}/>
      <//>
    </div>`;
  };
  return html`<div class="field"><label>${T("Networks this user can reach")}</label>
    <div class="unets">${pageSlice(list, pg).map(row)}</div>
    <${ListPager} page=${pg} setPage=${setPage} total=${list.length}/>
    <div class="hint">${T("Worked out when this sheet opens. A device whose routing leaves a network out can be widened from its own settings.")}</div></div>`;
}

function ReachBody({ user }) {
  const rows = userReach(user.id);
  const anyOnline = rows.some(r => r.online);
  const [all, setAll] = useState(!anyOnline);
  const show = all ? rows : rows.filter(r => r.online);
  const devs = r => (all ? r.devices : r.devices.filter(d => d.online));
  const count = r => (r.online && r.online !== r.devices.length
    ? T("{v1} ({v2} online)", { v1: plural(r.devices.length, "device"), v2: r.online })
    : plural(r.devices.length, "device"));
  return html`<${Fragment}>
    <div class="rb-head"><span class="netroute-h">${T("Can reach")}</span><span class="grow"></span>
      ${anyOnline ? html`<div class="dpsw rb-sw" role="radiogroup" aria-label=${T("Can reach")}>
        <button type="button" role="radio" aria-checked=${!all} class=${!all ? "on" : ""} onClick=${() => setAll(false)}>${T("Online")}</button>
        <button type="button" role="radio" aria-checked=${all} class=${all ? "on" : ""} onClick=${() => setAll(true)}>${T("filter|All")}</button>
      </div>` : null}</div>
    ${show.length ? html`<${CapList} items=${show} cap=${8} row=${r => html`<div class="rb-grp" key=${r.user.id}>
      <div class="rb-u"><b>${r.user.name}</b><span class="grow"></span><span class="faint">${count(r)}</span></div>
      <${CapList} items=${devs(r)} cap=${6} row=${d => html`<div class="rb-d" key=${d.peer.id}>
        <span class=${"nb-dot2 " + (d.online ? "on" : "idle")}></span>
        <b>${deviceNameAt(d.peer, d.node)}</b>
        <span class="faint">${T("prep|on")}</span>
        <span class="nb-node" style=${"color:" + (Store.nodeColor(d.node) || "var(--dim)")}>${Store.nodeName(d.node)}</span>
      </div>`}/>
    </div>`}/>` : html`<div class="netbub-row sub">${T("No other users have devices on interfaces open to everyone.")}</div>`}
  <//>`;
}

function NetsBody({ user }) {
  const [, force] = useState(0);
  const hit = netsCached(user.id);
  useEffect(() => { if (!hit) netsFetch(user.id).then(() => force(x => x + 1)); }, [user.id]);
  const rows = hit ? hit.rows : [];
  const anyOnline = rows.some(netRowOnline);
  const [pick, setPick] = useState(null);
  const all = pick == null ? !anyOnline : pick;
  const [shown, more] = useCapped(all ? rows : rows.filter(netRowOnline), 12);
  if (!hit) return html`<${Fragment}><span class="netroute-h">${T("Networks")}</span>
    <div class="netbub-row sub">${T("Loading…")}</div><//>`;
  const dot = r => r.covered === false ? "no" : r.covered == null ? "unk" : netRowOnline(r) ? "on" : "idle";
  const dotTitle = r => r.covered === false ? T("Not in this user's routing — they can't reach it")
    : r.covered == null ? T("Routing unknown — this device's build doesn't say") : "";
  const row = r => {
    return html`<div class="nb-row" key=${r.node + r.prefix}>
      <span class=${"nb-dot2 " + dot(r)} title=${dotTitle(r)}></span>
      <b class="mono">${r.prefix}</b>
      <span class="faint">${T("prep|on")}</span>
      <span class="nb-node" style=${"color:" + (Store.nodeColor(r.node) || "var(--dim)")}>${Store.nodeName(r.node)}</span>
    </div>`;
  };
  return html`<${Fragment}>
    <div class="rb-head"><span class="netroute-h">${T("Networks")}</span><span class="grow"></span>
      ${anyOnline ? html`<div class="dpsw rb-sw" role="radiogroup" aria-label=${T("Networks")}>
        <button type="button" role="radio" aria-checked=${!all} class=${!all ? "on" : ""} onClick=${() => setPick(false)}>${T("Online")}</button>
        <button type="button" role="radio" aria-checked=${all} class=${all ? "on" : ""} onClick=${() => setPick(true)}>${T("filter|All")}</button>
      </div>` : null}</div>
    ${rows.length ? html`<div class="nb-group">${shown.map(row)}</div>`
      : html`<div class="netbub-row sub">${T("No local networks to show.")}</div>`}
    ${more}
  <//>`;
}

export function UserCounts({ user, className }) {
  useStore();
  useEffect(() => { wantNetsCount(user.id); });
  const reach = reachTally(user.id);
  const people = reach.shown;
  const nt = netTally(user.id);
  const nets = nt.shown;
  if (!people && !nets) return null;
  return html`<span class=${"ucounts" + (className ? " " + className : "")} title="" onClick=${e => e.stopPropagation()}>
    ${people ? html`<${Popover} hoverOnly cls="grp-pop" popCls="netroute-bub netbub-wide"
      trigger=${html`<span class=${"grp-n" + (reach.online ? " lit" : "")} data-chip="reach" aria-label=${reach.online
        ? T("Can reach {v1} online now", { v1: plural(reach.online, "device") })
        : T("Can reach {v1}, none online", { v1: plural(reach.total, "device") })}><${Ic} i="users"/>${people}</span>`}>
      <${ReachBody} user=${user}/>
    <//>` : null}
    ${nets ? html`<${Popover} hoverOnly cls="grp-pop" popCls="netroute-bub netbub-wide"
      trigger=${html`<span class=${"grp-n" + (nt.online ? " lit-net" : "")} data-chip="networks" aria-label=${nt.online
        ? T("Reaches {v1} online now", { v1: plural(nt.online, "network") })
        : T("Reaches {v1}, none online", { v1: plural(nt.total, "network") })}><${Ic} i="network"/>${nets}</span>`}>
      <${NetsBody} user=${user}/>
    <//>` : null}
  </span>`;
}

export function UserEditCard({ user, done }) {
  useStore();
  const [name, setName] = useState(user.name || "");
  const initial = user.socks_profile?.id || "";
  const initialFailure = user.socks_profile?.failure || "block";
  const [profile, setProfile] = useState(initial);
  const [failure, setFailure] = useState(initialFailure);
  const [busy, setBusy] = useState(false), [saveErr, setSaveErr] = useState("");
  const showVk = Store.peersOfUser(user.id).some(p => targetsWantVk(p.targets));
  const pooled = !!profile;
  const profileDirty = profile !== initial || (pooled && failure !== initialFailure);
  const dirty = name !== (user.name || "") || profileDirty;
  const occupied = new Map(Object.values(Store.roster.users || {}).filter(u => u.id !== user.id && u.socks_profile)
    .map(u => [u.socks_profile.id, u.name]));
  const options = (Store.socksPool || []).map(option => {
    const owner = occupied.get(option.id);
    const state = owner !== undefined ? T("Assigned to {v1}", { v1: owner }) : option.enabled === false ? T("Disabled") : "";
    return { value: option.id, disabled: !!state,
             label: [option.label, state].filter(Boolean).join(" · ") };
  });
  const save = async () => {
    if (!name.trim()) { toast(T("Name can't be empty."), "err"); return; }
    const r = await sheetSend(() => api.userUpdate({ id: user.id, name: name.trim(),
      ...(profileDirty ? { socks_profile: pooled ? { id: profile, failure } : null } : {}) }),
    setSaveErr, setBusy);
    if (!r.ok) return;
    done(); Store.poll().catch(() => {});
  };
  const del = () => openConfirm({ title: T("Delete user · {name}", { name: user.name }), confirmLabel: T("Delete user"), danger: true, back: done,
    body: T("Their peers are revoked and become unassigned.") + " " + T("This can't be undone."),
    onConfirm: () => { closeModals(2);
      return mutate({ key: "user:" + user.id,
        patch: s => { delete s.roster.users[user.id]; for (const p of Object.values(s.roster.peers)) if (p.user_id === user.id) p.user_id = null; },
        call: () => api.userDelete({ id: user.id }) }); } });
  return html`<div class="card" style="max-width:740px">
    <${SubStatusLine} user=${user} pos="center"/>
    <div class="field"><label>${T("Name")}</label><input value=${name} onInput=${e => setName(e.target.value)} maxlength="64"/></div>
    <div class="field">
      <label>${T("SOCKS5 profile")}</label>
      <${Dropdown} value=${profile} onChange=${setProfile} ariaLabel=${T("SOCKS5 profile")} options=${[
        { value: "", label: T("No personal SOCKS5") }, ...options,
        ...(pooled && !options.some(o => o.value === profile) ? [{ value: profile, label: T("SOCKS5 exit unavailable"), disabled: true }] : []),
      ]}/>
      ${pooled ? html`<div class="hint">${T("Applies to all this user's devices when a rule sends traffic through the new cascade.")}</div>` : null}
    </div>
    ${pooled ? html`<div class="field"><label>${T("If SOCKS5 is unavailable")}</label>
      <${Dropdown} value=${failure} onChange=${setFailure} ariaLabel=${T("If SOCKS5 is unavailable")} options=${[
        { value: "block", label: T("Block traffic (Kill switch)") },
        { value: "direct", label: T("Direct internet access") },
      ]}/>
      <div class="hint">${T("Applies after trying the same account through all chains of the matching rule.")}</div>
    </div>` : null}
    <${VaultUnlockPanel}/>
    <${SubLinkActions} user=${user}/>
    ${showVk ? html`<${VkLinkField} user=${user}/>` : null}
    <${UserNetworksPanel} user=${user}/>
    ${saveErr ? html`<div class="formmsg err" role="alert">${saveErr}</div>` : null}
    <div class="editfoot"><button class="btn btn-danger" onClick=${del}><${Ic} i="trash"/> ${T("Delete user")}</button><button class="btn btn-warn" onClick=${() => rotateAllUserKeys(user, done)} title=${T("Rotate the keys of every peer this user holds — all configs/links must be re-imported")}><${Ic} i="key"/> ${T("Rotate all keys")}</button>${userBlockBtn(user, done)}<span class="grow"></span><button class="btn btn-ghost btn-dismiss" onClick=${done}>${T("Cancel")}</button><button class="btn btn-primary" disabled=${!dirty || busy} onClick=${save}>${T("Save")}</button></div>
  </div>`;
}


export function TargetCard(props) {
  const tt = targetType(props.t);
  return tt === "csqtt" ? html`<${TargetCardCsqtt} ...${props}/>`
       : tt === "wdtt" ? html`<${TargetCardWdtt} ...${props}/>`
       : html`<${TargetCardWg} ...${props}/>`;
}
export function LinkBox({ uri }) {
  const ref = useRef(null);
  useEffect(() => { autoGrow(ref.current); }, [uri]);
  return html`<div class="turncfg-tawrap">
    <textarea class="turncfg-ta" readonly spellcheck="false" data-noautofocus ref=${ref}
      onClick=${e => { e.target.select(); copy(uri, T("Link copied")); }}>${uri}</textarea>
    <button class="cmd-copy" title=${T("Copy link")} onClick=${() => copy(uri, T("Link copied"))}><${Ic} i="copy"/></button>
  </div>`;
}
export function clientHandoff(cl, cid, qr, os) {
  const name = (cl && cl.name) || cid;
  const deeplink = !!((((cl || {}).platforms || {})[os] || {}).autostart);
  if (deeplink) return T("{v1} — opens with one tap", { v1: name });
  if (qr) return T("{v1} — scans a QR code", { v1: name });
  return T("{v1} — imports a pasted link", { v1: name });
}
export function artLabel(a) {
  const m = (typeof SWGTurn !== "undefined" && SWGTurn.clientMeta) ? SWGTurn.clientMeta(a.enc) : null;
  if (!m) return a.fork ? T("{v1} · CLI client (desktop)", { v1: forkLabel(a.fork) }) : T(a.label || "");
  return T("{v1} via {v2} ({v3}) by {v4}", { v1: forkLabel(a.fork), v2: m.app, v3: m.platform + (a.labelMode || ""), v4: forkLabel(m.author) });
}
export function wdttArtInput(peer, t) {
  const rb = ((Store.stats[t.node] || {}).wdtt || []).find(w => w && w.iface === t.iface) || {};
  const nrec = (Store.nodes || []).find(n => n.id === t.node) || {};
  const user = (peer.user_id != null) ? (Store.roster.users || {})[peer.user_id] : null;
  const _lh = ipOf(rb.listen || "");
  const _pub = (((Store.stats[t.node] || {}).node_ips) || []).find(ip => ip && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) || "";
  return { password: peer.wdtt_password || "",
    endpoint_host: (_lh && _lh !== "0.0.0.0" ? _lh : "") || (nrec.endpoint_host || "").trim() || _pub,
    dtls_port: String(rb.listen || "").split(":").pop() || "56000",
    wg_port: rb.wg_port || 56001, tun_port: "9000",
    raw_port: rb.raw_port || "",
    vk_hash: peer.vk_hash || "", vk_links: userVkLinks(user) };
}
export function csqttArtInput(peer, t) {
  const rb = ((Store.stats[t.node] || {}).csqtt || []).find(c => c && c.iface === t.iface) || {};
  const nrec = (Store.nodes || []).find(n => n.id === t.node) || {};
  const user = (peer.user_id != null) ? (Store.roster.users || {})[peer.user_id] : null;
  const _lh = ipOf(rb.listen || "");
  const _pub = (((Store.stats[t.node] || {}).node_ips) || []).find(ip => ip && !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip)) || "";
  const host = (_lh && _lh !== "0.0.0.0" ? _lh : "") || (nrec.endpoint_host || "").trim() || _pub;
  const port = String(rb.listen || "").split(":").pop() || "46000";
  return { host, port, password: peer.csqtt_password || "", vk_hash: peer.vk_hash || "", vk_links: userVkLinks(user) || [],
           line: rb.line || "" };
}
export function csqttClientCfg(inp, cid) {
  const cl = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[cid] || {};
  const art = (typeof SWGTurn !== "undefined" && SWGTurn.csqttArtifact) ? SWGTurn.csqttArtifact(inp, cl.encoder || "csqtt", inp.line) : null;
  return { cl, art, uri: art && art.text, qr: !!(art && art.qr) };
}
export function useCsqttCfg(inp, cid) {
  const dc = inp ? csqttClientCfg(inp, cid) : { cl: {}, art: null, uri: null, qr: false };
  const src = dc.art && dc.art.text == null && dc.art.buildAsync ? (dc.art.src || "") : null;
  const [sealed, setSealed] = useState({ src: null, uri: null, err: null });
  useEffect(() => {
    if (src == null) return;
    let ok = true;
    Promise.resolve().then(dc.art.buildAsync).then(u => { if (ok) setSealed({ src, uri: u, err: null }); })
      .catch(e => { if (ok) setSealed({ src, uri: null, err: (e && e.message) || T("couldn't generate") }); });
    return () => { ok = false; };
  }, [src]);
  if (src == null) return dc;
  const mine = sealed.src === src;
  return { ...dc, uri: mine ? sealed.uri : null, pending: !mine, err: mine ? sealed.err : null };
}
export function TargetCardCsqtt({ peer: peerProp, t, bare, primary, head }) {
  useStore();
  const peer = Store.recon.peers.find(p => p.id === peerProp.id) || peerProp;
  const lt = (((Store.recon.peers.find(p => p.id === peer.id) || {}).targets) || []).find(d => d.node === t.node && d.iface === t.iface) || t;
  const col = Store.nodeColor(t.node); const dnode = Store.nodeName(t.node);
  const inp = csqttArtInput(peer, t);
  const rb = ((Store.stats[t.node] || {}).csqtt || []).find(x => x && x.iface === t.iface) || {};
  const clientIds = csqttClientIds(rb);
  const dc = useCsqttCfg(inp, clientIds[0] || "csqttapp");
  const vkFallbackHere = !vkOwnHash(peer, (peer.user_id != null) ? (Store.roster.users || {})[peer.user_id] : null);
  const vkUnassigned = peer.user_id == null;
  const vkNote = (dc.art && dc.art.vkMissing)
    ? html`<div class="hint vk-note">${T("No VK call link on this user — the link won't authenticate until one is set.")}</div>`
    : vkFallbackHere
      ? html`<div class="hint vk-note">${vkUnassigned ? T("Using the panel's fallback VK call link.")
          : T("Using the panel's fallback VK call link — this user has none of their own. Their subscription page hands out a link without it, so set a VK link on the user before sending them there.")}</div>`
      : null;
  const uri = dc.uri;
  const idParts = []; if (peer.name) idParts.push(esc(peer.name)); if (peer.title) idParts.push(esc(peer.title));
  const label = `<span class="qrc-id">${idParts.length ? idParts.join(" · ") : esc(T("val|Unassigned"))}</span>`
    + `<span class="qrc-srv" style="color:${esc(col)}">${esc(dnode)}</span><span class="tg tg-csqtt">${esc(t.iface)}</span>`;
  return html`<div class="deploy deploy-csqtt">
    ${head || html`<div class="deploy-head"><div class="nmwrap"><a class="nm nmlink" style=${"color:" + col} onClick=${() => { closeModal(); go("#/node/" + encodeURIComponent(t.node)); }}>${dnode}</a></div><${Tag} kind="csqtt" label=${t.iface}/><span class="grow"></span><${Badge} s=${lt.status}/></div>`}
    <div class=${"deploy-body" + (uri && !dc.qr ? " deploy-body-stack" : "")    }>
      ${primary === "backup" ? html`<span class="qr-primary qr-backup">${T("Backup")}</span>`
        : primary ? html`<span class="qr-primary">${T("Primary")}</span>` : null}
      ${!uri ? html`<div class="qr-none">${dc.pending ? T("generating…") : dc.err || T("csqtt link unavailable — the server isn't reporting yet.")}</div>`
        : dc.qr ? html`<${QR} conf=${uri} label=${label}/>`
        : html`<${LinkBox} uri=${uri}/>`}
      ${bare ? null : html`<div class="dmeta">
        <div class="row"><span class="k">${T("row|kind")}</span><span class="vv">${T("csqtt · keyless (server-minted address)")}</span></div>
        <div class="row"><span class="k">${T("row|endpoint")}</span><span class="vv">${inp.host || "—"}:${inp.port}</span></div>
        <div class="row"><span class="k">${T("row|address")}</span><span class="vv">${lt.ip || "—"}<span class="faint" style="text-transform:none;letter-spacing:0"> ${T("— assigned on first connect")}</span></span></div>
        <div class="row"><span class="k">${T("row|status")}</span><span class="vv"><${Badge} s=${lt.status}/></span></div>
      </div>`}
    </div>
    ${vkNote}
    ${uri ? html`<div class="acts">
      <button class="btn btn-mini" onClick=${() => copy(uri, T("csqtt link copied"))}><${Ic} i="copy"/> ${T("Copy")}</button>
      ${clientIds.length > 1 ? html`<button class="btn btn-mini" onClick=${() => pushModal(html`<${WdttConfigSheet} peer=${peer} t=${t} kind="csqtt"/>`)}><${Ic} i="dots"/> ${T("Alternatives")}</button>` : null}
    </div>` : null}
  </div>`;
}
export function wdttClientIds(fork) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  return turnClientsFor(fork).map(c => c.id).filter(cid => cmap[cid]);
}
export function csqttClientIds(rb) {
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  return wdttClientIds(rb.fork || "csqtt").filter(cid => !rb.line || (cmap[cid].csqtt_lines || ["2.1"]).includes(rb.line));
}
export function wdttClientCfg(w, cid, fork, os) {
  const cl = ((Store.turnCatalog && Store.turnCatalog.clients) || {})[cid] || {};
  const enc = cl.encoder || "wdtt";
  const wIn = (enc === "qwdtt" && fork) ? { ...w, ...pickDefined(turnClientSettingsFor(fork, enc, os), ["workers"]) } : w;
  const art = (typeof SWGTurn !== "undefined" && SWGTurn.wdttArtifact) ? SWGTurn.wdttArtifact(wIn, enc) : null;
  return { cl, qr: !!cl.qr, art, uri: art && art.text };
}
function pickDefined(o, keys) {
  const out = {};
  for (const k of keys) { const v = (o || {})[k]; if (v !== undefined && v !== null && String(v).trim() !== "") out[k] = v; }
  return out;
}
export function TargetCardWdtt({ peer: peerProp, t, bare, primary, head }) {
  useStore();
  const peer = Store.recon.peers.find(p => p.id === peerProp.id) || peerProp;
  const lt = (((Store.recon.peers.find(p => p.id === peer.id) || {}).targets) || []).find(d => d.node === t.node && d.iface === t.iface) || t;
  const col = Store.nodeColor(t.node); const dnode = Store.nodeName(t.node);
  const w = wdttArtInput(peer, t);
  const rb = ((Store.stats[t.node] || {}).wdtt || []).find(x => x && x.iface === t.iface) || {};
  const fork = rb.fork || "amurcanov";
  const clientIds = wdttClientIds(fork);
  const dc = wdttClientCfg(w, clientIds[0] || "wdttapp", fork);
  const vkFallbackHere = !vkOwnHash(peer, (peer.user_id != null) ? (Store.roster.users || {})[peer.user_id] : null);
  const vkUnassigned = peer.user_id == null;
  const vkNote = (dc.art && dc.art.vkMissing)
    ? html`<div class="hint vk-note">${T("No VK call link on this user — the link won't authenticate until one is set.")}</div>`
    : vkFallbackHere
      ? html`<div class="hint vk-note">${vkUnassigned ? T("Using the panel's fallback VK call link.")
          : T("Using the panel's fallback VK call link — this user has none of their own. Their subscription page hands out a link without it, so set a VK link on the user before sending them there.")}</div>`
      : null;
  const uri = dc.uri;
  const idParts = []; if (peer.name) idParts.push(esc(peer.name)); if (peer.title) idParts.push(esc(peer.title));
  const label = `<span class="qrc-id">${idParts.length ? idParts.join(" · ") : esc(T("val|Unassigned"))}</span>`
    + `<span class="qrc-srv" style="color:${esc(col)}">${esc(dnode)}</span><span class="tg tg-wdtt">${esc(t.iface)}</span>`;
  return html`<div class="deploy deploy-wdtt">
    ${head || html`<div class="deploy-head"><div class="nmwrap"><a class="nm nmlink" style=${"color:" + col} onClick=${() => { closeModal(); go("#/node/" + encodeURIComponent(t.node)); }}>${dnode}</a></div><${Tag} kind="wdtt" label=${t.iface}/><span class="grow"></span><${Badge} s=${lt.status}/></div>`}
    <div class=${"deploy-body" + (uri && !dc.qr ? " deploy-body-stack" : "")    }>
      ${primary === "backup" ? html`<span class="qr-primary qr-backup">${T("Backup")}</span>`
        : primary ? html`<span class="qr-primary">${T("Primary")}</span>` : null}
      ${!uri ? html`<div class="qr-none">${T("WDTT link unavailable — the server isn't reporting yet.")}</div>`
        : dc.qr ? html`<${QR} conf=${uri} label=${label}/>`
        : html`<${LinkBox} uri=${uri}/>`}
      ${bare ? null : html`<div class="dmeta">
        <div class="row"><span class="k">${T("row|kind")}</span><span class="vv">${T("WDTT · keyless (server-minted key)")}</span></div>
        <div class="row"><span class="k">${T("row|endpoint")}</span><span class="vv">${w.endpoint_host || "—"}:${w.dtls_port}</span></div>
        <div class="row"><span class="k">${T("row|address")}</span><span class="vv">${lt.ip || "—"}${lt.raw_ip
          ? html` <span class="tg tg-raw" title=${T("This peer's address on the RAW datapath — it holds both at once")}>RAW ${lt.raw_ip}</span>`
          : html`<span class="faint" style="text-transform:none;letter-spacing:0"> ${T("— assigned on first connect")}</span>`}</span></div>
        <div class="row"><span class="k">${T("row|status")}</span><span class="vv"><${Badge} s=${lt.status}/></span></div>
      </div>`}
    </div>
    ${vkNote}
    ${uri ? html`<div class="acts">
      <button class="btn btn-mini" onClick=${() => copy(uri, T("WDTT link copied"))}><${Ic} i="copy"/> ${T("Copy")}</button>
      ${clientIds.length > 1 ? html`<button class="btn btn-mini" onClick=${() => pushModal(html`<${WdttConfigSheet} peer=${peer} t=${t}/>`)}><${Ic} i="dots"/> ${T("Alternatives")}</button>` : null}
    </div>` : null}
  </div>`;
}
export function WdttConfigSheet({ peer, t, kind }) {
  useStore();
  const cs = kind === "csqtt";
  const w = cs ? csqttArtInput(peer, t) : wdttArtInput(peer, t);
  const rb = ((Store.stats[t.node] || {})[cs ? "csqtt" : "wdtt"] || []).find(x => x && x.iface === t.iface) || {};
  const fork = rb.fork || (cs ? "csqtt" : "amurcanov");
  const cmap = (Store.turnCatalog && Store.turnCatalog.clients) || {};
  const all = (cs ? csqttClientIds(rb) : wdttClientIds(fork)).map(id => ({ id, ...(cmap[id] || {}) }));
  const osOf = c => Object.keys((cmap[c.id] || {}).platforms || {});
  const osList = _OS_TABS.map(([o]) => o).filter(o => all.some(c => osOf(c).includes(o)));
  const [os, setOs] = useState(osList[0] || "android");
  const curOs = osList.includes(os) ? os : (osList[0] || "");
  const clients = all.filter(c => osOf(c).includes(curOs));
  const [ci, setCi] = useState(0);
  const cidx = Math.min(ci, Math.max(0, clients.length - 1));
  const client = clients[cidx] || null;
  const authorOf = id => (turnClientAuthor(id) || {}).fork || (cmap[id] || {}).author || fork;
  const clr = id => turnClientColor(id) || turnColor(authorOf(id));
  const base = (peer.title || peer.name || "peer") + "-" + Store.nodeName(t.node);
  const who = peer.title || peer.name || T("val|peer");
  return html`<${Sheet} title=${cs ? T("CSQTT client apps · {v1}", { v1: who }) : T("WDTT client apps · {v1}", { v1: who })} width=${600} noGuard=${true} onClose=${closeModal} onBack=${closeModal}
      headExtra=${html`<${PeerStatusLine} peer=${peer} pos="hr"/>`}>
    <div class="turncfg">
      <${PeerStatusLine} peer=${peer} pos="bar"/>
      <div class="turncfg-devrow">
        ${osList.length > 1 ? html`<div class="turncfg-os"><label>${T("Device")}</label><${OsDropdown} value=${curOs} options=${osList} onChange=${o => { setOs(o); setCi(0); }}/></div>` : null}
        ${clients.length > 1 ? html`<div class="turncfg-app"><label>${T("App")}</label><${AppDropdown} value=${client ? client.id : null}
          options=${clients.map(c => { const rel = ((turnForkList().find(f => f.id === fork) || {}).compat || {})[c.id];
            return { id: c.id, name: c.name || c.id, author: authorOf(c.id), color: clr(c.id), nameColor: appNameColor(rel, false), plain: rel === "plain",
              autostart: !!(((c.platforms || {})[curOs] || {}).autostart) }; })}
          onChange=${id => setCi(Math.max(0, clients.findIndex(c => c.id === id)))}/></div>` : null}
      </div>
      ${client ? html`<${WdttCfgItem} key=${client.id + "|" + curOs} w=${w} cid=${client.id} base=${base} fork=${fork} os=${curOs} kind=${kind}/>` : html`<div class="hint">${T("No client app for this device.")}</div>`}
    </div>
  <//>`;
}
export function WdttCfgItem({ w, cid, base, fork, os, kind }) {
  const cs = kind === "csqtt";
  const dcs = useCsqttCfg(cs ? w : null, cid);
  const dc = cs ? dcs : wdttClientCfg(w, cid, fork, os); const uri = dc.uri;
  const copied = cs ? T("csqtt link copied") : T("WDTT link copied");
  const [view, setView] = useState(dc.qr ? "qr" : "text");
  const taRef = useRef(null);
  useEffect(() => { setView(dc.qr ? "qr" : "text"); }, [cid]);
  useEffect(() => { if (view === "text") autoGrow(taRef.current); }, [uri, view]);
  const qrView = dc.qr && view === "qr";
  return html`<div class="turncfg-item">
    <div class="turncfg-head"><span class="tcf-label">${clientHandoff(dc.cl, cid, dc.qr, os)}</span></div>
    ${!uri ? html`<div class="qr-none">${dc.pending ? T("generating…") : dc.err ? dc.err : cs ? T("csqtt link unavailable — the server isn't reporting yet.") : T("WDTT link unavailable — the server isn't reporting yet.")}</div>`
      : qrView ? html`<div class="turncfg-qr"><${QR} conf=${uri} label=${dc.cl.name || cid}/></div>`
      : html`<div class="turncfg-tawrap"><textarea class="turncfg-ta" readonly spellcheck="false" data-noautofocus ref=${taRef} onClick=${e => { e.target.select(); copy(uri, copied); }}>${uri}</textarea>
          <button class="cmd-copy" title=${T("Copy link")} onClick=${() => copy(uri, copied)}><${Ic} i="copy"/></button></div>`}
    <div class="turncfg-foot">
      ${dc.qr ? html`<button class="btn btn-mini" onClick=${() => setView(v => v === "qr" ? "text" : "qr")}><${Ic} i=${qrView ? "doc" : "qr"}/> ${qrView ? T("Show link") : T("Show QR")}</button>` : null}
      <span class="grow"></span>
      <button class="btn btn-mini" disabled=${!uri} onClick=${() => qrView ? copyQrImage(uri, T("QR image")) : copy(uri, copied)}><${Ic} i="copy"/> ${T("Copy link")}</button>
      <button class="btn btn-mini" disabled=${!uri} onClick=${() => downloadConf(uri, base + (cs ? "-csqtt" : "-wdtt"), "txt")}><${Ic} i="download"/> ${T("Download .txt")}</button>
    </div>
  </div>`;
}
export function TargetCardWg({ peer: peerProp, t, bare, primary, head }) {
  useStore();
  const peer = Store.recon.peers.find(p => p.id === peerProp.id) || peerProp;
  const [conf, setConf] = useState(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { let ok = true; getConfig(peer.pubkey, t.node, t.iface).then(c => { if (ok) { setConf(c); setLoaded(true); ensurePeerBlob(peer, c); } }); return () => { ok = false; }; }, [peer.pubkey, t.node, t.iface, Store.configEpoch]);
  const ft = (Store.recon.peers.find(p => p.id === peer.id) || {}).targets;
  const lt = (ft && ft.find(d => d.node === t.node && d.iface === t.iface)) || t;
  const col = Store.nodeColor(t.node);
  const obs = lt.observed;
  const tps = turnProxiesFor(t.node, t.iface);
  const dnode = Store.nodeName(t.node);
  const idParts = []; if (peer.name) idParts.push(esc(peer.name)); if (peer.title) idParts.push(esc(peer.title));
  const ltype = targetType(t);
  const label = `<span class="qrc-id">${idParts.length ? idParts.join(" · ") : esc(T("val|Unassigned"))}</span>`
    + `<span class="qrc-srv" style="color:${esc(col)}">${esc(dnode)}</span><span class="tg tg-${ltype}${tgt3(t) ? " awg3" : ""}">${esc(t.iface)}</span>`;

  return html`<div class="deploy">
    ${head || html`<div class="deploy-head"><div class="nmwrap"><a class="nm nmlink" style=${"color:" + col} onClick=${() => { closeModal(); go("#/node/" + encodeURIComponent(t.node)); }}>${dnode}</a></div><${Tag} kind=${ltype} label=${t.iface} gen3=${tgt3(t)}/><span class="grow"></span>${peerUncategorised(t) && lt.status !== "blocked" && lt.status !== "faulty"
      ? uncatPop(html`<span class="badge b-uncat ic"><${Ic} i="warn"/>${statusLabel(lt.status)}</span>`)
      : html`<${Badge} s=${lt.status}/>`}</div>`}
    <div class="deploy-body">
      ${primary === "backup" ? html`<span class="qr-primary qr-backup">${T("Backup")}</span>`
        : primary ? html`<span class="qr-primary">${T("Primary")}</span>` : null}
      ${conf ? html`<${QR} conf=${conf} label=${label}/>`
        : html`<div class="qr-none">${!loaded ? T("loading…")
            : confWasSealedOld(peer.pubkey, t.node, t.iface)
              ? T("This config was encrypted with a previous encryption key and can no longer be opened. Re-issue this peer to give it a fresh config and QR.")
            : confWasUnreachable(peer.pubkey, t.node, t.iface)
              ? T("Couldn't reach the panel just now, so this peer's stored config could not be read. It has not been lost — try again in a moment.")
            : (Store.storeMode === "encrypted" && !subSKCached())
              ? T("The Encryption Vault is locked, so this peer's stored config can't be read. Unlock it to show the QR — the config has not been lost.")
            : Store.storeConfigs ? T("No stored config — re-issue this peer to enable its QR & download.")
            : T("Config shown right after creation, or enable store_configs to keep it.")}</div>`}
      ${bare ? null : html`<div class="dmeta">
        <div class="row"><span class="k">${T("row|address")}</span><span class="vv">${t.ip || "—"}</span></div>
        <div class="row"><span class="k">${T("row|handshake")}</span><span class="vv">${obs ? seen(obs.handshake_age) : "—"}</span></div>
        <div class="row"><span class="k">${T("row|rate")}</span><span class="vv">${(() => { const xf = tgtXfer(t); return xf ? rateCell(xf.rx_speed, xf.tx_speed) : "—"; })()}</span></div>
        <div class="row"><span class="k">${T("row|transport")}</span><span class="vv">${lt.viaTurn ? html`${T("via")} <span class="tg tg-turn" style=${"--tfc:" + turnColor(turnFork(lt.viaTurn))}>${forkLabel(turnFork(lt.viaTurn))}</span>` : (lt.via === "direct" ? T("tag|direct") : "—")}</span></div>
        ${tps.map(tp => html`<div class="row"><span class="k">${T("turn-proxy")}</span><span class="vv">${tp.listen || "—"}
          ${tp.wrap_key ? html`<${Fragment}> ${T("· key")} <span class="addr">${String(tp.wrap_key).slice(0, 8)}…</span><button class="copybtn" title=${T("Copy wrap key")} onClick=${() => copy(tp.wrap_key, T("Wrap key copied"))}><${Ic} i="copy"/></button></>` : null}</span></div>`)}
      </div>`}
    </div>
    ${conf ? html`<div class="acts">
      <button class="btn btn-mini" onClick=${() => downloadConf(conf, (peer.name || "peer") + "-" + dnode)}><${Ic} i="download"/> ${T("Config")}</button>
      <button class="btn btn-mini" onClick=${() => copy(conf, T("Config copied"))}><${Ic} i="copy"/> ${T("Copy")}</button>
      ${tps.length ? html`<button class="btn btn-mini" title=${T("Generate turn-proxy client configs")} onClick=${() => openTurnConfigs(peer, t, conf)}><${Ic} i="relay"/> ${T("Turn")}</button>` : null}
    </div>` : null}
  </div>`;
}
