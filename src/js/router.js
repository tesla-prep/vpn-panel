export function go(hash) { location.hash = hash; }

export function matchRoute(routes, hash) {
  const path = (hash || "#/").replace(/^#/, "") || "/";
  for (const r of routes) { const m = path.match(r.re); if (m) { const params = {}; (r.keys || []).forEach((k, i) => params[k] = m[i + 1]); return { route: r, params }; } }
  return { route: routes[0], params: {} };
}

let _unsavedGuard = null, _prevHash = location.hash || "#/";

import { T } from "./i18n.js";

export const LEAVE_MSG = () => T("You have unsaved changes that will be lost. Leave without saving?");

export const setUnsavedGuard = fn => { _unsavedGuard = fn; };
export const clearUnsavedGuard = () => { _unsavedGuard = null; };

export function confirmLeave(nextHash) {
  if (_unsavedGuard && nextHash !== _prevHash && _unsavedGuard() && !confirm(LEAVE_MSG())) {
    history.replaceState(null, "", _prevHash); return false;
  }
  _unsavedGuard = null; _prevHash = nextHash;
  return true;
}
