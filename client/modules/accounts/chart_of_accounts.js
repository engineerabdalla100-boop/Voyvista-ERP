/**
 * chart_of_accounts.js — client/modules/accounts/ (شجرة الحسابات)
 * -----------------------------------------------------------------------
 * Registers into VVAccountsModules.chartOfAccounts and self-wires its own
 * trigger button(s) on the dashboard — there's no separate accounts.js
 * orchestrator in this project, so every module file here is responsible
 * for finding and wiring its own Quick Action card. This listens for
 * either `[data-view="chartOfAccounts"]` or `#qa-coa` / `#btn-open-coa`,
 * whichever actually exists in accounts.html — if none of those match
 * your real button's id/attribute, tell me the exact one and it's a
 * one-line fix.
 *
 * Data store: vv_chart_of_accounts — an array of:
 *   { id, parentId, code, name, type, nature, currency, openingBalance,
 *     balance, status }
 *   type   : "asset" | "liability" | "equity" | "revenue" | "expense"
 *   nature : "debit" | "credit" — which side increases this account's
 *            balance; journal_entries.js reads this when posting.
 *   status : "active" | "inactive" | "postable"
 *
 * "Add Account" stays a small modal (per your instruction) — it's the
 * only modal inside this otherwise full-width SPA view.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;

  const TYPE_LABELS = { asset: "أصول", liability: "خصوم", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" };
  const TYPE_COLORS = {
    asset: { bg: "#DCFCE7", fg: "#1E9D6E" },
    liability: { bg: "#FCE7E7", fg: "#D14848" },
    equity: { bg: "#EDE9FE", fg: "#7C5CE0" },
    revenue: { bg: "#E7EEFD", fg: "#3068E0" },
    expense: { bg: "#FBEFDA", fg: "#C98A1E" },
  };
  const TYPE_CODE_PREFIX = { asset: "1", liability: "2", equity: "3", revenue: "4", expense: "5" };
  const NATURE_LABELS = { debit: "مدين", credit: "دائن" };
  const STATUS_LABELS = { active: "نشط", inactive: "غير نشط", postable: "قابل للترحيل المباشر" };
  const CURRENCIES = ["EGP", "USD", "EUR", "SAR", "AED"];

  function readAccounts() { return CORE.readStore("vv_chart_of_accounts", []); }
  function writeAccounts(accounts) { CORE.writeStore("vv_chart_of_accounts", accounts); }

  /** journal_entries.js posts here — read directly so "total movements" per account stays accurate without any cross-file function call dependency. */
  function readJournalEntries() { return CORE.readStore("vv_journal_entries", []); }

  function seedDefaultAccountsIfEmpty() {
    let accounts = readAccounts();
    if (accounts.length > 0) return accounts;
    accounts = [
      { id: "coa_1", parentId: null, code: "1000", name: "الأصول", type: "asset", nature: "debit", currency: "EGP", openingBalance: 0, balance: 0, status: "active" },
      { id: "coa_2", parentId: "coa_1", code: "1010", name: "الخزينة الرئيسية", type: "asset", nature: "debit", currency: "EGP", openingBalance: 0, balance: 0, status: "postable" },
      { id: "coa_3", parentId: null, code: "2000", name: "الخصوم", type: "liability", nature: "credit", currency: "EGP", openingBalance: 0, balance: 0, status: "active" },
      { id: "coa_4", parentId: null, code: "3000", name: "حقوق الملكية", type: "equity", nature: "credit", currency: "EGP", openingBalance: 0, balance: 0, status: "active" },
      { id: "coa_5", parentId: null, code: "4000", name: "الإيرادات", type: "revenue", nature: "credit", currency: "EGP", openingBalance: 0, balance: 0, status: "active" },
      { id: "coa_6", parentId: null, code: "5000", name: "المصروفات", type: "expense", nature: "debit", currency: "EGP", openingBalance: 0, balance: 0, status: "active" },
    ];
    writeAccounts(accounts);
    return accounts;
  }

  function suggestNextCode(accounts, type, parentId) {
    if (parentId) {
      const parent = accounts.find((a) => a.id === parentId);
      if (!parent) return "";
      const siblings = accounts.filter((a) => a.parentId === parentId);
      const base = parent.code;
      let n = siblings.length + 1;
      let candidate;
      do { candidate = `${base}${String(n).padStart(2, "0")}`; n++; }
      while (accounts.some((a) => a.code === candidate));
      return candidate;
    }
    const prefix = TYPE_CODE_PREFIX[type] || "9";
    const roots = accounts.filter((a) => !a.parentId && a.code.startsWith(prefix));
    let n = roots.length;
    let candidate;
    do { n++; candidate = `${prefix}${String(n * 100).padStart(3, "0")}`; }
    while (accounts.some((a) => a.code === candidate));
    return candidate;
  }

  /**
   * PART 1A — Circular Hierarchy Guard.
   * Walks UP the ancestor chain starting from `proposedParentId` (proposed
   * parent, then its parent, then its parent's parent...). If `accountId`
   * ever appears in that chain, setting accountId.parentId = proposedParentId
   * would create a cycle (direct or indirect, any depth) — this catches
   * both `A → A` and `A → B → C → A` alike, not just the direct
   * `parentId === accountId` case the code checked before.
   *
   * A stray/dangling parentId chain (pointing at an account that no longer
   * resolves) stops the walk safely rather than looping forever — same
   * defensive posture as the orphan-safe tree rendering below.
   */
  function wouldCreateCircularHierarchy(accounts, accountId, proposedParentId) {
    if (!proposedParentId) return false; // moving to root level can never be circular
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    let cursor = proposedParentId;
    const visited = new Set(); // guards against pre-existing corrupt cycles causing an infinite loop here
    while (cursor) {
      if (cursor === accountId) return true;
      if (visited.has(cursor)) return false; // already-corrupt chain unrelated to this account; not this function's concern
      visited.add(cursor);
      const node = accountsById.get(cursor);
      if (!node) return false; // dangling reference — stop, not circular through this path
      cursor = node.parentId;
    }
    return false;
  }

  // Which parents are currently expanded — kept in module-level state so
  // it survives re-renders triggered by search/filter, but resets on a
  // fresh switchAccountView("chartOfAccounts") call (new visit = clean slate).
  let expandedIds = new Set();
  let selectedAccountId = null;
  let editingAccountId = null;

  // =========================================================================
  // Main render
  // =========================================================================

  function renderChartOfAccountsModule() {
    seedDefaultAccountsIfEmpty();
    expandedIds = new Set(readAccounts().filter((a) => !a.parentId).map((a) => a.id)); // roots open by default
    selectedAccountId = null;

    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div class="table-controls" style="margin-bottom:16px; justify-content: space-between;">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div class="search-wrap" style="width:260px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" id="coa-search" placeholder="بحث بالاسم أو الكود..." />
          </div>
          <select id="coa-type-filter" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12.5px;">
            <option value="">كل الأنواع</option>
            ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
        <button class="btn btn--primary" id="btn-open-add-account" type="button">+ إضافة حساب</button>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 320px; gap:20px; align-items:start;">
        <div class="ledger-scroll" style="max-height:65vh; overflow-y:auto;">
          <div class="coa-tree" id="coa-tree" style="padding:14px;"></div>
        </div>
        <div id="coa-detail-panel"></div>
      </div>
    `;

    document.getElementById("coa-search").addEventListener("input", renderTree);
    document.getElementById("coa-type-filter").addEventListener("change", renderTree);
    document.getElementById("btn-open-add-account").addEventListener("click", () => openAccountModal(null));

    renderTree();
    renderDetailPanel();
  }

  // =========================================================================
  // Tree (expand/collapse, search, filter)
  // =========================================================================

  function renderTree() {
    const accounts = readAccounts();
    const query = (document.getElementById("coa-search").value || "").trim().toLowerCase();
    const typeFilter = document.getElementById("coa-type-filter").value;

    const matches = (acc) =>
      (!query || acc.name.toLowerCase().includes(query) || acc.code.toLowerCase().includes(query)) &&
      (!typeFilter || acc.type === typeFilter);

    // If searching/filtering, auto-expand every ancestor of a match so results are visible
    if (query || typeFilter) {
      accounts.filter(matches).forEach((acc) => {
        let cursor = acc.parentId;
        while (cursor) {
          expandedIds.add(cursor);
          cursor = (accounts.find((a) => a.id === cursor) || {}).parentId;
        }
      });
    }

    // PART 1A — orphan safety: a `parentId` that no longer resolves to a
    // real account (stale/corrupt data) must never make that account
    // silently disappear from the tree. Treat it as an effective root so
    // it still renders and stays reachable/editable.
    const accountIds = new Set(accounts.map((a) => a.id));
    const isOrphan = (a) => a.parentId && !accountIds.has(a.parentId);
    const roots = accounts.filter((a) => !a.parentId || isOrphan(a));
    const childrenOf = (id) => accounts.filter((a) => a.parentId === id && !isOrphan(a));

    function subtreeHasMatch(acc) {
      if (matches(acc)) return true;
      return childrenOf(acc.id).some(subtreeHasMatch);
    }

    function renderNode(acc, depth) {
      if ((query || typeFilter) && !subtreeHasMatch(acc)) return "";
      const kids = childrenOf(acc.id);
      const hasKids = kids.length > 0;
      const isExpanded = expandedIds.has(acc.id);
      const color = TYPE_COLORS[acc.type] || TYPE_COLORS.asset;
      const movementCount = readJournalEntries().reduce(
        (sum, je) => sum + je.lines.filter((l) => l.accountId === acc.id).length, 0
      );

      let html = `
        <div class="coa-row" data-account-id="${acc.id}" style="margin-inline-start:${depth * 24}px; cursor:pointer; ${selectedAccountId === acc.id ? "border-color:var(--gold); background:var(--gold-soft);" : ""}">
          <div style="display:flex; align-items:center; gap:8px;">
            ${hasKids ? `<button class="coa-toggle-btn" data-toggle-id="${acc.id}" style="background:none;border:none;cursor:pointer;color:var(--text-soft);font-size:11px;width:16px;">${isExpanded ? "▾" : "◂"}</button>` : `<span style="width:16px;display:inline-block;"></span>`}
            <span class="coa-row__name">${acc.name}</span>
            <span class="coa-row__code">${acc.code}</span>
            ${acc.status === "inactive" ? '<span class="badge badge--pending" style="font-size:9px;">غير نشط</span>' : ""}
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="coa-type-chip" style="background:${color.bg};color:${color.fg};">${TYPE_LABELS[acc.type]}</span>
            <span style="font-size:10px; color:var(--text-faint);">${movementCount} حركة</span>
            <strong>${CORE.formatMoney(acc.balance, acc.currency)}</strong>
          </div>
        </div>`;

      if (hasKids && isExpanded) {
        kids.forEach((child) => { html += renderNode(child, depth + 1); });
      }
      return html;
    }

    const treeHtml = roots.map((r) => renderNode(r, 0)).join("");
    document.getElementById("coa-tree").innerHTML = treeHtml || `<div class="empty-state"><p>لا توجد حسابات مطابقة</p></div>`;

    document.querySelectorAll("[data-toggle-id]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.toggleId;
        if (expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
        renderTree();
      });
    });
    document.querySelectorAll(".coa-row[data-account-id]").forEach((row) => {
      row.addEventListener("click", () => {
        selectedAccountId = row.dataset.accountId;
        renderTree();
        renderDetailPanel();
      });
    });
  }

  // =========================================================================
  // Side detail panel
  // =========================================================================

  function renderDetailPanel() {
    const panel = document.getElementById("coa-detail-panel");
    const accounts = readAccounts();
    const acc = accounts.find((a) => a.id === selectedAccountId);

    if (!acc) {
      panel.innerHTML = `
        <div class="report-panel">
          <p style="font-size:12px; color:var(--text-faint);">اضغط على أي حساب في الشجرة لعرض تفاصيله هنا.</p>
        </div>`;
      return;
    }

    const children = accounts.filter((a) => a.parentId === acc.id);
    const movementCount = readJournalEntries().reduce(
      (sum, je) => sum + je.lines.filter((l) => l.accountId === acc.id).length, 0
    );
    const color = TYPE_COLORS[acc.type] || TYPE_COLORS.asset;

    panel.innerHTML = `
      <div class="report-panel">
        <h4 style="display:flex; align-items:center; justify-content:space-between;">
          ${acc.name}
          <button class="row-action-btn" id="btn-edit-account" title="تعديل">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </h4>
        <div class="report-row"><span>الكود</span><strong class="mono">${acc.code}</strong></div>
        <div class="report-row"><span>النوع</span><span class="coa-type-chip" style="background:${color.bg};color:${color.fg};">${TYPE_LABELS[acc.type]}</span></div>
        <div class="report-row"><span>طبيعة الحساب</span><strong>${NATURE_LABELS[acc.nature]}</strong></div>
        <div class="report-row"><span>الحالة</span><strong>${STATUS_LABELS[acc.status]}</strong></div>
        <div class="report-row"><span>العملة</span><strong>${acc.currency}</strong></div>
        <div class="report-row"><span>الرصيد الافتتاحي</span><strong>${CORE.formatMoney(acc.openingBalance, acc.currency)}</strong></div>
        <div class="report-row"><span>الرصيد الحالي</span><strong style="color:${acc.balance >= 0 ? "var(--emerald)" : "var(--coral)"};">${CORE.formatMoney(acc.balance, acc.currency)}</strong></div>
        <div class="report-row"><span>عدد الحسابات الفرعية</span><strong>${children.length}</strong></div>
        <div class="report-row"><span>إجمالي الحركات</span><strong>${movementCount}</strong></div>
        ${renderLinkedPartySection(acc)}
        ${children.length > 0 ? `
          <div style="margin-top:12px;">
            <div style="font-size:11.5px; font-weight:700; color:var(--text-soft); margin-bottom:6px;">الحسابات الفرعية:</div>
            ${children.map((c) => `<div class="report-row"><span>${c.name}</span><strong>${CORE.formatMoney(c.balance, c.currency)}</strong></div>`).join("")}
          </div>` : ""}
      </div>`;

    document.getElementById("btn-edit-account").addEventListener("click", () => openAccountModal(acc.id));
    wireLinkedPartyActions(acc);
  }

  // =========================================================================
  // PART 1B — minimal "Linked Party" section inside the existing Account
  // Detail panel. Not a Party page, not a picker UI beyond a plain
  // dropdown of existing active Parties — exactly the "minimal" scope
  // asked for. Every Link/Unlink click goes through the same
  // window.VVChangeRequests engine as every other change here (same
  // Maker-Checker cycle, same self-approver bypass, same alert wording
  // pattern already established for Chart of Accounts requests).
  // =========================================================================

  function renderLinkedPartySection(acc) {
    if (!window.VVPartyCore) return ""; // party_core.js not loaded on this page — degrade silently, nothing else here depends on it

    const linkedParty = window.VVPartyCore.getLinkedPartyForAccount(acc.id);
    if (linkedParty) {
      return `
        <div class="report-row">
          <span>الجهة المرتبطة (Linked Party)</span>
          <span style="display:flex; align-items:center; gap:8px;">
            <strong>${linkedParty.displayName}</strong>
            <span style="font-size:10px; color:var(--text-faint);">(${window.VVPartyCore.TYPE_LABELS[linkedParty.type]})</span>
            <button class="row-action-btn is-danger" id="btn-unlink-party" title="إلغاء الربط" style="width:22px;height:22px;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </span>
        </div>`;
    }

    const availableParties = window.VVPartyCore.getActive().filter((p) => !p.accountId);
    return `
      <div class="report-row" style="align-items:flex-start;">
        <span>الجهة المرتبطة (Linked Party)</span>
        <span style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <span style="font-size:11px; color:var(--text-faint);">لا توجد جهة مرتبطة بهذا الحساب</span>
          ${availableParties.length > 0 ? `
            <div style="display:flex; gap:6px;">
              <select id="link-party-select" style="font-size:11px; padding:4px 8px; border:1px solid var(--border); border-radius:6px;">
                <option value="">اختر جهة...</option>
                ${availableParties.map((p) => `<option value="${p.id}">${p.displayName} (${window.VVPartyCore.TYPE_LABELS[p.type]})</option>`).join("")}
              </select>
              <button class="btn btn--ghost" id="btn-link-party" style="font-size:11px; padding:4px 10px;">ربط</button>
            </div>` : `<span style="font-size:10.5px; color:var(--text-faint);">لا توجد جهات متاحة للربط حاليًا</span>`}
        </span>
      </div>`;
  }

  function wireLinkedPartyActions(acc) {
    document.getElementById("btn-unlink-party")?.addEventListener("click", () => {
      const linkedParty = window.VVPartyCore.getLinkedPartyForAccount(acc.id);
      if (!linkedParty) return;
      if (!confirm(`إلغاء ربط "${linkedParty.displayName}" بهذا الحساب؟ (الجهة والحساب يظلان موجودين، فقط الرابط بينهما يُزال)`)) return;
      const request = window.VVPartyCore.createUnlinkRequest(linkedParty.id);
      if (request) {
        alert(request.status === "approved" ? "تم إلغاء الربط فورًا." : "تم إرسال طلب إلغاء الربط — بانتظار اعتماد المالك/الـIT.");
        renderDetailPanel();
      }
    });
    document.getElementById("btn-link-party")?.addEventListener("click", () => {
      const partyId = document.getElementById("link-party-select").value;
      if (!partyId) { alert("اختر جهة أولًا."); return; }
      const request = window.VVPartyCore.createLinkRequest(partyId, acc.id);
      if (request) {
        alert(request.status === "approved" ? "تم الربط فورًا." : "تم إرسال طلب الربط — بانتظار اعتماد المالك/الـIT.");
        renderDetailPanel();
      }
    });
  }

  // =========================================================================
  // Add / Edit Account modal (the one modal inside this SPA view)
  // =========================================================================

  function ensureModalExists() {
    if (document.getElementById("modal-add-account")) return;
    const modal = document.createElement("div");
    modal.className = "vv-modal-overlay";
    modal.id = "modal-add-account";
    modal.innerHTML = `
      <div class="vv-modal">
        <div class="vv-modal__header">
          <div class="vv-modal__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span id="add-account-modal-title">إضافة حساب</span>
          </div>
          <button class="vv-modal__close" id="btn-close-add-account" aria-label="إغلاق">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="vv-modal__body">
          <div class="vv-field">
            <label>حساب رئيسي (اختياري)</label>
            <select id="acc-parent-select"><option value="">-- بدون (حساب مستقل من المستوى الأول) --</option></select>
          </div>
          <div class="vv-field-row">
            <div class="vv-field"><label>كود الحساب</label><input type="text" id="acc-code" placeholder="1010" /></div>
            <div class="vv-field"><label>اسم الحساب</label><input type="text" id="acc-name" placeholder="اسم الحساب..." /></div>
          </div>
          <div class="vv-field-row">
            <div class="vv-field"><label>نوع الحساب</label>
              <select id="acc-type">
                ${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
              </select>
            </div>
            <div class="vv-field"><label>طبيعة الحساب</label>
              <select id="acc-nature">
                <option value="debit">مدين</option>
                <option value="credit">دائن</option>
              </select>
            </div>
          </div>
          <div class="vv-field-row">
            <div class="vv-field"><label>العملة</label>
              <select id="acc-currency">${CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
            </div>
            <div class="vv-field"><label>حالة الحساب</label>
              <select id="acc-status">
                <option value="active">نشط</option>
                <option value="postable">قابل للترحيل المباشر</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>
          <div class="vv-field"><label>الرصيد الافتتاحي</label><input type="number" step="0.01" id="acc-opening-balance" value="0" /></div>
        </div>
        <div class="vv-modal__footer">
          <button class="btn btn--ghost" id="btn-cancel-add-account" type="button">إلغاء</button>
          <button class="btn btn--primary" id="btn-save-account" type="button">حفظ الحساب</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById("btn-close-add-account").addEventListener("click", closeAccountModal);
    document.getElementById("btn-cancel-add-account").addEventListener("click", closeAccountModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeAccountModal(); });
    document.getElementById("acc-type").addEventListener("change", (e) => {
      // Assets & Expenses are debit-natured by convention; Liabilities/Equity/Revenue are credit-natured
      document.getElementById("acc-nature").value = (e.target.value === "asset" || e.target.value === "expense") ? "debit" : "credit";
    });
    document.getElementById("acc-parent-select").addEventListener("change", () => {
      const accounts = readAccounts();
      const type = document.getElementById("acc-type").value;
      const parentId = document.getElementById("acc-parent-select").value || null;
      if (!editingAccountId) document.getElementById("acc-code").value = suggestNextCode(accounts, type, parentId);
    });
    document.getElementById("btn-save-account").addEventListener("click", saveAccount);
  }

  function openAccountModal(accountId) {
    ensureModalExists();
    editingAccountId = accountId;
    const accounts = readAccounts();
    const acc = accountId ? accounts.find((a) => a.id === accountId) : null;

    document.getElementById("add-account-modal-title").textContent = acc ? "تعديل حساب" : "إضافة حساب";

    const parentSelect = document.getElementById("acc-parent-select");
    parentSelect.innerHTML = '<option value="">-- بدون (حساب مستقل من المستوى الأول) --</option>' +
      accounts.filter((a) => a.id !== accountId).map((a) => `<option value="${a.id}">${a.code} — ${a.name}</option>`).join("");

    if (acc) {
      parentSelect.value = acc.parentId || "";
      document.getElementById("acc-code").value = acc.code;
      document.getElementById("acc-name").value = acc.name;
      document.getElementById("acc-type").value = acc.type;
      document.getElementById("acc-nature").value = acc.nature;
      document.getElementById("acc-currency").value = acc.currency;
      document.getElementById("acc-status").value = acc.status;
      document.getElementById("acc-opening-balance").value = acc.openingBalance;
    } else {
      parentSelect.value = "";
      document.getElementById("acc-type").value = "asset";
      document.getElementById("acc-nature").value = "debit";
      document.getElementById("acc-currency").value = "EGP";
      document.getElementById("acc-status").value = "active";
      document.getElementById("acc-opening-balance").value = "0";
      document.getElementById("acc-code").value = suggestNextCode(accounts, "asset", null);
      document.getElementById("acc-name").value = "";
    }

    document.getElementById("modal-add-account").classList.add("is-open");
  }

  function closeAccountModal() {
    document.getElementById("modal-add-account")?.classList.remove("is-open");
    editingAccountId = null;
  }

  function accountMovementCount(accountId) {
    return readJournalEntries().reduce((sum, je) => sum + je.lines.filter((l) => l.accountId === accountId).length, 0);
  }

  function saveAccount() {
    const code = document.getElementById("acc-code").value.trim();
    const name = document.getElementById("acc-name").value.trim();
    if (!code || !name) { alert("كود الحساب واسمه مطلوبان."); return; }

    const accounts = readAccounts();
    const duplicateCode = accounts.find((a) => a.code === code && a.id !== editingAccountId);
    if (duplicateCode) { alert(`الكود "${code}" مستخدم بالفعل في حساب آخر.`); return; }

    const parentId = document.getElementById("acc-parent-select").value || null;

    // PART 1A — full parent validation, not just the direct self-parent case.
    if (parentId) {
      const parentAccount = accounts.find((a) => a.id === parentId);
      if (!parentAccount) { alert("الحساب الرئيسي المختار لم يعد موجودًا — اختر حسابًا آخر."); return; }
      if (parentAccount.status === "inactive") { alert(`الحساب الرئيسي "${parentAccount.name}" غير نشط — لا يمكن اختياره كأب لحساب جديد أو معدَّل.`); return; }
      if (editingAccountId && wouldCreateCircularHierarchy(accounts, editingAccountId, parentId)) {
        alert("لا يمكن اختيار هذا الحساب كأب — سيؤدي ذلك لعلاقة دائرية (مباشرة أو غير مباشرة) في شجرة الحسابات.");
        return;
      }
    }

    const openingBalance = Number(document.getElementById("acc-opening-balance").value) || 0;
    const newValues = {
      parentId,
      code,
      name,
      type: document.getElementById("acc-type").value,
      nature: document.getElementById("acc-nature").value,
      currency: document.getElementById("acc-currency").value,
      status: document.getElementById("acc-status").value,
      openingBalance,
    };

    if (!editingAccountId) {
      // Adding a brand-new account: applied immediately for Owner/IT
      // (they'd only be approving themselves), sent to Pending for
      // everyone else.
      const request = window.VVChangeRequests.createRequest({
        module: "chart_of_accounts",
        changeType: "create",
        targetId: null,
        targetLabel: `${code} — ${name}`,
        payload: newValues,
      });
      alert(request.status === "approved"
        ? `تم إضافة الحساب "${name}" فورًا.`
        : `تم إرسال طلب إضافة الحساب "${name}" — بانتظار اعتماد المالك/الـIT.`);
      closeAccountModal();
      return;
    }

    // Editing an existing account — figure out what actually changed first.
    const original = accounts.find((a) => a.id === editingAccountId);
    const fieldLabels = { parentId: "الحساب الرئيسي", code: "الكود", name: "الاسم", type: "النوع", nature: "الطبيعة", currency: "العملة", status: "الحالة", openingBalance: "الرصيد الافتتاحي" };
    const fieldChanges = Object.keys(newValues)
      .filter((key) => String(original[key]) !== String(newValues[key]))
      .map((key) => ({ field: fieldLabels[key], key, oldValue: original[key], newValue: newValues[key] }));

    if (fieldChanges.length === 0) { alert("لا يوجد أي تغيير فعلي."); closeAccountModal(); return; }

    // Hard lock — never subject to approval, not even by the Owner: an
    // account with real financial movements can never have its code
    // changed or be deleted. Editing is limited to name and status here.
    const movementCount = accountMovementCount(editingAccountId);
    if (movementCount > 0) {
      const forbiddenChange = fieldChanges.find((c) => !["name", "status"].includes(c.key));
      if (forbiddenChange) {
        alert(`هذا الحساب عليه ${movementCount} حركة فعلية — لا يمكن تعديل "${forbiddenChange.field}"، التعديل يقتصر على الاسم أو الحالة (تفعيل/تعطيل) فقط.`);
        return;
      }
    }

    const request = window.VVChangeRequests.createRequest({
      module: "chart_of_accounts",
      changeType: "edit",
      targetId: editingAccountId,
      targetLabel: `${original.code} — ${original.name}`,
      payload: newValues,
      fieldChanges,
    });
    alert(request.status === "approved"
      ? `تم تعديل الحساب "${original.name}" فورًا.`
      : `تم إرسال طلب تعديل الحساب "${original.name}" — بانتظار اعتماد المالك/الـIT.`);
    closeAccountModal();
  }

  /**
   * PATCH — Approval Gap fix.
   * -----------------------------------------------------------------------
   * Everything checked in saveAccount() at T0 (request submission) can go
   * stale by T2 (approval) — the account may have grown real movements at
   * T1, another request may have taken its code, its chosen parent may
   * have moved or been deactivated, or (defensively) the target account
   * itself may no longer exist. This function re-runs every critical
   * check against the CURRENT state of `accounts` right before writing,
   * not against whatever was true when the request was created. It
   * returns either { ok: true } or { ok: false, reason }, and the caller
   * below never applies a partial change: either every check passes and
   * the full write happens, or nothing is written and the request stays
   * pending for a human to resolve.
   */
  function validateRequestAtApplyTime(accounts, request) {
    const payload = request.payload || {};

    if (request.changeType === "create") {
      if (payload.parentId) {
        const parent = accounts.find((a) => a.id === payload.parentId);
        if (!parent) return { ok: false, reason: `الحساب الرئيسي المختار لم يعد موجودًا.` };
        if (parent.status === "inactive") return { ok: false, reason: `الحساب الرئيسي "${parent.name}" أصبح غير نشط.` };
        // No circular-hierarchy check needed here: this is a brand-new
        // account with an ID that doesn't exist yet, so it cannot already
        // be an ancestor of anything — a cycle is mathematically
        // impossible for a genuine create, only for edits of existing nodes.
      }
      if (accounts.some((a) => a.code === payload.code)) {
        return { ok: false, reason: `الكود "${payload.code}" أصبح مستخدمًا في حساب آخر منذ إرسال الطلب.` };
      }
      return { ok: true };
    }

    if (request.changeType === "edit") {
      const current = accounts.find((a) => a.id === request.targetId);
      if (!current) return { ok: false, reason: "الحساب المستهدف لم يعد موجودًا." };

      // Re-check duplicate code against everyone ELSE, using current data.
      if (payload.code && payload.code !== current.code && accounts.some((a) => a.code === payload.code && a.id !== request.targetId)) {
        return { ok: false, reason: `الكود "${payload.code}" أصبح مستخدمًا في حساب آخر منذ إرسال الطلب.` };
      }

      // Re-check parent, fresh, against current tree shape.
      if (payload.parentId) {
        const parent = accounts.find((a) => a.id === payload.parentId);
        if (!parent) return { ok: false, reason: "الحساب الرئيسي المختار لم يعد موجودًا." };
        if (parent.status === "inactive") return { ok: false, reason: `الحساب الرئيسي "${parent.name}" أصبح غير نشط.` };
        if (payload.parentId === request.targetId) return { ok: false, reason: "لا يمكن أن يكون الحساب أباً لنفسه." };
        if (wouldCreateCircularHierarchy(accounts, request.targetId, payload.parentId)) {
          return { ok: false, reason: "الأب المختار سيؤدي الآن لعلاقة دائرية في شجرة الحسابات (تغيّرت الشجرة منذ إرسال الطلب)." };
        }
      }

      // Re-check the movement lock fresh — this is the core of the gap:
      // an account with zero movements at T0 may have real movements by
      // T2, and the ONLY changes still allowed on a moved account are
      // name/status. Compare payload against CURRENT values, not the
      // diff captured back at submission time.
      const movementCount = accountMovementCount(request.targetId);
      if (movementCount > 0) {
        const guardedFields = ["code", "parentId", "type", "nature", "currency", "openingBalance"];
        const stillChanged = guardedFields.find((key) => String(current[key]) !== String(payload[key]));
        if (stillChanged) {
          const fieldLabels = { code: "الكود", parentId: "الحساب الرئيسي", type: "النوع", nature: "الطبيعة", currency: "العملة", openingBalance: "الرصيد الافتتاحي" };
          return { ok: false, reason: `هذا الحساب أصبح عليه ${movementCount} حركة فعلية منذ إرسال الطلب — لا يمكن تطبيق تغيير "${fieldLabels[stillChanged]}"، التعديل يقتصر الآن على الاسم أو الحالة فقط.` };
        }
      }

      return { ok: true };
    }

    return { ok: false, reason: `نوع طلب غير معروف: ${request.changeType}` };
  }

  // Registers how an approved Chart of Accounts request actually gets
  // applied — this is the ONLY place vv_chart_of_accounts is written to
  // as a result of a Maker's add/edit action.
  //
  // Contract with change_requests.js: this handler returns
  // { success: true } once everything is written, or
  // { success: false, reason: "..." } if apply-time validation fails —
  // it no longer alerts or logs on failure itself. change_requests.js is
  // the one place that decides how a failed apply gets surfaced (status,
  // audit fields, any UI messaging), since it's the one that actually
  // knows the full Approval-vs-Apply picture; this handler's only job is
  // reporting truthfully whether the write happened.
  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("chart_of_accounts", (request) => {
      // Last-line-of-defense permission check — independent of whatever
      // path led here (self-execution or a reviewer's approval click).
      // Even a direct Console call to a registered handler must still be
      // blocked without the right permission.
      if (window.VVPermissions && window.VVAuth) {
        const actingUser = window.VVAuth.getCurrentUser();
        const requiredPermission = window.VVPermissions.permissionForAction({ module: "chart_of_accounts", changeType: request.changeType, payload: request.payload });
        if (!window.VVPermissions.can(actingUser, requiredPermission)) {
          return { success: false, reason: "ليس لديك الصلاحية الكافية لتنفيذ هذه العملية." };
        }
      }

      const accounts = readAccounts();

      const validation = validateRequestAtApplyTime(accounts, request);
      if (!validation.ok) {
        return { success: false, reason: validation.reason }; // nothing written — accounts array discarded as-is, untouched
      }

      // Validation passed in full — apply everything in one shot, no
      // partial writes.
      if (request.changeType === "create") {
        accounts.push({ id: `coa_${Date.now()}`, ...request.payload, balance: request.payload.openingBalance });
      } else if (request.changeType === "edit") {
        const idx = accounts.findIndex((a) => a.id === request.targetId);
        const delta = request.payload.openingBalance - accounts[idx].openingBalance;
        accounts[idx] = { ...accounts[idx], ...request.payload, balance: accounts[idx].balance + delta };
      }

      writeAccounts(accounts);
      // Only re-render if the Chart of Accounts view happens to be open
      // right now — approval often happens from the Dashboard's Pending
      // Approvals panel instead, where this module's DOM doesn't exist.
      if (document.getElementById("coa-search")) {
        renderTree();
        renderDetailPanel();
      }
      return { success: true };
    });
  }

  // =========================================================================
  // Self-wire the dashboard's Quick Action trigger + register the module
  // =========================================================================

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.chartOfAccounts = renderChartOfAccountsModule;
  window.VVAccountsModules.coa = renderChartOfAccountsModule; // alias, in case the button uses this key instead

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="chartOfAccounts"], [data-view="coa"], #qa-coa, #btn-open-coa').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("chartOfAccounts"));
    });
  });
})();