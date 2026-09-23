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

  var STATUS_LABELS = { draft: "\u0645\u0633\u0648\u0651\u062F\u0629", submitted: "\u0645\u064F\u0642\u062F\u064E\u0651\u0645", approved: "\u0645\u0639\u062A\u0645\u062F", posted: "\u0645\u064F\u0631\u062D\u064E\u0651\u0644" };
  var NEXT_ACTION = { draft: "submit", submitted: "approve", approved: "post_voucher" };
  var NEXT_ACTION_LABEL = { draft: "\u0625\u0631\u0633\u0627\u0644", submitted: "\u0627\u0639\u062A\u0645\u0627\u062F", approved: "\u062A\u0631\u062D\u064A\u0644" };
  var PAYMENT_METHOD_LABELS_AR = { cash: "\u0646\u0642\u062F\u064A", instapay: "InstaPay", bank_transfer: "\u062A\u062D\u0648\u064A\u0644 \u0628\u0646\u0643\u064A", cheque: "\u0634\u064A\u0643", card: "\u0643\u0627\u0631\u062A" };

  var currentType = "receipt";
  var accountsCache = [];
  var partiesCache = [];
  var vouchersCache = [];
  var pendingAttachment = null;

  document.addEventListener("DOMContentLoaded", function () {
    loadAccounts();
    loadParties();
    loadVouchers();

    document.querySelectorAll("[data-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll("[data-tab]").forEach(function (t) { t.classList.remove("is-active"); });
        document.querySelectorAll(".tab-view").forEach(function (v) { v.classList.remove("is-active"); });
        tab.classList.add("is-active");
        document.getElementById("tab-" + tab.dataset.tab).classList.add("is-active");
        if (tab.dataset.tab === "suppliers") renderSuppliersTable();
        if (tab.dataset.tab === "vaults") renderVaultCards();
      });
    });

    document.querySelectorAll("[data-voucher-type]").forEach(function (subtab) {
      subtab.addEventListener("click", function () {
        document.querySelectorAll("[data-voucher-type]").forEach(function (t) { t.classList.remove("is-active"); });
        subtab.classList.add("is-active");
        currentType = subtab.dataset.voucherType;
        renderVouchersTable();
      });
    });

    document.getElementById("btn-open-add-voucher")?.addEventListener("click", function () {
      document.getElementById("voucher-modal-title").textContent = currentType === "receipt"
        ? "\u0633\u0646\u062F \u0642\u0628\u0636 \u062C\u062F\u064A\u062F" : "\u0633\u0646\u062F \u0635\u0631\u0641 \u062C\u062F\u064A\u062F";
      resetVoucherForm();
      openModal("modal-add-voucher");
    });
    document.getElementById("btn-save-voucher-draft")?.addEventListener("click", function () { saveVoucher(false); });
    document.getElementById("btn-confirm-post-voucher")?.addEventListener("click", function () { saveVoucher(true); });
    document.getElementById("btn-confirm-pay-supplier")?.addEventListener("click", confirmPaySupplier);
    document.getElementById("voucher-search")?.addEventListener("input", renderVouchersTable);
    document.getElementById("voucher-filter-date")?.addEventListener("change", renderVouchersTable);
    document.getElementById("supplier-search")?.addEventListener("input", renderSuppliersTable);
    document.getElementById("btn-export-vouchers")?.addEventListener("click", exportVouchersCsv);
    document.getElementById("btn-export-suppliers")?.addEventListener("click", exportSuppliersCsv);

    document.getElementById("v-attachment")?.addEventListener("change", async function (e) {
      var file = e.target.files[0];
      if (!file) { pendingAttachment = null; return; }
      try {
        var dataUrl = await readFileAsDataUrl(file);
        pendingAttachment = { name: file.name, dataUrl: dataUrl };
        document.getElementById("v-attachment-preview").innerHTML = "\uD83D\uDCCE " + escapeHtml(file.name);
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
      var treasuryAccounts = accountsCache.filter(function (a) { return a.type === "asset"; });
      var treasuryAccounts = accountsCache.filter(function (a) { return a.type === "asset"; });
      var controlAccounts = accountsCache.filter(function (a) { return a.type === "asset" || a.type === "liability"; });
      var options = function (list) { return list.map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; }).join(""); };
      ["v-treasury-account", "ps-treasury-account"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = options(treasuryAccounts);
      });
      ["v-control-account", "ps-control-account"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = options(controlAccounts);
      });
      renderVaultCards();
    } catch (err) { /* silent */ }
  }

  async function loadParties() {
    try {
      partiesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.PARTIES);
      document.getElementById("v-party").innerHTML = partiesCache.map(function (p) {
      document.getElementById("v-party").innerHTML = partiesCache.map(function (p) {
        return "<option value=\"" + p.id + "\">" + escapeHtml(p.full_name) + " (" + escapeHtml(p.code) + ")</option>";
      }).join("");
    } catch (err) { /* silent */ }
  }

  // =========================================================================
  // KPI Cards
  // =========================================================================

  function renderKpiCards() {
    var receipts = vouchersCache.filter(function (v) { return v.type === "receipt" && v.status === "posted"; });
    var payments = vouchersCache.filter(function (v) { return v.type === "payment" && v.status === "posted"; });
    var totalReceipts = receipts.reduce(function (sum, v) { return sum + Number(v.amount); }, 0);
    var totalPayments = payments.reduce(function (sum, v) { return sum + Number(v.amount); }, 0);
    var draftCount = vouchersCache.filter(function (v) { return v.status === "draft"; }).length;

    var cards = [
      { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062D\u0635\u0644 (\u0645\u064F\u0631\u062D\u064E\u0651\u0644)", value: fmtMoney(totalReceipts) },
      { label: "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0635\u0631\u0648\u0641 (\u0645\u064F\u0631\u062D\u064E\u0651\u0644)", value: fmtMoney(totalPayments) },
      { label: "\u0635\u0627\u0641\u064A \u0627\u0644\u062D\u0631\u0643\u0629", value: fmtMoney(totalReceipts - totalPayments) },
      { label: "\u0633\u0646\u062F\u0627\u062A \u0645\u0633\u0648\u0651\u062F\u0629", value: String(draftCount) },
    ];

    document.getElementById("kpi-grid").innerHTML = cards.map(function (c) {
      return "<div class=\"kpi-card\"><div class=\"kpi-card__label\">" + c.label + "</div><div class=\"kpi-card__value\">" + c.value + "</div></div>";
    }).join("");
  }

  // =========================================================================
  // Vouchers
  // =========================================================================

  async function loadVouchers() {
    try {
      vouchersCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.VOUCHERS);
    } catch (err) { vouchersCache = []; }
    } catch (err) { vouchersCache = []; }
    renderVouchersTable();
    renderKpiCards();
  }

  function renderVouchersTable() {
    var query = (document.getElementById("voucher-search").value || "").trim().toLowerCase();
    var dateFilter = document.getElementById("voucher-filter-date").value;
    var rows = vouchersCache.filter(function (v) {
      var matchesType = v.type === currentType;
      var matchesQuery = !query || (v.party_name || "").toLowerCase().includes(query);
      var matchesDate = !dateFilter || v.date === dateFilter;
      return matchesType && matchesQuery && matchesDate;
    });

    var tbody = document.getElementById("vouchers-table-body");
    var table = document.getElementById("vouchers-table");
    var empty = document.getElementById("vouchers-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (v) {
      var amountClass = v.type === "receipt" ? "amount-in" : "amount-out";
      var isRefund = !!v.booking && v.description && v.description.toLowerCase().indexOf("refund") !== -1;
      var refundBadge = isRefund ? "<span class=\"status-badge status-badge--refund\">استرجاع إلغاء</span> " : "";
      var bookingRefDisplay = v.booking ? ("Ref: BK-" + v.booking) : (v.booking_reference || "-");
      return "<tr" + (isRefund ? " class=\"row-refund\"" : "") + ">" +
        "<td class=\"mono\">" + refundBadge + escapeHtml(v.number) + "</td>" +
        "<td>" + escapeHtml(v.date) + "</td>" +
        "<td>" + escapeHtml(v.party_name) + "</td>" +
        "<td class=\"num " + amountClass + "\">" + fmtMoney(v.amount) + " " + escapeHtml(v.currency || "EGP") + "</td>" +
        "<td>" + (PAYMENT_METHOD_LABELS_AR[v.payment_method] || escapeHtml(v.payment_method)) + "</td>" +
        "<td>" + escapeHtml(bookingRefDisplay) + "</td>" +
        "<td>" + (v.attachment_name ? "<a href=\"#\" data-view-attachment=\"" + v.id + "\">\uD83D\uDCCE " + escapeHtml(v.attachment_name) + "</a>" : "\u2014") + "</td>" +
        "<td><span class=\"status-badge status-badge--" + v.status + "\">" + STATUS_LABELS[v.status] + "</span></td>" +
        "<td>" + voucherActionsHtml(v) + "</td>" +
      "</tr>";
    }).join("");

    wireVoucherActions();
  }

  function voucherActionsHtml(v) {
    var html = "";
    if (v.status === "draft") {
      html += "<button class=\"btn-confirm-post\" data-voucher-confirm-post=\"" + v.id + "\">\u062A\u0623\u0643\u064A\u062F</button>";
    }
    var nextAction = NEXT_ACTION[v.status];
    if (nextAction) {
      html += "<button class=\"btn-workflow-next\" data-voucher-advance=\"" + v.id + "\" data-action=\"" + nextAction + "\">" + NEXT_ACTION_LABEL[v.status] + "</button>";
    }
    if (v.status === "draft") {
      html += "<button class=\"row-action-btn is-danger\" data-voucher-delete=\"" + v.id + "\" title=\"\u062D\u0630\u0641\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    }
    if (v.status === "posted") {
      html += "<button class=\"row-action-btn\" data-voucher-reverse=\"" + v.id + "\" title=\"\u0639\u0643\u0633\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 7v6h6\"/><path d=\"M3 13a9 9 0 1 0 3-6.7L3 9\"/></svg></button>";
    }
    return html;
  }

  function wireVoucherActions() {
    document.querySelectorAll("[data-voucher-advance]").forEach(function (btn) {
      btn.addEventListener("click", function () { advanceVoucher(btn.dataset.voucherAdvance, btn.dataset.action); });
    });
    document.querySelectorAll("[data-voucher-confirm-post]").forEach(function (btn) {
      btn.addEventListener("click", function () { confirmPostExisting(btn.dataset.voucherConfirmPost); });
    });
    document.querySelectorAll("[data-voucher-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteVoucher(btn.dataset.voucherDelete); });
    });
    document.querySelectorAll("[data-voucher-reverse]").forEach(function (btn) {
      btn.addEventListener("click", function () { reverseVoucher(btn.dataset.voucherReverse); });
    });
    document.querySelectorAll("[data-view-attachment]").forEach(function (link) {
      link.addEventListener("click", function (evt) {
        evt.preventDefault();
        var voucher = vouchersCache.find(function (v) { return String(v.id) === link.dataset.viewAttachment; });
        if (voucher && voucher.attachment_data) window.open(voucher.attachment_data, "_blank");
      });
    });
  }

  async function advanceVoucher(id, action) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id) + action + "/", { method: "POST" });
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0627\u0644\u0633\u0646\u062F.");
    }
  }

  async function confirmPostExisting(id) {
    if (!confirm("\u062A\u0623\u0643\u064A\u062F \u0648\u0627\u0639\u062A\u0645\u0627\u062F \u0647\u0630\u0627 \u0627\u0644\u0633\u0646\u062F \u0641\u0648\u0631\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id) + "submit/", { method: "POST" });
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id) + "approve/", { method: "POST" });
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id) + "post_voucher/", { method: "POST" });
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u0623\u0643\u064A\u062F \u0627\u0644\u0633\u0646\u062F.");
    }
  }

  async function deleteVoucher(id) {
    if (!confirm("\u062D\u0630\u0641 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u0651\u062F\u0629 \u0646\u0647\u0627\u0626\u064A\u064B\u0627\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id), { method: "DELETE" });
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0630\u0641 \u0627\u0644\u0633\u0646\u062F.");
    }
  }

  async function reverseVoucher(id) {
    if (!confirm("\u0639\u0643\u0633 \u0647\u0630\u0627 \u0627\u0644\u0633\u0646\u062F \u0627\u0644\u0645\u064F\u0631\u062D\u064E\u0651\u0644\u061F")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(id) + "reverse/", { method: "POST" });
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0639\u0643\u0633 \u0627\u0644\u0633\u0646\u062F.");
    }
  }

  function resetVoucherForm() {
    document.getElementById("v-date").value = todayISO();
    document.getElementById("v-amount").value = "0";
    document.getElementById("v-currency").value = "EGP";
    document.getElementById("v-exchange-rate").value = "1";
    document.getElementById("v-payment-method").value = "cash";
    document.getElementById("v-booking-ref").value = "";
    document.getElementById("v-transaction-ref").value = "";
    document.getElementById("v-description").value = "";
    document.getElementById("v-attachment").value = "";
    document.getElementById("v-attachment-preview").innerHTML = "";
    pendingAttachment = null;
  }

  async function saveVoucher(confirmAndPost) {
    var payload = {
      type: currentType,
      date: document.getElementById("v-date").value,
      party: document.getElementById("v-party").value,
      amount: document.getElementById("v-amount").value,
      currency: document.getElementById("v-currency").value,
      exchange_rate: document.getElementById("v-exchange-rate").value,
      payment_method: document.getElementById("v-payment-method").value,
      treasury_account: document.getElementById("v-treasury-account").value,
      party_control_account: document.getElementById("v-control-account").value,
      booking_reference: document.getElementById("v-booking-ref").value.trim(),
      transaction_reference: document.getElementById("v-transaction-ref").value.trim(),
      description: document.getElementById("v-description").value.trim(),
    };
    if (pendingAttachment) {
      payload.attachment_name = pendingAttachment.name;
      payload.attachment_data = pendingAttachment.dataUrl;
    }

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHERS, { method: "POST", body: payload });
      if (confirmAndPost) {
        var vid = result.data.id;
        await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "submit/", { method: "POST" });
        await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "approve/", { method: "POST" });
        await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "post_voucher/", { method: "POST" });
      }
      closeModal("modal-add-voucher");
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0633\u0646\u062F.");
    }
  }

  // =========================================================================
  // Suppliers (AP) -- built from posted payment vouchers, grouped by party
  // =========================================================================

  var activeSupplierParty = null;

  function renderSuppliersTable() {
    var query = (document.getElementById("supplier-search").value || "").trim().toLowerCase();

    var supplierParties = partiesCache.filter(function (p) { return p.type === "supplier"; });
    var rows = supplierParties.filter(function (p) {
      return !query || (p.full_name || "").toLowerCase().includes(query);
    });

    var tbody = document.getElementById("suppliers-table-body");
    var table = document.getElementById("suppliers-table");
    var empty = document.getElementById("suppliers-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (p) {
      var balance = Number(p.balance) || 0;
      var payStatus = balance <= 0 ? "paid" : (balance < 1000 ? "partial" : "unpaid");
      var statusLabel = balance <= 0 ? "\u0645\u062F\u0641\u0648\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644" : (balance < 1000 ? "\u0645\u062F\u0641\u0648\u0639 \u062C\u0632\u0626\u064A\u064B\u0627" : "\u063A\u064A\u0631 \u0645\u062F\u0641\u0648\u0639");
      return "<tr>" +
        "<td>" + escapeHtml(p.full_name) + "</td>" +
        "<td class=\"num\">" + fmtMoney(balance) + "</td>" +
        "<td><span class=\"status-badge status-badge--" + payStatus + "\">" + statusLabel + "</span></td>" +
        "<td>" + (balance > 0 ? "<button class=\"btn-workflow-next\" data-pay-supplier=\"" + p.id + "\">\u0633\u062F\u0627\u062F \u0644\u0644\u0645\u0648\u0631\u062F</button>" : "-") + "</td>" +
      "</tr>";
    }).join("");

    document.querySelectorAll("[data-pay-supplier]").forEach(function (btn) {
      btn.addEventListener("click", function () { openPaySupplierModal(btn.dataset.paySupplier); });
    });
  }

  function openPaySupplierModal(partyId) {
    var party = partiesCache.find(function (p) { return String(p.id) === partyId; });
    if (!party) return;
    activeSupplierParty = party;
    document.getElementById("ps-party-name").value = party.full_name;
    document.getElementById("ps-amount").value = party.balance;
    openModal("modal-pay-supplier");
  }

  async function confirmPaySupplier() {
    if (!activeSupplierParty) return;
    var payload = {
      type: "payment",
      date: todayISO(),
      party: activeSupplierParty.id,
      amount: document.getElementById("ps-amount").value,
      treasury_account: document.getElementById("ps-treasury-account").value,
      party_control_account: document.getElementById("ps-control-account").value,
      description: "\u0633\u062F\u0627\u062F \u0644\u0644\u0645\u0648\u0631\u062F -- " + activeSupplierParty.full_name,
    };

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHERS, { method: "POST", body: payload });
      var vid = result.data.id;
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "submit/", { method: "POST" });
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "approve/", { method: "POST" });
      await VVApi.request(VV_CONFIG.ENDPOINTS.VOUCHER_DETAIL(vid) + "post_voucher/", { method: "POST" });
      closeModal("modal-pay-supplier");
      activeSupplierParty = null;
      await loadParties();
      renderSuppliersTable();
      await loadVouchers();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0633\u062F\u0627\u062F \u0627\u0644\u0645\u0648\u0631\u062F.");
    }
  }

  async function loadParties() {
    try {
      partiesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.PARTIES);
      document.getElementById("v-party").innerHTML = partiesCache.map(function (p) {
      document.getElementById("v-party").innerHTML = partiesCache.map(function (p) {
        return "<option value=\"" + p.id + "\">" + escapeHtml(p.full_name) + " (" + escapeHtml(p.code) + ")</option>";
      }).join("");
    } catch (err) { /* silent */ }
  }

  // =========================================================================
  // Vaults & Banks -- treasury (asset) accounts shown as balance cards
  // =========================================================================

  function renderVaultCards() {
    var vaultAccounts = accountsCache.filter(function (a) { return a.type === "asset"; });
    var grid = document.getElementById("vault-grid");
    if (!grid) return;
    if (vaultAccounts.length === 0) {
      grid.innerHTML = "<div class=\"empty-state\"><p>\u0644\u0627 \u062A\u0648\u062C\u062F \u062D\u0633\u0627\u0628\u0627\u062A \u062E\u0632\u064A\u0646\u0629 \u0628\u0639\u062F.</p></div>";
      return;
    }
    grid.innerHTML = vaultAccounts.map(function (a) {
      return "<div class=\"vault-card\"><div class=\"vault-card__name\">" + escapeHtml(a.name) + " (" + escapeHtml(a.code) + ")</div><div class=\"vault-card__balance\">" + fmtMoney(a.balance) + " " + escapeHtml(a.currency || "EGP") + "</div></div>";
    }).join("");
  }

  // =========================================================================
  // CSV Export
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportVouchersCsv() {
    var query = (document.getElementById("voucher-search").value || "").trim().toLowerCase();
    var dateFilter = document.getElementById("voucher-filter-date").value;
    var rows = vouchersCache.filter(function (v) {
      var matchesType = v.type === currentType;
      var matchesQuery = !query || (v.party_name || "").toLowerCase().includes(query);
      var matchesDate = !dateFilter || v.date === dateFilter;
      return matchesType && matchesQuery && matchesDate;
    });
    if (rows.length === 0) { alert("\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0644\u062A\u0635\u062F\u064A\u0631\u0647\u0627."); return; }

    var lines = [["\u0627\u0644\u0631\u0642\u0645", "\u0627\u0644\u062A\u0627\u0631\u064A\u062E", "\u0627\u0644\u062D\u0633\u0627\u0628", "\u0627\u0644\u0645\u0628\u0644\u063A", "\u0627\u0644\u0639\u0645\u0644\u0629", "\u0637\u0631\u064A\u0642\u0629 \u0627\u0644\u062F\u0641\u0639", "\u0627\u0644\u0645\u0631\u062C\u0639", "\u0627\u0644\u062D\u0627\u0644\u0629"].map(csvEscape).join(",")];
    rows.forEach(function (v) {
      lines.push([v.number, v.date, v.party_name, v.amount, v.currency, PAYMENT_METHOD_LABELS_AR[v.payment_method], v.booking_reference, STATUS_LABELS[v.status]].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Vouchers-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportSuppliersCsv() {
    var query = (document.getElementById("supplier-search").value || "").trim().toLowerCase();
    var supplierParties = partiesCache.filter(function (p) { return p.type === "supplier"; });
    var rows = supplierParties.filter(function (p) { return !query || (p.full_name || "").toLowerCase().includes(query); });
    if (rows.length === 0) { alert("\u0644\u0627 \u062A\u0648\u062C\u062F \u0628\u064A\u0627\u0646\u0627\u062A \u0644\u062A\u0635\u062F\u064A\u0631\u0647\u0627."); return; }

    var lines = [["\u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u0631\u062F", "\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u0633\u062A\u062D\u0642", "\u0627\u0644\u062D\u0627\u0644\u0629"].map(csvEscape).join(",")];
    rows.forEach(function (p) {
      var balance = Number(p.balance) || 0;
      var statusLabel = balance <= 0 ? "\u0645\u062F\u0641\u0648\u0639" : "\u063A\u064A\u0631 \u0645\u062F\u0641\u0648\u0639";
      lines.push([p.full_name, balance, statusLabel].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Suppliers-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
})();
