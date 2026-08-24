/**
 * staff.js — client/modules/operations/ (سجل الموظفين)
 * -----------------------------------------------------------------------
 * Standalone employee registry — separate from vv_employees (owned by
 * employees.js, used for the login role-switcher / Owner+IT directory).
 * This file tracks the HR-side record: documents, contract dates,
 * contact info — not system access/roles.
 *
 * Data store: vv_staff_records — [{
 *   id, name, position, phone, email, startDate, endDate (null while
 *   active), notes, profilePhoto, idFrontPhoto, idBackPhoto,
 *   criminalRecordPhoto (each a base64 data URL or null), createdAt
 * }]
 *
 * A record's employment status is DERIVED, never stored as a separate
 * field: `endDate == null` means active, `endDate` set means terminated
 * — this way the two can never silently disagree with each other.
 * Ending a contract never deletes the record — every field (documents
 * included) stays exactly as it was; only endDate gets set.
 *
 * Photo storage — an honest limitation, not hidden: photos are stored as
 * base64 data URLs directly inside vv_staff_records itself, in
 * localStorage. Browsers cap localStorage at roughly 5-10MB per origin
 * total, shared with every other store this whole app uses. A 700KB cap
 * per photo (enforced below, before anything is saved) keeps a single
 * employee's four photos to under ~3MB in the worst case, but this is
 * NOT a scalable long-term storage strategy for many employees with
 * photos — a real backend with file storage is the eventual fix, same
 * as every other localStorage limitation already documented across this
 * project.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const MAX_PHOTO_BYTES = 700 * 1024; // 700 KB, enforced before any read/save

  function readStaff() {
    try {
      const raw = localStorage.getItem("vv_staff_records");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("staff.js: vv_staff_records was corrupted — starting from an empty list instead of crashing.", e);
      return [];
    }
  }

  function writeStaff(rows) {
    try {
      localStorage.setItem("vv_staff_records", JSON.stringify(rows));
      return true;
    } catch (e) {
      // Most likely QuotaExceededError — localStorage is full (photos are
      // the usual reason). Surface this honestly instead of silently
      // losing the write.
      console.error("staff.js: failed to write vv_staff_records.", e);
      alert("تعذّر الحفظ — مساحة التخزين في المتصفح ممتلئة على الأرجح (بسبب حجم الصور المرفوعة). جرّب حذف موظف قديم أو صور أقل حجمًا.");
      return false;
    }
  }

  function generateStaffId() {
    return `staff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function isActive(record) { return !record.endDate; }

  // =========================================================================
  // Photo upload handling — validates size BEFORE reading the file, reads
  // as a base64 data URL, shows a live preview. Every failure path (no
  // file, too large, unreadable file) is handled explicitly rather than
  // left to throw.
  // =========================================================================

  const pendingPhotos = { profilePhoto: null, idFrontPhoto: null, idBackPhoto: null, criminalRecordPhoto: null };

  function wirePhotoUpload(inputId, previewId, photoKey) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        alert("الملف المختار مش صورة — اختار صورة صحيحة.");
        input.value = "";
        return;
      }
      if (file.size > MAX_PHOTO_BYTES) {
        alert(`حجم الصورة كبير جدًا (${Math.round(file.size / 1024)} كيلوبايت) — الحد الأقصى ${Math.round(MAX_PHOTO_BYTES / 1024)} كيلوبايت. اختار صورة أصغر.`);
        input.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        pendingPhotos[photoKey] = reader.result;
        preview.src = reader.result;
        preview.style.display = "block";
      };
      reader.onerror = () => {
        alert("تعذّرت قراءة الصورة — جرّب ملف تاني.");
        input.value = "";
      };
      reader.readAsDataURL(file);
    });
  }

  function resetPhotoPreviews() {
    ["profilePhoto", "idFrontPhoto", "idBackPhoto", "criminalRecordPhoto"].forEach((k) => { pendingPhotos[k] = null; });
    [
      ["preview-profile-photo", "upload-profile-photo"],
      ["preview-id-front", "upload-id-front"],
      ["preview-id-back", "upload-id-back"],
      ["preview-criminal-record", "upload-criminal-record"],
    ].forEach(([previewId, inputId]) => {
      const preview = document.getElementById(previewId);
      preview.style.display = "none";
      preview.src = "";
      document.getElementById(inputId).value = "";
    });
  }

  // =========================================================================
  // Add / Edit form
  // =========================================================================

  function openAddModal() {
    document.getElementById("staff-editing-id").value = "";
    document.getElementById("staff-modal-title").textContent = "إضافة موظف جديد";
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
    const record = readStaff().find((r) => r.id === id);
    if (!record) { alert("الموظف لم يعد موجودًا."); return; }

    document.getElementById("staff-editing-id").value = record.id;
    document.getElementById("staff-modal-title").textContent = `تعديل بيانات: ${record.name}`;
    document.getElementById("staff-name").value = record.name;
    document.getElementById("staff-position").value = record.position;
    document.getElementById("staff-phone").value = record.phone;
    document.getElementById("staff-email").value = record.email || "";
    document.getElementById("staff-start-date").value = record.startDate;
    document.getElementById("staff-end-date").value = record.endDate || "";
    document.getElementById("staff-notes").value = record.notes || "";

    resetPhotoPreviews();
    const photoMap = [
      ["profilePhoto", "preview-profile-photo"],
      ["idFrontPhoto", "preview-id-front"],
      ["idBackPhoto", "preview-id-back"],
      ["criminalRecordPhoto", "preview-criminal-record"],
    ];
    photoMap.forEach(([key, previewId]) => {
      if (record[key]) {
        pendingPhotos[key] = record[key]; // keep existing photo unless the user uploads a new one
        const preview = document.getElementById(previewId);
        preview.src = record[key];
        preview.style.display = "block";
      }
    });

    document.getElementById("modal-staff-form").classList.add("is-open");
  }

  function saveStaff() {
    const name = document.getElementById("staff-name").value.trim();
    const position = document.getElementById("staff-position").value.trim();
    const phone = document.getElementById("staff-phone").value.trim();
    const email = document.getElementById("staff-email").value.trim();
    const startDate = document.getElementById("staff-start-date").value;
    const endDate = document.getElementById("staff-end-date").value || null;
    const notes = document.getElementById("staff-notes").value.trim();
    const editingId = document.getElementById("staff-editing-id").value;

    if (!name) { alert("اسم الموظف مطلوب."); return; }
    if (!position) { alert("الوظيفة (Position) مطلوبة."); return; }
    if (!phone) { alert("رقم الهاتف مطلوب."); return; }
    if (!startDate) { alert("تاريخ بدء العمل مطلوب."); return; }
    if (endDate && endDate < startDate) { alert("تاريخ انتهاء العقد لا يمكن أن يكون قبل تاريخ البداية."); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert("البريد الإلكتروني غير صالح."); return; }

    const rows = readStaff();

    if (editingId) {
      const idx = rows.findIndex((r) => r.id === editingId);
      if (idx === -1) { alert("الموظف لم يعد موجودًا."); return; }
      rows[idx] = {
        ...rows[idx],
        name, position, phone, email, startDate, endDate, notes,
        profilePhoto: pendingPhotos.profilePhoto,
        idFrontPhoto: pendingPhotos.idFrontPhoto,
        idBackPhoto: pendingPhotos.idBackPhoto,
        criminalRecordPhoto: pendingPhotos.criminalRecordPhoto,
      };
    } else {
      rows.push({
        id: generateStaffId(),
        name, position, phone, email, startDate, endDate, notes,
        profilePhoto: pendingPhotos.profilePhoto,
        idFrontPhoto: pendingPhotos.idFrontPhoto,
        idBackPhoto: pendingPhotos.idBackPhoto,
        criminalRecordPhoto: pendingPhotos.criminalRecordPhoto,
        createdAt: todayISO(),
      });
    }

    if (writeStaff(rows)) {
      closeModal("modal-staff-form");
      renderStaffTable();
    }
  }

  // =========================================================================
  // Ending a contract — never deletes anything, just sets endDate. A
  // dedicated, explicit action (not just "edit the date") so it's clear
  // this is a deliberate HR decision, and reversible (editing the record
  // back to no end date re-activates it, same underlying rule).
  // =========================================================================

  function endContract(id) {
    const rows = readStaff();
    const record = rows.find((r) => r.id === id);
    if (!record) { alert("الموظف لم يعد موجودًا."); return; }
    if (record.endDate) { alert(`عقد "${record.name}" منتهٍ بالفعل بتاريخ ${record.endDate}.`); return; }

    const dateInput = prompt(`تاريخ انتهاء عقد "${record.name}":`, todayISO());
    if (dateInput === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) { alert("صيغة التاريخ غير صحيحة — استخدم YYYY-MM-DD."); return; }
    if (dateInput < record.startDate) { alert("تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية."); return; }

    record.endDate = dateInput;
    writeStaff(rows);
    renderStaffTable();
  }

  function reactivateContract(id) {
    const rows = readStaff();
    const record = rows.find((r) => r.id === id);
    if (!record) { alert("الموظف لم يعد موجودًا."); return; }
    if (!confirm(`إعادة تفعيل عقد "${record.name}"؟`)) return;
    record.endDate = null;
    writeStaff(rows);
    renderStaffTable();
  }

  // =========================================================================
  // View details modal
  // =========================================================================

  function viewStaff(id) {
    const record = readStaff().find((r) => r.id === id);
    if (!record) { alert("الموظف لم يعد موجودًا."); return; }

    document.getElementById("staff-view-title").textContent = record.name;
    const statusHtml = isActive(record)
      ? `<span class="staff-status-badge staff-status-badge--active">نشط</span>`
      : `<span class="staff-status-badge staff-status-badge--terminated">انتهى العقد بتاريخ ${record.endDate}</span>`;

    const photoRow = (label, src) => src
      ? `<div style="text-align:center;"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px;">${label}</div><img src="${src}" style="width:100%;max-height:140px;object-fit:cover;border-radius:8px;border:1px solid var(--border);" /></div>`
      : `<div style="text-align:center;"><div style="font-size:11px;color:var(--text-faint);margin-bottom:4px;">${label}</div><div style="height:100px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);font-size:11px;border:1px dashed var(--border);border-radius:8px;">لا توجد صورة</div></div>`;

    document.getElementById("staff-view-body").innerHTML = `
      <div style="margin-bottom:16px;">${statusHtml}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;margin-bottom:18px;">
        <div><strong>الوظيفة:</strong> ${record.position}</div>
        <div><strong>الهاتف:</strong> ${record.phone}</div>
        <div><strong>البريد:</strong> ${record.email || "—"}</div>
        <div><strong>تاريخ البداية:</strong> ${record.startDate}</div>
        ${record.notes ? `<div style="grid-column:1/-1;"><strong>ملاحظات:</strong> ${record.notes}</div>` : ""}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;">
        ${photoRow("صورة البروفايل", record.profilePhoto)}
        ${photoRow("البطاقة — وش", record.idFrontPhoto)}
        ${photoRow("البطاقة — ضهر", record.idBackPhoto)}
        ${photoRow("الفيش الجنائي", record.criminalRecordPhoto)}
      </div>
    `;
    document.getElementById("modal-staff-view").classList.add("is-open");
  }

  // =========================================================================
  // Table rendering
  // =========================================================================

  function thumbCell(record) {
    return record.profilePhoto
      ? `<img src="${record.profilePhoto}" alt="" />`
      : `<div class="thumb-placeholder">${(record.name || "?").trim().charAt(0)}</div>`;
  }

  function renderStaffTable() {
    const query = (document.getElementById("staff-search").value || "").trim().toLowerCase();
    let rows = readStaff();
    if (query) {
      rows = rows.filter((r) => r.name.toLowerCase().includes(query) || r.position.toLowerCase().includes(query));
    }
    rows = [...rows].sort((a, b) => (b.id > a.id ? 1 : -1));

    const tbody = document.getElementById("staff-table-body");
    const table = document.getElementById("staff-table");
    const empty = document.getElementById("staff-empty-state");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((r) => `
      <tr class="${!isActive(r) ? "staff-row--terminated" : ""}">
        <td class="thumb-cell">${thumbCell(r)}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.position}</td>
        <td>${r.phone}</td>
        <td>${r.email || "—"}</td>
        <td>${r.startDate}</td>
        <td>${r.endDate || "Till Now"}</td>
        <td>${isActive(r) ? `<span class="staff-status-badge staff-status-badge--active">نشط</span>` : `<span class="staff-status-badge staff-status-badge--terminated">منتهٍ</span>`}</td>
        <td>
          <button class="row-action-btn" data-view-staff="${r.id}" title="عرض التفاصيل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg></button>
          <button class="row-action-btn" data-edit-staff="${r.id}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          ${isActive(r)
            ? `<button class="row-action-btn is-danger" data-end-contract="${r.id}" title="إنهاء العقد"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`
            : `<button class="row-action-btn" data-reactivate="${r.id}" title="إعادة تفعيل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6M20 20v-6h-6"/><path d="M4 10a8 8 0 0 1 14.3-4.9M20 14a8 8 0 0 1-14.3 4.9"/></svg></button>`}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-view-staff]").forEach((b) => b.addEventListener("click", () => viewStaff(b.dataset.viewStaff)));
    tbody.querySelectorAll("[data-edit-staff]").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.editStaff)));
    tbody.querySelectorAll("[data-end-contract]").forEach((b) => b.addEventListener("click", () => endContract(b.dataset.endContract)));
    tbody.querySelectorAll("[data-reactivate]").forEach((b) => b.addEventListener("click", () => reactivateContract(b.dataset.reactivate)));
  }

  // =========================================================================
  // Export — Excel/CSV (same technique already used by flights.js: Blob +
  // <a download>, UTF-8 BOM) and PDF (jsPDF, already loaded by this page).
  // Photos are intentionally NOT embedded in either export — a CSV can't
  // hold binary data and a base64 image balloons a PDF file size for
  // little practical benefit in a printed staff list.
  // =========================================================================

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportStaffToCsv() {
    const rows = readStaff();
    if (rows.length === 0) { alert("لا يوجد موظفون لتصديرهم."); return; }

    const columns = ["الاسم", "الوظيفة", "الهاتف", "البريد الإلكتروني", "تاريخ البداية", "تاريخ النهاية", "الحالة", "ملاحظات"];
    const lines = [columns.map(csvEscape).join(",")];
    rows.forEach((r) => {
      lines.push([
        r.name, r.position, r.phone, r.email || "", r.startDate, r.endDate || "Till Now",
        isActive(r) ? "نشط" : "منتهٍ", r.notes || "",
      ].map(csvEscape).join(","));
    });

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Voyvista-Staff-${todayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function exportStaffToPdf() {
    const rows = readStaff();
    if (rows.length === 0) { alert("لا يوجد موظفون لتصديرهم."); return; }
    if (!window.jspdf) { alert("مكتبة PDF لم يتم تحميلها بعد — جرّب تاني بعد لحظات."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    const marginX = 10;
    let y = 15;

    doc.setFontSize(14);
    doc.text("Voyvista ERP — Staff Report", marginX, y);
    y += 6;
    doc.setFontSize(9);
    doc.text(`Generated: ${todayISO()} — Total: ${rows.length}`, marginX, y);
    y += 8;

    const colWidths = [45, 40, 30, 50, 25, 25, 20];
    const headers = ["Name", "Position", "Phone", "Email", "Start", "End", "Status"];
    doc.setFontSize(9);
    let x = marginX;
    headers.forEach((h, i) => { doc.text(h, x, y); x += colWidths[i]; });
    y += 5;
    doc.line(marginX, y - 3, marginX + colWidths.reduce((a, b) => a + b, 0), y - 3);

    [...rows].sort((a, b) => (a.name > b.name ? 1 : -1)).forEach((r) => {
      if (y > 195) { doc.addPage(); y = 15; }
      x = marginX;
      const values = [r.name, r.position, r.phone, r.email || "-", r.startDate, r.endDate || "Till Now", isActive(r) ? "Active" : "Ended"];
      values.forEach((v, i) => { doc.text(String(v).slice(0, 30), x, y); x += colWidths[i]; });
      y += 6;
    });

    doc.save(`Voyvista-Staff-${todayISO()}.pdf`);
  }

  // =========================================================================
  // Modal close wiring (shared pattern)
  // =========================================================================

  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open"));
    });

    wirePhotoUpload("upload-profile-photo", "preview-profile-photo", "profilePhoto");
    wirePhotoUpload("upload-id-front", "preview-id-front", "idFrontPhoto");
    wirePhotoUpload("upload-id-back", "preview-id-back", "idBackPhoto");
    wirePhotoUpload("upload-criminal-record", "preview-criminal-record", "criminalRecordPhoto");

    document.getElementById("btn-open-add-staff").addEventListener("click", openAddModal);
    document.getElementById("btn-save-staff").addEventListener("click", saveStaff);
    document.getElementById("staff-search").addEventListener("input", renderStaffTable);
    document.getElementById("btn-export-staff-excel").addEventListener("click", exportStaffToCsv);
    document.getElementById("btn-export-staff-pdf").addEventListener("click", exportStaffToPdf);

    renderStaffTable();
  });
})();