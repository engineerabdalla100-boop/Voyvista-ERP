document.addEventListener("DOMContentLoaded", () => {
  // State Storage
  let salesData = JSON.parse(localStorage.getItem("vv_sales_data")) || [];
  let requestsData = JSON.parse(localStorage.getItem("vv_requests_data")) || [];
  // Track which record (if any) is currently loaded into the form for
  // editing — null means "adding a new record". Crucially, the record
  // itself is NEVER removed from storage while this is set; it stays
  // exactly where it was until Save actually updates it in place. If the
  // employee navigates away or reloads without saving, nothing is lost —
  // the original record is still sitting in vv_sales_data untouched.
  let editingSaleId = null;
  let editingRequestId = null;
  let nextCodeId = parseInt(localStorage.getItem("vv_next_code_id")) || 1001;

  // Setup Modals and Nav
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

  const generateNewFamilyCode = () => `FAM-${nextCodeId}`;

  // The "Customer / Pay" field is free text today (people type "CASH", a
  // company name, etc.) — there's no dedicated Payment Method control to
  // add without touching the UI, so this makes a best-effort guess from
  // what's already typed there. See the chat reply for why this is a
  // stop-gap rather than a real fix.
  function inferPaymentMethod(customerPayText) {
    const t = String(customerPayText || "").trim().toUpperCase();
    if (t.includes("CASH")) return "Cash";
    if (t.includes("BANK") || t.includes("TRANSFER")) return "Bank Transfer";
    if (t.includes("CREDIT CARD") || t.includes("VISA") || t.includes("MASTERCARD")) return "Credit Card";
    if (t.includes("CREDIT") || t.includes("ARROW") || t.includes("HETRO") || t.includes("VIP")) return "Company Credit";
    return "Cash";
  }

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

    // Collects the current invoice form into a plain object (shared by both actions below)
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

    // Internal Invoice / Voucher — prints or downloads a PDF immediately,
    // completely independent from the accounting tree (nothing is saved).
    //
    // ROOT-CAUSE FIX: the old version filled a hidden DOM template then
    // asked html2canvas to screenshot it — the total/items were sometimes
    // missing because that screenshot could fire before the browser had
    // actually finished painting the just-injected rows (a timing race no
    // fixed delay can 100% guarantee). This version draws the PDF directly
    // from `data` with jsPDF's own text/line API — no DOM, no screenshot,
    // no paint to wait for, so the total physically cannot be "not there
    // yet": it's written to the page in the same synchronous call that
    // builds everything else.
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

      // ---- Header ----
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text("Voyvista — Flights", marginX, y);

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

      // ---- Client / Date ----
      y += 8;
      doc.setFontSize(10.5);
      doc.setFont("helvetica", "normal");
      doc.text(`Client: ${data.client}`, marginX, y);
      doc.text(`Date: ${data.date}`, pageWidth - marginX, y, { align: "right" });

      // ---- Items table header ----
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

      // ---- Items rows ----
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      data.items.forEach((it) => {
        y += 7;
        // start a fresh page if we're about to run off the bottom
        if (y > 275) {
          doc.addPage();
          y = 20;
        }
        doc.text(String(it.desc), colDesc, y);
        doc.text(String(it.qty), colQty, y, { align: "right" });
        doc.text(it.price.toFixed(2), colPrice, y, { align: "right" });
        doc.text(it.total.toFixed(2), colTotal, y, { align: "right" });
        doc.setDrawColor(230);
        doc.setLineWidth(0.2);
        doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
      });

      // ---- Total (always drawn — it's the same call stack as everything above) ----
      y += 12;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(20);
      doc.text(`${data.total.toFixed(2)} ${data.currency}`, pageWidth - marginX, y, { align: "right" });

      // ---- Footer ----
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(150);
      doc.text(
        "Voyvista ERP — Internal Voucher / Invoice — Tourism & Travel Management System",
        pageWidth / 2, 285, { align: "center" }
      );

      doc.save(`Voyvista-Invoice-${data.ref || data.date}.pdf`);
    });

    // Submit to Accounting — this is the only action that actually files the
    // invoice for the accountant to see, with a clear pending status.
    document.getElementById("btn-submit-invoice")?.addEventListener("click", () => {
      const data = collectInvoiceData();
      if (!data.client || data.items.length === 0) {
        alert("Enter a client name and at least one item first.");
        return;
      }

      const accountingInvoices = JSON.parse(localStorage.getItem("vv_accounting_invoices")) || [];
      accountingInvoices.push({
        id: Date.now().toString().slice(-6),
        department: "flights",
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
  const calculateFinancials = (rateId, handlingId, sellingId, netId, profitId) => {
    const rate = parseFloat(document.getElementById(rateId).value) || 0;
    const handling = parseFloat(document.getElementById(handlingId).value) || 0;
    const selling = parseFloat(document.getElementById(sellingId).value) || 0;

    const net = rate + handling;
    const profit = selling - net;

    document.getElementById(netId).value = net.toFixed(2);
    document.getElementById(profitId).value = profit.toFixed(2);
  };

  const initForms = () => {
    document.getElementById("sales-date").value = getTodayISO();
    document.getElementById("req-date").value = getTodayISO();

    document.getElementById("sales-file-number").value = generateNewFamilyCode();
    document.getElementById("req-file-number").value = generateNewFamilyCode();

    ["sales-rate", "sales-handling", "sales-selling-rate"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", () => {
        calculateFinancials("sales-rate", "sales-handling", "sales-selling-rate", "sales-net-rate", "sales-profit");
      });
    });

    ["req-rate", "req-handling", "req-selling-rate"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", () => {
        calculateFinancials("req-rate", "req-handling", "req-selling-rate", "req-net-rate", "req-profit");
      });
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
      const nameField = document.getElementById("sales-passenger-name");
      if (nameField && !nameField.value.trim() && names.length === 1) {
        nameField.value = names[0];
      }
    });
  };

  const CURRENCY_SYMBOLS = { EGP: "E£", USD: "$", EUR: "€", SAR: "ر.س", KWD: "د.ك", GBP: "£", JPY: "¥", CNY: "¥", CAD: "$" };
  const currencySymbol = (code) => CURRENCY_SYMBOLS[code] || "$";

  // =========================================================================
  // Payment switch — lives in the registration form itself (Cash /
  // InstaPay / Partial), as basic registration data alongside everything
  // else about the sale. The Sales Report table below only ever shows a
  // simple read-only status badge — it's a summary of what was chosen at
  // registration (or last edit), never a place to click and change it.
  // Writes to collectionStatus/paidAmount/remainingAmount — the EXACT
  // SAME fields Data's Accounting/Arrears sections already read from
  // vv_sales_data, so nothing here ever needs a separate sync step.
  // HONEST LIMITATION (kept deliberately, exactly as instructed): this
  // is a documentation field on the sale record only — it never reads
  // from or writes to VVTreasury/vv_treasury_cash/vv_treasury_banks. The
  // real Treasury balance is completely untouched by anything here.
  // =========================================================================

  let selectedFormPaymentStatus = null; // null = not chosen yet (a fresh sale can be added without a payment decision)

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

  // Builds rows (with month separators) into whichever tbody is passed in —
  // shared by both the outer "Latest" table and the full, uncapped Sales
  // Report sheet that now lives inside the dedicated Bookings page.
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
        <td>${item.tktNo || '-'}</td>
        <td>${item.route || '-'}</td>
        <td><strong>${item.passengerName}</strong><span class="review-status-chip review-status-chip--${(item.reviewStatus || 'pending') === 'reviewed' ? 'reviewed' : 'pending'}">${(item.reviewStatus || 'pending') === 'reviewed' ? 'Reviewed' : 'Pending'}</span></td>
        <td class="num">${parseFloat(item.rate).toFixed(2)}</td>
        <td class="num">${parseFloat(item.handling).toFixed(2)}</td>
        <td class="num">${parseFloat(item.netRate).toFixed(2)}</td>
        <td>${item.supplier || '-'}</td>
        <td class="num">${parseFloat(item.sellingRate).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td class="num ${item.profit >= 0 ? 'profit-pos' : 'profit-neg'}">${parseFloat(item.profit).toFixed(2)} ${currencySymbol(item.currency)}</td>
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
    // Outer "Latest" table (dashboard) — capped to 10 in its default view,
    // exactly as before.
    const tbody = document.getElementById("sales-report-table-body");
    if (tbody) {
      let filtered = [...salesData];
      if (showPendingOnly) {
        filtered = filtered.filter(item => (item.reviewStatus || "pending") === "pending");
      }
      if (filterQuery) {
        const q = filterQuery.toLowerCase();
        filtered = filtered.filter(item =>
          item.passengerName.toLowerCase().includes(q) ||
          item.fileNumber.toLowerCase().includes(q)
        );
      }

      // "Latest" — the default Sales Report view (no active search, no
      // Pending filter) only ever shows the 10 most recent sales, newest
      // first. Searching or switching to Pending Report both intentionally
      // show every matching row instead — hiding results while someone is
      // actively looking for something, or reviewing a real work queue,
      // would be the wrong call.
      const isDefaultLatestView = !showPendingOnly && !filterQuery;
      if (isDefaultLatestView) {
        filtered.sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));
        filtered = filtered.slice(0, 10);
      }
      filtered.sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
      buildSalesRows(tbody, filtered);
    }

    // Full Sales Report sheet inside the dedicated Bookings page — every
    // record, always, right below the Add Sale form, so adding or editing
    // a sale and seeing the complete ledger happen in the same place.
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
        <td>${item.tktNo || '-'}</td>
        <td>${item.route || '-'}</td>
        <td><strong>${item.passengerName}</strong></td>
        <td class="num">${parseFloat(item.rate).toFixed(2)}</td>
        <td class="num">${parseFloat(item.handling).toFixed(2)}</td>
        <td class="num">${parseFloat(item.netRate).toFixed(2)}</td>
        <td>${item.supplier || '-'}</td>
        <td class="num">${parseFloat(item.sellingRate).toFixed(2)} ${currencySymbol(item.currency)}</td>
        <td class="num">${parseFloat(item.profit).toFixed(2)} ${currencySymbol(item.currency)}</td>
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

    // Payment status validation — only matters if "Partial" was chosen;
    // Cash/InstaPay/not-chosen-yet all need nothing further here.
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
      tktNo: document.getElementById("sales-tkt-no").value,
      route: document.getElementById("sales-route").value,
      passengerName: document.getElementById("sales-passenger-name").value,
      rate: document.getElementById("sales-rate").value,
      handling: document.getElementById("sales-handling").value,
      netRate: document.getElementById("sales-net-rate").value,
      supplier: document.getElementById("sales-suppliers").value,
      sellingRate: document.getElementById("sales-selling-rate").value,
      currency: document.getElementById("sales-currency").value,
      customer: document.getElementById("sales-customer").value,
      profit: document.getElementById("sales-profit").value,
      fileNumber: finalCode,
      note: document.getElementById("sales-note").value,
      // Payment status — basic registration data, set right here at
      // entry (or updated on edit). Documentation only: never reads from
      // or writes to VVTreasury/vv_treasury_cash/vv_treasury_banks. The
      // real Treasury stays completely untouched by this.
      collectionStatus, paidAmount, remainingAmount,
      // Editing an existing record keeps its original reviewStatus (an
      // accountant may have already reviewed it — correcting a typo
      // shouldn't silently un-review it). Only a brand-new record starts
      // "pending".
      reviewStatus: wasEditing ? (salesData.find(s => s.id == editingSaleId)?.reviewStatus || "pending") : "pending",
    };

    if (wasEditing) {
      // Update the existing record IN PLACE — same id, same position.
      // Never delete-then-recreate: that would silently break any other
      // data (accounting entries, references) tied to the original id.
      const idx = salesData.findIndex(s => s.id == editingSaleId);
      if (idx !== -1) salesData[idx] = newSale;
      else salesData.push(newSale); // record vanished elsewhere in the meantime — save it as a fresh entry rather than losing the edit
    } else {
      salesData.push(newSale);
    }
    editingSaleId = null;

    // nextCodeId only ever advances for a genuinely NEW client code — an
    // edit re-uses whatever fileNumber the record already had (the field
    // is pre-filled with it in editSaleRecord above), so editing must
    // never burn through the sequence.
    if (!wasEditing && !isExisting) {
      nextCodeId++;
      localStorage.setItem("vv_next_code_id", nextCodeId);
    }
    localStorage.setItem("vv_sales_data", JSON.stringify(salesData));

    // Accounting integration — creates the transaction + updates ledgers/
    // cash/bank automatically. Doesn't touch salesData/the table at all;
    // if it's not loaded (e.g. this page open standalone) the sale still
    // saves normally above, this is purely additive.
    if (window.VVAccounting) {
      window.VVAccounting.recordSale({
        department: "Flights",
        sourceRecordId: newSale.id,
        date: newSale.date,
        reference: newSale.tktNo || newSale.fileNumber,
        customer: newSale.passengerName,
        supplier: newSale.supplier,
        sellingRate: newSale.sellingRate,
        netRate: newSale.netRate,
        handling: newSale.handling,
        currency: newSale.currency,
        exchangeRate: 1, // TODO: wire a real rate once the Currency field's exchange rate is captured
        paymentMethod: inferPaymentMethod(newSale.customer),
      });
    }

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
      tktNo: document.getElementById("req-tkt-no").value,
      route: document.getElementById("req-route").value,
      passengerName: document.getElementById("req-passenger-name").value,
      rate: document.getElementById("req-rate").value,
      handling: document.getElementById("req-handling").value,
      netRate: document.getElementById("req-net-rate").value,
      supplier: document.getElementById("req-suppliers").value,
      sellingRate: document.getElementById("req-selling-rate").value,
      currency: document.getElementById("req-currency").value,
      customer: document.getElementById("req-customer").value,
      profit: document.getElementById("req-profit").value,
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
      localStorage.setItem("vv_next_code_id", nextCodeId);
    }
    editingRequestId = null;
    localStorage.setItem("vv_requests_data", JSON.stringify(requestsData));

    e.target.reset();
    initForms();
    renderRequestsTable();
  });

  // ================= EDIT RECORDS (fixed) =================
  // Loads a saved record back into its form for correction. CRITICAL:
  // the record stays in storage exactly as it is — only editingSaleId
  // remembers which one is being edited. If the employee navigates away
  // or reloads before hitting Save, the original record is still sitting
  // safely in vv_sales_data, completely untouched. Save (below) updates
  // it in place using this same id — it never creates a second record
  // with a new id for what should be the same booking.
  window.editSaleRecord = (id) => {
    const sale = salesData.find(s => s.id == id);
    if (!sale) return;

    document.getElementById("sales-date").value = sale.date;
    document.getElementById("sales-tkt-no").value = sale.tktNo;
    document.getElementById("sales-route").value = sale.route;
    document.getElementById("sales-passenger-name").value = sale.passengerName;
    document.getElementById("sales-rate").value = sale.rate;
    document.getElementById("sales-handling").value = sale.handling;
    document.getElementById("sales-net-rate").value = sale.netRate;
    document.getElementById("sales-suppliers").value = sale.supplier;
    document.getElementById("sales-selling-rate").value = sale.sellingRate;
    document.getElementById("sales-currency").value = sale.currency || "USD";
    document.getElementById("sales-customer").value = sale.customer;
    document.getElementById("sales-profit").value = sale.profit;
    document.getElementById("sales-note").value = sale.note;

    // Restore whatever payment status was already chosen (or none, for
    // an older record created before this existed) — editing shows the
    // current state exactly, never silently resets it.
    resetFormPaymentSwitch();
    if (sale.collectionStatus) {
      selectFormPaymentStatus(sale.collectionStatus);
      if (sale.collectionStatus === "partial") {
        document.getElementById("sales-paid-amount").value = sale.paidAmount || 0;
        updateFormRemainingPreview();
      }
    }

    // Make sure the file code shows in the plain input (not the "existing code" dropdown)
    document.getElementById("toggle-existing-code").checked = false;
    document.getElementById("sales-file-number").style.display = "block";
    document.getElementById("sales-existing-code-select").style.display = "none";
    document.getElementById("sales-file-number").value = sale.fileNumber;

    editingSaleId = id; // remembered — nothing removed from storage

    // The Add Sale form now lives on its own dedicated "Bookings" page, not
    // on this dashboard — without this, the record above gets pulled out
    // and pre-filled into a form the user can't see or reach, and it looks
    // exactly like the record was just deleted. Take them there for real.
    document.getElementById("dept-dashboard-view").style.display = "none";
    document.getElementById("dept-detail-view").style.display = "block";
    const formEl = document.getElementById("sales-form");
    if (formEl && typeof formEl.scrollIntoView === "function") formEl.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  window.editRequestRecord = (id) => {
    const req = requestsData.find(r => r.id == id);
    if (!req) return;

    document.getElementById("req-date").value = req.date;
    document.getElementById("req-tkt-no").value = req.tktNo;
    document.getElementById("req-route").value = req.route;
    document.getElementById("req-passenger-name").value = req.passengerName;
    document.getElementById("req-rate").value = req.rate;
    document.getElementById("req-handling").value = req.handling;
    document.getElementById("req-net-rate").value = req.netRate;
    document.getElementById("req-suppliers").value = req.supplier;
    document.getElementById("req-selling-rate").value = req.sellingRate;
    document.getElementById("req-currency").value = req.currency || "USD";
    document.getElementById("req-customer").value = req.customer;
    document.getElementById("req-profit").value = req.profit;
    document.getElementById("req-file-number").value = req.fileNumber;
    document.getElementById("req-note").value = req.note;

    editingRequestId = id; // remembered — nothing removed from storage

    document.getElementById("requests-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ================= DATA EXPORT (CSV/Excel) — rewritten =================
  // The old export captured a *screenshot* of the on-screen table via
  // html2canvas, which is exactly why large record counts got cut off or
  // garbled: it depended on the DOM/canvas render, not the underlying data.
  // This version builds the file directly from the full `salesData` array
  // in memory — every record, no pagination, no page-size limit, no DOM
  // involved at all. Opens cleanly in Excel/Sheets since it's plain CSV.
  //
  // NOTE ON THE BACKEND: today everything lives in localStorage (no live
  // API yet), so this is a full, honest client-side export of everything
  // this browser has. Once the real Django endpoint exists (e.g.
  // `GET /api/flights/sales-report/export/` streaming all rows straight
  // from the DB), swap the body of `exportSalesDataToCsv` for a fetch to
  // that endpoint and keep triggering the download the same way — the
  // button wiring below doesn't need to change.
  const CSV_COLUMNS = [
    ["id", "ID"], ["date", "Date"], ["tktNo", "Ticket No."], ["route", "Route"],
    ["passengerName", "Passenger"], ["rate", "Rate"], ["handling", "Handling"],
    ["netRate", "Net Rate"], ["supplier", "Supplier"], ["sellingRate", "Selling Rate"],
    ["currency", "Currency"], ["profit", "Profit"], ["customer", "Customer"], ["fileNumber", "File #"], ["note", "Note"],
  ];

  const csvEscape = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const buildSalesCsv = () => {
    // Sort by date, ascending — same chronological order as the on-screen ledger
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
    // Prepend a BOM so Excel opens UTF-8 (Arabic names, £/€ symbols, etc.) correctly
    const csv = "\uFEFF" + buildSalesCsv();
    downloadTextFile(filename, csv, "text/csv;charset=utf-8;");
  };

  document.getElementById("btn-export-backup-pdf")?.addEventListener("click", () => {
    if (salesData.length === 0) {
      alert("There are no sales records to back up yet.");
      return;
    }
    exportSalesDataToCsv(`Voyvista-Sales-Backup-${getTodayISO()}.csv`);
  });

  document.getElementById("btn-close-annual-pdf")?.addEventListener("click", () => {
    if (salesData.length === 0) {
      alert("There are no sales records to export yet.");
      return;
    }
    // Data-protection policy: this button ONLY exports the full ledger. It
    // must never clear or archive the underlying data itself — wiping the
    // current ledger requires separate IT Admin authorization.
    exportSalesDataToCsv(`Voyvista-Annual-Sales-Report-${getTodayISO()}.csv`);
  });

  // ================= PRIVATE DATA DRIVE LOGIC (Google-Drive-style folders) =================
  // Migrates the old flat file list (with a "code" tag) into the new
  // folder-based model the first time this runs, so nobody loses files
  // from before this change.
  let driveItems = JSON.parse(localStorage.getItem("vv_drive_items"));
  if (!driveItems) {
    const legacy = JSON.parse(localStorage.getItem("vv_drive_files")) || [];
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
    localStorage.setItem("vv_drive_items", JSON.stringify(driveItems));
  }

  let currentFolderId = null; // null = Root

  const saveDriveItems = () => localStorage.setItem("vv_drive_items", JSON.stringify(driveItems));

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
        // also remove anything nested inside (one level, but safe if ever nested deeper)
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
    const name = prompt("Folder name (e.g. Khalil Family, FAM-1024):");
    if (!name || !name.trim()) return;
    driveItems.push({ id: `folder_${Date.now()}`, type: "folder", parentId: currentFolderId, name: name.trim(), date: getTodayISO() });
    saveDriveItems();
    renderDriveView();
  });

  // Generic click-to-browse + drag-and-drop wiring, reused by every drop zone on the page
  const wireDropZone = (zoneEl, inputEl, onFiles) => {
    if (!zoneEl || !inputEl) return;
    zoneEl.addEventListener("click", () => inputEl.click());
    ["dragover", "dragleave", "drop"].forEach(evt => {
      zoneEl.addEventListener(evt, (e) => e.preventDefault());
    });
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

  // ================= SMART SCAN & OCR (added) =================
  let clientsData = JSON.parse(localStorage.getItem("vv_clients_data")) || [];
  let pendingScanFile = null;

  const scanDropZone = document.getElementById("scan-drop-zone");
  const scanFileInput = document.getElementById("scan-file-input");
  wireDropZone(scanDropZone, scanFileInput, (files) => {
    if (files[0]) {
      pendingScanFile = files[0];
      document.getElementById("scan-status-text").textContent = `Ready to scan: ${files[0].name}`;
    }
  });

  /**
   * Looks for a passport MRZ (Machine Readable Zone) in the OCR text — two
   * adjacent 44-character lines made of A-Z/0-9/< — since that's a far more
   * reliable source of structured data than parsing free-form printed text.
   * Falls back to a best-effort date/name guess when no MRZ is found (e.g.
   * for national ID cards without one).
   */
  const parseScannedText = (text) => {
    const lines = text.split("\n").map(l => l.replace(/\s/g, "").toUpperCase()).filter(Boolean);
    const mrzLines = lines.filter(l => /^[A-Z0-9<]{28,44}$/.test(l) && l.includes("<"));

    const parseYYMMDD = (s, isExpiry) => {
      if (!/^\d{6}$/.test(s)) return "";
      const yy = parseInt(s.slice(0, 2), 10);
      const mm = s.slice(2, 4), dd = s.slice(4, 6);
      const century = isExpiry ? 2000 : (yy > (new Date().getFullYear() % 100) + 5 ? 1900 : 2000);
      return `${century + yy}-${mm}-${dd}`;
    };

    if (mrzLines.length >= 2) {
      const l1 = mrzLines[0], l2 = mrzLines[1];
      const rawName = l1.slice(5);
      const [surnamePart, givenPart] = rawName.split("<<");
      const surname = (surnamePart || "").replace(/</g, " ").trim();
      const given = (givenPart || "").replace(/</g, " ").trim();
      return {
        name: [given, surname].filter(Boolean).join(" ").trim(),
        idNumber: l2.slice(0, 9).replace(/</g, "").trim(),
        dob: parseYYMMDD(l2.slice(13, 19), false),
        expiry: parseYYMMDD(l2.slice(21, 27), true),
      };
    }

    // Fallback heuristic for documents without an MRZ
    const rawLines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const dateMatches = [...text.matchAll(/(\d{2,4})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/g)].map(m => m[0]);
    const nameCandidate = rawLines
      .filter(l => /^[A-Z\s]{4,40}$/.test(l.toUpperCase()) && l.replace(/\s/g, "").length >= 4)
      .sort((a, b) => b.length - a.length)[0] || "";

    return {
      name: nameCandidate.toUpperCase(),
      idNumber: "",
      dob: dateMatches[0] || "",
      expiry: dateMatches[dateMatches.length - 1] || "",
    };
  };

  document.getElementById("btn-run-smart-scan")?.addEventListener("click", () => {
    if (!pendingScanFile) {
      alert("Choose or drop a passport/ID photo first.");
      return;
    }
    if (typeof Tesseract === "undefined") {
      alert("The OCR engine didn't load (no internet connection to the CDN?). Try again once you're online.");
      return;
    }

    const statusEl = document.getElementById("scan-status-text");
    statusEl.textContent = "Scanning... this can take a few seconds";

    Tesseract.recognize(pendingScanFile, "eng")
      .then(({ data: { text } }) => {
        const extracted = parseScannedText(text);
        document.getElementById("scan-out-name").value = extracted.name;
        document.getElementById("scan-out-id").value = extracted.idNumber;
        document.getElementById("scan-out-dob").value = extracted.dob;
        document.getElementById("scan-out-expiry").value = extracted.expiry;
        document.getElementById("scan-result-form").style.display = "block";
        statusEl.textContent = "Done — review the fields below before saving.";
      })
      .catch(err => {
        console.error(err);
        statusEl.textContent = "Scan failed — see console for details.";
      });
  });

  document.getElementById("btn-save-client")?.addEventListener("click", () => {
    const name = document.getElementById("scan-out-name").value.trim();
    if (!name) {
      alert("At least a name is required to save this client.");
      return;
    }
    // Per spec: only the extracted fields are kept — the scanned image itself
    // is never persisted, to save storage space.
    clientsData.push({
      id: Date.now().toString().slice(-6),
      name,
      idNumber: document.getElementById("scan-out-id").value.trim(),
      dob: document.getElementById("scan-out-dob").value,
      expiry: document.getElementById("scan-out-expiry").value,
    });
    localStorage.setItem("vv_clients_data", JSON.stringify(clientsData));

    pendingScanFile = null;
    document.getElementById("scan-result-form").style.display = "none";
    document.getElementById("scan-status-text").textContent = "";
    scanFileInput.value = "";
    renderClientsTable();
  });

  const renderClientsTable = () => {
    const tbody = document.getElementById("clients-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const todayMs = parseLocalDate(getTodayISO()).getTime();
    const DAY_MS = 1000 * 60 * 60 * 24;

    clientsData.forEach((client, index) => {
      let bg = "";
      if (client.expiry) {
        const daysLeft = (parseLocalDate(client.expiry).getTime() - todayMs) / DAY_MS;
        bg = daysLeft < 90 ? "#FEF9C3" : "#DCFCE7"; // 🟡 <3 months · 🟢 otherwise
      }
      const row = document.createElement("tr");
      row.style.background = bg;
      row.innerHTML = `
        <td><strong>${client.name}</strong></td>
        <td class="mono">${client.idNumber || "-"}</td>
        <td>${client.dob || "-"}</td>
        <td>${client.expiry || "-"}</td>
        <td><button style="color:#EF4444; border:none; background:none; cursor:pointer;" onclick="deleteClientRecord(${index})">🗑️</button></td>
      `;
      tbody.appendChild(row);
    });
  };

  window.deleteClientRecord = (idx) => {
    clientsData.splice(idx, 1);
    localStorage.setItem("vv_clients_data", JSON.stringify(clientsData));
    renderClientsTable();
  };

  window.confirmRequestToSale = (reqId) => {
    const idx = requestsData.findIndex(r => r.id == reqId);
    if (idx !== -1) {
      salesData.push(requestsData[idx]);
      requestsData.splice(idx, 1);
      localStorage.setItem("vv_sales_data", JSON.stringify(salesData));
      localStorage.setItem("vv_requests_data", JSON.stringify(requestsData));
      renderSalesTable();
      renderRequestsTable();
    }
  };

  window.deleteSaleRecord = (id) => {
    salesData = salesData.filter(s => s.id != id);
    localStorage.setItem("vv_sales_data", JSON.stringify(salesData));
    renderSalesTable();
  };

  window.deleteRequestRecord = (id) => {
    requestsData = requestsData.filter(r => r.id != id);
    localStorage.setItem("vv_requests_data", JSON.stringify(requestsData));
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

  // Client Data — B2B/B2C picker only (never touches accounting/balance
  // data). Selecting or creating a traveler fills the passenger name
  // field directly; it does not submit the sale itself. Both the top
  // hub card and the toolbar button call this exact same function
  // directly — no indirection, so there's only one place this can break.
  function openClientDataPicker() {
    if (!window.ClientDataPicker) {
      console.error("ClientDataPicker not loaded — check that client_data_picker.js is present at /client/modules/master_data/client_data_picker.js and loaded before flights.js.");
      alert("تعذّر تحميل قسم بيانات العملاء — تأكد إن ملف client_data_picker.js موجود في مكانه الصح.");
      return;
    }
    window.ClientDataPicker.open((selectedName) => {
      const field = document.getElementById("sales-passenger-name");
      if (field) field.value = selectedName;
    });
  }
  document.getElementById("btn-open-client-data")?.addEventListener("click", openClientDataPicker);
  document.getElementById("hub-open-client-data")?.addEventListener("click", openClientDataPicker);

  // "Bookings" now opens as its own dedicated full-page view instead of a
  // modal — the hub-grid + Latest table hide, the Add Sale form + export
  // buttons show, and Back reverses it. Nothing about Add Sale's own
  // logic changed; only where its HTML physically lives.
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
  renderClientsTable();
});