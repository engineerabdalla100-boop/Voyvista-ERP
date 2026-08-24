/**
 * permissions.js — client/modules/accounts/ (نظام الصلاحيات المركزي)
 * -----------------------------------------------------------------------
 * Single source of truth for "can this user do this action" across the
 * whole Accounting module. Replaces change_requests.js's own hardcoded
 * APPROVER_ROLES list with a real Role → Permission mapping, so a role
 * name is never checked directly anywhere except HERE.
 *
 * Must load BEFORE change_requests.js and manager_override.js — both
 * call into window.VVPermissions.
 *
 * Permission naming convention: "<module>.<action>" — matches the exact
 * `module` and `changeType` strings already used throughout the project
 * as request.module / request.changeType (chart_of_accounts, party,
 * journal_entries, vouchers, custody, expenses, treasury,
 * customer_ledger), discovered by reading every Apply Handler already
 * registered rather than invented fresh.
 *
 * Special case — treasury: every treasury Change Request currently uses
 * ONE generic changeType, "financial_op" (deposit/withdraw/transfer/
 * add_bank all share it), with the real operation living in
 * request.payload.type. permissionForAction() below resolves this so the
 * granular permissions requested (treasury.deposit, treasury.withdraw,
 * treasury.transfer, treasury.add_bank) are meaningful — the underlying
 * request.changeType itself is deliberately left unchanged, matching
 * "لا نغيّر الـContracts الموجودة".
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------
  // Role → Permission map. "*" means every accounting permission.
  // "<module>.*" means every action within that one module.
  // An explicit "<module>.<action>" entry is the most granular form.
  //
  // employee / accountant: zero direct-execute permissions — every
  // accounting action they take becomes a Pending Change Request,
  // exactly like today's behavior for anyone who isn't Owner/IT.
  // accountant_full: full accounting permissions, direct execution,
  // still fully audited (see manager_override.js).
  // owner / it_manager / it_admin: unchanged from today — full access.
  // -------------------------------------------------------------------
  const ROLE_PERMISSIONS = {
    employee: [],
    supervisor: [],
    accountant: [],
    accountant_full: ["*"],
    manager: ["*"],
    owner: ["*"],
    it_manager: ["*"],
    it_admin: ["*"],
  };

  const ACCOUNTING_MODULES = [
    "chart_of_accounts", "party", "journal_entries",
    "vouchers", "custody", "expenses", "treasury", "customer_ledger",
  ];

  /**
   * Resolves a Change Request's (module, changeType, payload) into the
   * single canonical permission string it actually represents. Only
   * treasury needs the payload — every other module's changeType IS the
   * action already.
   */
  function permissionForAction({ module, changeType, payload }) {
    if (module === "treasury" && changeType === "financial_op" && payload && payload.type) {
      return `${module}.${payload.type}`; // deposit | withdraw | transfer | add_bank
    }
    return `${module}.${changeType}`;
  }

  /**
   * The single check every gate in the system calls. `permission` is a
   * pre-resolved "<module>.<action>" string (from permissionForAction).
   */
  function can(user, permission) {
    if (!user || !user.role) return false;
    if (!permission || typeof permission !== "string" || !permission.includes(".")) {
      console.error(`VVPermissions.can(): malformed permission string "${permission}".`);
      return false;
    }
    const perms = ROLE_PERMISSIONS[user.role];
    if (!perms) return false; // unknown role — fail closed, never fail open
    if (perms.includes("*")) return true;

    const [module] = permission.split(".");
    if (perms.includes(`${module}.*`)) return true;
    return perms.includes(permission);
  }

  window.VVPermissions = {
    ROLE_PERMISSIONS,
    ACCOUNTING_MODULES,
    permissionForAction,
    can,
  };
})();