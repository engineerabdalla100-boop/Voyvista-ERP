(function () {
  "use strict";

  var DEPARTMENT = "hotel";
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
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .split(String.fromCharCode(39)).join("&#039;");
  }
  function openModal(id) { var el = document.getElementById(id); if (el) el.classList.add("is-open"); }
  function closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove("is-open"); }
  var readFileAsDataUrl = function (file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // =========================================================================
  // Bookings: confirmed sales
  // =========================================================================

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
        "<td>" + (item.ticket_no || "-") + "</td>" +
        "<td><strong>" + item.passenger_name + "</strong>" + reviewChip + "</td>" +
        "<td>" + (item.hotel_name || "-") + "</td>" +
        "<td>" + (item.location || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.rate) + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.net_rate) + "</td>" +
        "<td>" + (item.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.selling_rate) + " " + item.currency + "</td>" +
        "<td class=\"num " + profitClass + "\">" + fmtMoney(item.profit) + " " + item.currency + "</td>" +
        "<td>" + (item.customer_name || "-") + "</td>" +
        "<td><span class=\"mono\">" + (item.customer_code || "-") + "</span></td>" +
        "<td><span class=\"mono\">" + (item.file_number || "-") + "</span></td>" +
        "<td>" + (item.discount_notice || "-") + "</td>" +
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
        "<td>" + (item.ticket_no || "-") + "</td>" +
        "<td><strong>" + item.passenger_name + "</strong></td>" +
        "<td>" + (item.hotel_name || "-") + "</td>" +
        "<td>" + (item.location || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.rate) + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.net_rate) + "</td>" +
        "<td>" + (item.supplier || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.selling_rate) + " " + item.currency + "</td>" +
        "<td class=\"num\">" + fmtMoney(item.profit) + " " + item.currency + "</td>" +
        "<td>" + (item.customer_name || "-") + "</td>" +
        "<td><span class=\"mono\">" + (item.customer_code || "-") + "</span></td>" +
        "<td><span class=\"mono\">" + (item.file_number || "-") + "</span></td>" +
        "<td>" + (item.discount_notice || "-") + "</td>" +
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
      ticket_no: val(prefix + "-invoice"),
      passenger_name: val(prefix + "-client-name"),
      hotel_name: val(prefix + "-hotel-name"),
      location: val(prefix + "-location"),
      rate: val(prefix + "-net") || "0",
      net_rate: val(prefix + "-net-rate") || "0",
      supplier: val(prefix + "-suppliers"),
      selling_rate: val(prefix + "-selling-rate") || "0",
      currency: val(prefix + "-currency"),
      customer_name: val(prefix + "-customer"),
      file_number: val(prefix + "-file-number"),
      discount_notice: val(prefix + "-discount-notice"),
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
    if (btn) btn.textContent = "Add Sale";
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
    set("sales-invoice", record.ticket_no);
    set("sales-client-name", record.passenger_name);
    set("sales-hotel-name", record.hotel_name);
    set("sales-location", record.location);
    set("sales-net", record.rate);
    set("sales-net-rate", record.net_rate);
    set("sales-suppliers", record.supplier);
    set("sales-selling-rate", record.selling_rate);
    set("sales-currency", record.currency);
    set("sales-profit", record.profit);
    set("sales-customer", record.customer_name);
    set("sales-file-number", record.file_number);
    set("sales-discount-notice", record.discount_notice);
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
    if (btn) btn.textContent = "Update Sale";

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
    set("req-invoice", record.ticket_no);
    set("req-client-name", record.passenger_name);
    set("req-hotel-name", record.hotel_name);
    set("req-location", record.location);
    set("req-net", record.rate);
    set("req-net-rate", record.net_rate);
    set("req-suppliers", record.supplier);
    set("req-selling-rate", record.selling_rate);
    set("req-currency", record.currency);
    set("req-profit", record.profit);
    set("req-customer", record.customer_name);
    set("req-file-number", record.file_number);
    set("req-discount-notice", record.discount_notice);
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
    if (confirmedBookings.length === 0) { alert("No sales to export."); return; }
    var columns = ["id", "date", "check_out", "ticket_no", "passenger_name", "hotel_name", "location", "rate", "net_rate", "supplier", "selling_rate", "currency", "profit", "customer_name", "customer_code", "file_number", "discount_notice", "note"];
    var labels = ["ID", "Check In", "Check Out", "Invoice", "Client Name", "Hotel Name", "Location", "Net", "Net Rate", "Supplier", "Selling Rate", "Currency", "Profit", "Customer", "Customer Code", "File #", "Discount Notice", "Note"];
    var lines = [labels.map(csvEscape).join(",")];
    confirmedBookings.forEach(function (item) {
      lines.push(columns.map(function (c) { return csvEscape(item[c]); }).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Hotels-Backup-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // Hotels Directory (existing)
  // =========================================================================

  var hotelsCache = [];
  var editingHotelId = null;
  var pendingPhotos = [];

  async function loadHotels() {
    try {
      hotelsCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.HOTELS_DIRECTORY);
    } catch (err) { hotelsCache = []; }
    renderHotelGrid();
  }

  function starsHtml(rating) {
    if (!rating) return "<span style=\"color:var(--text-faint); font-size:11px;\">Not rated</span>";
    var filled = "";
    var empty = "";
    for (var i = 0; i < rating; i++) filled += "\u2605";
    for (var j = rating; j < 5; j++) empty += "\u2606";
    return "<span style=\"color:#E0A82E; letter-spacing:1px;\">" + filled + empty + "</span>";
  }

  function renderHotelGrid() {
    var searchEl = document.getElementById("directory-search");
    var query = searchEl ? (searchEl.value || "").trim().toLowerCase() : "";
    var rows = hotelsCache.filter(function (h) {
      return !query || h.name.toLowerCase().indexOf(query) !== -1 || h.area.toLowerCase().indexOf(query) !== -1;
    });

    var grid = document.getElementById("hotel-grid");
    var empty = document.getElementById("hotel-empty");
    if (!grid || !empty) return;

    if (rows.length === 0) { grid.style.display = "none"; empty.style.display = "block"; return; }
    grid.style.display = "flex";
    grid.style.flexDirection = "column";
    empty.style.display = "none";

    grid.innerHTML = rows.map(function (h) {
      var photos = h.photos || [];
      var mainPhoto = photos.length > 0
        ? "<img src=\"" + photos[0].photo_data + "\" alt=\"" + escapeHtml(h.name) + "\" style=\"width:100%; height:100%; object-fit:cover;\" />"
        : "<div class=\"hotel-photo-placeholder\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\"><path d=\"M3 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15\"/><path d=\"M14 10h6a1 1 0 0 1 1 1v10\"/><path d=\"M3 21h18\"/></svg></div>";

      var extraPhotosHtml = photos.length > 1
        ? "<div class=\"hotel-photo-strip\">" + photos.slice(1, 4).map(function (p) {
            return "<img src=\"" + p.photo_data + "\" alt=\"\" />";
          }).join("") + (photos.length > 4 ? "<div class=\"hotel-photo-more\">+" + (photos.length - 4) + "</div>" : "") + "</div>"
        : "";

      var phonesHtml = (h.phones || []).map(function (p) {
        return "<div class=\"hotel-contact-line\"><span class=\"label\">" + (p.label || "Phone") + "</span><span>" + escapeHtml(p.number) + "</span></div>";
      }).join("");
      var emailsHtml = (h.emails || []).map(function (e) {
        return "<div class=\"hotel-contact-line\"><span class=\"label\">" + (e.label || "Email") + "</span><span>" + escapeHtml(e.email) + "</span></div>";
      }).join("");

      return "<div class=\"hotel-row\">" +
        "<div class=\"hotel-row__photo-col\">" + mainPhoto + extraPhotosHtml + "</div>" +
        "<div class=\"hotel-row__body\">" +
          "<div class=\"hotel-row__top\">" +
            "<div>" +
              "<div class=\"hotel-row__name\">" + escapeHtml(h.name) + "</div>" +
              "<div class=\"hotel-row__stars\">" + starsHtml(h.star_rating) + "</div>" +
            "</div>" +
            "<span class=\"hotel-row__area\">" + escapeHtml(h.area) + "</span>" +
          "</div>" +
          "<div class=\"hotel-row__address\">" + (h.address ? escapeHtml(h.address) : "<span style=\"color:var(--text-faint);\">No address on file</span>") + "</div>" +
          "<div class=\"hotel-row__contacts\">" + phonesHtml + emailsHtml + "</div>" +
          (h.notes ? "<div class=\"hotel-row__notes\">" + escapeHtml(h.notes) + "</div>" : "") +
          "<div class=\"hotel-row__actions\">" +
            "<button class=\"btn-sm\" data-edit-hotel=\"" + h.id + "\">Edit</button>" +
            "<button class=\"btn-sm\" data-delete-hotel=\"" + h.id + "\">Delete</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    grid.querySelectorAll("[data-edit-hotel]").forEach(function (btn) {
      btn.addEventListener("click", function () { openEditHotel(btn.dataset.editHotel); });
    });
    grid.querySelectorAll("[data-delete-hotel]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteHotel(btn.dataset.deleteHotel); });
    });
  }

  function addContactRow(containerId, kind, label, value) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var row = document.createElement("div");
    row.className = "contact-row";
    row.innerHTML =
      "<input type=\"text\" placeholder=\"Label (optional)\" class=\"contact-label\" value=\"" + escapeHtml(label || "") + "\" style=\"max-width:130px;\" />" +
      "<input type=\"" + (kind === "email" ? "email" : "text") + "\" placeholder=\"" + (kind === "email" ? "email@example.com" : "01xxxxxxxxx") + "\" class=\"contact-value\" value=\"" + escapeHtml(value || "") + "\" />" +
      "<button type=\"button\" class=\"row-action-btn is-danger\" title=\"Remove\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>";
    row.querySelector("button").addEventListener("click", function () { row.remove(); });
    container.appendChild(row);
  }

  function collectContactRows(containerId) {
    var rows = document.querySelectorAll("#" + containerId + " .contact-row");
    var result = [];
    rows.forEach(function (row) {
      var label = row.querySelector(".contact-label").value.trim();
      var value = row.querySelector(".contact-value").value.trim();
      if (value) result.push({ label: label, value: value });
    });
    return result;
  }

  function renderPhotoPreview() {
    var container = document.getElementById("h-photo-preview");
    if (!container) return;
    if (pendingPhotos.length === 0) {
      container.innerHTML = "<span style=\"font-size:11.5px; color:var(--text-faint);\">No photos added -- a hotel icon will show instead.</span>";
      return;
    }
    container.innerHTML = pendingPhotos.map(function (dataUrl, idx) {
      return "<div class=\"photo-thumb\"><img src=\"" + dataUrl + "\" /><button type=\"button\" data-remove-photo=\"" + idx + "\">&times;</button></div>";
    }).join("");
    container.querySelectorAll("[data-remove-photo]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        pendingPhotos.splice(Number(btn.dataset.removePhoto), 1);
        renderPhotoPreview();
      });
    });
  }

  function resetHotelForm() {
    var ids = ["h-name", "h-area", "h-address", "h-notes"];
    ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
    var star = document.getElementById("h-star-rating");
    if (star) star.value = "";
    var phones = document.getElementById("h-phones-rows");
    if (phones) phones.innerHTML = "";
    var emails = document.getElementById("h-emails-rows");
    if (emails) emails.innerHTML = "";
    pendingPhotos = [];
    renderPhotoPreview();
  }

  function openEditHotel(id) {
    var hotel = hotelsCache.find(function (h) { return String(h.id) === id; });
    if (!hotel) return;
    editingHotelId = hotel.id;

    var title = document.getElementById("hotel-modal-title");
    if (title) title.textContent = "Edit Hotel";
    document.getElementById("h-name").value = hotel.name;
    document.getElementById("h-area").value = hotel.area;
    document.getElementById("h-address").value = hotel.address || "";
    var star = document.getElementById("h-star-rating");
    if (star) star.value = hotel.star_rating || "";
    document.getElementById("h-notes").value = hotel.notes || "";

    var phonesContainer = document.getElementById("h-phones-rows");
    if (phonesContainer) phonesContainer.innerHTML = "";
    (hotel.phones || []).forEach(function (p) { addContactRow("h-phones-rows", "phone", p.label, p.number); });

    var emailsContainer = document.getElementById("h-emails-rows");
    if (emailsContainer) emailsContainer.innerHTML = "";
    (hotel.emails || []).forEach(function (e) { addContactRow("h-emails-rows", "email", e.label, e.email); });

    pendingPhotos = (hotel.photos || []).map(function (p) { return p.photo_data; });
    renderPhotoPreview();

    openModal("modal-add-hotel");
  }

  async function saveHotel() {
    var nameEl = document.getElementById("h-name");
    var areaEl = document.getElementById("h-area");
    var name = nameEl ? nameEl.value.trim() : "";
    var area = areaEl ? areaEl.value.trim() : "";
    if (!name || !area) { alert("Hotel name and area are required."); return; }

    var starEl = document.getElementById("h-star-rating");
    var payload = {
      name: name, area: area,
      address: document.getElementById("h-address").value.trim(),
      star_rating: starEl && starEl.value ? starEl.value : null,
      notes: document.getElementById("h-notes").value.trim(),
      phones: collectContactRows("h-phones-rows").map(function (c) { return { label: c.label, number: c.value }; }),
      emails: collectContactRows("h-emails-rows").map(function (c) { return { label: c.label, email: c.value }; }),
      photos: pendingPhotos.map(function (dataUrl, idx) { return { photo_data: dataUrl, sort_order: idx }; }),
    };

    try {
      if (editingHotelId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.HOTELS_DIRECTORY_DETAIL(editingHotelId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.HOTELS_DIRECTORY, { method: "POST", body: payload });
      }
      closeModal("modal-add-hotel");
      editingHotelId = null;
      await loadHotels();
    } catch (err) {
      alert(err.message || "Failed to save hotel.");
    }
  }

  async function deleteHotel(id) {
    var hotel = hotelsCache.find(function (h) { return String(h.id) === id; });
    if (!hotel) return;
    if (!confirm("Delete \"" + hotel.name + "\" from the directory?")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.HOTELS_DIRECTORY_DETAIL(id), { method: "DELETE" });
      await loadHotels();
    } catch (err) {
      alert(err.message || "Failed to delete hotel.");
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

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
      openModal("modal-pending");
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

    // Hotels Directory wiring
    on("hub-open-directory", "click", function (e) {
      if (e) e.preventDefault();
      var dash = document.getElementById("dept-dashboard-view");
      var directory = document.getElementById("dept-directory-view");
      if (dash) dash.style.display = "none";
      if (directory) directory.style.display = "block";
      loadHotels();
    });
    on("btn-back-dept-dashboard-2", "click", function (e) {
      if (e) e.preventDefault();
      var dash2 = document.getElementById("dept-dashboard-view");
      var directory2 = document.getElementById("dept-directory-view");
      if (directory2) directory2.style.display = "none";
      if (dash2) dash2.style.display = "block";
    });
    on("btn-open-add-hotel", "click", function () {
      editingHotelId = null;
      resetHotelForm();
      var title = document.getElementById("hotel-modal-title");
      if (title) title.textContent = "Add Hotel";
      openModal("modal-add-hotel");
    });
    on("btn-save-hotel", "click", saveHotel);
    on("btn-add-phone", "click", function () { addContactRow("h-phones-rows", "phone"); });
    on("btn-add-email", "click", function () { addContactRow("h-emails-rows", "email"); });
    on("directory-search", "input", renderHotelGrid);
    on("h-photos", "change", async function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      for (var i = 0; i < files.length; i++) {
        try {
          var dataUrl = await readFileAsDataUrl(files[i]);
          pendingPhotos.push(dataUrl);
        } catch (err) { /* skip */ }
      }
      renderPhotoPreview();
      e.target.value = "";
    });
  });
})();
