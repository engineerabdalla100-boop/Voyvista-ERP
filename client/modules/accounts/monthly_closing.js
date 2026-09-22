(function () {
  "use strict";

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var MONTH_NAMES_AR = ["", "\u064A\u0646\u0627\u064A\u0631", "\u0641\u0628\u0631\u0627\u064A\u0631", "\u0645\u0627\u0631\u0633", "\u0623\u0628\u0631\u064A\u0644", "\u0645\u0627\u064A\u0648", "\u064A\u0648\u0646\u064A\u0648", "\u064A\u0648\u0644\u064A\u0648", "\u0623\u063A\u0633\u0637\u0633", "\u0633\u0628\u062A\u0645\u0628\u0631", "\u0623\u0643\u062A\u0648\u0628\u0631", "\u0646\u0648\u0641\u0645\u0628\u0631", "\u062F\u064A\u0633\u0645\u0628\u0631"];

  var currentPeriod = null;
  var archiveCache = [];

  document.addEventListener("DOMContentLoaded", function () {
    var now = new Date();
    document.getElementById("mc-year").value = now.getFullYear();
    document.getElementById("mc-month").value = now.getMonth() + 1;

    document.getElementById("btn-load-period")?.addEventListener("click", loadOrOpenPeriod);
    document.getElementById("btn-close-period")?.addEventListener("click", closePeriod);
    document.getElementById("btn-export-closing-pdf")?.addEventListener("click", exportClosingPdf);

    loadArchive();
  });

  async function loadOrOpenPeriod() {
    var year = Number(document.getElementById("mc-year").value);
    var month = Number(document.getElementById("mc-month").value);

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.FINANCIAL_PERIODS + "open_period/", { method: "POST", body: { year: year, month: month } });
      currentPeriod = result.data;
      document.getElementById("period-panel").style.display = "block";
      document.getElementById("btn-export-closing-pdf").style.display = "inline-flex";
      await renderPeriodPanel();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0641\u062A\u062D \u0627\u0644\u0641\u062A\u0631\u0629.");
    }
  }

  async function renderPeriodPanel() {
    var closeBtn = document.getElementById("btn-close-period");
    var lockedIndicator = document.getElementById("locked-indicator");

    var compareResult = null;
    try {
      compareResult = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_PROFIT_LOSS + "?year=" + currentPeriod.year + "&month=" + currentPeriod.month + "&compare_with_previous=true");
    } catch (err) { /* silent */ }

    if (currentPeriod.is_locked) {
      closeBtn.style.display = "none";
      lockedIndicator.style.display = "inline-block";
      renderKpiGrid(currentPeriod, compareResult ? compareResult.data.comparison : null);
      document.getElementById("readiness-panel").innerHTML = "";
      return;
    }

    lockedIndicator.style.display = "none";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.FINANCIAL_PERIOD_DETAIL(currentPeriod.id) + "readiness_check/");
      var readiness = result.data;

      renderKpiGrid({
        total_gross_profit: readiness.preview_gross_profit,
        total_expenses: readiness.preview_total_expenses,
        net_profit: readiness.preview_net_profit,
        pending_receivables: "0",
        pending_payables: "0",
      }, compareResult ? compareResult.data.comparison : null);

      var checklistItems = [
        { label: "\u062D\u062C\u0648\u0632\u0627\u062A \u0645\u0639\u0644\u0651\u0642\u0629 (Pending)", count: readiness.pending_bookings_count },
        { label: "\u0639\u064F\u0647\u062F \u0645\u0641\u062A\u0648\u062D\u0629 \u063A\u064A\u0631 \u0645\u0633\u0648\u0651\u0627\u0629", count: readiness.open_custody_count },
        { label: "\u0641\u0648\u0627\u062A\u064A\u0631 \u063A\u064A\u0631 \u0645\u062D\u0635\u0651\u0644\u0629 \u0628\u0627\u0644\u0643\u0627\u0645\u0644", count: readiness.unpaid_invoices_count },
        { label: "\u0633\u0646\u062F\u0627\u062A \u0642\u0628\u0636/\u0635\u0631\u0641 \u0645\u0633\u0648\u0651\u062F\u0629", count: readiness.draft_vouchers_count },
        { label: "\u0645\u0635\u0631\u0648\u0641\u0627\u062A \u0645\u0633\u0648\u0651\u062F\u0629 \u063A\u064A\u0631 \u0645\u0631\u062D\u0651\u0644\u0629", count: readiness.draft_expenses_count },
      ];

      var panel = document.getElementById("readiness-panel");
      panel.innerHTML = checklistItems.map(function (item) {
        return "<div class=\"readiness-row\"><span>" + item.label + "</span><span class=\"readiness-badge " + (item.count > 0 ? "readiness-badge--blocked" : "readiness-badge--ok") + "\">" + item.count + "</span></div>";
      }).join("");

      closeBtn.style.display = readiness.ready_to_close ? "inline-flex" : "none";
      if (!readiness.ready_to_close) {
        panel.innerHTML += "<p style=\"font-size:12px; color:var(--coral); margin-top:10px;\">\u0644\u0627 \u064A\u0645\u0643\u0646 \u0642\u0641\u0644 \u0627\u0644\u0634\u0647\u0631 \u062D\u0627\u0644\u064A\u0627\u064B -- \u064A\u062C\u0628 \u062A\u0635\u0641\u064A\u0631 \u0643\u0644 \u0627\u0644\u0628\u0646\u0648\u062F \u0623\u0639\u0644\u0627\u0647 \u0623\u0648\u0644\u0627\u064B.</p>";
      }
    } catch (err) {
      document.getElementById("readiness-panel").innerHTML = "<p style=\"font-size:12px; color:var(--coral);\">\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0641\u062D\u0635 \u0627\u0644\u062C\u0627\u0647\u0632\u064A\u0629.</p>";
    }
  }

  function renderKpiGrid(data, comparison) {
    var netProfit = Number(data.net_profit);
    var cards = [
      { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0623\u0631\u0628\u0627\u062D \u0627\u0644\u062A\u0634\u063A\u064A\u0644\u064A\u0629", value: fmtMoney(data.total_gross_profit) },
      { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0635\u0631\u0648\u0641\u0627\u062A", value: fmtMoney(data.total_expenses) },
      { label: "\u0635\u0627\u0641\u064A \u0627\u0644\u0631\u0628\u062D", value: fmtMoney(data.net_profit), cls: netProfit >= 0 ? "is-positive" : "is-negative" },
      { label: "\u0645\u0633\u062A\u062D\u0642\u0627\u062A \u0645\u0639\u0644\u0651\u0642\u0629", value: fmtMoney(data.pending_receivables || 0) },
      { label: "\u062F\u064A\u0648\u0646 \u0642\u0627\u0626\u0645\u0629 \u0644\u0644\u0645\u0648\u0631\u062F\u064A\u0646", value: fmtMoney(data.pending_payables || 0) },
    ];

    document.getElementById("kpi-grid").innerHTML = cards.map(function (c, idx) {
      var deltaHtml = "";
      if (idx === 2 && comparison) {
        var prevNet = Number(comparison.net_profit);
        var diff = netProfit - prevNet;
        var pct = prevNet !== 0 ? ((diff / Math.abs(prevNet)) * 100).toFixed(1) : "0.0";
        deltaHtml = "<div class=\"kpi-card__delta " + (diff >= 0 ? "up" : "down") + "\">" + (diff >= 0 ? "\u2191" : "\u2193") + " " + Math.abs(pct) + "% \u0639\u0646 " + MONTH_NAMES_AR[comparison.month] + "</div>";
      }
      return "<div class=\"kpi-card\"><div class=\"kpi-card__label\">" + c.label + "</div><div class=\"kpi-card__value " + (c.cls || "") + "\">" + c.value + "</div>" + deltaHtml + "</div>";
    }).join("");
  }

  async function closePeriod() {
    if (!currentPeriod) return;
    if (!confirm("\u0642\u0641\u0644 \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631 \u0646\u0647\u0627\u0626\u064A\u0627\u064B\u061F \u0644\u0646 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639 \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621 \u0623\u0648 \u062A\u0639\u062F\u064A\u0644 \u0623\u064A \u0628\u064A\u0627\u0646\u0627\u062A \u0645\u0627\u0644\u064A\u0629 \u062F\u0627\u062E\u0644 \u0647\u0630\u0627 \u0627\u0644\u0634\u0647\u0631 \u0628\u0639\u062F \u0630\u0644\u0643.")) return;

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.FINANCIAL_PERIOD_DETAIL(currentPeriod.id) + "close/", { method: "POST" });
      currentPeriod = result.data;
      alert("\u062A\u0645 \u0642\u0641\u0644 \u0627\u0644\u0634\u0647\u0631 \u0628\u0646\u062C\u0627\u062D.");
      await renderPeriodPanel();
      await loadArchive();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0642\u0641\u0644 \u0627\u0644\u0634\u0647\u0631.");
    }
  }

  async function loadArchive() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.FINANCIAL_PERIODS);
      archiveCache = result.data.results || result.data;
    } catch (err) { archiveCache = []; }
    renderArchiveTable();
  }

  function renderArchiveTable() {
    var tbody = document.getElementById("archive-table-body");
    var table = document.getElementById("archive-table");
    var empty = document.getElementById("archive-empty");

    if (archiveCache.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = archiveCache.map(function (p) {
      return "<tr data-view-period=\"" + p.id + "\">" +
        "<td>" + MONTH_NAMES_AR[p.month] + " " + p.year + "</td>" +
        "<td class=\"num\">" + fmtMoney(p.total_gross_profit) + "</td>" +
        "<td class=\"num\">" + fmtMoney(p.total_expenses) + "</td>" +
        "<td class=\"num\">" + fmtMoney(p.net_profit) + "</td>" +
        "<td><span class=\"status-badge status-badge--" + (p.is_locked ? "locked" : "open") + "\">" + (p.is_locked ? "\u0645\u0642\u0641\u0648\u0644" : "\u0645\u0641\u062A\u0648\u062D") + "</span></td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-view-period]").forEach(function (row) {
      row.addEventListener("click", function () { viewArchivedPeriod(row.dataset.viewPeriod); });
    });
  }

  function viewArchivedPeriod(id) {
    var period = archiveCache.find(function (p) { return String(p.id) === id; });
    if (!period) return;
    currentPeriod = period;
    document.getElementById("mc-year").value = period.year;
    document.getElementById("mc-month").value = period.month;
    document.getElementById("period-panel").style.display = "block";
    document.getElementById("btn-export-closing-pdf").style.display = "inline-flex";
    renderPeriodPanel();
    document.getElementById("period-panel").scrollIntoView({ behavior: "smooth" });
  }

  // =========================================================================
  // PDF Export -- monthly closing document
  // =========================================================================

  function exportClosingPdf() {
    if (!currentPeriod) return;

    var jsPDFLib = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFLib) { alert("PDF library failed to load."); return; }
    var doc = new jsPDFLib();

    doc.setFontSize(18);
    doc.text("Voyvista Travel", 15, 20);
    doc.setFontSize(12);
    doc.text("Monthly Closing Report", 15, 28);

    doc.setFontSize(10);
    var monthLabel = MONTH_NAMES_AR[currentPeriod.month] + " " + currentPeriod.year;
    doc.text("Period: " + currentPeriod.month + "/" + currentPeriod.year, 15, 40);
    doc.text("Status: " + (currentPeriod.is_locked ? "Locked" : "Open"), 15, 47);

    var y = 60;
    var rows = [
      ["Total Gross Profit", fmtMoney(currentPeriod.total_gross_profit || 0)],
      ["Total Expenses", fmtMoney(currentPeriod.total_expenses || 0)],
      ["Net Profit", fmtMoney(currentPeriod.net_profit || 0)],
    ];
    rows.forEach(function (row) {
      doc.text(String(row[0]) + ":", 15, y);
      doc.text(String(row[1]), 90, y);
      y += 8;
    });

    if (currentPeriod.closed_at) {
      y += 6;
      doc.setFontSize(9);
      doc.text("Closed at: " + currentPeriod.closed_at, 15, y);
      doc.text("Closed by: " + (currentPeriod.closed_by_name || "-"), 15, y + 6);
    }

    doc.save("Closing-Report-" + currentPeriod.year + "-" + currentPeriod.month + ".pdf");
  }
})();