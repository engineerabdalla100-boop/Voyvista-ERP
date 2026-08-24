/**
 * customer_ledger.js — client/modules/accounts/ (العملاء والموردين)
 * -----------------------------------------------------------------------
 * Renders into #module-body when switchAccountView("parties") is called.
 * Customers & Suppliers share this one file since they're mirror images
 * of the same screen (a list + an "add new" form + a drill-down statement).
 *
 * Data model — two stores, kept deliberately separate:
 *
 *   1. vv_acc_customers / vv_acc_suppliers (owned by accounting-engine.js)
 *      { [name]: { balance, ledger: [{transactionId, date, type, amount,
 *      description}] } } — this is the SAME store every Flights/Hotels/
 *      Visas sale, and every posted voucher, already writes to. A party
 *      created here manually (before any sale exists) writes into the
 *      exact same shape, so it behaves identically everywhere else in
 *      the app the moment a real transaction touches it.
 *
 *   2. vv_acc_party_meta (owned entirely by this file)
 *      { [name]: { code, type, phone, email, address, currency,
 *      creditLimit, openingBalance } } — everything accounting-engine.js
 *      doesn't track. Kept separate on purpose so its tested internals
 *      never had to change shape.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;

  const CURRENCIES = ["EGP", "USD", "EUR", "SAR", "AED"];

  // ---- vv_acc_party_meta helpers ----
  function readMeta() { return CORE.readStore("vv_acc_party_meta", {}); }
  function writeMeta(meta) { CORE.writeStore("vv_acc_party_meta", meta); }

  function getMetaFor(meta, name, type) {
    if (!meta[name]) {
      meta[name] = {
        code: generateCode(meta, type),
        type,
        phone: "",
        email: "",
        address: "",
        currency: "EGP",
        creditLimit: 0,
        openingBalance: 0,
        parentParty: "", // name of another party of the SAME type this is a sub-account of, or "" for a root account
      };
    }
    return meta[name];
  }

  function generateCode(meta, type) {
    const prefix = type === "customer" ? "CUST" : "SUPP";
    const existingCount = Object.values(meta).filter((m) => m.type === type).length;
    return `${prefix}-${String(existingCount + 1).padStart(4, "0")}`;
  }

  // ---- vv_acc_customers / vv_acc_suppliers helpers ----
  function storeKeyFor(type) { return type === "customer" ? "vv_acc_customers" : "vv_acc_suppliers"; }

  function readPartyStore(type) {
    if (window.VVAccounting) {
      return type === "customer" ? window.VVAccounting.getCustomers() : window.VVAccounting.getSuppliers();
    }
    return CORE.readStore(storeKeyFor(type), {});
  }
  function writePartyStore(type, store) { CORE.writeStore(storeKeyFor(type), store); }

  let currentPartyType = "customer"; // "customer" | "supplier"
  let showAddForm = false;
  let editingPartyName = null; // non-null while the form is in "edit" mode instead of "add new"

  // =========================================================================
  // Main render
  // =========================================================================

  function renderPartiesModule(params) {
    currentPartyType = (params && params.type) || currentPartyType || "customer";
    showAddForm = false;

    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div class="vv-tabs" style="margin-bottom:16px;">
        <div class="vv-tab ${currentPartyType === "customer" ? "is-active" : ""}" id="tab-customers" data-party-type="customer">العملاء</div>
        <div class="vv-tab ${currentPartyType === "supplier" ? "is-active" : ""}" id="tab-suppliers" data-party-type="supplier">الموردين</div>
      </div>

      <div class="table-controls" style="margin-bottom:14px; justify-content: space-between;">
        <div class="search-wrap" style="width:300px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="party-search" placeholder="بحث بالاسم أو كود الحساب..." />
        </div>
        <button class="btn btn--primary" id="btn-toggle-add-party" type="button">+ إضافة ${currentPartyType === "customer" ? "عميل" : "مورد"} جديد</button>
      </div>

      <div id="add-party-form-wrap" style="display:none; margin-bottom:24px;"></div>

      <div class="ledger-scroll">
        <table class="acc-table" id="parties-table">
          <thead>
            <tr><th>الكود</th><th>الاسم</th><th>الهاتف</th><th>الرصيد الافتتاحي</th><th>الرصيد الحالي</th><th>حد الائتمان</th><th>الحالة</th><th>الإجراءات</th></tr>
          </thead>
          <tbody id="parties-table-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="parties-empty-state" style="display:none;">
        <p>لا توجد بيانات بعد</p>
      </div>

      <!-- Statement drill-down (hidden until a row is opened) -->
      <div id="party-statement" style="display:none; margin-top:26px;">
        <div class="section-title">
          <h2 id="statement-party-name"></h2>
          <button class="btn btn--ghost" id="btn-close-statement" type="button" style="font-size:12px;">إغلاق كشف الحساب</button>
        </div>
        <div class="ledger-scroll">
          <table class="acc-table">
            <thead><tr><th>التاريخ</th><th>البيان</th><th class="num">مدين</th><th class="num">دائن</th><th class="num">الرصيد التراكمي</th></tr></thead>
            <tbody id="statement-table-body"></tbody>
          </table>
        </div>
      </div>
    `;

    document.querySelectorAll(".vv-tab[data-party-type]").forEach((tab) => {
      tab.addEventListener("click", () => {
        currentPartyType = tab.dataset.partyType;
        renderPartiesModule({ type: currentPartyType });
      });
    });

    document.getElementById("party-search").addEventListener("input", renderPartiesTable);
    document.getElementById("btn-close-statement").addEventListener("click", () => {
      document.getElementById("party-statement").style.display = "none";
    });
    document.getElementById("btn-toggle-add-party").addEventListener("click", () => {
      showAddForm = !showAddForm;
      renderAddPartyForm();
    });

    renderPartiesTable();
  }

  // =========================================================================
  // Add new customer/supplier form
  // =========================================================================

  function renderAddPartyForm(prefilledParent) {
    const wrap = document.getElementById("add-party-form-wrap");
    if (!showAddForm) {
      wrap.style.display = "none";
      wrap.innerHTML = "";
      return;
    }

    const isEditing = !!editingPartyName;
    const isCustomer = currentPartyType === "customer";
    const meta = readMeta();
    const existingNamesOfType = Object.keys(readPartyStore(currentPartyType)).filter((n) => n !== editingPartyName);
    const editingMeta = isEditing ? getMetaFor(meta, editingPartyName, currentPartyType) : null;

    wrap.style.display = "block";
    wrap.innerHTML = `
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px;">
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">
          ${isEditing ? `تعديل بيانات "${editingPartyName}"` : `بيانات ${isCustomer ? "العميل" : "المورد"} الجديد`}
        </h3>
        ${!isEditing ? `
        <div class="vv-field">
          <label>الحساب الرئيسي (اختياري — لإنشاء حساب فرعي تحت عميل/مورد موجود)</label>
          <select id="np-parent">
            <option value="">-- بدون (حساب مستقل) --</option>
            ${existingNamesOfType.map((n) => `<option value="${n}" ${n === prefilledParent ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>` : ""}
        <div class="vv-field-row">
          <div class="vv-field"><label>الاسم</label><input type="text" id="np-name" placeholder="اسم ${isCustomer ? "العميل" : "المورد"}..." ${isEditing ? "readonly" : ""} /></div>
          <div class="vv-field"><label>النوع</label>
            <select id="np-type" ${isEditing ? "disabled" : ""}>
              <option value="customer" ${isCustomer ? "selected" : ""}>عميل</option>
              <option value="supplier" ${!isCustomer ? "selected" : ""}>مورد</option>
            </select>
          </div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>رقم الهاتف</label><input type="text" id="np-phone" placeholder="01xxxxxxxxx" /></div>
          <div class="vv-field"><label>البريد الإلكتروني</label><input type="email" id="np-email" placeholder="name@example.com" /></div>
        </div>
        <div class="vv-field"><label>العنوان</label><input type="text" id="np-address" placeholder="العنوان بالتفصيل..." /></div>
        <div class="vv-field-row">
          <div class="vv-field"><label>حد الائتمان</label><input type="number" min="0" step="0.01" id="np-credit-limit" value="0" /></div>
          <div class="vv-field"><label>العملة</label>
            <select id="np-currency">${CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          </div>
        </div>
        ${!isEditing ? `
        <div class="vv-field-row">
          <div class="vv-field"><label>نوع الرصيد الافتتاحي</label>
            <select id="np-opening-side">
              <option value="debit">مدين (له علينا / يستحق علينا)</option>
              <option value="credit">دائن (علينا له / رصيد مقدّم)</option>
            </select>
          </div>
          <div class="vv-field"><label>قيمة الرصيد الافتتاحي</label><input type="number" min="0" step="0.01" id="np-opening-amount" value="0" /></div>
        </div>` : `<p style="font-size:11px; color:var(--text-faint); margin-bottom:10px;">الرصيد الافتتاحي والنوع لا يمكن تغييرهما بعد إنشاء الحساب — لتصحيح الرصيد استخدم سند قبض/صرف بدلًا من ذلك.</p>`}
        <div style="display:flex; gap:10px; margin-top:6px;">
          <button class="btn btn--primary" id="btn-save-new-party" type="button">${isEditing ? "حفظ التعديلات" : "حفظ"}</button>
          <button class="btn btn--ghost" id="btn-cancel-new-party" type="button">إلغاء</button>
        </div>
      </div>
    `;

    if (isEditing) {
      document.getElementById("np-name").value = editingPartyName;
      document.getElementById("np-type").value = currentPartyType;
      document.getElementById("np-phone").value = editingMeta.phone || "";
      document.getElementById("np-email").value = editingMeta.email || "";
      document.getElementById("np-address").value = editingMeta.address || "";
      document.getElementById("np-credit-limit").value = editingMeta.creditLimit || 0;
      document.getElementById("np-currency").value = editingMeta.currency || "EGP";
    } else {
      document.getElementById("np-type").value = currentPartyType;
      document.getElementById("np-currency").value = "EGP";
    }

    document.getElementById("btn-cancel-new-party").addEventListener("click", () => {
      showAddForm = false;
      editingPartyName = null;
      renderAddPartyForm();
    });

    document.getElementById("btn-save-new-party").addEventListener("click", isEditing ? saveEditedParty : saveNewParty);
  }

  function saveEditedParty() {
    const phone = document.getElementById("np-phone").value.trim();
    const email = document.getElementById("np-email").value.trim();
    const address = document.getElementById("np-address").value.trim();
    const creditLimit = Number(document.getElementById("np-credit-limit").value) || 0;
    const currency = document.getElementById("np-currency").value;

    if (creditLimit < 0) { alert("حد الائتمان لا يمكن أن يكون بالسالب."); return; }

    const meta = readMeta();
    const partyMeta = getMetaFor(meta, editingPartyName, currentPartyType);
    partyMeta.phone = phone;
    partyMeta.email = email;
    partyMeta.address = address;
    partyMeta.creditLimit = creditLimit;
    partyMeta.currency = currency;
    writeMeta(meta);

    showAddForm = false;
    editingPartyName = null;
    renderAddPartyForm();
    renderPartiesTable();
  }

  function saveNewParty() {
    const name = document.getElementById("np-name").value.trim();
    const type = document.getElementById("np-type").value;
    const parentParty = document.getElementById("np-parent").value || "";
    const phone = document.getElementById("np-phone").value.trim();
    const email = document.getElementById("np-email").value.trim();
    const address = document.getElementById("np-address").value.trim();
    const creditLimit = Number(document.getElementById("np-credit-limit").value) || 0;
    const currency = document.getElementById("np-currency").value;
    const openingSide = document.getElementById("np-opening-side").value;
    const openingAmountRaw = Number(document.getElementById("np-opening-amount").value) || 0;

    if (!name) { alert("اسم العميل/المورد مطلوب."); return; }
    if (name === parentParty) { alert("لا يمكن أن يكون الحساب فرعًا لنفسه."); return; }

    const store = readPartyStore(type);
    if (store[name]) {
      alert(`يوجد بالفعل ${type === "customer" ? "عميل" : "مورد"} بنفس الاسم "${name}".`);
      return;
    }
    if (creditLimit < 0) { alert("حد الائتمان لا يمكن أن يكون بالسالب."); return; }
    if (openingAmountRaw < 0) { alert("قيمة الرصيد الافتتاحي لا يمكن أن تكون بالسالب — استخدم القائمة (مدين/دائن) لتحديد الاتجاه."); return; }

    // Debit = the party owes us (positive balance in our convention);
    // Credit = we owe them / they've prepaid (negative balance).
    const signedOpening = openingSide === "credit" ? -openingAmountRaw : openingAmountRaw;

    store[name] = {
      balance: signedOpening,
      ledger: openingAmountRaw > 0 ? [{
        transactionId: `opening_${Date.now()}`,
        date: CORE.todayISO(),
        type: "opening_balance",
        amount: signedOpening,
        description: "رصيد افتتاحي",
      }] : [],
    };
    writePartyStore(type, store);

    const meta = readMeta();
    meta[name] = {
      code: generateCode(meta, type),
      type,
      parentParty,
      phone,
      email,
      address,
      currency,
      creditLimit,
      openingBalance: signedOpening,
    };
    writeMeta(meta);

    showAddForm = false;
    currentPartyType = type;
    renderPartiesModule({ type });
  }

  // =========================================================================
  // Table (search/filter by name or account code)
  // =========================================================================

  function renderPartiesTable() {
    const query = (document.getElementById("party-search").value || "").trim().toLowerCase();
    const store = readPartyStore(currentPartyType);
    const meta = readMeta();

    let names = Object.keys(store);
    if (query) {
      names = names.filter((name) => {
        const partyMeta = getMetaFor(meta, name, currentPartyType);
        return name.toLowerCase().includes(query) || (partyMeta.code || "").toLowerCase().includes(query);
      });
    }

    const tbody = document.getElementById("parties-table-body");
    const table = document.getElementById("parties-table");
    const empty = document.getElementById("parties-empty-state");

    if (names.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      writeMeta(meta); // persist any codes generated above even if the table ends up empty after filtering
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    // Group into a simple one-level parent/child tree so sub-accounts render
    // indented directly under their parent, same visual idea as the Chart
    // of Accounts tree. A party whose parent got filtered out by the search
    // above still shows (search matches should never "hide" a result).
    const nameSet = new Set(names);
    const roots = names.filter((n) => {
      const p = getMetaFor(meta, n, currentPartyType).parentParty;
      return !p || !nameSet.has(p);
    });
    const childrenOf = (parentName) => names.filter((n) => getMetaFor(meta, n, currentPartyType).parentParty === parentName);

    function renderRow(name, depth) {
      const partyMeta = getMetaFor(meta, name, currentPartyType);
      const currentBalance = store[name].balance || 0;
      const overLimit = partyMeta.creditLimit > 0 && currentBalance > partyMeta.creditLimit;
      const hasLedgerHistory = (store[name].ledger || []).length > 0;
      const hasChildren = childrenOf(name).length > 0;
      const canDelete = currentBalance === 0 && !hasLedgerHistory && !hasChildren;

      let rowHtml = `
        <tr>
          <td class="mono" style="font-size:11px; color:var(--text-faint);">${partyMeta.code}</td>
          <td class="cell-primary" style="padding-inline-start:${14 + depth * 22}px;">${depth > 0 ? "↳ " : ""}${name}</td>
          <td>${partyMeta.phone || "—"}</td>
          <td class="num">${CORE.formatMoney(partyMeta.openingBalance, partyMeta.currency)}</td>
          <td class="num" style="color:${currentBalance > 0 ? "var(--coral)" : "var(--emerald)"};">${CORE.formatMoney(currentBalance, partyMeta.currency)}</td>
          <td class="num">${partyMeta.creditLimit ? CORE.formatMoney(partyMeta.creditLimit, partyMeta.currency) : "—"}</td>
          <td>${overLimit ? '<span class="badge badge--pending">تجاوز الحد</span>' : '<span class="badge badge--posted">ضمن الحد</span>'}</td>
          <td>
            <div class="row-actions">
              <button class="row-action-btn" data-view-statement="${name}" title="كشف حساب">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </button>
              <button class="row-action-btn" data-edit-meta="${name}" title="تعديل البيانات">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              </button>
              ${depth === 0 ? `
              <button class="row-action-btn" data-add-sub="${name}" title="إضافة حساب فرعي">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
              </button>` : ""}
              <button class="row-action-btn is-danger" data-delete-party="${name}" title="${canDelete ? "حذف" : "اضغط لمعرفة سبب منع الحذف"}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
          </td>
        </tr>`;

      childrenOf(name).forEach((childName) => { rowHtml += renderRow(childName, depth + 1); });
      return rowHtml;
    }

    tbody.innerHTML = roots.map((n) => renderRow(n, 0)).join("");

    writeMeta(meta); // persist any newly-generated codes

    tbody.querySelectorAll("[data-view-statement]").forEach((btn) => {
      btn.addEventListener("click", () => openStatement(btn.dataset.viewStatement));
    });
    tbody.querySelectorAll("[data-edit-meta]").forEach((btn) => {
      btn.addEventListener("click", () => editPartyMeta(btn.dataset.editMeta));
    });
    tbody.querySelectorAll("[data-add-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        showAddForm = true;
        renderAddPartyForm(btn.dataset.addSub);
        const wrap = document.getElementById("add-party-form-wrap");
        if (wrap && typeof wrap.scrollIntoView === "function") wrap.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    tbody.querySelectorAll("[data-delete-party]").forEach((btn) => {
      btn.addEventListener("click", () => deleteParty(btn.dataset.deleteParty));
    });
  }

  // =========================================================================
  // Delete a customer/supplier — only when it's completely "clean": zero
  // balance, no ledger history, and no sub-accounts depending on it. This
  // mirrors the same "no deleting anything with real history" rule used
  // everywhere else in this accounting module.
  // =========================================================================

  function deleteParty(name) {
    const store = readPartyStore(currentPartyType);
    const partyData = store[name];
    if (!partyData) return;

    const meta = readMeta();
    const hasChildren = Object.keys(meta).some((n) => meta[n].parentParty === name);
    if (hasChildren) { alert(`لا يمكن حذف "${name}" — يوجد حسابات فرعية تابعة له. احذف الحسابات الفرعية أولاً.`); return; }
    if ((partyData.balance || 0) !== 0) { alert(`لا يمكن حذف "${name}" — الرصيد الحالي ليس صفرًا (${CORE.formatMoney(partyData.balance)}).`); return; }
    if ((partyData.ledger || []).length > 0) { alert(`لا يمكن حذف "${name}" — يوجد حركات مسجّلة على هذا الحساب.`); return; }

    if (!confirm(`حذف "${name}" نهائيًا؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;

    delete store[name];
    writePartyStore(currentPartyType, store);
    delete meta[name];
    writeMeta(meta);

    renderPartiesTable();
  }

  // =========================================================================
  // Edit existing party's extra info (phone/email/address/credit limit) —
  // opens the same form used for "Add New" in edit mode, instead of a
  // chain of native prompt() popups.
  // =========================================================================

  function editPartyMeta(name) {
    editingPartyName = name;
    showAddForm = true;
    renderAddPartyForm();
    const wrap = document.getElementById("add-party-form-wrap");
    if (wrap && typeof wrap.scrollIntoView === "function") wrap.scrollIntoView({ behavior: "smooth", block: "start" });
    renderPartiesTable();
  }

  // =========================================================================
  // Detailed statement (Debit / Credit / running balance)
  // =========================================================================

  function openStatement(name) {
    const store = readPartyStore(currentPartyType);
    const partyData = store[name];
    if (!partyData) return;

    const meta = readMeta();
    const partyMeta = getMetaFor(meta, name, currentPartyType);

    document.getElementById("statement-party-name").textContent = `كشف حساب: ${name} (${partyMeta.code})`;
    document.getElementById("party-statement").style.display = "block";
    const statementEl = document.getElementById("party-statement");
    if (typeof statementEl.scrollIntoView === "function") {
      statementEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // The opening balance already lives as the first ledger entry when this
    // party was created through the form above, or is simply 0 for parties
    // that only ever came from a sale — either way, don't double-count it.
    let runningBalance = 0;
    const rows = [];

    [...partyData.ledger]
      .sort((a, b) => CORE.parseLocalDate(a.date) - CORE.parseLocalDate(b.date))
      .forEach((entry) => {
        runningBalance += entry.amount;
        const isDebit = entry.amount >= 0;
        rows.push(`
          <tr>
            <td>${entry.date}</td>
            <td>${entry.description}</td>
            <td class="num amount-out">${isDebit ? CORE.formatMoney(entry.amount, partyMeta.currency) : "—"}</td>
            <td class="num amount-in">${!isDebit ? CORE.formatMoney(Math.abs(entry.amount), partyMeta.currency) : "—"}</td>
            <td class="num">${CORE.formatMoney(runningBalance, partyMeta.currency)}</td>
          </tr>`);
      });

    document.getElementById("statement-table-body").innerHTML = rows.join("") ||
      `<tr><td colspan="5" style="text-align:center; color:var(--text-faint);">لا توجد حركات على هذا الحساب بعد</td></tr>`;
  }

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.parties = renderPartiesModule;

  // Self-wire the dashboard's own trigger button — there's no accounts.js
  // orchestrator in this project to do this generically, so (like
  // chart_of_accounts.js and journal_entries.js) this file finds and
  // wires its own Quick Action card.
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="parties"], #qa-parties').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("parties"));
    });
  });
})();