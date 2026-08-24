/**
 * guides.js — client/modules/operations/ (المرشدين السياحيين)
 * -----------------------------------------------------------------------
 * Simple standalone registry: name, language, phone. No financial
 * mutation, no relationship to any Accounting module — a lightweight
 * lookup list, matching the scope actually requested.
 *
 * Data store: vv_tour_guides — [{ id, name, language, phone, createdAt }]
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function readGuides() {
    try {
      const raw = localStorage.getItem("vv_tour_guides");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("guides.js: vv_tour_guides was corrupted — starting from an empty list instead of crashing.", e);
      return [];
    }
  }

  function writeGuides(rows) {
    try {
      localStorage.setItem("vv_tour_guides", JSON.stringify(rows));
      return true;
    } catch (e) {
      console.error("guides.js: failed to write vv_tour_guides.", e);
      alert("تعذّر الحفظ — مساحة التخزين في المتصفح ممتلئة على الأرجح.");
      return false;
    }
  }

  function generateGuideId() { return `guide_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function openAddModal() {
    document.getElementById("guide-editing-id").value = "";
    document.getElementById("guide-modal-title").textContent = "إضافة مرشد سياحي جديد";
    document.getElementById("guide-name").value = "";
    document.getElementById("guide-language").value = "";
    document.getElementById("guide-phone").value = "";
    document.getElementById("modal-guide-form").classList.add("is-open");
  }

  function openEditModal(id) {
    const record = readGuides().find((r) => r.id === id);
    if (!record) { alert("المرشد السياحي لم يعد موجودًا."); return; }
    document.getElementById("guide-editing-id").value = record.id;
    document.getElementById("guide-modal-title").textContent = `تعديل: ${record.name}`;
    document.getElementById("guide-name").value = record.name;
    document.getElementById("guide-language").value = record.language;
    document.getElementById("guide-phone").value = record.phone;
    document.getElementById("modal-guide-form").classList.add("is-open");
  }

  function saveGuide() {
    const name = document.getElementById("guide-name").value.trim();
    const language = document.getElementById("guide-language").value.trim();
    const phone = document.getElementById("guide-phone").value.trim();
    const editingId = document.getElementById("guide-editing-id").value;

    if (!name) { alert("اسم المرشد مطلوب."); return; }
    if (!language) { alert("اللغة مطلوبة."); return; }
    if (!phone) { alert("رقم الهاتف مطلوب."); return; }

    const rows = readGuides();
    if (editingId) {
      const idx = rows.findIndex((r) => r.id === editingId);
      if (idx === -1) { alert("المرشد السياحي لم يعد موجودًا."); return; }
      rows[idx] = { ...rows[idx], name, language, phone };
    } else {
      rows.push({ id: generateGuideId(), name, language, phone, createdAt: todayISO() });
    }

    if (writeGuides(rows)) {
      document.getElementById("modal-guide-form").classList.remove("is-open");
      renderGuidesTable();
    }
  }

  function deleteGuide(id) {
    const rows = readGuides();
    const record = rows.find((r) => r.id === id);
    if (!record) { alert("المرشد السياحي لم يعد موجودًا."); return; }
    if (!confirm(`حذف "${record.name}" نهائيًا؟`)) return;
    writeGuides(rows.filter((r) => r.id !== id));
    renderGuidesTable();
  }

  function renderGuidesTable() {
    const query = (document.getElementById("guides-search").value || "").trim().toLowerCase();
    let rows = readGuides();
    if (query) rows = rows.filter((r) => r.name.toLowerCase().includes(query) || r.language.toLowerCase().includes(query));
    rows = [...rows].sort((a, b) => (b.id > a.id ? 1 : -1));

    const tbody = document.getElementById("guides-table-body");
    const table = document.getElementById("guides-table");
    const empty = document.getElementById("guides-empty-state");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td><span class="lang-chip">${r.language}</span></td>
        <td>${r.phone}</td>
        <td>${r.createdAt}</td>
        <td>
          <button class="row-action-btn" data-edit-guide="${r.id}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="row-action-btn is-danger" data-delete-guide="${r.id}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-edit-guide]").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.editGuide)));
    tbody.querySelectorAll("[data-delete-guide]").forEach((b) => b.addEventListener("click", () => deleteGuide(b.dataset.deleteGuide)));
  }

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportGuidesToCsv() {
    const rows = readGuides();
    if (rows.length === 0) { alert("لا يوجد مرشدون سياحيون لتصديرهم."); return; }
    const lines = [["الاسم", "اللغة", "رقم الهاتف", "تاريخ الإضافة"].map(csvEscape).join(",")];
    rows.forEach((r) => lines.push([r.name, r.language, r.phone, r.createdAt].map(csvEscape).join(",")));
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Voyvista-TourGuides-${todayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => document.getElementById(btn.dataset.closeModal)?.classList.remove("is-open")));
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open")); });

    document.getElementById("btn-open-add-guide").addEventListener("click", openAddModal);
    document.getElementById("btn-save-guide").addEventListener("click", saveGuide);
    document.getElementById("guides-search").addEventListener("input", renderGuidesTable);
    document.getElementById("btn-export-guides-excel").addEventListener("click", exportGuidesToCsv);

    renderGuidesTable();
  });
})();