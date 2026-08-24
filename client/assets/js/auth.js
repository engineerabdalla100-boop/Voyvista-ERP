/**
 * auth.js — STUB, awaiting the real Django backend.
 * -----------------------------------------------------------------------
 * This is intentionally a no-op placeholder, not a real auth system.
 * It does NOT block access to any page and does NOT verify anything —
 * it only exists so pages that reference `/client/assets/js/auth.js` load
 * without a 404, and so the rest of the app has one place to call into
 * once real login/JWT handling exists.
 *
 * DO NOT treat anything in here as a security boundary. Route protection
 * (redirecting unauthenticated users, checking roles before rendering
 * owner/IT pages, etc.) must be enforced on the server once the Django
 * API is live — a client-side check alone can always be bypassed.
 *
 * When the backend is ready, this file should be rewritten to:
 *   - store/refresh the JWT access & refresh tokens (see config.js's
 *     STORAGE_KEYS.ACCESS_TOKEN / REFRESH_TOKEN, already reserved for this)
 *   - expose VVAuth.getCurrentUser() backed by a real /auth/me/ call
 *   - expose VVAuth.logout() that clears tokens and redirects to login
 * -----------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  function isLoggedIn() {
    // Placeholder only — always "true" until real tokens exist, so pages
    // keep working during this local-storage-only phase of the project.
    return true;
  }

  function getCurrentUser() {
    // Read directly from the same storage key components.js uses, instead
    // of relying on `global.VVComponents` — components.js declares
    // VVComponents as a top-level `const`, which never attaches to
    // `window`, so that check always silently failed and this function
    // was permanently stuck returning the hardcoded stub below no matter
    // what role was actually stored. This bypasses that entirely.
    try {
      const raw = localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* ignore parsing errors */
    }
    return { id: 0, full_name: "Demo User", role: "employee" };
  }

  function logout() {
    console.warn("VVAuth.logout() called, but no real session exists yet (auth.js is still a stub).");
  }

  global.VVAuth = { isLoggedIn, getCurrentUser, logout };
})(window);