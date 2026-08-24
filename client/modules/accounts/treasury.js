/**
 * treasury.js — client/modules/accounts/ (الخزينة والبنوك)
 * -----------------------------------------------------------------------
 * Registers into VVAccountsModules.treasury and self-wires its own
 * trigger button (`[data-view="treasury"]` or `#qa-treasury`).
 *
 * Also exposes `window.VVTreasury` — the one shared place every other
 * money-touching module (vouchers.js, expenses.js, custody.js) reads and
 * adjusts Cash/Bank balances through. Its external surface
 * (getCash/getBanks/accountOptions/accountLabel/getBalance/adjustBalance)
 * is UNCHANGED from before this hardening pass — every other module
 * calls these exact same functions, the exact same way, so none of them
 * needed to change.
 *
 * Financial mutation — Deposit, Withdraw, Transfer, and Add Bank (which
 * sets a real opening balance, not just metadata) — happens ONLY from
 * the VVChangeRequests Apply Handler below, never directly from a
 * button. Treasury deliberately does NOT adopt the Draft->Submitted->
 * Approved->Posted workflow other modules use (an approved design
 * decision, not an oversight) — every operation here represents a
 * financial event being RECORDED as it happens, not an intention
 * awaiting business approval before it occurs. Instead: Maker submits →
 * VVChangeRequests → Apply Handler → validate → Intent Marker → mutate →
 * final state, exactly matching the shared architecture used everywhere
 * else in this Accounting module.
 *
 * Data stores:
 *   vv_treasury_cash          — { balance }
 *   vv_treasury_banks         — { [bankName]: balance }
 *   vv_treasury_transactions  — [{...}] — see the two record shapes below.
 *
 * IMPORTANT — two coexisting transaction record shapes in the SAME
 * array, on purpose (no data migration was run on real historical data):
 *
 *   LEGACY (anything created before this hardening pass):
 *     { id, date, type, fromAccount, toAccount, amount, reason,
 *       reference, createdAt }
 *     fromAccount/toAccount are already-formatted display strings (e.g.
 *     "بنك CIB"), not account ids. No `status` field — these happened
 *     directly and are treated as historical fact, always rendered as
 *     "posted". Never touched or rewritten by this file.
 *
 *   NEW (created by this hardening pass onward):
 *     { id, type, sourceAccountId, targetAccountId, amount, date,
 *       description, reference, status, requestedBy, approvedBy,
 *       changeRequestId, createdAt, postedAt, errorReason }
 *     type: "deposit" | "withdraw" | "transfer" | "add_bank"
 *     status: "pending" | "posted" | "stuck" | "failed"
 *       pending — record created, mutation not yet (confirmed) applied.
 *         If encountered on a later read (not the live execution that
 *         created it), this is ambiguous — was the mutation applied or
 *         not? Treated the same cautious way as "stuck": visible,
 *         blocked from auto-retry, needs manual review.
 *       posted  — mutation confirmed applied, final state.
 *       stuck   — TRANSFER ONLY: the source account was DEFINITELY
 *         debited (we wrote this marker right after that step,
 *         explicitly), but the target account had NOT yet been credited
 *         when this was last written. The single most dangerous state
 *         in this whole Accounting module — see the Apply Handler's
 *         "transfer" branch for exactly why.
 *       failed  — validation refused the operation BEFORE any balance
 *         mutation happened. Clean, safe, nothing to reconcile.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;

  function readCash() { return CORE.readStore("vv_treasury_cash", { balance: 0 }); }
  function writeCash(cash) { CORE.writeStore("vv_treasury_cash", cash); }
  function readBanks() { return CORE.readStore("vv_treasury_banks", { "البنك الأهلي": 0 }); }
  function writeBanks(banks) { CORE.writeStore("vv_treasury_banks", banks); }
  function readTransactions() { return CORE.readStore("vv_treasury_transactions", []); }
  function writeTransactions(txns) { CORE.writeStore("vv_treasury_transactions", txns); }

  function accountLabel(accountId) {
    if (accountId === "cash") return "الخزينة النقدية";
    if (accountId && accountId.startsWith("bank:")) return `بنك ${accountId.slice(5)}`;
    return accountId || "-";
  }

  function accountOptionsList() {
    const banks = readBanks();
    return [{ id: "cash", label: "الخزينة النقدية" }, ...Object.keys(banks).map((name) => ({ id: `bank:${name}`, label: `بنك ${name}` }))];
  }

  function getBalance(accountId) {
    if (accountId === "cash") return readCash().balance || 0;
    if (accountId && accountId.startsWith("bank:")) {
      const banks = readBanks();
      return banks[accountId.slice(5)] || 0;
    }
    return 0;
  }

  /**
   * UNCHANGED external contract — every other module calls this exact
   * function, the exact same way, and none of them check its return
   * value for success/failure (it's always just the new numeric
   * balance). This file's OWN internal Apply Handler treats it with the
   * exact same distrust every other caller already does — see the
   * Apply Handler below for why "does this account exist" is always
   * checked separately, BEFORE calling this, never inferred from it.
   */
  function adjustBalance(accountId, delta) {
    if (accountId === "cash") {
      const cash = readCash();
      cash.balance = Math.round((Number(cash.balance || 0) + delta) * 100) / 100;
      writeCash(cash);
      return cash.balance;
    }
    if (accountId && accountId.startsWith("bank:")) {
      const bankName = accountId.slice(5);
      const banks = readBanks();
      banks[bankName] = Math.round(((banks[bankName] || 0) + delta) * 100) / 100;
      writeBanks(banks);
      return banks[bankName];
    }
    console.error("VVTreasury.adjustBalance: unknown account id", accountId);
    return 0;
  }

  window.VVTreasury = {
    getCash: readCash,
    getBanks: readBanks,
    accountOptions: accountOptionsList,
    accountLabel,
    getBalance,
    adjustBalance,
  };

  // Date.now() alone has millisecond precision — collision-safe suffix,
  // matching the same pattern already established across this project.
  function generateTxnId() {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function currentUserName() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const u = window.VVAuth.getCurrentUser();
      if (u && u.full_name) return u.full_name;
    }
    return "Demo User";
  }

  // A transaction record is "legacy" if it predates this hardening pass
  // — identified by the absence of a `status` field (the new shape
  // always has one). Legacy records are read-only history, always shown
  // as posted, and never touched by anything below.
  function isLegacyTxn(t) { return t.status === undefined; }

  function needsReview(t) { return !isLegacyTxn(t) && (t.status === "pending" || t.status === "stuck" || t.status === "failed"); }

  // =========================================================================
  // Apply Handler — registered with the shared change_requests.js engine.
  // This is the ONLY place any of deposit/withdraw/transfer/add_bank ever
  // actually mutate a balance from this file.
  //
  // Atomicity note (honest, not a claim): vv_treasury_transactions,
  // vv_treasury_cash, and vv_treasury_banks are separate
  // localStorage.setItem() calls — there is no cross-key transaction in
  // Web Storage, so they can never be made truly atomic from this file,
  // or any file, alone. Transfer specifically requires TWO separate
  // balance mutations (debit source, credit target) with no atomic pair
  // possible between them — if a real interruption (crash/reload/tab-
  // kill) happens between those two writes, the money is, with total
  // honesty, unaccounted for until a human manually reconciles it. What
  // this DOES do: mark that exact moment explicitly (status "stuck",
  // with the source/target/amount recorded) so it's a visible, detailed,
  // blocked-from-auto-retry fact instead of a silent one.
  // =========================================================================

  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("treasury", (request) => {
      if (window.VVPermissions && window.VVAuth) {
        const actingUser = window.VVAuth.getCurrentUser();
        const requiredPermission = window.VVPermissions.permissionForAction({ module: "treasury", changeType: request.changeType, payload: request.payload });
        if (!window.VVPermissions.can(actingUser, requiredPermission)) {
          return { success: false, reason: "ليس لديك الصلاحية الكافية لتنفيذ هذه العملية." };
        }
      }

      // Re-invocation guard: if an earlier invocation of this SAME
      // request already created a transaction record (and was
      // interrupted before this handler could return a result to
      // change_requests.js — the only way approve() could call this
      // handler again for a request that's still "pending" in
      // vv_change_requests), refuse rather than risk a second mutation.
      const existingTxns = readTransactions();
      const existingTxn = existingTxns.find((t) => t.changeRequestId === request.id);
      if (existingTxn) {
        return { success: false, reason: `توجد عملية خزينة مسجّلة بالفعل لهذا الطلب بحالة "${existingTxn.status}" — على الأرجح انقطاع سابق لم يكتمل. تحتاج مراجعة يدوية، لا يمكن إعادة المحاولة تلقائيًا لتجنّب مضاعفة الأثر المالي.` };
      }

      const payload = request.payload || {};
      const { type, sourceAccountId, targetAccountId, amount, date, description, reference, bankName } = payload;

      if (!["deposit", "withdraw", "transfer", "add_bank"].includes(type)) {
        return { success: false, reason: `نوع عملية خزينة غير معروف: "${type}".` };
      }

      // Phase 1 — create the record BEFORE touching any balance. This is
      // the ONLY moment nothing financial has happened yet; every
      // subsequent write only ever adds more certainty, never less.
      const newTxn = {
        id: generateTxnId(),
        type,
        sourceAccountId: sourceAccountId || null,
        targetAccountId: targetAccountId || null,
        amount: Number(amount),
        date: date || CORE.todayISO(),
        description: description || "",
        reference: reference || "",
        status: "pending",
        requestedBy: request.requestedBy,
        approvedBy: null,
        changeRequestId: request.id,
        createdAt: `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`,
        postedAt: null,
        errorReason: null,
      };
      const txns1 = readTransactions();
      txns1.push(newTxn);
      writeTransactions(txns1);

      function fail(reason) {
        const revert = readTransactions();
        const idx = revert.findIndex((t) => t.id === newTxn.id);
        if (idx !== -1) { revert[idx].status = "failed"; revert[idx].errorReason = reason; writeTransactions(revert); }
        return { success: false, reason };
      }

      // Phase 2 — full re-validation, fresh, against CURRENT state (never
      // trusts anything about the request payload beyond raw values).
      const numAmount = Number(amount);
      if (!Number.isFinite(numAmount) || numAmount <= 0) return fail(`المبلغ غير صالح: "${amount}".`);
      if (!description || !String(description).trim()) return fail("البيان مطلوب.");

      const realAccountIds = accountOptionsList().map((o) => o.id);

      if (type === "deposit") {
        if (!targetAccountId || !realAccountIds.includes(targetAccountId)) return fail(`الحساب (${targetAccountId || "—"}) لم يعد موجودًا في الخزينة.`);
      } else if (type === "withdraw") {
        if (!sourceAccountId || !realAccountIds.includes(sourceAccountId)) return fail(`الحساب (${sourceAccountId || "—"}) لم يعد موجودًا في الخزينة.`);
        if (getBalance(sourceAccountId) < numAmount) return fail(`الرصيد غير كافٍ في "${accountLabel(sourceAccountId)}".`);
      } else if (type === "transfer") {
        if (!sourceAccountId || !realAccountIds.includes(sourceAccountId)) return fail(`حساب المصدر (${sourceAccountId || "—"}) لم يعد موجودًا في الخزينة.`);
        if (!targetAccountId || !realAccountIds.includes(targetAccountId)) return fail(`حساب الهدف (${targetAccountId || "—"}) لم يعد موجودًا في الخزينة.`);
        if (sourceAccountId === targetAccountId) return fail("لا يمكن التحويل من الحساب لنفسه.");
        if (getBalance(sourceAccountId) < numAmount) return fail(`الرصيد غير كافٍ في "${accountLabel(sourceAccountId)}".`);
      } else if (type === "add_bank") {
        if (!bankName || !String(bankName).trim()) return fail("اسم البنك مطلوب.");
        const banks = readBanks();
        if (banks[bankName] !== undefined) return fail(`يوجد بنك بنفس الاسم "${bankName}" بالفعل.`);
      }

      // Phase 3 — the actual mutation(s).
      if (type === "deposit") {
        adjustBalance(targetAccountId, numAmount);
      } else if (type === "withdraw") {
        adjustBalance(sourceAccountId, -numAmount);
      } else if (type === "transfer") {
        // Phase 3a — debit the source. The single riskiest write in this
        // entire Accounting module: from this exact instant until Phase
        // 3b completes, real money is "in flight" with no atomic pair
        // possible.
        adjustBalance(sourceAccountId, -numAmount);

        // Immediately mark this precise moment — if interrupted between
        // here and Phase 3b, "stuck" (not generic "pending") is written,
        // stating exactly what's known for certain: source WAS debited,
        // target was NOT yet credited.
        const midTxns = readTransactions();
        const midIdx = midTxns.findIndex((t) => t.id === newTxn.id);
        if (midIdx !== -1) {
          midTxns[midIdx].status = "stuck";
          midTxns[midIdx].errorReason = `تم خصم ${numAmount} من "${accountLabel(sourceAccountId)}"، ولم يتم تأكيد إضافتها إلى "${accountLabel(targetAccountId)}" بعد — يحتاج مراجعة يدوية فورية.`;
          writeTransactions(midTxns);
        }

        // Phase 3b — credit the target.
        adjustBalance(targetAccountId, numAmount);
      } else if (type === "add_bank") {
        const banks = readBanks();
        banks[bankName] = numAmount;
        writeBanks(banks);
      }

      // Phase 4 — only now, after every mutation is confirmed durable,
      // record the true final state.
      const finalTxns = readTransactions();
      const finalIdx = finalTxns.findIndex((t) => t.id === newTxn.id);
      if (finalIdx === -1) return { success: false, reason: "تم تنفيذ الأثر المالي لكن سجل العملية اختفى أثناء حفظ الحالة النهائية." };
      finalTxns[finalIdx].status = "posted";
      finalTxns[finalIdx].approvedBy = currentUserName();
      finalTxns[finalIdx].postedAt = `${CORE.todayISO()} ${new Date().toTimeString().slice(0, 5)}`;
      finalTxns[finalIdx].errorReason = null;
      writeTransactions(finalTxns);
      return { success: true };
    });
  }

  // =========================================================================
  // Change Request submission — no financial mutation happens in any of
  // these four functions. Each validates what it can up front (fast,
  // friendly rejection), then hands off entirely to VVChangeRequests.
  // =========================================================================

  function submitDeposit() {
    const account = document.getElementById("dep-account").value;
    const amount = Number(document.getElementById("dep-amount").value) || 0;
    const source = document.getElementById("dep-source").value.trim();
    const notice = document.getElementById("dep-notice").value.trim();
    const description = document.getElementById("dep-description").value.trim();

    if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }
    if (!source) { alert("المصدر مطلوب."); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "treasury",
      changeType: "financial_op",
      targetId: null,
      targetLabel: `إيداع ${CORE.formatMoney(amount)} — ${accountLabel(account)}`,
      payload: { type: "deposit", targetAccountId: account, amount, description: description || `إيداع من ${source}`, reference: notice, date: CORE.todayISO() },
    });

    if (request) {
      alert(request.status === "approved" ? `تم الإيداع فورًا.` : `تم إرسال طلب الإيداع — بانتظار الاعتماد.`);
      document.getElementById("dep-amount").value = "0";
      document.getElementById("dep-source").value = "";
      document.getElementById("dep-notice").value = "";
      document.getElementById("dep-description").value = "";
      renderCards();
      renderTransactionsTable();
      renderReviewPanel();
    }
  }

  function submitWithdraw() {
    const account = document.getElementById("wd-account").value;
    const amount = Number(document.getElementById("wd-amount").value) || 0;
    const recipient = document.getElementById("wd-recipient").value.trim();
    const reason = document.getElementById("wd-reason").value.trim();

    if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }
    if (!recipient) { alert("اسم المستلم مطلوب."); return; }
    if (getBalance(account) < amount) { alert(`الرصيد غير كافٍ في "${accountLabel(account)}" (فحص أولي — سيُعاد التحقق وقت الاعتماد).`); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "treasury",
      changeType: "financial_op",
      targetId: null,
      targetLabel: `سحب ${CORE.formatMoney(amount)} — ${accountLabel(account)}`,
      payload: { type: "withdraw", sourceAccountId: account, amount, description: reason || `سحب لـ ${recipient}`, reference: recipient, date: CORE.todayISO() },
    });

    if (request) {
      alert(request.status === "approved" ? `تم السحب فورًا.` : `تم إرسال طلب السحب — بانتظار الاعتماد.`);
      document.getElementById("wd-amount").value = "0";
      document.getElementById("wd-recipient").value = "";
      document.getElementById("wd-reason").value = "";
      renderCards();
      renderTransactionsTable();
      renderReviewPanel();
    }
  }

  function submitTransfer() {
    const from = document.getElementById("tr-from").value;
    const to = document.getElementById("tr-to").value;
    const amount = Number(document.getElementById("tr-amount").value) || 0;
    const reason = document.getElementById("tr-reason").value.trim();
    const reference = document.getElementById("tr-reference").value.trim();

    if (from === to) { alert("لا يمكن التحويل من الحساب لنفسه."); return; }
    if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }
    if (!reason) { alert("البيان/السبب مطلوب."); return; }
    if (getBalance(from) < amount) { alert(`الرصيد غير كافٍ في "${accountLabel(from)}" (فحص أولي — سيُعاد التحقق وقت الاعتماد).`); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "treasury",
      changeType: "financial_op",
      targetId: null,
      targetLabel: `تحويل ${CORE.formatMoney(amount)} — ${accountLabel(from)} ← ${accountLabel(to)}`,
      payload: { type: "transfer", sourceAccountId: from, targetAccountId: to, amount, description: reason, reference, date: document.getElementById("tr-date").value || CORE.todayISO() },
    });

    if (request) {
      alert(request.status === "approved" ? `تم التحويل فورًا.` : `تم إرسال طلب التحويل — بانتظار الاعتماد.`);
      document.getElementById("tr-amount").value = "0";
      document.getElementById("tr-reason").value = "";
      document.getElementById("tr-reference").value = "";
      renderCards();
      renderTransactionsTable();
      renderReviewPanel();
    }
  }

  function submitAddBank() {
    const name = document.getElementById("new-bank-name").value.trim();
    const openingBalance = Number(document.getElementById("new-bank-balance").value) || 0;
    if (!name) { alert("اسم البنك مطلوب."); return; }

    const banks = readBanks();
    if (banks[name] !== undefined) { alert(`يوجد بنك بنفس الاسم "${name}" بالفعل.`); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "treasury",
      changeType: "financial_op",
      targetId: null,
      targetLabel: `إضافة بنك: ${name} (رصيد افتتاحي ${CORE.formatMoney(openingBalance)})`,
      payload: { type: "add_bank", bankName: name, amount: openingBalance, description: `إنشاء حساب بنكي جديد — ${name}`, date: CORE.todayISO() },
    });

    if (request) {
      alert(request.status === "approved" ? `تم إنشاء بنك "${name}" فورًا.` : `تم إرسال طلب إنشاء بنك "${name}" — بانتظار الاعتماد.`);
      document.getElementById("new-bank-name").value = "";
      document.getElementById("new-bank-balance").value = "0";
      renderCards();
      renderFormPanel("transfer");
      document.querySelectorAll("[data-treasury-tab]").forEach((t) => t.classList.remove("is-active"));
      document.querySelector('[data-treasury-tab="transfer"]').classList.add("is-active");
      renderReviewPanel();
    }
  }

  // =========================================================================
  // Main render
  // =========================================================================

  // =========================================================================
  // EGP collections posting — reads real customer payments already
  // confirmed (cash/instapay/bank) on sales across Flights/Hotels/Visas,
  // and lets an accountant post them into the REAL Treasury as an actual
  // Deposit — going through the exact same VVChangeRequests engine, the
  // exact same permission gate, and the exact same Intent Marker pattern
  // every other financial mutation in this whole module already uses.
  // Only EGP ever reaches here — every other currency stays entirely in
  // Data's own Foreign Currency Wallet, deliberately never touching this
  // Treasury (see data.js), avoiding the currency-mixing problem this
  // whole system was built to prevent.
  //
  // Each sale gets a `postedToTreasury` flag once its collection has
  // been posted, so the exact same collection can never be posted twice
  // — and, matching the same principle used throughout this project,
  // nothing here ever deletes or rewrites the underlying sale record;
  // only that one flag gets set.
  // =========================================================================

  const EGP_SOURCE_STORES = [
    { key: "vv_sales_data", dept: "طيران", nameField: "passengerName" },
    { key: "vv_hotel_sales_data", dept: "فندق", nameField: "clientName" },
    { key: "vv_visa_sales_data", dept: "فيزا", nameField: "clientName" },
  ];

  function readPendingEgpCollections() {
    const rows = [];
    EGP_SOURCE_STORES.forEach((store) => {
      CORE.readStore(store.key, []).forEach((r) => {
        if ((r.currency || "EGP") !== "EGP") return;
        if (!["cash", "instapay", "bank"].includes(r.collectionStatus)) return;
        if (r.postedToTreasury) return;
        if (!(Number(r.paidAmount) > 0)) return;
        rows.push({ storeKey: store.key, dept: store.dept, id: r.id, customerName: r[store.nameField] || "-", amount: Number(r.paidAmount) || 0, collectionStatus: r.collectionStatus, date: r.date || r.checkIn || "" });
      });
    });
    return rows.sort((a, b) => (a.date > b.date ? -1 : 1));
  }

  function markEgpCollectionsPosted(items) {
    EGP_SOURCE_STORES.forEach((store) => {
      const rows = CORE.readStore(store.key, []);
      let changed = false;
      rows.forEach((r) => {
        if (items.some((i) => i.storeKey === store.key && i.id === r.id)) { r.postedToTreasury = true; changed = true; }
      });
      if (changed) CORE.writeStore(store.key, rows);
    });
  }

  function renderEgpCollectionsPanel() {
    const panel = document.getElementById("treasury-egp-collections-panel");
    if (!panel) return;
    const pending = readPendingEgpCollections();

    if (pending.length === 0) { panel.innerHTML = ""; return; }

    const total = Math.round(pending.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    panel.innerHTML = `
      <div class="egp-collections-panel">
        <div class="egp-collections-panel__header">💰 تحصيلات الجنيه المعلّقة (لسه محتاجة ترحيل للخزينة) — إجمالي ${total.toLocaleString("en-US")}</div>
        <div class="ledger-scroll"><table class="acc-table">
          <thead><tr><th></th><th>القسم</th><th>العميل</th><th>التاريخ</th><th>طريقة التحصيل</th><th class="num">المبلغ</th></tr></thead>
          <tbody>
            ${pending.map((r) => `<tr>
              <td><input type="checkbox" class="egp-collection-check" data-storekey="${r.storeKey}" data-id="${r.id}" data-amount="${r.amount}" checked /></td>
              <td>${r.dept}</td><td>${r.customerName}</td><td>${r.date}</td>
              <td>${{ cash: "كاش", instapay: "InstaPay", bank: "تحويل بنكي" }[r.collectionStatus] || r.collectionStatus}</td>
              <td class="num">${r.amount.toLocaleString("en-US")}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
        <div style="display:flex; align-items:center; gap:12px; padding:14px 16px; border-top:1px solid var(--border);">
          <label style="font-size:11.5px;">ترحيل إلى: <select id="egp-post-target"></select></label>
          <button class="btn btn--primary" id="btn-post-egp-collections" type="button">ترحيل المحدد للخزينة</button>
          <span id="egp-post-selected-total" style="font-size:12px; font-weight:800; color:var(--gold-deep);"></span>
        </div>
      </div>
    `;

    const targetSelect = document.getElementById("egp-post-target");
    targetSelect.innerHTML = accountOptionsList().map((o) => `<option value="${o.id}">${o.label}</option>`).join("");

    function updateSelectedTotal() {
      const checked = [...panel.querySelectorAll(".egp-collection-check:checked")];
      const sum = checked.reduce((s, el) => s + Number(el.dataset.amount), 0);
      document.getElementById("egp-post-selected-total").textContent = `المحدد: ${sum.toLocaleString("en-US")}`;
    }
    panel.querySelectorAll(".egp-collection-check").forEach((cb) => cb.addEventListener("change", updateSelectedTotal));
    updateSelectedTotal();

    document.getElementById("btn-post-egp-collections").addEventListener("click", () => postSelectedEgpCollections(panel));
  }

  function postSelectedEgpCollections(panel) {
    const checked = [...panel.querySelectorAll(".egp-collection-check:checked")];
    if (checked.length === 0) { alert("اختار تحصيل واحد على الأقل."); return; }
    const targetAccount = document.getElementById("egp-post-target").value;
    if (!targetAccount) { alert("اختار الحساب اللي هيترحّل عليه المبلغ."); return; }

    const items = checked.map((el) => ({ storeKey: el.dataset.storekey, id: el.dataset.id, amount: Number(el.dataset.amount) }));
    const total = Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;

    if (!confirm(`ترحيل ${items.length} تحصيل بإجمالي ${total.toLocaleString("en-US")} جنيه إلى "${accountLabel(targetAccount)}"؟`)) return;

    const request = window.VVChangeRequests.createRequest({
      module: "treasury",
      changeType: "financial_op",
      targetId: null,
      targetLabel: `ترحيل ${items.length} تحصيل جنيه (${total.toLocaleString("en-US")}) — ${accountLabel(targetAccount)}`,
      payload: { type: "deposit", targetAccountId: targetAccount, amount: total, description: `ترحيل تحصيلات مبيعات (${items.length} عملية) من قسم البيانات`, date: CORE.todayISO() },
    });

    if (!request) return;
    if (request.status === "approved") {
      markEgpCollectionsPosted(items);
      alert("تم الترحيل فورًا.");
    } else {
      alert("تم إرسال طلب الترحيل — بانتظار الاعتماد. لن يُعلَّم كمُرحَّل إلا بعد الموافقة الفعلية.");
      // Intentionally NOT marked posted yet for a pending request — only
      // a genuinely approved deposit may ever flip postedToTreasury,
      // otherwise a rejected request would silently make real collected
      // money vanish from view with nothing actually in the Treasury.
    }
    renderCards();
    renderEgpCollectionsPanel();
    renderTransactionsTable();
  }

  function renderTreasuryModule() {
    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div id="treasury-cards" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:14px; margin-bottom:24px;"></div>

      <div id="treasury-review-panel" style="margin-bottom:24px;"></div>

      <div id="treasury-egp-collections-panel" style="margin-bottom:24px;"></div>

      <div class="vv-tabs" style="margin-bottom:18px;">
        <div class="vv-tab is-active" data-treasury-tab="transfer">تحويل بين الحسابات</div>
        <div class="vv-tab" data-treasury-tab="deposit">إيداع</div>
        <div class="vv-tab" data-treasury-tab="withdraw">سحب</div>
        <div class="vv-tab" data-treasury-tab="bank">+ إضافة بنك</div>
      </div>

      <div id="treasury-form-panel" style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px; margin-bottom:24px;"></div>

      <div class="table-controls" style="margin-bottom:14px;">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="treasury-search" placeholder="بحث بالبيان أو المرجع..." />
        </div>
      </div>

      <div class="ledger-scroll">
        <table class="acc-table" id="treasury-txn-table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>من</th><th>إلى</th><th>المبلغ</th><th>البيان</th><th>المرجع</th><th>الحالة</th></tr></thead>
          <tbody id="treasury-txn-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="treasury-txn-empty" style="display:none;"><p>لا توجد حركات خزينة بعد</p></div>
    `;

    document.querySelectorAll("[data-treasury-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("[data-treasury-tab]").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        renderFormPanel(tab.dataset.treasuryTab);
      });
    });

    document.getElementById("treasury-search").addEventListener("input", renderTransactionsTable);

    renderCards();
    renderReviewPanel();
    renderEgpCollectionsPanel();
    renderFormPanel("transfer");
    renderTransactionsTable();
  }

  function renderCards() {
    const cash = readCash();
    const banks = readBanks();
    const banksTotal = Object.values(banks).reduce((sum, b) => sum + (Number(b) || 0), 0);
    const total = (Number(cash.balance) || 0) + banksTotal;
    const txns = readTransactions();
    const pendingCount = txns.filter((t) => !isLegacyTxn(t) && t.status === "pending").length;
    const reviewCount = txns.filter(needsReview).length;

    const cards = [
      { label: "💵 إجمالي النقدية", value: CORE.formatMoney(cash.balance) },
      { label: "🏦 إجمالي البنوك", value: CORE.formatMoney(banksTotal) },
      { label: "💰 إجمالي الخزينة", value: CORE.formatMoney(total) },
      { label: "🔄 عمليات معلّقة", value: String(pendingCount) },
      { label: "⚠️ عمليات تحتاج مراجعة", value: String(reviewCount) },
    ];

    document.getElementById("treasury-cards").innerHTML = cards.map((c, i) => `
      <div style="background:${i >= 3 && c.value !== '0' ? 'var(--coral-soft)' : 'var(--ink)'}; color:${i >= 3 && c.value !== '0' ? 'var(--coral)' : '#fff'}; border-radius:var(--radius-lg); padding:18px;">
        <div style="font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:${i >= 3 && c.value !== '0' ? 'var(--coral)' : 'var(--text-on-ink-soft)'}; margin-bottom:8px;">${c.label}</div>
        <div style="font-family:'Cairo',sans-serif; font-weight:800; font-size:22px; color:${i >= 3 ? (c.value !== '0' ? 'var(--coral)' : 'var(--text)') : 'var(--gold)'};">${c.value}</div>
      </div>`).join("");
  }

  // =========================================================================
  // "Needs Review" panel — every non-legacy transaction sitting at
  // pending/stuck/failed. Purely informational: no auto-retry action is
  // offered anywhere here, matching the established principle everywhere
  // else in this Accounting module — resolving a stuck operation is a
  // deliberate human decision, never a button click.
  // =========================================================================

  function renderReviewPanel() {
    const panel = document.getElementById("treasury-review-panel");
    if (!panel) return;
    const flagged = readTransactions().filter(needsReview).sort((a, b) => (b.id > a.id ? 1 : -1));

    if (flagged.length === 0) { panel.innerHTML = ""; return; }

    const STATUS_LABEL = { pending: "🔄 معلّقة (غامضة)", stuck: "⚠️ عالقة", failed: "✕ فشلت" };

    panel.innerHTML = `
      <div style="background:var(--coral-soft); border:1px solid var(--coral); border-radius:var(--radius-lg); padding:16px 18px;">
        <h3 style="font-family:'Cairo',sans-serif; font-weight:800; font-size:14px; color:var(--coral); margin-bottom:10px;">⚠️ عمليات تحتاج مراجعة (${flagged.length})</h3>
        <div class="ledger-scroll" style="border-color:var(--coral);">
          <table class="acc-table" style="min-width:600px;">
            <thead><tr><th>العملية</th><th>النوع</th><th>من</th><th>إلى</th><th>المبلغ</th><th>الحالة</th><th>السبب</th></tr></thead>
            <tbody>
              ${flagged.map((t) => `
                <tr>
                  <td class="mono">${t.id.slice(0, 14)}</td>
                  <td>${{ deposit: "إيداع", withdraw: "سحب", transfer: "تحويل", add_bank: "إضافة بنك" }[t.type] || t.type}</td>
                  <td>${t.sourceAccountId ? accountLabel(t.sourceAccountId) : "-"}</td>
                  <td>${t.targetAccountId ? accountLabel(t.targetAccountId) : (t.bankName || "-")}</td>
                  <td class="num">${CORE.formatMoney(t.amount)}</td>
                  <td>${STATUS_LABEL[t.status] || t.status}</td>
                  <td style="max-width:260px; white-space:normal;">${t.errorReason || "—"}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // Transfer / Deposit / Withdraw / Add bank forms
  // =========================================================================

  function renderFormPanel(mode) {
    const panel = document.getElementById("treasury-form-panel");
    const accountOptions = accountOptionsList();
    const optionsHtml = () => accountOptions.map((a) => `<option value="${a.id}">${a.label}</option>`).join("");

    if (mode === "transfer") {
      panel.innerHTML = `
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">تحويل بين الحسابات</h3>
        <div class="vv-field-row">
          <div class="vv-field"><label>من حساب</label><select id="tr-from">${optionsHtml()}</select></div>
          <div class="vv-field"><label>إلى حساب</label><select id="tr-to">${optionsHtml()}</select></div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>المبلغ</label><input type="number" min="0" step="0.01" id="tr-amount" value="0" /></div>
          <div class="vv-field"><label>تاريخ التحويل</label><input type="date" id="tr-date" /></div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>البيان / السبب</label><input type="text" id="tr-reason" placeholder="سبب التحويل..." /></div>
          <div class="vv-field"><label>رقم المرجع</label><input type="text" id="tr-reference" placeholder="اختياري" /></div>
        </div>
        <button class="btn btn--primary" id="btn-do-transfer" type="button">إرسال طلب التحويل</button>
      `;
      document.getElementById("tr-date").value = CORE.todayISO();
      document.getElementById("btn-do-transfer").addEventListener("click", submitTransfer);
    }

    if (mode === "deposit") {
      panel.innerHTML = `
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">إيداع</h3>
        <div class="vv-field-row">
          <div class="vv-field"><label>الحساب</label><select id="dep-account">${optionsHtml()}</select></div>
          <div class="vv-field"><label>المبلغ</label><input type="number" min="0" step="0.01" id="dep-amount" value="0" /></div>
        </div>
        <div class="vv-field"><label>المصدر</label><input type="text" id="dep-source" placeholder="من أين جاء المبلغ..." /></div>
        <div class="vv-field-row">
          <div class="vv-field"><label>البيان</label><input type="text" id="dep-description" placeholder="اختياري" /></div>
          <div class="vv-field"><label>رقم المستند</label><input type="text" id="dep-notice" placeholder="اختياري" /></div>
        </div>
        <button class="btn btn--primary" id="btn-do-deposit" type="button">إرسال طلب الإيداع</button>
      `;
      document.getElementById("btn-do-deposit").addEventListener("click", submitDeposit);
    }

    if (mode === "withdraw") {
      panel.innerHTML = `
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">سحب</h3>
        <div class="vv-field-row">
          <div class="vv-field"><label>الخزينة / البنك</label><select id="wd-account">${optionsHtml()}</select></div>
          <div class="vv-field"><label>المبلغ</label><input type="number" min="0" step="0.01" id="wd-amount" value="0" /></div>
        </div>
        <div class="vv-field"><label>المستلم</label><input type="text" id="wd-recipient" placeholder="اسم المستلم..." /></div>
        <div class="vv-field"><label>السبب / البيان</label><input type="text" id="wd-reason" placeholder="سبب السحب..." /></div>
        <button class="btn btn--primary" id="btn-do-withdraw" type="button">إرسال طلب السحب</button>
      `;
      document.getElementById("btn-do-withdraw").addEventListener("click", submitWithdraw);
    }

    if (mode === "bank") {
      panel.innerHTML = `
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">إضافة بنك جديد</h3>
        <div class="vv-field-row">
          <div class="vv-field"><label>اسم البنك</label><input type="text" id="new-bank-name" placeholder="اسم البنك..." /></div>
          <div class="vv-field"><label>الرصيد الافتتاحي</label><input type="number" min="0" step="0.01" id="new-bank-balance" value="0" /></div>
        </div>
        <button class="btn btn--primary" id="btn-add-bank" type="button">إرسال طلب إضافة البنك</button>
      `;
      document.getElementById("btn-add-bank").addEventListener("click", submitAddBank);
    }
  }

  // =========================================================================
  // Transactions table — renders BOTH legacy (string-based, always
  // "posted") and new (id-based, real status) records in one unified
  // view.
  // =========================================================================

  const TYPE_LABELS = { deposit: "إيداع", withdraw: "سحب", transfer: "تحويل", add_bank: "إضافة بنك" };
  const STATUS_BADGE = { posted: '<span class="badge badge--posted">مُرحّلة</span>', pending: '<span class="badge badge--pending">🔄 معلّقة</span>', stuck: '<span class="badge badge--pending" style="background:var(--coral-soft);color:var(--coral);">⚠️ عالقة</span>', failed: '<span class="badge badge--pending" style="background:var(--coral-soft);color:var(--coral);">✕ فشلت</span>' };

  function renderTransactionsTable() {
    const query = (document.getElementById("treasury-search").value || "").trim().toLowerCase();
    let rows = [...readTransactions()].sort((a, b) => (b.id > a.id ? 1 : -1));
    if (query) {
      rows = rows.filter((t) => {
        const reason = isLegacyTxn(t) ? (t.reason || "") : (t.description || "");
        return reason.toLowerCase().includes(query) || (t.reference || "").toLowerCase().includes(query);
      });
    }

    const tbody = document.getElementById("treasury-txn-body");
    const table = document.getElementById("treasury-txn-table");
    const empty = document.getElementById("treasury-txn-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((t) => {
      if (isLegacyTxn(t)) {
        // Old shape — already-formatted display strings, always historical fact.
        return `
          <tr>
            <td>${t.date}</td>
            <td>${TYPE_LABELS[t.type] || t.type}</td>
            <td>${t.fromAccount}</td>
            <td>${t.toAccount}</td>
            <td class="num">${CORE.formatMoney(t.amount)}</td>
            <td>${t.reason || "-"}</td>
            <td class="mono">${t.reference || "-"}</td>
            <td>${STATUS_BADGE.posted}</td>
          </tr>`;
      }
      // New shape — id-based accounts, real lifecycle status.
      const fromLabel = t.type === "add_bank" ? "—" : (t.sourceAccountId ? accountLabel(t.sourceAccountId) : "—");
      const toLabel = t.type === "add_bank" ? (t.bankName || "—") : (t.targetAccountId ? accountLabel(t.targetAccountId) : "—");
      return `
        <tr>
          <td>${t.date}</td>
          <td>${TYPE_LABELS[t.type] || t.type}</td>
          <td>${fromLabel}</td>
          <td>${toLabel}</td>
          <td class="num">${CORE.formatMoney(t.amount)}</td>
          <td>${t.description || "-"}</td>
          <td class="mono">${t.reference || "-"}</td>
          <td>${STATUS_BADGE[t.status] || t.status}</td>
        </tr>`;
    }).join("");
  }

  // =========================================================================
  // Self-wire the dashboard's Quick Action trigger + register the module
  // =========================================================================

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.treasury = renderTreasuryModule;

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="treasury"], #qa-treasury').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("treasury"));
    });
  });
})();