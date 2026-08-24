/**
 * owner.js
 * -----------------------------------------------------------------------
 * Owner dashboard logic. Reads real data straight from the same
 * localStorage keys Flights/Hotels/Visas already write to (no fake API
 * calls) — this matches how the rest of the ERP actually works today.
 *
 *   Flights: vv_sales_data / vv_requests_data
 *   Hotels:  vv_hotel_sales_data / vv_hotel_requests_data
 *   Visas:   vv_visa_sales_data / vv_visa_requests_data
 *
 * Depends on: config.js, components.js, Chart.js, employees.js,
 * change_requests.js (all loaded before this file)
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }
  function getTodayISO() { return new Date().toISOString().split("T")[0]; }
  function formatCurrency(amount) { return `$${Number(amount || 0).toLocaleString("en-US")}`; }

  // -----------------------------------------------------------------------
  // 0) Pull + normalize every department's data into one shared shape
  // -----------------------------------------------------------------------

  const DEPARTMENTS = [
    { key: "flights", label: "Flights", href: "flights.html", salesKey: "vv_sales_data", reqKey: "vv_requests_data", nameField: "passengerName", dateField: "date" },
    { key: "hotels", label: "Hotels", href: "hotels.html", salesKey: "vv_hotel_sales_data", reqKey: "vv_hotel_requests_data", nameField: "clientName", dateField: "checkIn" },
    { key: "visas", label: "Visas", href: "visas.html", salesKey: "vv_visa_sales_data", reqKey: "vv_visa_requests_data", nameField: "clientName", dateField: "date" },
  ];

  function readArray(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }

  // -----------------------------------------------------------------------
  // 0.5) Sales Report Balance — a standalone, documentation-only running
  // total per currency, built ONLY from sales already confirmed collected
  // (collectionStatus "cash" or "bank", set via the payment-status switch
  // in data.js). This NEVER reads or writes vv_treasury_cash/
  // vv_treasury_banks — it's a separate figure entirely, exactly as
  // agreed: useful for the Owner to see at a glance, but never a real
  // balance mutation and never combined across currencies.
  // -----------------------------------------------------------------------

  function computeSalesReportBalances() {
    const totals = {};
    DEPARTMENTS.forEach((dept) => {
      readArray(dept.salesKey).forEach((r) => {
        if (r.reviewStatus !== "reviewed") return;
        if (r.collectionStatus !== "cash" && r.collectionStatus !== "bank") return;
        const currency = r.currency || "EGP";
        const paid = Number(r.paidAmount) || 0;
        totals[currency] = Math.round(((totals[currency] || 0) + paid) * 100) / 100;
      });
    });
    return totals;
  }

  function renderSalesReportBalance() {
    const panel = document.getElementById("sales-report-balance-panel");
    if (!panel) return;
    const totals = computeSalesReportBalances();
    const currenciesPresent = CURRENCY_DISPLAY_ORDER.filter((c) => totals[c]);

    if (currenciesPresent.length === 0) {
      panel.innerHTML = `<div class="sales-report-balance-note">لا توجد مبيعات مؤكَّد تحصيلها (كاش/بنك) بعد.</div>`;
      return;
    }

    const lines = currenciesPresent.map((c) =>
      `<div class="sales-report-currency-line"><span class="sales-report-currency-line__label">${CURRENCY_LABELS_AR[c]}</span><span class="sales-report-currency-line__value">${totals[c].toLocaleString("en-US")}</span></div>`
    ).join("");

    panel.innerHTML = `
      <div class="sales-report-balance-note">رقم توثيقي من تقرير المبيعات (Sales Report) — لا يعكس ولا يؤثر على رصيد الخزينة أو البنوك الفعلي.</div>
      ${lines}
    `;
  }

  const CURRENCY_SYMBOLS = { EGP: "E£", USD: "$", EUR: "€", SAR: "ر.س", KWD: "د.ك", GBP: "£", JPY: "¥", CNY: "¥", CAD: "$" };
  const CURRENCY_LABELS_AR = { EGP: "جنيه", USD: "دولار", EUR: "يورو", SAR: "ريال", KWD: "دينار", GBP: "استرليني", JPY: "ين ياباني", CNY: "يوان صيني", CAD: "دولار كندي" };
  const CURRENCY_DISPLAY_ORDER = ["EGP", "USD", "EUR", "SAR", "KWD", "GBP", "JPY", "CNY", "CAD"];
  const currencySymbol = (code) => CURRENCY_SYMBOLS[code] || "$";

  function sumByCurrency(records, field) {
    const totals = {};
    records.forEach((r) => {
      const code = r.currency || "USD";
      totals[code] = (totals[code] || 0) + (Number(r[field]) || 0);
    });
    return totals;
  }

  function mergeCurrencyTotals(...totalsList) {
    const merged = {};
    totalsList.forEach((totals) => {
      Object.entries(totals).forEach(([code, amount]) => {
        merged[code] = (merged[code] || 0) + amount;
      });
    });
    return merged;
  }

  // Renders each currency on its own line — NEVER joined with "+". A
  // 4,200 EGP figure and a 4,500 USD figure are not "4,200 + 4,500" of
  // anything real; showing them stacked, one per line, is the only
  // honest way to present money in more than one currency at once.
  // Matches the exact same principle already applied to the Sales
  // Report's own per-currency breakdown in data.js.
  function formatCurrencyTotalsHtml(totals) {
    const entries = CURRENCY_DISPLAY_ORDER
      .filter((code) => totals[code] && totals[code] !== 0)
      .map((code) => [code, totals[code]]);
    // Catch any currency code not in the known display order too, rather
    // than silently dropping it.
    Object.keys(totals).forEach((code) => {
      if (!CURRENCY_DISPLAY_ORDER.includes(code) && totals[code] !== 0) entries.push([code, totals[code]]);
    });
    if (entries.length === 0) return `<div class="stat-tile__currency-line">${currencySymbol("USD")}0</div>`;
    return entries
      .map(([code, amount]) => `<div class="stat-tile__currency-line">${currencySymbol(code)}${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>`)
      .join("");
  }

  // Plain-text fallback (used only where HTML can't be injected, e.g. a
  // trend line) — still never combines currencies with "+"; picks the
  // single largest currency by absolute value and labels it explicitly
  // rather than pretending the total is one number.
  function formatCurrencyTotalsPlain(totals) {
    const entries = Object.entries(totals).filter(([, amount]) => amount !== 0);
    if (entries.length === 0) return "$0";
    if (entries.length === 1) return `${currencySymbol(entries[0][0])}${entries[0][1].toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    const largest = [...entries].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    return `${currencySymbol(largest[0])}${largest[1].toLocaleString("en-US", { maximumFractionDigits: 0 })} (+${entries.length - 1} عملة أخرى)`;
  }

  function dominantCurrency(totalsList) {
    const counts = {};
    totalsList.forEach((totals) => {
      Object.keys(totals).forEach((code) => { counts[code] = (counts[code] || 0) + 1; });
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length ? sorted[0][0] : "USD";
  }

  function getDeptSnapshot(dept) {
    const sales = readArray(dept.salesKey);
    const requests = readArray(dept.reqKey);
    const salesByCurrency = sumByCurrency(sales, "sellingRate");
    const profitByCurrency = sumByCurrency(sales, "profit");
    return { ...dept, sales, requests, salesByCurrency, profitByCurrency };
  }

  // -----------------------------------------------------------------------
  // 1) Welcome message
  // -----------------------------------------------------------------------

  function renderWelcome() {
    const user = (typeof VVComponents !== "undefined" && VVComponents.getCurrentUser) ? VVComponents.getCurrentUser() : {};
    const firstName = (user.full_name || "").trim().split(/\s+/)[0] || "";
    document.getElementById("owner-welcome-title").textContent = firstName ? `Welcome back, ${firstName}` : "Welcome back";
  }

  // -----------------------------------------------------------------------
  // 2) Financial overview — colorful pastel tiles, real numbers
  // -----------------------------------------------------------------------

  const TILE_ICONS = {
    revenue: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
    profit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
    bookings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>`,
    pending: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`,
  };
  const TILE_COLORS = {
    revenue: { bg: "#FDECD8", fg: "#C2701A" },
    profit: { bg: "#EDE9FE", fg: "#7C5CE0" },
    bookings: { bg: "#DCFCE7", fg: "#1E9D6E" },
    pending: { bg: "#E0F2FE", fg: "#2478D9" },
  };

  function renderReportTiles(snapshots) {
    const totalRevenueByCurrency = mergeCurrencyTotals(...snapshots.map((d) => d.salesByCurrency));
    const totalProfitByCurrency = mergeCurrencyTotals(...snapshots.map((d) => d.profitByCurrency));
    const totalBookings = snapshots.reduce((sum, d) => sum + d.sales.length, 0);
    const totalPending = snapshots.reduce((sum, d) => sum + d.requests.length, 0);

    const tiles = [
      { key: "revenue", label: "Total Revenue", valueHtml: formatCurrencyTotalsHtml(totalRevenueByCurrency) },
      { key: "profit", label: "Net Profit", valueHtml: formatCurrencyTotalsHtml(totalProfitByCurrency) },
      { key: "bookings", label: "Total Bookings", valueHtml: `<div class="stat-tile__value">${totalBookings.toLocaleString("en-US")}</div>` },
      { key: "pending", label: "Pending Requests", valueHtml: `<div class="stat-tile__value">${totalPending.toLocaleString("en-US")}</div>` },
    ];

    document.getElementById("owner-report-grid").innerHTML = tiles
      .map((t) => {
        const color = TILE_COLORS[t.key];
        return `
          <div class="stat-tile">
            <div class="stat-tile__icon" style="--tile-bg:${color.bg};--tile-fg:${color.fg};">${TILE_ICONS[t.key]}</div>
            ${t.valueHtml}
            <div class="stat-tile__label">${t.label}</div>
          </div>`;
      })
      .join("");

    document.getElementById("owner-total-revenue").innerHTML = formatCurrencyTotalsHtml(totalRevenueByCurrency);
    document.getElementById("owner-revenue-trend").textContent =
      totalBookings > 0 ? `${totalBookings} bookings across all departments` : "";
  }

  // -----------------------------------------------------------------------
  // 3) Donut charts — Sales & Profit by department (Chart.js)
  // -----------------------------------------------------------------------

  const DEPT_COLORS = { flights: "#3068E0", hotels: "#C79A3B", visas: "#1F9D6E" };
  let salesChartInstance = null;
  let profitChartInstance = null;

  function renderLegend(containerId, snapshots, totalsKey, chartCurrency) {
    document.getElementById(containerId).innerHTML = snapshots
      .map((d) => `
        <div class="chart-legend__item">
          <span class="chart-legend__dot" style="background:${DEPT_COLORS[d.key]};"></span>
          ${d.label} — ${currencySymbol(chartCurrency)}${(d[totalsKey][chartCurrency] || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </div>`)
      .join("");
  }

  function renderCharts(snapshots) {
    if (typeof Chart === "undefined") return;

    try {
      const chartCurrency = dominantCurrency([
        ...snapshots.map((d) => d.salesByCurrency),
        ...snapshots.map((d) => d.profitByCurrency),
      ]);
      const labels = snapshots.map((d) => d.label);
      const colors = snapshots.map((d) => DEPT_COLORS[d.key]);

      const salesCtx = document.getElementById("chart-sales-by-dept");
      if (salesChartInstance) salesChartInstance.destroy();
      salesChartInstance = new Chart(salesCtx, {
        type: "doughnut",
        data: { labels, datasets: [{ data: snapshots.map((d) => d.salesByCurrency[chartCurrency] || 0), backgroundColor: colors, borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: "68%" },
      });
      renderLegend("legend-sales-by-dept", snapshots, "salesByCurrency", chartCurrency);

      const profitCtx = document.getElementById("chart-profit-by-dept");
      if (profitChartInstance) profitChartInstance.destroy();
      profitChartInstance = new Chart(profitCtx, {
        type: "doughnut",
        data: { labels, datasets: [{ data: snapshots.map((d) => Math.max(d.profitByCurrency[chartCurrency] || 0, 0)), backgroundColor: colors, borderWidth: 0 }] },
        options: { plugins: { legend: { display: false } }, cutout: "68%" },
      });
      renderLegend("legend-profit-by-dept", snapshots, "profitByCurrency", chartCurrency);
    } catch (err) {
      console.error("Chart rendering failed:", err);
    }
  }

  // -----------------------------------------------------------------------
  // 4) Recent pending requests across all departments (draft bookings —
  //    the Requests/Hold queue, distinct from Change Requests below)
  // -----------------------------------------------------------------------

  function renderPendingRequests(snapshots) {
    const combined = [];
    snapshots.forEach((d) => {
      d.requests.forEach((r) => {
        combined.push({
          dept: d.key,
          deptLabel: d.label,
          name: r[d.nameField] || "—",
          date: r[d.dateField] || "",
          id: r.id,
        });
      });
    });
    combined.sort((a, b) => Number(b.id) - Number(a.id));

    const container = document.getElementById("owner-pending-list");
    if (combined.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No pending requests right now</p></div>`;
      return;
    }
    container.innerHTML = combined
      .slice(0, 10)
      .map(
        (r) => `
        <div class="pending-item">
          <div>
            <div class="pending-item__name">${r.name}</div>
            <div class="pending-item__meta">${r.date || "No date"}</div>
          </div>
          <span class="dept-tag dept-tag--${r.dept}">[${r.deptLabel}]</span>
        </div>`
      )
      .join("");
  }

  // -----------------------------------------------------------------------
  // 5) Pending Change Requests (Chart of Accounts Maker-Checker) — the
  //    permanent home for the panel that used to be temporarily on
  //    accounts.html's dashboard. Same VVChangeRequests engine, same
  //    ManagerOverride gate on approval, nothing about the underlying
  //    logic changed — only where it's displayed.
  // -----------------------------------------------------------------------

  const CHANGE_TYPE_LABELS = { create: "New Account", edit: "Edit Account", deactivate: "Deactivate Account", delete: "Delete Account", link: "Link Party", unlink: "Unlink Party" };

  // Same in-flight guard pattern as it.js's Audit Log — purely a UI-level
  // safeguard against a confusing double-click while the async
  // ManagerOverride gate is resolving; the real protection against
  // actually double-applying anything already lives inside
  // change_requests.js itself.
  const ownerRequestsInFlight = new Set();
  let ownerExpandedRequestId = null;

  function updateOwnerPendingBadge(count) {
    const heading = [...document.querySelectorAll(".owner-section-title h2")].find((h) => h.textContent.includes("Pending Change Requests"));
    if (!heading) return;
    let badge = document.getElementById("owner-pending-badge");
    if (count === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "owner-pending-badge";
      badge.style.cssText = "display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; border-radius:10px; background:var(--coral); color:#fff; font-size:10px; font-weight:800; margin-inline-start:8px; vertical-align:middle;";
      heading.appendChild(badge);
    }
    badge.textContent = count;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderPendingApprovals() {
    const container = document.getElementById("owner-pending-approvals");
    if (!container || !window.VVChangeRequests) return;

    const pending = window.VVChangeRequests.getPending();
    updateOwnerPendingBadge(pending.length);

    if (pending.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No pending Chart of Accounts requests</p></div>`;
      return;
    }

    container.innerHTML = pending.map((req) => {
      const diffHtml = req.changeType === "create"
        ? `<span style="color:var(--emerald);">Brand-new account</span>`
        : (req.fieldChanges || []).map((c) => `<div class="diff-line"><strong>${c.field}:</strong> <span style="color:var(--coral);">${c.oldValue || "—"}</span> ➜ <span style="color:var(--emerald);">${c.newValue || "—"}</span></div>`).join("");

      const inFlight = ownerRequestsInFlight.has(req.id);
      const isExpanded = ownerExpandedRequestId === req.id;

      return `
        <div class="approval-card">
          <div class="approval-card__row">
            <div>
              <strong style="font-size:13px;">${CHANGE_TYPE_LABELS[req.changeType] || req.changeType}</strong>
              <span style="font-size:11.5px; color:var(--text-faint); margin-inline-start:8px;">${req.targetLabel}</span>
            </div>
            <span style="font-size:10.5px; color:var(--text-faint);">${req.requestedBy} — ${req.requestedAt}</span>
          </div>
          <div style="margin-bottom:10px;">${diffHtml}</div>
          <button class="btn-approve" data-approve-request="${req.id}" ${inFlight ? "disabled" : ""}>${inFlight ? "…" : "✓ Approve"}</button>
          <button class="btn-reject" data-reject-request="${req.id}" ${inFlight ? "disabled" : ""}>${inFlight ? "…" : "✕ Reject"}</button>
          <button class="btn-details" data-toggle-details="${req.id}" style="background:transparent; color:var(--text-faint); border:1px solid var(--border); font-size:10.5px; font-weight:600; padding:5px 12px; border-radius:var(--radius-sm); cursor:pointer; margin-inline-start:6px;">${isExpanded ? "Hide" : "Details"}</button>
          ${isExpanded ? `
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border); font-size:11.5px;">
              <div style="margin-bottom:3px;"><strong style="color:var(--text-soft);">Request ID:</strong> ${req.id}</div>
              <div style="margin-bottom:3px;"><strong style="color:var(--text-soft);">Module:</strong> ${req.module}</div>
              <div style="margin-bottom:3px;"><strong style="color:var(--text-soft);">Target:</strong> ${req.targetLabel} ${req.targetId ? `(${req.targetId})` : "(new)"}</div>
              <div style="margin-bottom:3px;"><strong style="color:var(--text-soft);">Current Status:</strong> ${req.status}</div>
              ${req.payload ? `<div style="margin-bottom:3px;"><strong style="color:var(--text-soft);">Payload:</strong> <code style="font-size:10px;">${escapeHtml(JSON.stringify(req.payload))}</code></div>` : ""}
            </div>` : ""}
        </div>`;
    }).join("");

    container.querySelectorAll("[data-approve-request]").forEach((btn) => {
      btn.addEventListener("click", () => handleOwnerApprove(btn.dataset.approveRequest));
    });
    container.querySelectorAll("[data-reject-request]").forEach((btn) => {
      btn.addEventListener("click", () => handleOwnerReject(btn.dataset.rejectRequest));
    });
    container.querySelectorAll("[data-toggle-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ownerExpandedRequestId = ownerExpandedRequestId === btn.dataset.toggleDetails ? null : btn.dataset.toggleDetails;
        renderPendingApprovals();
      });
    });
  }

  // Never assume clicking Approve means it actually applied — status
  // comes back authoritatively from window.VVChangeRequests's own
  // { success, reason } contract; renderPendingApprovals() just re-reads
  // getPending() afterward, so a request that resolved to apply_failed
  // correctly disappears from THIS pending list either way (it's no
  // longer pending) — its outcome is visible in IT's Audit Log.
  function handleOwnerApprove(requestId) {
    if (ownerRequestsInFlight.has(requestId)) return;
    ownerRequestsInFlight.add(requestId);
    renderPendingApprovals();
    window.VVChangeRequests.approve(requestId, () => {
      ownerRequestsInFlight.delete(requestId);
      renderPendingApprovals();
    });
  }

  function handleOwnerReject(requestId) {
    if (ownerRequestsInFlight.has(requestId)) return;
    ownerRequestsInFlight.add(requestId);
    renderPendingApprovals();
    window.VVChangeRequests.reject(requestId, () => {
      ownerRequestsInFlight.delete(requestId);
      renderPendingApprovals();
    });
  }

  // -----------------------------------------------------------------------
  // 6) Employee Directory — shared component from employees.js
  // -----------------------------------------------------------------------

  function renderEmployeeDirectory() {
    if (window.VVEmployees) window.VVEmployees.renderDirectoryInto("owner-employee-directory");
  }

  // -----------------------------------------------------------------------
  // 6) Full Audit History — every Change Request across every module,
  // with the employee who made it, filterable, and exportable as a
  // complete CSV backup (same technique already used by flights.js's own
  // "Export Backup" button — Blob + <a download>, UTF-8 BOM so Excel
  // opens Arabic text correctly, no external library needed).
  // -----------------------------------------------------------------------

  const AUDIT_MODULE_LABELS = {
    chart_of_accounts: "شجرة الحسابات", party: "جهات (Party)", journal_entries: "قيود يومية",
    vouchers: "سندات", custody: "عهد", expenses: "مصروفات", treasury: "خزينة",
  };
  const AUDIT_CHANGE_TYPE_LABELS = {
    create: "إضافة", edit: "تعديل", link: "ربط", unlink: "إلغاء ربط",
    post: "ترحيل", reverse: "عكس", issue: "صرف", settle: "تسوية", cancel: "إلغاء", financial_op: "عملية مالية",
  };
  const AUDIT_STATUS_LABELS = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", apply_failed: "تعذّر التطبيق" };

  function auditDiffText(req) {
    if (req.fieldChanges && req.fieldChanges.length > 0) {
      return req.fieldChanges.map((c) => `${c.field}: ${c.oldValue ?? "—"} ➜ ${c.newValue ?? "—"}`).join(" | ");
    }
    if (req.status === "rejected" && req.rejectionReason) return `سبب الرفض: ${req.rejectionReason}`;
    if (req.status === "apply_failed" && req.applyFailureReason) return `سبب تعذّر التطبيق: ${req.applyFailureReason}`;
    if (req.changeType === "create" || req.changeType === "issue") return "إنشاء جديد بالكامل";
    return "—";
  }

  function getFilteredAuditRows() {
    if (!window.VVChangeRequests) return [];
    const query = (document.getElementById("audit-log-search").value || "").trim().toLowerCase();
    const moduleFilter = document.getElementById("audit-log-module-filter").value;
    const statusFilter = document.getElementById("audit-log-status-filter").value;

    let rows = [...window.VVChangeRequests.getAll()].sort((a, b) => (b.id > a.id ? 1 : -1));
    if (moduleFilter) rows = rows.filter((r) => r.module === moduleFilter);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (query) {
      rows = rows.filter((r) =>
        (r.requestedBy || "").toLowerCase().includes(query) ||
        (r.reviewedBy || "").toLowerCase().includes(query) ||
        (r.targetLabel || "").toLowerCase().includes(query)
      );
    }
    return rows;
  }

  function renderAuditLog() {
    const rows = getFilteredAuditRows();
    const tbody = document.getElementById("audit-log-table-body");
    const table = document.getElementById("audit-log-table");
    const empty = document.getElementById("audit-log-empty");
    if (!tbody) return;

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td style="white-space:nowrap;">${r.requestedAt}</td>
        <td><strong>${r.requestedBy}</strong></td>
        <td>${AUDIT_MODULE_LABELS[r.module] || r.module}</td>
        <td>${AUDIT_CHANGE_TYPE_LABELS[r.changeType] || r.changeType}</td>
        <td>${r.targetLabel}</td>
        <td class="audit-diff-cell">${auditDiffText(r)}</td>
        <td><span class="audit-status-chip audit-status-chip--${r.status}">${AUDIT_STATUS_LABELS[r.status] || r.status}</span></td>
        <td style="white-space:nowrap;">${r.reviewedBy ? `${r.reviewedBy}<br><span style="font-size:10px;color:var(--text-faint);">${r.reviewedAt || ""}</span>` : "—"}</td>
      </tr>
    `).join("");
  }

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportAuditLogToCsv() {
    const rows = getFilteredAuditRows(); // exports exactly what's currently filtered/visible — no surprises
    if (rows.length === 0) { alert("لا توجد سجلات لتصديرها."); return; }

    const columns = [
      ["requestedAt", "التاريخ"], ["requestedBy", "الموظف"], ["module", "الموديول"],
      ["changeType", "النوع"], ["targetLabel", "العنصر"], ["diff", "التفاصيل"],
      ["status", "الحالة"], ["reviewedBy", "راجع بواسطة"], ["reviewedAt", "تاريخ المراجعة"],
    ];
    const lines = [columns.map(([, label]) => csvEscape(label)).join(",")];
    rows.forEach((r) => {
      lines.push([
        r.requestedAt, r.requestedBy, AUDIT_MODULE_LABELS[r.module] || r.module,
        AUDIT_CHANGE_TYPE_LABELS[r.changeType] || r.changeType, r.targetLabel, auditDiffText(r),
        AUDIT_STATUS_LABELS[r.status] || r.status, r.reviewedBy || "", r.reviewedAt || "",
      ].map(csvEscape).join(","));
    });
    const csv = "\uFEFF" + lines.join("\r\n"); // BOM so Excel opens Arabic text correctly

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Voyvista-Audit-Log-${getTodayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function initAuditLog() {
    document.getElementById("audit-log-search").addEventListener("input", renderAuditLog);
    document.getElementById("audit-log-module-filter").addEventListener("change", renderAuditLog);
    document.getElementById("audit-log-status-filter").addEventListener("change", renderAuditLog);
    document.getElementById("btn-export-audit-log").addEventListener("click", exportAuditLogToCsv);
    renderAuditLog();
  }

  // -----------------------------------------------------------------------
  // 7) Owner's private files — real localStorage-backed flat list
  // -----------------------------------------------------------------------

  let ownerFiles = JSON.parse(localStorage.getItem("vv_owner_files")) || [];

  function saveOwnerFiles() {
    localStorage.setItem("vv_owner_files", JSON.stringify(ownerFiles));
  }

  function renderOwnerFiles() {
    const list = document.getElementById("owner-files-list");
    if (ownerFiles.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 3v4a1 1 0 0 0 1 1h4M6 21h9a2 2 0 0 0 2-2V7l-5-4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/></svg>
        <p>No files uploaded yet</p>
      </div>`;
      return;
    }
    list.innerHTML = ownerFiles
      .map(
        (f) => `
        <div class="owner-file-row" data-file-id="${f.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3v4a1 1 0 0 0 1 1h4M6 21h9a2 2 0 0 0 2-2V7l-5-4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/></svg>
          <a class="name" href="#" data-open-file="${f.id}" style="text-decoration:underline;">${f.name}</a>
          <button class="remove-btn" data-remove-file="${f.id}" aria-label="Remove file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>`
      )
      .join("");

    list.querySelectorAll("[data-open-file]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const file = ownerFiles.find((f) => String(f.id) === link.dataset.openFile);
        if (file && file.dataUrl) window.open(file.dataUrl, "_blank");
      });
    });
    list.querySelectorAll("[data-remove-file]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ownerFiles = ownerFiles.filter((f) => String(f.id) !== btn.dataset.removeFile);
        saveOwnerFiles();
        renderOwnerFiles();
      });
    });
  }

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  function initOwnerDrive() {
    document.getElementById("btn-open-owner-drive").addEventListener("click", () => {
      openModal("modal-owner-drive");
      renderOwnerFiles();
    });

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("is-open");
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open"));
      }
    });

    const fileInput = document.getElementById("owner-file-input");
    document.getElementById("btn-upload-owner-file").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      let dataUrl = null;
      try { dataUrl = await readFileAsDataUrl(file); } catch (e) { console.error(e); }
      ownerFiles.push({ id: Date.now().toString(), name: file.name, date: getTodayISO(), dataUrl });
      saveOwnerFiles();
      fileInput.value = "";
      renderOwnerFiles();
    });
  }

  // -----------------------------------------------------------------------
  // Entry point — one pass over real data drives everything above
  // -----------------------------------------------------------------------
  function refreshDashboard() {
    const snapshots = DEPARTMENTS.map(getDeptSnapshot);
    renderReportTiles(snapshots);
    renderCharts(snapshots);
    renderSalesReportBalance();
    // renderPendingRequests(snapshots) — temporarily disabled: its
    // section (#owner-pending-list) was removed from owner.html per
    // request. Function still defined above, untouched — just re-enable
    // this line + restore the HTML section whenever it's needed again.
    renderPendingApprovals();
    // renderEmployeeDirectory() — same: #owner-employee-directory was
    // removed from owner.html. Function still intact, safe to re-enable.
    renderAuditLog();
  }

  function initOwnerPage() {
    renderWelcome();
    refreshDashboard();
    document.getElementById("btn-refresh-reports").addEventListener("click", refreshDashboard);
    initOwnerDrive();
    initAuditLog();
    window.addEventListener("storage", refreshDashboard);
  }

  document.addEventListener("DOMContentLoaded", initOwnerPage);
})();