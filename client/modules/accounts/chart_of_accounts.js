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
  function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

  var TYPE_LABELS_AR = {
    asset: "\u0623\u0635\u0648\u0644", liability: "\u062E\u0635\u0648\u0645", equity: "\u062D\u0642\u0648\u0642 \u0645\u0644\u0643\u064A\u0629",
    revenue: "\u0625\u064A\u0631\u0627\u062F\u0627\u062A", expense: "\u0645\u0635\u0631\u0648\u0641\u0627\u062A",
  };
  var NATURE_LABELS_AR = { debit: "\u0645\u062F\u064A\u0646", credit: "\u062F\u0627\u0626\u0646" };
  var STATUS_LABELS_AR = { active: "\u0646\u0634\u0637", postable: "\u0642\u0627\u0628\u0644 \u0644\u0644\u062A\u0631\u062D\u064A\u0644", inactive: "\u063A\u064A\u0631 \u0646\u0634\u0637" };

  var accountsCache = [];
  var editingAccountId = null;

document.addEventListener("DOMContentLoaded", function () {
    loadAccounts();
    loadJournalEntries();

    document.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll("[data-tab]").forEach(function (t) { t.classList.remove("is-active"); });
        document.querySelectorAll(".tab-view").forEach(function (v) { v.classList.remove("is-active"); });
        tab.classList.add("is-active");
        document.getElementById("tab-" + tab.dataset.tab).classList.add("is-active");
      });
    });

    document.getElementById("btn-open-add-je")?.addEventListener("click", function () {
      openAddJeModal();
    });
    document.getElementById("btn-add-je-line")?.addEventListener("click", function () { addJeLine(); });
    document.getElementById("btn-save-je")?.addEventListener("click", saveJournalEntry);
    document.getElementById("je-search")?.addEventListener("input", renderJournalTable);
    document.getElementById("je-status-filter")?.addEventListener("change", renderJournalTable);

    document.getElementById("btn-open-add-account")?.addEventListener("click", function () {
    document.getElementById("btn-open-add-account")?.addEventListener("click", function () {
      editingAccountId = null;
      resetAccountForm();
      document.getElementById("account-modal-title").textContent = "\u0625\u0636\u0627\u0641\u0629 \u062D\u0633\u0627\u0628";
      openModal("modal-add-account");
    });
    document.getElementById("btn-save-account")?.addEventListener("click", saveAccount);
    document.getElementById("coa-search")?.addEventListener("input", renderTable);
    document.getElementById("coa-type-filter")?.addEventListener("change", renderTable);
    document.getElementById("acc-type")?.addEventListener("change", function () {
      var type = document.getElementById("acc-type").value;
      document.getElementById("acc-nature").value = (type === "asset" || type === "expense") ? "debit" : "credit";
    });

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
  });

  // =========================================================================
  // Load & render
  // =========================================================================

  async function loadAccounts() {
    try {
      accountsCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA);
      populateParentSelect();
    } catch (err) { accountsCache = []; }
    renderTable();
  }

  function populateParentSelect() {
    var select = document.getElementById("acc-parent");
    var options = accountsCache
      .filter(function (a) { return a.id !== editingAccountId; })
      .map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; })
      .join("");
    select.innerHTML = "<option value=\"\">-- \u0628\u062F\u0648\u0646 (\u0645\u0633\u062A\u0642\u0644) --</option>" + options;
  }

  function renderTable() {
    var query = (document.getElementById("coa-search").value || "").trim().toLowerCase();
    var typeFilter = document.getElementById("coa-type-filter").value;

    var rows = accountsCache.filter(function (a) {
      var matchesQuery = !query || a.name.toLowerCase().includes(query) || a.code.toLowerCase().includes(query);
      var matchesType = !typeFilter || a.type === typeFilter;
      return matchesQuery && matchesType;
    });

    var tbody = document.getElementById("coa-table-body");
    var table = document.getElementById("coa-table");
    var empty = document.getElementById("coa-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    // Roots first, then children indented under their parent -- a
    // simple flat sort by code already groups them naturally since
    // child codes extend their parent's code prefix.
    rows.sort(function (a, b) { return a.code.localeCompare(b.code); });

    tbody.innerHTML = rows.map(function (a) {
      var isChild = !!a.parent;
      return "<tr class=\"" + (isChild ? "is-child" : "") + "\">" +
        "<td class=\"mono\">" + escapeHtml(a.code) + "</td>" +
        "<td>" + escapeHtml(a.name) + "</td>" +
        "<td><span class=\"type-chip type-chip--" + a.type + "\">" + TYPE_LABELS_AR[a.type] + "</span></td>" +
        "<td>" + NATURE_LABELS_AR[a.nature] + "</td>" +
        "<td class=\"num\">" + fmtMoney(a.balance) + " " + escapeHtml(a.currency || "EGP") + "</td>" +
        "<td><span class=\"status-badge status-badge--" + a.status + "\">" + STATUS_LABELS_AR[a.status] + "</span></td>" +
        "<td>" +
          "<button class=\"row-action-btn\" data-view-ledger=\"" + a.id + "\" title=\"\u0643\u0634\u0641 \u0627\u0644\u062D\u0633\u0627\u0628\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z\"/></svg></button>" +
          "<button class=\"row-action-btn\" data-edit-account=\"" + a.id + "\" title=\"\u062A\u0639\u062F\u064A\u0644\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg></button>" +
          (!a.has_movements ? "<button class=\"row-action-btn is-danger\" data-delete-account=\"" + a.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>" : "") +
        "</td>" +
      "</tr>";
    }).join("");

    wireTableActions();
  }

  function wireTableActions() {
    document.querySelectorAll("[data-view-ledger]").forEach(function (btn) {
      btn.addEventListener("click", function () { openLedgerModal(btn.dataset.viewLedger); });
    });
    document.querySelectorAll("[data-edit-account]").forEach(function (btn) {
      btn.addEventListener("click", function () { openEditModal(btn.dataset.editAccount); });
    });
    document.querySelectorAll("[data-delete-account]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteAccount(btn.dataset.deleteAccount); });
    });
  }

  // =========================================================================
  // Add / Edit
  // =========================================================================

  function resetAccountForm() {
    document.getElementById("acc-parent").value = "";
    document.getElementById("acc-code").value = "";
    document.getElementById("acc-name").value = "";
    document.getElementById("acc-type").value = "asset";
    document.getElementById("acc-nature").value = "debit";
    document.getElementById("acc-currency").value = "EGP";
    document.getElementById("acc-status").value = "active";
    document.getElementById("acc-opening-balance").value = "0";
  }

  function openEditModal(id) {
    var account = accountsCache.find(function (a) { return String(a.id) === id; });
    if (!account) return;
    editingAccountId = account.id;
    populateParentSelect();

    document.getElementById("account-modal-title").textContent = "\u062A\u0639\u062F\u064A\u0644 \u062D\u0633\u0627\u0628";
    document.getElementById("acc-parent").value = account.parent || "";
    document.getElementById("acc-code").value = account.code;
    document.getElementById("acc-name").value = account.name;
    document.getElementById("acc-type").value = account.type;
    document.getElementById("acc-nature").value = account.nature;
    document.getElementById("acc-currency").value = account.currency;
    document.getElementById("acc-status").value = account.status;
    document.getElementById("acc-opening-balance").value = account.opening_balance;

    if (account.has_movements) {
      document.getElementById("acc-code").disabled = true;
      document.getElementById("acc-type").disabled = true;
      document.getElementById("acc-nature").disabled = true;
      document.getElementById("acc-currency").disabled = true;
      document.getElementById("acc-parent").disabled = true;
      document.getElementById("acc-opening-balance").disabled = true;
    } else {
      ["acc-code", "acc-type", "acc-nature", "acc-currency", "acc-parent", "acc-opening-balance"].forEach(function (id) {
        document.getElementById(id).disabled = false;
      });
    }

    openModal("modal-add-account");
  }

  async function saveAccount() {
    var code = document.getElementById("acc-code").value.trim();
    var name = document.getElementById("acc-name").value.trim();
    if (!code || !name) { alert("\u0643\u0648\u062F \u0627\u0644\u062D\u0633\u0627\u0628 \u0648\u0627\u0633\u0645\u0647 \u0645\u0637\u0644\u0648\u0628\u0627\u0646."); return; }

    var payload = {
      parent: document.getElementById("acc-parent").value || null,
      code: code, name: name,
      type: document.getElementById("acc-type").value,
      nature: document.getElementById("acc-nature").value,
      currency: document.getElementById("acc-currency").value,
      status: document.getElementById("acc-status").value,
      opening_balance: document.getElementById("acc-opening-balance").value,
    };

    try {
      if (editingAccountId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA_DETAIL(editingAccountId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA, { method: "POST", body: payload });
      }
      closeModal("modal-add-account");
      editingAccountId = null;
      await loadAccounts();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u062D\u0633\u0627\u0628.");
    }
  }

  async function deleteAccount(id) {
    var account = accountsCache.find(function (a) { return String(a.id) === id; });
    if (!account) return;
    if (!confirm("\u062D\u0630\u0641 \u062D\u0633\u0627\u0628 \"" + account.name + "\" \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA_DETAIL(id), { method: "DELETE" });
      await loadAccounts();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u062D\u0633\u0627\u0628.");
    }
  }

  // =========================================================================
  // Ledger view
  // =========================================================================

  async function openLedgerModal(id) {
    var account = accountsCache.find(function (a) { return String(a.id) === id; });
    if (!account) return;

    document.getElementById("ledger-modal-title").textContent = "\u0643\u0634\u0641 \u062D\u0633\u0627\u0628: " + account.name;
    document.getElementById("ledger-summary").innerHTML =
      "<div class=\"ledger-panel__row\"><span>\u0627\u0644\u0643\u0648\u062F</span><strong>" + escapeHtml(account.code) + "</strong></div>" +
      "<div class=\"ledger-panel__row\"><span>\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u0627\u0641\u062A\u062A\u0627\u062D\u064A</span><strong>" + fmtMoney(account.opening_balance) + "</strong></div>" +
      "<div class=\"ledger-panel__row\"><span>\u0627\u0644\u0631\u0635\u064A\u062F \u0627\u0644\u062D\u0627\u0644\u064A</span><strong>" + fmtMoney(account.balance) + "</strong></div>";

    openModal("modal-account-ledger");

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.REPORT_LEDGER + "?account_id=" + id);
      var lines = result.data.lines || [];
      document.getElementById("ledger-lines-body").innerHTML = lines.length
        ? lines.map(function (l) {
            return "<tr>" +
              "<td>" + escapeHtml(l.date) + "</td>" +
              "<td class=\"mono\">" + escapeHtml(l.entry_number) + "</td>" +
              "<td>" + escapeHtml(l.description) + "</td>" +
              "<td class=\"num\">" + (Number(l.debit) > 0 ? fmtMoney(l.debit) : "-") + "</td>" +
              "<td class=\"num\">" + (Number(l.credit) > 0 ? fmtMoney(l.credit) : "-") + "</td>" +
              "<td class=\"num\">" + fmtMoney(l.running_balance) + "</td>" +
            "</tr>";
          }).join("")
        : "<tr><td colspan=\"6\" style=\"text-align:center; color:var(--text-faint);\">\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0631\u0643\u0627\u062A \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628.</td></tr>";
    } catch (err) {
      document.getElementById("ledger-lines-body").innerHTML = "<tr><td colspan=\"6\" style=\"text-align:center; color:var(--coral);\">\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u062D\u0631\u0643\u0627\u062A.</td></tr>";
    }
  }
  }

  // =========================================================================
  // Journal Entries -- requestAllPages from the start, no 50-record cap.
  // =========================================================================

   var JE_STATUS_LABELS = {
    draft: "\u0645\u0633\u0648\u0651\u062F\u0629", submitted: "\u0645\u064F\u0642\u062F\u064E\u0651\u0645",
    approved: "\u0645\u0639\u062A\u0645\u062F", posted: "\u0645\u064F\u0631\u062D\u064E\u0651\u0644",
  };
  var JE_NEXT_ACTION = { draft: "submit", submitted: "approve", approved: "post_entry" };
  var JE_NEXT_ACTION_LABEL = { draft: "\u0625\u0631\u0633\u0627\u0644", submitted: "\u0627\u0639\u062A\u0645\u0627\u062F", approved: "\u062A\u0631\u062D\u064A\u0644" };

  var journalEntriesCache = [];
  var jeLineCounter = 0;

  async function loadJournalEntries() {
    try {
      journalEntriesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.JOURNAL_ENTRIES);
    } catch (err) {
      journalEntriesCache = [];
    }
    renderJournalTable();
  }

  function renderJournalTable() {
    var query = (document.getElementById("je-search").value || "").trim().toLowerCase();
    var statusFilter = document.getElementById("je-status-filter").value;

    var rows = journalEntriesCache.filter(function (e) {
      var matchesQuery = !query || e.number.toLowerCase().includes(query) || (e.description || "").toLowerCase().includes(query);
      var matchesStatus = !statusFilter || e.status === statusFilter;
      return matchesQuery && matchesStatus;
    });

    var tbody = document.getElementById("je-table-body");
    var table = document.getElementById("je-table");
    var empty = document.getElementById("je-empty");
    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (e) {
      return "<tr>" +
        "<td class=\"mono\">" + escapeHtml(e.number) + "</td>" +
        "<td>" + escapeHtml(e.date) + "</td>" +
        "<td>" + escapeHtml(e.description) + "</td>" +
        "<td>" + escapeHtml(e.reference || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(e.total_debit) + "</td>" +
        "<td class=\"num\">" + fmtMoney(e.total_credit) + "</td>" +
        "<td><span class=\"status-badge status-badge--" + e.status + "\">" + JE_STATUS_LABELS[e.status] + "</span></td>" +
        "<td>" + jeActionsHtml(e) + "</td>" +
      "</tr>";
    }).join("");

    wireJeActions();
  }

  function jeActionsHtml(e) {
    var html = "";
    var nextAction = JE_NEXT_ACTION[e.status];
    if (nextAction) {
      html += "<button class=\"btn-workflow-next\" data-je-advance=\"" + e.id + "\" data-action=\"" + nextAction + "\">" + JE_NEXT_ACTION_LABEL[e.status] + "</button>";
    }
    if (e.status === "draft") {
      html += "<button class=\"row-action-btn is-danger\" data-je-delete=\"" + e.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    }
    if (e.status === "posted" && !e.reversed_by) {
      html += "<button class=\"row-action-btn\" data-je-reverse=\"" + e.id + "\" title=\"\u0639\u0643\u0633\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 7v6h6\"/><path d=\"M3 13a9 9 0 1 0 3-6.7L3 9\"/></svg></button>";
    }
    return html;
  }

  function wireJeActions() {
    document.querySelectorAll("[data-je-advance]").forEach(function (btn) {
      btn.addEventListener("click", function () { advanceJournalEntry(btn.dataset.jeAdvance, btn.dataset.action); });
    });
    document.querySelectorAll("[data-je-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteJournalEntry(btn.dataset.jeDelete); });
    });
    document.querySelectorAll("[data-je-reverse]").forEach(function (btn) {
      btn.addEventListener("click", function () { reverseJournalEntry(btn.dataset.jeReverse); });
    });
  }

  async function advanceJournalEntry(id, action) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.JOURNAL_ENTRY_ACTION(id, action), { method: "POST" });
      await loadJournalEntries();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0642\u064A\u062F.");
    }
  }

  async function deleteJournalEntry(id) {
    if (!confirm("\u062D\u0630\u0641 \u0647\u0630\u0627 \u0627\u0644\u0642\u064A\u062F \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.JOURNAL_ENTRY_DETAIL(id), { method: "DELETE" });
      await loadJournalEntries();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0642\u064A\u062F.");
    }
  }

  async function reverseJournalEntry(id) {
    var reason = prompt("\u0633\u0628\u0628 \u0627\u0644\u0639\u0643\u0633 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A):") || "";
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.JOURNAL_ENTRY_ACTION(id, "reverse"), { method: "POST", body: { reason: reason } });
      await loadJournalEntries();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0639\u0643\u0633 \u0627\u0644\u0642\u064A\u062F.");
    }
  }

  function openAddJeModal() {
    document.getElementById("je-date").value = new Date().toISOString().split("T")[0];
    document.getElementById("je-reference").value = "";
    document.getElementById("je-description").value = "";
    document.getElementById("je-lines-wrap").innerHTML = "";
    jeLineCounter = 0;
    addJeLine();
    addJeLine();
    updateJeTotals();
    openModal("modal-add-je");
  }

  function addJeLine() {
    var wrap = document.getElementById("je-lines-wrap");
    var lineId = "je-line-" + (jeLineCounter++);
    var accountOptions = accountsCache
      .filter(function (a) { return a.status !== "inactive"; })
      .map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; })
      .join("");

    var row = document.createElement("div");
    row.className = "je-line-row";
    row.id = lineId;
    row.innerHTML =
      "<select class=\"je-line-account\"><option value=\"\">-- \u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 --</option>" + accountOptions + "</select>" +
      "<input type=\"number\" min=\"0\" step=\"0.01\" class=\"je-line-debit\" placeholder=\"\u0645\u062F\u064A\u0646\" value=\"0\" />" +
      "<input type=\"number\" min=\"0\" step=\"0.01\" class=\"je-line-credit\" placeholder=\"\u062F\u0627\u0626\u0646\" value=\"0\" />" +
      "<input type=\"text\" class=\"je-line-memo\" placeholder=\"\u0645\u0644\u0627\u062D\u0638\u0629 (\u0627\u062E\u062A\u064A\u0627\u0631\u064A)\" />" +
      "<button type=\"button\" class=\"row-action-btn is-danger\" data-remove-je-line=\"" + lineId + "\">\u00D7</button>";
    wrap.appendChild(row);

    row.querySelector(".je-line-debit").addEventListener("input", updateJeTotals);
    row.querySelector(".je-line-credit").addEventListener("input", updateJeTotals);
    row.querySelector("[data-remove-je-line]").addEventListener("click", function () {
      document.getElementById(lineId).remove();
      updateJeTotals();
    });
  }

  function updateJeTotals() {
    var debitInputs = document.querySelectorAll(".je-line-debit");
    var creditInputs = document.querySelectorAll(".je-line-credit");
    var totalDebit = 0, totalCredit = 0;
    debitInputs.forEach(function (el) { totalDebit += Number(el.value) || 0; });
    creditInputs.forEach(function (el) { totalCredit += Number(el.value) || 0; });

    document.getElementById("je-total-debit").textContent = fmtMoney(totalDebit);
    document.getElementById("je-total-credit").textContent = fmtMoney(totalCredit);

    var statusEl = document.getElementById("je-balance-status");
    var isBalanced = totalDebit > 0 && Math.abs(totalDebit - totalCredit) < 0.005;
    statusEl.textContent = isBalanced ? "\u2713 \u0645\u062A\u0648\u0627\u0632\u0646" : "\u2717 \u063A\u064A\u0631 \u0645\u062A\u0648\u0627\u0632\u0646";
    statusEl.className = isBalanced ? "is-balanced" : "is-unbalanced";
  }

  async function saveJournalEntry() {
    var date = document.getElementById("je-date").value;
    var description = document.getElementById("je-description").value.trim();
    if (!date || !description) { alert("\u0627\u0644\u062A\u0627\u0631\u064A\u062E \u0648\u0627\u0644\u0628\u064A\u0627\u0646 \u0645\u0637\u0644\u0648\u0628\u0627\u0646."); return; }

    var lines = [];
    document.querySelectorAll(".je-line-row").forEach(function (row) {
      var accountId = row.querySelector(".je-line-account").value;
      var debit = row.querySelector(".je-line-debit").value || "0";
      var credit = row.querySelector(".je-line-credit").value || "0";
      var memo = row.querySelector(".je-line-memo").value.trim();
      if (accountId && (Number(debit) > 0 || Number(credit) > 0)) {
        lines.push({ account: accountId, debit: debit, credit: credit, memo: memo });
      }
    });

    if (lines.length < 2) { alert("\u0627\u0644\u0642\u064A\u062F \u064A\u062D\u062A\u0627\u062C \u0628\u0646\u062F\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644."); return; }

    var totalDebit = lines.reduce(function (sum, l) { return sum + Number(l.debit); }, 0);
    var totalCredit = lines.reduce(function (sum, l) { return sum + Number(l.credit); }, 0);
    if (Math.abs(totalDebit - totalCredit) >= 0.005) { alert("\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u064A\u0646 \u064A\u062C\u0628 \u0623\u0646 \u064A\u0633\u0627\u0648\u064A \u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u062F\u0627\u0626\u0646."); return; }

    var payload = {
      date: date,
      reference: document.getElementById("je-reference").value.trim(),
      description: description,
      lines: lines,
    };

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.JOURNAL_ENTRIES, { method: "POST", body: payload });
      closeModal("modal-add-je");
      await loadJournalEntries();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0642\u064A\u062F.");
    }
  }
})();
