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
  dismissHostProc, inProc, openConfirm, openModal, paintLangBtn, paintThemeBtn,
  procAborted, procFailed, procInClass, procLabel, procSuccess, setModalRenderer,
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
  NodeDetail, NodesScreen, hostHoverBubble, turnUpdBubbleHtml,
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

// "fix 3 issues" — a counted noun, so the count and the word travel together through plural().
const fixLabel = n => T("fix {count}", { count: plural(n, "issue") });

// Two styled runs in one sentence: the command name (monospace, never translated) and "untouched" (bold).
// Split twice on the same principle as Tsplit — the sentence stays one translatable unit.
function relinkWhy() {
  const [a, rest] = Tsplit("Your password was changed with {cmd}, which runs on the server and can't reach your encryption key. Your stored configs, QR codes and subscription links are {safe} — the vault just needs reconnecting.", "cmd");
  const [b, c] = [rest.split("{safe}")[0], rest.split("{safe}").slice(1).join("{safe}")];
  return html`<${Fragment}>${a}<b class="mono">swg-passwd</b>${b}<b>${T("untouched")}</b>${c}<//>`;
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
    const el = $("#appver");
    if (el) el.textContent = (Store.versions || {}).panel || "";
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
      const updates = new Set((Store.turnUpdates || []).map(row => row.fork)).size;
      slot.innerHTML = updates ? `<button class="livepill updpill turnpill" id="turn-upd" data-n="${updates}">${esc(plural(updates, "update"))}</button>` : "";
      const button = $("#turn-upd");
      if (button) {
        button.onclick = openTurnUpdates;
        hostHoverBubble(button, turnUpdBubbleHtml, openTurnUpdates);
      }
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
    ${h(route.fn, params)}
    ${modalStack}
  <//>`;
}

// The app bar's mark (index.html's .brand holds the same markup, static): the login cards and the More sheet's title.
const brandMark = () => html`<span class="brand-mark" aria-hidden="true"></span><span class="brand-name">swg<span>Panel</span></span>`;

// ───────────────────────── auth: login page + logout ─────────────────────────
let _loginShown = false;
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
  const [relink, setRelink] = useState(null);   // set to the NEW panel password when the vault needs reconnecting first
  const focusRef = useRef(null);
  useEffect(() => { if (!isMobile() && focusRef.current) focusRef.current.focus(); }, []);   // a phone: no keyboard until a tap
  const submit = async e => {
    if (e) e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await api.login({ username: u, password: p });
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
      setErr(srvText(r) || T("Login failed.")); setBusy(false);
    } catch (_) { setErr(T("Couldn't reach the panel.")); setBusy(false); }
  };
  if (relink) return html`<${VaultRelinkCard} panelPw=${relink} onDone=${() => location.reload()}/>`;
  return html`<div class="login-wrap"><form class="login-card" onSubmit=${submit}>
    <div class="login-brand">${brandMark()}</div>
    <h2>${T("Sign in")}</h2>
      <div class="field"><label>${T("Username")}</label><input ref=${focusRef} value=${u} onInput=${e => setU(e.target.value)} autocomplete="username"/></div>
      <div class="field"><label>${T("Password")}</label><input type="password" value=${p} onInput=${e => setP(e.target.value)} autocomplete="current-password"/></div>
      ${err ? html`<div class="formmsg err">${err}</div>` : null}
      <button class="btn btn-primary" type="submit" disabled=${busy} style="width:100%;justify-content:center;margin-top:4px">${busy ? T("Signing in…") : T("button|Sign in")}</button>
  </form></div>`;
}
function setUiMode(m) { try { localStorage.setItem("swg-ui", m); } catch (_) {} location.reload(); }
const LOGOUT_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M15 17l5-5-5-5M20 12H9M11 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/></svg>`;
const DESKTOP_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
function MoreSheet() {
  useStore();
  const [, force] = useState(0);
  const go = (fn) => () => { closeModal(); fn(); };
  const v = Store.versions || {};
  const env = Store.env || {};
  const kind = !("docker" in env) ? "" : env.docker ? (env.runtime === "podman" ? T("kind|podman") : T("kind|docker")) : T("kind|bare-metal");
  const tm = themeMode();
  const item = (icon, label, onClick, value, cls) => html`<button class=${"msheet-it" + (cls ? " " + cls : "")} onClick=${onClick}>
    <span class="ic" dangerouslySetInnerHTML=${{ __html: icon }}></span><span class="msheet-l">${label}</span>${value ? html`<span class="msheet-v">${value}</span>` : null}</button>`;
  // its title is the app bar's own mark, as in the header (operator, 2026-10-31); a screen reader still hears "More"
  return html`<${Sheet} title=${html`<span class="m-brand" role="img" aria-label=${T("More")}>${brandMark()}</span>`} noGuard=${true}>
    <div class="msheet">
      <div class="msheet-g">
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
        <div class="msheet-verl"><b>${v.panel}</b>${kind ? html`<span>${kind}</span>` : null}</div>
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
  try { await Store.init(); }
  catch (e) { if (!_loginShown) viewEl.innerHTML = `<div class="empty"><b>${esc(T("Can't reach the panel"))}</b>${esc(e.message)}</div>`; return; }
  if (!location.hash) location.hash = "#/";
  // landed here right after a confirm (we reloaded to pick up the carried session) → open the settings screen
  // straight on Access & TLS, BEFORE it mounts and defaults to Display. (The outcome modal is shown by App.)
  render(h(App), viewEl);
  if (isMobile()) { attachTitleTaps(); attachOutsideTapGuard(); attachSwipePeek(); attachTypingHold(); attachBubbleSwipe(); attachToastSwipe(); attachBackCloses(); attachViewportVars(); }   // a phone: a title= on a tap (hook 5); a tap outside a list only closes it
  window.__swgBooted = true;
  try { if (sessionStorage.getItem("__vault_reconnected")) { sessionStorage.removeItem("__vault_reconnected"); setTimeout(() => toast(T("Encryption Vault reconnected."), "ok"), 400); } } catch (_) {}
  try { if (sessionStorage.getItem("__vault_show_key")) { sessionStorage.removeItem("__vault_show_key"); setTimeout(() => openModal(html`<${VaultKeySheet}/>`), 500); } } catch (_) {}
})();

