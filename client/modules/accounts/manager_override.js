/**
 * manager_override.js — client/modules/accounts/ (بوابة الصلاحيات)
 * -----------------------------------------------------------------------
 * This is a real Authorization Gate, not "if user.role === 'owner'" and
 * not a Master Key that grants any user unconditional access. Its one
 * job: given an action someone is trying to approve/reject, check
 * whether the CURRENT logged-in user actually holds the permission that
 * action requires — via window.VVPermissions, the single source of
 * truth for who can do what — and log every check, allowed or denied,
 * to an independent audit trail that nothing else in the app can edit
 * or delete.
 *
 * change_requests.js calls window.ManagerOverride.requestApproval(...)
 * at the moment a Checker clicks Approve or Reject on someone else's
 * pending request. It is NOT called for self-execution (an
 * accountant_full or Owner acting on their own request) — that path is
 * gated separately, directly by change_requests.js's own permission
 * check at request-creation time (see canDirectExecute() there). This
 * file only ever gates the "someone else is reviewing this" moment.
 *
 * Depends on: window.VVAuth (auth.js), window.VVPermissions
 * (permissions.js — MUST load before this file).
 *
 * Data store: vv_manager_override_log — [{
 *   id, timestamp, user, role, action, module, changeType, target,
 *   permission, allowed
 * }]
 * Append-only. Nothing in this project reads this log back for editing
 * or deletion — it exists purely as an independent record of every
 * authorization decision made here, separate from vv_change_requests
 * itself (which records the Maker/Checker decision, not the permission
 * check that gated it).
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function currentUser() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      return window.VVAuth.getCurrentUser();
    }
    return null;
  }

  function logDecision(entry) {
    try {
      const key = "vv_manager_override_log";
      const raw = localStorage.getItem(key);
      const rows = raw ? JSON.parse(raw) : [];
      rows.push(entry);
      localStorage.setItem(key, JSON.stringify(rows));
    } catch (e) {
      console.error("manager_override.js: failed to write audit log entry.", e);
    }
  }

  /**
   * actionDetails shape (as constructed by change_requests.js):
   *   { action, module, changeType, target, payload, description }
   * `payload` is required specifically for treasury's generic
   * "financial_op" changeType, which needs payload.type to resolve to
   * the real permission (treasury.deposit / .withdraw / .transfer /
   * .add_bank) — see permissions.js's permissionForAction().
   */
  function requestApproval(actionDetails) {
    const user = currentUser();
    const timestamp = new Date().toISOString();

    if (!user) {
      console.error("manager_override.js: no current user — denying.");
      return false;
    }
    if (!window.VVPermissions) {
      console.error("manager_override.js: VVPermissions not loaded — denying (fail closed, never fail open).");
      return false;
    }

    const permission = window.VVPermissions.permissionForAction({
      module: actionDetails.module,
      changeType: actionDetails.changeType,
      payload: actionDetails.payload,
    });
    const allowed = window.VVPermissions.can(user, permission);

    logDecision({
      id: `mo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      user: user.full_name,
      role: user.role,
      action: actionDetails.action || null,
      module: actionDetails.module || null,
      changeType: actionDetails.changeType || null,
      target: actionDetails.target || null,
      permission,
      allowed,
    });

    return allowed;
  }

  function getLog() {
    try {
      return JSON.parse(localStorage.getItem("vv_manager_override_log")) || [];
    } catch (e) {
      return [];
    }
  }

  window.ManagerOverride = { requestApproval, getLog };
})();