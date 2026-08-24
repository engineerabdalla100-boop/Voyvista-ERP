/**
 * party_core.js — client/modules/accounts/ (PART 1B — Party Core + Account Link)
 * -----------------------------------------------------------------------
 * A Party is the real-world entity (a company or an individual) that the
 * business deals with financially — distinct from an Account (the
 * accounting node inside vv_chart_of_accounts a ledger balance lives on).
 * TRIANGLE the company is a Party; "1210 — TRIANGLE" is the Account it
 * happens to be linked to. They are never the same object, and the link
 * between them is a single ID reference (Party.accountId → Account.id),
 * never a name string — renaming either side later never breaks the
 * relationship.
 *
 * This intentionally does NOT reuse the older vv_acc_customers /
 * vv_acc_party_meta stores from accounting-engine.js: those are keyed by
 * NAME STRING (not ID) and have no concept of a Chart-of-Accounts link at
 * all — they're a separate, pre-existing ledger system serving a
 * different purpose. vv_parties is a new, genuinely distinct store; nothing
 * existing already does what this does.
 *
 * Data store: vv_parties — [{
 *   id, type ("company"|"individual"), displayName, status ("active"|"inactive"),
 *   accountId (Account.id or null), createdAt, updatedAt
 * }]
 *
 * Cardinality (deliberately simple until a real business reason demands
 * more): one Party links to at most one Account, and one Account is
 * linked from at most one Party. To change a Party's linked Account,
 * Unlink first, then Link again — no implicit re-linking — so the
 * operation is always unambiguous and atomic.
 *
 * No company-profile data (phone, tax ID, contact person...) lives here
 * yet — that's explicitly PART 1C. This file only proves the id-based
 * relationship works safely.
 *
 * Approval: every write (create / link / unlink) goes through the exact
 * same window.VVChangeRequests engine chart_of_accounts.js already uses —
 * same Maker-Checker cycle, same self-approver bypass for Owner/IT, same
 * { success, reason } Apply Handler contract, same approval-gap
 * re-validation at apply time. No second approval engine.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;

  function readParties() { return CORE.readStore("vv_parties", []); }
  function writeParties(parties) { CORE.writeStore("vv_parties", parties); }
  function readAccounts() { return CORE.readStore("vv_chart_of_accounts", []); }

  const VALID_TYPES = ["company", "individual"];
  const VALID_STATUSES = ["active", "inactive"];
  const TYPE_LABELS = { company: "شركة", individual: "فرد" };

  // =========================================================================
  // Validation — mirrors PART 1A's two-layer pattern exactly: block bad
  // requests up front (createPartyRequest/createLinkRequest/...), AND
  // re-check everything again inside the Apply Handler, since the world
  // can change in the gap between a Maker submitting and a Checker
  // approving (the exact gap PART 1A's patch closed for accounts).
  // =========================================================================

  function validatePartyPayload(payload) {
    if (!payload || !payload.displayName || !payload.displayName.trim()) {
      return "اسم الجهة مطلوب.";
    }
    if (!VALID_TYPES.includes(payload.type)) {
      return `نوع الجهة يجب أن يكون "company" أو "individual".`;
    }
    if (payload.status && !VALID_STATUSES.includes(payload.status)) {
      return `حالة الجهة غير صالحة.`;
    }
    return null;
  }

  function validateLink(parties, accounts, partyId, accountId) {
    const party = parties.find((p) => p.id === partyId);
    if (!party) return "الجهة (Party) لم تعد موجودة.";
    if (!accountId) return "معرف الحساب المطلوب ربطه غير صالح.";
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return "الحساب المحاسبي المطلوب الربط به لم يعد موجودًا.";
    if (account.status === "inactive") return `الحساب "${account.name}" غير نشط — لا يمكن الربط به.`;
    if (party.accountId) return `الجهة "${party.displayName}" مرتبطة بالفعل بحساب آخر — يجب إلغاء الربط أولًا.`;
    const alreadyTaken = parties.some((p) => p.id !== partyId && p.accountId === accountId);
    if (alreadyTaken) return `هذا الحساب مرتبط بالفعل بجهة أخرى.`;
    return null;
  }

  function validateUnlink(parties, partyId) {
    const party = parties.find((p) => p.id === partyId);
    if (!party) return "الجهة (Party) لم تعد موجودة.";
    if (!party.accountId) return `الجهة "${party.displayName}" غير مرتبطة بأي حساب أصلًا.`;
    return null;
  }

  // =========================================================================
  // Public read API
  // =========================================================================

  function getAll() { return readParties(); }
  function getById(id) { return readParties().find((p) => p.id === id) || null; }
  function getActive() { return readParties().filter((p) => p.status === "active"); }
  function getLinkedPartyForAccount(accountId) {
    return readParties().find((p) => p.accountId === accountId) || null;
  }

  // =========================================================================
  // Public write API — every write is a Change Request, never a direct
  // write to vv_parties. Blocks obviously-invalid input immediately
  // (before a request is even created) with the same alert-and-refuse
  // pattern chart_of_accounts.js already uses.
  // =========================================================================

  function createPartyRequest({ type, displayName, status }) {
    const payload = { type, displayName: (displayName || "").trim(), status: status || "active", accountId: null };
    const error = validatePartyPayload(payload);
    if (error) { alert(error); return null; }
    return window.VVChangeRequests.createRequest({
      module: "party", changeType: "create", targetId: null,
      targetLabel: payload.displayName, payload,
    });
  }

  function createLinkRequest(partyId, accountId) {
    const parties = readParties();
    const accounts = readAccounts();
    const error = validateLink(parties, accounts, partyId, accountId);
    if (error) { alert(error); return null; }
    const party = parties.find((p) => p.id === partyId);
    return window.VVChangeRequests.createRequest({
      module: "party", changeType: "link", targetId: partyId,
      targetLabel: party.displayName, payload: { accountId },
    });
  }

  function createUnlinkRequest(partyId) {
    const parties = readParties();
    const error = validateUnlink(parties, partyId);
    if (error) { alert(error); return null; }
    const party = parties.find((p) => p.id === partyId);
    return window.VVChangeRequests.createRequest({
      module: "party", changeType: "unlink", targetId: partyId,
      targetLabel: party.displayName, payload: { accountId: null },
    });
  }

  // =========================================================================
  // Apply Handler — registered with the shared change_requests.js engine.
  // Every branch re-validates from scratch against CURRENT data (never
  // trusts what was true at request-submission time — this is PART 1A's
  // approval-gap fix, applied identically here), and either writes
  // everything or writes nothing. No partial apply, ever.
  // =========================================================================

  // Bug found during this part's own testing: Date.now() alone has
  // millisecond precision, and two Party creations in quick synchronous
  // succession can genuinely return the identical timestamp (confirmed
  // directly — two consecutive Date.now() calls returned the same value
  // in testing). A random suffix makes an actual collision astronomically
  // unlikely without changing how IDs are read anywhere else. Kept local
  // to this new file only — PART 1A's own `coa_${Date.now()}` /
  // `cr_${Date.now()}` generators carry the same theoretical risk, but
  // touching those would mean reopening a part that already passed Final
  // Verification, which is explicitly out of scope here.
  function generatePartyId() {
    return `party_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("party", (request) => {
      if (window.VVPermissions && window.VVAuth) {
        const actingUser = window.VVAuth.getCurrentUser();
        const requiredPermission = window.VVPermissions.permissionForAction({ module: "party", changeType: request.changeType, payload: request.payload });
        if (!window.VVPermissions.can(actingUser, requiredPermission)) {
          return { success: false, reason: "ليس لديك الصلاحية الكافية لتنفيذ هذه العملية." };
        }
      }

      const parties = readParties();
      const accounts = readAccounts();
      const now = `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`;

      if (request.changeType === "create") {
        const error = validatePartyPayload(request.payload);
        if (error) return { success: false, reason: error };
        parties.push({
          id: generatePartyId(),
          type: request.payload.type,
          displayName: request.payload.displayName,
          status: request.payload.status || "active",
          accountId: null,
          createdAt: now,
          updatedAt: now,
        });
        writeParties(parties);
        return { success: true };
      }

      if (request.changeType === "link") {
        const error = validateLink(parties, accounts, request.targetId, request.payload.accountId);
        if (error) return { success: false, reason: error };
        const idx = parties.findIndex((p) => p.id === request.targetId);
        parties[idx] = { ...parties[idx], accountId: request.payload.accountId, updatedAt: now };
        writeParties(parties);
        return { success: true };
      }

      if (request.changeType === "unlink") {
        const error = validateUnlink(parties, request.targetId);
        if (error) return { success: false, reason: error };
        const idx = parties.findIndex((p) => p.id === request.targetId);
        parties[idx] = { ...parties[idx], accountId: null, updatedAt: now };
        writeParties(parties);
        return { success: true };
      }

      return { success: false, reason: `نوع طلب غير معروف للجهات: ${request.changeType}` };
    });
  }

  window.VVPartyCore = {
    getAll, getById, getActive, getLinkedPartyForAccount,
    createPartyRequest, createLinkRequest, createUnlinkRequest,
    TYPE_LABELS,
  };
})();