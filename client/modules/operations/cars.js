(function () {
  "use strict";

  var DEPARTMENT = "car";
  var confirmedBookings = [];
  var pendingBookings = [];
  var showPendingReportOnly = false;

  function fmtMoney(n) {
    return (Number(n) || 0).toFixed(2);
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function on(id, event, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  }

  async function loadConfirmedBookings(search) {
    try {
      var params = "?department=" + DEPARTMENT + "&status=confirmed";
      if (search) params += "&search=" + encodeURIComponent(search);
      confirmedBookings = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.BOOKINGS + params);
    } catch (err) {
      confirmedBookings = [];
    }
    renderConfirmedTable();
  }

  async function loadPendingBookings() {
    try {
      pendingBookings = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.BOOKINGS + "?department=" + DEPARTMENT + "&status=pending");
    } catch (err) {
      pendingBookings = [];
    }
    renderPendingTable();
  }

  async function loadFileNumberSuggestions(query, datalistId) {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_FILE_NUMBERS + "?search=" + encodeURIComponent(query || ""));
      var datalist = document.getElementById(datalistId);
      if (!datalist) return;
      datalist.innerHTML = result.data.map(function (item) {
        return "<option value=\"" + item.file_number + "\">" + item.names.join(" / ") + "</option>";
      }).join("");
    } catch (err) { }
  }

  var salesPaymentSwitch = null;

  function wirePaymentSwitch(prefix) {
    var selected = null;
    var formId = prefix === "sales" ? "sales-form" : "requests-form";
    var options = document.querySelectorAll("#" + formId + " .pay-switch-form__option");

    function select(status) {
      selected = status;
      options.forEach(function (el) { el.classList.toggle("is-selected", el.dataset.formPay === status); });
      if (prefix === "sales") {
        var row = document.getElementById("sales-partial-row");
        if (row) row.style.display = status === "partial" ? "flex" : "none";
        updateRemainingPreview();
      }
    }

    function updateRemainingPreview() {
      if (prefix !== "sales" || selected !== "partial") return;
      var sellingEl = document.getElementById("sales-selling-rate");
      var paidEl = document.getElementById("sales-paid-amount");
      var previewEl = document.getElementById("sales-remaining-preview");
      if (!sellingEl || !paidEl || !previewEl) return;
      var selling = Number(sellingEl.value) || 0;
      var paid = Number(paidEl.value) || 0;
      var remaining = Math.max(0, Math.round((selling - paid) * 100) / 100);
      previewEl.textContent = "Remaining: " + remaining.toFixed(2);
    }

    options.forEach(function (btn) {
      btn.addEventListener("click", function (evt) {
        evt.preventDefault();
        select(btn.dataset.formPay);
      });
    });
    if (prefix === "sales") {
      var paidInput = document.getElementById("sales-paid-amount");
      var sellingInput = document.getElementById("sales-selling-rate");
      if (paidInput) paidInput.addEventListener("input", updateRemainingPreview);
      if (sellingInput) sellingInput.addEventListener("input", updateRemainingPreview);
    }

    return {
      get: function () { return selected; },
      reset: function () {
        selected = null;
        options.forEach(function (el) { el.classList.remove("is-selected"); });
        if (prefix === "sales") {
          var row = document.getElementById("sales-partial-row");
          var paidEl = document.getElementById("sales-paid-amount");
          var previewEl = document.getElementById("sales-remaining-preview");
          if (row) row.style.display = "none";
          if (paidEl) paidEl.value = "";
          if (previewEl) previewEl.textContent = "";
        }
      },
    };
  }

  function paymentCellHtml(item) {
    if (item.collection_status === "cash" || item.collection_status === "instapay" || item.collection_status === "bank") {
      var label = item.collection_status === "cash" ? "Cash" : item.collection_status === "instapay" ? "InstaPay" : "Bank";
      return "<span class=\"pay-badge-paid\">" + label + "</span>";
    }
    if (item.collection_status === "partial") {
      return "<span class=\"pay-badge-remaining\">Remaining " + fmtMoney(item.remaining_amount) + "</span>";
    }
    return "<span class=\"pay-badge-none\">-</span>";
  }

  function buildRows(tbody, rows, isPendingReportView) {
    tbody.innerHTML = rows.map(function (item) {
      var profitClass = item.profit >= 0 ? "profit-pos" : "profit-neg";
      var reviewChip = isPendingReportView
        ? "<span class=\"review-status-chip review-status-chip--" + (item.review_status === "reviewed" ? "reviewed" : "pending") + "\">" + (item.review_status === "reviewed" ? "Reviewed" : "Pending") + "</span>"
        : "";
      return "" +
      "<tr>" +
        "<td>" + item.id + "</td>" +
        "<td>" + item.date + "</td>" +
        "<td>" + (item.check_out || "-") + "</td>" +
        "<td>" + (item.driver_name || "-") + "</td>" +
        "<td>" + (item.driver_phone || "-") + "</td>" +
        "<td>" + (item.car_type || "-") + "</td>" +
        "<td><strong>" + item.passenger_name + "</strong>" + reviewChip + "</td>" +
        "<td>" + (item.customer_name || "-") + "</td>" +
        "<td><span class=\"mono\">" + (item.customer_code || "-") + "</span></td>" +
        "<td>" + (item.from_location || "-") + "</td>" +
        "<td>" + (item.to_location || "-") + "</td>" +
        "<td class=\"num\">" + (item.passenger_count != null ? item.passenger_count : "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.net_rate) + "</td>" +
        "<td>" + (item.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.selling_rate) + " " + item.currency + "</td>" +
        "<td class=\"num " + profitClass + "\">" + fmtMoney(item.profit) + " " + item.currency + "</td>" +
        "<td><span class=\"mono\">" + (item.file_number || "-") + "</span></td>" +
        "<td>" + (item.note || "-") + "</td>" +
        "<td>" + paymentCellHtml(item) + "</td>" +
        "<td>" +
          "<button class=\"row-action-btn\" data-edit-sale=\"" + item.id + "\" title=\"Edit\">Edit</button>" +
          "<button class=\"row-action-btn is-danger\" data-delete-sale=\"" + item.id + "\" title=\"Cancel\">Cancel</button>" +
        "</td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-edit-sale]").forEach(function (b) {
      b.addEventListener("click", function () { editSale(b.dataset.editSale); });
    });
    tbody.querySelectorAll("[data-delete-sale]").forEach(function (b) {
      b.addEventListener("click", function () { deleteSale(b.dataset.deleteSale); });
    });
  }

  function renderConfirmedTable() {
    var searchEl = document.getElementById("sales-report-search");
    var query = searchEl ? (searchEl.value || "").trim().toLowerCase() : "";
    var rows = confirmedBookings;
    if (showPendingReportOnly) rows = rows.filter(function (r) { return r.review_status === "pending"; });
    if (query) {
      rows = rows.filter(function (r) {
        return r.passenger_name.toLowerCase().indexOf(query) !== -1 || (r.file_number || "").toLowerCase().indexOf(query) !== -1;
      });
    }

    var latestTbody = document.getElementById("sales-report-table-body");
    var latestTable = document.getElementById("sales-report-table");
    var latestEmpty = document.getElementById("sales-report-empty");
    if (latestTbody && latestTable && latestEmpty) {
      var latestRows = rows.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 10);
      if (latestRows.length === 0) { latestTable.style.display = "none"; latestEmpty.style.display = "block"; }
      else { latestTable.style.display = "table"; latestEmpty.style.display = "none"; buildRows(latestTbody, latestRows, true); }
    }

    var fullTbody = document.getElementById("booking-sales-report-table-body");
    if (fullTbody) {
      var fullRows = rows.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
      buildRows(fullTbody, fullRows, true);
    }
  }

  function renderPendingTable() {
    var tbody = document.getElementById("requests-table-body");
    var table = document.getElementById("requests-table");
    var empty = document.getElementById("requests-empty");
    if (!tbody || !table || !empty) return;
    if (pendingBookings.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table"; empty.style.display = "none";

    tbody.innerHTML = pendingBookings.map(function (item) {
      return "" +
      "<tr>" +
        "<td>" + item.id + "</td>" +
        "<td>" + item.date + "</td>" +
        "<td>" + (item.check_out || "-") + "</td>" +
        "<td>" + (item.driver_name || "-") + "</td>" +
        "<td>" + (item.driver_phone || "-") + "</td>" +
        "<td>" + (item.car_type || "-") + "</td>" +
        "<td><strong>" + item.passenger_name + "</strong></td>" +
        "<td>" + (item.customer_name || "-") + "</td>" +
        "<td><span class=\"mono\">" + (item.customer_code || "-") + "</span></td>" +
        "<td>" + (item.from_location || "-") + "</td>" +
        "<td>" + (item.to_location || "-") + "</td>" +
        "<td class=\"num\">" + (item.passenger_count != null ? item.passenger_count : "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.net_rate) + "</td>" +
        "<td>" + (item.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.selling_rate) + " " + item.currency + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.profit) + " " + item.currency + "</td>" +
        "<td><span class=\"mono\">" + (item.file_number || "-") + "</span></td>" +
        "<td>" + (item.note || "-") + "</td>" +
        "<td><button class=\"btn btn--ghost\" style=\"padding:3px 8px; font-size:11px;\" data-confirm-request=\"" + item.id + "\">Confirm</button></td>" +
        "<td>" +
          "<button class=\"row-action-btn\" data-edit-request=\"" + item.id + "\" title=\"Edit\">Edit</button>" +
          "<button class=\"row-action-btn is-danger\" data-delete-request=\"" + item.id + "\" title=\"Delete\">Delete</button>" +
        "</td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-confirm-request]").forEach(function (b) {
      b.addEventListener("click", function () { confirmRequest(b.dataset.confirmRequest); });
    });
    tbody.querySelectorAll("[data-edit-request]").forEach(function (b) {
      b.addEventListener("click", function () { editRequest(b.dataset.editRequest); });
    });
    tbody.querySelectorAll("[data-delete-request]").forEach(function (b) {
      b.addEventListener("click", function () { deleteRequest(b.dataset.deleteRequest); });
    });
  }

  var editingSaleId = null;

  function buildPayload(prefix) {
    function val(id) {
      var el = document.getElementById(id);
      return el ? el.value : "";
    }
    var payload = {
      department: DEPARTMENT,
      date: val(prefix + "-checkin"),
      check_out: val(prefix + "-checkout") || null,
      driver_name: val(prefix + "-driver-name"),
      driver_phone: val(prefix + "-driver-phone"),
      car_type: val(prefix + "-car-type"),
      passenger_name: val(prefix + "-client-name"),
      customer_name: val(prefix + "-customer"),
      from_location: val(prefix + "-from-location"),
      to_location: val(prefix + "-to-location"),
      passenger_count: val(prefix + "-passenger-count") || null,
      net_rate: val(prefix + "-net-rate") || "0",
      supplier: val(prefix + "-suppliers"),
      selling_rate: val(prefix + "-selling-rate") || "0",
      currency: val(prefix + "-currency"),
      file_number: val(prefix + "-file-number"),
      note: val(prefix + "-note"),
    };
    payload.customer = VVCustomerCode.collectPayload(prefix).customer;
    if (prefix === "sales" && salesPaymentSwitch) {
      var status = salesPaymentSwitch.get();
      if (status) {
        payload.collection_status = status;
        if (status === "partial") payload.paid_amount = val("sales-paid-amount") || "0";
      }
    }
    return payload;
  }

  async function submitSale(e) {
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
    var payload = buildPayload("sales");
    var btn = document.getElementById("btn-submit-sale");
    if (btn) btn.disabled = true;
    try {
      if (editingSaleId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_DETAIL(editingSaleId), { method: "PATCH", body: payload });
      } else {
        payload.status = "confirmed";
        await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS, { method: "POST", body: payload });
      }
      resetSalesForm();
      await loadConfirmedBookings();
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
    return false;
  }

  function resetSalesForm() {
    var form = document.getElementById("sales-form");
    if (form) form.reset();
    editingSaleId = null;
    var btn = document.getElementById("btn-submit-sale");
    if (btn) btn.textContent = "Add Booking";
    if (salesPaymentSwitch) salesPaymentSwitch.reset();
    var dateEl = document.getElementById("sales-checkin");
    if (dateEl) dateEl.value = todayISO();
    VVCustomerCode.reset("sales");
  }

  function editSale(id) {
    var record = confirmedBookings.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("Record no longer exists."); return; }
    function set(id2, value) { var el = document.getElementById(id2); if (el) el.value = value; }
    set("sales-checkin", record.date);
    set("sales-checkout", record.check_out || "");
    set("sales-driver-name", record.driver_name);
    set("sales-driver-phone", record.driver_phone);
    set("sales-car-type", record.car_type);
    set("sales-client-name", record.passenger_name);
    set("sales-customer", record.customer_name);
    set("sales-from-location", record.from_location);
    set("sales-to-location", record.to_location);
    set("sales-passenger-count", record.passenger_count != null ? record.passenger_count : "");
    set("sales-net-rate", record.net_rate);
    set("sales-suppliers", record.supplier);
    set("sales-selling-rate", record.selling_rate);
    set("sales-currency", record.currency);
    set("sales-file-number", record.file_number);
    set("sales-note", record.note);
    VVCustomerCode.populate("sales", record);

    if (salesPaymentSwitch) {
      salesPaymentSwitch.reset();
      if (record.collection_status) {
        var optionBtn = document.querySelector("#sales-form [data-form-pay=\"" + record.collection_status + "\"]");
        if (optionBtn) optionBtn.click();
        if (record.collection_status === "partial") set("sales-paid-amount", record.paid_amount);
      }
    }

    editingSaleId = id;
    var btn = document.getElementById("btn-submit-sale");
    if (btn) btn.textContent = "Update Booking";

    var dash = document.getElementById("dept-dashboard-view");
    var detail = document.getElementById("dept-detail-view");
    if (dash) dash.style.display = "none";
    if (detail) detail.style.display = "block";
    var form = document.getElementById("sales-form");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function deleteSale(id) {
    var record = confirmedBookings.find(function (r) { return String(r.id) === String(id); });
    if (!record) return;
    if (!confirm("Cancel booking for \"" + record.passenger_name + "\"?")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_DETAIL(id), { method: "DELETE" });
      await loadConfirmedBookings();
    } catch (err) {
      alert(err.message || "Failed to cancel.");
    }
  }

  var editingRequestId = null;

  async function submitRequest(e) {
    if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
    var payload = buildPayload("req");
    var btn = document.getElementById("btn-submit-request");
    if (btn) btn.disabled = true;
    try {
      if (editingRequestId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_DETAIL(editingRequestId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS, { method: "POST", body: payload });
      }
      var form = document.getElementById("requests-form");
      if (form) form.reset();
      editingRequestId = null;
      if (btn) btn.textContent = "Save Request";
      var dateEl = document.getElementById("req-checkin");
      if (dateEl) dateEl.value = todayISO();
      VVCustomerCode.reset("req");
      await loadPendingBookings();
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
    return false;
  }

  function editRequest(id) {
    var record = pendingBookings.find(function (r) { return String(r.id) === String(id); });
    if (!record) return;
    function set(id2, value) { var el = document.getElementById(id2); if (el) el.value = value; }
    set("req-checkin", record.date);
    set("req-checkout", record.check_out || "");
    set("req-driver-name", record.driver_name);
    set("req-driver-phone", record.driver_phone);
    set("req-car-type", record.car_type);
    set("req-client-name", record.passenger_name);
    set("req-customer", record.customer_name);
    set("req-from-location", record.from_location);
    set("req-to-location", record.to_location);
    set("req-passenger-count", record.passenger_count != null ? record.passenger_count : "");
    set("req-net-rate", record.net_rate);
    set("req-suppliers", record.supplier);
    set("req-selling-rate", record.selling_rate);
    set("req-currency", record.currency);
    set("req-file-number", record.file_number);
    set("req-note", record.note);
    VVCustomerCode.populate("req", record);
    editingRequestId = id;
    var btn = document.getElementById("btn-submit-request");
    if (btn) btn.textContent = "Update Request";
    var form = document.getElementById("requests-form");
    if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function deleteRequest(id) {
    if (!confirm("Delete this request?")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_DETAIL(id), { method: "DELETE" });
      await loadPendingBookings();
    } catch (err) {
      alert(err.message || "Failed to delete.");
    }
  }

  async function confirmRequest(id) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKING_CONFIRM(id), { method: "POST" });
      await loadPendingBookings();
      await loadConfirmedBookings();
    } catch (err) {
      alert(err.message || "Failed to confirm.");
    }
  }

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportToCsv() {
    if (confirmedBookings.length === 0) { alert("No bookings to export."); return; }
    var columns = ["id", "date", "check_out", "driver_name", "driver_phone", "car_type", "passenger_name", "customer_name", "customer_code", "from_location", "to_location", "passenger_count", "net_rate", "supplier", "selling_rate", "currency", "profit", "file_number", "note"];
    var labels = ["ID", "Departure Date", "Return Date", "Driver Name", "Driver Phone", "Car Type", "Client Name", "Client Phone", "Customer Code", "From", "To", "Passengers", "Net Rate", "Supplier", "Selling Rate", "Currency", "Profit", "File #", "Note"];
    var lines = [labels.map(csvEscape).join(",")];
    confirmedBookings.forEach(function (item) {
      lines.push(columns.map(function (c) { return csvEscape(item[c]); }).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Cars-Backup-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var salesForm = document.getElementById("sales-form");
    var requestsForm = document.getElementById("requests-form");
    if (salesForm) salesForm.setAttribute("onsubmit", "return false;");
    if (requestsForm) requestsForm.setAttribute("onsubmit", "return false;");

    on("btn-submit-sale", "click", submitSale);
    on("btn-submit-request", "click", submitRequest);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var el = document.getElementById(btn.dataset.closeModal);
        if (el) el.classList.remove("is-open");
      });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach(function (o) { o.classList.remove("is-open"); });
    });

    salesPaymentSwitch = wirePaymentSwitch("sales");
    wirePaymentSwitch("req");

    VVCustomerCode.wirePicker("sales");
    VVCustomerCode.wirePicker("req");

    on("hub-open-pending", "click", function (e) {
      if (e) e.preventDefault();
      var modal = document.getElementById("modal-pending");
      if (modal) modal.classList.add("is-open");
      loadPendingBookings();
    });
    on("hub-open-bookings", "click", function (e) {
      if (e) e.preventDefault();
      var dash = document.getElementById("dept-dashboard-view");
      var detail = document.getElementById("dept-detail-view");
      if (dash) dash.style.display = "none";
      if (detail) detail.style.display = "block";
    });
    on("btn-back-dept-dashboard", "click", function (e) {
      if (e) e.preventDefault();
      var dash = document.getElementById("dept-dashboard-view");
      var detail = document.getElementById("dept-detail-view");
      if (detail) detail.style.display = "none";
      if (dash) dash.style.display = "block";
      resetSalesForm();
    });

    on("sales-report-search", "input", function () { renderConfirmedTable(); });
    on("btn-view-all-sales", "click", function (e) {
      if (e) e.preventDefault();
      showPendingReportOnly = false;
      this.classList.add("is-active");
      var other = document.getElementById("btn-view-pending-sales");
      if (other) other.classList.remove("is-active");
      renderConfirmedTable();
    });
    on("btn-view-pending-sales", "click", function (e) {
      if (e) e.preventDefault();
      showPendingReportOnly = true;
      this.classList.add("is-active");
      var other = document.getElementById("btn-view-all-sales");
      if (other) other.classList.remove("is-active");
      renderConfirmedTable();
    });

    on("btn-export-backup-csv", "click", function (e) { if (e) e.preventDefault(); exportToCsv(); });

    on("sales-file-number", "input", function (e) {
      loadFileNumberSuggestions(e.target.value, "file-number-suggestions");
    });
    on("req-file-number", "input", function (e) {
      loadFileNumberSuggestions(e.target.value, "file-number-suggestions-req");
    });

    var salesDate = document.getElementById("sales-checkin");
    var reqDate = document.getElementById("req-checkin");
    if (salesDate) salesDate.value = todayISO();
    if (reqDate) reqDate.value = todayISO();

    loadConfirmedBookings();
  });
})();