/**
 * guides.js -- client/modules/operations/ (المرشدين السياحيين)
 * -----------------------------------------------------------------------
 * نسخة حقيقية متصلة بالباكيند (Django REST Framework عبر VVApi) -- بتحل
 * محل النسخة القديمة اللي كانت بتقرأ/تكتب في localStorage (vv_tour_guides).
 * صفر استخدام لـlocalStorage للبيانات دي دلوقتي -- كل شيء بيعدّي عبر
 * /api/guides/ الحقيقي.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  var currentGuides = [];

  function fmtDate(isoString) {
    if (!isoString) return "";
    return isoString.split("T")[0];
  }

  // =========================================================================
  // Data loading
  // =========================================================================

  async function loadGuides() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.GUIDES);
      currentGuides = result.data.results || result.data;
    } catch (err) {
      alert(err.message || "تعذّر تحميل بيانات المرشدين.");
      currentGuides = [];
    }
    renderGuidesTable();
  }

  // =========================================================================
  // Add / Edit modal
  // =========================================================================

  function openAddModal() {
    document.getElementById("guide-editing-id").value = "";
    document.getElementById("guide-modal-title").textContent = "إضافة مرشد سياحي جديد";
    document.getElementById("guide-name").value = "";
    document.getElementById("guide-language").value = "";
    document.getElementById("guide-phone").value = "";
    document.getElementById("modal-guide-form").classList.add("is-open");
  }

  function openEditModal(id) {
    var record = currentGuides.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("المرشد السياحي لم يعد موجودًا."); return; }
    document.getElementById("guide-editing-id").value = record.id;
    document.getElementById("guide-modal-title").textContent = "تعديل: " + record.name;
    document.getElementById("guide-name").value = record.name;
    document.getElementById("guide-language").value = record.language;
    document.getElementById("guide-phone").value = record.phone;
    document.getElementById("modal-guide-form").classList.add("is-open");
  }

  async function saveGuide() {
    var name = document.getElementById("guide-name").value.trim();
    var language = document.getElementById("guide-language").value.trim();
    var phone = document.getElementById("guide-phone").value.trim();
    var editingId = document.getElementById("guide-editing-id").value;

    if (!name) { alert("اسم المرشد مطلوب."); return; }
    if (!language) { alert("اللغة مطلوبة."); return; }
    if (!phone) { alert("رقم الهاتف مطلوب."); return; }

    var saveBtn = document.getElementById("btn-save-guide");
    saveBtn.disabled = true;

    try {
      if (editingId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.GUIDE_DETAIL(editingId), {
          method: "PATCH",
          body: { name: name, language: language, phone: phone },
        });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.GUIDES, {
          method: "POST",
          body: { name: name, language: language, phone: phone },
        });
      }
      document.getElementById("modal-guide-form").classList.remove("is-open");
      await loadGuides();
    } catch (err) {
      alert(err.message || "تعذّر حفظ البيانات.");
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function deleteGuide(id) {
    var record = currentGuides.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("المرشد السياحي لم يعد موجودًا."); return; }
    if (!confirm("حذف \"" + record.name + "\" نهائيًا؟")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.GUIDE_DETAIL(id), { method: "DELETE" });
      await loadGuides();
    } catch (err) {
      alert(err.message || "تعذّر حذف السجل.");
    }
  }

  // =========================================================================
  // Table rendering + search
  // =========================================================================

  function renderGuidesTable() {
    var query = (document.getElementById("guides-search").value || "").trim().toLowerCase();
    var rows = currentGuides;
    if (query) {
      rows = rows.filter(function (r) {
        return r.name.toLowerCase().indexOf(query) !== -1 || r.language.toLowerCase().indexOf(query) !== -1;
      });
    }

    var tbody = document.getElementById("guides-table-body");
    var table = document.getElementById("guides-table");
    var empty = document.getElementById("guides-empty-state");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (r) {
      return "" +
      "<tr>" +
        "<td><strong>" + r.name + "</strong></td>" +
        "<td><span class=\"lang-chip\">" + r.language + "</span></td>" +
        "<td>" + r.phone + "</td>" +
        "<td>" + fmtDate(r.created_at) + "</td>" +
        "<td>" +
          "<button class=\"row-action-btn\" data-edit-guide=\"" + r.id + "\" title=\"تعديل\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z\"/></svg></button>" +
          "<button class=\"row-action-btn is-danger\" data-delete-guide=\"" + r.id + "\" title=\"حذف\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6\"/></svg></button>" +
        "</td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-edit-guide]").forEach(function (b) {
      b.addEventListener("click", function () { openEditModal(b.dataset.editGuide); });
    });
    tbody.querySelectorAll("[data-delete-guide]").forEach(function (b) {
      b.addEventListener("click", function () { deleteGuide(b.dataset.deleteGuide); });
    });
  }

  // =========================================================================
  // Export (لسه من طرف المتصفح -- سيتم نقله لطرف السيرفر لاحقًا زي
  // audit-log/export/ في dashboard، بعد ما نغطي باقي الأقسام)
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportGuidesToCsv() {
    if (currentGuides.length === 0) { alert("لا يوجد مرشدون سياحيون لتصديرهم."); return; }
    var lines = [["الاسم", "اللغة", "رقم الهاتف", "تاريخ الإضافة"].map(csvEscape).join(",")];
    currentGuides.forEach(function (r) {
      lines.push([r.name, r.language, r.phone, fmtDate(r.created_at)].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-TourGuides-" + new Date().toISOString().split("T")[0] + ".csv";
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

    document.getElementById("btn-open-add-guide").addEventListener("click", openAddModal);
    document.getElementById("btn-save-guide").addEventListener("click", saveGuide);
    document.getElementById("guides-search").addEventListener("input", renderGuidesTable);
    document.getElementById("btn-export-guides-excel").addEventListener("click", exportGuidesToCsv);

    loadGuides();
  });
})();