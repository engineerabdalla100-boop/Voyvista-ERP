(function () {
  "use strict";

  var MAX_PHOTO_BYTES = 700 * 1024;
  var pendingPhotos = { profile_photo: null, id_front_photo: null, id_back_photo: null, criminal_record_photo: null };
  var editingId = null;
  var allStaff = [];

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function on(id, event, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
    return el;
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove("is-open");
  }

  // =========================================================================
  // Load and render
  // =========================================================================

  async function loadStaff(search) {
    try {
      var params = search ? "?search=" + encodeURIComponent(search) : "";
      allStaff = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.STAFF + params);
    } catch (err) {
      allStaff = [];
    }
    renderStaffTable();
  }

  function thumbCell(record) {
    if (record.profile_photo) {
      return "<img src=\"" + record.profile_photo + "\" alt=\"\" />";
    }
    var initial = (record.name || "?").trim().charAt(0);
    return "<div class=\"thumb-placeholder\">" + initial + "</div>";
  }

  function statusBadge(record) {
    return record.is_active
      ? "<span class=\"staff-status-badge staff-status-badge--active\">Active</span>"
      : "<span class=\"staff-status-badge staff-status-badge--terminated\">Terminated</span>";
  }

  function renderStaffTable() {
    var rows = allStaff.slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; });
    var tbody = document.getElementById("staff-table-body");
    var table = document.getElementById("staff-table");
    var empty = document.getElementById("staff-empty-state");

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (r) {
      var rowClass = !r.is_active ? " class=\"staff-row--terminated\"" : "";
      var actionButtons = "" +
        "<button class=\"row-action-btn\" data-view-staff=\"" + r.id + "\" title=\"View\">" +
          "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 16v-4M12 8h.01\"/></svg>" +
        "</button>" +
        "<button class=\"row-action-btn\" data-edit-staff=\"" + r.id + "\" title=\"Edit\">" +
          "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z\"/></svg>" +
        "</button>";
      actionButtons += r.is_active
        ? "<button class=\"row-action-btn is-danger\" data-end-contract=\"" + r.id + "\" title=\"End Contract\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M18 6L6 18M6 6l12 12\"/></svg></button>"
        : "<button class=\"row-action-btn\" data-reactivate=\"" + r.id + "\" title=\"Reactivate\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 4v6h6M20 20v-6h-6\"/><path d=\"M4 10a8 8 0 0 1 14.3-4.9M20 14a8 8 0 0 1-14.3 4.9\"/></svg></button>";

      return "<tr" + rowClass + ">" +
        "<td class=\"thumb-cell\">" + thumbCell(r) + "</td>" +
        "<td><strong>" + r.name + "</strong></td>" +
        "<td>" + r.position + "</td>" +
        "<td>" + r.phone + "</td>" +
        "<td>" + (r.email || "-") + "</td>" +
        "<td>" + r.start_date + "</td>" +
        "<td>" + (r.end_date || "Till Now") + "</td>" +
        "<td>" + statusBadge(r) + "</td>" +
        "<td>" + actionButtons + "</td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-view-staff]").forEach(function (b) {
      b.addEventListener("click", function () { viewStaff(b.dataset.viewStaff); });
    });
    tbody.querySelectorAll("[data-edit-staff]").forEach(function (b) {
      b.addEventListener("click", function () { openEditModal(b.dataset.editStaff); });
    });
    tbody.querySelectorAll("[data-end-contract]").forEach(function (b) {
      b.addEventListener("click", function () { endContract(b.dataset.endContract); });
    });
    tbody.querySelectorAll("[data-reactivate]").forEach(function (b) {
      b.addEventListener("click", function () { reactivateContract(b.dataset.reactivate); });
    });
  }

  // =========================================================================
  // Photo upload
  // =========================================================================

  function wirePhotoUpload(inputId, previewId, photoKey) {
    var input = document.getElementById(inputId);
    var preview = document.getElementById(previewId);
    if (!input || !preview) return;

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        alert("The selected file is not an image.");
        input.value = "";
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        alert("Image is too large (" + Math.round(file.size / 1024) + "KB) - max is " + Math.round(MAX_PHOTO_BYTES / 1024) + "KB.");
        input.value = "";
        return;
      }

      var reader = new FileReader();
      reader.onload = function () {
        pendingPhotos[photoKey] = reader.result;
        preview.src = reader.result;
        preview.style.display = "block";
      };
      reader.onerror = function () {
        alert("Could not read the image - try a different file.");
        input.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  function resetPhotoPreviews() {
    Object.keys(pendingPhotos).forEach(function (k) { pendingPhotos[k] = null; });
    [
      ["preview-profile-photo", "upload-profile-photo"],
      ["preview-id-front", "upload-id-front"],
      ["preview-id-back", "upload-id-back"],
      ["preview-criminal-record", "upload-criminal-record"],
    ].forEach(function (pair) {
      var preview = document.getElementById(pair[0]);
      var input = document.getElementById(pair[1]);
      if (preview) { preview.style.display = "none"; preview.src = ""; }
      if (input) input.value = "";
    });
  }

  // =========================================================================
  // Add / Edit modal
  // =========================================================================

  function openAddModal() {
    editingId = null;
    document.getElementById("staff-editing-id").value = "";
    document.getElementById("staff-modal-title").textContent = "Add New Staff Member";
    document.getElementById("staff-name").value = "";
    document.getElementById("staff-position").value = "";
    document.getElementById("staff-phone").value = "";
    document.getElementById("staff-email").value = "";
    document.getElementById("staff-start-date").value = todayISO();
    document.getElementById("staff-end-date").value = "";
    document.getElementById("staff-notes").value = "";
    resetPhotoPreviews();
    document.getElementById("modal-staff-form").classList.add("is-open");
  }

  function openEditModal(id) {
    var record = allStaff.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This staff member no longer exists."); return; }

    editingId = id;
    document.getElementById("staff-editing-id").value = record.id;
    document.getElementById("staff-modal-title").textContent = "Edit: " + record.name;
    document.getElementById("staff-name").value = record.name;
    document.getElementById("staff-position").value = record.position;
    document.getElementById("staff-phone").value = record.phone;
    document.getElementById("staff-email").value = record.email || "";
    document.getElementById("staff-start-date").value = record.start_date;
    document.getElementById("staff-end-date").value = record.end_date || "";
    document.getElementById("staff-notes").value = record.notes || "";

    resetPhotoPreviews();
    var photoMap = [
      ["profile_photo", "preview-profile-photo"],
      ["id_front_photo", "preview-id-front"],
      ["id_back_photo", "preview-id-back"],
      ["criminal_record_photo", "preview-criminal-record"],
    ];
    photoMap.forEach(function (pair) {
      var key = pair[0], previewId = pair[1];
      if (record[key]) {
        pendingPhotos[key] = record[key];
        var preview = document.getElementById(previewId);
        preview.src = record[key];
        preview.style.display = "block";
      }
    });

    document.getElementById("modal-staff-form").classList.add("is-open");
  }

  async function saveStaff() {
    var name = document.getElementById("staff-name").value.trim();
    var position = document.getElementById("staff-position").value.trim();
    var phone = document.getElementById("staff-phone").value.trim();
    var email = document.getElementById("staff-email").value.trim();
    var startDate = document.getElementById("staff-start-date").value;
    var endDate = document.getElementById("staff-end-date").value || null;
    var notes = document.getElementById("staff-notes").value.trim();

    if (!name) { alert("Employee name is required."); return; }
    if (!position) { alert("Position is required."); return; }
    if (!phone) { alert("Phone number is required."); return; }
    if (!startDate) { alert("Start date is required."); return; }
    if (endDate && endDate < startDate) { alert("End date cannot be before start date."); return; }

    var payload = {
      name: name, position: position, phone: phone, email: email,
      start_date: startDate, end_date: endDate, notes: notes,
      profile_photo: pendingPhotos.profile_photo || "",
      id_front_photo: pendingPhotos.id_front_photo || "",
      id_back_photo: pendingPhotos.id_back_photo || "",
      criminal_record_photo: pendingPhotos.criminal_record_photo || "",
    };

    var btn = document.getElementById("btn-save-staff");
    if (btn) btn.disabled = true;
    try {
      if (editingId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.STAFF_DETAIL(editingId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.STAFF, { method: "POST", body: payload });
      }
      closeModal("modal-staff-form");
      await loadStaff(document.getElementById("staff-search").value);
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // =========================================================================
  // Contract workflow
  // =========================================================================

  async function endContract(id) {
    var record = allStaff.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This staff member no longer exists."); return; }
    if (!record.is_active) { alert("\"" + record.name + "\"'s contract already ended on " + record.end_date + "."); return; }

    var dateInput = prompt("End date for \"" + record.name + "\"'s contract:", todayISO());
    if (dateInput === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) { alert("Invalid date format - use YYYY-MM-DD."); return; }

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.STAFF_END_CONTRACT(id), { method: "POST", body: { end_date: dateInput } });
      await loadStaff(document.getElementById("staff-search").value);
    } catch (err) {
      alert(err.message || "Failed to end contract.");
    }
  }

  async function reactivateContract(id) {
    var record = allStaff.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This staff member no longer exists."); return; }
    if (!confirm("Reactivate \"" + record.name + "\"'s contract?")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.STAFF_REACTIVATE(id), { method: "POST" });
      await loadStaff(document.getElementById("staff-search").value);
    } catch (err) {
      alert(err.message || "Failed to reactivate.");
    }
  }

  // =========================================================================
  // View details modal
  // =========================================================================

  function viewStaff(id) {
    var record = allStaff.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This staff member no longer exists."); return; }

    var statusHtml = record.is_active
      ? "<span class=\"staff-status-badge staff-status-badge--active\">Active</span>"
      : "<span class=\"staff-status-badge staff-status-badge--terminated\">Ended on " + record.end_date + "</span>";

    function photoRow(label, src) {
      if (src) {
        return "<div style=\"text-align:center;\"><div style=\"font-size:11px;color:var(--text-faint);margin-bottom:4px;\">" + label + "</div><img src=\"" + src + "\" style=\"width:100%;max-height:140px;object-fit:cover;border-radius:8px;border:1px solid var(--border);\" /></div>";
      }
      return "<div style=\"text-align:center;\"><div style=\"font-size:11px;color:var(--text-faint);margin-bottom:4px;\">" + label + "</div><div style=\"height:100px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:11px;border:1px dashed var(--border);border-radius:8px;\">No image</div></div>";
    }

    document.getElementById("staff-view-title").textContent = record.name;
    document.getElementById("staff-view-body").innerHTML =
      "<div style=\"margin-bottom:16px;\">" + statusHtml + "</div>" +
      "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;margin-bottom:18px;\">" +
        "<div><strong>Position:</strong> " + record.position + "</div>" +
        "<div><strong>Phone:</strong> " + record.phone + "</div>" +
        "<div><strong>Email:</strong> " + (record.email || "-") + "</div>" +
        "<div><strong>Start Date:</strong> " + record.start_date + "</div>" +
        (record.notes ? "<div style=\"grid-column:1/-1;\"><strong>Notes:</strong> " + record.notes + "</div>" : "") +
      "</div>" +
      "<div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:12px;\">" +
        photoRow("Profile Photo", record.profile_photo) +
        photoRow("ID Card - Front", record.id_front_photo) +
        photoRow("ID Card - Back", record.id_back_photo) +
        photoRow("Criminal Record", record.criminal_record_photo) +
      "</div>";

    document.getElementById("modal-staff-view").classList.add("is-open");
  }

  // =========================================================================
  // Export CSV
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportStaffToCsv() {
    if (allStaff.length === 0) { alert("No staff members to export."); return; }

    var columns = ["name", "position", "phone", "email", "start_date", "end_date", "notes"];
    var labels = ["Name", "Position", "Phone", "Email", "Start Date", "End Date", "Notes"];
    var lines = [labels.map(csvEscape).join(",")];

    allStaff.forEach(function (r) {
      var row = [r.name, r.position, r.phone, r.email || "", r.start_date, r.end_date || "Till Now", r.notes || ""];
      lines.push(row.map(csvEscape).join(","));
    });

    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Staff-" + todayISO() + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // =========================================================================
  // Init
  // =========================================================================

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.dataset.closeModal); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach(function (o) { o.classList.remove("is-open"); });
    });

    wirePhotoUpload("upload-profile-photo", "preview-profile-photo", "profile_photo");
    wirePhotoUpload("upload-id-front", "preview-id-front", "id_front_photo");
    wirePhotoUpload("upload-id-back", "preview-id-back", "id_back_photo");
    wirePhotoUpload("upload-criminal-record", "preview-criminal-record", "criminal_record_photo");

    on("btn-open-add-staff", "click", openAddModal);
    on("btn-save-staff", "click", saveStaff);
    on("staff-search", "input", function (e) { loadStaff(e.target.value); });
    on("btn-export-staff-csv", "click", exportStaffToCsv);

    loadStaff();
  });
})();
