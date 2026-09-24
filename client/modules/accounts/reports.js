(function () {
  "use strict";

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .split(String.fromCharCode(39)).join("&#039;");
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var DEPT_LABELS_AR = { flight: "طيران", hotel: "فنادق", visa: "تأشيرات" };
  var EVENT_LABELS_AR = {
    accounting_posted: "ترحيل قيد", accounting_reversed: "عكس قيد", period_closed: "قفل شهر",
    invoice_issued: "إصدار فاتورة", invoice_credited: "إشعار دائن",
  };

  document.addEventListener("DOMContentLoaded", function () {
    var now = new Date();
    document.getElementById("pl-year").value = now.getFullYear();
    document.getElementById("pl-month").value = now.getMonth() + 1;
    document.getElementById("dept-year").value = now.getFullYear();
    document.getElementById("dept-month").value = now.getMonth() + 1;

    document.querySelectorAll("[data-report-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll("[data-report-tab]").forEach(function (t) { t.classList.remove("is-active"); });
        document.querySelectorAll(".report-view").forEach(function (v) { v.classList.remove("is-active"); });
        tab.classList.add("is-active");
        document.getElementById("view-" + tab.dataset.reportTab).classList.add("is-active");
      });
    });

    document.getElementById("btn-load-pl")?.addEventListener("click", loadProfitLoss);
    document.getElementById("btn-load-dept")?.addEventListener("click", loadDepartmentPerformance);
    document.getElementById("btn-load-ledger")?.addEventListener("click", loadLedger);
    document.getElementById("btn-load-trial-balance")?.addEventListener("click", loadTrialBalance);
    document.getElementById("btn-load-audit")?.addEventListener("click", loadAuditLog);

    loadAccountsForLedger();
    loadProfitLoss();
    loadDepartmentPerformance();
    loadTrialBalance();
    loadAuditLog();
  });

  // =========================================================================
  // P&L
  // =========================================================================

  async function loadProfitLoss() {
    var year = document.getElementById("pl-year").value;
    var month = document.getElementById("pl-month").value;
    var panel = document.getElementById("pl-panel");
    panel.innerHTML = "<p style=\"font-size:12px; color:var(--text-faint);\">جارِ التحميل...</p>";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_PROFIT_LOSS + "?year=" + year + "&month=" + month);
      var data = result.data;
      var sourceLabel = data.source === "archived" ? "(من الأرشيف المقفول)" : "(حساب مباشر -- الشهر لسه مفتوح)";

      var deptLines = "";
      if (data.profit_by_department) {
        deptLines = Object.keys(data.profit_by_department).map(function (key) {
          return "<div class=\"pl-line\"><span>(+) أرباح " + (DEPT_LABELS_AR[key] || key) + "</span><span>" + fmtMoney(data.profit_by_department[key]) + "</span></div>";
        }).join("");
      }

      panel.innerHTML =
        "<p style=\"font-size:11px; color:var(--text-faint); margin-bottom:14px;\">" + sourceLabel + "</p>" +
        deptLines +
        "<div class=\"pl-line total\"><span>(=) إجمالي الربح المجمل</span><span>" + fmtMoney(data.gross_profit) + "</span></div>" +
        "<div class=\"pl-line\" style=\"color:var(--coral);\"><span>(-) إجمالي المصروفات</span><span>" + fmtMoney(data.total_expenses) + "</span></div>" +
        "<div class=\"pl-line total\"><span>(=) صافي الربح</span><span>" + fmtMoney(data.net_profit) + "</span></div>";
    } catch (err) {
      panel.innerHTML = "<p style=\"font-size:12px; color:var(--coral);\">" + escapeHtml(err.message || "فشل تحميل التقرير.") + "</p>";
    }
  }

  // =========================================================================
  // Department Performance
  // =========================================================================

  async function loadDepartmentPerformance() {
    var year = document.getElementById("dept-year").value;
    var month = document.getElementById("dept-month").value;
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_DEPARTMENT_PERFORMANCE + "?year=" + year + "&month=" + month);
      var rows = result.data.departments || [];
      document.getElementById("dept-table-body").innerHTML = rows.map(function (r) {
        return "<tr>" +
          "<td>" + (DEPT_LABELS_AR[r.department] || r.label) + "</td>" +
          "<td class=\"num\">" + r.booking_count + "</td>" +
          "<td class=\"num\">" + fmtMoney(r.total_selling_rate) + "</td>" +
          "<td class=\"num\">" + fmtMoney(r.total_net_rate) + "</td>" +
          "<td class=\"num\">" + fmtMoney(r.profit) + "</td>" +
          "<td class=\"num\">" + r.profit_percentage + "%</td>" +
        "</tr>";
      }).join("");
    } catch (err) {
      document.getElementById("dept-table-body").innerHTML = "";
    }
  }

  // =========================================================================
  // Ledger
  // =========================================================================

  async function loadAccountsForLedger() {
    try {
      var accounts = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA);
      document.getElementById("ledger-account").innerHTML = accounts.map(function (a) {
        return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>";
      }).join("");
    } catch (err) { /* silent */ }
  }

  async function loadLedger() {
    var accountId = document.getElementById("ledger-account").value;
    if (!accountId) { alert("اختر حسابًا أولًا."); return; }

    var dateFrom = document.getElementById("ledger-date-from").value;
    var dateTo = document.getElementById("ledger-date-to").value;
    var query = "?account_id=" + accountId;
    if (dateFrom) query += "&date_from=" + dateFrom;
    if (dateTo) query += "&date_to=" + dateTo;

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_LEDGER + query);
      var rows = result.data.lines || [];
      var tbody = document.getElementById("ledger-table-body");
      var table = document.getElementById("ledger-table");
      var empty = document.getElementById("ledger-empty");

      if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
      table.style.display = "table";
      empty.style.display = "none";

      tbody.innerHTML = rows.map(function (l) {
        return "<tr>" +
          "<td>" + escapeHtml(l.date) + "</td>" +
          "<td class=\"mono\">" + escapeHtml(l.entry_number) + "</td>" +
          "<td>" + escapeHtml(l.description) + (l.memo ? " -- " + escapeHtml(l.memo) : "") + "</td>" +
          "<td class=\"num\">" + (Number(l.debit) > 0 ? fmtMoney(l.debit) : "-") + "</td>" +
          "<td class=\"num\">" + (Number(l.credit) > 0 ? fmtMoney(l.credit) : "-") + "</td>" +
          "<td class=\"num\">" + fmtMoney(l.running_balance) + "</td>" +
        "</tr>";
      }).join("");
    } catch (err) {
      alert(err.message || "فشل تحميل كشف الحساب.");
    }
  }

  // =========================================================================
  // Trial Balance
  // =========================================================================

  async function loadTrialBalance() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_TRIAL_BALANCE);
      var data = result.data;
      document.getElementById("trial-balance-status").innerHTML =
        "<span class=\"balanced-chip balanced-chip--" + (data.is_balanced ? "yes" : "no") + "\">" +
        (data.is_balanced ? "الدفاتر متوازنة ✓" : "⚠ الدفاتر غير متوازنة") + "</span>";

      document.getElementById("trial-balance-table-body").innerHTML = (data.accounts || []).map(function (a) {
        return "<tr>" +
          "<td class=\"mono\">" + escapeHtml(a.code) + "</td>" +
          "<td>" + escapeHtml(a.name) + "</td>" +
          "<td class=\"num\">" + (Number(a.debit) > 0 ? fmtMoney(a.debit) : "-") + "</td>" +
          "<td class=\"num\">" + (Number(a.credit) > 0 ? fmtMoney(a.credit) : "-") + "</td>" +
        "</tr>";
      }).join("") +
      "<tr style=\"font-weight:800; background:var(--canvas);\"><td colspan=\"2\">الإجمالي</td><td class=\"num\">" + fmtMoney(data.total_debit) + "</td><td class=\"num\">" + fmtMoney(data.total_credit) + "</td></tr>";
    } catch (err) {
      alert(err.message || "فشل تحميل ميزان المراجعة.");
    }
  }

  // =========================================================================
  // Audit Log
  // =========================================================================

  async function loadAuditLog() {
    var eventType = document.getElementById("audit-event-type").value;
    var query = eventType ? "?event_type=" + eventType : "";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_AUDIT_LOG + query);
      var rows = result.data.results || [];
      document.getElementById("audit-table-body").innerHTML = rows.map(function (e) {
        var dt = new Date(e.created_at).toLocaleString("ar-EG");
        return "<tr>" +
          "<td>" + dt + "</td>" +
          "<td>" + escapeHtml(e.actor || "-") + "</td>" +
          "<td>" + (EVENT_LABELS_AR[e.event_type] || e.event_type) + "</td>" +
          "<td>" + escapeHtml(e.entity_type) + " #" + escapeHtml(e.entity_id || "-") + "</td>" +
          "<td>" + escapeHtml(e.description) + "</td>" +
        "</tr>";
      }).join("");
    } catch (err) {
      alert(err.message || "فشل تحميل سجل التدقيق.");
    }
  }
})();
