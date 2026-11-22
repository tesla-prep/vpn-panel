export function go(hash) { location.hash = hash; }

export function matchRoute(routes, hash) {
  const path = (hash || "#/").replace(/^#/, "") || "/";
  for (const r of routes) { const m = path.match(r.re); if (m) { const params = {}; (r.keys || []).forEach((k, i) => params[k] = m[i + 1]); return { route: r, params }; } }
  return { route: routes[0], params: {} };
}

// a screen with unsaved edits registers () => true; the router confirms before navigating away
let _unsavedGuard = null, _prevHash = location.hash || "#/";

// One copy of the prompt: the hash router and the settings screen's own Back button must ask the SAME
// question, and it is one string to translate rather than two that can drift apart.
import { T } from "./i18n.js";

// A FUNCTION, not a const: a module-level T() runs at import time, which is before loadLang() has
// resolved, so the value would freeze as English for the life of the page.
export const LEAVE_MSG = () => T("You have unsaved changes that will be lost. Leave without saving?");

export const setUnsavedGuard = fn => { _unsavedGuard = fn; };
export const clearUnsavedGuard = () => { _unsavedGuard = null; };

/* Ask the registered guard whether we may leave for `nextHash`.
   false → the caller must NOT navigate (the URL has already been restored). true → guard cleared, proceed. */
export function confirmLeave(nextHash) {
  if (_unsavedGuard && nextHash !== _prevHash && _unsavedGuard() && !confirm(LEAVE_MSG())) {
    history.replaceState(null, "", _prevHash); return false;   // stay put — restore the URL without re-firing
  }
  _unsavedGuard = null; _prevHash = nextHash;
  return true;
}
