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
  var readFileAsDataUrl = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  var STATUS_LABELS = { draft: "\u0645\u0633\u0648\u0651\u062F\u0629", submitted: "\u0645\u064F\u0642\u062F\u064E\u0651\u0645", approved: "\u0645\u0639\u062A\u0645\u062F", posted: "\u0645\u064F\u0631\u062D\u064E\u0651\u0644", settled: "\u0645\u0633\u0648\u0651\u0649" };
  var NEXT_ACTION = { draft: "submit", submitted: "approve", approved: "post_expense" };
  var NEXT_ACTION_LABEL = { draft: "\u0625\u0631\u0633\u0627\u0644", submitted: "\u0627\u0639\u062A\u0645\u0627\u062F", approved: "\u062A\u0631\u062D\u064A\u0644" };
  var PAYMENT_METHOD_LABELS_AR = { cash: "\u0646\u0642\u062F\u064A", bank: "\u0628\u0646\u0643\u064A", custody: "\u0639\u0647\u062F\u0629" };

  var accountsCache = [];
  var expensesCache = [];
  var custodyCache = [];
  var employeesCache = [];
  var templatesCache = [];
  var pendingAttachment = null;
  var payrollRowCounter = 0;

  document.addEventListener("DOMContentLoaded", function () {
    loadAccounts();
    loadEmployees();
    loadExpenses();
    loadCustody();
    loadTemplates();

    document.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll("[data-tab]").forEach(function (t) { t.classList.remove("is-active"); });
        document.querySelectorAll(".tab-view").forEach(function (v) { v.classList.remove("is-active"); });
        tab.classList.add("is-active");
        document.getElementById("tab-" + tab.dataset.tab).classList.add("is-active");
      });
    });

    document.getElementById("btn-open-add-expense")?.addEventListener("click", function () { openModal("modal-add-expense"); resetExpenseForm(); });
    document.getElementById("btn-open-add-custody")?.addEventListener("click", function () { openModal("modal-add-custody"); resetCustodyForm(); });
    document.getElementById("btn-open-add-template")?.addEventListener("click", function () { openModal("modal-add-template"); resetTemplateForm(); });
    document.getElementById("btn-save-expense-draft")?.addEventListener("click", function () { saveExpense(false); });
    document.getElementById("btn-confirm-post-expense")?.addEventListener("click", function () { saveExpense(true); });
    document.getElementById("btn-save-custody")?.addEventListener("click", saveCustody);
    document.getElementById("btn-save-template")?.addEventListener("click", saveTemplate);
    document.getElementById("btn-post-month")?.addEventListener("click", postMonth);
    document.getElementById("btn-add-payroll-row")?.addEventListener("click", addPayrollRow);
    document.getElementById("btn-post-payroll")?.addEventListener("click", postPayroll);
    document.getElementById("expense-search")?.addEventListener("input", renderExpensesTable);
    document.getElementById("expense-filter-date")?.addEventListener("change", renderExpensesTable);
    document.getElementById("custody-search")?.addEventListener("input", renderCustodyTable);
    document.getElementById("ex-payment-method")?.addEventListener("change", toggleExpenseAccountFields);
    document.getElementById("btn-export-expenses")?.addEventListener("click", exportExpensesCsv);

    document.getElementById("ex-attachment")?.addEventListener("change", async function (e) {
      var file = e.target.files[0];
      if (!file) { pendingAttachment = null; return; }
      try {
        var dataUrl = await readFileAsDataUrl(file);
        pendingAttachment = { name: file.name, dataUrl: dataUrl };
        document.getElementById("ex-attachment-preview").innerHTML = "\uD83D\uDCCE " + escapeHtml(file.name);
      } catch (err) {
        pendingAttachment = null;
      }
    });

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
      accountsCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA);
      populateAccountSelects();
      populateAccountSelects();
    } catch (err) { /* silent */ }
  }

  async function loadEmployees() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEES);
      employeesCache = result.data.results || result.data;
      var select = document.getElementById("cu-employee");
      if (select) select.innerHTML = employeesCache.map(function (e) { return "<option value=\"" + e.id + "\">" + escapeHtml(e.full_name) + "</option>"; }).join("");
    } catch (err) { /* silent */ }
  }

  function populateAccountSelects() {
    var treasuryAccounts = accountsCache.filter(function (a) { return a.type === "asset"; });
    var expenseAccounts = accountsCache.filter(function (a) { return a.type === "expense"; });
    var options = function (list) { return list.map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; }).join(""); };

    ["ex-treasury-account", "cu-treasury-account", "tpl-treasury-account", "payroll-treasury-account"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = options(treasuryAccounts);
    });
    ["ex-expense-account", "tpl-expense-account", "payroll-expense-account"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = options(expenseAccounts);
    });
    var cuCustody = document.getElementById("cu-custody-account");
    if (cuCustody) cuCustody.innerHTML = options(treasuryAccounts);
    var exVat = document.getElementById("ex-vat-account");
    if (exVat) exVat.innerHTML = "<option value=\"\">-- \u0628\u062F\u0648\u0646 --</option>" + options(treasuryAccounts);
  }

  function toggleExpenseAccountFields() {
    var method = document.getElementById("ex-payment-method").value;
    var isCustody = method === "custody";
    document.getElementById("ex-treasury-field").style.display = isCustody ? "none" : "flex";
    document.getElementById("ex-custody-field").style.display = isCustody ? "flex" : "none";
    if (isCustody) {
      var openCustody = custodyCache.filter(function (c) { return c.status === "posted"; });
      var select = document.getElementById("ex-custody");
      select.innerHTML = openCustody.length
        ? openCustody.map(function (c) { return "<option value=\"" + c.id + "\">" + escapeHtml(c.number) + " -- " + escapeHtml(c.employee_name) + "</option>"; }).join("")
        : "<option value=\"\">-- \u0644\u0627 \u062A\u0648\u062C\u062F \u0639\u064F\u0647\u062F \u0645\u0641\u062A\u0648\u062D\u0629 --</option>";
    }
  }

  // =========================================================================
  // KPI Cards
  // =========================================================================

  function renderKpiCards() {
    var now = new Date();
    var monthPrefix = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    var thisMonthTotal = expensesCache
      .filter(function (e) { return e.status === "posted" && (e.date || "").startsWith(monthPrefix); })
      .reduce(function (sum, e) { return sum + Number(e.amount); }, 0);

    var openCustody = custodyCache.filter(function (c) { return c.status === "posted"; });
    var todayStr = todayISO();
    var overdueCount = openCustody.filter(function (c) { return c.due_date && c.due_date < todayStr; }).length;

    var cards = [
      { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0634\u0647\u0631 \u0627\u0644\u062D\u0627\u0644\u064A", value: fmtMoney(thisMonthTotal) },
      { label: "\u0639\u064F\u0647\u062F \u0645\u0641\u062A\u0648\u062D\u0629 \u063A\u064A\u0631 \u0645\u0635\u0641\u0627\u0629", value: String(openCustody.length) },
      { label: "\u0639\u064F\u0647\u062F \u0645\u062A\u0623\u062E\u0631\u0629 \u0639\u0646 \u0627\u0644\u062A\u0635\u0641\u064A\u0629", value: String(overdueCount), warning: overdueCount > 0 },
    ];

    document.getElementById("kpi-grid").innerHTML = cards.map(function (c) {
      return "<div class=\"kpi-card\"><div class=\"kpi-card__label\">" + c.label + "</div><div class=\"kpi-card__value" + (c.warning ? " is-warning" : "") + "\">" + c.value + "</div></div>";
    }).join("");
  }

  // =========================================================================
  // Ad-hoc Expenses
  // =========================================================================

  async function loadExpenses() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSES_ACC);
      expensesCache = result.data.results || result.data;
    } catch (err) { expensesCache = []; }
    renderExpensesTable();
    renderKpiCards();
  }

  function renderExpensesTable() {
    var query = (document.getElementById("expense-search").value || "").trim().toLowerCase();
    var dateFilter = document.getElementById("expense-filter-date").value;
    var rows = expensesCache.filter(function (e) {
      var matchesQuery = !query || (e.category || "").toLowerCase().includes(query) || (e.description || "").toLowerCase().includes(query);
      var matchesDate = !dateFilter || e.date === dateFilter;
      return matchesQuery && matchesDate;
    });

    var tbody = document.getElementById("expenses-table-body");
    var table = document.getElementById("expenses-table");
    var empty = document.getElementById("expenses-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (e) {
      return "<tr>" +
        "<td>" + escapeHtml(e.date) + "</td>" +
        "<td>" + escapeHtml(e.category) + "</td>" +
        "<td>" + escapeHtml(e.description) + "</td>" +
        "<td>" + escapeHtml(e.booking_reference || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(e.amount) + " " + escapeHtml(e.currency || "EGP") + "</td>" +
        "<td>" + (PAYMENT_METHOD_LABELS_AR[e.payment_method] || escapeHtml(e.payment_method)) + "</td>" +
        "<td>" + (e.attachment_name ? "<a href=\"#\" data-view-attachment=\"" + e.id + "\">\uD83D\uDCCE " + escapeHtml(e.attachment_name) + "</a>" : "\u2014") + "</td>" +
        "<td><span class=\"status-badge status-badge--" + e.status + "\">" + STATUS_LABELS[e.status] + "</span></td>" +
        "<td>" + expenseActionsHtml(e) + "</td>" +
      "</tr>";
    }).join("");

    wireExpenseActions();
  }

  function expenseActionsHtml(e) {
    var html = "";
    if (e.status === "draft") {
      html += "<button class=\"btn-confirm-post\" data-expense-confirm-post=\"" + e.id + "\">\u062A\u0623\u0643\u064A\u062F \u0648\u0635\u0631\u0641 \u0641\u0648\u0631\u064B\u0627</button>";
    }
    var nextAction = NEXT_ACTION[e.status];
    if (nextAction) {
      html += "<button class=\"btn-workflow-next\" data-expense-advance=\"" + e.id + "\" data-action=\"" + nextAction + "\">" + NEXT_ACTION_LABEL[e.status] + "</button>";
    }
    if (e.status === "draft") {
      html += "<button class=\"row-action-btn is-danger\" data-expense-delete=\"" + e.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    }
    if (e.status === "posted") {
      html += "<button class=\"row-action-btn\" data-expense-reverse=\"" + e.id + "\" title=\"\u0639\u0643\u0633\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 7v6h6\"/><path d=\"M3 13a9 9 0 1 0 3-6.7L3 9\"/></svg></button>";
    }
    return html;
  }

  function wireExpenseActions() {
    document.querySelectorAll("[data-expense-advance]").forEach(function (btn) {
      btn.addEventListener("click", function () { advanceExpense(btn.dataset.expenseAdvance, btn.dataset.action); });
    });
    document.querySelectorAll("[data-expense-confirm-post]").forEach(function (btn) {
      btn.addEventListener("click", function () { confirmPostExisting(btn.dataset.expenseConfirmPost); });
    });
    document.querySelectorAll("[data-expense-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteExpense(btn.dataset.expenseDelete); });
    });
    document.querySelectorAll("[data-expense-reverse]").forEach(function (btn) {
      btn.addEventListener("click", function () { reverseExpense(btn.dataset.expenseReverse); });
    });
    document.querySelectorAll("[data-view-attachment]").forEach(function (link) {
      link.addEventListener("click", function (evt) {
        evt.preventDefault();
        var expense = expensesCache.find(function (e) { return String(e.id) === link.dataset.viewAttachment; });
        if (expense && expense.attachment_data) window.open(expense.attachment_data, "_blank");
      });
    });
  }

  async function advanceExpense(id, action) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSE_DETAIL(id) + action + "/", { method: "POST" });
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0645\u0635\u0631\u0648\u0641.");
    }
  }

  async function confirmPostExisting(id) {
    if (!confirm("\u062A\u0623\u0643\u064A\u062F \u0648\u0635\u0631\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0635\u0631\u0648\u0641 \u0641\u0648\u0631\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSE_DETAIL(id) + "confirm_and_post/", { method: "POST" });
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0635\u0631\u0641.");
    }
  }

  async function deleteExpense(id) {
    if (!confirm("\u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u0651\u062F\u0629 \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSE_DETAIL(id), { method: "DELETE" });
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0645\u0635\u0631\u0648\u0641.");
    }
  }

  async function reverseExpense(id) {
    if (!confirm("\u0639\u0643\u0633 \u0647\u0630\u0627 \u0627\u0644\u0645\u0635\u0631\u0648\u0641 \u0627\u0644\u0645\u064F\u0631\u062D\u064E\u0651\u0644\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSE_DETAIL(id) + "reverse/", { method: "POST" });
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0639\u0643\u0633 \u0627\u0644\u0645\u0635\u0631\u0648\u0641.");
    }
  }

  function resetExpenseForm() {
    document.getElementById("ex-date").value = todayISO();
    document.getElementById("ex-category").value = "";
    document.getElementById("ex-amount").value = "0";
    document.getElementById("ex-currency").value = "EGP";
    document.getElementById("ex-exchange-rate").value = "1";
    document.getElementById("ex-invoice-number").value = "";
    document.getElementById("ex-booking-ref").value = "";
    document.getElementById("ex-payment-method").value = "cash";
    document.getElementById("ex-vat-amount").value = "0";
    document.getElementById("ex-vat-account").value = "";
    document.getElementById("ex-description").value = "";
    document.getElementById("ex-attachment").value = "";
    document.getElementById("ex-attachment-preview").innerHTML = "";
    pendingAttachment = null;
    toggleExpenseAccountFields();
  }

  async function saveExpense(confirmAndPost) {
    var paymentMethod = document.getElementById("ex-payment-method").value;
    var payload = {
      date: document.getElementById("ex-date").value,
      category: document.getElementById("ex-category").value.trim(),
      amount: document.getElementById("ex-amount").value,
      currency: document.getElementById("ex-currency").value,
      exchange_rate: document.getElementById("ex-exchange-rate").value,
      payment_method: paymentMethod,
      expense_account: document.getElementById("ex-expense-account").value,
      invoice_number: document.getElementById("ex-invoice-number").value.trim(),
      booking_reference: document.getElementById("ex-booking-ref").value.trim(),
      description: document.getElementById("ex-description").value.trim(),
      vat_amount: document.getElementById("ex-vat-amount").value || "0",
    };
    var vatAccount = document.getElementById("ex-vat-account").value;
    if (vatAccount) payload.vat_account = vatAccount;
    if (paymentMethod === "custody") {
      payload.custody = document.getElementById("ex-custody").value;
    } else {
      payload.treasury_account = document.getElementById("ex-treasury-account").value;
    }
    if (pendingAttachment) {
      payload.attachment_name = pendingAttachment.name;
      payload.attachment_data = pendingAttachment.dataUrl;
    }

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSES_ACC, { method: "POST", body: payload });
      if (confirmAndPost) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.EXPENSE_DETAIL(result.data.id) + "confirm_and_post/", { method: "POST" });
      }
      closeModal("modal-add-expense");
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0645\u0635\u0631\u0648\u0641.");
    }
  }

  // =========================================================================
  // Recurring Expense Templates
  // =========================================================================

  async function loadTemplates() {
    try {
      templatesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.RECURRING_EXPENSES + "?active_only=true");
    } catch (err) { templatesCache = []; }
    renderTemplatesTable();
  }

  function renderTemplatesTable() {
    var tbody = document.getElementById("recurring-table-body");
    var table = document.getElementById("recurring-table");
    var empty = document.getElementById("recurring-empty");

    if (templatesCache.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = templatesCache.map(function (t) {
      return "<tr>" +
        "<td>" + escapeHtml(t.name) + "</td>" +
        "<td>" + escapeHtml(t.category) + "</td>" +
        "<td class=\"num\"><input type=\"number\" min=\"0\" step=\"0.01\" class=\"inline-amount\" data-template-amount=\"" + t.id + "\" value=\"" + t.default_amount + "\" /></td>" +
        "<td>" + escapeHtml(t.treasury_account_name) + "</td>" +
        "<td><span class=\"status-badge status-badge--posted\">\u0646\u0634\u0637</span></td>" +
        "<td><button class=\"btn-workflow-next\" data-template-post=\"" + t.id + "\">\u0635\u0631\u0641</button><button class=\"row-action-btn is-danger\" data-template-deactivate=\"" + t.id + "\" title=\"\u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0628\u0646\u062F\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button></td>" +
      "</tr>";
    }).join("");

    document.querySelectorAll("[data-template-post]").forEach(function (btn) {
      btn.addEventListener("click", function () { postSingleTemplate(btn.dataset.templatePost); });
    });
    document.querySelectorAll("[data-template-deactivate]").forEach(function (btn) {
      btn.addEventListener("click", function () { deactivateTemplate(btn.dataset.templateDeactivate); });
    });
  }

  async function postSingleTemplate(id) {
    var template = templatesCache.find(function (t) { return String(t.id) === id; });
    if (!template) return;
    var input = document.querySelector("[data-template-amount=\"" + id + "\"]");
    var amount = input ? input.value : template.default_amount;

    if (!confirm("\u0635\u0631\u0641 \u0628\u0646\u062F \"" + template.name + "\" \u0628\u0642\u064A\u0645\u0629 " + fmtMoney(amount) + "\u061F")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.RECURRING_EXPENSES + "post_month/", {
        method: "POST", body: { lines: [{ template_id: template.id, amount: amount, date: todayISO() }] },
      });
      await loadExpenses();
      alert("\u062A\u0645 \u0635\u0631\u0641 \"" + template.name + "\" \u0628\u0646\u062C\u0627\u062D.");
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0635\u0631\u0641 \u0627\u0644\u0628\u0646\u062F.");
    }
  }

  async function deactivateTemplate(id) {
    if (!confirm("\u0625\u064A\u0642\u0627\u0641 \u0647\u0630\u0627 \u0627\u0644\u0628\u0646\u062F \u0627\u0644\u062B\u0627\u0628\u062A\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.RECURRING_EXPENSE_DETAIL(id), { method: "PATCH", body: { is_active: false } });
      await loadTemplates();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0625\u064A\u0642\u0627\u0641 \u0627\u0644\u0628\u0646\u062F.");
    }
  }

  function resetTemplateForm() {
    document.getElementById("tpl-name").value = "";
    document.getElementById("tpl-category").value = "";
    document.getElementById("tpl-amount").value = "0";
  }

  async function saveTemplate() {
    var payload = {
      name: document.getElementById("tpl-name").value.trim(),
      category: document.getElementById("tpl-category").value.trim(),
      default_amount: document.getElementById("tpl-amount").value,
      treasury_account: document.getElementById("tpl-treasury-account").value,
      expense_account: document.getElementById("tpl-expense-account").value,
    };
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.RECURRING_EXPENSES, { method: "POST", body: payload });
      closeModal("modal-add-template");
      await loadTemplates();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0628\u0646\u062F.");
    }
  }

  async function postMonth() {
    if (templatesCache.length === 0) { alert("\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u0646\u0648\u062F \u062B\u0627\u0628\u062A\u0629 \u0644\u0635\u0631\u0641\u0647\u0627."); return; }
    if (!confirm("\u0635\u0631\u0641 \u0648\u0627\u0639\u062A\u0645\u0627\u062F \u0643\u0644 \u0627\u0644\u0628\u0646\u0648\u062F \u062F\u0641\u0639\u0629 \u0648\u0627\u062D\u062F\u0629\u061F")) return;

    var lines = templatesCache.map(function (t) {
      var input = document.querySelector("[data-template-amount=\"" + t.id + "\"]");
      return { template_id: t.id, amount: input ? input.value : t.default_amount, date: todayISO() };
    });

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.RECURRING_EXPENSES + "post_month/", { method: "POST", body: { lines: lines } });
      alert("\u062A\u0645 \u0635\u0631\u0641 " + result.data.posted_count + " \u0628\u0646\u062F \u0628\u0646\u062C\u0627\u062D.");
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0635\u0631\u0641 \u0645\u0635\u0627\u0631\u064A\u0641 \u0627\u0644\u0634\u0647\u0631.");
    }
  }

  // =========================================================================
  // Payroll
  // =========================================================================

  function addPayrollRow() {
    payrollRowCounter++;
    var rowId = "pr-" + payrollRowCounter;
    var tbody = document.getElementById("payroll-table-body");
    var row = document.createElement("tr");
    row.dataset.payrollRow = rowId;
    var employeeOptions = "<option value=\"\">-- \u0627\u062E\u062A\u0631 \u0645\u0648\u0638\u0641 --</option>" + employeesCache.map(function (e) {
      return "<option value=\"" + e.id + "\" data-dept=\"" + escapeHtml(e.department || "") + "\">" + escapeHtml(e.full_name) + "</option>";
    }).join("");
    row.innerHTML =
      "<td><select class=\"filter-select\" style=\"width:170px;\" data-payroll-employee=\"" + rowId + "\">" + employeeOptions + "</select></td>" +
      "<td data-payroll-dept=\"" + rowId + "\">-</td>" +
      "<td class=\"num\"><input type=\"number\" min=\"0\" step=\"0.01\" class=\"inline-amount\" value=\"0\" data-payroll-salary=\"" + rowId + "\" /></td>" +
      "<td class=\"num\"><input type=\"number\" min=\"0\" step=\"0.01\" class=\"inline-amount\" value=\"0\" data-payroll-deduction=\"" + rowId + "\" /></td>" +
      "<td class=\"num\" data-payroll-net=\"" + rowId + "\">0.00</td>" +
      "<td><button class=\"row-action-btn is-danger\" data-payroll-remove=\"" + rowId + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button></td>";
    tbody.appendChild(row);

    row.querySelector("[data-payroll-employee]").addEventListener("change", function (e) {
      var selected = e.target.options[e.target.selectedIndex];
      var dept = selected ? selected.dataset.dept : "";
      row.querySelector("[data-payroll-dept]").textContent = dept || "-";
    });
    row.querySelectorAll("[data-payroll-salary], [data-payroll-deduction]").forEach(function (input) {
      input.addEventListener("input", updatePayrollTotals);
    });
    row.querySelector("[data-payroll-remove]").addEventListener("click", function () {
      row.remove();
      updatePayrollTotals();
    });
  }

  function updatePayrollTotals() {
    var total = 0;
    document.querySelectorAll("#payroll-table-body tr").forEach(function (row) {
      var rowId = row.dataset.payrollRow;
      var salary = Number(document.querySelector("[data-payroll-salary=\"" + rowId + "\"]").value) || 0;
      var deduction = Number(document.querySelector("[data-payroll-deduction=\"" + rowId + "\"]").value) || 0;
      var net = Math.max(salary - deduction, 0);
      document.querySelector("[data-payroll-net=\"" + rowId + "\"]").textContent = fmtMoney(net);
      total += net;
    });
    document.getElementById("payroll-total").textContent = fmtMoney(total);
  }

  async function postPayroll() {
    var rows = document.querySelectorAll("#payroll-table-body tr");
    if (rows.length === 0) { alert("\u0623\u0636\u0641 \u0645\u0648\u0638\u0641 \u0648\u0627\u062D\u062F \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644."); return; }

    var treasuryAccount = document.getElementById("payroll-treasury-account").value;
    var expenseAccount = document.getElementById("payroll-expense-account").value;
    if (!treasuryAccount || !expenseAccount) { alert("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 \u0627\u0644\u062E\u0632\u064A\u0646\u0629 \u0648\u062D\u0633\u0627\u0628 \u0645\u0635\u0631\u0648\u0641 \u0627\u0644\u0631\u0648\u0627\u062A\u0628 \u0623\u0648\u0644\u064B\u0627."); return; }

    var lines = [];
    var hasEmptyName = false;
    rows.forEach(function (row) {
      var rowId = row.dataset.payrollRow;
      var select = document.querySelector("[data-payroll-employee=\"" + rowId + "\"]");
      var selected = select.options[select.selectedIndex];
      var name = selected && select.value ? selected.textContent : "";
      if (!name) hasEmptyName = true;
      lines.push({
        employee_name: name,
        salary: document.querySelector("[data-payroll-salary=\"" + rowId + "\"]").value,
        deduction: document.querySelector("[data-payroll-deduction=\"" + rowId + "\"]").value,
      });
    });

    if (hasEmptyName) { alert("\u0627\u062E\u062A\u0631 \u0645\u0648\u0638\u0641 \u0644\u0643\u0644 \u0635\u0641.\u060C \u0623\u0648 \u0627\u062D\u0630\u0641 \u0627\u0644\u0635\u0641\u0648\u0641 \u0627\u0644\u0641\u0627\u0631\u063A\u0629."); return; }
    if (!confirm("\u0635\u0631\u0641 \u0625\u062C\u0645\u0627\u0644\u064A \u0631\u0648\u0627\u062A\u0628 " + lines.length + " \u0645\u0648\u0638\u0641 \u062F\u0641\u0639\u0629 \u0648\u0627\u062D\u062F\u0629\u061F")) return;

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.RECURRING_POST_PAYROLL, {
        method: "POST", body: { treasury_account: treasuryAccount, expense_account: expenseAccount, lines: lines },
      });
      alert("\u062A\u0645 \u0635\u0631\u0641 \u0627\u0644\u0631\u0648\u0627\u062A\u0628 \u0628\u0646\u062C\u0627\u062D -- \u0625\u062C\u0645\u0627\u0644\u064A " + fmtMoney(result.data.total_net) + ".");
      document.getElementById("payroll-table-body").innerHTML = "";
      updatePayrollTotals();
      await loadExpenses();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0635\u0631\u0641 \u0627\u0644\u0631\u0648\u0627\u062A\u0628.");
    }
  }

  // =========================================================================
  // Custody
  // =========================================================================

  async function loadCustody() {
    try {
      custodyCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.CUSTODY);
    } catch (err) { custodyCache = []; }
    renderCustodyTable();
    renderKpiCards();
  }

  function renderCustodyTable() {
    var query = (document.getElementById("custody-search").value || "").trim().toLowerCase();
    var rows = custodyCache.filter(function (c) {
      return !query || (c.employee_name || "").toLowerCase().includes(query);
    });

    var tbody = document.getElementById("custody-table-body");
    var table = document.getElementById("custody-table");
    var empty = document.getElementById("custody-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    var todayStr = todayISO();

    tbody.innerHTML = rows.map(function (c) {
      var isOverdue = c.status === "posted" && c.due_date && c.due_date < todayStr;
      var employee = employeesCache.find(function (e) { return e.id === c.employee; });
      var jobTitle = employee && employee.department ? employee.department : "-";
      return "<tr>" +
        "<td class=\"mono\">" + escapeHtml(c.number) + "</td>" +
        "<td>" + escapeHtml(c.date) + "</td>" +
        "<td>" + escapeHtml(c.employee_name) + "</td>" +
        "<td>" + escapeHtml(jobTitle) + "</td>" +
        "<td class=\"num\">" + fmtMoney(c.amount) + " " + escapeHtml(c.currency || "EGP") + "</td>" +
        "<td class=\"num\">" + fmtMoney(c.spent) + "</td>" +
        "<td class=\"num\">" + fmtMoney(c.remaining) + "</td>" +
        "<td>" + (c.due_date ? escapeHtml(c.due_date) : "-") + "</td>" +
        "<td>" + (isOverdue
          ? "<span class=\"status-badge status-badge--overdue\">\u0645\u062A\u0623\u062E\u0631\u0629</span>"
          : "<span class=\"status-badge status-badge--" + c.status + "\">" + (STATUS_LABELS[c.status] || c.status) + "</span>") + "</td>" +
        "<td>" + custodyActionsHtml(c) + "</td>" +
      "</tr>";
    }).join("");

    wireCustodyActions();
  }

  var CUSTODY_NEXT_ACTION = { draft: "submit", submitted: "approve", approved: "issue" };
  var CUSTODY_NEXT_LABEL = { draft: "\u0625\u0631\u0633\u0627\u0644", submitted: "\u0627\u0639\u062A\u0645\u0627\u062F", approved: "\u0625\u0635\u062F\u0627\u0631" };

  function custodyActionsHtml(c) {
    var html = "";
    var nextAction = CUSTODY_NEXT_ACTION[c.status];
    if (nextAction) {
      html += "<button class=\"btn-workflow-next\" data-custody-advance=\"" + c.id + "\" data-action=\"" + nextAction + "\">" + CUSTODY_NEXT_LABEL[c.status] + "</button>";
    }
    if (c.status === "posted") {
      html += "<button class=\"btn-workflow-next\" data-custody-settle=\"" + c.id + "\">\u062A\u0635\u0641\u064A\u0629 \u0639\u0647\u062F\u0629</button>";
    }
    if (c.status === "draft") {
      html += "<button class=\"row-action-btn is-danger\" data-custody-delete=\"" + c.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    }
    return html;
  }

  function wireCustodyActions() {
    document.querySelectorAll("[data-custody-advance]").forEach(function (btn) {
      btn.addEventListener("click", function () { advanceCustody(btn.dataset.custodyAdvance, btn.dataset.action); });
    });
    document.querySelectorAll("[data-custody-settle]").forEach(function (btn) {
      btn.addEventListener("click", function () { settleCustody(btn.dataset.custodySettle); });
    });
    document.querySelectorAll("[data-custody-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteCustody(btn.dataset.custodyDelete); });
    });
  }

  async function advanceCustody(id, action) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.CUSTODY_DETAIL(id) + action + "/", { method: "POST" });
      await loadCustody();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0639\u0647\u062F\u0629.");
    }
  }

  async function settleCustody(id) {
    if (!confirm("\u062A\u0635\u0641\u064A\u0629 \u0647\u0630\u0647 \u0627\u0644\u0639\u0647\u062F\u0629\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.CUSTODY_DETAIL(id) + "settle/", { method: "POST" });
      await loadCustody();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u0635\u0641\u064A\u0629 \u0627\u0644\u0639\u0647\u062F\u0629.");
    }
  }

  async function deleteCustody(id) {
    if (!confirm("\u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0639\u0647\u062F\u0629 \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.CUSTODY_DETAIL(id), { method: "DELETE" });
      await loadCustody();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0639\u0647\u062F\u0629.");
    }
  }

  function resetCustodyForm() {
    document.getElementById("cu-date").value = todayISO();
    document.getElementById("cu-amount").value = "0";
    document.getElementById("cu-currency").value = "EGP";
    document.getElementById("cu-due-date").value = "";
    document.getElementById("cu-description").value = "";
  }

  async function saveCustody() {
    var payload = {
      date: document.getElementById("cu-date").value,
      employee: document.getElementById("cu-employee").value,
      amount: document.getElementById("cu-amount").value,
      currency: document.getElementById("cu-currency").value,
      due_date: document.getElementById("cu-due-date").value || null,
      treasury_account: document.getElementById("cu-treasury-account").value,
      custody_account: document.getElementById("cu-custody-account").value,
      description: document.getElementById("cu-description").value.trim(),
    };

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.CUSTODY, { method: "POST", body: payload });
      closeModal("modal-add-custody");
      await loadCustody();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0639\u0647\u062F\u0629.");
    }
  }

  // =========================================================================
  // CSV Export
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportExpensesCsv() {
    var query = (document.getElementById("expense-search").value || "").trim().toLowerCase();
    var dateFilter = document.getElementById("expense-filter-date").value;
    var rows = expensesCache.filter(function (e) {
      var matchesQuery = !query || (e.category || "").toLowerCase().includes(query) || (e.description || "").toLowerCase().includes(query);
      var matchesDate = !dateFilter || e.date === dateFilter;
      return matchesQuery && matchesDate;
    });
    if (rows.length === 0) { alert("\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0644\u062A\u0635\u062F\u064A\u0631\u0647\u0627."); return; }

    var lines = [["\u0627\u0644\u062A\u0627\u0631\u064A\u062E", "\u0627\u0644\u0641\u0626\u0629", "\u0627\u0644\u0628\u064A\u0627\u0646", "\u0645\u0631\u062C\u0639 \u0627\u0644\u062D\u062C\u0632", "\u0627\u0644\u0645\u0628\u0644\u063A", "\u0627\u0644\u0639\u0645\u0644\u0629", "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639", "\u0627\u0644\u062D\u0627\u0644\u0629"].map(csvEscape).join(",")];
    rows.forEach(function (e) {
      lines.push([e.date, e.category, e.description, e.booking_reference, e.amount, e.currency, PAYMENT_METHOD_LABELS_AR[e.payment_method], STATUS_LABELS[e.status]].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Expenses-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
})();
