/**
 * journal_entries.js — client/modules/accounts/ (القيود اليومية والترحيل)
 * -----------------------------------------------------------------------
 * Registers into VVAccountsModules.journal and self-wires its own Quick
 * Action trigger (listens for `[data-view="journal"]` or `#qa-journal` —
 * tell me the exact id/attribute if your real button uses something
 * else, it's a one-line fix).
 *
 * This is a REAL double-entry journal — every line has both a Debit and
 * a Credit amount, and a save is blocked entirely unless
 * totalDebit === totalCredit. That's different from the older single-
 * amount voucher pattern used elsewhere in this project; a journal entry
 * needs the full accounting identity to hold.
 *
 * Data store: vv_journal_entries — an array of:
 *   { id, number, date, reference, description,
 *     lines: [{ id, accountId, debit, credit, memo, costCenter }],
 *     totalDebit, totalCredit, status, reversedBy, reversesEntryId,
 *     createdAt }
 *
 * Posting rule (applied only when status becomes "posted"):
 *   for each line, if the account's nature is "debit": balance += (debit - credit)
 *                  if the account's nature is "credit": balance += (credit - debit)
 *   Reversing a posted entry never edits or deletes it — it creates a
 *   brand-new entry with every line's debit/credit swapped, and flags the
 *   original as reversed. That new entry posts immediately since it's a
 *   system-generated correction, not something that needs its own
 *   approval cycle.
 *
 * Approval architecture (PART 1E):
 *   draft -> submitted -> approved still transition directly, exactly as
 *   before — those are low-risk, purely internal state moves with no
 *   financial effect. The two steps that actually touch money —
 *   approved -> posted, and posting a Reversal — now go through the SAME
 *   window.VVChangeRequests engine chart_of_accounts.js and party_core.js
 *   already use, registered here as module "journal_entries" with
 *   changeType "post" or "reverse". No button in this file ever calls
 *   applyPostingEffect() directly anymore — only the registered Apply
 *   Handler does, and only after VVChangeRequests has resolved approval
 *   (which is itself gated by ManagerOverride internally — this file no
 *   longer calls ManagerOverride on its own for anything). An entry's
 *   status only becomes "posted" AFTER applyPostingEffect() reports
 *   success; if it reports failure, the request is marked "apply_failed"
 *   with a reason and the entry is left completely untouched.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;
  const WF = window.VVWorkflow;

  function readEntries() { return CORE.readStore("vv_journal_entries", []); }
  function writeEntries(entries) { CORE.writeStore("vv_journal_entries", entries); }
  function readAccounts() { return CORE.readStore("vv_chart_of_accounts", []); }
  function writeAccounts(accounts) { CORE.writeStore("vv_chart_of_accounts", accounts); }

  function nextEntryNumber() {
    const entries = readEntries();
    return `JE-${String(entries.length + 1).padStart(4, "0")}`;
  }

  let draftLines = [];
  let editingEntryId = null;

  // =========================================================================
  // Main render
  // =========================================================================

  function renderJournalModule() {
    editingEntryId = null;
    resetDraftLines();

    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div id="je-form-panel" style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px; margin-bottom:24px;">
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;" id="je-form-title">قيد يومي جديد</h3>

        <div class="vv-field-row">
          <div class="vv-field"><label>رقم القيد</label><input type="text" id="je-number" readonly /></div>
          <div class="vv-field"><label>التاريخ</label><input type="date" id="je-date" /></div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>رقم المرجع / الفاتورة</label><input type="text" id="je-reference" placeholder="اختياري..." /></div>
          <div class="vv-field"><label>البيان العام</label><input type="text" id="je-description" placeholder="وصف القيد..." /></div>
        </div>

        <div class="ledger-scroll" style="margin-bottom:10px;">
          <table class="acc-table" id="je-lines-table">
            <thead>
              <tr><th>الحساب</th><th>مدين</th><th>دائن</th><th>بيان السطر</th><th>مركز التكلفة</th><th></th></tr>
            </thead>
            <tbody id="je-lines-body"></tbody>
          </table>
        </div>
        <button class="btn btn--ghost" id="btn-add-je-line" type="button" style="font-size:12px; margin-bottom:16px;">+ إضافة سطر</button>

        <div style="display:flex; gap:24px; align-items:center; justify-content:flex-end; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px 18px; margin-bottom:16px;">
          <div>إجمالي المدين: <strong id="je-total-debit">0.00</strong></div>
          <div>إجمالي الدائن: <strong id="je-total-credit">0.00</strong></div>
          <div>الفارق: <strong id="je-difference" style="color:var(--coral);">0.00</strong></div>
        </div>

        <div style="display:flex; gap:10px;">
          <button class="btn btn--primary" id="btn-save-je" type="button">حفظ القيد (كمسوّدة)</button>
          <button class="btn btn--ghost" id="btn-cancel-je-edit" type="button" style="display:none;">إلغاء التعديل</button>
        </div>
      </div>

      <div class="table-controls" style="margin-bottom:14px;">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="je-search" placeholder="بحث بالرقم أو البيان..." />
        </div>
        <select id="je-status-filter" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;">
          <option value="">كل الحالات</option>
          <option value="draft">مسودة</option>
          <option value="submitted">مُقدّم</option>
          <option value="approved">معتمد</option>
          <option value="posted">مُرحّل</option>
        </select>
      </div>

      <div class="ledger-scroll">
        <table class="acc-table" id="je-table">
          <thead><tr><th>التاريخ</th><th>الرقم</th><th>البيان</th><th>الإجمالي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
          <tbody id="je-table-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="je-empty-state" style="display:none;"><p>لا توجد قيود يومية بعد</p></div>
    `;

    document.getElementById("je-number").value = nextEntryNumber();
    document.getElementById("je-date").value = CORE.todayISO();

    document.getElementById("btn-add-je-line").addEventListener("click", () => { draftLines.push(blankLine()); renderLines(); });
    document.getElementById("btn-save-je").addEventListener("click", saveEntry);
    document.getElementById("btn-cancel-je-edit").addEventListener("click", () => renderJournalModule());
    document.getElementById("je-search").addEventListener("input", renderEntriesTable);
    document.getElementById("je-status-filter").addEventListener("change", renderEntriesTable);

    renderLines();
    renderEntriesTable();
  }

  function blankLine() { return { id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, accountId: "", debit: 0, credit: 0, memo: "", costCenter: "" }; }
  function resetDraftLines() { draftLines = [blankLine(), blankLine()]; }

  // =========================================================================
  // Dynamic lines table + live balance calculator
  // =========================================================================

  function accountOptionsHtml(selectedId) {
    const accounts = readAccounts().filter((a) => a.status !== "inactive");
    return `<option value="">-- اختر الحساب --</option>` +
      accounts.map((a) => `<option value="${a.id}" ${a.id === selectedId ? "selected" : ""}>${a.code} — ${a.name}</option>`).join("");
  }

  function renderLines() {
    const tbody = document.getElementById("je-lines-body");
    tbody.innerHTML = draftLines.map((line, idx) => `
      <tr data-line-id="${line.id}">
        <td><select class="je-line-account" data-idx="${idx}">${accountOptionsHtml(line.accountId)}</select></td>
        <td><input type="number" min="0" step="0.01" class="je-line-debit" data-idx="${idx}" value="${line.debit}" style="width:100px;" /></td>
        <td><input type="number" min="0" step="0.01" class="je-line-credit" data-idx="${idx}" value="${line.credit}" style="width:100px;" /></td>
        <td><input type="text" class="je-line-memo" data-idx="${idx}" value="${line.memo}" placeholder="بيان السطر..." /></td>
        <td><input type="text" class="je-line-cost-center" data-idx="${idx}" value="${line.costCenter}" placeholder="اختياري" style="width:110px;" /></td>
        <td>
          <button class="row-action-btn is-danger" data-remove-line="${idx}" title="حذف السطر" ${draftLines.length <= 2 ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".je-line-account").forEach((el) => el.addEventListener("change", (e) => { draftLines[e.target.dataset.idx].accountId = e.target.value; }));
    tbody.querySelectorAll(".je-line-debit").forEach((el) => el.addEventListener("input", (e) => {
      const idx = e.target.dataset.idx;
      draftLines[idx].debit = Number(e.target.value) || 0;
      if (draftLines[idx].debit > 0) draftLines[idx].credit = 0; // a line is either a debit or a credit, never both
      renderLines();
    }));
    tbody.querySelectorAll(".je-line-credit").forEach((el) => el.addEventListener("input", (e) => {
      const idx = e.target.dataset.idx;
      draftLines[idx].credit = Number(e.target.value) || 0;
      if (draftLines[idx].credit > 0) draftLines[idx].debit = 0;
      renderLines();
    }));
    tbody.querySelectorAll(".je-line-memo").forEach((el) => el.addEventListener("input", (e) => { draftLines[e.target.dataset.idx].memo = e.target.value; }));
    tbody.querySelectorAll(".je-line-cost-center").forEach((el) => el.addEventListener("input", (e) => { draftLines[e.target.dataset.idx].costCenter = e.target.value; }));
    tbody.querySelectorAll("[data-remove-line]").forEach((btn) => btn.addEventListener("click", () => {
      if (draftLines.length <= 2) return; // a journal entry needs at least 2 lines to balance
      draftLines.splice(Number(btn.dataset.removeLine), 1);
      renderLines();
    }));

    updateBalanceCalculator();
  }

  function updateBalanceCalculator() {
    const totalDebit = draftLines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    const totalCredit = draftLines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    const difference = Math.round((totalDebit - totalCredit) * 100) / 100;

    document.getElementById("je-total-debit").textContent = totalDebit.toFixed(2);
    document.getElementById("je-total-credit").textContent = totalCredit.toFixed(2);
    const diffEl = document.getElementById("je-difference");
    diffEl.textContent = difference.toFixed(2);
    diffEl.style.color = difference === 0 ? "var(--emerald)" : "var(--coral)";

    return { totalDebit, totalCredit, difference };
  }

  // =========================================================================
  // Save (create or update a Draft)
  // =========================================================================

  function saveEntry() {
    const { totalDebit, totalCredit, difference } = updateBalanceCalculator();

    if (totalDebit === 0 && totalCredit === 0) { alert("القيد فارغ — أدخل قيمة في سطر واحد على الأقل."); return; }
    if (difference !== 0) { alert(`القيد غير متوازن — الفارق بين المدين والدائن هو ${difference.toFixed(2)}. لازم يكون صفر قبل الحفظ.`); return; }

    const validLines = draftLines.filter((l) => l.accountId && (l.debit > 0 || l.credit > 0));
    if (validLines.length < 2) { alert("القيد لازم يحتوي على سطرين على الأقل، كل سطر باختيار حساب ومبلغ."); return; }

    const description = document.getElementById("je-description").value.trim();
    if (!description) { alert("البيان العام مطلوب."); return; }

    const entries = readEntries();

    if (editingEntryId) {
      const idx = entries.findIndex((e) => e.id === editingEntryId);
      if (idx === -1) return;
      if (entries[idx].status !== "draft") { alert("لا يمكن تعديل قيد بعد تقديمه إلا وهو لا يزال مسودة."); return; }
      entries[idx] = {
        ...entries[idx],
        date: document.getElementById("je-date").value || CORE.todayISO(),
        reference: document.getElementById("je-reference").value.trim(),
        description,
        lines: validLines,
        totalDebit,
        totalCredit,
      };
    } else {
      entries.push({
        id: `je_${Date.now()}`,
        number: document.getElementById("je-number").value,
        date: document.getElementById("je-date").value || CORE.todayISO(),
        reference: document.getElementById("je-reference").value.trim(),
        description,
        lines: validLines,
        totalDebit,
        totalCredit,
        status: "draft",
        reversedBy: null,
        reversesEntryId: null,
        createdAt: `${CORE.todayISO()}`,
      });
    }

    writeEntries(entries);
    renderJournalModule();
  }

  // =========================================================================
  // Posting effect — the ONLY place that ever mutates vv_chart_of_accounts
  // balances from this file. Called exclusively from inside the
  // registered Apply Handler below, never directly from a button. Every
  // line's account is validated to exist BEFORE any balance is touched —
  // an entry referencing a missing account fails entirely, with a clear
  // reason, instead of silently applying some lines and skipping others.
  // =========================================================================

  function applyPostingEffect(entry, sign) {
    const accounts = readAccounts();

    const missingLine = entry.lines.find((line) => !accounts.some((a) => a.id === line.accountId));
    if (missingLine) {
      return { success: false, reason: `الحساب المرتبط بأحد سطور القيد (معرف: ${missingLine.accountId}) لم يعد موجودًا — تعذّر الترحيل. لم يتم تعديل أي رصيد.` };
    }

    entry.lines.forEach((line) => {
      const acc = accounts.find((a) => a.id === line.accountId);
      const netEffect = acc.nature === "debit" ? (line.debit - line.credit) : (line.credit - line.debit);
      acc.balance = Math.round((Number(acc.balance || 0) + netEffect * sign) * 100) / 100;
    });
    writeAccounts(accounts);
    return { success: true };
  }

  // =========================================================================
  // Entries list table
  // =========================================================================

  function renderEntriesTable() {
    const query = (document.getElementById("je-search").value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("je-status-filter").value;

    let rows = readEntries();
    if (query) rows = rows.filter((e) => e.number.toLowerCase().includes(query) || e.description.toLowerCase().includes(query));
    if (statusFilter) rows = rows.filter((e) => e.status === statusFilter);
    rows = [...rows].sort((a, b) => (b.id > a.id ? 1 : -1));

    const tbody = document.getElementById("je-table-body");
    const table = document.getElementById("je-table");
    const empty = document.getElementById("je-empty-state");

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((entry) => `
      <tr>
        <td>${entry.date}</td>
        <td class="mono">${entry.number}${entry.reversesEntryId ? " (عكسي)" : ""}</td>
        <td>${entry.description}</td>
        <td class="num">${CORE.formatMoney(entry.totalDebit)}</td>
        <td>${WF.badgeHtml(entry.status)}${entry.reversedBy ? ' <span class="badge badge--pending">تم عكسه</span>' : ""}</td>
        <td>
          <div class="row-actions">
            <button class="row-action-btn" data-view-entry="${entry.id}" title="عرض">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/></svg>
            </button>
            ${entry.status === "draft" ? `
              <button class="row-action-btn" data-edit-entry="${entry.id}" title="تعديل المسودة">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>` : ""}
            ${entry.status !== "posted" && !entry.reversedBy && entry.status !== "posting" ? WF.actionsHtml(entry, { allowReverse: false }) : ""}
            ${entry.status === "posted" && !entry.reversedBy && !entry.reversalState ? `<button class="btn-workflow-next" data-reverse-entry="${entry.id}">عكس القيد (Reverse)</button>` : ""}
            ${(entry.status === "posting" || entry.reversalState === "in_progress") ? `<span class="badge badge--pending" title="عملية سابقة لم تكتمل — يحتاج مراجعة يدوية">⚠️ يحتاج مراجعة</span>` : ""}
          </div>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-view-entry]").forEach((btn) => btn.addEventListener("click", () => viewEntry(btn.dataset.viewEntry)));
    tbody.querySelectorAll("[data-edit-entry]").forEach((btn) => btn.addEventListener("click", () => loadEntryForEdit(btn.dataset.editEntry)));
    tbody.querySelectorAll("[data-reverse-entry]").forEach((btn) => btn.addEventListener("click", () => submitReversalRequest(btn.dataset.reverseEntry)));

    WF.wireButtons(tbody, {
      records: rows,
      onAdvance: (record, fromStatus) => {
        // The approved -> posted step is the only one that touches money —
        // it must go through VVChangeRequests, never a direct write. Note
        // `record.status` was already mutated in place by accounts_core.js's
        // shared workflow engine before this callback runs (to "posted"
        // for this specific transition); we deliberately ignore that
        // mutated in-memory value and only ever act on `record.id`,
        // re-reading everything fresh inside submitPostingRequest().
        if (fromStatus === "approved") {
          submitPostingRequest(record.id);
          return;
        }
        // draft -> submitted, submitted -> approved: unchanged — no
        // financial effect, so these stay as simple direct writes exactly
        // as before.
        const entries = readEntries();
        const idx = entries.findIndex((e) => e.id === record.id);
        if (idx === -1) return;
        entries[idx].status = record.status;
        writeEntries(entries);
        renderEntriesTable();
      },
      onDelete: (record) => {
        if (record.status !== "draft") { alert("لا يمكن حذف قيد إلا وهو مسودة."); return; }
        writeEntries(readEntries().filter((e) => e.id !== record.id));
        renderEntriesTable();
      },
      onReverse: () => {}, // reverse is handled by the dedicated button above (creates a new entry, doesn't reuse this generic hook)
    });
  }

  function viewEntry(id) {
    const entry = readEntries().find((e) => e.id === id);
    if (!entry) return;
    const accounts = readAccounts();
    const lines = entry.lines.map((l) => {
      const acc = accounts.find((a) => a.id === l.accountId);
      return `${acc ? acc.name : "?"}: مدين ${l.debit.toFixed(2)} / دائن ${l.credit.toFixed(2)}${l.memo ? " — " + l.memo : ""}`;
    }).join("\n");
    alert(`القيد ${entry.number}\n${entry.description}\n\n${lines}`);
  }

  function loadEntryForEdit(id) {
    const entry = readEntries().find((e) => e.id === id);
    if (!entry || entry.status !== "draft") return;

    editingEntryId = id;
    draftLines = entry.lines.map((l) => ({ ...l }));
    if (draftLines.length < 2) draftLines.push(blankLine());

    document.getElementById("je-form-title").textContent = `تعديل القيد ${entry.number}`;
    document.getElementById("je-number").value = entry.number;
    document.getElementById("je-date").value = entry.date;
    document.getElementById("je-reference").value = entry.reference || "";
    document.getElementById("je-description").value = entry.description;
    document.getElementById("btn-cancel-je-edit").style.display = "inline-flex";

    renderLines();
    const panel = document.getElementById("je-form-panel");
    if (typeof panel.scrollIntoView === "function") panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /**
   * Reversal request — validates the same rules that used to gate direct
   * mutation (posted, not already reversed), then hands off entirely to
   * VVChangeRequests. No direct write happens here, and no direct
   * ManagerOverride call either — approval (and its own ManagerOverride
   * gate) is VVChangeRequests' job alone now.
   */
  function submitReversalRequest(id) {
    const entries = readEntries();
    const original = entries.find((e) => e.id === id);
    if (!original) { alert("القيد لم يعد موجودًا."); return; }
    if (original.reversalState === "in_progress") { alert("هذا القيد في حالة عكس معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية قبل أي محاولة جديدة."); return; }
    if (original.status !== "posted") { alert("لا يمكن عكس قيد إلا وهو مُرحّل."); return; }
    if (original.reversedBy) { alert("هذا القيد تم عكسه بالفعل."); return; }

    const reason = prompt("سبب عكس القيد:", "");
    if (reason === null) return; // user cancelled — no request created

    const request = window.VVChangeRequests.createRequest({
      module: "journal_entries",
      changeType: "reverse",
      targetId: original.id,
      targetLabel: `${original.number} — ${original.description}`,
      payload: { reason: (reason || "").trim() },
    });
    if (request) {
      alert(request.status === "approved"
        ? `تم عكس القيد ${original.number} فورًا.`
        : `تم إرسال طلب عكس القيد ${original.number} — بانتظار اعتماد المالك/الـIT.`);
      renderEntriesTable();
    }
  }

  /**
   * Posting request — the approved -> posted transition, routed through
   * VVChangeRequests instead of a direct write. No payload beyond the
   * target is needed: everything the Apply Handler needs (lines, amounts)
   * already lives on the entry itself in vv_journal_entries.
   */
  function submitPostingRequest(entryId) {
    const entries = readEntries();
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) { alert("القيد لم يعد موجودًا."); return; }
    if (entry.status === "posting") { alert("هذا القيد في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية قبل أي محاولة جديدة."); return; }
    if (entry.status !== "approved") { alert(`لا يمكن ترحيل القيد — حالته الحالية "${WF.label(entry.status)}"، ويجب أن تكون "معتمد".`); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "journal_entries",
      changeType: "post",
      targetId: entry.id,
      targetLabel: `${entry.number} — ${entry.description}`,
      payload: {},
    });
    if (request) {
      alert(request.status === "approved"
        ? `تم ترحيل القيد ${entry.number} فورًا.`
        : `تم إرسال طلب ترحيل القيد ${entry.number} — بانتظار اعتماد المالك/الـIT.`);
      renderEntriesTable();
    }
  }

  // =========================================================================
  // Apply Handler — registered with the shared change_requests.js engine.
  // This is the ONLY place applyPostingEffect() is ever called from.
  //
  // Atomicity note (honest, not a claim): writing vv_chart_of_accounts and
  // vv_journal_entries are two SEPARATE localStorage.setItem() calls —
  // there is no cross-key transaction in Web Storage, so they can never
  // be made truly atomic as a pair from this file (or any file) alone.
  // What this DOES do: write an intent marker into vv_journal_entries
  // BEFORE ever touching accounts, so that if an interruption (crash/
  // reload/tab-kill) happens between the accounts write and the final
  // status write, the entry is left in a visibly "stuck" transient state
  // (status "posting", or reversalState "in_progress") that the Apply
  // Handler explicitly refuses to act on again — converting a silent,
  // retriable, double-application risk into a detectable, blocked one
  // that needs a human to resolve. It does not — and cannot — guarantee
  // the interrupted operation gets automatically completed or rolled
  // back; only that it can never be silently re-applied.
  // =========================================================================

  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("journal_entries", (request) => {
      if (window.VVPermissions && window.VVAuth) {
        const actingUser = window.VVAuth.getCurrentUser();
        const requiredPermission = window.VVPermissions.permissionForAction({ module: "journal_entries", changeType: request.changeType, payload: request.payload });
        if (!window.VVPermissions.can(actingUser, requiredPermission)) {
          return { success: false, reason: "ليس لديك الصلاحية الكافية لتنفيذ هذه العملية." };
        }
      }

      const entries = readEntries();
      const entry = entries.find((e) => e.id === request.targetId);

      if (request.changeType === "post") {
        if (!entry) return { success: false, reason: "القيد المستهدف لم يعد موجودًا." };

        if (entry.status === "posting") {
          return { success: false, reason: "هذا القيد في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل (انقطاع محتمل) — يحتاج مراجعة يدوية قبل أي محاولة جديدة. لا يمكن إعادة المحاولة تلقائيًا لتجنّب مضاعفة الأثر المالي." };
        }
        if (entry.status !== "approved") {
          return { success: false, reason: `حالة القيد الحالية "${WF.label(entry.status)}" — يجب أن تكون "معتمد" قبل الترحيل (ربما تم ترحيله بالفعل من مكان آخر).` };
        }

        // Phase 1 — mark intent BEFORE touching accounts. If interrupted
        // right here, recovery is trivial and certain: accounts were
        // never written to.
        const idx = entries.findIndex((e) => e.id === entry.id);
        entries[idx].status = "posting";
        writeEntries(entries);

        // Phase 2 — the actual financial mutation.
        const postResult = applyPostingEffect(entry, 1);

        if (!postResult.success) {
          // applyPostingEffect() validates everything BEFORE writing
          // anything, so a failure here means accounts were, with
          // certainty, never touched — safe to fully revert the marker.
          const revertEntries = readEntries();
          const revertIdx = revertEntries.findIndex((e) => e.id === entry.id);
          if (revertIdx !== -1) { revertEntries[revertIdx].status = "approved"; writeEntries(revertEntries); }
          return postResult;
        }

        // Phase 3 — only now, after the mutation is confirmed durable,
        // record the true final state and clear the intent marker.
        const finalEntries = readEntries();
        const finalIdx = finalEntries.findIndex((e) => e.id === entry.id);
        if (finalIdx !== -1) { finalEntries[finalIdx].status = "posted"; writeEntries(finalEntries); }
        return { success: true };
      }

      if (request.changeType === "reverse") {
        if (!entry) return { success: false, reason: "القيد الأصلي لم يعد موجودًا." };

        if (entry.reversalState === "in_progress") {
          return { success: false, reason: "هذا القيد في حالة عكس معلّقة من محاولة سابقة لم تكتمل (انقطاع محتمل) — يحتاج مراجعة يدوية قبل أي محاولة جديدة. لا يمكن إعادة المحاولة تلقائيًا لتجنّب مضاعفة الأثر المالي." };
        }
        if (entry.status !== "posted") {
          return { success: false, reason: `لا يمكن عكس قيد حالته "${WF.label(entry.status)}" — يجب أن يكون "مُرحّل".` };
        }
        if (entry.reversedBy) {
          return { success: false, reason: "هذا القيد تم عكسه بالفعل (ربما من مكان آخر منذ إرسال الطلب)." };
        }

        // Phase 1 — mark intent on the ORIGINAL entry before touching
        // accounts. Same certainty guarantee as Posting above.
        const idx = entries.findIndex((e) => e.id === entry.id);
        entries[idx].reversalState = "in_progress";
        writeEntries(entries);

        const reversedLines = entry.lines.map((l) => ({
          ...l,
          id: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          debit: l.credit,
          credit: l.debit,
        }));

        const reversingEntry = {
          id: `je_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          number: nextEntryNumber(),
          date: CORE.todayISO(),
          reference: entry.number,
          description: `قيد عكسي للقيد ${entry.number}${request.payload.reason ? " — " + request.payload.reason : ""}`,
          lines: reversedLines,
          totalDebit: entry.totalCredit,
          totalCredit: entry.totalDebit,
          status: "posted",
          reversedBy: null,
          reversesEntryId: entry.id,
          createdAt: CORE.todayISO(),
        };

        // Phase 2 — the actual financial mutation.
        const postResult = applyPostingEffect(reversingEntry, 1);

        if (!postResult.success) {
          const revertEntries = readEntries();
          const revertIdx = revertEntries.findIndex((e) => e.id === entry.id);
          if (revertIdx !== -1) { revertEntries[revertIdx].reversalState = null; writeEntries(revertEntries); }
          return postResult; // nothing else written — no reversing entry created, original's reversedBy untouched
        }

        // Phase 3 — record the true final state, clear the intent marker.
        const finalEntries = readEntries();
        const finalIdx = finalEntries.findIndex((e) => e.id === entry.id);
        if (finalIdx !== -1) {
          finalEntries[finalIdx].reversedBy = reversingEntry.id;
          finalEntries[finalIdx].reversalState = null;
        }
        finalEntries.push(reversingEntry);
        writeEntries(finalEntries);
        return { success: true };
      }

      return { success: false, reason: `نوع طلب غير معروف لقيود اليومية: ${request.changeType}` };
    });
  }

  // =========================================================================
  // Self-wire the dashboard's Quick Action trigger + register the module
  // =========================================================================

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.journal = renderJournalModule;

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="journal"], #qa-journal').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("journal"));
    });
  });
})();