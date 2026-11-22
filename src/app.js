import { h, render, Fragment, options } from "preact";
import { useState, useEffect, useRef, useMemo, useCallback } from "preact/hooks";
import htm from "htm";
import { T, Tsplit, loadLang, plural, srvText } from "./js/i18n.js";
import {
  $, $$, esc, isMobile,
} from "./js/util.js";
import {
  confirmLeave, matchRoute,
} from "./js/router.js";
import {
  Store, api, hooks as storeHooks, setUnauthorizedHandler, useStore,
} from "./js/store.js";
import {
  ConfirmSheet, Ic, Sheet, THEME_ICON, applyForkColors, applyThemeColors, clearModalStack, closeModal, cycleLang, cycleThemeMode,
  dismissHostProc, gotoSettingsSection, inProc, openConfirm, openModal, paintLangBtn, paintThemeBtn,
  procAborted, procFailed, procInClass, procLabel, procSuccess, setModalRenderer, setPendingSection,
  setQrZoomProbe, toast, trackIfaceOps, attachTitleTaps, attachOutsideTapGuard, attachSwipePeek, attachTypingHold, attachBubbleSwipe, attachToastSwipe, attachBackCloses, attachViewportVars,
} from "./js/ui.js";
import { themeMode } from "./js/theme.js";
import { LANGS, nextLang } from "./js/i18n.js";
import {
  cryptoReady, ifaceKeyAutoRestore, escrowAutoVerify, lockVault, looksLikeVaultKey, qrZoomEl, subAutoHeal, subBootRestore, subForget, subRewrap,
  subSKCached, subUnlock, subUnlockWithKey, subVaultCreate,
} from "./js/crypto.js";
import {
  OnlineSheet, OnlineUsersTag, onlineUserCount, onlineUserRows, serviceIssues,
} from "./js/views.js";
import {
  maybeRekeyGhosts, setLoadIfaceOpener,
} from "./js/peer-actions.js";
import {
  openTurnUpdates, trackTurnRestarts,
} from "./js/turn.js";
import {
  VaultKeySheet,
} from "./js/peer-ui.js";
import {
  IfaceDetail, LoadIfaceSheet,
} from "./js/iface.js";
import {
  CHECK_SVG, INFO_SVG, NodeDetail, NodesScreen, UPD_SPIN_SVG, WARN_SVG, X_SVG, checkForUpdate, fixBubbleHtml,
  hostHoverBubble, hostUpdRepairing, hostUpdating, noteHostUpdateDone, openUpdateDone, pendingUpdateDone,
  seenPanelVer, setSeenPanelVer, takePendingUpdateDone, turnUpdBubbleHtml, updBubbleHtml, updateHost, versionHoverBubble,
} from "./js/screen-nodes.js";
import {
  Overview, ServiceIssueSheet, maybeAlertServices, recordDashTick, setAppReady,
} from "./js/screen-overview.js";
import {
  ActivityHistoryScreen, ConnectionsScreen, PeersScreen, UsersScreen,
} from "./js/screen-roster.js";
import {
  AccountScreen, PanelSettingsScreen,
} from "./js/screen-settings.js";
import { LogOverlay, openLogOverlay } from "./js/journal.js";   // the header's Logs button: nothing loads until it is clicked

if (isMobile()) {
  const prev = options.vnode;
  options.vnode = v => { const p = v.props; if (typeof v.type === "string" && p && p.autofocus) delete p.autofocus; if (prev) prev(v); };
}

Object.assign(storeHooks, {
  themeColors: () => applyThemeColors(),
  forkColors: () => applyForkColors(),
  dashTick: () => recordDashTick(),
  alertServices: () => maybeAlertServices(),
  rekeyGhosts: () => maybeRekeyGhosts(),
  vaultKeyCached: () => subSKCached(),
  vaultAutoHeal: () => subAutoHeal(),
  ifaceKeyAutoRestore: () => ifaceKeyAutoRestore(),
  escrowAutoVerify: () => escrowAutoVerify(),
});
setUnauthorizedHandler(() => require401());
setQrZoomProbe(() => !!qrZoomEl);   // Esc inside a Sheet must collapse an open QR enlargement, not close the sheet
// The ghost-recreate flow (js/peer-actions.js) has to raise the Load-interface sheet, which lives above it.
setLoadIfaceOpener(({ node, pre, ghost, back }) =>
  openModal(html`<${LoadIfaceSheet} node=${node} pre=${pre} ghost=${ghost} back=${back}/>`));

const html = htm.bind(h);









// ───────────────────────── drag-to-reorder ─────────────────────────

















// Owner controls: assigned peers can only be Unassigned (revokes the holder); unassigned
// peers offer Assign-to (fresh key) and Delete. Deletion is gated to unassigned peers.


// ═════════════════════════ ROUTER + APP ═════════════════════════
const ROUTES = [
  { re: /^\/$/, fn: Overview, tab: "overview" },
  { re: /^\/connections$/, fn: ConnectionsScreen, tab: "connections" },
  { re: /^\/node\/([^/]+)\/([^/]+)$/, fn: IfaceDetail, tab: "nodes", keys: ["node", "iface"] },
  { re: /^\/node\/(.+)$/, fn: NodeDetail, tab: "nodes", keys: ["node"] },
  { re: /^\/nodes$/, fn: NodesScreen, tab: "nodes" },
  { re: /^\/peers$/, fn: PeersScreen, tab: "peers" },
  { re: /^\/activity$/, fn: ActivityHistoryScreen, tab: "overview" },
  { re: /^\/users$/, fn: UsersScreen, tab: "users" },
  { re: /^\/account$/, fn: AccountScreen, tab: "account" },
  { re: /^\/panel\/settings$/, fn: PanelSettingsScreen, tab: "panel-settings" },
];

// "previous panel address" ribbon
function _effPort(scheme, port) { return String(port || (scheme === "https" ? "443" : "80")); }
function _parseAddr(rawUrl) {
  const raw = (rawUrl || "").trim(); if (!raw) return null;
  let u; try { u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw); } catch (_) { return null; }
  const host = u.hostname, scheme = (u.protocol || "https:").replace(":", "");
  if (!host || host === "0.0.0.0") return null;
  return { host, scheme, port: _effPort(scheme, u.port), base: (u.pathname || "").replace(/\/+$/, "") };
}
function oldAddrCurrent() {   // → the current canonical addr {host,scheme,port,base,label} if THIS tab is on a different one, else null
  const c = _parseAddr(Store.panelPublicUrl); if (!c) return null;
  const scheme = location.protocol.replace(":", "");
  const hereBase = location.pathname.replace(/\/index\.html?$/i, "/").replace(/\/+$/, "");
  const _acc = (Store.panelSettings || {}).access || {};
  const _cw = _acc.console_wired || null;
  const _cport = String((_cw && _cw.port) || ((_acc.console || {}).mode === "own" ? (_acc.console || {}).port : "") || "");
  if (_cport && _effPort(scheme, location.port) === _cport) return null;   // this IS the console door
  if (location.hostname === c.host && _effPort(scheme, location.port) === c.port && hereBase === c.base) return null;   // on the current address (host + port + mount PATH)
  const showPort = !((c.scheme === "https" && c.port === "443") || (c.scheme === "http" && c.port === "80"));
  return { ...c, label: c.scheme + "://" + c.host + (showPort ? ":" + c.port : "") + c.base };
}
// An installed app (the manifest's start_url) keeps the address it was installed from for good: after a move it can only be
// installed again from the new one, so the ribbon says so there (docs/MOBILE-PLAN.md hook 6).
const standalone = () => { try { return matchMedia("(display-mode: standalone)").matches; } catch (_) { return false; } };
function OldAddrRibbon() {
  useStore();
  const c = oldAddrCurrent();
  const ref = useRef(null);
  useEffect(() => {
    document.body.classList.toggle("has-oldaddr", !!c);
    if (c && ref.current) document.body.style.setProperty("--oldaddr-h", ref.current.offsetHeight + "px");
    return () => document.body.classList.remove("has-oldaddr");
  });
  if (!c) return null;
  const canRevert = Store.panelMigrateRevertable && Store.panelMigratePrev;
  const revertMove = async () => {
    const r = await api.post("/api/access/cancel", Store.panelMigratePrev).catch(() => null);
    if (r && r.ok) { toast(T("Move cancelled — the panel stays on this address."), "ok"); await Store.poll(); }
    else toast(srvText(r) || T("Couldn't cancel the move."), "err");
  };
  return html`<div class="addr-old-ribbon" ref=${ref} role="status">
    <span><b>${T("You're on a previous panel address.")}</b> ${ribbonNow(c.label)}${standalone() ? " " + T("This app opens the old address for good: open the new one in the browser and install the app from there again.") : ""}</span>
    ${canRevert ? html`<button class="btn btn-mini" onClick=${revertMove}>${T("Cancel the move — keep this address")}</button>` : null}
    <a class="btn btn-mini" href=${c.label}>${T("Go to the current address ↗")}</a>
  </div>`;
}

// The new address is a LINK inside the sentence — translate whole, split on the marker (see Tsplit).
// "fix 3 issues" — a counted noun, so the count and the word travel together through plural().
const fixLabel = n => T("fix {count}", { count: plural(n, "issue") });

// Two styled runs in one sentence: the command name (monospace, never translated) and "untouched" (bold).
// Split twice on the same principle as Tsplit — the sentence stays one translatable unit.
function relinkWhy() {
  const [a, rest] = Tsplit("Your password was changed with {cmd}, which runs on the server and can't reach your encryption key. Your stored configs, QR codes and subscription links are {safe} — the vault just needs reconnecting.", "cmd");
  const [b, c] = [rest.split("{safe}")[0], rest.split("{safe}").slice(1).join("{safe}")];
  return html`<${Fragment}>${a}<b class="mono">swg-passwd</b>${b}<b>${T("untouched")}</b>${c}<//>`;
}

function ribbonNow(addr) {
  const [before, after] = Tsplit("The panel is now reached at {addr}.", "addr");
  return html`<${Fragment}>${before}<a href=${addr}>${addr}</a>${after}<//>`;
}

function App() {
  useStore();                                   // re-render on every poll
  const [hash, setHash] = useState(location.hash || "#/");
  const [modalStack, setModalStack] = useState([]);
  useEffect(() => { setModalRenderer(setModalStack); }, []);
  // Arm the panel-service alert once App is mounted (so openModal's setState is live), and fire it immediately
  // in case the first poll already landed a critical issue before mount. Later polls re-check via Store.apply.
  useEffect(() => { setAppReady(true); maybeAlertServices(); return () => setAppReady(false); }, []);

  useEffect(() => {
    let ok = false, fail = null, console_ok = false;
    try {
      const _ov = sessionStorage.getItem("__apply_ok");
      ok = _ov === "1" || _ov === "console"; console_ok = _ov === "console"; if (ok) sessionStorage.removeItem("__apply_ok");
      fail = sessionStorage.getItem("__apply_fail"); if (fail) sessionStorage.removeItem("__apply_fail");
    } catch (_) {}
    if (!ok && !fail) return;
    setPendingSection("access");
    if (location.hash !== "#/panel/settings") location.hash = "#/panel/settings";
    // defer past any hashchange (its handler resets the modal stack) so the outcome modal survives
    setTimeout(() => {
      if (console_ok) openModal(html`<${ConfirmSheet} title=${T("Console address confirmed")} confirmLabel=${T("Got it")}
        back=${() => { gotoSettingsSection("access"); closeModal(); }}
        body=${T("The operator console is served here now, and you're signed in. The panel's own address answers only what the nodes ask for — so close the other tab, it can't open the console any more.")}/>`);
      else if (ok) openModal(html`<${ConfirmSheet} title=${T("New address confirmed")} confirmLabel=${T("Got it")}
        back=${() => { gotoSettingsSection("access"); closeModal(); }}
        body=${T("This is now the address the panel is reached at, and you're signed in here. You can close the other tab — it's on the previous address.")}/>`);
      else openModal(html`<${ConfirmSheet} title=${T("Couldn’t confirm the new address")} warn=${true} confirmLabel=${T("OK")}
        body=${((fail && fail !== "1" && fail) || T("The confirmation didn’t match a pending change.")) + T(" The panel kept its current address.")}/>`);
    }, 0);
  }, []);
  const committedNonce = useRef("");
  useEffect(() => {
    const a = Store.dockerAwaiting;
    if (a && a.nonce && committedNonce.current !== a.nonce) {
      committedNonce.current = a.nonce;
      api.post("/api/access/docker-commit", { nonce: a.nonce }).then(() => Store.poll && Store.poll()).catch(() => { committedNonce.current = ""; });
    }
  });
  useEffect(() => {
    const onHash = () => {
      const nh = location.hash || "#/";
      if (!confirmLeave(nh)) return;   // a screen had unsaved edits and the operator declined; the URL is already restored
      setHash(nh); clearModalStack(); window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    const onMD = e => { const el = e.target && e.target.closest && e.target.closest(".iconbtn, #tabs a"); if (el) e.preventDefault(); };
    document.addEventListener("mousedown", onMD, true);
    return () => { window.removeEventListener("hashchange", onHash); document.removeEventListener("mousedown", onMD, true); };
  }, []);

  const { route, params } = matchRoute(ROUTES, hash);

  // static chrome lives in index.html — keep it in sync imperatively
  useEffect(() => {
    trackTurnRestarts();                                             // detect completed turn restarts → green flash
    trackIfaceOps();                                                 // interface start/restart progress lifecycle
    const lp = $("#livepill");                                       // online USERS, with a per-user peer-count bubble
    if (lp) {
      lp.classList.toggle("off", onlineUserRows(null).length === 0);   // 0 = grey, no dot
      // a phone: the count opens a sheet (OnlineSheet), as the update badge does — no hover bubble there
      if (isMobile()) { if (!lp._m) { lp._m = true; lp.setAttribute("role", "button"); lp.onclick = () => openModal(html`<${OnlineSheet}/>`); }
        render(html`<${Fragment}><span class="dot"></span><b id="kpi-online">${onlineUserCount(onlineUserRows(null))}</b> ${T("val|online")}<//>`, lp); }
      else render(html`<${OnlineUsersTag} nodeId=${null} cls="bare" trigger=${c => html`<span class="dot"></span><b id="kpi-online">${c}</b> ${T("val|online")}`}/>`, lp);
    }
    const v = Store.versions || {}, el = $("#appver");
    if (v.panel) {            // panel came back on a different version → it was updated; prompt a hard reload
      if (seenPanelVer && seenPanelVer !== v.panel) noteHostUpdateDone(seenPanelVer, v.panel);
      setSeenPanelVer(v.panel);
    }
    if (pendingUpdateDone && !inProc(Store.hostProc)) { const _u = takePendingUpdateDone(); openUpdateDone(_u[0], _u[1]); }
    if (el && v.panel) {        // panel version + info icon → the changelog hover bubble (reuses the update-bubble look)
      el.innerHTML = `<span class="appver-wrap"><b>${esc(v.panel)}</b><span class="appver-info" aria-label="${esc(T("Changelog"))}">${INFO_SVG}</span></span>`;
      if (!el._verWired) { el._verWired = true; versionHoverBubble(el); }   // wire once — #appver persists across polls
    }
    const ar = $("#appref");          // the host updater's branch, when it is not main: header Update installs it, not releases
    if (ar) {
      const ref = Store.panelUpdateRef || "";
      ar.hidden = !ref;
      if (ref) { ar.textContent = T("from {ref}", { ref }); ar.title = T("Update installs {ref}, not the latest release — this host's updater (/usr/local/bin/swg-update) was installed or last updated from it. Run `sudo bash -c \"SWG_REF=main swg-update\"` once to follow releases again.", { ref }); }
    }
    const ht = $("#host-tport");      // how the PANEL itself is deployed (docker / bare-metal)
    if (ht && Store.env && ("docker" in Store.env)) {
      const dk = !!Store.env.docker;
      ht.className = "tport " + (dk ? "docker" : "baremetal");
      // Say which runtime it really is. The pill is about THIS panel, and a podman-hosted one used to
      // read DOCKER — the same lie the node cards told before they learned to ask.
      ht.textContent = dk ? (Store.env.runtime === "podman" ? T("kind|podman") : T("kind|docker"))
                          : T("kind|bare-metal");
      ht.hidden = false;
    }
    const slot = $("#updslot");
    if (slot) {
      let body;
      const _hl = esc((hostUpdRepairing && ({ updating: T("repairing"), updated: T("repaired"), "update-failed": T("repair failed") }[Store.hostProc]))
                      || procLabel(Store.hostProc) || "");   // a Fix/re-run reads as "repairing…" / "repaired", not "updating"
      const _healN = serviceIssues().filter(i => i.fix !== false).length;   // self-healable issues (not Secure Boot's: no update enrols a key) (missing/broken swg units + AmneziaWG datapath) → the updater repairs them
      const _checkBtn = `<button class="iconbtn lg" id="upd-check" title="${esc(T("Check status"))}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v4h-4"/></svg></button>`;
      if (inProc(Store.hostProc)) body = `<span class="hostproc-tag ${procInClass(Store.hostProc)}">${UPD_SPIN_SVG} ${_hl}</span>`;
      else if (procSuccess(Store.hostProc)) body = `<span class="hostproc-tag ok">${CHECK_SVG} ${_hl}</span>`;   // green, auto-clears (no ×)
      else if (procAborted(Store.hostProc)) body = `<span class="hostproc-tag aborted">${INFO_SVG} ${_hl}<button class="xbtn" id="hostproc-x" title="${esc(T("Dismiss"))}">${X_SVG}</button></span>`;
      else if (procFailed(Store.hostProc)) body = `<span class="hostproc-tag fail${Store.hostProcErr ? ' tg-click' : ''}" id="hostproc-tag">${WARN_SVG} ${_hl}<button class="xbtn" id="hostproc-x" title="${esc(T("Dismiss"))}">${X_SVG}</button></span>`;   // whole tag clickable → error popup
      else if (hostUpdating) body = `<span class="livepill upd-busy">${esc(hostUpdRepairing ? T("repairing…") : T("updating…"))} ${UPD_SPIN_SVG}</span>`;
      else if (Store.hostChecking) body = `<span class="livepill upd-busy">${esc(T("checking…"))} ${UPD_SPIN_SVG}</span>`;   // Check status click → brief "checking…" pill (updates + issues)
      // Priority: a real upgrade first (updating heals too, so no "Fix" then) → else self-healable issues → else up-to-date / check.
      else if (Store.panelOutdated) body = `<button class="livepill updpill" id="host-upd">${esc(T("update to"))} <b>${esc(Store.latestRemote || "?")}</b></button>`;
      // data-n: the count alone, which a phone's one-line app bar shows in place of the words (m/m.css); a desktop draws nothing of it
      else if (_healN > 0) body = `<button class="livepill updpill fixpill" id="host-fix" data-n="${_healN}">${WARN_SVG} ${esc(fixLabel(_healN))}</button>`;
      else if (Store.updFlash && Date.now() < Store.updFlash) body = `<button class="livepill upd-uptodate" id="host-repair" title="${esc(T("This panel is on the latest version"))}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> ${esc(T("up to date"))}</button>`;
      else body = _checkBtn;
      if (/id="host-(upd|fix|repair)"/.test(body)) body += _checkBtn;
      const _turnN = new Set((Store.turnUpdates || []).map(r => r.fork)).size;
      const _turnBadge = (_turnN && !/hostproc-tag|upd-busy/.test(body))
        ? `<button class="livepill updpill turnpill" id="turn-upd" data-n="${_turnN}">${esc(plural(_turnN, "update"))}</button>` : "";
      // Left of the check button in BOTH layouts: the badges read as a row of things that are true, and the
      // check is the verb that refreshes them — a verb belongs at the end of the row, not between two facts.
      if (_turnBadge) body = body.includes(_checkBtn) ? body.replace(_checkBtn, _turnBadge + _checkBtn) : body + _turnBadge;
      slot.innerHTML = body;
      const b = $("#host-upd"); if (b) { b.onclick = updateHost; hostHoverBubble(b, updBubbleHtml, updateHost); }   // version + date + changelog on hover; the bubble's own Update button runs the SAME action (on touch the anchor is underneath it)
      const rp = $("#host-repair"); if (rp) rp.onclick = updateHost;   // up-to-date → still allow a re-run/repair (heals the datapath even with no new version)
      const fx = $("#host-fix"); if (fx) { fx.onclick = () => openModal(html`<${ServiceIssueSheet} issues=${serviceIssues().filter(i => i.fix !== false)}/>`); hostHoverBubble(fx, fixBubbleHtml); }   // the issue(s) on hover; click = review + run the repair
      const tu = $("#turn-upd"); if (tu) { tu.onclick = openTurnUpdates; hostHoverBubble(tu, turnUpdBubbleHtml, openTurnUpdates); }   // forks + versions on hover; the bubble's own foot is the action (and reachable on touch, where the anchor is underneath it)
      const c = $("#upd-check"); if (c) c.onclick = checkForUpdate;
      const hx = $("#hostproc-x"); if (hx) hx.onclick = e => { e.stopPropagation(); dismissHostProc(); };
      const htg = $("#hostproc-tag"); if (htg && Store.hostProcErr) htg.onclick = () => openConfirm({ title: procLabel(Store.hostProc), log: Store.hostProcErr, confirmLabel: T("Close") });
    }
    $$("#tabs a").forEach(a => a.classList.toggle("active", a.dataset.tab === route.tab));
    const acct = $("#acct-btn"); if (acct) acct.onclick = () => doLogout();   // header logout icon → straight to the confirm
    const tb = $("#theme-btn"); if (tb && !tb._wired) { tb._wired = true; tb.onclick = cycleThemeMode; paintThemeBtn(tb); }   // light/dark/auto switch
    const lb = $("#lang-btn"); if (lb && !lb._wired) { lb._wired = true; lb.onclick = cycleLang; paintLangBtn(lb); }            // EN / RU
    const lg = $("#logs-btn"); if (lg && !lg._wired) { lg._wired = true; lg.hidden = false; lg.onclick = openLogOverlay; }      // the live logs, full screen, from any screen
    const mb = $("#more-btn");        // the phone's More: the header's actions that carry no status (docs/MOBILE-PLAN.md hook 1)
    if (mb && !mb._wired) { mb._wired = true; mb.onclick = () => openModal(html`<${MoreSheet}/>`); }
    // The way to the phone UI from the desktop one: only where the primary pointer is a finger (a tablet, or a phone switched to
    // the desktop view), so a mouse desktop's header is unchanged.
    const mv = $("#mview-btn");
    if (mv && !mv._wired) { mv._wired = true; mv.hidden = isMobile() || !matchMedia("(pointer: coarse)").matches; mv.onclick = () => setUiMode("m"); }
    const vl = $("#vaultlock-btn");   // padlock: removed from the header by request — kept (wired to lockVault) but always hidden
    if (vl) { vl.hidden = true; if (!vl._wired) { vl._wired = true; vl.onclick = lockVault; } }
  });

  return html`<${Fragment}>
    ${h(LogOverlay)}
    ${h(OldAddrRibbon)}
    ${h(route.fn, params)}
    ${modalStack}
  <//>`;
}

// The app bar's mark (index.html's .brand holds the same markup, static): the login cards and the More sheet's title.
const brandMark = () => html`<span class="brand-mark" aria-hidden="true"></span><span class="brand-name">swg<span>Panel</span></span>`;

// ───────────────────────── auth: login page + logout ─────────────────────────
let _loginShown = false;
// Two-factor (TOTP / Google Authenticator) card for Settings → Authentication.
function require401() { showLogin(); throw new Error("unauthorized"); }   // i18n-keys: a control-flow sentinel, never displayed
function showLogin() { if (_loginShown) return; _loginShown = true; document.body.classList.add("loggedout"); try { render(h(LoginScreen), viewEl); } catch (_) {} }
function VaultRelinkCard({ panelPw, onDone }) {
  const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const ref = useRef(null);
  useEffect(() => { if (!isMobile() && ref.current) ref.current.focus(); }, []);   // a phone: no keyboard until a tap
  const submit = async e => {
    if (e) e.preventDefault();
    if (!pw || busy) return;
    setBusy(true); setErr("");
    try {
      if (looksLikeVaultKey(pw)) {
        try { await subUnlockWithKey(pw); }
        catch (keyErr) { try { await subUnlock(pw); } catch (_) { throw keyErr; } }
      } else await subUnlock(pw);
      await subRewrap(panelPw);        // the vault now opens with the password just signed in with
      onDone();
    } catch (e2) { setErr((e2 && e2.message) || T("That didn't unlock the Encryption Vault.")); setBusy(false); }
  };
  return html`<div class="login-wrap"><form class="login-card" onSubmit=${submit}>
    <div class="login-brand">${brandMark()}</div>
    <h2>${T("Reconnect your vault")}</h2>
    <p class="muted" style="margin:-4px 0 12px">${relinkWhy()}</p>
    <div class="field"><label>${T("Old panel password, or your encryption key")}</label>
      <input ref=${ref} type="password" value=${pw} autocomplete="off" placeholder=${T("Password or encryption key")} onInput=${e => setPw(e.target.value)}/></div>
    <p class="muted" style="margin:-4px 0 12px">${T("The encryption key is the one shown when this panel set up encryption — you were asked to save it.")}</p>
    ${err ? html`<div class="formmsg err">${err}</div>` : null}
    <button class="btn btn-primary" type="submit" disabled=${busy || !pw} style="width:100%;justify-content:center;margin-top:4px">${busy ? T("Reconnecting…") : T("Reconnect vault")}</button>
    <button class="btn btn-ghost" type="button" disabled=${busy} style="width:100%;justify-content:center;margin-top:8px" onClick=${onDone}>${T("Skip for now")}</button>
  </form></div>`;
}
function LoginScreen() {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [twofa, setTwofa] = useState(false); const [code, setCode] = useState("");
  const [relink, setRelink] = useState(null);   // set to the NEW panel password when the vault needs reconnecting first
  const focusRef = useRef(null);
  useEffect(() => { if (!isMobile() && focusRef.current) focusRef.current.focus(); }, [twofa]);   // a phone: no keyboard until a tap
  const submit = async e => {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.login({ username: u, password: p, code: twofa ? code.trim() : undefined });
      if (r && r.ok) {
        let unlocked = true;
        try { await subUnlock(p); } catch (_) {
          unlocked = false;
          try {
            const v = await api.subVault();
            if (!(v && v.ok && v.data && v.data.exists)) {
              await subVaultCreate(p); unlocked = true;
              // the key just minted here is the ONLY way back in after an out-of-band password reset — show it
              // once the SPA is up (the raw key is already in the session cache subVaultCreate wrote).
              try { sessionStorage.setItem("__vault_show_key", "1"); } catch (_) {}
            }
          } catch (_) {}
        }
        if (r.data && r.data.vault_reset) {
          if (unlocked) { try { await subRewrap(p); sessionStorage.setItem("__vault_reconnected", "1"); } catch (_) {} }
          else { setRelink(p); setBusy(false); return; }   // ask HERE — after the reload the new password is gone, and the re-wrap needs it
        }
        location.reload(); return;
      }
      if (r && r.twofa_required) {                       // password OK — panel wants the 6-digit code
        const msg = srvText(r) || "";
        setTwofa(true); setErr(msg);
        if (msg) {                                       // a REJECTED code: clear it (else the next digits append) and
          setCode("");                                   // take focus back from the Verify button so retyping just works.
          focusRef.current && focusRef.current.focus();  // same DOM node — `twofa` didn't flip, so it is not remounted
        }
        setBusy(false); return;
      }
      setErr(srvText(r) || T("Login failed.")); setBusy(false);
    } catch (_) { setErr(T("Couldn't reach the panel.")); setBusy(false); }
  };
  if (relink) return html`<${VaultRelinkCard} panelPw=${relink} onDone=${() => location.reload()}/>`;
  return html`<div class="login-wrap"><form class="login-card" onSubmit=${submit}>
    <div class="login-brand">${brandMark()}</div>
    <h2>${twofa ? T("Two-factor") : T("Sign in")}</h2>
    ${twofa ? html`
      <p class="muted" style="margin:-4px 0 12px">${T("Enter the 6-digit code from your authenticator app, or a recovery code.")}</p>
      <div class="field"><label>${T("Authentication code")}</label><input ref=${focusRef} value=${code} onInput=${e => setCode(e.target.value)} inputmode="text" autocomplete="one-time-code" placeholder="123 456"/></div>
      ${err ? html`<div class="formmsg err">${err}</div>` : null}
      <button class="btn btn-primary" type="submit" disabled=${busy} style="width:100%;justify-content:center;margin-top:4px">${busy ? T("Verifying…") : T("Verify")}</button>
      <button class="btn btn-ghost" type="button" onClick=${() => { setTwofa(false); setCode(""); setErr(""); }} style="width:100%;justify-content:center;margin-top:8px">${T("Back")}</button>
    ` : html`
      <div class="field"><label>${T("Username")}</label><input ref=${focusRef} value=${u} onInput=${e => setU(e.target.value)} autocomplete="username"/></div>
      <div class="field"><label>${T("Password")}</label><input type="password" value=${p} onInput=${e => setP(e.target.value)} autocomplete="current-password"/></div>
      ${err ? html`<div class="formmsg err">${err}</div>` : null}
      <button class="btn btn-primary" type="submit" disabled=${busy} style="width:100%;justify-content:center;margin-top:4px">${busy ? T("Signing in…") : T("button|Sign in")}</button>
    `}
  </form></div>`;
}
function setUiMode(m) { try { localStorage.setItem("swg-ui", m); } catch (_) {} location.reload(); }
const LOGOUT_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg>`;
const DESKTOP_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
function MoreSheet() {
  useStore();
  const [, force] = useState(0);
  const go = (fn) => () => { closeModal(); fn(); };
  const v = Store.versions || {}, ref = Store.panelUpdateRef || "";
  const env = Store.env || {};
  const kind = !("docker" in env) ? "" : env.docker ? (env.runtime === "podman" ? T("kind|podman") : T("kind|docker")) : T("kind|bare-metal");
  const tm = themeMode();
  const item = (icon, label, onClick, value, cls) => html`<button class=${"msheet-it" + (cls ? " " + cls : "")} onClick=${onClick}>
    <span class="ic" dangerouslySetInnerHTML=${{ __html: icon }}></span><span class="msheet-l">${label}</span>${value ? html`<span class="msheet-v">${value}</span>` : null}</button>`;
  // its title is the app bar's own mark, as in the header (operator, 2026-10-31); a screen reader still hears "More"
  return html`<${Sheet} title=${html`<span class="m-brand" role="img" aria-label=${T("More")}>${brandMark()}</span>`} noGuard=${true}>
    <div class="msheet">
      <div class="msheet-g">
        <button class="msheet-it" onClick=${go(() => checkForUpdate())}><${Ic} i="refresh"/><span class="msheet-l">${T("Check status")}</span></button>
        <button class="msheet-it" onClick=${go(openLogOverlay)}><${Ic} i="doc"/><span class="msheet-l">${T("Logs")}</span></button>
      </div>
      <div class="msheet-g">
        ${item(THEME_ICON[tm], T("Theme"), () => { cycleThemeMode(); force(x => x + 1); },
               tm === "auto" ? T("theme|Auto") : tm === "light" ? T("theme|Light") : T("theme|Dark"))}
        ${/* the value is the language a tap switches TO, in its own words — someone who cannot read this one finds theirs */""}
        <button class="msheet-it" onClick=${cycleLang}><${Ic} i="globe"/><span class="msheet-l">${T("Language")}</span><span class="msheet-v" lang=${nextLang()}>${(LANGS.find(([c]) => c === nextLang()) || [])[1] || nextLang()}</span></button>
        ${item(DESKTOP_SVG, T("Desktop view"), () => setUiMode("d"))}
      </div>
      <div class="msheet-g">
        <button class="msheet-it" onClick=${go(() => { location.hash = "#/panel/settings"; })}><${Ic} i="gear"/><span class="msheet-l">${T("Settings")}</span></button>
        <button class="msheet-it" onClick=${go(() => { location.hash = "#/account"; })}><${Ic} i="user"/><span class="msheet-l">${T("Account")}</span></button>
        ${item(LOGOUT_SVG, T("Log out"), go(doLogout), null, "danger")}
      </div>
      ${v.panel ? html`<div class="msheet-ver">
        <div class="msheet-verl"><b>${v.panel}</b>${kind ? html`<span>${kind}</span>` : null}${ref ? html`<span class="appref">${T("from {ref}", { ref })}</span>` : null}</div>
        ${ref ? html`<p>${T("Update installs {ref}, not the latest release — this host's updater (/usr/local/bin/swg-update) was installed or last updated from it. Run `sudo bash -c \"SWG_REF=main swg-update\"` once to follow releases again.", { ref })}</p>` : null}
      </div>` : null}
    </div>
  <//>`;
}
function doLogout() {
  openConfirm({ title: T("Log out"), confirmLabel: T("Log out"),
    body: T("Are you sure you want to logout?"),
    onConfirm: async () => { subForget(); try { await api.logout(); } catch (_) {} location.reload(); } });
}
// Account form as a modal (same chrome as the node sheets).

// ───────────────────────── boot ─────────────────────────
const viewEl = $("#view");
viewEl.innerHTML = `<div class="loading"><span class="spin"></span>${T("connecting…")}</div>`;
async function maybeConfirmApply() {
  const mu = /[?&]__applyurl=([A-Za-z0-9]+)/.exec(location.search);
  const mc = /[?&]__applyconsole=([A-Za-z0-9]+)/.exec(location.search);
  const m = mu || mc || /[?&]__apply=([A-Za-z0-9]+)/.exec(location.search);
  if (!m) return false;
  // strip the query so a reload can't re-fire, and land on Access & TLS — presetting the hash HERE (before the
  // reload) means App's outcome effect doesn't have to change it, so the hashchange handler can't wipe the modal.
  history.replaceState(null, "", location.pathname + "#/panel/settings");
  let r = null;
  const endpoint = mu ? "/api/access/confirm-url" : (mc ? "/api/access/console-confirm" : "/api/access/confirm");
  try { r = await api.post(endpoint, { nonce: m[1] }); } catch (_) { r = null; }   // never throws us to login: confirm is pre-auth
  if (r && r.ok) { try { sessionStorage.setItem("__apply_ok", mc ? "console" : "1"); } catch (_) {} location.reload(); return true; }
  try { sessionStorage.setItem("__apply_fail", srvText(r) || "1"); } catch (_) {}   // shown by App once it mounts (if we're authed here)
  return false;
}
function paintChrome() {
  const tab = { overview: T("nav|Overview"), connections: T("nav|Live"), users: T("nav|Users"),
                nodes: T("nav|Nodes"), peers: T("nav|Peers") };
  $$("#tabs a").forEach(a => { const k = a.dataset.tab; if (tab[k]) a.textContent = tab[k]; });
  const brand = $(".brand"); if (brand) brand.setAttribute("aria-label", T("nav|Overview"));
  const hint = [["#host-tport", T("How this panel is deployed")], ["#vaultlock-btn", T("Lock encryption key")],
                ["#lang-btn", T("Language")], ["#theme-btn", T("Theme")],
                ["#logs-btn", T("Logs")], ["#panel-settings-btn", T("Panel settings")], ["#acct-btn", T("Log out")],
                ["#mview-btn", T("Mobile view")], ["#more-btn", T("More")]];
  for (const [sel, label] of hint) {
    const el = $(sel);
    if (!el) continue;
    el.title = label;
    if (el.hasAttribute("aria-label")) el.setAttribute("aria-label", label);
  }
}

(async () => {
  await loadLang();         // before the first render: T() is synchronous, and a late catalog would paint English then flip
  paintChrome();            // the static app bar, which loaded before any of this
  if (!cryptoReady()) {
    const b = document.createElement("div");
    b.className = "insecure-banner";
    b.innerHTML = `<b>${esc(T("Not a secure connection"))}</b> ${esc(T("Your browser only provides Web Crypto over https:// (or http://localhost), so creating peers, unlocking the Encryption Vault and showing configs or QR codes will not work here. Monitoring is unaffected."))}`;
    document.body.insertBefore(b, document.body.firstChild);
  }
  await subBootRestore();   // restore the config-encryption convenience cache from sessionStorage (post-login reload)
  if (await maybeConfirmApply()) return;   // confirmed → reloading; stop this boot pass
  try { await Store.init(); }
  catch (e) { if (!_loginShown) viewEl.innerHTML = `<div class="empty"><b>${esc(T("Can't reach the panel"))}</b>${esc(e.message)}</div>`; return; }
  if (!location.hash) location.hash = "#/";
  // landed here right after a confirm (we reloaded to pick up the carried session) → open the settings screen
  // straight on Access & TLS, BEFORE it mounts and defaults to Display. (The outcome modal is shown by App.)
  try { if (sessionStorage.getItem("__apply_ok")) setPendingSection("access"); } catch (_) {}
  render(h(App), viewEl);
  if (isMobile()) { attachTitleTaps(); attachOutsideTapGuard(); attachSwipePeek(); attachTypingHold(); attachBubbleSwipe(); attachToastSwipe(); attachBackCloses(); attachViewportVars(); }   // a phone: a title= on a tap (hook 5); a tap outside a list only closes it
  window.__swgBooted = true;
  try { if (sessionStorage.getItem("__vault_reconnected")) { sessionStorage.removeItem("__vault_reconnected"); setTimeout(() => toast(T("Encryption Vault reconnected."), "ok"), 400); } } catch (_) {}
  try { if (sessionStorage.getItem("__vault_show_key")) { sessionStorage.removeItem("__vault_show_key"); setTimeout(() => openModal(html`<${VaultKeySheet}/>`), 500); } } catch (_) {}
})();

