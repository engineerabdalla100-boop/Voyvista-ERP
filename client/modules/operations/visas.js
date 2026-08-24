document.addEventListener("DOMContentLoaded", () => {
  // State Storage (separate keys — independent ledger from Flights/Hotels)
  let salesData = JSON.parse(localStorage.getItem("vv_visa_sales_data")) || [];
  let requestsData = JSON.parse(localStorage.getItem("vv_visa_requests_data")) || [];
  let editingSaleId = null;
  let editingRequestId = null;
  let nextCodeId = parseInt(localStorage.getItem("vv_visa_next_code_id")) || 1001;

  const setupModalHandlers = () => {
    document.querySelectorAll("[id^='hub-open-']").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetId = btn.id.replace("hub-open-", "modal-");
        const modal = document.getElementById(targetId);
        if (modal) modal.classList.add("is-open");
      });
    });
    document.querySelectorAll("[data-close-modal]").forEach(btn => {
      btn.addEventListener("click", () => {
        const modalId = btn.getAttribute("data-close-modal");
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove("is-open");
      });
    });
    document.querySelectorAll(".vv-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const parentModal = tab.closest(".vv-modal__body");
        parentModal.querySelectorAll(".vv-tab").forEach(t => t.classList.remove("is-active"));
        parentModal.querySelectorAll(".vv-tab-panel").forEach(p => p.classList.remove("is-active"));
        tab.classList.add("is-active");
        const targetPanel = document.getElementById(tab.getAttribute("data-tab-target"));
        if (targetPanel) targetPanel.classList.add("is-active");
      });
    });
  };

  // ROOT-CAUSE FIX for the month-separator/date bug: `toISOString()` converts
  // to UTC, so entering a record just after local midnight could silently get
  // stamped with *yesterday's* date once the timezone offset was applied.
  // This builds the date string from the browser's own local year/month/day
  // instead, so "today" always means the user's actual today.
  const getTodayISO = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // The other half of the same bug: `new Date("2026-08-01")` is parsed as
  // *UTC* midnight by the JS spec, so formatting it back with
  // `toLocaleString()` (which uses the *local* timezone) can silently roll
  // it into the previous or next day depending on the viewer's timezone —
  // exactly why a record could show under the wrong month separator. Parsing
  // the components manually always stays in local time, with no shift.
  const parseLocalDate = (dateStr) => {
    if (!dateStr) return new Date(NaN);
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  const generateNewFamilyCode = () => `FAM-V${nextCodeId}`;

  // ================= INVOICE MODULE LOGIC =================
  const setupInvoiceLogic = () => {
    const invDate = document.getElementById("inv-date");
    if (invDate) invDate.value = getTodayISO();

    const calcInvoiceTotals = () => {
      let total = 0;
      document.querySelectorAll("#invoice-items-body tr").forEach(row => {
        const qty = parseFloat(row.querySelector(".inv-qty")?.value) || 0;
        const price = parseFloat(row.querySelector(".inv-price")?.value) || 0;
        const lineTotal = qty * price;
        row.querySelector(".inv-line-total").value = lineTotal.toFixed(2);
        total += lineTotal;
      });
      const curr = document.getElementById("inv-currency")?.value || 'USD';
      document.getElementById("inv-grand-total").innerText = `${total.toFixed(2)} ${curr}`;
    };

    document.getElementById("invoice-items-body")?.addEventListener("input", calcInvoiceTotals);
    document.getElementById("inv-currency")?.addEventListener("change", calcInvoiceTotals);

    document.getElementById("btn-add-inv-row")?.addEventListener("click", () => {
      const tbody = document.getElementById("invoice-items-body");
      const row = document.createElement("tr");
      row.innerHTML = `
        <td><input type="text" class="inv-desc" placeholder="Item description" required /></td>
        <td><input type="number" class="inv-qty" value="1" min="1" required /></td>
        <td><input type="number" class="inv-price" value="0" min="0" step="0.01" required /></td>
        <td><input type="text" class="inv-line-total" value="0.00" readonly /></td>
        <td><button type="button" class="row-remove-btn">✕</button></td>
      `;
      tbody.appendChild(row);
      row.querySelector(".row-remove-btn").addEventListener("click", () => {
        row.remove();
        calcInvoiceTotals();
      });
    });

    const collectInvoiceData = () => {
      const items = [];
      document.querySelectorAll("#invoice-items-body tr").forEach(row => {
        const desc = row.querySelector(".inv-desc")?.value || "";
        const qty = parseFloat(row.querySelector(".inv-qty")?.value) || 0;
        const price = parseFloat(row.querySelector(".inv-price")?.value) || 0;
        if (desc) items.push({ desc, qty, price, total: qty * price });
      });
      return {
        client: document.getElementById("inv-client-name")?.value || "",
        date: document.getElementById("inv-date")?.value || getTodayISO(),
        ref: document.getElementById("inv-ref")?.value || "",
        currency: document.getElementById("inv-currency")?.value || "USD",
        items,
        total: items.reduce((sum, it) => sum + it.total, 0),
      };
    };

    document.getElementById("btn-print-voucher")?.addEventListener("click", () => {
      const data = collectInvoiceData();
      if (!data.client || data.items.length === 0) {
        alert("Enter a client name and at least one item first.");
        return;
      }

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 16;
      let y = 20;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Voyvista — Visas", marginX, y);
      doc.setFontSize(13);
      doc.text("Invoice / Voucher", pageWidth - marginX, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(data.ref || "INTERNAL VOUCHER", pageWidth - marginX, y + 5, { align: "right" });
      doc.setTextColor(20);

      y += 9;
      doc.setDrawColor(28, 13, 20);
      doc.setLineWidth(0.6);
      doc.line(marginX, y, pageWidth - marginX, y);

      y += 8;
      doc.setFontSize(10.5);
      doc.setFont("helvetica", "normal");
      doc.text(`Client: ${data.client}`, marginX, y);
      doc.text(`Date: ${data.date}`, pageWidth - marginX, y, { align: "right" });

      y += 9;
      const colDesc = marginX, colQty = pageWidth - marginX - 55, colPrice = pageWidth - marginX - 35, colTotal = pageWidth - marginX - 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("DESCRIPTION", colDesc, y);
      doc.text("QTY", colQty, y, { align: "right" });
      doc.text("PRICE", colPrice, y, { align: "right" });
      doc.text("TOTAL", colTotal, y, { align: "right" });
      y += 2;
      doc.setLineWidth(0.4);
      doc.line(marginX, y, pageWidth - marginX, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      data.items.forEach((it) => {
        y += 7;
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(String(it.desc), colDesc, y);
        doc.text(String(it.qty), colQty, y, { align: "right" });
        doc.text(it.price.toFixed(2), colPrice, y, { align: "right" });
        doc.text(it.total.toFixed(2), colTotal, y, { align: "right" });
        doc.setDrawColor(230);
        doc.setLineWidth(0.2);
        doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
      });

      y += 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(20);
      doc.text(`${data.total.toFixed(2)} ${data.currency}`, pageWidth - marginX, y, { align: "right" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(150);
      doc.text(
        "Voyvista ERP — Internal Voucher / Invoice — Tourism & Travel Management System",
        pageWidth / 2, 285, { align: "center" }
      );

      doc.save(`Voyvista-Visa-Invoice-${data.ref || data.date}.pdf`);
    });

    document.getElementById("btn-submit-invoice")?.addEventListener("click", () => {
      const data = collectInvoiceData();
      if (!data.client || data.items.length === 0) {
        alert("Enter a client name and at least one item first.");
        return;
      }
      const accountingInvoices = JSON.parse(localStorage.getItem("vv_accounting_invoices")) || [];
      accountingInvoices.push({
        id: Date.now().toString().slice(-6),
        department: "visas",
        status: "PENDING_ACCOUNTING_APPROVAL",
        submittedAt: new Date().toISOString(),
        ...data,
      });
      localStorage.setItem("vv_accounting_invoices", JSON.stringify(accountingInvoices));

      alert("Invoice submitted to accounting — status: Pending Accounting Approval.");
      document.getElementById("invoice-create-form")?.reset();
      document.getElementById("inv-date").value = getTodayISO();
      calcInvoiceTotals();
      document.getElementById("modal-invoices").classList.remove("is-open");
    });
  };

  // ================= BOOKINGS & SALES LEDGER =================
  // Net Rate = Rate + Handling (auto). Profit = Selling Rate - Net Rate (auto),
  // shown right after Selling Rate per the current field order.
  const recalcRow = (prefix) => {
    const rate = parseFloat(document.getElementById(`${prefix}-rate`).value) || 0;
    const handling = parseFloat(document.getElementById(`${prefix}-handling`).value) || 0;
    const selling = parseFloat(document.getElementById(`${prefix}-selling-rate`).value) || 0;
    const netRate = rate + handling;
    document.getElementById(`${prefix}-net-rate`).value = netRate.toFixed(2);
    document.getElementById(`${prefix}-profit`).value = (selling - netRate).toFixed(2);
  };

  const initForms = () => {
    document.getElementById("sales-date").value = getTodayISO();
    document.getElementById("req-date").value = getTodayISO();

    document.getElementById("sales-file-number").value = generateNewFamilyCode();
    document.getElementById("req-file-number").value = generateNewFamilyCode();

    ["sales-rate", "sales-handling", "sales-selling-rate"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", () => recalcRow("sales"));
    });
    ["req-rate", "req-handling", "req-selling-rate"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", () => recalcRow("req"));
    });

    const toggleCheckbox = document.getElementById("toggle-existing-code");
    const codeInput = document.getElementById("sales-file-number");
    const codeSelect = document.getElementById("sales-existing-code-select");

    function readCentralPartyMeta() {
      try { return JSON.parse(localStorage.getItem("vv_acc_party_meta")) || {}; } catch (e) { return {}; }
    }

    toggleCheckbox?.addEventListener("change", (e) => {
      if (e.target.checked) {
        const meta = readCentralPartyMeta();
        const namesByCode = {};
        Object.entries(meta).forEach(([partyName, m]) => {
          if (!m.code) return;
          if (!namesByCode[m.code]) namesByCode[m.code] = [];
          namesByCode[m.code].push(partyName);
        });
        const codes = Object.keys(namesByCode).sort();

        codeSelect.innerHTML = codes.length === 0
          ? '<option value="">-- لا توجد أكواد مسجّلة في قسم البيانات بعد --</option>'
          : '<option value="">-- Select Code --</option>' + codes.map((code) => `<option value="${code}">${code} — ${namesByCode[code].join(" / ")}</option>`).join("");
        codeSelect.dataset.namesByCode = JSON.stringify(namesByCode);
        codeInput.style.display = "none";
        codeSelect.style.display = "block";
      } else {
        codeInput.style.display = "block";
        codeSelect.style.display = "none";
        codeInput.value = generateNewFamilyCode();
      }
    });

    codeSelect?.addEventListener("change", () => {
      if (!codeSelect.value) return;
      const namesByCode = JSON.parse(codeSelect.dataset.namesByCode || "{}");
      const names = namesByCode[codeSelect.value] || [];
      const nameField = document.getElementById("sales-client-name");
      if (nameField && !nameField.value.trim() && names.length === 1) {
        nameField.value = names[0];
      }
    });
  };

  const CURRENCY_SYMBOLS = { EGP: "E£", USD: "$", EUR: "€", SAR: "ر.س", KWD: "د.ك", GBP: "£", JPY: "¥", CNY: "¥", CAD: "$" };
  const currencySymbol = (code) => CURRENCY_SYMBOLS[code] || "$";

  // =========================================================================
  // Payment switch — lives in the registration form itself (Cash /
  // InstaPay / Partial), as basic registration data. The Sales Report
  // table only ever shows a read-only status badge — never interactive
  // controls. Writes to collectionStatus/paidAmount/remainingAmount —
  // the exact same fields Data's Accounting/Arrears sections already
  // read. HONEST LIMITATION (deliberate): documentation field only —
  // never reads from or writes to VVTreasury/vv_treasury_cash/
  // vv_treasury_banks. The real Treasury stays completely untouched.
  // =========================================================================

  let selectedFormPaymentStatus = null;

  function selectFormPaymentStatus(status) {
    selectedFormPaymentStatus = status;
    document.querySelectorAll(".pay-switch-form__option").forEach((el) => el.classList.toggle("is-selected", el.dataset.formPay === status));
    document.getElementById("sales-partial-row").style.display = status === "partial" ? "flex" : "none";
    updateFormRemainingPreview();
  }

  function updateFormRemainingPreview() {
    if (selectedFormPaymentStatus !== "partial") return;
    const selling = Number(document.getElementById("sales-selling-rate").value) || 0;
    const paid = Number(document.getElementById("sales-paid-amount").value) || 0;
    const remaining = Math.max(0, Math.round((selling - paid) * 100) / 100);
    document.getElementById("sales-remaining-preview").textContent = `المتبقي: ${remaining.toFixed(2)}`;
  }

  function resetFormPaymentSwitch() {
    selectedFormPaymentStatus = null;
    document.querySelectorAll(".pay-switch-form__option").forEach((el) => el.classList.remove("is-selected"));
    document.getElementById("sales-partial-row").style.display = "none";
    document.getElementById("sales-paid-amount").value = "";
    document.getElementById("sales-remaining-preview").textContent = "";
  }

  document.querySelectorAll(".pay-switch-form__option").forEach((btn) => {
    btn.addEventListener("click", () => selectFormPaymentStatus(btn.dataset.formPay));
  });
  document.getElementById("sales-paid-amount")?.addEventListener("input", updateFormRemainingPreview);
  document.getElementById("sales-selling-rate")?.addEventListener("input", updateFormRemainingPreview);

  function paymentCellHtml(item) {
    const currency = currencySymbol(item.currency);
    if (item.collectionStatus === "cash" || item.collectionStatus === "instapay" || item.collectionStatus === "bank") {
      const label = item.collectionStatus === "cash" ? "Cash" : item.collectionStatus === "instapay" ? "InstaPay" : "Bank";
      return `<span class="pay-badge-paid">✓ ${label}</span>`;
    }
    if (item.collectionStatus === "partial") {
      return `<span class="pay-badge-remaining">🟡 متبقي ${Number(item.remainingAmount || 0).toFixed(2)} ${currency}</span>`;
    }
    return `<span class="pay-badge-none">—</span>`;
  }

  let showPendingOnly = false;

  const buildSalesRows = (tbody, filtered) => {
    tbody.innerHTML = "";
    let currentMonthYear = "";

    filtered.forEach((item) => {
      const itemDate = parseLocalDate(item.date);
      const monthYear = itemDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (monthYear !== currentMonthYear) {
        currentMonthYear = monthYear;
        const separatorRow = document.createElement("tr");
        separatorRow.className = "month-separator-row";
        separatorRow.innerHTML = `<td colspan="16">--- ${currentMonthYear.toUpperCase()} ---</td>`;
        tbody.appendChild(separatorRow);
      }

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.id}</td>
        <td>${item.date}</td>
        <td>${item.appNo || '-'}</td>
        <td>${item.country || '-'}</td>
        <td><strong>${item.clientName}</strong><span class="review-status-chip review-status-chip--${(item.reviewStatus || 'pending') === 'reviewed' ? 'reviewed' : 'pending'}">${(item.reviewStatus || 'pending') === 'reviewed' ? 'Reviewed' : 'Pending'}</span></td>
        <td class="num">${parseFloat(item.rate || 0).toFixed(2)}</td>
        <td class="num">${parseFloat(item.handling || 0).toFixed(2)}</td>
        <td class="num">${parseFloat(item.netRate || 0).toFixed(2)}</td>
        <td>${item.supplier || '-'}</td>
        <td class="num">${parseFloat(item.sellingRate || 0).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td class="num ${item.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${parseFloat(item.profit || 0).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td>${item.customer || '-'}</td>
        <td><span class="mono">${item.fileNumber}</span></td>
        <td>${item.note || '-'}</td>
        <td style="min-width:120px;">${paymentCellHtml(item)}</td>
        <td class="no-print-col" style="display:flex; gap:6px;">
          <button style="color:var(--gold-deep); border:none; background:none; cursor:pointer;" title="Edit" onclick="editSaleRecord('${item.id}')">✏️</button>
          <button style="color:#EF4444; border:none; background:none; cursor:pointer;" title="Delete" onclick="deleteSaleRecord('${item.id}')">🗑️</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  };

  const renderSalesTable = (filterQuery = "") => {
    const tbody = document.getElementById("sales-report-table-body");
    if (tbody) {
      let filtered = [...salesData];
      if (showPendingOnly) {
        filtered = filtered.filter(item => (item.reviewStatus || "pending") === "pending");
      }
      if (filterQuery) {
        const q = filterQuery.toLowerCase();
        filtered = filtered.filter(item =>
          item.clientName.toLowerCase().includes(q) ||
          item.fileNumber.toLowerCase().includes(q)
        );
      }

      const isDefaultLatestView = !showPendingOnly && !filterQuery;
      if (isDefaultLatestView) {
        filtered.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));
        filtered = filtered.slice(0, 10);
      }
      filtered.sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
      buildSalesRows(tbody, filtered);
    }

    const bookingTbody = document.getElementById("booking-sales-report-table-body");
    if (bookingTbody) {
      const full = [...salesData].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
      buildSalesRows(bookingTbody, full);
    }
  };

  const renderRequestsTable = () => {
    const tbody = document.getElementById("requests-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    requestsData.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.id}</td>
        <td>${item.date}</td>
        <td>${item.appNo || '-'}</td>
        <td>${item.country || '-'}</td>
        <td><strong>${item.clientName}</strong></td>
        <td class="num">${parseFloat(item.rate || 0).toFixed(2)}</td>
        <td class="num">${parseFloat(item.handling || 0).toFixed(2)}</td>
        <td class="num">${parseFloat(item.netRate || 0).toFixed(2)}</td>
        <td>${item.supplier || '-'}</td>
        <td class="num">${parseFloat(item.sellingRate || 0).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td class="num">${parseFloat(item.profit || 0).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td>${item.customer || '-'}</td>
        <td><span class="mono">${item.fileNumber}</span></td>
        <td>${item.note || '-'}</td>
        <td>
          <button class="btn btn--ghost" style="padding:3px 8px; font-size:11px;" onclick="confirmRequestToSale('${item.id}')">
            ✅ Confirm
          </button>
        </td>
        <td style="display:flex; gap:6px;">
          <button style="color:var(--gold-deep); border:none; background:none; cursor:pointer;" title="Edit" onclick="editRequestRecord('${item.id}')">✏️</button>
          <button style="color:#EF4444; border:none; background:none; cursor:pointer;" title="Delete" onclick="deleteRequestRecord('${item.id}')">🗑️</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  };

  document.getElementById("sales-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const isExisting = document.getElementById("toggle-existing-code").checked;
    const finalCode = isExisting
      ? document.getElementById("sales-existing-code-select").value || generateNewFamilyCode()
      : document.getElementById("sales-file-number").value;

    const sellingRateNum = Number(document.getElementById("sales-selling-rate").value) || 0;
    let collectionStatus = selectedFormPaymentStatus || null;
    let paidAmount = 0;
    let remainingAmount = 0;
    if (collectionStatus === "cash" || collectionStatus === "instapay") {
      paidAmount = sellingRateNum;
      remainingAmount = 0;
    } else if (collectionStatus === "partial") {
      paidAmount = Number(document.getElementById("sales-paid-amount").value) || 0;
      if (paidAmount <= 0) { alert("أدخل مبلغًا مدفوعًا أكبر من صفر لحالة \"دفع جزء\"."); return; }
      if (paidAmount > sellingRateNum) { alert("المبلغ المدفوع لا يمكن أن يتجاوز قيمة البيع."); return; }
      remainingAmount = Math.round((sellingRateNum - paidAmount) * 100) / 100;
    }

    const wasEditing = !!editingSaleId; // captured BEFORE editingSaleId gets reset below
    const saleId = editingSaleId || Date.now().toString().slice(-5);
    const newSale = {
      id: saleId,
      date: document.getElementById("sales-date").value,
      appNo: document.getElementById("sales-app-no").value,
      country: document.getElementById("sales-country").value,
      clientName: document.getElementById("sales-client-name").value,
      rate: document.getElementById("sales-rate").value,
      handling: document.getElementById("sales-handling").value,
      netRate: document.getElementById("sales-net-rate").value,
      supplier: document.getElementById("sales-suppliers").value,
      sellingRate: document.getElementById("sales-selling-rate").value,
      currency: document.getElementById("sales-currency").value,
      profit: document.getElementById("sales-profit").value,
      customer: document.getElementById("sales-customer").value,
      fileNumber: finalCode,
      note: document.getElementById("sales-note").value,
      collectionStatus, paidAmount, remainingAmount,
      reviewStatus: wasEditing ? (salesData.find(s => s.id == editingSaleId)?.reviewStatus || "pending") : "pending",
    };

    if (wasEditing) {
      const idx = salesData.findIndex(s => s.id == editingSaleId);
      if (idx !== -1) salesData[idx] = newSale;
      else salesData.push(newSale);
    } else {
      salesData.push(newSale);
    }
    editingSaleId = null;

    // nextCodeId only advances for a genuinely NEW client code — editing
    // re-uses the record's existing fileNumber and must never burn
    // through the sequence.
    if (!wasEditing && !isExisting) {
      nextCodeId++;
      localStorage.setItem("vv_visa_next_code_id", nextCodeId);
    }
    localStorage.setItem("vv_visa_sales_data", JSON.stringify(salesData));

    e.target.reset();
    initForms();
    resetFormPaymentSwitch();
    renderSalesTable();
  });

  document.getElementById("requests-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const reqId = editingRequestId || Date.now().toString().slice(-5);
    const newReq = {
      id: reqId,
      date: document.getElementById("req-date").value,
      appNo: document.getElementById("req-app-no").value,
      country: document.getElementById("req-country").value,
      clientName: document.getElementById("req-client-name").value,
      rate: document.getElementById("req-rate").value,
      handling: document.getElementById("req-handling").value,
      netRate: document.getElementById("req-net-rate").value,
      supplier: document.getElementById("req-suppliers").value,
      sellingRate: document.getElementById("req-selling-rate").value,
      currency: document.getElementById("req-currency").value,
      profit: document.getElementById("req-profit").value,
      customer: document.getElementById("req-customer").value,
      fileNumber: document.getElementById("req-file-number").value,
      note: document.getElementById("req-note").value
    };

    if (editingRequestId) {
      const idx = requestsData.findIndex(r => r.id == editingRequestId);
      if (idx !== -1) requestsData[idx] = newReq;
      else requestsData.push(newReq);
    } else {
      requestsData.push(newReq);
      nextCodeId++;
      localStorage.setItem("vv_visa_next_code_id", nextCodeId);
    }
    editingRequestId = null;
    localStorage.setItem("vv_visa_requests_data", JSON.stringify(requestsData));

    e.target.reset();
    initForms();
    renderRequestsTable();
  });

  // ================= EDIT RECORDS =================
  window.editSaleRecord = (id) => {
    const sale = salesData.find(s => s.id == id);
    if (!sale) return;

    document.getElementById("sales-date").value = sale.date;
    document.getElementById("sales-app-no").value = sale.appNo;
    document.getElementById("sales-country").value = sale.country;
    document.getElementById("sales-client-name").value = sale.clientName;
    document.getElementById("sales-rate").value = sale.rate;
    document.getElementById("sales-handling").value = sale.handling;
    document.getElementById("sales-net-rate").value = sale.netRate;
    document.getElementById("sales-suppliers").value = sale.supplier;
    document.getElementById("sales-selling-rate").value = sale.sellingRate;
    document.getElementById("sales-currency").value = sale.currency || "USD";
    document.getElementById("sales-profit").value = sale.profit;
    document.getElementById("sales-customer").value = sale.customer;
    document.getElementById("sales-note").value = sale.note;

    document.getElementById("toggle-existing-code").checked = false;
    document.getElementById("sales-file-number").style.display = "block";
    document.getElementById("sales-existing-code-select").style.display = "none";
    document.getElementById("sales-file-number").value = sale.fileNumber;

    resetFormPaymentSwitch();
    if (sale.collectionStatus) {
      selectFormPaymentStatus(sale.collectionStatus);
      if (sale.collectionStatus === "partial") {
        document.getElementById("sales-paid-amount").value = sale.paidAmount || 0;
        updateFormRemainingPreview();
      }
    }

    editingSaleId = id; // remembered — nothing removed from storage
    document.getElementById("dept-dashboard-view").style.display = "none";
    document.getElementById("dept-detail-view").style.display = "block";
    const formEl = document.getElementById("sales-form");
    if (formEl && typeof formEl.scrollIntoView === "function") formEl.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  window.editRequestRecord = (id) => {
    const req = requestsData.find(r => r.id == id);
    if (!req) return;

    document.getElementById("req-date").value = req.date;
    document.getElementById("req-app-no").value = req.appNo;
    document.getElementById("req-country").value = req.country;
    document.getElementById("req-client-name").value = req.clientName;
    document.getElementById("req-rate").value = req.rate;
    document.getElementById("req-handling").value = req.handling;
    document.getElementById("req-net-rate").value = req.netRate;
    document.getElementById("req-suppliers").value = req.supplier;
    document.getElementById("req-selling-rate").value = req.sellingRate;
    document.getElementById("req-currency").value = req.currency || "USD";
    document.getElementById("req-profit").value = req.profit;
    document.getElementById("req-customer").value = req.customer;
    document.getElementById("req-file-number").value = req.fileNumber;
    document.getElementById("req-note").value = req.note;

    editingRequestId = id; // remembered — nothing removed from storage
    document.getElementById("requests-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ================= PDF EXPORT =================
  // Note: this only ever exports a PDF snapshot — it never clears salesData.
  // ================= DATA EXPORT (CSV/Excel) =================
  const CSV_COLUMNS = [
    ["id", "ID"], ["date", "Date"], ["appNo", "Application No."], ["country", "Country / Visa Type"],
    ["clientName", "Client Name"], ["rate", "Rate"], ["handling", "Handling"], ["netRate", "Net Rate"],
    ["supplier", "Supplier"], ["sellingRate", "Selling Rate"], ["currency", "Currency"], ["profit", "Profit"],
    ["customer", "Customer"], ["fileNumber", "File #"], ["note", "Note"],
  ];

  const csvEscape = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const buildSalesCsv = () => {
    const rows = [...salesData].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
    const lines = [CSV_COLUMNS.map(([, label]) => csvEscape(label)).join(",")];

    let currentMonthYear = "";
    rows.forEach((item) => {
      const monthYear = item.date
        ? parseLocalDate(item.date).toLocaleString("default", { month: "long", year: "numeric" })
        : "Undated";
      if (monthYear !== currentMonthYear) {
        currentMonthYear = monthYear;
        lines.push(`--- ${currentMonthYear.toUpperCase()} ---`);
      }
      lines.push(CSV_COLUMNS.map(([key]) => csvEscape(item[key])).join(","));
    });

    return lines.join("\r\n");
  };

  const downloadTextFile = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportSalesDataToCsv = (filename) => {
    const csv = "\uFEFF" + buildSalesCsv();
    downloadTextFile(filename, csv, "text/csv;charset=utf-8;");
  };

  document.getElementById("btn-export-backup-pdf")?.addEventListener("click", () => {
    if (salesData.length === 0) {
      alert("There are no sales records to back up yet.");
      return;
    }
    exportSalesDataToCsv(`Voyvista-Visa-Sales-Backup-${getTodayISO()}.csv`);
  });

  document.getElementById("btn-close-annual-pdf")?.addEventListener("click", () => {
    if (salesData.length === 0) {
      alert("There are no sales records to export yet.");
      return;
    }
    // Per policy: export only — never clears or archives the underlying
    // data. Wiping the ledger requires separate IT Admin authorization.
    exportSalesDataToCsv(`Voyvista-Visa-Annual-Sales-Report-${getTodayISO()}.csv`);
  });

  // ================= PRIVATE DATA DRIVE LOGIC (Google-Drive-style folders) =================
  let driveItems = JSON.parse(localStorage.getItem("vv_visa_drive_items"));
  if (!driveItems) {
    const legacy = JSON.parse(localStorage.getItem("vv_visa_drive_files")) || [];
    const folderIdsByCode = {};
    driveItems = [];
    legacy.forEach(f => {
      let folderId = null;
      if (f.code && f.code !== "GENERAL") {
        if (!folderIdsByCode[f.code]) {
          folderIdsByCode[f.code] = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          driveItems.push({ id: folderIdsByCode[f.code], type: "folder", parentId: null, name: f.code, date: f.date });
        }
        folderId = folderIdsByCode[f.code];
      }
      driveItems.push({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "file", parentId: folderId, name: f.name, date: f.date,
        archived: !!f.archived, dataUrl: f.dataUrl, fileType: f.type,
      });
    });
    localStorage.setItem("vv_visa_drive_items", JSON.stringify(driveItems));
  }

  let currentFolderId = null; // null = Root

  const saveDriveItems = () => localStorage.setItem("vv_visa_drive_items", JSON.stringify(driveItems));

  const renderBreadcrumb = () => {
    const el = document.getElementById("drive-breadcrumb");
    if (!el) return;
    const path = [];
    let cursor = currentFolderId;
    while (cursor) {
      const folder = driveItems.find(i => i.id === cursor && i.type === "folder");
      if (!folder) break;
      path.unshift(folder);
      cursor = folder.parentId;
    }
    let html = `<span class="drive-crumb${currentFolderId === null ? " is-current" : ""}" data-folder-id="">Root</span>`;
    path.forEach(folder => {
      const isCurrent = folder.id === currentFolderId;
      html += `<span class="drive-crumb-sep">/</span><span class="drive-crumb${isCurrent ? " is-current" : ""}" data-folder-id="${folder.id}">${folder.name}</span>`;
    });
    el.innerHTML = html;
    el.querySelectorAll(".drive-crumb:not(.is-current)").forEach(crumb => {
      crumb.addEventListener("click", () => {
        currentFolderId = crumb.dataset.folderId || null;
        renderDriveView();
      });
    });
  };

  const renderFoldersGrid = () => {
    const grid = document.getElementById("drive-folders-grid");
    if (!grid) return;
    const folders = driveItems.filter(i => i.type === "folder" && i.parentId === currentFolderId);

    if (folders.length === 0) {
      grid.innerHTML = `<div class="drive-empty-hint">No folders here yet — click "New Folder" to create one.</div>`;
      return;
    }
    grid.innerHTML = folders.map(folder => {
      const itemCount = driveItems.filter(i => i.parentId === folder.id).length;
      return `
        <div class="drive-folder-card" data-folder-id="${folder.id}">
          <button class="folder-delete-btn" data-delete-folder="${folder.id}" title="Delete folder">✕</button>
          <div class="folder-icon">📁</div>
          <div class="folder-name">${folder.name}</div>
          <div class="folder-meta">${itemCount} item${itemCount === 1 ? "" : "s"}</div>
        </div>`;
    }).join("");

    grid.querySelectorAll(".drive-folder-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".folder-delete-btn")) return;
        currentFolderId = card.dataset.folderId;
        renderDriveView();
      });
    });
    grid.querySelectorAll("[data-delete-folder]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const folderId = btn.dataset.deleteFolder;
        if (!confirm("Delete this folder and everything inside it?")) return;
        const idsToRemove = new Set([folderId]);
        let changed = true;
        while (changed) {
          changed = false;
          driveItems.forEach(i => {
            if (i.parentId && idsToRemove.has(i.parentId) && !idsToRemove.has(i.id)) {
              idsToRemove.add(i.id);
              changed = true;
            }
          });
        }
        driveItems = driveItems.filter(i => !idsToRemove.has(i.id));
        saveDriveItems();
        renderDriveView();
      });
    });
  };

  const renderDriveFiles = () => {
    const list = document.getElementById("drive-file-list");
    if (!list) return;
    const showArchived = document.getElementById("toggle-show-archived")?.checked;
    const files = driveItems.filter(i => i.type === "file" && i.parentId === currentFolderId && !!i.archived === !!showArchived);

    if (files.length === 0) {
      list.innerHTML = `<div class="drive-empty-hint">No ${showArchived ? "archived " : ""}files in this folder yet.</div>`;
      return;
    }

    list.innerHTML = files.map(file => `
      <div class="file-item">
        <div>
          <a href="#" class="file-preview-link" data-id="${file.id}" style="font-weight:600;color:var(--text);text-decoration:underline;cursor:pointer;">📄 ${file.name}</a>
          <small style="color:var(--text-soft);">${file.archived ? " · archived" : ""}</small>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="file-archive-btn" data-id="${file.id}" style="color:var(--gold-deep); border:none; background:none; cursor:pointer;" title="${file.archived ? "Unarchive" : "Archive"}">${file.archived ? "📤" : "🗄️"}</button>
          <button class="file-delete-btn" data-id="${file.id}" style="color:#EF4444; border:none; background:none; cursor:pointer;" title="Delete">🗑️</button>
        </div>
      </div>`).join("");

    list.querySelectorAll(".file-preview-link").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const file = driveItems.find(i => i.id === link.dataset.id);
        if (file && file.dataUrl) {
          window.open(file.dataUrl, "_blank");
        } else {
          alert("No preview available for this file.");
        }
      });
    });
    list.querySelectorAll(".file-archive-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const file = driveItems.find(i => i.id === btn.dataset.id);
        if (file) { file.archived = !file.archived; saveDriveItems(); renderDriveFiles(); }
      });
    });
    list.querySelectorAll(".file-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!confirm("Delete this file?")) return;
        driveItems = driveItems.filter(i => i.id !== btn.dataset.id);
        saveDriveItems();
        renderDriveFiles();
        renderFoldersGrid();
      });
    });
  };

  const renderDriveView = () => {
    renderBreadcrumb();
    renderFoldersGrid();
    renderDriveFiles();
  };

  document.getElementById("toggle-show-archived")?.addEventListener("change", renderDriveFiles);

  document.getElementById("btn-new-folder")?.addEventListener("click", () => {
    const name = prompt("Folder name (e.g. Khalil Family, FAM-V1024):");
    if (!name || !name.trim()) return;
    driveItems.push({ id: `folder_${Date.now()}`, type: "folder", parentId: currentFolderId, name: name.trim(), date: getTodayISO() });
    saveDriveItems();
    renderDriveView();
  });

  const wireDropZone = (zoneEl, inputEl, onFiles) => {
    if (!zoneEl || !inputEl) return;
    zoneEl.addEventListener("click", () => inputEl.click());
    ["dragover", "dragleave", "drop"].forEach(evt => zoneEl.addEventListener(evt, (e) => e.preventDefault()));
    zoneEl.addEventListener("dragover", () => zoneEl.style.borderColor = "var(--gold)");
    zoneEl.addEventListener("dragleave", () => zoneEl.style.borderColor = "");
    zoneEl.addEventListener("drop", (e) => {
      zoneEl.style.borderColor = "";
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
    inputEl.addEventListener("change", (e) => onFiles(e.target.files));
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const driveDropZone = document.getElementById("drive-drop-zone");
  const driveFileInput = document.getElementById("drive-file-input");
  document.getElementById("btn-drive-upload")?.addEventListener("click", () => driveFileInput.click());

  wireDropZone(driveDropZone, driveFileInput, async (files) => {
    for (const file of Array.from(files)) {
      let dataUrl = null;
      try { dataUrl = await readFileAsDataUrl(file); } catch (e) { console.error(e); }
      driveItems.push({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "file", parentId: currentFolderId, name: file.name, date: getTodayISO(),
        archived: false, dataUrl, fileType: file.type,
      });
    }
    saveDriveItems();
    renderDriveView();
  });

  window.confirmRequestToSale = (reqId) => {
    const idx = requestsData.findIndex(r => r.id == reqId);
    if (idx !== -1) {
      salesData.push(requestsData[idx]);
      requestsData.splice(idx, 1);
      localStorage.setItem("vv_visa_sales_data", JSON.stringify(salesData));
      localStorage.setItem("vv_visa_requests_data", JSON.stringify(requestsData));
      renderSalesTable();
      renderRequestsTable();
    }
  };

  window.deleteSaleRecord = (id) => {
    salesData = salesData.filter(s => s.id != id);
    localStorage.setItem("vv_visa_sales_data", JSON.stringify(salesData));
    renderSalesTable();
  };

  window.deleteRequestRecord = (id) => {
    requestsData = requestsData.filter(r => r.id != id);
    localStorage.setItem("vv_visa_requests_data", JSON.stringify(requestsData));
    renderRequestsTable();
  };

  document.getElementById("sales-report-search")?.addEventListener("input", (e) => {
    renderSalesTable(e.target.value);
  });

  document.getElementById("btn-view-all-sales")?.addEventListener("click", () => {
    showPendingOnly = false;
    document.getElementById("btn-view-all-sales").classList.add("is-active");
    document.getElementById("btn-view-pending-sales").classList.remove("is-active");
    renderSalesTable(document.getElementById("sales-report-search").value);
  });
  document.getElementById("btn-view-pending-sales")?.addEventListener("click", () => {
    showPendingOnly = true;
    document.getElementById("btn-view-pending-sales").classList.add("is-active");
    document.getElementById("btn-view-all-sales").classList.remove("is-active");
    renderSalesTable(document.getElementById("sales-report-search").value);
  });

  function openClientDataPicker() {
    if (!window.ClientDataPicker) {
      console.error("ClientDataPicker not loaded — check that client_data_picker.js is present at /client/modules/master_data/client_data_picker.js and loaded before visas.js.");
      alert("تعذّر تحميل قسم بيانات العملاء — تأكد إن ملف client_data_picker.js موجود في مكانه الصح.");
      return;
    }
    window.ClientDataPicker.open((selectedName) => {
      const field = document.getElementById("sales-client-name");
      if (field) field.value = selectedName;
    });
  }
  document.getElementById("btn-open-client-data")?.addEventListener("click", openClientDataPicker);
  document.getElementById("hub-open-client-data")?.addEventListener("click", openClientDataPicker);

  document.getElementById("hub-open-bookings")?.addEventListener("click", () => {
    document.getElementById("dept-dashboard-view").style.display = "none";
    document.getElementById("dept-detail-view").style.display = "block";
    renderSalesTable(document.getElementById("sales-report-search").value);
  });
  document.getElementById("btn-back-dept-dashboard")?.addEventListener("click", () => {
    document.getElementById("dept-detail-view").style.display = "none";
    document.getElementById("dept-dashboard-view").style.display = "block";
  });

  // Init Execution
  setupModalHandlers();
  setupInvoiceLogic();
  initForms();
  renderSalesTable();
  renderRequestsTable();
  renderDriveView();
});