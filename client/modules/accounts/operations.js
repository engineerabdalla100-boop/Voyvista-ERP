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

  var DEPT_LABELS_AR = { flight: "\u0637\u064A\u0631\u0627\u0646", hotel: "\u0641\u0646\u0627\u062F\u0642", visa: "\u062A\u0623\u0634\u064A\u0631\u0627\u062A" };

  var pendingCache = [];
  var lockedCache = [];
  var accountsCache = [];
  var activeBookingId = null;
  var activeCancelBooking = null;

  document.addEventListener("DOMContentLoaded", function () {
    loadAccounts();
    loadPending();
    loadLocked();

    document.getElementById("ops-search")?.addEventListener("input", renderPendingTable);
    document.getElementById("locked-search")?.addEventListener("input", renderLockedTable);
    document.getElementById("btn-confirm-approve")?.addEventListener("click", confirmApprove);
    document.getElementById("btn-confirm-cancel")?.addEventListener("click", confirmCancel);
    document.getElementById("cancel-supplier-penalty")?.addEventListener("input", updateCancelLiveSummary);
    document.getElementById("cancel-client-penalty")?.addEventListener("input", updateCancelLiveSummary);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
  });

  // =========================================================================
  // Shared
  // =========================================================================

  async function loadAccounts() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.ACCOUNTS_COA);
      accountsCache = result.data.results || result.data;
      var options = function (list) { return list.map(function (a) { return "<option value=\"" + a.id + "\">" + escapeHtml(a.code) + " -- " + escapeHtml(a.name) + "</option>"; }).join(""); };

      document.getElementById("ap-ar-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "asset"; }));
      document.getElementById("ap-revenue-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "revenue"; }));
      document.getElementById("ap-cogs-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "expense"; }));
      document.getElementById("ap-ap-account").innerHTML = options(accountsCache.filter(function (a) { return a.type === "liability"; }));

      var expenseAccounts = accountsCache.filter(function (a) { return a.type === "expense"; });
      var revenueAccounts = accountsCache.filter(function (a) { return a.type === "revenue"; });
      document.getElementById("cancel-supplier-penalty-account").innerHTML = "<option value=\"\">-- \u0628\u062F\u0648\u0646 --</option>" + options(expenseAccounts);
      document.getElementById("cancel-client-penalty-account").innerHTML = "<option value=\"\">-- \u0628\u062F\u0648\u0646 --</option>" + options(revenueAccounts);
    } catch (err) { /* silent */ }
  }

  // =========================================================================
  // Pending Approval
  // =========================================================================

  async function loadPending() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.OPERATIONS_PENDING);
      pendingCache = result.data.results || [];
    } catch (err) { pendingCache = []; }
    renderPendingTable();
  }

  function renderPendingTable() {
    var query = (document.getElementById("ops-search").value || "").trim().toLowerCase();
    var rows = pendingCache.filter(function (r) {
      return !query || (r.passenger_name || "").toLowerCase().includes(query) || (r.supplier || "").toLowerCase().includes(query);
    });

    var tbody = document.getElementById("ops-table-body");
    var table = document.getElementById("ops-table");
    var empty = document.getElementById("ops-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (r) {
      var profit = Number(r.profit);
      return "<tr>" +
        "<td><span class=\"dept-tag dept-tag--" + r.department + "\">" + (DEPT_LABELS_AR[r.department] || r.department) + "</span></td>" +
        "<td>" + escapeHtml(r.date) + "</td>" +
        "<td>" + escapeHtml(r.passenger_name || r.customer_name || "-") + "</td>" +
        "<td>" + escapeHtml(r.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(r.net_rate) + "</td>" +
        "<td class=\"num\">" + fmtMoney(r.selling_rate) + "</td>" +
        "<td class=\"num " + (profit >= 0 ? "profit-positive" : "profit-negative") + "\">" + fmtMoney(r.profit) + "</td>" +
        "<td><button class=\"btn-approve\" data-approve-booking=\"" + r.id + "\">\u0627\u0639\u062A\u0645\u0627\u062F \u0648\u0642\u0641\u0644</button></td>" +
      "</tr>";
    }).join("");

    document.querySelectorAll("[data-approve-booking]").forEach(function (btn) {
      btn.addEventListener("click", function () { openApproveModal(btn.dataset.approveBooking); });
    });
  }

  function openApproveModal(id) {
    var booking = pendingCache.find(function (r) { return String(r.id) === id; });
    if (!booking) return;
    activeBookingId = id;

    document.getElementById("approve-summary").innerHTML =
      "<div class=\"summary-line\"><span>\u0627\u0644\u0639\u0645\u064A\u0644</span><strong>" + escapeHtml(booking.passenger_name || booking.customer_name || "-") + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u0627\u0644\u0645\u0648\u0631\u062F</span><strong>" + escapeHtml(booking.supplier || "-") + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u0633\u0639\u0631 \u0627\u0644\u062A\u0643\u0644\u0641\u0629</span><strong>" + fmtMoney(booking.net_rate) + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u0633\u0639\u0631 \u0627\u0644\u0628\u064A\u0639</span><strong>" + fmtMoney(booking.selling_rate) + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u0627\u0644\u0647\u0627\u0645\u0634</span><strong>" + fmtMoney(booking.profit) + "</strong></div>";

    openModal("modal-approve");
  }

  async function confirmApprove() {
    if (!activeBookingId) return;
    var payload = {
      ar_account: document.getElementById("ap-ar-account").value,
      revenue_account: document.getElementById("ap-revenue-account").value,
      cogs_account: document.getElementById("ap-cogs-account").value,
      ap_account: document.getElementById("ap-ap-account").value,
    };

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.OPERATIONS_APPROVE(activeBookingId), { method: "POST", body: payload });
      closeModal("modal-approve");
      activeBookingId = null;
      await loadPending();
      await loadLocked();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0627\u0639\u062A\u0645\u0627\u062F \u0627\u0644\u0639\u0645\u0644\u064A\u0629.");
    }
  }

  // =========================================================================
  // Locked (Approved) Bookings + Cancellation
  // =========================================================================

  async function loadLocked() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS + "?record_status=active");
      var allBookings = result.data.results || result.data;
      lockedCache = allBookings.filter(function (b) { return b.accounting_status === "locked"; });

      for (var i = 0; i < lockedCache.length; i++) {
        try {
          var summaryResult = await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS + lockedCache[i].id + "/payment_summary/");
          lockedCache[i].payment_summary = summaryResult.data;
        } catch (e) {
          lockedCache[i].payment_summary = { total_collected: "0", remaining: lockedCache[i].selling_rate };
        }
      }
    } catch (err) { lockedCache = []; }
    renderLockedTable();
  }

  function renderLockedTable() {
    var query = (document.getElementById("locked-search").value || "").trim().toLowerCase();
    var rows = lockedCache.filter(function (r) {
      return !query || (r.passenger_name || "").toLowerCase().includes(query) || (r.supplier || "").toLowerCase().includes(query);
    });

    var tbody = document.getElementById("locked-table-body");
    var table = document.getElementById("locked-table");
    var empty = document.getElementById("locked-empty");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (r) {
      var collected = r.payment_summary ? r.payment_summary.total_collected : "0";
      return "<tr>" +
        "<td><span class=\"dept-tag dept-tag--" + r.department + "\">" + (DEPT_LABELS_AR[r.department] || r.department) + "</span></td>" +
        "<td>" + escapeHtml(r.date) + "</td>" +
        "<td>" + escapeHtml(r.passenger_name || r.customer_name || "-") + "</td>" +
        "<td>" + escapeHtml(r.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(r.selling_rate) + "</td>" +
        "<td class=\"num\">" + fmtMoney(collected) + "</td>" +
        "<td><button class=\"btn-cancel-op\" data-cancel-booking=\"" + r.id + "\">\u0625\u0644\u063A\u0627\u0621</button></td>" +
      "</tr>";
    }).join("");

    document.querySelectorAll("[data-cancel-booking]").forEach(function (btn) {
      btn.addEventListener("click", function () { openCancelModal(btn.dataset.cancelBooking); });
    });
  }

  async function openCancelModal(id) {
    var booking = lockedCache.find(function (r) { return String(r.id) === id; });
    if (!booking) return;
    activeCancelBooking = booking;

    document.getElementById("cancel-supplier-penalty").value = "0";
    document.getElementById("cancel-client-penalty").value = "0";
    document.getElementById("cancel-supplier-penalty-account").value = "";
    document.getElementById("cancel-client-penalty-account").value = "";
    document.getElementById("cancel-reason").value = "";

    renderCancelSnapshot();
    updateCancelLiveSummary();
    openModal("modal-cancel");
  }

  function renderCancelSnapshot() {
    var booking = activeCancelBooking;
    var collected = booking.payment_summary ? booking.payment_summary.total_collected : "0";
    document.getElementById("cancel-booking-snapshot").innerHTML =
      "<div class=\"summary-line\"><span>\u0625\u062C\u0645\u0627\u0644\u064A \u0642\u064A\u0645\u0629 \u0627\u0644\u0628\u064A\u0639 (Gross Rate)</span><strong>" + fmtMoney(booking.selling_rate) + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u0625\u062C\u0645\u0627\u0644\u064A \u0627\u0644\u0645\u062F\u0641\u0648\u0639 \u0645\u0646 \u0627\u0644\u0639\u0645\u064A\u0644</span><strong>" + fmtMoney(collected) + "</strong></div>" +
      "<div class=\"summary-line\"><span>\u062A\u0643\u0644\u0641\u0629 \u0627\u0644\u0645\u0648\u0631\u062F (Net Rate)</span><strong>" + fmtMoney(booking.net_rate) + "</strong></div>";
  }

  function updateCancelLiveSummary() {
    var booking = activeCancelBooking;
    if (!booking) return;

    var collected = Number(booking.payment_summary ? booking.payment_summary.total_collected : 0);
    var supplierPenalty = Number(document.getElementById("cancel-supplier-penalty").value) || 0;
    var clientPenalty = Number(document.getElementById("cancel-client-penalty").value) || 0;

    var refundable = collected - clientPenalty;
    var netGainLoss = clientPenalty - supplierPenalty;

    document.getElementById("cancel-live-summary").innerHTML =
      "<div class=\"summary-line\"><span>\u0635\u0627\u0641\u064A \u0627\u0644\u0645\u0628\u0644\u063A \u0627\u0644\u0645\u0633\u062A\u0631\u062F \u0644\u0644\u0639\u0645\u064A\u0644</span><strong>" + fmtMoney(Math.max(refundable, 0)) + "</strong></div>" +
      "<div class=\"summary-line total " + (netGainLoss >= 0 ? "positive" : "negative") + "\"><span>\u0635\u0627\u0641\u064A \u0623\u0631\u0628\u0627\u062D/\u062E\u0633\u0627\u0626\u0631 \u0627\u0644\u0625\u0644\u063A\u0627\u0621 \u0644\u0644\u0634\u0631\u0643\u0629</span><strong>" + fmtMoney(netGainLoss) + "</strong></div>";
  }

  async function confirmCancel() {
    if (!activeCancelBooking) return;

    var supplierPenalty = document.getElementById("cancel-supplier-penalty").value || "0";
    var clientPenalty = document.getElementById("cancel-client-penalty").value || "0";
    var supplierPenaltyAccount = document.getElementById("cancel-supplier-penalty-account").value;
    var clientPenaltyAccount = document.getElementById("cancel-client-penalty-account").value;
    var reason = document.getElementById("cancel-reason").value.trim() || "Booking cancelled";

    if (Number(supplierPenalty) > 0 && !supplierPenaltyAccount) {
      alert("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 \u0645\u0635\u0631\u0648\u0641 \u063A\u0631\u0627\u0645\u0629 \u0627\u0644\u0645\u0648\u0631\u062F \u0623\u0648\u0644\u0627\u064B.");
      return;
    }
    if (Number(clientPenalty) > 0 && !clientPenaltyAccount) {
      alert("\u0627\u062E\u062A\u0631 \u062D\u0633\u0627\u0628 \u0625\u064A\u0631\u0627\u062F \u063A\u0631\u0627\u0645\u0629 \u0627\u0644\u0639\u0645\u064A\u0644 \u0623\u0648\u0644\u0627\u064B.");
      return;
    }

    if (!confirm("\u062A\u0623\u0643\u064A\u062F \u0625\u0644\u063A\u0627\u0621 \u0647\u0630\u0627 \u0627\u0644\u062D\u062C\u0632 \u0648\u0639\u0643\u0633 \u0627\u0644\u0642\u064A\u062F \u0627\u0644\u0645\u062D\u0627\u0633\u0628\u064A \u0628\u0627\u0644\u0643\u0627\u0645\u0644\u061F \u0644\u0627 \u064A\u0645\u0643\u0646 \u0627\u0644\u062A\u0631\u0627\u062C\u0639 \u0639\u0646 \u0647\u0630\u0627 \u0627\u0644\u0625\u062C\u0631\u0627\u0621.")) return;

    var payload = { reason: reason, supplier_penalty: supplierPenalty, client_penalty: clientPenalty };
    if (supplierPenaltyAccount) payload.supplier_penalty_account = supplierPenaltyAccount;
    if (clientPenaltyAccount) payload.client_penalty_account = clientPenaltyAccount;

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.OPERATIONS_CANCEL(activeCancelBooking.id), { method: "POST", body: payload });
      closeModal("modal-cancel");
      activeCancelBooking = null;

      var message = "\u062A\u0645 \u0627\u0644\u0625\u0644\u063A\u0627\u0621 \u0628\u0646\u062C\u0627\u062D.";
      if (result.data.refund_voucher_id) {
        message += "\n\u062A\u0645 \u0625\u0646\u0634\u0627\u0621 \u0633\u0646\u062F \u0635\u0631\u0641 \u0645\u0633\u0648\u0651\u062F\u0629 \u0631\u0642\u0645 " + result.data.refund_voucher_number + " \u0628\u0642\u064A\u0645\u0629 " + fmtMoney(result.data.net_refundable) + " -- \u0645\u0631\u0627\u062C\u0639\u062A\u0647 \u0648\u0627\u0639\u062A\u0645\u0627\u062F\u0647 \u0645\u0646 \u0642\u0633\u0645 \u0627\u0644\u0633\u0646\u062F\u0627\u062A.";
      }
      alert(message);

      await loadLocked();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u062D\u062C\u0632.");
    }
  }
})();