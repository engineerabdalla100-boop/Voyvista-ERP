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
  function todayISO() { return new Date().toISOString().split("T")[0]; }
  function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

  var STATUS_LABELS = { draft: "\u0645\u0633\u0648\u0651\u062F\u0629", issued: "\u0635\u0627\u062F\u0631\u0629", credited: "\u0645\u064F\u0644\u063A\u0627\u0629 (\u0628\u0625\u0634\u0639\u0627\u0631 \u062F\u0627\u0626\u0646)" };

  var accountsCache = [];
  var partiesCache = [];
  var invoicesCache = [];
  var activeCreditInvoiceId = null;
  var activeIssueInvoiceId = null;

  document.addEventListener("DOMContentLoaded", function () {
    loadAccounts();
    loadParties();
    loadInvoices();

    document.getElementById("btn-open-add-invoice")?.addEventListener("click", function () { openModal("modal-add-invoice"); resetInvoiceForm(); });
    document.getElementById("btn-save-invoice")?.addEventListener("click", saveInvoice);
    document.getElementById("btn-confirm-issue")?.addEventListener("click", confirmIssue);
    document.getElementById("btn-confirm-credit-reissue")?.addEventListener("click", confirmCreditReissue);
    document.getElementById("invoice-search")?.addEventListener("input", renderInvoicesTable);
    document.getElementById("btn-export-invoices")?.addEventListener("click", exportInvoicesCsv);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
  });

  // =========================================================================
  // Shared lookups
  // =========================================================================

  async function loadAccounts() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA);
      accountsCache = result.data.results || result.data;
      var options = function (list) { return list.map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; }).join(""); };
      document.getElementById("issue-ar-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "asset"; }));
      document.getElementById("issue-revenue-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "revenue"; }));
    } catch (err) { /* silent */ }
  }

  async function loadParties() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.PARTIES);
      partiesCache = result.data.results || result.data;
      document.getElementById("inv-party").innerHTML = partiesCache.map(function (p) {
        return "<option value=\"" + p.id + "\">" + escapeHtml(p.full_name) + " (" + escapeHtml(p.code) + ")</option>";
      }).join("");
    } catch (err) { /* silent */ }
  }

  // =========================================================================
  // Invoices
  // =========================================================================

  async function loadInvoices() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.INVOICES);
      invoicesCache = result.data.results || result.data;
    } catch (err) { invoicesCache = []; }
    renderInvoicesTable();
  }

  function renderInvoicesTable() {
    var query = (document.getElementById("invoice-search").value || "").trim().toLowerCase();
    var rows = invoicesCache.filter(function (inv) {
      return !query || (inv.number || "").toLowerCase().includes(query);
    });

    var tbody = document.getElementById("invoices-table-body");
    var table = document.getElementById("invoices-table");
    var empty = document.getElementById("invoices-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (inv) {
      return "<tr>" +
        "<td class=\"mono\">" + escapeHtml(inv.number) + "</td>" +
        "<td>" + escapeHtml(inv.date) + "</td>" +
        "<td>" + escapeHtml(inv.party_name) + "</td>" +
        "<td class=\"num\">" + fmtMoney(inv.total_amount) + "</td>" +
        "<td><span class=\"status-badge status-badge--" + inv.status + "\">" + STATUS_LABELS[inv.status] + "</span></td>" +
        "<td>" + invoiceActionsHtml(inv) + "</td>" +
      "</tr>";
    }).join("");

    wireInvoiceActions();
  }

  function invoiceActionsHtml(inv) {
    var html = "<button class=\"btn-print\" data-invoice-pdf=\"" + inv.id + "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M7 3h8l4 4v14H7z\"/><path d=\"M15 3v4h4\"/></svg>PDF</button>";
    if (inv.status === "draft") {
      html += "<button class=\"btn-workflow-next\" data-invoice-issue=\"" + inv.id + "\">\u0625\u0635\u062F\u0627\u0631</button>";
      html += "<button class=\"row-action-btn\" data-invoice-delete=\"" + inv.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    }
    if (inv.status === "issued") {
      html += "<button class=\"btn-workflow-next\" data-invoice-credit=\"" + inv.id + "\">\u0625\u0634\u0639\u0627\u0631 \u062F\u0627\u0626\u0646</button>";
    }
    return html;
  }

  function wireInvoiceActions() {
    document.querySelectorAll("[data-invoice-issue]").forEach(function (btn) {
      btn.addEventListener("click", function () { openIssueModal(btn.dataset.invoiceIssue); });
    });
    document.querySelectorAll("[data-invoice-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteInvoice(btn.dataset.invoiceDelete); });
    });
    document.querySelectorAll("[data-invoice-credit]").forEach(function (btn) {
      btn.addEventListener("click", function () { openCreditModal(btn.dataset.invoiceCredit); });
    });
    document.querySelectorAll("[data-invoice-pdf]").forEach(function (btn) {
      btn.addEventListener("click", function () { generateInvoicePdf(btn.dataset.invoicePdf); });
    });
  }

  function openIssueModal(id) {
    activeIssueInvoiceId = id;
    openModal("modal-issue-invoice");
  }

  async function confirmIssue() {
    if (!activeIssueInvoiceId) return;
    var arAccount = document.getElementById("issue-ar-account").value;
    var revenueAccount = document.getElementById("issue-revenue-account").value;
    if (!arAccount || !revenueAccount) {
      alert("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 \u0630\u0645\u0645 \u0627\u0644\u0639\u0645\u0644\u0627\u0621 \u0648\u062D\u0633\u0627\u0628 \u0627\u0644\u0625\u064A\u0631\u0627\u062F\u0627\u062A \u0623\u0648\u0644\u0627\u064B.");
      return;
    }
    if (!confirm("\u0625\u0635\u062F\u0627\u0631 \u0647\u0630\u0647 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629\u061F \u0644\u0646 \u064A\u0645\u0643\u0646 \u062A\u0639\u062F\u064A\u0644\u0647\u0627 \u0628\u0639\u062F \u0630\u0644\u0643.")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.INVOICE_DETAIL(activeIssueInvoiceId) + "issue/", {
        method: "POST", body: { ar_account: arAccount, revenue_account: revenueAccount },
      });
      closeModal("modal-issue-invoice");
      activeIssueInvoiceId = null;
      await loadInvoices();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0625\u0635\u062F\u0627\u0631 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.");
    }
  }

  async function deleteInvoice(id) {
    if (!confirm("\u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u0651\u062F\u0629 \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.INVOICE_DETAIL(id), { method: "DELETE" });
      await loadInvoices();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.");
    }
  }

  function openCreditModal(id) {
    activeCreditInvoiceId = id;
    document.getElementById("cr-new-amount").value = "0";
    document.getElementById("cr-description").value = "";
    openModal("modal-credit-reissue");
  }

  async function confirmCreditReissue() {
    if (!activeCreditInvoiceId) return;
    var newAmount = document.getElementById("cr-new-amount").value;
    var description = document.getElementById("cr-description").value.trim();
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.INVOICE_DETAIL(activeCreditInvoiceId) + "credit_and_reissue/", {
        method: "POST", body: { new_amount: newAmount, description: description },
      });
      closeModal("modal-credit-reissue");
      activeCreditInvoiceId = null;
      await loadInvoices();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0625\u0635\u062F\u0627\u0631 \u0625\u0634\u0639\u0627\u0631 \u0627\u0644\u062F\u0627\u0626\u0646.");
    }
  }

  function resetInvoiceForm() {
    document.getElementById("inv-date").value = todayISO();
    document.getElementById("inv-amount").value = "0";
    document.getElementById("inv-booking-ref").value = "";
    document.getElementById("inv-description").value = "";
  }

  async function saveInvoice() {
    var payload = {
      date: document.getElementById("inv-date").value,
      party: document.getElementById("inv-party").value,
      total_amount: document.getElementById("inv-amount").value,
      booking_reference: document.getElementById("inv-booking-ref").value.trim(),
      description: document.getElementById("inv-description").value.trim(),
    };

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.INVOICES, { method: "POST", body: payload });
      closeModal("modal-add-invoice");
      await loadInvoices();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0641\u0627\u062A\u0648\u0631\u0629.");
    }
  }

  // =========================================================================
  // PDF Generation -- works for a Draft or Issued invoice, any time
  // =========================================================================

  function generateInvoicePdf(id) {
    var invoice = invoicesCache.find(function (inv) { return String(inv.id) === id; });
    if (!invoice) return;

    var jsPDFLib = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFLib) { alert("PDF library failed to load."); return; }
    var doc = new jsPDFLib();

    doc.setFontSize(18);
    doc.text("Voyvista Travel", 15, 20);
    doc.setFontSize(11);
    doc.text("Invoice / " + invoice.number, 15, 28);

    doc.setFontSize(10);
    var y = 45;
    var rows = [
      ["Invoice Number", invoice.number],
      ["Date", invoice.date],
      ["Customer", invoice.party_name || "-"],
      ["Description", invoice.description || "-"],
      ["Booking Reference", invoice.booking_reference || "-"],
      ["Status", STATUS_LABELS[invoice.status] || invoice.status],
    ];
    rows.forEach(function (row) {
      doc.text(String(row[0]) + ":", 15, y);
      doc.text(String(row[1]), 70, y);
      y += 8;
    });

    y += 6;
    doc.setFontSize(13);
    doc.text("Total: " + fmtMoney(invoice.total_amount), 15, y);

    doc.save("Invoice-" + invoice.number + ".pdf");
  }

  // =========================================================================
  // CSV Export
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportInvoicesCsv() {
    var query = (document.getElementById("invoice-search").value || "").trim().toLowerCase();
    var rows = invoicesCache.filter(function (inv) { return !query || (inv.number || "").toLowerCase().includes(query); });
    if (rows.length === 0) { alert("\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0644\u062A\u0635\u062F\u064A\u0631\u0647\u0627."); return; }

    var lines = [["\u0627\u0644\u0631\u0642\u0645", "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", "\u0627\u0644\u0639\u0645\u064A\u0644", "\u0627\u0644\u0625\u062C\u0645\u0627\u0644\u064A", "\u0627\u0644\u062D\u0627\u0644\u0629"].map(csvEscape).join(",")];
    rows.forEach(function (inv) {
      lines.push([inv.number, inv.date, inv.party_name, inv.total_amount, STATUS_LABELS[inv.status]].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Invoices-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
})();