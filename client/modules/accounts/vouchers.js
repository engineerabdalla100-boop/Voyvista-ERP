/**
 * vouchers.js — client/modules/accounts/ (سندات القبض والصرف)
 * -----------------------------------------------------------------------
 * Registers into VVAccountsModules.receipt AND VVAccountsModules.payment
 * — both share this one file since they're mirror images of the same screen.
 *
 * Self-wires:
 *   [data-view="receipt"] / #qa-receipt
 *   [data-view="payment"] / #qa-payment
 *
 * Financial behavior:
 *   Receipt: Treasury increases, Party balance decreases.
 *   Payment: Treasury decreases, Party balance increases.
 *
 * Financial mutation happens ONLY from the VVChangeRequests Apply Handler.
 * Draft/submitted/approved states never touch financial balances.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const CORE = window.VVAccountsCore;
  const WF = window.VVWorkflow;

  // =========================================================================
  // Store helpers
  // =========================================================================

  function readVouchers() {
    return CORE.readStore("vv_vouchers", []);
  }

  function writeVouchers(vouchers) {
    CORE.writeStore("vv_vouchers", vouchers);
  }

  function partyStoreKey(partyType) {
    return partyType === "customer" ? "vv_acc_customers" : "vv_acc_suppliers";
  }

  function readPartyStore(partyType) {
    return CORE.readStore(partyStoreKey(partyType), {});
  }

  function writePartyStore(partyType, store) {
    CORE.writeStore(partyStoreKey(partyType), store);
  }

  function allPartyNames() {
    const customers = Object.keys(readPartyStore("customer")).map((name) => ({ name, type: "customer" }));
    const suppliers = Object.keys(readPartyStore("supplier")).map((name) => ({ name, type: "supplier" }));
    return [...customers, ...suppliers];
  }

  // =========================================================================
  // Voucher numbering
  // =========================================================================

  function readVoucherSequences() {
    return CORE.readStore("vv_voucher_sequences", { receipt: 0, payment: 0 });
  }

  function writeVoucherSequences(seq) {
    CORE.writeStore("vv_voucher_sequences", seq);
  }

  function voucherPrefix(type) {
    return type === "receipt" ? "REC" : "PAY";
  }

  function peekNextVoucherNumber(type) {
    const prefix = voucherPrefix(type);
    const seq = readVoucherSequences();
    return `${prefix}-${String((seq[type] || 0) + 1).padStart(4, "0")}`;
  }

  function consumeNextVoucherNumber(type) {
    const prefix = voucherPrefix(type);
    const seq = readVoucherSequences();
    seq[type] = (seq[type] || 0) + 1;
    writeVoucherSequences(seq);
    return `${prefix}-${String(seq[type]).padStart(4, "0")}`;
  }

  // =========================================================================
  // Financial mutation
  // =========================================================================

  function applyVoucherEffect(voucher, sign) {
    if (!voucher) {
      return { success: false, reason: "السند غير موجود." };
    }

    if (voucher.type !== "receipt" && voucher.type !== "payment") {
      return { success: false, reason: `نوع السند غير صالح: "${voucher.type}".` };
    }

    const amount = Number(voucher.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, reason: `المبلغ غير صالح: "${voucher.amount}" — يجب أن يكون رقمًا أكبر من صفر.` };
    }

    if (voucher.partyType !== "customer" && voucher.partyType !== "supplier") {
      return { success: false, reason: `نوع الحساب غير صالح: "${voucher.partyType}".` };
    }

    if (!voucher.partyName || !String(voucher.partyName).trim()) {
      return { success: false, reason: "اسم العميل/المورد مفقود." };
    }

    if (!window.VVTreasury) {
      return { success: false, reason: "خدمة الخزينة (VVTreasury) غير متاحة حاليًا — تعذّر تنفيذ الأثر المالي." };
    }

    const realAccountIds = window.VVTreasury.accountOptions().map((option) => option.id);

    if (!voucher.accountId || !realAccountIds.includes(voucher.accountId)) {
      return { success: false, reason: `طريقة الدفع/التحصيل المختارة (${voucher.accountId || "—"}) لم تعد موجودة في الخزينة.` };
    }

    if (sign !== 1 && sign !== -1) {
      return { success: false, reason: `إشارة الأثر المالي غير صالحة: "${sign}".` };
    }

    // Mutate Treasury
    const treasuryDelta = voucher.type === "receipt" ? amount : -amount;
    window.VVTreasury.adjustBalance(voucher.accountId, treasuryDelta * sign);

    // Mutate Party Ledger
    const store = readPartyStore(voucher.partyType);

    if (!store[voucher.partyName]) {
      store[voucher.partyName] = { balance: 0, ledger: [] };
    }

    const balanceDelta = voucher.type === "receipt" ? -amount : amount;
    const signedBalanceDelta = Math.round((balanceDelta * sign) * 100) / 100;

    store[voucher.partyName].balance = Math.round((store[voucher.partyName].balance + signedBalanceDelta) * 100) / 100;

    const isReversalEffect = sign < 0;
    const kindLabel = voucher.type === "receipt" ? "سند قبض" : "سند صرف";

    store[voucher.partyName].ledger.push({
      transactionId: voucher.id,
      date: voucher.date,
      type: voucher.type === "receipt" ? "receipt_voucher" : "payment_voucher",
      amount: signedBalanceDelta,
      description: isReversalEffect
        ? `عكس أثر ${kindLabel} ${voucher.number} — ${voucher.description}`
        : `${kindLabel} ${voucher.number} — ${voucher.description}`,
    });

    writePartyStore(voucher.partyType, store);

    return { success: true };
  }

  // =========================================================================
  // Main render
  // =========================================================================

  let currentVoucherType = "receipt";

  function renderVoucherModule(params) {
    currentVoucherType = (params && params.type) || currentVoucherType;
    const isReceipt = currentVoucherType === "receipt";

    const body = document.getElementById("module-body");

    body.innerHTML = `
      <style>
        .row-reversal { background-color: rgba(239, 68, 68, 0.05); }
      </style>
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px; margin-bottom:20px;">
        <h3 style="font-family:'Cairo',sans-serif; font-size:14px; font-weight:800; margin-bottom:14px;">
          ${isReceipt ? "سند قبض جديد" : "سند صرف جديد"}
        </h3>

        <div class="vv-field-row">
          <div class="vv-field">
            <label>رقم السند</label>
            <input type="text" id="v-number" readonly />
          </div>
          <div class="vv-field">
            <label>التاريخ</label>
            <input type="date" id="v-date" />
          </div>
        </div>

        <div class="vv-field">
          <label>${isReceipt ? "اسم الحساب / العميل" : "اسم الحساب / المورد"}</label>
          <select id="v-party"></select>
        </div>

        <div class="vv-field-row">
          <div class="vv-field">
            <label>المبلغ</label>
            <input type="number" min="0" step="0.01" id="v-amount" value="0" />
          </div>
          <div class="vv-field">
            <label>${isReceipt ? "طريقة التحصيل" : "طريقة الدفع"}</label>
            <select id="v-account"></select>
          </div>
        </div>

        <div class="vv-field">
          <label>البيان</label>
          <input type="text" id="v-description" placeholder="وصف السند..." />
        </div>

        <div style="display:flex; gap:24px; align-items:center; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px 18px; margin:14px 0;">
          <div>الرصيد الحالي: <strong id="v-balance-before">0.00</strong></div>
          <div>بعد السند: <strong id="v-balance-after" style="color:var(--gold-deep);">0.00</strong></div>
        </div>

        <button class="btn btn--primary" id="btn-save-voucher" type="button">
          حفظ السند (كمسوّدة)
        </button>
      </div>

      <div class="table-controls" style="margin-bottom:14px;">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>
          </svg>
          <input type="text" id="voucher-search" placeholder="بحث بالاسم أو الرقم أو البيان..." />
        </div>
      </div>

      <div class="ledger-scroll">
        <table class="acc-table" id="vouchers-table">
          <thead>
            <tr>
              <th>الرقم</th>
              <th>التاريخ</th>
              <th>الحساب</th>
              <th>المبلغ</th>
              <th>الطريقة</th>
              <th>البيان</th>
              <th>الحالة</th>
              <th>الإجراءات</th>
            </tr>
          </thead>
          <tbody id="vouchers-table-body"></tbody>
        </table>
      </div>

      <div class="empty-state" id="vouchers-empty-state" style="display:none;">
        <p>لا توجد سندات بعد</p>
      </div>
    `;

    document.getElementById("v-number").value = peekNextVoucherNumber(currentVoucherType);
    document.getElementById("v-date").value = CORE.todayISO();

    const parties = allPartyNames();
    document.getElementById("v-party").innerHTML = parties.length === 0
      ? `<option value="">-- لا يوجد عملاء/موردين مسجّلين --</option>`
      : parties.map((party) => `<option value="${party.type}::${party.name}">${party.name} (${party.type === "customer" ? "عميل" : "مورد"})</option>`).join("");

    if (window.VVTreasury) {
      document.getElementById("v-account").innerHTML = window.VVTreasury.accountOptions()
        .map((option) => `<option value="${option.id}">${option.label}</option>`).join("");
    }

    document.getElementById("v-party").addEventListener("change", updateBalancePreview);
    document.getElementById("v-amount").addEventListener("input", updateBalancePreview);
    updateBalancePreview();

    document.getElementById("btn-save-voucher").addEventListener("click", saveVoucher);
    document.getElementById("voucher-search").addEventListener("input", renderVouchersTable);

    renderVouchersTable();
  }

  // =========================================================================
  // Balance preview
  // =========================================================================

  function updateBalancePreview() {
    const partySelect = document.getElementById("v-party");
    const amountInput = document.getElementById("v-amount");
    const beforeElement = document.getElementById("v-balance-before");
    const afterElement = document.getElementById("v-balance-after");

    if (!partySelect || !amountInput || !beforeElement || !afterElement) return;

    const selected = partySelect.value;
    if (!selected) {
      beforeElement.textContent = CORE.formatMoney(0);
      afterElement.textContent = CORE.formatMoney(0);
      return;
    }

    const [partyType, partyName] = selected.split("::");
    const store = readPartyStore(partyType);
    const currentBalance = (store[partyName] && store[partyName].balance) || 0;
    const amount = Number(amountInput.value) || 0;
    const delta = currentVoucherType === "receipt" ? -amount : amount;

    beforeElement.textContent = CORE.formatMoney(currentBalance);
    afterElement.textContent = CORE.formatMoney(Math.round((currentBalance + delta) * 100) / 100);
  }

  // =========================================================================
  // Create draft voucher
  // =========================================================================

  function saveVoucher() {
    const selected = document.getElementById("v-party").value;
    const amount = Number(document.getElementById("v-amount").value) || 0;
    const description = document.getElementById("v-description").value.trim();

    if (!selected) { alert("اختار العميل/المورد أولاً."); return; }
    if (amount <= 0) { alert("المبلغ لازم يكون أكبر من صفر."); return; }
    if (!description) { alert("البيان مطلوب."); return; }

    const [partyType, partyName] = selected.split("::");
    if (partyType !== "customer" && partyType !== "supplier") { alert("نوع الحساب غير صالح."); return; }
    if (!partyName || !partyName.trim()) { alert("اسم العميل/المورد غير صالح."); return; }

    const accountId = document.getElementById("v-account").value;
    if (!accountId) { alert("اختار طريقة التحصيل/الدفع أولاً."); return; }

    const vouchers = readVouchers();
    const newVoucher = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      number: consumeNextVoucherNumber(currentVoucherType),
      type: currentVoucherType,
      date: document.getElementById("v-date").value || CORE.todayISO(),
      partyType,
      partyName,
      amount,
      accountId,
      description,
      status: "draft",
      isReversal: false,
      reversed: false,
      reversedBy: null,
      reversesVoucherId: null,
      reversalState: null,
    };

    vouchers.push(newVoucher);
    writeVouchers(vouchers);
    renderVoucherModule({ type: currentVoucherType });
  }

  // =========================================================================
  // Table rendering
  // =========================================================================

  function renderVouchersTable() {
    const searchElement = document.getElementById("voucher-search");
    const tbody = document.getElementById("vouchers-table-body");
    const table = document.getElementById("vouchers-table");
    const empty = document.getElementById("vouchers-empty-state");

    if (!searchElement || !tbody || !table || !empty) return;

    const query = (searchElement.value || "").trim().toLowerCase();
    let rows = readVouchers().filter((voucher) => voucher.type === currentVoucherType);

    if (query) {
      rows = rows.filter((voucher) =>
        String(voucher.partyName || "").toLowerCase().includes(query) ||
        String(voucher.number || "").toLowerCase().includes(query) ||
        String(voucher.description || "").toLowerCase().includes(query)
      );
    }

    rows = [...rows].sort((a, b) => (b.id > a.id ? 1 : -1));

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }

    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((voucher) => `
      <tr class="${voucher.isReversal ? "row-reversal" : ""}">
        <td class="mono">
          ${voucher.number}
          ${voucher.isReversal ? '<span style="color:var(--danger); font-size:11px;">(عكسي 🔄)</span>' : ""}
        </td>
        <td>${voucher.date}</td>
        <td class="cell-primary">${voucher.partyName}</td>
        <td class="num ${voucher.type === "receipt" ? "amount-in" : "amount-out"}">${CORE.formatMoney(voucher.amount)}</td>
        <td>${window.VVTreasury ? window.VVTreasury.accountLabel(voucher.accountId) : voucher.accountId}</td>
        <td>${voucher.description}</td>
        <td>${WF.badgeHtml(voucher.status)}</td>
        <td>${WF.actionsHtml(voucher, { allowReverse: true })}</td>
      </tr>
    `).join("");

    WF.wireButtons(tbody, {
      records: rows,
      onAdvance: (record, fromStatus) => {
        if (fromStatus === "approved") {
          submitPostingRequest(record.id);
          return;
        }

        const vouchers = readVouchers();
        const idx = vouchers.findIndex((voucher) => voucher.id === record.id);
        if (idx === -1) { alert("السند لم يعد موجودًا."); renderVouchersTable(); return; }

        const currentStatus = vouchers[idx].status;
        const allowedTransitions = { draft: "submitted", submitted: "approved" };

        if (allowedTransitions[currentStatus] === record.status) {
          vouchers[idx].status = record.status;
          writeVouchers(vouchers);
          renderVouchersTable();
        } else {
          alert("تغيير حالة غير مصرح به أو تم تحديث البيانات بواسطة مستخدم آخر.");
          renderVouchersTable();
        }
      },
      onDelete: (record) => {
        if (record.status !== "draft") { alert("لا يمكن حذف سند تم اعتماده أو ترحيله."); return; }

        const vouchers = readVouchers();
        const exists = vouchers.some((voucher) => voucher.id === record.id);
        if (!exists) { alert("السند لم يعد موجودًا."); renderVouchersTable(); return; }

        writeVouchers(vouchers.filter((voucher) => voucher.id !== record.id));
        renderVouchersTable();
      },
      onReverse: (record) => {
        submitReversalRequest(record.id);
      },
    });
  }

  // =========================================================================
  // Requests Handoff
  // =========================================================================

  function submitPostingRequest(voucherId) {
    const vouchers = readVouchers();
    const voucher = vouchers.find((item) => item.id === voucherId);

    if (!voucher) { alert("السند لم يعد موجودًا."); return; }
    if (voucher.status === "posting") { alert("هذا السند في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية."); return; }
    if (voucher.status !== "approved") { alert(`لا يمكن ترحيل السند — حالته الحالية "${WF.label(voucher.status)}"، ويجب أن تكون "معتمد".`); return; }
    if (voucher.reversed || voucher.reversedBy) { alert("لا يمكن ترحيل سند تم عكسه بالفعل."); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "vouchers",
      changeType: "post",
      targetId: voucher.id,
      targetLabel: `${voucher.number} — ${voucher.partyName}`,
      payload: {},
    });

    if (request) {
      alert(request.status === "approved" ? `تم ترحيل السند ${voucher.number} فورًا.` : `تم إرسال طلب ترحيل السند ${voucher.number} — بانتظار الاعتماد.`);
      renderVouchersTable();
    }
  }

  function submitReversalRequest(voucherId) {
    const vouchers = readVouchers();
    const original = vouchers.find((item) => item.id === voucherId);

    if (!original) { alert("السند لم يعد موجودًا."); return; }
    if (original.reversalState === "in_progress") { alert("هذا السند في حالة عكس معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية."); return; }
    if (original.status !== "posted") { alert("لا يمكن عكس سند إلا وهو مُرحّل."); return; }
    if (original.reversedBy || original.reversed) { alert("هذا السند تم عكسه بالفعل."); return; }

    const request = window.VVChangeRequests.createRequest({
      module: "vouchers",
      changeType: "reverse",
      targetId: original.id,
      targetLabel: `${original.number} — ${original.partyName}`,
      payload: {},
    });

    if (request) {
      alert(request.status === "approved" ? `تم عكس السند ${original.number} فورًا.` : `تم إرسال طلب عكس السند ${original.number} — بانتظار الاعتماد.`);
      renderVouchersTable();
    }
  }

  // =========================================================================
  // Apply Handler (VVChangeRequests)
  // =========================================================================

  if (window.VVChangeRequests) {
    window.VVChangeRequests.registerApplyHandler("vouchers", (request) => {
      const vouchers = readVouchers();
      const voucher = vouchers.find((item) => item.id === request.targetId);

      // POST
      if (request.changeType === "post") {
        if (!voucher) return { success: false, reason: "السند المستهدف لم يعد موجودًا." };
        if (voucher.status === "posting") return { success: false, reason: "هذا السند في حالة ترحيل معلّقة من محاولة سابقة لم تكتمل — يحتاج مراجعة يدوية." };
        if (voucher.status !== "approved") return { success: false, reason: `حالة السند الحالية "${WF.label(voucher.status)}" — يجب أن تكون "معتمد" قبل الترحيل.` };
        if (voucher.reversed || voucher.reversedBy) return { success: false, reason: "لا يمكن ترحيل سند تم عكسه بالفعل." };

        const idx = vouchers.findIndex((item) => item.id === voucher.id);
        if (idx === -1) return { success: false, reason: "السند اختفى قبل بدء الترحيل." };

        vouchers[idx].status = "posting";
        writeVouchers(vouchers);

        const postResult = applyVoucherEffect(voucher, 1);

        if (!postResult.success) {
          const revertVouchers = readVouchers();
          const revertIdx = revertVouchers.findIndex((item) => item.id === voucher.id);
          if (revertIdx !== -1) { revertVouchers[revertIdx].status = "approved"; writeVouchers(revertVouchers); }
          return postResult;
        }

        const finalVouchers = readVouchers();
        const finalIdx = finalVouchers.findIndex((item) => item.id === voucher.id);
        if (finalIdx === -1) return { success: false, reason: "تم تنفيذ الأثر المالي لكن السند لم يعد موجودًا أثناء حفظ الحالة النهائية." };

        finalVouchers[finalIdx].status = "posted";
        writeVouchers(finalVouchers);
        return { success: true };
      }

      // REVERSE
      if (request.changeType === "reverse") {
        if (!voucher) return { success: false, reason: "السند الأصلي لم يعد موجودًا." };
        if (voucher.reversalState === "in_progress") return { success: false, reason: "هذا السند في حالة عكس معلّقة من محاولة سابقة لم تكتمل." };
        if (voucher.status !== "posted") return { success: false, reason: `لا يمكن عكس سند حالته "${WF.label(voucher.status)}" — يجب أن يكون "مُرحّل".` };
        if (voucher.reversedBy || voucher.reversed) return { success: false, reason: "هذا السند تم عكسه بالفعل." };

        // Intent Marker on Original
        const idx = vouchers.findIndex((item) => item.id === voucher.id);
        if (idx === -1) return { success: false, reason: "السند اختفى قبل بدء العكس." };

        vouchers[idx].reversalState = "in_progress";
        writeVouchers(vouchers);

        const reversingVoucher = {
          id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          number: consumeNextVoucherNumber(voucher.type),
          type: voucher.type,
          date: CORE.todayISO(),
          partyType: voucher.partyType,
          partyName: voucher.partyName,
          amount: voucher.amount,
          accountId: voucher.accountId,
          description: `سند عكسي للسند ${voucher.number} — ${voucher.description}`,
          status: "posted",
          isReversal: true,
          reversed: false,
          reversedBy: null,
          reversesVoucherId: voucher.id,
          reversalState: null,
        };

        // Financial mutation with sign=-1
        const postResult = applyVoucherEffect(reversingVoucher, -1);

        if (!postResult.success) {
          const revertVouchers = readVouchers();
          const revertIdx = revertVouchers.findIndex((item) => item.id === voucher.id);
          if (revertIdx !== -1) { revertVouchers[revertIdx].reversalState = null; writeVouchers(revertVouchers); }
          return postResult;
        }

        // Finalize state on original and push reversing voucher
        const finalVouchers = readVouchers();
        const finalIdx = finalVouchers.findIndex((item) => item.id === voucher.id);
        if (finalIdx !== -1) {
          finalVouchers[finalIdx].reversedBy = reversingVoucher.id;
          finalVouchers[finalIdx].reversed = true;
          finalVouchers[finalIdx].reversalState = null;
        }
        finalVouchers.push(reversingVoucher);
        writeVouchers(finalVouchers);
        return { success: true };
      }

      return { success: false, reason: `نوع طلب غير معروف للسندات: ${request.changeType}` };
    });
  }

  // =========================================================================
  // Self-wire both dashboard triggers + register both module keys
  // =========================================================================

  window.VVAccountsModules = window.VVAccountsModules || {};
  window.VVAccountsModules.receipt = (params) => renderVoucherModule({ ...(params || {}), type: "receipt" });
  window.VVAccountsModules.payment = (params) => renderVoucherModule({ ...(params || {}), type: "payment" });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll('[data-view="receipt"], #qa-receipt').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("receipt"));
    });
    document.querySelectorAll('[data-view="payment"], #qa-payment').forEach((btn) => {
      btn.addEventListener("click", () => window.switchAccountView("payment"));
    });
  });
})();