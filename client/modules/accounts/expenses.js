/**
 * expenses.js — client/modules/accounts/ (المصروفات)
 * -----------------------------------------------------------------------
 * Registers into VVAccountsModules.expenses and self-wires its own
 * trigger button (`[data-view="expenses"]` or `#qa-expenses`).
 *
 * Payment method is one of three: نقدي (cash), بنكي (bank), عهدة (an
 * employee's open custody). Cash/Bank draw straight from
 * window.VVTreasury; عهدة draws from window.VVCustody instead — the
 * treasury was already debited when that custody was first issued, so
 * charging an expense against it must NOT touch the treasury again.
 *
 * Financial mutation — posting or reversing an expense — happens ONLY
 * from the VVChangeRequests Apply Handler below, never directly from a
 * button. draft -> submitted -> approved stay simple direct writes (no
 * financial effect); only approved -> posted, and reversing a posted
 * expense, go through window.VVChangeRequests, registered here as module
 * "expenses" with changeType "post" or "reverse" — same principles
 * already proven in vouchers.js/custody.js/journal_entries.js, adapted to
 * this file's own shape rather than copied literally.
 *
 * Data store: vv_expenses — [{ id, date, category, amount, paymentMethod,
 *   accountId, custodyId, invoiceNumber, description, attachment, status,
 *   isReversal, reversed, reversedBy, reversesExpenseId, reversalState }]
 *   paymentMethod: "Cash" | "Bank" | "Custody"
 *   status: "draft" | "submitted" | "approved" | "posting" | "posted"
 *     ("posting" is a transient Intent Marker, never a final state — see
 *     the Apply Handler below)
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;
  const WF = window.VVWorkflow;

  const CATEGORIES = ["إيجار", "رواتب", "كهرباء ومياه", "اتصالات وإنترنت", "صيانة", "دعاية وتسويق", "ضيافة", "أخرى"];

  function readExpenses() { return CORE.readStore("vv_expenses", []); }
  function writeExpenses(expenses) { CORE.writeStore("vv_expenses", expenses); }

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Date.now() alone has millisecond precision — two expenses created in
  // quick succession could otherwise collide (confirmed directly
  // elsewhere in this project). A random suffix makes an actual
  // collision astronomically unlikely.
  function generateExpenseId() {
    return `ex_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * The ONLY place vv_expenses' financial effect is ever applied from —
   * called exclusively from inside the registered Apply Handler below,
   * never directly from a button. Validates everything BEFORE writing
   * anything, and returns an explicit { success, reason } — never
   * assumes VVTreasury.adjustBalance() itself reports success/failure
   * (it doesn't; it always returns a number), and never assumes
   * VVCustody.recordSpendAgainst()/reverseSpendAgainst() succeeded
   * without checking their own { success, reason } result explicitly.
   */
  function applyExpenseEffect(expense, sign) {
    if (!expense) return { success: false, reason: "المصروف غير موجود." };

    const amount = Number(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, reason: `المبلغ غير صالح: "${expense.amount}" — يجب أن يكون رقمًا أكبر من صفر.` };
    }
    if (!expense.category) return { success: false, reason: "فئة المصروف مطلوبة." };
    if (!expense.description || !String(expense.description).trim()) return { success: false, reason: "بيان المصروف مطلوب." };
    if (sign !== 1 && sign !== -1) return { success: false, reason: `إشارة الأثر المالي غير صالحة: "${sign}".` };

    if (expense.paymentMethod === "Custody") {
      if (!expense.custodyId) return { success: false, reason: "معرف العهدة مفقود." };
      if (!window.VVCustody) return { success: false, reason: "خدمة العهد (VVCustody) غير متاحة حاليًا." };

      // Never assume this succeeded — custody.js's own contract is
      // { success, reason } precisely so callers like this one can check.
      const result = sign > 0
        ? window.VVCustody.recordSpendAgainst(expense.custodyId, amount)
        : window.VVCustody.reverseSpendAgainst(expense.custodyId, amount);
      if (!result.success) return result; // propagate the real reason from custody.js verbatim

      return { success: true };
    }

    if (expense.paymentMethod !== "Cash" && expense.paymentMethod !== "Bank") {
      return { success: false, reason: `طريقة الدفع غير صالحة: "${expense.paymentMethod}".` };
    }
    if (!window.VVTreasury) return { success: false, reason: "خدمة الخزينة (VVTreasury) غير متاحة حاليًا." };

    // VVTreasury.adjustBalance() itself never reports failure — it always
    // returns a number, and silently creates an unrecognized "bank:X" id
    // rather than rejecting it (confirmed directly by reading
    // treasury.js). "Does this account actually exist" has to be checked
    // HERE, against accountOptions()'s real list, before ever calling it.
    const realAccountIds = window.VVTreasury.accountOptions().map((o) => o.id);
    if (!expense.accountId || !realAccountIds.includes(expense.accountId)) {
      return { success: false, reason: `الحساب المختار (${expense.accountId || "—"}) لم يعد موجودًا في الخزينة.` };
    }

    window.VVTreasury.adjustBalance(expense.accountId, -amount * sign);
    return { success: true };
  }

  // =========================================================================
  // Main render
  // =========================================================================

  function renderExpensesModule() {
    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px; margin-bottom:20px;">
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">إضافة مصروف</h3>
        <div class="vv-field-row">
          <div class="vv-field"><label>التاريخ</label><input type="date" id="ex-date" /></div>
          <div class="vv-field"><label>الفئة</label>
            <select id="ex-category">${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          </div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>المبلغ</label><input type="number" min="0" step="0.01" id="ex-amount" value="0" /></div>
          <div class="vv-field"><label>رقم الفاتورة / المستند</label><input type="text" id="ex-invoice-number" placeholder="اختياري" /></div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>طريقة الدفع</label>
            <select id="ex-payment-method">
              <option value="Cash">نقدي</option>
              <option value="Bank">بنكي</option>
              <option value="Custody">عهدة</option>
            </select>
          </div>
          <div class="vv-field" id="ex-account-field"><label>الخزينة / البنك</label><select id="ex-account"></select></div>
          <div class="vv-field" id="ex-custody-field" style="display:none;"><label>عهدة الموظف</label><select id="ex-custody"></select></div>
        </div>
        <div class="vv-field"><label>البيان</label><input type="text" id="ex-description" placeholder="وصف المصروف..." /></div>
        <div class="vv-field">
          <label>مرفق (إيصال/فاتورة)</label>
          <input type="file" id="ex-attachment" accept="image/*,application/pdf" />
          <div id="ex-attachment-name" style="font-size:11px;color:var(--text-faint);margin-top:4px;"></div>
        </div>
        <button class="btn btn--primary" id="btn-save-expense" type="button">حفظ المصروف (كمسوّدة)</button>
      </div>

      <div class="table-controls" style="margin-bottom:14px;">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="expense-search" placeholder="بحث بالفئة أو البيان..." />
        </div>
        <select id="expense-category-filter" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;">
          <option value="">كل الفئات</option>
          ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
        </select>
      </div>

      <div class="ledger-scroll">
        <table class="acc-table" id="expenses-table">
          <thead><tr><th>التاريخ</th><th>الفئة</th><th>البيان</th><th>المبلغ</th><th>طريقة الدفع</th><th>رقم المستند</th><th>مرفق</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody id="expenses-table-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="expenses-empty-state" style="display:none;"><p>لا توجد مصروفات مسجّلة بعد</p></div>
    `;

    document.getElementById("ex-date").value = CORE.todayISO();

    function refreshAccountOptions() {
      if (window.VVTreasury) {
        document.getElementById("ex-account").innerHTML = window.VVTreasury.accountOptions()
          .map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
      }
    }
    function refreshCustodyOptions() {
      const select = document.getElementById("ex-custody");
      const openRecords = window.VVCustody ? window.VVCustody.getOpenRecords() : [];
      if (openRecords.length === 0) {
        select.innerHTML = `<option value="">-- لا توجد عُهد مفتوحة --</option>`;
        return;
      }
      select.innerHTML = openRecords.map((c) => {
        const remaining = Math.round((c.amount - c.spent) * 100) / 100;
        return `<option value="${c.id}">${c.employee} — متبقي ${remaining.toFixed(2)}</option>`;
      }).join("");
    }
    refreshAccountOptions();
    refreshCustodyOptions();

    document.getElementById("ex-payment-method").addEventListener("change", (e) => {
      const isCustody = e.target.value === "Custody";
      document.getElementById("ex-account-field").style.display = isCustody ? "none" : "block";
      document.getElementById("ex-custody-field").style.display = isCustody ? "block" : "none";
      if (isCustody) refreshCustodyOptions();
    });

    let pendingAttachment = null;
    document.getElementById("ex-attachment").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) { pendingAttachment = null; return; }
      try {
        pendingAttachment = { name: file.name, dataUrl: await readFileAsDataUrl(file) };
        document.getElementById("ex-attachment-name").textContent = `تم إرفاق: ${file.name}`;
      } catch (err) {
        console.error(err);
        pendingAttachment = null;
      }
    });

    document.getElementById("btn-save-expense").addEventListener("click", () => {
      const amount = Number(document.getElementById("ex-amount").value) || 0;
      const description = document.getElementById("ex-description").value.trim();
      const paymentMethod = document.getElementById("ex-payment-method").value;

      if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }
      if (!description) { alert("البيان مطلوب."); return; }

      let accountId = null, custodyId = null;
      if (paymentMethod === "Custody") {
        custodyId = document.getElementById("ex-custody").value;
        if (!custodyId) { alert("اختار عهدة موظف مفتوحة، أو غيّر طريقة الدفع."); return; }
        const openRecords = window.VVCustody ? window.VVCustody.getOpenRecords() : [];
        const record = openRecords.find((c) => c.id === custodyId);
        const remaining = record ? record.amount - record.spent : 0;
        if (amount > remaining) { alert(`المبلغ أكبر من المتبقي في هذه العهدة (${remaining.toFixed(2)}).`); return; }
      } else {
        accountId = document.getElementById("ex-account").value;
      }

      const expenses = readExpenses();
      expenses.push({
        id: generateExpenseId(),
        date: document.getElementById("ex-date").value || CORE.todayISO(),
        category: document.getElementById("ex-category").value,
        amount,
        paymentMethod,
        accountId,
        custodyId,
        invoiceNumber: document.getElementById("ex-invoice-number").value.trim(),
        description,
        attachment: pendingAttachment,
        status: "draft",
        isReversal: false,
        reversed: false,
        reversedBy: null,
        reversesExpenseId: null,
        reversalState: null,
      });
      writeExpenses(expenses);

      document.getElementById("ex-amount").value = "0";
      document.getElementById("ex-description").value = "";
      document.getElementById("ex-invoice-number").value = "";
      document.getElementById("ex-attachment").value = "";
      document.getElementById("ex-attachment-name").textContent = "";
      pendingAttachment = null;

      renderExpensesTable();
    });

    document.getElementById("expense-search").addEventListener("input", renderExpensesTable);
    document.getElementById("expense-category-filter").addEventListener("change", renderExpensesTable);
    renderExpensesTable();
  }

  const PAYMENT_METHOD_LABELS = { Cash: "نقدي", Bank: "بنكي", Custody: "عهدة" };

  function renderExpensesTable() {
    const query = (document.getElementById("expense-search").value || "").trim().toLowerCase();
    const categoryFilter = document.getElementById("expense-category-filter").value;

    let rows = [...readExpenses()];
    if (query) rows = rows.filter((e) => e.category.toLowerCase().includes(query) || e.description.toLowerCase().includes(query));
    if (categoryFilter) rows = rows.filter((e) => e.category === categoryFilter);
    rows.sort((a, b) => (b.id > a.id ? 1 : -1));

    const tbody = document.getElementById("expenses-table-body");
    const table = document.getElementById("expenses-table");
    const empty = document.getElementById("expenses-empty-state");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td>${e.date}</td>
        <td>${e.category}</td>
        <td>${e.description}</td>
        <td class="num amount-out">${CORE.formatMoney(e.amount)}</td>
        <td>${PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod}</td>
        <td class="mono">${e.invoiceNumber || "-"}</td>
        <td>${e.attachment ? `<a href="#" data-open-attachment="${e.id}" style="text-decoration:underline;">📎 ${e.attachment.name}</a>` : "—"}</td>
        <td>${WF.badgeHtml(e.status)}</td>
        <td>${(e.status === "posting" || e.reversalState === "in_progress") ? `<span class="badge badge--pending" title="عملية سابقة لم تكتمل — يحتاج مراجعة يدوية">⚠️ يحتاج مراجعة</span>` : WF.actionsHtml(e, { allowReverse: true })}</td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-open-attachment]").forEach((link) => {
      link.addEventListener("click", (evt) => {
        evt.preventDefault();
        const expense = readExpenses().find((e) => e.id === link.dataset.openAttachment);
        if (expense && expense.attachment) window.open(expense.attachment.dataUrl, "_blank");
      });
    });

    WF.wireButtons(tbody, {
      records: rows,
      onAdvance: (record, fromStatus) => {
        // Only the approved -> posted step touches money — must go
        // through VVChangeRequests, never a direct write. record.status
        // was already mutated in place by accounts_core.js's shared
        // workflow engine before this callback runs; we deliberately
        // ignore that stale in-memory value and act only on record.id,
        // re-reading everything fresh inside submitPostingRequest().
        if (fromStatus === "approved") {
          submitPostingRequest(record.id);
          return;
        }
        // draft -> submitted, submitted -> approved: unchanged — no
        // financial effect, so these stay simple direct writes, but
        // re-validated against the CURRENT persisted status (not the
        // stale in-memory one) before writing, exactly as instructed.
        const expenses = readExpenses();
        const idx = expenses.findIndex((e) => e.id === record.id);
        if (idx === -1) { alert("المصروف لم يعد موجودًا."); renderExpensesTable(); return; }

        const currentStatus = expenses[idx].status;
        const allowedTransitions = { draft: "submitted", submitted: "approved" };
        if (allowedTransitions[currentStatus] === record.status) {
          expenses[idx].status = record.status;
          writeExpenses(expenses);
          renderExpensesTable();
        } else {
          alert("تغيير حالة غير مصرح به أو تم تحديث البيانات بواسطة مستخدم آخر.");
          renderExpensesTable();
        }
      },
      onDelete: (record) => {
        if (record.status !== "draft") { alert("لا يمكن حذف مصروف تم اعتماده أو ترحيله."); return; }
        const expenses = readExpenses();
        const exists = expenses.some((e) => e.id === record.id);
        if (!exists) { alert("المصروف لم يعد موجودًا."); renderExpensesTable(); return; }
        writeExpenses(expenses.filter((e) => e.id !== record.id));
        renderExpensesTable();
      },
      onReverse: (record) => {
        submitReversalRequest(record.id);
      },
    });
  }

  // =========================================================================
  // Change Request submission — no financial mutation happens in either of
  // these two functions. Each validates what it can up front (fast,
  // friendly rejection), then hands off entirely to VVChangeRequests; the
  // real work happens only in the registered Apply Handler below.
  // =========================================================================

  function submitPostingRequest(expenseId) {
    const expenses = readExpenses();
    const expense = expenses.find((e) => e.id === expenseId);
    if (!expense) { alert("المصروف لم يعد موجودًا."); return; }
    if (expense.status === "posting") { alert("هذا المصروف في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية."); return; }
    if (expense.status !== "approved") { alert(`لا يمكن ترحيل المصروف — حالته الحالية "${WF.label(expense.status)}"، ويجب أن تكون "معتمد".`); return; }
    if (expense.reversed || expense.reversedBy) { alert("لا يمكن ترحيل مصروف تم عكسه بالفعل."); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "expenses",
      changeType: "post",
      targetId: expense.id,
      targetLabel: `${expense.category} — ${CORE.formatMoney(expense.amount)}`,
      payload: {},
    });

    if (request) {
      alert(request.status === "approved" ? `تم ترحيل المصروف فورًا.` : `تم إرسال طلب ترحيل المصروف — بانتظار الاعتماد.`);
      renderExpensesTable();
    }
  }

  function submitReversalRequest(expenseId) {
    const expenses = readExpenses();
    const original = expenses.find((e) => e.id === expenseId);
    if (!original) { alert("المصروف لم يعد موجودًا."); return; }
    if (original.reversalState === "in_progress") { alert("هذا المصروف في حالة عكس معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية."); return; }
    if (original.status !== "posted") { alert("لا يمكن عكس مصروف إلا وهو مُرحّل."); return; }
    if (original.reversedBy || original.reversed) { alert("هذا المصروف تم عكسه بالفعل."); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "expenses",
      changeType: "reverse",
      targetId: original.id,
      targetLabel: `عكس مصروف: ${original.category} — ${CORE.formatMoney(original.amount)}`,
      payload: {},
    });

    if (request) {
      alert(request.status === "approved" ? `تم عكس المصروف فورًا.` : `تم إرسال طلب عكس المصروف — بانتظار الاعتماد.`);
      renderExpensesTable();
    }
  }

  // =========================================================================
  // Apply Handler — registered with the shared change_requests.js engine.
  // This is the ONLY place applyExpenseEffect() is ever called from.
  //
  // Atomicity note (honest, not a claim): writing vv_expenses and the
  // Treasury/Custody stores are separate localStorage.setItem() calls —
  // there is no cross-key transaction in Web Storage, so they can never
  // be made truly atomic as a pair from this file, or any file, alone.
  // What this DOES do: write an intent marker into vv_expenses itself
  // BEFORE ever touching Treasury/Custody, so an interruption between the
  // two leaves the expense in a visibly "stuck" transient status
  // ("posting", or reversalState "in_progress") that this Apply Handler
  // explicitly refuses to act on again — a silent, retriable, double-
  // application risk becomes a detectable, blocked one that needs a
  // human to resolve, not a promise that it gets auto-fixed.
  // =========================================================================

  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("expenses", (request) => {
      if (window.VVPermissions && window.VVAuth) {
        const actingUser = window.VVAuth.getCurrentUser();
        const requiredPermission = window.VVPermissions.permissionForAction({ module: "expenses", changeType: request.changeType, payload: request.payload });
        if (!window.VVPermissions.can(actingUser, requiredPermission)) {
          return { success: false, reason: "ليس لديك الصلاحية الكافية لتنفيذ هذه العملية." };
        }
      }

      const expenses = readExpenses();
      const expense = expenses.find((e) => e.id === request.targetId);

      // ---- POST ----
      if (request.changeType === "post") {
        if (!expense) return { success: false, reason: "المصروف المستهدف لم يعد موجودًا." };
        if (expense.status === "posting") {
          return { success: false, reason: "هذا المصروف في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل (انقطاع محتمل) — يحتاج مراجعة يدوية قبل أي محاولة جديدة. لا يمكن إعادة المحاولة تلقائيًا لتجنّب مضاعفة الأثر المالي." };
        }
        if (expense.status !== "approved") {
          return { success: false, reason: `حالة المصروف الحالية "${WF.label(expense.status)}" — يجب أن تكون "معتمد" قبل الترحيل (ربما تم ترحيله بالفعل من مكان آخر).` };
        }
        if (expense.reversed || expense.reversedBy) {
          return { success: false, reason: "لا يمكن ترحيل مصروف تم عكسه بالفعل." };
        }

        // Phase 1 — mark intent BEFORE touching Treasury/Custody.
        const idx = expenses.findIndex((e) => e.id === expense.id);
        expenses[idx].status = "posting";
        writeExpenses(expenses);

        // Phase 2 — the actual financial mutation.
        const effectResult = applyExpenseEffect(expense, 1);

        if (!effectResult.success) {
          // applyExpenseEffect() validates everything BEFORE writing
          // anything, so a failure here means Treasury/Custody were,
          // with certainty, never touched — safe to fully revert.
          const revert = readExpenses();
          const revertIdx = revert.findIndex((e) => e.id === expense.id);
          if (revertIdx !== -1) { revert[revertIdx].status = "approved"; writeExpenses(revert); }
          return effectResult;
        }

        // Phase 3 — only now, after the mutation is confirmed durable,
        // record the true final state and clear the intent marker.
        const final = readExpenses();
        const finalIdx = final.findIndex((e) => e.id === expense.id);
        if (finalIdx === -1) return { success: false, reason: "تم تنفيذ الأثر المالي لكن المصروف اختفى أثناء حفظ الحالة النهائية." };
        final[finalIdx].status = "posted";
        writeExpenses(final);
        return { success: true };
      }

      // ---- REVERSE ----
      // Never edits or deletes the original expense's financial fields —
      // creates an independent reversing expense record instead, linked
      // via reversesExpenseId/reversedBy, exactly matching the
      // relationship shape already established in vouchers.js.
      if (request.changeType === "reverse") {
        if (!expense) return { success: false, reason: "المصروف الأصلي لم يعد موجودًا." };
        if (expense.reversalState === "in_progress") {
          return { success: false, reason: "هذا المصروف في حالة عكس معلّقة من محاولة سابقة لم تكتمل (انقطاع محتمل) — يحتاج مراجعة يدوية قبل أي محاولة جديدة. لا يمكن إعادة المحاولة تلقائيًا لتجنّب مضاعفة الأثر المالي." };
        }
        if (expense.status !== "posted") {
          return { success: false, reason: `لا يمكن عكس مصروف حالته "${WF.label(expense.status)}" — يجب أن يكون "مُرحّل".` };
        }
        if (expense.reversedBy || expense.reversed) {
          return { success: false, reason: "هذا المصروف تم عكسه بالفعل (ربما من مكان آخر منذ إرسال الطلب)." };
        }

        // Phase 1 — mark intent on the ORIGINAL expense before touching
        // anything financial.
        const idx = expenses.findIndex((e) => e.id === expense.id);
        expenses[idx].reversalState = "in_progress";
        writeExpenses(expenses);

        const reversingExpense = {
          id: generateExpenseId(),
          date: CORE.todayISO(),
          category: expense.category,
          amount: expense.amount,
          paymentMethod: expense.paymentMethod,
          accountId: expense.accountId,
          custodyId: expense.custodyId,
          invoiceNumber: expense.invoiceNumber,
          description: `عكس مصروف: ${expense.description}`,
          attachment: null,
          status: "posted",
          isReversal: true,
          reversed: false,
          reversedBy: null,
          reversesExpenseId: expense.id,
          reversalState: null,
        };

        // Phase 2 — the actual financial mutation, negated.
        const effectResult = applyExpenseEffect(reversingExpense, -1);

        if (!effectResult.success) {
          const revert = readExpenses();
          const revertIdx = revert.findIndex((e) => e.id === expense.id);
          if (revertIdx !== -1) { revert[revertIdx].reversalState = null; writeExpenses(revert); }
          return effectResult; // nothing else written — no reversing expense created, original's reversedBy untouched
        }

        // Phase 3 — record the true final state, clear the intent
        // marker, push the new reversing expense record.
        const final = readExpenses();
        const finalIdx = final.findIndex((e) => e.id === expense.id);
        if (finalIdx !== -1) {
          final[finalIdx].reversedBy = reversingExpense.id;
          final[finalIdx].reversed = true;
          final[finalIdx].reversalState = null;
        }
        final.push(reversingExpense);
        writeExpenses(final);
        return { success: true };
      }

      return { success: false, reason: `نوع طلب غير معروف للمصروفات: ${request.changeType}` };
    });
  }

  // =========================================================================
  // Self-wire the dashboard's Quick Action trigger + register the module
  // =========================================================================

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.expenses = renderExpensesModule;

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="expenses"], #qa-expenses').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("expenses"));
    });
  });
})();