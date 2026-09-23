/**
 * sales_sheet.js
 * -----------------------------------------------------------------------
 * قسم المبيعات — Central Sales Ledger + Booking Wizard.
 *
 * لسه مفيش Backend حقيقي لقسم المبيعات (VV_CONFIG.ENDPOINTS.SALES بيغطي
 * بس الـ 3 Action Hubs القياسية: invoices / bookings / drive)، فبنفس نمط
 * employees.js بنخزن الـ Central Sales Ledger محلياً في localStorage تحت
 * مفتاح "vv_sales_ledger"، وده هيبقى أسهل حاجة تتربط بـ API حقيقي بعدين:
 * كل الدوال اللي بتقرأ/تكتب في الـ ledger معزولة في القسم الأول بس.
 *
 * يعتمد على: config.js / auth.js / components.js (لازم تتحمل قبله)
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const LEDGER_KEY = "vv_sales_ledger";
  const QUOTES_KEY = "vv_sales_quotes";
  const NOTES_KEY = "vv_sales_customer_notes";
  const COMM_KEY = "vv_sales_communication_log";
  const SETTINGS_KEY = "vv_sales_settings";

  const DEPARTMENT_LABELS = {
    flights: "طيران", hotels: "فنادق", packages: "برامج سياحية",
    visas: "تأشيرات", transfers: "نقل", insurance: "تأمين سفر",
  };
  const PAYMENT_STATUS_LABELS = {
    paid_full: "مدفوع بالكامل", deposit: "دفعة مقدمة", unpaid: "غير مدفوع",
  };

  // -----------------------------------------------------------------------
  // العملات المدعومة — كل عملية بيع بتتسجل بعملتها الأصلية (مفيدة لشركة
  // سياحة بتتعامل مع عملاء وموردين بعملات مختلفة). مجاميع الـ KPIs/التقارير
  // بتجمع الأرقام الخام كما هي بدون تحويل سعر صرف (لسه معندناش مصدر أسعار
  // صرف حي) — العملة المعروضة جنب كل رقم إجمالي هي العملة الافتراضية من
  // الإعدادات (⚙️ إعدادات Sales)، فلو فريقك بيسجل بعملات مختلطة، اعتبر
  // الإجماليات تقريبية لحد ما نربط API لسعر الصرف.
  const CURRENCY_SYMBOLS = {
    EGP: "ج.م", USD: "$", EUR: "€", KWD: "د.ك", CAD: "C$", CNY: "¥", JPY: "¥",
  };
  const CURRENCY_LABELS = {
    EGP: "جنيه مصري", USD: "دولار أمريكي", EUR: "يورو", KWD: "دينار كويتي",
    CAD: "دولار كندي", CNY: "يوان صيني", JPY: "ين ياباني",
  };

  // =========================================================================
  // Central Sales Ledger — read / write / seed
  // =========================================================================

  function readLedger() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; }
    catch (e) { return []; }
  }
  function writeLedger(rows) {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(rows));
  }

  function currentUserName() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const u = window.VVAuth.getCurrentUser();
      if (u && u.full_name) return u.full_name;
    }
    return "Demo User";
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nextBookingCode(rows) {
    const maxNum = rows.reduce((max, r) => {
      const n = parseInt(String(r.code || "").replace(/\D/g, ""), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return `BK-${String(maxNum + 1).padStart(6, "0")}`;
  }

  // لا يوجد أي بيانات وهمية — السجل بيبدأ فاضي تماماً وبيتملى بس من عمليات
  // حقيقية عن طريق الـ Wizard (أو لما نربطه بـ API حقيقي بعدين).
  function seedIfEmpty() {
    return readLedger();
  }

  function getAllSales() {
    return seedIfEmpty();
  }

  function addSale(entry) {
    const rows = readLedger();
    const record = {
      id: `sale_${Date.now()}`,
      code: nextBookingCode(rows),
      department: entry.department,
      clientName: entry.clientName,
      service: entry.service,
      cost: Number(entry.cost) || 0,
      selling: Number(entry.selling) || 0,
      profit: (Number(entry.selling) || 0) - (Number(entry.cost) || 0),
      currency: entry.currency || "EGP",
      paymentStatus: entry.paymentStatus,
      date: entry.date || todayISO(),
      createdBy: currentUserName(),
    };
    rows.unshift(record);
    writeLedger(rows);
    return record;
  }

  // =========================================================================
  // Filtering
  // =========================================================================

  function getFilters() {
    return {
      search: (document.getElementById("f-search")?.value || "").trim().toLowerCase(),
      department: document.getElementById("f-department")?.value || "",
      paymentStatus: document.getElementById("f-payment-status")?.value || "",
      dateFrom: document.getElementById("f-date-from")?.value || "",
      dateTo: document.getElementById("f-date-to")?.value || "",
    };
  }

  function applyFilters(rows, filters) {
    return rows.filter((r) => {
      if (filters.search) {
        const hay = `${r.clientName} ${r.code}`.toLowerCase();
        if (!hay.includes(filters.search)) return false;
      }
      if (filters.department && r.department !== filters.department) return false;
      if (filters.paymentStatus && r.paymentStatus !== filters.paymentStatus) return false;
      if (filters.dateFrom && r.date < filters.dateFrom) return false;
      if (filters.dateTo && r.date > filters.dateTo) return false;
      return true;
    });
  }

  function fmtMoney(n, currency) {
    const symbol = CURRENCY_SYMBOLS[currency] || CURRENCY_SYMBOLS.EGP;
    return Number(n || 0).toLocaleString("en-US") + " " + symbol;
  }

  // =========================================================================
  // KPIs
  // =========================================================================

  function renderKPIs() {
    const rows = getAllSales();
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const rowsThisMonth = rows.filter((r) => (r.date || "").startsWith(thisMonth));

    const totalBookings = rowsThisMonth.length;
    const totalSales = rowsThisMonth.reduce((sum, r) => sum + (r.selling || 0), 0);
    const newClients = new Set(rowsThisMonth.map((r) => r.clientName)).size;
    const totalCommissions = rowsThisMonth.reduce((sum, r) => sum + (r.profit || 0), 0);

    document.getElementById("kpi-total-bookings").textContent = totalBookings;
    document.getElementById("kpi-total-sales").textContent = fmtMoney(totalSales, readSettings().currency);
    document.getElementById("kpi-new-clients").textContent = newClients;
    document.getElementById("kpi-total-commissions").textContent = fmtMoney(totalCommissions, readSettings().currency);
  }

  // =========================================================================
  // Charts (Chart.js) — #salesChart (line) + #destChart (doughnut)
  // =========================================================================

  let salesChartInstance = null;
  let destChartInstance = null;

  function renderCharts() {
    if (typeof Chart === "undefined") return;
    const rows = getAllSales();

    // ---- Line chart: monthly sales totals, last 6 months ----
    const monthBuckets = {};
    rows.forEach((r) => {
      const month = (r.date || "").slice(0, 7);
      if (!month) return;
      monthBuckets[month] = (monthBuckets[month] || 0) + (r.selling || 0);
    });
    const months = Object.keys(monthBuckets).sort().slice(-6);
    const monthLabels = months.map((m) => {
      const [y, mo] = m.split("-");
      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("ar-EG", { month: "short" });
    });
    const monthValues = months.map((m) => monthBuckets[m]);

    const salesCtx = document.getElementById("salesChart");
    if (salesCtx) {
      if (salesChartInstance) salesChartInstance.destroy();
      salesChartInstance = new Chart(salesCtx, {
        type: "line",
        data: {
          labels: monthLabels,
          datasets: [{
            label: "المبيعات",
            data: monthValues,
            borderColor: "#C79A3B",
            backgroundColor: "rgba(199,154,59,0.12)",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } },
        },
      });
    }

    // ---- Doughnut chart: top destinations by department label (proxy for demo) ----
    const deptTotals = {};
    rows.forEach((r) => {
      deptTotals[r.department] = (deptTotals[r.department] || 0) + (r.selling || 0);
    });
    const deptKeys = Object.keys(deptTotals);
    const deptLabels = deptKeys.map((k) => DEPARTMENT_LABELS[k] || k);
    const deptValues = deptKeys.map((k) => deptTotals[k]);

    const destCtx = document.getElementById("destChart");
    if (destCtx) {
      if (destChartInstance) destChartInstance.destroy();
      destChartInstance = new Chart(destCtx, {
        type: "doughnut",
        data: {
          labels: deptLabels,
          datasets: [{
            data: deptValues,
            backgroundColor: ["#3068E0", "#1F9D6E", "#C98A1E", "#D14848", "#7C5CE0", "#8C6A22"],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
        },
      });
    }
  }

  // =========================================================================
  // Tables — آخر الحجوزات (dashboard) + سجل المبيعات المركزي (main table)
  // =========================================================================

  function statusBadgeHTML(status) {
    return `<span class="badge badge--${status}">${PAYMENT_STATUS_LABELS[status] || status}</span>`;
  }

  function renderRecentBookings() {
    const tbody = document.getElementById("recent-bookings-body");
    if (!tbody) return;
    const rows = getAllSales().slice(0, 6);
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><p>لا توجد حجوزات بعد</p></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${DEPARTMENT_LABELS[r.department] || r.department}</td>
        <td class="cell-primary">${r.clientName}</td>
        <td>${r.date}</td>
        <td>${statusBadgeHTML(r.paymentStatus)}</td>
        <td class="mono">${r.code}</td>
      </tr>`).join("");
  }

  function renderStatusPills() {
    const wrap = document.getElementById("status-pill-grid");
    if (!wrap) return;
    const rows = getAllSales();
    const paidFull = rows.filter((r) => r.paymentStatus === "paid_full").length;
    const deposit = rows.filter((r) => r.paymentStatus === "deposit").length;
    const unpaid = rows.filter((r) => r.paymentStatus === "unpaid").length;
    const total = rows.length;
    wrap.innerHTML = `
      <div class="status-pill status-pill--confirmed"><div class="status-pill__num">${paidFull}</div><div class="status-pill__label">مدفوع بالكامل</div></div>
      <div class="status-pill status-pill--pending"><div class="status-pill__num">${deposit}</div><div class="status-pill__label">دفعة مقدمة</div></div>
      <div class="status-pill status-pill--cancelled"><div class="status-pill__num">${unpaid}</div><div class="status-pill__label">غير مدفوع</div></div>
      <div class="status-pill status-pill--progress"><div class="status-pill__num">${total}</div><div class="status-pill__label">إجمالي الحجوزات</div></div>
    `;
  }

  function renderSalesTable() {
    const tbody = document.getElementById("sales-table-body");
    if (!tbody) return;
    const filters = getFilters();
    const rows = applyFilters(getAllSales(), filters);

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state"><p>لا توجد نتائج مطابقة</p></td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${r.code}</td>
        <td>${DEPARTMENT_LABELS[r.department] || r.department}</td>
        <td class="cell-primary">${r.clientName}</td>
        <td>${r.service || "—"}</td>
        <td class="num amount-out">${fmtMoney(r.cost, r.currency)}</td>
        <td class="num amount-in">${fmtMoney(r.selling, r.currency)}</td>
        <td class="num">${fmtMoney(r.profit, r.currency)}</td>
        <td>${CURRENCY_LABELS[r.currency] || r.currency}</td>
        <td>${statusBadgeHTML(r.paymentStatus)}</td>
        <td>${r.date}</td>
      </tr>`).join("");
  }

  function refreshEverything() {
    renderKPIs();
    renderCharts();
    renderRecentBookings();
    renderStatusPills();
    renderSalesTable();
  }

  // =========================================================================
  // Filters & search — #f-search / #f-department / #f-payment-status / dates
  // =========================================================================

  function initFilters() {
    ["f-search"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", renderSalesTable);
    });
    ["f-department", "f-payment-status", "f-date-from", "f-date-to"].forEach((id) => {
      document.getElementById(id)?.addEventListener("change", renderSalesTable);
    });
  }

  // =========================================================================
  // Modal open/close plumbing — same pattern used across the project
  // =========================================================================

  function openModal(id) {
    document.getElementById(id)?.classList.add("is-open");
  }
  function closeModal(id) {
    document.getElementById(id)?.classList.remove("is-open");
  }

  function initModalPlumbing() {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll("[data-open-modal]").forEach((btn) => {
      btn.addEventListener("click", () => openModal(btn.dataset.openModal));
    });
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open"));
    });
  }

  // =========================================================================
  // Booking Wizard — steps 3 → 11
  // =========================================================================

  const wizardState = {
    service: null,       // "flights" | "hotels" | "packages" | "visas" | "transfers" | "insurance"
    serviceLabel: "",
    searchParams: {},     // whatever was filled in step 4/6
    selectedResult: null, // chosen result from step 5/7
    pricing: {},          // { cost, selling, profit, paymentStatus, notes } from step 8
    traveler: {},         // { clientName, phone, email, totalPax } from step 9
    lastResultsSourceModal: null, // to know where "رجوع" from results should go
  };

  function resetWizard() {
    wizardState.service = null;
    wizardState.serviceLabel = "";
    wizardState.searchParams = {};
    wizardState.selectedResult = null;
    wizardState.pricing = {};
    wizardState.traveler = {};
    wizardState.lastResultsSourceModal = null;
    document.querySelectorAll(".service-pick-btn").forEach((b) => b.classList.remove("is-selected"));
  }

  function initServicePicker() {
    document.getElementById("btn-new-booking")?.addEventListener("click", () => {
      resetWizard();
      openModal("modal-service-select");
    });

    document.querySelectorAll(".service-pick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".service-pick-btn").forEach((b) => b.classList.remove("is-selected"));
        btn.classList.add("is-selected");
        wizardState.service = btn.dataset.service;
        wizardState.serviceLabel = btn.querySelector(".service-pick-btn__label").textContent;

        closeModal("modal-service-select");
        if (wizardState.service === "flights") {
          openModal("modal-flight-search");
        } else if (wizardState.service === "hotels") {
          openModal("modal-hotel-search");
        } else {
          // packages / visas / transfers / insurance: skip dedicated search
          // form (no structured supplier search yet) and go straight to
          // pricing, same as if a result had already been "selected".
          wizardState.selectedResult = { title: wizardState.serviceLabel, meta: "—", price: 0 };
          goToBookingDetails();
        }
      });
    });
  }

  // ---- Fake search results (no live supplier API yet — placeholder data
  // structured exactly like a real search-results contract would be, so
  // swapping in a real fetch() later only touches this one function) ----
  function fakeFlightResults(params) {
    const base = 3500 + Math.floor(Math.random() * 2000);
    return [
      { title: `${params.from || "القاهرة"} ✈ ${params.to || "—"} — الدرجة الاقتصادية`, meta: `${params.date || "—"} · ${params.pax || 1} مسافر`, price: base },
      { title: `${params.from || "القاهرة"} ✈ ${params.to || "—"} — درجة رجال الأعمال`, meta: `${params.date || "—"} · ${params.pax || 1} مسافر`, price: base * 2.2 },
    ];
  }
  function fakeHotelResults(params) {
    const base = 2800 + Math.floor(Math.random() * 2500);
    return [
      { title: `فندق مميز — ${params.city || "—"}`, meta: `${params.checkin || "—"} إلى ${params.checkout || "—"} · ${params.rooms || 1} غرفة`, price: base },
      { title: `منتجع 5 نجوم — ${params.city || "—"}`, meta: `${params.checkin || "—"} إلى ${params.checkout || "—"} · ${params.rooms || 1} غرفة`, price: base * 1.6 },
    ];
  }

  function renderSearchResults(title, results, backTarget) {
    document.getElementById("search-results-title").textContent = title;
    wizardState.lastResultsSourceModal = backTarget;

    const body = document.getElementById("search-results-body");
    body.innerHTML = results.map((r, idx) => `
      <div class="result-card">
        <div class="result-card__info">
          <div class="result-card__title">${r.title}</div>
          <div class="result-card__meta">${r.meta}</div>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="result-card__price">${fmtMoney(r.price)}</div>
          <button class="btn btn--primary" data-select-result="${idx}">اختيار</button>
        </div>
      </div>`).join("");

    body.querySelectorAll("[data-select-result]").forEach((btn) => {
      btn.addEventListener("click", () => {
        wizardState.selectedResult = results[Number(btn.dataset.selectResult)];
        closeModal("modal-search-results");
        goToBookingDetails();
      });
    });

    document.querySelector('[data-wizard-back-dynamic]').onclick = () => {
      closeModal("modal-search-results");
      openModal(backTarget);
    };
  }

  function goToBookingDetails() {
    document.getElementById("bd-service-label").value =
      `${wizardState.serviceLabel} — ${wizardState.selectedResult?.title || ""}`;
    document.getElementById("ns-selling").value = wizardState.selectedResult?.price || 0;
    document.getElementById("ns-cost").value = Math.round((wizardState.selectedResult?.price || 0) * 0.8);
    recomputeProfit();
    openModal("modal-booking-details");
  }

  function recomputeProfit() {
    const cost = Number(document.getElementById("ns-cost")?.value) || 0;
    const selling = Number(document.getElementById("ns-selling")?.value) || 0;
    const profitField = document.getElementById("ns-profit");
    if (profitField) profitField.value = selling - cost;
  }

  function initWizardNavigation() {
    // step 4 -> results (flights)
    document.querySelector('[data-wizard-next="flight-search-to-results"]')?.addEventListener("click", () => {
      wizardState.searchParams = {
        from: document.getElementById("fl-from").value,
        to: document.getElementById("fl-to").value,
        date: document.getElementById("fl-date").value,
        pax: document.getElementById("fl-pax").value,
      };
      closeModal("modal-flight-search");
      openModal("modal-search-results");
      renderSearchResults("نتائج البحث عن رحلات", fakeFlightResults(wizardState.searchParams), "modal-flight-search");
    });

    // step 6 -> results (hotels)
    document.querySelector('[data-wizard-next="hotel-search-to-results"]')?.addEventListener("click", () => {
      wizardState.searchParams = {
        city: document.getElementById("ht-city").value,
        checkin: document.getElementById("ht-checkin").value,
        checkout: document.getElementById("ht-checkout").value,
        rooms: document.getElementById("ht-rooms").value,
      };
      closeModal("modal-hotel-search");
      openModal("modal-search-results");
      renderSearchResults("نتائج البحث عن فنادق", fakeHotelResults(wizardState.searchParams), "modal-hotel-search");
    });

    // back buttons with a fixed target
    document.querySelectorAll("[data-wizard-back]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const current = btn.closest(".vv-modal-overlay").id;
        closeModal(current);
        openModal(btn.dataset.wizardBack);
      });
    });

    // profit auto-calc: input on #ns-cost / #ns-selling
    document.getElementById("ns-cost")?.addEventListener("input", recomputeProfit);
    document.getElementById("ns-selling")?.addEventListener("input", recomputeProfit);

    // step 8 -> step 9
    document.querySelector('[data-wizard-next="details-to-travelers"]')?.addEventListener("click", () => {
      wizardState.pricing = {
        cost: Number(document.getElementById("ns-cost").value) || 0,
        selling: Number(document.getElementById("ns-selling").value) || 0,
        currency: document.getElementById("bd-currency").value,
        paymentStatus: document.getElementById("bd-payment-status").value,
        notes: document.getElementById("bd-notes").value,
      };
      closeModal("modal-booking-details");
      openModal("modal-travelers");
    });

    // step 9 -> step 10 (review)
    document.querySelector('[data-wizard-next="travelers-to-review"]')?.addEventListener("click", () => {
      wizardState.traveler = {
        clientName: document.getElementById("tr-client-name").value.trim() || "عميل بدون اسم",
        phone: document.getElementById("tr-phone").value,
        email: document.getElementById("tr-email").value,
        totalPax: document.getElementById("tr-total-pax").value,
      };
      closeModal("modal-travelers");
      renderReview();
      openModal("modal-review");
    });

    // step 11: confirm + save into Central Sales Ledger
    document.getElementById("btn-save-central-sale")?.addEventListener("click", () => {
      const record = addSale({
        department: wizardState.service,
        clientName: wizardState.traveler.clientName,
        service: `${wizardState.serviceLabel} — ${wizardState.selectedResult?.title || ""}`,
        cost: wizardState.pricing.cost,
        selling: wizardState.pricing.selling,
        currency: wizardState.pricing.currency,
        paymentStatus: wizardState.pricing.paymentStatus,
        date: todayISO(),
      });

      closeModal("modal-review");
      document.getElementById("confirm-booking-code").textContent = record.code;
      openModal("modal-confirmation");
      refreshEverything();
    });
  }

  function renderReview() {
    const body = document.getElementById("review-body");
    body.innerHTML = `
      <div class="review-row"><span class="review-row__label">الخدمة</span><span class="review-row__value">${wizardState.serviceLabel} — ${wizardState.selectedResult?.title || "—"}</span></div>
      <div class="review-row"><span class="review-row__label">العميل</span><span class="review-row__value">${wizardState.traveler.clientName}</span></div>
      <div class="review-row"><span class="review-row__label">الهاتف</span><span class="review-row__value">${wizardState.traveler.phone || "—"}</span></div>
      <div class="review-row"><span class="review-row__label">عدد المسافرين</span><span class="review-row__value">${wizardState.traveler.totalPax}</span></div>
      <div class="review-row"><span class="review-row__label">التكلفة</span><span class="review-row__value">${fmtMoney(wizardState.pricing.cost, wizardState.pricing.currency)}</span></div>
      <div class="review-row"><span class="review-row__label">سعر البيع</span><span class="review-row__value">${fmtMoney(wizardState.pricing.selling, wizardState.pricing.currency)}</span></div>
      <div class="review-row"><span class="review-row__label">صافي الربح</span><span class="review-row__value">${fmtMoney(wizardState.pricing.selling - wizardState.pricing.cost, wizardState.pricing.currency)}</span></div>
      <div class="review-row"><span class="review-row__label">حالة السداد</span><span class="review-row__value">${PAYMENT_STATUS_LABELS[wizardState.pricing.paymentStatus] || "—"}</span></div>
    `;
  }

  // =========================================================================
  // 12. عروض الأسعار
  // =========================================================================

  function readQuotes() { try { return JSON.parse(localStorage.getItem(QUOTES_KEY)) || []; } catch (e) { return []; } }
  function writeQuotes(rows) { localStorage.setItem(QUOTES_KEY, JSON.stringify(rows)); }

  function renderQuotes() {
    const list = document.getElementById("quotes-list");
    const rows = readQuotes();
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>لا توجد عروض أسعار بعد</p></div>`;
      return;
    }
    list.innerHTML = rows.map((q) => `
      <div class="result-card">
        <div class="result-card__info">
          <div class="result-card__title">${q.client} — ${q.service}</div>
          <div class="result-card__meta">صالح حتى ${q.validUntil || "—"}</div>
        </div>
        <div class="result-card__price">${fmtMoney(q.price, q.currency)}</div>
      </div>`).join("");
  }

  function initQuotes() {
    document.getElementById("btn-toggle-quote-form")?.addEventListener("click", () => {
      const wrap = document.getElementById("quote-form-wrap");
      wrap.style.display = wrap.style.display === "block" ? "none" : "block";
    });
    document.getElementById("btn-save-quote")?.addEventListener("click", () => {
      const client = document.getElementById("qt-client").value.trim();
      const service = document.getElementById("qt-service").value.trim();
      const price = Number(document.getElementById("qt-price").value) || 0;
      const currency = document.getElementById("qt-currency").value;
      const validUntil = document.getElementById("qt-valid-until").value;
      if (!client || !service) { alert("من فضلك أدخل اسم العميل والخدمة."); return; }
      const rows = readQuotes();
      rows.unshift({ id: `q_${Date.now()}`, client, service, price, currency, validUntil });
      writeQuotes(rows);
      ["qt-client", "qt-service", "qt-price", "qt-valid-until"].forEach((id) => document.getElementById(id).value = "");
      renderQuotes();
    });
  }

  // =========================================================================
  // 13. العمولات والمستحقات
  // =========================================================================

  function renderCommissions() {
    const tbody = document.getElementById("commissions-table-body");
    const rows = getAllSales();
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><p>لا توجد بيانات</p></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td class="mono">${r.code}</td>
        <td class="cell-primary">${r.clientName}</td>
        <td class="num amount-in">${fmtMoney(r.selling, r.currency)}</td>
        <td class="num amount-out">${fmtMoney(r.cost, r.currency)}</td>
        <td class="num">${fmtMoney(r.profit, r.currency)}</td>
      </tr>`).join("");
  }

  // =========================================================================
  // 14. التقارير
  // =========================================================================

  function renderReports() {
    const rows = getAllSales();
    const totalSales = rows.reduce((s, r) => s + (r.selling || 0), 0);
    const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0);
    const totalProfit = totalSales - totalCost;
    document.getElementById("rp-count").textContent = rows.length;
    const rpCurrency = readSettings().currency;
    document.getElementById("rp-sales").textContent = fmtMoney(totalSales, rpCurrency);
    document.getElementById("rp-cost").textContent = fmtMoney(totalCost, rpCurrency);
    document.getElementById("rp-profit").textContent = fmtMoney(totalProfit, rpCurrency);
    document.getElementById("rp-avg").textContent = fmtMoney(rows.length ? totalSales / rows.length : 0, rpCurrency);
  }

  // =========================================================================
  // 15. ملاحظات العملاء
  // =========================================================================

  function readNotes() { try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || []; } catch (e) { return []; } }
  function writeNotes(rows) { localStorage.setItem(NOTES_KEY, JSON.stringify(rows)); }

  function renderNotes() {
    const list = document.getElementById("notes-list");
    const rows = readNotes();
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>لا توجد ملاحظات بعد</p></div>`;
      return;
    }
    list.innerHTML = rows.map((n) => `
      <div class="note-row">
        <strong>${n.client}</strong>
        <div>${n.note}</div>
        <div class="note-row__meta">${n.date} — ${n.by}</div>
      </div>`).join("");
  }

  function initNotes() {
    document.getElementById("btn-save-note")?.addEventListener("click", () => {
      const client = document.getElementById("cn-client").value.trim();
      const note = document.getElementById("cn-note").value.trim();
      if (!client || !note) { alert("من فضلك أدخل اسم العميل والملاحظة."); return; }
      const rows = readNotes();
      rows.unshift({ id: `n_${Date.now()}`, client, note, date: todayISO(), by: currentUserName() });
      writeNotes(rows);
      document.getElementById("cn-client").value = "";
      document.getElementById("cn-note").value = "";
      renderNotes();
    });
  }

  // =========================================================================
  // 16. التواصل مع العملاء
  // =========================================================================

  function readComm() { try { return JSON.parse(localStorage.getItem(COMM_KEY)) || []; } catch (e) { return []; } }
  function writeComm(rows) { localStorage.setItem(COMM_KEY, JSON.stringify(rows)); }

  const CHANNEL_LABELS = { whatsapp: "واتساب", phone: "مكالمة هاتفية", email: "بريد إلكتروني" };

  function renderComm() {
    const list = document.getElementById("comm-list");
    const rows = readComm();
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>لا يوجد سجل تواصل بعد</p></div>`;
      return;
    }
    list.innerHTML = rows.map((c) => `
      <div class="comm-row">
        <strong>${c.client}</strong> — ${CHANNEL_LABELS[c.channel] || c.channel}
        <div>${c.summary}</div>
        <div class="comm-row__meta">${c.date} — ${c.by}</div>
      </div>`).join("");
  }

  function initComm() {
    document.getElementById("btn-save-comm")?.addEventListener("click", () => {
      const client = document.getElementById("cm-client").value.trim();
      const channel = document.getElementById("cm-channel").value;
      const summary = document.getElementById("cm-summary").value.trim();
      if (!client || !summary) { alert("من فضلك أدخل اسم العميل والملخص."); return; }
      const rows = readComm();
      rows.unshift({ id: `c_${Date.now()}`, client, channel, summary, date: todayISO(), by: currentUserName() });
      writeComm(rows);
      document.getElementById("cm-client").value = "";
      document.getElementById("cm-summary").value = "";
      renderComm();
    });
  }

  // =========================================================================
  // 17. إعدادات (Sales)
  // =========================================================================

  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { defaultCommission: 15, currency: "EGP" }; }
    catch (e) { return { defaultCommission: 15, currency: "EGP" }; }
  }
  function initSettings() {
    const s = readSettings();
    document.getElementById("st-default-commission").value = s.defaultCommission;
    document.getElementById("st-currency").value = s.currency;
    document.getElementById("btn-save-settings")?.addEventListener("click", () => {
      const settings = {
        defaultCommission: Number(document.getElementById("st-default-commission").value) || 0,
        currency: document.getElementById("st-currency").value,
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      alert("تم حفظ الإعدادات.");
      closeModal("modal-sales-settings");
    });
  }

  // =========================================================================
  // Standalone modal render-on-open hooks (quotes/commissions/reports/etc.
  // only need to compute their content the moment they're actually opened)
  // =========================================================================

  function initStandaloneModalRenderHooks() {
    document.querySelector('[data-open-modal="modal-quotes"]')?.addEventListener("click", renderQuotes);
    document.querySelector('[data-open-modal="modal-commissions"]')?.addEventListener("click", renderCommissions);
    document.querySelector('[data-open-modal="modal-reports"]')?.addEventListener("click", renderReports);
    document.querySelector('[data-open-modal="modal-customer-notes"]')?.addEventListener("click", renderNotes);
    document.querySelector('[data-open-modal="modal-communication"]')?.addEventListener("click", renderComm);
  }

  // =========================================================================
  // Init
  // =========================================================================

  document.addEventListener("DOMContentLoaded", () => {
    initModalPlumbing();
    initFilters();
    initServicePicker();
    initWizardNavigation();
    initQuotes();
    initNotes();
    initComm();
    initSettings();
    initStandaloneModalRenderHooks();
    refreshEverything();
  });
})();