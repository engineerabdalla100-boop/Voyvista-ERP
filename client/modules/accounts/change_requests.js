/**
 * change_requests.js — client/modules/accounts/ (نظام Maker-Checker)
 * -----------------------------------------------------------------------
 * A self-contained Pending Change Request queue. Built independently
 * rather than assuming anything about manager_override.js's internals
 * (never inspected) — this file owns the full request lifecycle (create,
 * list, approve, reject, audit trail) on its own, and separately calls
 * `window.ManagerOverride.requestApproval()` as an *additional* passcode
 * gate at the moment of Approve/Reject, using the exact same interface
 * already proven working in journal_entries.js. Two independent, simple
 * pieces instead of one fragile assumption.
 *
 * Maker-Checker principle: a regular accountant (Maker) creating or
 * editing a Chart of Accounts entry never touches vv_chart_of_accounts
 * directly — every add/edit/deactivate becomes a Pending request here.
 * Only once an Owner/IT reviewer (Checker) approves does this file apply
 * the change to the real store. Nothing else in the app needs to know
 * this queue exists except the small "apply" callback each module
 * registers for its own request types.
 *
 * Data store: vv_change_requests — [{
 *   id, module, changeType ("create"|"edit"|"deactivate"|"delete"),
 *   targetId, targetLabel, payload, fieldChanges: [{field, oldValue, newValue}],
 *   requestedBy, requestedAt,
 *   status ("pending"|"approved"|"rejected"|"apply_failed"),
 *   reviewedBy, reviewedAt, rejectionReason,
 *   applyFailureReason
 * }]
 *
 * status = "apply_failed" is distinct from "approved": it means a human
 * Checker genuinely approved the request (reviewedBy/reviewedAt are set,
 * same as "approved"), but the registered Apply Handler's own apply-time
 * validation then refused to write the change — e.g. the target account
 * grew real movements, lost its chosen parent, or its code got taken by
 * another account in the gap between submission and approval. The
 * Approval Decision and the Application Result are two separate facts;
 * "approved" must never be true while the underlying data was never
 * actually written. applyFailureReason holds the human-readable reason
 * in that case, and is null whenever status is anything else.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  // Fully self-contained on purpose — this file is now loaded from
  // owner.html and it_dashboard.html too, neither of which loads
  // accounts_core.js. A tiny local CORE avoids pulling in the whole
  // Accounts module's SPA switcher just for two storage helpers.
  const CORE = {
    todayISO() {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    readStore(key, fallback) {
      try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
    },
    writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); },
  };

  function readRequests() { return CORE.readStore("vv_change_requests", []); }
  function writeRequests(rows) { CORE.writeStore("vv_change_requests", rows); }

  // Each module (chart_of_accounts.js, later journal_entries.js etc.)
  // registers how to actually APPLY an approved request to its own store —
  // this file never needs to know the shape of every module's data.
  const applyHandlers = {};
  function registerApplyHandler(moduleName, handlerFn) { applyHandlers[moduleName] = handlerFn; }

  // Date.now() alone has millisecond precision — two requests created in
  // quick synchronous succession (confirmed directly: two consecutive
  // Date.now() calls can return the identical value) would otherwise
  // collide and silently overwrite one another's identity. A random
  // suffix makes an actual collision astronomically unlikely.
  function generateRequestId() {
    return `cr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Contract between change_requests.js and every module's Apply Handler:
   * the handler returns { success: true } once it has actually written
   * the change, or { success: false, reason: "..." } if apply-time
   * validation refused it — in which case NOTHING was written. This is
   * the one place that turns that result into the request's real status,
   * so "approved" can never again mean "we clicked approve" when it
   * actually means "we clicked approve, but nothing happened."
   *
   * Backward compatibility: a handler written before this contract
   * existed returns `undefined` (it just ran, with no return value) —
   * there is no way to retroactively know whether an old-style handler
   * that predates this contract "meant" success or failure, since it was
   * never asked. Treating `undefined` as success preserves prior
   * behavior for any such handler rather than silently breaking it; this
   * is a deliberate, documented default, not a fallback that hides a
   * real failure — a handler written against the new contract must
   * always return an explicit object, and every currently-registered
   * handler (chart_of_accounts) already does.
   */
  function applyResultFor(handler, request) {
    const result = handler(request);
    if (result === undefined) return { success: true }; // legacy handler, no return value — see note above
    return result;
  }

  function stampApplyOutcome(request, result, reviewerLabel, reviewedAt) {
    request.reviewedBy = reviewerLabel;
    request.reviewedAt = reviewedAt;
    if (result.success) {
      request.status = "approved";
      request.applyFailureReason = null;
    } else {
      // Reviewed and genuinely approved as a DECISION — it's the
      // downstream write that failed, not the approval itself. Keeping
      // these as two separate facts (who approved it + why the write
      // didn't happen) is exactly what an accurate audit trail needs.
      request.status = "apply_failed";
      request.applyFailureReason = result.reason || "سبب غير محدد.";
    }
  }

  function currentUserName() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const user = window.VVAuth.getCurrentUser();
      if (user && user.full_name) return user.full_name;
    }
    return "Demo User";
  }

  /**
   * Permission-based replacement for the old hardcoded APPROVER_ROLES
   * list. A role name is never checked directly here anymore — this
   * defers entirely to window.VVPermissions, the single source of truth
   * (permissions.js). If that file isn't loaded, this fails CLOSED
   * (returns false → the request queues as Pending like anyone else's)
   * rather than silently granting access.
   */
  function canDirectExecute(module, changeType, payload) {
    if (!window.VVAuth || typeof window.VVAuth.getCurrentUser !== "function") return false;
    const user = window.VVAuth.getCurrentUser();
    if (!window.VVPermissions) {
      console.error("change_requests.js: VVPermissions not loaded — falling back to Pending for safety.");
      return false;
    }
    const permission = window.VVPermissions.permissionForAction({ module, changeType, payload });
    return window.VVPermissions.can(user, permission);
  }

  function requestManagerGate(actionDetails) {
    if (window.ManagerOverride && typeof window.ManagerOverride.requestApproval === "function") {
      return Promise.resolve(window.ManagerOverride.requestApproval(actionDetails));
    }
    console.error("change_requests.js: ManagerOverride service not found — cannot gate this approval.");
    alert("تعذّر التحقق من صلاحية المدير (الخدمة غير متاحة) — لا يمكن المتابعة.");
    return Promise.resolve(false);
  }

  /**
   * Creates a new request. If the person making the change holds a
   * permission that allows direct execution of THIS specific action
   * (see permissions.js — could be Owner/IT as before, or now also
   * accountant_full for accounting-only actions), there is no one else
   * required to approve it — routing it through Pending and then having
   * them approve their own request is pointless ceremony. They get full,
   * immediate access: this applies the change right away via the same
   * handler an approval would use, and logs it straight into history as
   * self-executed so the audit trail still shows exactly who did what,
   * when, and under which permission — nothing is hidden, it's just not
   * gated behind a second click from the same person.
   * Everyone else (Maker) still goes through the full Pending → Approve
   * cycle exactly as before.
   */
  function createRequest({ module, changeType, targetId, targetLabel, payload, fieldChanges }) {
    const rows = readRequests();
    const request = {
      id: generateRequestId(),
      module, changeType, targetId, targetLabel,
      payload: payload || null,
      fieldChanges: fieldChanges || [],
      requestedBy: currentUserName(),
      requestedAt: `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      applyFailureReason: null,
    };

    if (canDirectExecute(module, changeType, payload)) {
      const handler = applyHandlers[module];
      if (typeof handler === "function") {
        const result = applyResultFor(handler, request);
        stampApplyOutcome(request, result, `${currentUserName()} (self — permitted)`, request.requestedAt);
      } else {
        console.error(`change_requests.js: no apply handler registered for module "${module}" — falling back to Pending.`);
      }
    }

    rows.push(request);
    writeRequests(rows);
    return request;
  }

  function getPending() { return readRequests().filter((r) => r.status === "pending"); }
  function getAll() { return readRequests(); }

  /**
   * Approve — gated behind ManagerOverride's passcode check. Only once
   * that resolves true does this call the registered module handler to
   * actually apply the change. The request's final status now reflects
   * what the handler actually reports, not just the fact that Approve
   * was clicked — see applyResultFor()/stampApplyOutcome() above.
   */
  function approve(requestId, onDone) {
    const rows = readRequests();
    const request = rows.find((r) => r.id === requestId);
    if (!request || request.status !== "pending") return;

    requestManagerGate({
      action: "approve_change_request",
      module: request.module,
      changeType: request.changeType,
      target: request.targetLabel,
      payload: request.payload,
      description: `طلب اعتماد تعديل على "${request.targetLabel}" (${request.changeType})`,
    }).then((approved) => {
      if (!approved) {
        alert("لم تتم الموافقة من قبل المدير — تم إلغاء الاعتماد.");
        if (onDone) onDone(false);
        return;
      }

      // Double-approval protection: the ManagerOverride gate is async, so
      // real time passes between the "still pending" check above and this
      // point — another tab/session could have already approved or
      // rejected this exact request in the meantime. Re-read fresh from
      // storage and confirm it is STILL pending before touching anything;
      // if not, abort cleanly rather than applying (or re-applying) a
      // request that was already resolved elsewhere.
      const freshRequestPreApply = readRequests().find((r) => r.id === requestId);
      if (!freshRequestPreApply || freshRequestPreApply.status !== "pending") {
        alert("تعذّر إتمام الاعتماد — حالة الطلب تغيّرت في هذه الأثناء (تمت مراجعته بالفعل من مكان آخر).");
        if (onDone) onDone(false);
        return;
      }

      const handler = applyHandlers[freshRequestPreApply.module];
      if (typeof handler !== "function") {
        console.error(`change_requests.js: no apply handler registered for module "${freshRequestPreApply.module}"`);
        alert("تعذّر تطبيق التعديل — الوحدة المطلوبة غير مسجّلة.");
        if (onDone) onDone(false);
        return;
      }

      const result = applyResultFor(handler, freshRequestPreApply);

      const freshRows = readRequests();
      const idx = freshRows.findIndex((r) => r.id === requestId);
      if (idx !== -1) {
        stampApplyOutcome(freshRows[idx], result, currentUserName(), `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`);
        writeRequests(freshRows);
      }

      if (!result.success) {
        alert(`تمت الموافقة، لكن تعذّر تطبيق التغيير فعليًا على "${freshRequestPreApply.targetLabel}":\n${result.reason}\n\nالطلب مسجّل بحالة "تعذّر التطبيق" ويحتاج مراجعة يدوية.`);
      }
      if (onDone) onDone(result.success);
    });
  }

  /**
   * Reject — now gated behind the same ManagerOverride passcode check as
   * Approve, for the same reason: rejecting a request is itself a real
   * decision on someone else's work and shouldn't be a single unguarded
   * click. Same double-approval-style race protection applies here too,
   * since the gate is equally async.
   */
  function reject(requestId, onDone) {
    const rows = readRequests();
    const request = rows.find((r) => r.id === requestId);
    if (!request || request.status !== "pending") return;

    requestManagerGate({
      action: "reject_change_request",
      module: request.module,
      changeType: request.changeType,
      target: request.targetLabel,
      payload: request.payload,
      description: `طلب رفض تعديل على "${request.targetLabel}" (${request.changeType})`,
    }).then((approved) => {
      if (!approved) {
        alert("لم تتم الموافقة من قبل المدير — تم إلغاء عملية الرفض.");
        if (onDone) onDone(false);
        return;
      }

      const freshRequestPreReject = readRequests().find((r) => r.id === requestId);
      if (!freshRequestPreReject || freshRequestPreReject.status !== "pending") {
        alert("تعذّر إتمام الرفض — حالة الطلب تغيّرت في هذه الأثناء (تمت مراجعته بالفعل من مكان آخر).");
        if (onDone) onDone(false);
        return;
      }

      const reason = prompt("سبب الرفض (إجباري):", "");
      if (reason === null || !reason.trim()) {
        alert("سبب الرفض مطلوب — تم إلغاء العملية.");
        if (onDone) onDone(false);
        return;
      }

      // Re-check once more: the prompt() dialog is itself a blocking wait
      // for human input, another real window during which the request
      // could have been resolved elsewhere.
      const freshRows = readRequests();
      const idx = freshRows.findIndex((r) => r.id === requestId);
      if (idx === -1 || freshRows[idx].status !== "pending") {
        alert("تعذّر إتمام الرفض — حالة الطلب تغيّرت في هذه الأثناء (تمت مراجعته بالفعل من مكان آخر).");
        if (onDone) onDone(false);
        return;
      }

      freshRows[idx].status = "rejected";
      freshRows[idx].reviewedBy = currentUserName();
      freshRows[idx].reviewedAt = `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`;
      freshRows[idx].rejectionReason = reason.trim();
      writeRequests(freshRows);
      if (onDone) onDone(true);
    });
  }

  window.VVChangeRequests = {
    registerApplyHandler,
    createRequest,
    getPending,
    getAll,
    approve,
    reject,
  };
})();