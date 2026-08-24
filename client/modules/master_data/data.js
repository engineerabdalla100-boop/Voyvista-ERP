/**
 * data.js — client/modules/data/data.html (قسم البيانات)
 * -----------------------------------------------------------------------
 * Fully self-contained — does NOT load or depend on anything from
 * /client/modules/accounts/ (that module is finished and stays untouched).
 * This file has its own small SPA switcher, its own utilities, and reads
 * the exact same shared stores customers.js / client_data_picker.js
 * already use, so a company or person picked from a booking page's
 * "Client Data" button shows up here automatically — one source of truth.
 *
 * Package 1 — B2B: customer-type parties with clientCategory === "b2b"
 * Package 2 — B2C: customer-type parties with clientCategory === "b2c"
 *   Both packages share ONE renderer, parameterized by category — a
 *   company account (B2B) and a family account (B2C) are structurally
 *   identical (root + children, same dynamic activity sorting, same
 *   passport/birthday filters), they just differ in the category filter.
 * Package 3 — Accounting: General Sales Report (pending, color-coded by
 *   department) + Analyse (reviewed, grouped by supplier) + chart. Reads
 *   the exact same vv_sales_data / vv_hotel_sales_data / vv_visa_sales_data
 *   this whole app already uses, writing only the reviewStatus field.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  // =========================================================================
  // Shared utilities (self-contained — no external core file needed)
  // =========================================================================

  const CURRENCY_SYMBOLS = { EGP: "ج.م", USD: "$", EUR: "€", SAR: "ر.س", AED: "د.إ" };
  const symbol = (c) => CURRENCY_SYMBOLS[c] || c || "";
  const money = (amount, currency) => `${Number(amount || 0).toLocaleString("en-US")} ${symbol(currency)}`;
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const parseLocalDate = (s) => {
    if (!s) return new Date(NaN);
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  function readStore(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? fallback : v; } catch (e) { return fallback; }
  }
  function writeStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  // =========================================================================
  // SPA switcher — local to this page only
  // =========================================================================

  const MODULE_TITLES = { b2b: "B2B — حسابات الشركات", b2c: "B2C — عملاء أفراد وعائلات", accounting: "Accounting — تقرير المبيعات والتحليل" };
  const MODULE_RENDERERS = {};

  function switchDataView(viewId) {
    const dashboard = document.getElementById("dashboard-main-view");
    const detail = document.getElementById("module-detail-view");
    if (!dashboard || !detail) return;

    dashboard.style.display = "none";
    detail.style.display = "block";
    detail.innerHTML = `
      <div class="module-toolbar">
        <h2 class="module-toolbar__title">${MODULE_TITLES[viewId] || ""}</h2>
        <button class="module-back-btn" id="btn-back-data-dashboard" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          رجوع
        </button>
      </div>
      <div id="module-body"></div>
    `;
    document.getElementById("btn-back-data-dashboard").addEventListener("click", backToDataDashboard);

    const renderer = MODULE_RENDERERS[viewId];
    if (typeof renderer === "function") renderer();
    else document.getElementById("module-body").innerHTML = `<div class="empty-state"><p>هذه الوحدة غير متاحة بعد.</p></div>`;
  }

  function backToDataDashboard() {
    document.getElementById("module-detail-view").style.display = "none";
    document.getElementById("module-detail-view").innerHTML = "";
    document.getElementById("dashboard-main-view").style.display = "block";
  }

  document.getElementById("pkg-b2b").addEventListener("click", () => switchDataView("b2b"));
  document.getElementById("pkg-b2c").addEventListener("click", () => switchDataView("b2c"));
  document.getElementById("pkg-accounting").addEventListener("click", () => switchDataView("accounting"));

  // =========================================================================
  // B2B / B2C — shared family-hierarchy renderer (customer-type only,
  // never suppliers; filtered by clientCategory instead of by type tabs)
  // =========================================================================

  function readCustomers() { return readStore("vv_acc_customers", {}); }
  function writeCustomers(store) { writeStore("vv_acc_customers", store); }
  function readMeta() { return readStore("vv_acc_party_meta", {}); }
  function writeMeta(meta) { writeStore("vv_acc_party_meta", meta); }

  function getMetaFor(meta, name) {
    if (!meta[name]) {
      meta[name] = {
        code: `CUST-${String(Object.keys(meta).length + 1).padStart(4, "0")}`, type: "customer",
        phone: "", email: "", address: "", currency: "EGP", creditLimit: 0, openingBalance: 0,
        parentParty: "", passportNumber: "", passportExpiry: "", dateOfBirth: "", nationalId: "",
        clientCategory: "b2c", isVIP: false, relationship: "", jobTitle: "",
      };
    }
    return meta[name];
  }

  function getBookingsForName(name) {
    const bookings = [];
    readStore("vv_sales_data", []).forEach((r) => { if (r.passengerName === name) bookings.push({ date: r.date, dept: "طيران", supplier: r.supplier || "غير محدد", sellingRate: Number(r.sellingRate) || 0, currency: r.currency || "EGP", description: `${r.route || "بدون مسار"} (${r.tktNo || r.fileNumber || ""})` }); });
    readStore("vv_hotel_sales_data", []).forEach((r) => { if (r.clientName === name) bookings.push({ date: r.checkIn, dept: "فندق", supplier: r.supplier || "غير محدد", sellingRate: Number(r.sellingRate) || 0, currency: r.currency || "EGP", description: r.hotelName || "بدون اسم" }); });
    readStore("vv_visa_sales_data", []).forEach((r) => { if (r.clientName === name) bookings.push({ date: r.date, dept: "فيزا", supplier: r.supplier || "غير محدد", sellingRate: Number(r.sellingRate) || 0, currency: r.currency || "EGP", description: r.country || "بدون دولة" }); });
    return bookings.filter((b) => b.date);
  }
  function getLastActivityDate(name, store) {
    const ledgerDates = ((store[name] && store[name].ledger) || []).map((e) => e.date);
    const bookingDates = getBookingsForName(name).map((b) => b.date);
    const all = [...ledgerDates, ...bookingDates].filter(Boolean);
    if (all.length === 0) return null;
    return all.reduce((max, d) => (parseLocalDate(d) > parseLocalDate(max) ? d : max));
  }
  function isPassportExpiringSoon(expiry) {
    if (!expiry) return false;
    const daysLeft = (parseLocalDate(expiry).getTime() - parseLocalDate(todayISO()).getTime()) / 86400000;
    return daysLeft < 90;
  }
  function isBirthdayUpcoming(dob) {
    if (!dob) return false;
    const today = parseLocalDate(todayISO());
    const d = parseLocalDate(dob);
    let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
    const daysUntil = (next.getTime() - today.getTime()) / 86400000;
    return daysUntil >= 0 && daysUntil <= 30;
  }

  let expandedFamilies = new Set();
  let filterExpiringPassports = false;
  let filterUpcomingBirthdays = false;
  let showAddForm = false;
  let editingPartyName = null;

  function renderFamilyPackage(category) {
    expandedFamilies = new Set();
    filterExpiringPassports = false;
    filterUpcomingBirthdays = false;
    showAddForm = false;
    editingPartyName = null;

    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div class="table-controls">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <div class="search-wrap" style="width:280px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" id="fam-search" placeholder="بحث بالاسم أو الكود..." />
          </div>
          <label class="filter-chip"><input type="checkbox" id="fam-filter-passport" style="width:14px;height:14px;" /> 🟡 جوازات قربت تنتهي (أقل من 3 شهور)</label>
          <label class="filter-chip"><input type="checkbox" id="fam-filter-birthday" style="width:14px;height:14px;" /> 🎂 أعياد ميلاد قادمة (خلال 30 يوم)</label>
        </div>
        <button class="btn btn--primary" id="btn-toggle-add-fam" type="button">+ إضافة حساب ${category === "b2b" ? "شركة" : "عميل"} جديد</button>
      </div>

      <div id="add-fam-form-wrap" style="display:none; margin-bottom:22px;"></div>

      <div class="ledger-scroll">
        <table class="acc-table" id="fam-table">
          <thead><tr><th></th><th>الكود</th><th>الاسم</th><th>الصفة</th><th>VIP</th><th>الهاتف</th><th>الجواز</th><th>ينتهي في</th><th>تاريخ الميلاد</th><th>آخر نشاط</th><th>الإجراءات</th></tr></thead>
          <tbody id="fam-table-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="fam-empty-state" style="display:none;"><p>لا توجد حسابات بعد</p></div>

      <div id="fam-details-drawer" style="display:none; margin-top:24px;">
        <div class="section-title">
          <h2 id="fam-details-name"></h2>
          <button class="btn btn--ghost" id="btn-close-fam-details" type="button" style="font-size:12px;">إغلاق</button>
        </div>
        <div class="dna-tabs" style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;">
          <div class="dna-tab is-active" data-dna-tab="timeline">🕐 الجدول الزمني</div>
          <div class="dna-tab" data-dna-tab="vault">📁 خزينة المستندات</div>
          <div class="dna-tab" data-dna-tab="preferences">💬 التفضيلات الشخصية</div>
          <div class="dna-tab" data-dna-tab="crm">📞 سجل المتابعات</div>
        </div>
        <div id="fam-details-body" style="background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;"></div>
        <div id="fam-vault-body" style="display:none; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;"></div>
        <div id="fam-preferences-body" style="display:none; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;"></div>
        <div id="fam-crm-body" style="display:none; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;"></div>
      </div>
    `;

    document.getElementById("fam-search").addEventListener("input", () => renderFamilyTable(category));
    document.getElementById("fam-filter-passport").addEventListener("change", (e) => { filterExpiringPassports = e.target.checked; renderFamilyTable(category); });
    document.getElementById("fam-filter-birthday").addEventListener("change", (e) => { filterUpcomingBirthdays = e.target.checked; renderFamilyTable(category); });
    document.getElementById("btn-close-fam-details").addEventListener("click", () => { document.getElementById("fam-details-drawer").style.display = "none"; });
    document.getElementById("btn-toggle-add-fam").addEventListener("click", () => { showAddForm = !showAddForm; renderAddFamForm(category); });
    document.querySelectorAll("[data-dna-tab]").forEach((tab) => tab.addEventListener("click", () => switchDnaTab(tab.dataset.dnaTab)));

    renderFamilyTable(category);
  }

  const CURRENCY_OPTIONS = ["EGP", "USD", "EUR", "SAR", "KWD", "GBP", "JPY", "CNY", "CAD"];

  function renderAddFamForm(category, prefilledParent) {
    const wrap = document.getElementById("add-fam-form-wrap");
    if (!showAddForm) { wrap.style.display = "none"; wrap.innerHTML = ""; return; }

    const meta = readMeta();
    const store = readCustomers();
    const existingNames = Object.keys(store).filter((n) => (getMetaFor(meta, n).clientCategory || "b2c") === category && n !== editingPartyName);
    const editingMeta = editingPartyName ? getMetaFor(meta, editingPartyName) : null;

    // Opening balance can only be set/edited while the party has zero
    // ledger entries — once real financial movements exist against this
    // account, changing its "starting point" would silently rewrite
    // financial history, exactly the same principle already enforced on
    // Chart of Accounts elsewhere in this project.
    const hasLedgerHistory = editingPartyName ? ((store[editingPartyName] && store[editingPartyName].ledger && store[editingPartyName].ledger.length) || 0) > 0 : false;

    wrap.style.display = "block";
    wrap.innerHTML = `
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px;">
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">${editingPartyName ? `تعديل بيانات "${editingPartyName}"` : `حساب ${category === "b2b" ? "شركة" : "عميل"} جديد`}</h3>
        ${!editingPartyName ? `
        <div class="vv-field">
          <label>الحساب الرئيسي (اختياري — لإضافة فرد لحساب موجود)</label>
          <select id="fam-parent"><option value="">-- بدون (حساب مستقل) --</option>${existingNames.map((n) => `<option value="${n}" ${n === prefilledParent ? "selected" : ""}>${n}</option>`).join("")}</select>
        </div>
        <div class="vv-field" id="fam-relation-field" style="display:${prefilledParent ? "flex" : "none"};">
          ${category === "b2b" ? `
            <label>المسمى الوظيفي</label>
            <input type="text" id="fam-relation" placeholder="مثال: مدير مبيعات، محاسب..." />
          ` : `
            <label>صلة القرابة بالحساب الرئيسي</label>
            <select id="fam-relation">
              <option value="">-- اختر --</option>
              <option value="أب">أب</option>
              <option value="أم">أم</option>
              <option value="أخ">أخ</option>
              <option value="أخت">أخت</option>
              <option value="زوج">زوج</option>
              <option value="زوجة">زوجة</option>
              <option value="ابن">ابن</option>
              <option value="ابنة">ابنة</option>
              <option value="قريب">قريب</option>
            </select>
          `}
        </div>` : ""}
        <div class="vv-field"><label>الاسم</label><input type="text" id="fam-name" ${editingPartyName ? "readonly" : ""} /></div>
        <div class="vv-field-row">
          <div class="vv-field"><label>الهاتف</label><input type="text" id="fam-phone" placeholder="01xxxxxxxxx" /></div>
          <div class="vv-field"><label>البريد الإلكتروني</label><input type="email" id="fam-email" placeholder="اختياري" /></div>
        </div>
        <div class="vv-field"><label>العنوان</label><input type="text" id="fam-address" placeholder="العنوان بالتفصيل... (اختياري)" /></div>
        <div class="vv-field-row">
          <div class="vv-field"><label>رقم الجواز</label><input type="text" id="fam-passport" placeholder="اختياري" /></div>
          <div class="vv-field"><label>تاريخ انتهاء الجواز</label><input type="date" id="fam-passport-expiry" /></div>
        </div>
        <div class="vv-field-row">
          <div class="vv-field"><label>تاريخ الميلاد</label><input type="date" id="fam-dob" /></div>
          <div class="vv-field"><label>الرقم الشخصي</label><input type="text" id="fam-national-id" placeholder="اختياري" /></div>
        </div>
        ${editingPartyName && editingMeta && editingMeta.parentParty ? `
        <div class="vv-field">
          <label>${category === "b2b" ? "المسمى الوظيفي" : "صلة القرابة"}</label>
          <input type="text" id="fam-relation" placeholder="${category === "b2b" ? "مثال: مدير مبيعات..." : "مثال: أب، أخ، ابن..."}" />
        </div>` : ""}
        <div class="vv-field-row">
          <div class="vv-field"><label>العملة</label><select id="fam-currency">${CURRENCY_OPTIONS.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div>
          <div class="vv-field"><label>حد الائتمان (Credit Limit)</label><input type="number" min="0" step="0.01" id="fam-credit-limit" value="0" /></div>
        </div>
        <div class="vv-field">
          <label>الرصيد الافتتاحي ${hasLedgerHistory ? '<span style="color:var(--coral); font-weight:700;">— مقفول: يوجد حركات مسجّلة بالفعل، لا يمكن تعديل نقطة البداية</span>' : ""}</label>
          <input type="number" step="0.01" id="fam-opening-balance" value="0" ${hasLedgerHistory ? "readonly disabled" : ""} />
        </div>
        <div class="vv-field">
          <label style="display:flex; align-items:center; gap:7px; cursor:pointer; width:fit-content;"><input type="checkbox" id="fam-vip" style="width:16px;height:16px;" /> ⭐ عميل مميز (VIP)</label>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn--primary" id="btn-save-fam" type="button">${editingPartyName ? "حفظ التعديلات" : "حفظ"}</button>
          <button class="btn btn--ghost" id="btn-cancel-fam" type="button">إلغاء</button>
        </div>
      </div>`;

    if (editingMeta) {
      document.getElementById("fam-name").value = editingPartyName;
      document.getElementById("fam-phone").value = editingMeta.phone || "";
      document.getElementById("fam-email").value = editingMeta.email || "";
      document.getElementById("fam-address").value = editingMeta.address || "";
      document.getElementById("fam-passport").value = editingMeta.passportNumber || "";
      document.getElementById("fam-passport-expiry").value = editingMeta.passportExpiry || "";
      document.getElementById("fam-dob").value = editingMeta.dateOfBirth || "";
      document.getElementById("fam-national-id").value = editingMeta.nationalId || "";
      document.getElementById("fam-currency").value = editingMeta.currency || "EGP";
      document.getElementById("fam-credit-limit").value = editingMeta.creditLimit || 0;
      document.getElementById("fam-opening-balance").value = (store[editingPartyName] && store[editingPartyName].balance) || 0;
      document.getElementById("fam-vip").checked = !!editingMeta.isVIP;
      const relationField = document.getElementById("fam-relation");
      if (relationField) relationField.value = (category === "b2b" ? editingMeta.jobTitle : editingMeta.relationship) || "";
    }

    const parentSelect = document.getElementById("fam-parent");
    if (parentSelect) {
      parentSelect.addEventListener("change", () => {
        const relationFieldWrap = document.getElementById("fam-relation-field");
        relationFieldWrap.style.display = parentSelect.value ? "flex" : "none";
      });
    }

    document.getElementById("btn-cancel-fam").addEventListener("click", () => { showAddForm = false; editingPartyName = null; renderAddFamForm(category); });
    document.getElementById("btn-save-fam").addEventListener("click", () => saveFamMember(category));
  }

  function saveFamMember(category) {
    const name = document.getElementById("fam-name").value.trim();
    if (!name) { alert("الاسم مطلوب."); return; }

    const creditLimit = Number(document.getElementById("fam-credit-limit").value) || 0;
    if (creditLimit < 0) { alert("حد الائتمان لا يمكن أن يكون بالسالب."); return; }

    const store = readCustomers();
    const meta = readMeta();

    if (editingPartyName) {
      const m = getMetaFor(meta, editingPartyName);
      m.phone = document.getElementById("fam-phone").value.trim();
      m.email = document.getElementById("fam-email").value.trim();
      m.address = document.getElementById("fam-address").value.trim();
      m.passportNumber = document.getElementById("fam-passport").value.trim();
      m.passportExpiry = document.getElementById("fam-passport-expiry").value;
      m.dateOfBirth = document.getElementById("fam-dob").value;
      m.nationalId = document.getElementById("fam-national-id").value.trim();
      m.currency = document.getElementById("fam-currency").value;
      m.creditLimit = creditLimit;
      m.isVIP = document.getElementById("fam-vip").checked;
      const relationFieldEdit = document.getElementById("fam-relation");
      if (relationFieldEdit) {
        if (category === "b2b") m.jobTitle = relationFieldEdit.value.trim();
        else m.relationship = relationFieldEdit.value;
      }
      writeMeta(meta);

      // Opening balance is only ever touched here if the field wasn't
      // locked (i.e. zero ledger history) — the form itself disables the
      // input in that case, but re-checking here too means a stale form
      // left open in another tab can never sneak a change through.
      const hasLedgerHistory = ((store[editingPartyName] && store[editingPartyName].ledger && store[editingPartyName].ledger.length) || 0) > 0;
      if (!hasLedgerHistory) {
        const newOpeningBalance = Number(document.getElementById("fam-opening-balance").value) || 0;
        if (store[editingPartyName]) {
          store[editingPartyName].balance = newOpeningBalance;
          m.openingBalance = newOpeningBalance;
          writeCustomers(store);
          writeMeta(meta);
        }
      }
    } else {
      if (store[name]) { alert(`يوجد بالفعل حساب بنفس الاسم "${name}".`); return; }
      const parentParty = document.getElementById("fam-parent").value || "";
      if (name === parentParty) { alert("لا يمكن أن يكون الحساب فرعًا لنفسه."); return; }

      // A sub-member (employee of a company, or family member) shares the
      // EXACT SAME code as its parent — this is the whole point: picking
      // that one code later (in a Sales Report entry, for example) should
      // pull up transactions for the whole company/family, not just one
      // individual. Only a true root account (no parent) gets a freshly
      // generated code.
      const parentMeta = parentParty ? getMetaFor(meta, parentParty) : null;
      const sharedCode = parentMeta ? parentMeta.code : `CUST-${String(Object.keys(meta).length + 1).padStart(4, "0")}`;
      const relationField = document.getElementById("fam-relation");
      const relationValue = relationField ? relationField.value.trim() : "";

      const openingBalance = Number(document.getElementById("fam-opening-balance").value) || 0;
      store[name] = { balance: openingBalance, ledger: [] };
      writeCustomers(store);

      meta[name] = {
        code: sharedCode, type: "customer", parentParty,
        phone: document.getElementById("fam-phone").value.trim(),
        email: document.getElementById("fam-email").value.trim(),
        address: document.getElementById("fam-address").value.trim(),
        passportNumber: document.getElementById("fam-passport").value.trim(),
        passportExpiry: document.getElementById("fam-passport-expiry").value,
        dateOfBirth: document.getElementById("fam-dob").value,
        nationalId: document.getElementById("fam-national-id").value.trim(),
        clientCategory: category, isVIP: document.getElementById("fam-vip").checked,
        currency: document.getElementById("fam-currency").value, creditLimit, openingBalance,
        relationship: category === "b2c" ? relationValue : "",
        jobTitle: category === "b2b" ? relationValue : "",
      };
      writeMeta(meta);
    }

    showAddForm = false;
    editingPartyName = null;
    renderAddFamForm(category);
    renderFamilyTable(category);
  }

  function renderFamilyTable(category) {
    const query = (document.getElementById("fam-search").value || "").trim().toLowerCase();
    const store = readCustomers();
    const meta = readMeta();

    let names = Object.keys(store).filter((n) => (getMetaFor(meta, n).clientCategory || "b2c") === category);
    if (query) names = names.filter((n) => n.toLowerCase().includes(query) || (getMetaFor(meta, n).code || "").toLowerCase().includes(query));

    const nameSet = new Set(names);
    const childrenOf = (parent) => names.filter((n) => getMetaFor(meta, n).parentParty === parent);
    let roots = names.filter((n) => { const p = getMetaFor(meta, n).parentParty; return !p || !nameSet.has(p); });

    if (filterExpiringPassports || filterUpcomingBirthdays) {
      roots = roots.filter((rootName) => {
        const family = [rootName, ...childrenOf(rootName)];
        return family.some((n) => {
          const m = getMetaFor(meta, n);
          return (filterExpiringPassports && isPassportExpiringSoon(m.passportExpiry)) || (filterUpcomingBirthdays && isBirthdayUpcoming(m.dateOfBirth));
        });
      });
    }

    const tbody = document.getElementById("fam-table-body");
    const table = document.getElementById("fam-table");
    const empty = document.getElementById("fam-empty-state");

    if (roots.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    const familyLastActivity = {};
    roots.forEach((rootName) => {
      const family = [rootName, ...childrenOf(rootName)];
      const dates = family.map((n) => getLastActivityDate(n, store)).filter(Boolean);
      familyLastActivity[rootName] = dates.length ? dates.reduce((max, d) => (parseLocalDate(d) > parseLocalDate(max) ? d : max)) : null;
    });
    roots.sort((a, b) => {
      const da = familyLastActivity[a], db = familyLastActivity[b];
      if (da && db) return parseLocalDate(db) - parseLocalDate(da);
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

    function renderPassportCell(m) {
      if (!m.passportExpiry) return `<td>${m.passportNumber || "—"}</td><td>—</td>`;
      const soon = isPassportExpiringSoon(m.passportExpiry);
      return `<td>${m.passportNumber || "—"}</td><td style="color:${soon ? "var(--amber)" : "var(--text)"}; font-weight:${soon ? "700" : "400"};">${soon ? "🟡 " : ""}${m.passportExpiry}</td>`;
    }

    function renderRow(name, depth, isRoot, hasChildren, isExpanded) {
      const m = getMetaFor(meta, name);
      const lastActivity = getLastActivityDate(name, store);
      const birthdaySoon = isBirthdayUpcoming(m.dateOfBirth);
      const roleLabel = isRoot ? (category === "b2b" ? "الشركة الرئيسية" : "الحساب الرئيسي") : ((category === "b2b" ? m.jobTitle : m.relationship) || "—");
      return `
        <tr>
          <td>${isRoot && hasChildren ? `<button class="row-action-btn" data-toggle-fam="${name}" title="${isExpanded ? "طي" : "فتح"}">${isExpanded ? "▾" : "◂"}</button>` : ""}</td>
          <td class="mono" style="font-size:11px; color:var(--text-faint);">${m.code}</td>
          <td class="cell-primary" style="padding-inline-start:${depth * 20}px;">${depth > 0 ? "↳ " : ""}${name}</td>
          <td style="font-size:11.5px; color:var(--text-soft);">${roleLabel}</td>
          <td style="text-align:center;">${m.isVIP ? "⭐" : ""}</td>
          <td>${m.phone || "—"}</td>
          ${renderPassportCell(m)}
          <td style="color:${birthdaySoon ? "var(--azure)" : "var(--text)"};">${m.dateOfBirth || "—"}${birthdaySoon ? " 🎂" : ""}</td>
          <td style="font-size:11px; color:var(--text-faint);">${lastActivity || "—"}</td>
          <td>
            <div class="row-actions">
              ${isRoot && hasChildren ? `<button class="row-action-btn" data-show-group-transactions="${name}" title="آخر التعاملات"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/></svg></button>` : ""}
              <button class="row-action-btn" data-show-fam-details="${name}" title="Show Details"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg></button>
              <button class="row-action-btn" data-edit-fam="${name}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></button>
              ${isRoot ? `<button class="row-action-btn" data-add-sub-fam="${name}" title="إضافة فرد"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg></button>` : ""}
              <button class="row-action-btn is-danger" data-delete-fam="${name}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </div>
          </td>
        </tr>`;
    }

    tbody.innerHTML = roots.map((rootName) => {
      const kids = childrenOf(rootName);
      const isExpanded = expandedFamilies.has(rootName);
      let html = renderRow(rootName, 0, true, kids.length > 0, isExpanded);
      if (kids.length > 0 && isExpanded) {
        const sortedKids = [...kids].sort((a, b) => {
          const da = getLastActivityDate(a, store), db = getLastActivityDate(b, store);
          if (da && db) return parseLocalDate(db) - parseLocalDate(da);
          if (da) return -1;
          if (db) return 1;
          return 0;
        });
        sortedKids.forEach((k) => { html += renderRow(k, 1, false, false, false); });
      }
      return html;
    }).join("");

    tbody.querySelectorAll("[data-toggle-fam]").forEach((btn) => btn.addEventListener("click", () => {
      const n = btn.dataset.toggleFam;
      if (expandedFamilies.has(n)) expandedFamilies.delete(n); else expandedFamilies.add(n);
      renderFamilyTable(category);
    }));
    tbody.querySelectorAll("[data-show-fam-details]").forEach((btn) => btn.addEventListener("click", () => openFamDetails(btn.dataset.showFamDetails)));
    tbody.querySelectorAll("[data-edit-fam]").forEach((btn) => btn.addEventListener("click", () => {
      editingPartyName = btn.dataset.editFam;
      showAddForm = true;
      renderAddFamForm(category);
    }));
    tbody.querySelectorAll("[data-add-sub-fam]").forEach((btn) => btn.addEventListener("click", () => {
      showAddForm = true;
      renderAddFamForm(category, btn.dataset.addSubFam);
    }));
    tbody.querySelectorAll("[data-delete-fam]").forEach((btn) => btn.addEventListener("click", () => deleteFamMember(btn.dataset.deleteFam, category)));
    tbody.querySelectorAll("[data-show-group-transactions]").forEach((btn) => btn.addEventListener("click", () => openGroupTransactions(btn.dataset.showGroupTransactions, category)));
  }

  function openGroupTransactions(rootName, category) {
    const meta = readMeta();
    const store = readCustomers();
    const rootMeta = getMetaFor(meta, rootName);

    // Every party (root + children) that shares this exact code — the
    // whole point of the shared-code model: pulling one code up shows
    // the WHOLE company/family's activity, not just one individual.
    const groupMembers = Object.keys(meta).filter((n) => meta[n].code === rootMeta.code);

    document.getElementById("group-transactions-title").textContent = `آخر التعاملات — ${rootName} (${rootMeta.code})`;

    const allItems = [];
    groupMembers.forEach((memberName) => {
      getBookingsForName(memberName).forEach((b) => allItems.push({ ...b, memberName, kind: "booking" }));
      ((store[memberName] && store[memberName].ledger) || []).forEach((e) => allItems.push({ date: e.date, description: e.description, memberName, kind: "financial" }));
    });
    allItems.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

    const body = document.getElementById("group-transactions-body");
    if (allItems.length === 0) {
      body.innerHTML = `<p style="font-size:12.5px; color:var(--text-faint);">لا توجد معاملات مسجّلة بعد لأي فرد من ${category === "b2b" ? "الشركة" : "العائلة"}.</p>`;
    } else {
      body.innerHTML = `
        <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:12px;">إجمالي ${groupMembers.length} ${category === "b2b" ? "موظف/عضو" : "فرد"} مشتركين في نفس الكود</div>
        ${allItems.map((item) => item.kind === "booking" ? `
          <div style="display:flex; align-items:center; gap:12px; padding:9px 2px; border-bottom:1px solid var(--border); font-size:12.5px;">
            <span style="color:var(--text-faint); font-size:11px; min-width:80px;">${item.date}</span>
            <span class="dept-tag" style="background:var(--gold-soft); color:var(--gold-deep);">${item.dept}</span>
            <span style="flex:1;">${item.description}</span>
            <span style="font-size:10.5px; color:var(--text-faint);">المورد: ${item.supplier}</span>
            <span style="font-weight:800; color:var(--emerald);">${money(item.sellingRate, item.currency)}</span>
            <span style="font-size:10.5px; color:var(--gold-deep); font-weight:700; min-width:70px; text-align:left;">${item.memberName}</span>
          </div>
        ` : `
          <div style="display:flex; align-items:center; gap:10px; padding:8px 2px; border-bottom:1px solid var(--border); font-size:12.5px;">
            <span style="color:var(--text-faint); font-size:11px; min-width:80px;">${item.date}</span>
            <span style="flex:1;">💰 ${item.description}</span>
            <span style="font-size:10.5px; color:var(--gold-deep); font-weight:700;">${item.memberName}</span>
          </div>
        `).join("")}
      `;
    }
    document.getElementById("modal-group-transactions").classList.add("is-open");
  }

  function deleteFamMember(name, category) {
    const store = readCustomers();
    const meta = readMeta();
    const hasChildren = Object.keys(meta).some((n) => meta[n].parentParty === name);
    if (hasChildren) { alert(`لا يمكن حذف "${name}" — يوجد حسابات فرعية تابعة له.`); return; }
    const balance = (store[name] && store[name].balance) || 0;
    const ledgerLen = (store[name] && store[name].ledger && store[name].ledger.length) || 0;
    if (balance !== 0) { alert(`لا يمكن حذف "${name}" — الرصيد الحالي ليس صفرًا.`); return; }
    if (ledgerLen > 0) { alert(`لا يمكن حذف "${name}" — يوجد حركات مسجّلة.`); return; }
    if (!confirm(`حذف "${name}" نهائيًا؟`)) return;
    delete store[name]; writeCustomers(store);
    delete meta[name]; writeMeta(meta);
    renderFamilyTable(category);
  }

  const MONTH_NAMES_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  function openFamDetails(name) {
    const store = readCustomers();
    const meta = readMeta();
    const m = getMetaFor(meta, name);

    currentDnaName = name;
    document.getElementById("fam-details-name").textContent = `${m.isVIP ? "⭐ " : ""}${name}`;
    document.getElementById("fam-details-drawer").style.display = "block";
    switchDnaTab("timeline");
    const drawerEl = document.getElementById("fam-details-drawer");
    if (typeof drawerEl.scrollIntoView === "function") drawerEl.scrollIntoView({ behavior: "smooth", block: "start" });

    const bookings = getBookingsForName(name).map((b) => ({ ...b, kind: "booking" }));
    const ledgerEntries = ((store[name] && store[name].ledger) || []).map((e) => ({ date: e.date, description: e.description, kind: "financial" }));
    const combined = [...bookings, ...ledgerEntries].filter((i) => i.date).sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

    if (combined.length === 0) {
      document.getElementById("fam-details-body").innerHTML = `<p style="font-size:12.5px; color:var(--text-faint);">لا توجد حجوزات أو حركات مسجّلة بعد.</p>`;
      return;
    }

    let currentMonthKey = "";
    let html = "";
    combined.forEach((item) => {
      const d = parseLocalDate(item.date);
      const monthKey = `${MONTH_NAMES_AR[d.getMonth()]} ${d.getFullYear()}`;
      if (monthKey !== currentMonthKey) {
        currentMonthKey = monthKey;
        html += `<div style="font-family:'Cairo',sans-serif; font-weight:800; font-size:12.5px; color:var(--gold-deep); margin:14px 0 6px;">شهر ${monthKey}</div>`;
      }
      if (item.kind === "booking") {
        html += `
          <div style="display:flex; align-items:center; gap:12px; padding:8px 2px; border-bottom:1px solid var(--border); font-size:12.5px;">
            <span style="color:var(--text-faint); font-size:11px; min-width:80px;">${item.date}</span>
            <span class="dept-tag" style="background:var(--gold-soft); color:var(--gold-deep);">${item.dept}</span>
            <span style="flex:1;">${item.description}</span>
            <span style="font-size:11px; color:var(--text-faint);">المورد: ${item.supplier}</span>
            <span style="font-weight:800; color:var(--emerald);">${money(item.sellingRate, item.currency)}</span>
          </div>`;
      } else {
        html += `<div style="display:flex; align-items:center; gap:10px; padding:7px 2px; border-bottom:1px solid var(--border); font-size:12.5px;"><span style="color:var(--text-faint); font-size:11px; min-width:80px;">${item.date}</span><span>💰 ${item.description}</span></div>`;
      }
    });
    document.getElementById("fam-details-body").innerHTML = html;
  }

  // =========================================================================
  // DNA Drawer — the 4 pillars. Data lives on the party's own meta record
  // (vv_acc_party_meta), same store everything else here already uses:
  //   documents: [{ id, label, type, expiryDate, fileDataUrl, uploadedAt }]
  //   preferences: free-text notes, persistent across sessions
  //   crmLog: [{ id, note, employeeName, date }]
  // =========================================================================

  let currentDnaName = null;
  const MAX_DOC_BYTES = 700 * 1024; // same cap used for staff.js photos

  function todayISOForData() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function switchDnaTab(tab) {
    document.querySelectorAll("[data-dna-tab]").forEach((el) => el.classList.toggle("is-active", el.dataset.dnaTab === tab));
    document.getElementById("fam-details-body").style.display = tab === "timeline" ? "block" : "none";
    document.getElementById("fam-vault-body").style.display = tab === "vault" ? "block" : "none";
    document.getElementById("fam-preferences-body").style.display = tab === "preferences" ? "block" : "none";
    document.getElementById("fam-crm-body").style.display = tab === "crm" ? "block" : "none";

    if (!currentDnaName) return;
    if (tab === "vault") renderDocumentVault(currentDnaName);
    if (tab === "preferences") renderPreferencesPanel(currentDnaName);
    if (tab === "crm") renderCrmLogPanel(currentDnaName);
  }

  function docExpiryStatus(expiryDate) {
    if (!expiryDate) return null;
    const daysLeft = Math.floor((parseLocalDate(expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return { cls: "danger", label: "منتهي الصلاحية" };
    if (daysLeft <= 30) return { cls: "danger", label: `ينتهي خلال ${daysLeft} يوم` };
    if (daysLeft <= 90) return { cls: "warning", label: `ينتهي خلال ${daysLeft} يوم` };
    return { cls: "ok", label: `ساري حتى ${expiryDate}` };
  }

  function renderDocumentVault(name) {
    const meta = readMeta();
    const m = getMetaFor(meta, name);
    const docs = m.documents || [];
    const body = document.getElementById("fam-vault-body");

    const cardsHtml = docs.map((d) => {
      const status = docExpiryStatus(d.expiryDate);
      return `
        <div class="doc-vault-card">
          <button type="button" class="doc-vault-card__remove" data-remove-doc="${d.id}" title="حذف">✕</button>
          ${d.fileDataUrl ? `<img src="${d.fileDataUrl}" alt="" />` : `<div style="height:80px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:11px;">لا توجد صورة</div>`}
          <div class="doc-vault-card__label">${d.label}</div>
          ${status ? `<span class="doc-vault-card__expiry doc-vault-card__expiry--${status.cls}">${status.label}</span>` : ""}
        </div>`;
    }).join("");

    body.innerHTML = `
      <h4 style="font-family:'Cairo',sans-serif; font-weight:800; font-size:13px; margin-bottom:12px;">خزينة المستندات</h4>
      <div class="doc-vault-grid">${cardsHtml}</div>
      ${docs.length === 0 ? `<p style="font-size:12px; color:var(--text-faint); margin-bottom:14px;">لا توجد مستندات مرفوعة بعد.</p>` : ""}
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:14px;">
        <h5 style="font-size:12px; font-weight:700; margin-bottom:10px;">رفع مستند جديد</h5>
        <div class="vv-field-row">
          <div class="vv-field"><label>نوع المستند</label>
            <select id="doc-type">
              <option value="passport">جواز سفر</option>
              <option value="id">بطاقة شخصية</option>
              <option value="visa">فيزا سابقة</option>
              <option value="contract">سجل تجاري / عقد</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <div class="vv-field"><label>تاريخ الانتهاء (اختياري)</label><input type="date" id="doc-expiry" /></div>
        </div>
        <div class="vv-field" style="margin-top:10px;"><label>الملف</label><input type="file" accept="image/*" id="doc-upload" /></div>
        <button class="btn btn--primary" id="btn-save-doc" type="button" style="margin-top:10px;">حفظ المستند</button>
      </div>
    `;

    body.querySelectorAll("[data-remove-doc]").forEach((btn) => btn.addEventListener("click", () => removeDocument(name, btn.dataset.removeDoc)));
    document.getElementById("btn-save-doc").addEventListener("click", () => saveDocument(name));
  }

  function saveDocument(name) {
    const type = document.getElementById("doc-type").value;
    const expiryDate = document.getElementById("doc-expiry").value || null;
    const fileInput = document.getElementById("doc-upload");
    const file = fileInput.files && fileInput.files[0];
    const typeLabels = { passport: "جواز سفر", id: "بطاقة شخصية", visa: "فيزا سابقة", contract: "سجل تجاري / عقد", other: "أخرى" };

    if (!file) { alert("اختار ملف الأول."); return; }
    if (!file.type.startsWith("image/")) { alert("الملف المختار مش صورة."); return; }
    if (file.size > MAX_DOC_BYTES) { alert(`حجم الملف كبير جدًا (${Math.round(file.size / 1024)} كيلوبايت) — الحد الأقصى ${Math.round(MAX_DOC_BYTES / 1024)} كيلوبايت.`); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const meta = readMeta();
      const m = getMetaFor(meta, name);
      if (!m.documents) m.documents = [];
      m.documents.push({
        id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: typeLabels[type] || type, type, expiryDate,
        fileDataUrl: reader.result, uploadedAt: todayISOForData(),
      });
      writeMeta(meta);
      renderDocumentVault(name);
    };
    reader.onerror = () => alert("تعذّرت قراءة الملف — جرّب صورة تانية.");
    reader.readAsDataURL(file);
  }

  function removeDocument(name, docId) {
    if (!confirm("حذف هذا المستند نهائيًا؟")) return;
    const meta = readMeta();
    const m = getMetaFor(meta, name);
    m.documents = (m.documents || []).filter((d) => d.id !== docId);
    writeMeta(meta);
    renderDocumentVault(name);
  }

  function renderPreferencesPanel(name) {
    const meta = readMeta();
    const m = getMetaFor(meta, name);
    const body = document.getElementById("fam-preferences-body");
    body.innerHTML = `
      <h4 style="font-family:'Cairo',sans-serif; font-weight:800; font-size:13px; margin-bottom:10px;">تفضيلات العميل الشخصية</h4>
      <p style="font-size:11.5px; color:var(--text-faint); margin-bottom:10px;">ملاحظات دائمة يشوفها أي موظف يتعامل مع العميل ده — مثال: "بيفضل المقعد الجانبي"، "بيسافر دايمًا في يوليو".</p>
      <textarea id="pref-notes" rows="6" style="width:100%; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:12.5px; font-family:inherit;">${m.preferences || ""}</textarea>
      <button class="btn btn--primary" id="btn-save-preferences" type="button" style="margin-top:10px;">حفظ التفضيلات</button>
    `;
    document.getElementById("btn-save-preferences").addEventListener("click", () => {
      const meta2 = readMeta();
      const m2 = getMetaFor(meta2, name);
      m2.preferences = document.getElementById("pref-notes").value.trim();
      writeMeta(meta2);
      alert("تم حفظ التفضيلات.");
    });
  }

  function currentEmployeeName() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const u = window.VVAuth.getCurrentUser();
      if (u && u.full_name) return u.full_name;
    }
    return "Demo User";
  }

  function renderCrmLogPanel(name) {
    const meta = readMeta();
    const m = getMetaFor(meta, name);
    const log = [...(m.crmLog || [])].sort((a, b) => (b.id > a.id ? 1 : -1));
    const body = document.getElementById("fam-crm-body");

    const entriesHtml = log.map((entry) => `
      <div class="crm-log-entry">
        <div>${entry.note}</div>
        <div class="crm-log-entry__meta">${entry.employeeName} — ${entry.date}</div>
      </div>
    `).join("") || `<p style="font-size:12px; color:var(--text-faint);">لا توجد متابعات مسجّلة بعد.</p>`;

    body.innerHTML = `
      <h4 style="font-family:'Cairo',sans-serif; font-weight:800; font-size:13px; margin-bottom:10px;">سجل المكالمات والمتابعات (CRM)</h4>
      <div style="margin-bottom:14px;">${entriesHtml}</div>
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:12px;">
        <textarea id="crm-new-note" rows="2" placeholder="اكتب ملخص سريع للمكالمة أو المتابعة..." style="width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:12.5px; font-family:inherit;"></textarea>
        <button class="btn btn--primary" id="btn-add-crm-note" type="button" style="margin-top:8px;">إضافة للسجل</button>
      </div>
    `;
    document.getElementById("btn-add-crm-note").addEventListener("click", () => {
      const note = document.getElementById("crm-new-note").value.trim();
      if (!note) { alert("اكتب ملاحظة الأول."); return; }
      const meta2 = readMeta();
      const m2 = getMetaFor(meta2, name);
      if (!m2.crmLog) m2.crmLog = [];
      m2.crmLog.push({ id: `crm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, note, employeeName: currentEmployeeName(), date: todayISOForData() });
      writeMeta(meta2);
      renderCrmLogPanel(name);
    });
  }

  MODULE_RENDERERS.b2b = () => renderFamilyPackage("b2b");
  MODULE_RENDERERS.b2c = () => renderFamilyPackage("b2c");

  // =========================================================================
  // Accounting package — General Sales Report (pending) + Analyse
  // (reviewed, grouped by supplier) + chart. Read-only except the single
  // reviewStatus field on the matched record.
  // =========================================================================

  const DEPT_META = {
    flight: { label: "طيران", rowClass: "dept-row--flight", tagClass: "dept-tag--flight" },
    visa: { label: "تأشيرات", rowClass: "dept-row--visa", tagClass: "dept-tag--visa" },
    hotel: { label: "فنادق", rowClass: "dept-row--hotel", tagClass: "dept-tag--hotel" },
  };

  function normalizeFlights() {
    return readStore("vv_sales_data", []).map((r) => ({ dept: "flight", storeKey: "vv_sales_data", sourceId: r.id, date: r.date, customer: r.passengerName || "-", supplier: r.supplier || "غير محدد", netRate: Number(r.netRate) || 0, sellingRate: Number(r.sellingRate) || 0, profit: Number(r.profit) || 0, currency: r.currency || "EGP", reviewStatus: r.reviewStatus || "pending", collectionStatus: r.collectionStatus || null, collectionAccount: r.collectionAccount || null, paidAmount: Number(r.paidAmount) || 0, remainingAmount: Number(r.remainingAmount) || 0 }));
  }
  function normalizeHotels() {
    return readStore("vv_hotel_sales_data", []).map((r) => ({ dept: "hotel", storeKey: "vv_hotel_sales_data", sourceId: r.id, date: r.checkIn, customer: r.clientName || "-", supplier: r.supplier || "غير محدد", netRate: Number(r.netRate) || 0, sellingRate: Number(r.sellingRate) || 0, profit: Number(r.profit) || 0, currency: r.currency || "EGP", reviewStatus: r.reviewStatus || "pending", collectionStatus: r.collectionStatus || null, collectionAccount: r.collectionAccount || null, paidAmount: Number(r.paidAmount) || 0, remainingAmount: Number(r.remainingAmount) || 0 }));
  }
  function normalizeVisas() {
    return readStore("vv_visa_sales_data", []).map((r) => ({ dept: "visa", storeKey: "vv_visa_sales_data", sourceId: r.id, date: r.date, customer: r.clientName || "-", supplier: r.supplier || "غير محدد", netRate: Number(r.netRate) || 0, sellingRate: Number(r.sellingRate) || 0, profit: Number(r.profit) || 0, currency: r.currency || "EGP", reviewStatus: r.reviewStatus || "pending", collectionStatus: r.collectionStatus || null, collectionAccount: r.collectionAccount || null, paidAmount: Number(r.paidAmount) || 0, remainingAmount: Number(r.remainingAmount) || 0 }));
  }
  function getAllSalesRecords() { return [...normalizeFlights(), ...normalizeHotels(), ...normalizeVisas()]; }

  // =========================================================================
  // Foreign Currency Wallet — a lightweight, self-contained accounting
  // ledger living ENTIRELY inside Data, for every currency EXCEPT EGP.
  // EGP collections post to the REAL accountant's Treasury (a separate,
  // deliberately manual step from the treasury.js side — this file never
  // touches vv_treasury_cash/vv_treasury_banks). Every other currency
  // (USD, EUR, SAR...) never touches the real Treasury either — it's
  // tracked here as its own small multi-currency account.
  //
  // Balance is ALWAYS derived live from the sales records themselves
  // (sum of paidAmount per currency, excluding EGP) minus manual
  // expenses recorded here — never a separately-maintained running
  // total that could drift out of sync. This also means nothing needed
  // to change in flights.js/hotels.js/visas.js at all: marking a sale
  // paid there already updates paidAmount, and this wallet picks it up
  // automatically the next time it's rendered.
  //
  // Data store: vv_data_wallet_ledger — [{
  //   id, type ("deposit"|"expense"), currency, amount, description,
  //   employeeName, date, sourceSaleKey (deposits only — "storeKey::sourceId")
  // }]
  //
  // CRITICAL FIX: deposits used to be computed LIVE by summing paidAmount
  // straight off the current sales records. That looked elegant but had
  // a real bug — deleting (or editing down) a sale afterward silently
  // erased money that had ALREADY been spent from the wallet, producing
  // an impossible negative balance. Money that was genuinely collected
  // and spent doesn't stop having existed just because someone deletes
  // an unrelated booking row later — the exact same "never rewrite
  // financial history by deleting the source record" principle used
  // everywhere else in this project (Chart of Accounts, vouchers,
  // custody...). Deposits are now PERMANENTLY recorded here the moment
  // they're first noticed, and reconcileWalletDeposits() below is the
  // only thing that ever writes a NEW deposit entry — once written, nothing
  // deletes it, no matter what happens to the sale it came from.
  // =========================================================================

  function readWalletLedger() { return readStore("vv_data_wallet_ledger", []); }
  function writeWalletLedger(rows) { writeStore("vv_data_wallet_ledger", rows); }

  // Legacy support: this project briefly stored manual expenses under
  // vv_data_wallet_expenses before the unified ledger existed. Read them
  // once, fold them into the new ledger, and never touch the old key
  // again — so nobody's already-recorded spending silently vanishes
  // during the upgrade.
  function migrateLegacyWalletExpensesOnce() {
    const legacy = readStore("vv_data_wallet_expenses", null);
    if (!legacy || legacy.length === 0) return;
    const ledger = readWalletLedger();
    legacy.forEach((e) => {
      ledger.push({ id: e.id, type: "expense", currency: e.currency, amount: e.amount, description: e.description, employeeName: e.employeeName, date: e.date, sourceSaleKey: null });
    });
    writeWalletLedger(ledger);
    writeStore("vv_data_wallet_expenses", []); // cleared, not deleted — avoids re-migrating on every load
  }

  // Scans every current sale for currency != EGP with a paid amount, and
  // permanently records any collection this ledger hasn't already seen
  // for that specific sale. Comparing against the SUM already recorded
  // for that sale (not just "recorded at all") also correctly handles a
  // partial payment later being topped up to a higher amount — only the
  // new delta gets recorded, never double-counted.
  function reconcileWalletDeposits() {
    const ledger = readWalletLedger();
    const alreadyRecordedBySale = {};
    ledger.forEach((e) => {
      if (e.type !== "deposit" || !e.sourceSaleKey) return;
      alreadyRecordedBySale[e.sourceSaleKey] = Math.round(((alreadyRecordedBySale[e.sourceSaleKey] || 0) + e.amount) * 100) / 100;
    });

    let changed = false;
    getAllSalesRecords().forEach((r) => {
      const currency = r.currency || "EGP";
      if (currency === "EGP") return; // EGP is the real Treasury's job, never this wallet's
      const paid = Number(r.paidAmount) || 0;
      if (paid <= 0) return;
      const key = `${r.storeKey}::${r.sourceId}`;
      const already = alreadyRecordedBySale[key] || 0;
      const delta = Math.round((paid - already) * 100) / 100;
      if (delta > 0.004) { // ignore floating-point dust
        ledger.push({
          id: `wdep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: "deposit", currency, amount: delta,
          description: `تحصيل — ${r.customer} (${{ flight: "طيران", hotel: "فندق", visa: "فيزا" }[r.dept] || r.dept} — ${r.supplier})`,
          employeeName: null, date: r.date, sourceSaleKey: key,
        });
        changed = true;
      }
    });
    if (changed) writeWalletLedger(ledger);
  }

  function computeWalletBalances() {
    migrateLegacyWalletExpensesOnce();
    reconcileWalletDeposits();
    const ledger = readWalletLedger();
    const balances = {};
    ledger.forEach((e) => {
      balances[e.currency] = Math.round(((balances[e.currency] || 0) + (e.type === "deposit" ? e.amount : -e.amount)) * 100) / 100;
    });
    return balances;
  }

  function currentEmployeeNameForData() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const u = window.VVAuth.getCurrentUser();
      if (u && u.full_name) return u.full_name;
    }
    return "Demo User";
  }

  function buildWalletLedgerFor(currency) {
    return readWalletLedger()
      .filter((e) => e.currency === currency)
      .sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));
  }

  function openWalletHistoryModal(currency) {
    const ledger = buildWalletLedgerFor(currency);
    const totalDeposits = ledger.filter((e) => e.type === "deposit").reduce((s, e) => s + e.amount, 0);
    const totalExpenses = ledger.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);

    document.getElementById("wallet-history-title").textContent = `سجل ${CURRENCY_LABELS_AR[currency]} (${currency})`;
    document.getElementById("wallet-history-body").innerHTML = `
      <div style="display:flex; gap:16px; margin-bottom:16px; font-size:12.5px;">
        <span style="color:var(--emerald); font-weight:800;">إجمالي التحصيل: ${totalDeposits.toLocaleString("en-US")}</span>
        <span style="color:#B02A2A; font-weight:800;">إجمالي المصروفات: ${totalExpenses.toLocaleString("en-US")}</span>
        <span style="color:var(--gold-deep); font-weight:800;">الرصيد الحالي: ${(totalDeposits - totalExpenses).toLocaleString("en-US")}</span>
      </div>
      ${ledger.length === 0 ? `<p style="font-size:12px; color:var(--text-faint);">لا توجد حركات مسجّلة بعد.</p>` : ledger.map((e) => `
        <div style="display:flex; align-items:center; gap:10px; padding:9px 2px; border-bottom:1px solid var(--border); font-size:12.5px;">
          <span style="color:var(--text-faint); font-size:11px; min-width:80px;">${e.date}</span>
          <span style="flex:1;">${e.type === "deposit" ? "📥" : "📤"} ${e.description}</span>
          ${e.employeeName ? `<span style="font-size:10.5px; color:var(--text-faint);">${e.employeeName}</span>` : ""}
          <span style="font-weight:800; color:${e.type === "deposit" ? "var(--emerald)" : "#B02A2A"};">${e.type === "deposit" ? "+" : "-"}${e.amount.toLocaleString("en-US")}</span>
        </div>
      `).join("")}
    `;
    document.getElementById("modal-wallet-history").classList.add("is-open");
  }

  function resetWallet() {
    if (!confirm("هل أنت متأكد؟ هيتم مسح كل سجل محفظة العملات الأجنبية (تحصيلات ومصروفات) نهائيًا، والرجوع لرصيد صفر لكل العملات.\n\nهذا الإجراء لا يمكن التراجع عنه.")) return;
    writeWalletLedger([]);
    writeStore("vv_data_wallet_expenses", []); // legacy store, cleared too so nothing re-migrates back in on next load
    renderWalletSection();
  }

  function renderWalletSection() {
    const container = document.getElementById("wallet-section");
    if (!container) return;
    const balances = computeWalletBalances();
    const currencies = CURRENCY_DISPLAY_ORDER.filter((c) => c !== "EGP" && balances[c] !== undefined);

    if (currencies.length === 0) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = `
      <div class="wallet-panel">
        <div class="wallet-panel__header">
          <span>💱 خزينة العملات الأجنبية <span class="wallet-panel__hint">منفصلة تمامًا عن خزينة الحسابات الحقيقية — الجنيه يترحّل من هناك</span></span>
          <button class="wallet-reset-btn" id="btn-reset-wallet" type="button">🗑️ Reset</button>
        </div>
        <div class="wallet-currency-grid">
          ${currencies.map((c) => `
            <div class="wallet-currency-card">
              <div class="wallet-currency-card__label">${CURRENCY_LABELS_AR[c]} (${c})</div>
              <div class="wallet-currency-card__balance">${balances[c].toLocaleString("en-US")}</div>
              <div style="display:flex; gap:6px; justify-content:center;">
                <button class="wallet-pay-btn" data-wallet-pay="${c}">دفع / مصروف</button>
                <button class="wallet-history-btn" data-wallet-history="${c}">📜 السجل</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    container.querySelectorAll("[data-wallet-pay]").forEach((btn) => btn.addEventListener("click", () => openWalletPayModal(btn.dataset.walletPay)));
    document.getElementById("btn-reset-wallet")?.addEventListener("click", resetWallet);
    container.querySelectorAll("[data-wallet-history]").forEach((btn) => btn.addEventListener("click", () => openWalletHistoryModal(btn.dataset.walletHistory)));
  }

  function openWalletPayModal(currency) {
    const balances = computeWalletBalances();
    document.getElementById("wallet-pay-currency").value = currency;
    document.getElementById("wallet-pay-currency-label").textContent = `${CURRENCY_LABELS_AR[currency]} (${currency}) — الرصيد المتاح: ${(balances[currency] || 0).toLocaleString("en-US")}`;
    document.getElementById("wallet-pay-description").value = "";
    document.getElementById("wallet-pay-amount").value = "";
    document.getElementById("modal-wallet-pay").classList.add("is-open");
  }

  function confirmWalletPay() {
    const currency = document.getElementById("wallet-pay-currency").value;
    const description = document.getElementById("wallet-pay-description").value.trim();
    const amount = Number(document.getElementById("wallet-pay-amount").value) || 0;

    if (!description) { alert("اكتب البيان الأول."); return; }
    if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }

    const balances = computeWalletBalances();
    const available = balances[currency] || 0;
    if (amount > available) {
      alert(`الرصيد غير كافٍ — المتاح فعليًا ${available.toLocaleString("en-US")} ${currency} بس، والمطلوب صرفه ${amount.toLocaleString("en-US")} ${currency}.`);
      return;
    }

    const ledger = readWalletLedger();
    ledger.push({
      id: `wexp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "expense", currency, amount, description,
      employeeName: currentEmployeeNameForData(),
      date: todayISOForData(), sourceSaleKey: null,
    });
    writeWalletLedger(ledger);

    document.getElementById("modal-wallet-pay").classList.remove("is-open");
    renderWalletSection();
  }

  // =========================================================================
  // Payment status switch — replaces the old one-click "reviewed" toggle.
  // Marking a sale reviewed now requires saying WHERE the money actually
  // went: cash / a specific bank account / not paid at all / partially
  // paid. This is purely a DOCUMENTATION field on the sale record itself
  // — it never touches VVTreasury/vv_treasury_cash/vv_treasury_banks
  // (the real Treasury), matching what was explicitly agreed: the Sales
  // Report number is a separate, standalone tracking figure, never a
  // real balance mutation.
  // =========================================================================

  let currentPaymentStatus = "cash";

  function openPaymentStatusModal(storeKey, sourceId) {
    const rows = readStore(storeKey, []);
    const record = rows.find((r) => r.id === sourceId);
    if (!record) { alert("السجل لم يعد موجودًا."); return; }

    document.getElementById("ps-store-key").value = storeKey;
    document.getElementById("ps-source-id").value = sourceId;

    const currency = record.currency || "EGP";
    const selling = Number(record.sellingRate) || 0;
    document.getElementById("ps-summary-line").textContent =
      `قيمة البيع: ${selling.toLocaleString("en-US")} ${CURRENCY_LABELS_AR[currency] || currency} — العميل: ${record.passengerName || record.clientName || "-"}`;

    // Bank dropdown — real accounts, read from Treasury's own accounts
    // list if available, so this never invents a bank name that doesn't
    // exist in the real Treasury (even though selecting it here doesn't
    // move any real money).
    const bankSelect = document.getElementById("ps-bank-select");
    if (window.VVTreasury && typeof window.VVTreasury.accountOptions === "function") {
      bankSelect.innerHTML = window.VVTreasury.accountOptions().map((o) => `<option value="${o.id}">${o.label}</option>`).join("");
    } else {
      bankSelect.innerHTML = `<option value="cash">الخزينة النقدية</option>`;
    }

    // Pre-select whatever status this record already has (defaults to
    // "unpaid" for a first-time review — never silently assume "cash").
    currentPaymentStatus = record.collectionStatus || "unpaid";
    if (record.collectionAccount) bankSelect.value = record.collectionAccount;
    document.getElementById("ps-partial-amount").value = record.paidAmount || 0;
    selectPaymentStatus(currentPaymentStatus);

    document.getElementById("modal-payment-status").classList.add("is-open");
  }

  function selectPaymentStatus(status) {
    currentPaymentStatus = status;
    document.querySelectorAll(".payment-switch__option").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.paymentStatus === status);
    });
    document.getElementById("ps-bank-field").style.display = status === "bank" ? "flex" : "none";
    document.getElementById("ps-partial-field").style.display = status === "partial" ? "flex" : "none";
    updatePartialPreview();
  }

  function updatePartialPreview() {
    if (currentPaymentStatus !== "partial") return;
    const storeKey = document.getElementById("ps-store-key").value;
    const sourceId = document.getElementById("ps-source-id").value;
    const record = readStore(storeKey, []).find((r) => r.id === sourceId);
    if (!record) return;
    const selling = Number(record.sellingRate) || 0;
    const paid = Number(document.getElementById("ps-partial-amount").value) || 0;
    const remaining = Math.max(0, Math.round((selling - paid) * 100) / 100);
    const currency = record.currency || "EGP";
    document.getElementById("ps-remaining-preview").innerHTML =
      `المتبقي: <span class="remaining-amount">${remaining.toLocaleString("en-US")} ${CURRENCY_LABELS_AR[currency] || currency}</span>`;
  }

  function confirmPaymentStatus() {
    const storeKey = document.getElementById("ps-store-key").value;
    const sourceId = document.getElementById("ps-source-id").value;
    const rows = readStore(storeKey, []);
    const idx = rows.findIndex((r) => r.id === sourceId);
    if (idx === -1) { alert("السجل لم يعد موجودًا."); return; }

    const selling = Number(rows[idx].sellingRate) || 0;
    let paidAmount = 0;
    let collectionAccount = null;

    if (currentPaymentStatus === "cash") {
      paidAmount = selling; // switching straight to Cash/Bank always means "paid in full now" — exactly as requested, no extra typing needed
    } else if (currentPaymentStatus === "bank") {
      paidAmount = selling;
      collectionAccount = document.getElementById("ps-bank-select").value;
    } else if (currentPaymentStatus === "partial") {
      paidAmount = Math.min(Math.max(Number(document.getElementById("ps-partial-amount").value) || 0, 0), selling);
      if (paidAmount <= 0) { alert("أدخل مبلغًا مدفوعًا أكبر من صفر، أو اختر \"لم يدفع\" لو لسه ما اتحصّلش أي حاجة."); return; }
    } else {
      paidAmount = 0; // unpaid
    }

    const remainingAmount = Math.round((selling - paidAmount) * 100) / 100;

    rows[idx].reviewStatus = "reviewed";
    rows[idx].collectionStatus = currentPaymentStatus; // "cash" | "bank" | "unpaid" | "partial"
    rows[idx].collectionAccount = collectionAccount;
    rows[idx].paidAmount = paidAmount;
    rows[idx].remainingAmount = remainingAmount;

    writeStore(storeKey, rows);
    document.getElementById("modal-payment-status").classList.remove("is-open");
    renderAccountingPackage();
  }

  // Groups reviewed records by supplier. CRITICAL: amounts are NEVER
  // summed across different currencies — a 1000 USD sale and a 1000 EGP
  // sale are not "2000" of anything real. Each supplier's totals live
  // under byCurrency, keyed by the actual currency code, so a supplier
  // who's sold in both USD and EGP shows two genuinely separate numbers,
  // never one meaningless combined figure.
  function groupBySupplier(reviewed) {
    const groups = {};
    reviewed.forEach((r) => {
      const currency = r.currency || "EGP";
      if (!groups[r.supplier]) groups[r.supplier] = { supplier: r.supplier, byCurrency: {}, records: [] };
      if (!groups[r.supplier].byCurrency[currency]) groups[r.supplier].byCurrency[currency] = { netRate: 0, profit: 0, count: 0 };
      const bucket = groups[r.supplier].byCurrency[currency];
      bucket.netRate = Math.round((bucket.netRate + r.netRate) * 100) / 100;
      bucket.profit = Math.round((bucket.profit + r.profit) * 100) / 100;
      bucket.count += 1;
      groups[r.supplier].records.push(r);
    });
    // Sort suppliers by their single largest currency bucket's netRate —
    // just a stable, reasonable ordering; never a cross-currency sum.
    return Object.values(groups).sort((a, b) => {
      const maxA = Math.max(0, ...Object.values(a.byCurrency).map((c) => c.netRate));
      const maxB = Math.max(0, ...Object.values(b.byCurrency).map((c) => c.netRate));
      return maxB - maxA;
    });
  }

  // Every currency code that appears anywhere in the currently-reviewed
  // records, in a stable display order — drives the currency filter/
  // selector so the chart and "top supplier" metrics below only ever
  // compare like-for-like.
  const CURRENCY_DISPLAY_ORDER = ["EGP", "USD", "EUR", "SAR", "KWD", "GBP", "JPY", "CNY", "CAD"];
  const CURRENCY_LABELS_AR = { EGP: "جنيه", USD: "دولار", EUR: "يورو", SAR: "ريال", KWD: "دينار", GBP: "استرليني", JPY: "ين ياباني", CNY: "يوان صيني", CAD: "دولار كندي" };

  function currenciesPresentIn(groups) {
    const present = new Set();
    groups.forEach((g) => Object.keys(g.byCurrency).forEach((c) => present.add(c)));
    return CURRENCY_DISPLAY_ORDER.filter((c) => present.has(c));
  }

  let accountingChartInstance = null;

  // =========================================================================
  // Arrears / "لسه ما اتحصّلش" — every reviewed sale whose collection
  // status is "unpaid" or "partial" shows up here specifically, with its
  // remaining balance in red, so it never just vanishes into the general
  // reviewed-records list. Totals are per-currency, exactly like every
  // other total on this page — never summed across currencies.
  // =========================================================================

  function renderArrearsSection(allRecords) {
    const container = document.getElementById("arrears-section");
    if (!container) return;

    const arrears = allRecords.filter((r) => r.reviewStatus === "reviewed" && (r.collectionStatus === "unpaid" || r.collectionStatus === "partial"));
    if (arrears.length === 0) { container.innerHTML = ""; return; }

    const totalsByCurrency = {};
    arrears.forEach((r) => {
      const c = r.currency || "EGP";
      totalsByCurrency[c] = Math.round(((totalsByCurrency[c] || 0) + r.remainingAmount) * 100) / 100;
    });
    const totalsLine = CURRENCY_DISPLAY_ORDER.filter((c) => totalsByCurrency[c]).map((c) =>
      `<span>${CURRENCY_LABELS_AR[c]}: ${totalsByCurrency[c].toLocaleString("en-US")}</span>`
    ).join("");

    const rows = [...arrears].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date)).map((r) => {
      const meta = DEPT_META[r.dept];
      const statusLabel = r.collectionStatus === "unpaid" ? "❌ لم يدفع" : "🟡 دفع جزء";
      return `<tr class="${meta.rowClass}">
        <td><span class="dept-tag ${meta.tagClass}">${meta.label}</span></td>
        <td>${r.date || "-"}</td>
        <td class="cell-primary">${r.customer}</td>
        <td>${r.supplier}</td>
        <td>${statusLabel}</td>
        <td class="num">${money(r.sellingRate, r.currency)}</td>
        <td class="num remaining-amount">${money(r.remainingAmount, r.currency)}</td>
        <td><button class="btn-review" data-mark-reviewed="${r.storeKey}::${r.sourceId}">تعديل حالة التحصيل</button></td>
      </tr>`;
    }).join("");

    container.innerHTML = `
      <div class="arrears-panel">
        <div class="arrears-panel__header">⚠️ متأخرات — لسه ما اتحصّلش (${arrears.length})</div>
        <div class="arrears-totals-line">${totalsLine}</div>
        <div class="ledger-scroll"><table class="acc-table">
          <thead><tr><th>القسم</th><th>التاريخ</th><th>العميل</th><th>المورد</th><th>الحالة</th><th class="num">سعر البيع</th><th class="num">المتبقي</th><th>الإجراء</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    `;
    container.querySelectorAll("[data-mark-reviewed]").forEach((btn) => btn.addEventListener("click", () => {
      const [storeKey, sourceId] = btn.dataset.markReviewed.split("::");
      openPaymentStatusModal(storeKey, sourceId);
    }));
  }

  function renderAccountingPackage() {
    const body = document.getElementById("module-body");
    body.innerHTML = `
      <div id="acc-diagnostic-banner" style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:10px 16px; margin-bottom:18px; font-size:11.5px; color:var(--text-soft);"></div>

      <div class="top-metrics-grid">
        <div class="metric-card"><div class="metric-card__label">أكثر مورد تعاملاً</div><div class="metric-card__value" id="metric-top-volume-name">—</div><div class="metric-card__sub" id="metric-top-volume-value"></div></div>
        <div class="metric-card"><div class="metric-card__label">أكثر مورد ربحية</div><div class="metric-card__value" id="metric-top-profit-name">—</div><div class="metric-card__sub" id="metric-top-profit-value"></div></div>
        <div class="chart-card">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="font-size:11px; font-weight:700; color:var(--text-faint);">الرسم البياني والمؤشرات بعملة:</span>
            <select id="analyse-currency-select" style="font-size:11.5px; padding:5px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface); color:var(--text);"></select>
          </div>
          <div class="chart-card__canvas-wrap" id="chart-canvas-wrap"><canvas id="supplier-chart"></canvas><div id="chart-empty-message" style="display:none; position:absolute; inset:0; align-items:center; justify-content:center; text-align:center; font-size:12px; color:var(--text-faint); padding:20px;"></div></div>
        </div>
      </div>

      <div id="wallet-section"></div>
      <div id="arrears-section"></div>

      <div class="section-title"><div><h2>تقرير المبيعات العام (بانتظار المراجعة)</h2><p>🟢 طيران &nbsp; 🟡 تأشيرات &nbsp; 🌸 فنادق</p></div></div>
      <div class="ledger-scroll">
        <table class="acc-table" id="pending-table">
          <thead><tr><th>القسم</th><th>التاريخ</th><th>العميل</th><th>المورد</th><th class="num">التكلفة (Net)</th><th class="num">سعر البيع</th><th class="num">الربح</th><th>الإجراء</th></tr></thead>
          <tbody id="pending-table-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="pending-empty-state" style="display:none;"><p>لا توجد سجلات بانتظار المراجعة</p></div>

      <div class="section-title"><div><h2>Analyse — ملخص حسابات الموردين</h2></div></div>
      <div class="supplier-summary-grid" id="supplier-summary-grid"></div>
      <div class="section-title"><div><h2>تفكيك أرباح العملاء حسب المورد</h2></div></div>
      <div id="supplier-groups-container"></div>
      <div class="empty-state" id="analyse-empty-state" style="display:none;"><p>لا توجد سجلات تمت مراجعتها بعد</p></div>
    `;

    const allRecords = getAllSalesRecords();
    renderDiagnosticBanner(allRecords);
    renderWalletSection();
    renderArrearsSection(allRecords);
    renderPendingReport(allRecords);
    renderAnalyse(allRecords);
    renderChartAndMetrics(allRecords);

    document.getElementById("analyse-currency-select")?.addEventListener("change", () => {
      renderChartAndMetrics(getAllSalesRecords());
    });
  }

  function renderDiagnosticBanner(allRecords) {
    const banner = document.getElementById("acc-diagnostic-banner");
    if (!banner) return;
    if (allRecords.length === 0) {
      banner.innerHTML = `⚠️ لسه مفيش أي بيعة مسجّلة في أي قسم — سجّل بيعة من الطيران/الفنادق/الفيزا وهترجع تظهر هنا فورًا.`;
      banner.style.color = "var(--coral)";
    } else {
      const pending = allRecords.filter((r) => r.reviewStatus === "pending").length;
      const reviewed = allRecords.filter((r) => r.reviewStatus === "reviewed").length;
      banner.innerHTML = `تم قراءة <strong>${allRecords.length}</strong> عملية — بانتظار المراجعة: <strong>${pending}</strong> · تمت مراجعتها: <strong>${reviewed}</strong>`;
      banner.style.color = "var(--text-soft)";
    }
  }

  function renderPendingReport(allRecords) {
    const pending = allRecords.filter((r) => r.reviewStatus === "pending").sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
    const tbody = document.getElementById("pending-table-body");
    const table = document.getElementById("pending-table");
    const empty = document.getElementById("pending-empty-state");
    if (pending.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";
    tbody.innerHTML = pending.map((r) => {
      const meta = DEPT_META[r.dept];
      return `<tr class="${meta.rowClass}"><td><span class="dept-tag ${meta.tagClass}">${meta.label}</span></td><td>${r.date || "-"}</td><td class="cell-primary">${r.customer}</td><td>${r.supplier}</td><td class="num">${money(r.netRate, r.currency)}</td><td class="num">${money(r.sellingRate, r.currency)}</td><td class="num amount-in">${money(r.profit, r.currency)}</td><td><button class="btn-review" data-mark-reviewed="${r.storeKey}::${r.sourceId}">✓ تمت المراجعة</button></td></tr>`;
    }).join("");
    tbody.querySelectorAll("[data-mark-reviewed]").forEach((btn) => btn.addEventListener("click", () => {
      const [storeKey, sourceId] = btn.dataset.markReviewed.split("::");
      openPaymentStatusModal(storeKey, sourceId);
    }));
  }

  function renderAnalyse(allRecords) {
    const reviewed = allRecords.filter((r) => r.reviewStatus === "reviewed");
    const groups = groupBySupplier(reviewed);
    const summaryGrid = document.getElementById("supplier-summary-grid");
    const groupsContainer = document.getElementById("supplier-groups-container");
    const empty = document.getElementById("analyse-empty-state");
    if (groups.length === 0) { summaryGrid.innerHTML = ""; groupsContainer.innerHTML = ""; empty.style.display = "block"; return; }
    empty.style.display = "none";

    // Each supplier's card lists every currency it actually sold in, one
    // line per currency — never a single combined number.
    summaryGrid.innerHTML = groups.map((g) => {
      const lines = CURRENCY_DISPLAY_ORDER.filter((c) => g.byCurrency[c]).map((c) =>
        `<div class="currency-line"><span class="currency-line__label">${CURRENCY_LABELS_AR[c]}</span><span class="currency-line__value">${g.byCurrency[c].netRate.toLocaleString("en-US")}</span></div>`
      ).join("");
      return `<div class="supplier-summary-card"><div class="supplier-summary-card__name">${g.supplier}</div>${lines}<div class="supplier-summary-card__label">إجمالي Net Rate (${g.records.length} عملية)</div></div>`;
    }).join("");

    groupsContainer.innerHTML = groups.map((g) => {
      const profitLines = CURRENCY_DISPLAY_ORDER.filter((c) => g.byCurrency[c]).map((c) =>
        `<span class="supplier-group__header-total">${CURRENCY_LABELS_AR[c]}: ${g.byCurrency[c].profit.toLocaleString("en-US")}</span>`
      ).join("");
      return `
      <div class="supplier-group">
        <div class="supplier-group__header"><span class="supplier-group__header-name">${g.supplier}</span><div class="supplier-group__header-totals">${profitLines}</div></div>
        <div class="ledger-scroll"><table class="acc-table"><thead><tr><th>العميل</th><th>القسم</th><th class="num">سعر البيع</th><th class="num">التكلفة (Net)</th><th class="num">الربح</th></tr></thead>
          <tbody>${g.records.map((r) => `<tr><td class="cell-primary">${r.customer}</td><td><span class="dept-tag ${DEPT_META[r.dept].tagClass}">${DEPT_META[r.dept].label}</span></td><td class="num">${money(r.sellingRate, r.currency)}</td><td class="num">${money(r.netRate, r.currency)}</td><td class="num amount-in">${money(r.profit, r.currency)}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>`;
    }).join("");
  }

  function renderSupplierChart(groups, currency) {
    const wrap = document.getElementById("chart-canvas-wrap");
    const canvas = document.getElementById("supplier-chart");
    const emptyMsg = document.getElementById("chart-empty-message");

    // Only suppliers that actually have data in the SELECTED currency —
    // mixing bars from different currencies on one axis would be exactly
    // the same "combined nonsense number" problem, just drawn as a chart
    // instead of printed as text.
    const groupsInCurrency = groups.filter((g) => g.byCurrency[currency]);

    if (groupsInCurrency.length === 0) {
      if (accountingChartInstance) { accountingChartInstance.destroy(); accountingChartInstance = null; }
      canvas.style.display = "none"; emptyMsg.style.display = "flex";
      emptyMsg.textContent = `لا توجد سجلات بعملة "${CURRENCY_LABELS_AR[currency] || currency}" تمت مراجعتها بعد.`;
      return;
    }
    if (typeof Chart === "undefined") {
      canvas.style.display = "none"; emptyMsg.style.display = "flex";
      emptyMsg.textContent = "تعذّر تحميل مكتبة الرسم البياني — باقي بيانات الصفحة شغالة عاديًا.";
      return;
    }
    canvas.style.display = "block"; emptyMsg.style.display = "none";
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.max(rect.width, 300);
    canvas.height = Math.max(rect.height, 180);
    try {
      if (accountingChartInstance) accountingChartInstance.destroy();
      accountingChartInstance = new Chart(canvas, {
        type: "bar",
        data: { labels: groupsInCurrency.map((g) => g.supplier), datasets: [
          { label: `حجم التعاملات (Net Rate) — ${CURRENCY_LABELS_AR[currency] || currency}`, data: groupsInCurrency.map((g) => g.byCurrency[currency].netRate), backgroundColor: "#3068E0" },
          { label: `صافي الربح — ${CURRENCY_LABELS_AR[currency] || currency}`, data: groupsInCurrency.map((g) => g.byCurrency[currency].profit), backgroundColor: "#C79A3B" },
        ] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: "bottom", labels: { font: { family: "Cairo" } } } } },
      });
    } catch (err) {
      console.error("Supplier chart rendering failed:", err);
      canvas.style.display = "none"; emptyMsg.style.display = "flex";
      emptyMsg.textContent = "حصل خطأ أثناء رسم الشارت.";
    }
  }

  function renderCurrencySelector(groups) {
    const selector = document.getElementById("analyse-currency-select");
    if (!selector) return;
    const present = currenciesPresentIn(groups);
    const previousValue = selector.value;
    selector.innerHTML = present.map((c) => `<option value="${c}">${CURRENCY_LABELS_AR[c]}</option>`).join("");
    // Keep whatever was selected if it's still a valid option; otherwise
    // fall back to the first currency actually present.
    selector.value = present.includes(previousValue) ? previousValue : (present[0] || "");
  }

  function renderChartAndMetrics(allRecords) {
    const reviewed = allRecords.filter((r) => r.reviewStatus === "reviewed");
    const groups = groupBySupplier(reviewed);
    renderCurrencySelector(groups);
    const selector = document.getElementById("analyse-currency-select");
    const currency = selector ? selector.value : "EGP";

    const groupsInCurrency = groups.filter((g) => g.byCurrency[currency]);
    if (groupsInCurrency.length === 0) {
      document.getElementById("metric-top-volume-name").textContent = "—";
      document.getElementById("metric-top-volume-value").textContent = "";
      document.getElementById("metric-top-profit-name").textContent = "—";
      document.getElementById("metric-top-profit-value").textContent = "";
      renderSupplierChart(groups, currency);
      return;
    }
    const topByVolume = [...groupsInCurrency].sort((a, b) => b.byCurrency[currency].netRate - a.byCurrency[currency].netRate)[0];
    const topByProfit = [...groupsInCurrency].sort((a, b) => b.byCurrency[currency].profit - a.byCurrency[currency].profit)[0];
    document.getElementById("metric-top-volume-name").textContent = topByVolume.supplier;
    document.getElementById("metric-top-volume-value").textContent = `${topByVolume.byCurrency[currency].netRate.toLocaleString("en-US")} ${CURRENCY_LABELS_AR[currency]} — إجمالي Net Rate`;
    document.getElementById("metric-top-profit-name").textContent = topByProfit.supplier;
    document.getElementById("metric-top-profit-value").textContent = `${topByProfit.byCurrency[currency].profit.toLocaleString("en-US")} ${CURRENCY_LABELS_AR[currency]} — صافي الربح`;
    renderSupplierChart(groups, currency);
  }

  MODULE_RENDERERS.accounting = renderAccountingPackage;

  // ================= Modal wiring (fixed elements, wired once) — generalized so any .vv-modal-overlay on this page closes the same way, not just modal-payment-status =================
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => document.getElementById(btn.dataset.closeModal)?.classList.remove("is-open"));
  });
  document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open"));
  });
  document.querySelectorAll(".payment-switch__option").forEach((btn) => {
    btn.addEventListener("click", () => selectPaymentStatus(btn.dataset.paymentStatus));
  });
  document.getElementById("ps-partial-amount")?.addEventListener("input", updatePartialPreview);
  document.getElementById("btn-confirm-payment-status")?.addEventListener("click", confirmPaymentStatus);
  document.getElementById("btn-confirm-wallet-pay")?.addEventListener("click", confirmWalletPay);

  // Deep-link support — e.g. the "Accounts" module links here with
  // ?open=accounting so it jumps straight into the package instead of
  // landing on the dashboard and requiring an extra click. Placed at the
  // very end since it must run only after every MODULE_RENDERERS entry
  // above has actually been assigned.
  const requestedView = new URLSearchParams(window.location.search).get("open");
  if (requestedView && MODULE_RENDERERS[requestedView]) {
    switchDataView(requestedView);
  }
})();