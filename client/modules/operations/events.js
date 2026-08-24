/**
 * events.js — client/modules/operations/ (الفعاليات)
 * -----------------------------------------------------------------------
 * Data store: vv_events — [{
 *   id, location, date, peopleCount,
 *   expenseItems: [{ id, description, category ("purchase"|"rental"), amount }],
 *   companies: [{ id, name }],
 *   team: [{ id, name, role }],
 *   totalSpent,   // ALWAYS derived — sum of expenseItems, recomputed at
 *                 // save time, never trusted from a stale stored value
 *   createdAt
 * }]
 *
 * Purchases/rentals are sub-details of spending (each expense item picks
 * a category), matching "مشتريات/استئجارات تبقى متفرعة من الصرف" exactly
 * — there's no separate top-level "purchases" or "rentals" list, just one
 * spending list where each line says which kind it is.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function readEvents() {
    try {
      const raw = localStorage.getItem("vv_events");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("events.js: vv_events was corrupted — starting from an empty list instead of crashing.", e);
      return [];
    }
  }
  function writeEvents(rows) {
    try { localStorage.setItem("vv_events", JSON.stringify(rows)); return true; }
    catch (e) { console.error("events.js: failed to write vv_events.", e); alert("تعذّر الحفظ — مساحة التخزين ممتلئة على الأرجح."); return false; }
  }

  function generateId(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtMoney(n) { return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // In-memory working copies of the three sub-lists while the form is
  // open — only committed to vv_events on Save, so a cancelled form
  // never leaves a half-entered row behind.
  let draftExpenseItems = [];
  let draftCompanies = [];
  let draftTeam = [];

  // =========================================================================
  // Expense items sub-form
  // =========================================================================

  function renderExpenseItemsList() {
    const wrap = document.getElementById("expense-items-list");
    wrap.innerHTML = draftExpenseItems.map((item, i) => `
      <div class="sub-item-row">
        <select data-expense-category="${i}" style="width:110px;">
          <option value="purchase" ${item.category === "purchase" ? "selected" : ""}>مشتريات</option>
          <option value="rental" ${item.category === "rental" ? "selected" : ""}>استئجار</option>
        </select>
        <input type="text" data-expense-desc="${i}" placeholder="البيان..." value="${item.description}" style="flex:2;" />
        <input type="number" min="0" step="0.01" data-expense-amount="${i}" placeholder="المبلغ" value="${item.amount}" style="width:100px;" />
        <button type="button" class="sub-item-remove" data-remove-expense="${i}">✕</button>
      </div>
    `).join("");

    wrap.querySelectorAll("[data-expense-category]").forEach((el) => el.addEventListener("change", (e) => { draftExpenseItems[+el.dataset.expenseCategory].category = e.target.value; }));
    wrap.querySelectorAll("[data-expense-desc]").forEach((el) => el.addEventListener("input", (e) => { draftExpenseItems[+el.dataset.expenseDesc].description = e.target.value; }));
    wrap.querySelectorAll("[data-expense-amount]").forEach((el) => el.addEventListener("input", (e) => { draftExpenseItems[+el.dataset.expenseAmount].amount = Number(e.target.value) || 0; updateSpentTotal(); }));
    wrap.querySelectorAll("[data-remove-expense]").forEach((el) => el.addEventListener("click", () => { draftExpenseItems.splice(+el.dataset.removeExpense, 1); renderExpenseItemsList(); updateSpentTotal(); }));

    updateSpentTotal();
  }

  function updateSpentTotal() {
    const total = draftExpenseItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    document.getElementById("event-total-spent").textContent = fmtMoney(total);
  }

  function addExpenseItem() {
    draftExpenseItems.push({ id: generateId("exp"), description: "", category: "purchase", amount: 0 });
    renderExpenseItemsList();
  }

  // =========================================================================
  // Companies sub-form
  // =========================================================================

  function renderCompaniesList() {
    const wrap = document.getElementById("companies-list");
    wrap.innerHTML = draftCompanies.map((c, i) => `
      <div class="sub-item-row">
        <input type="text" data-company-name="${i}" placeholder="اسم الشركة..." value="${c.name}" style="flex:1;" />
        <button type="button" class="sub-item-remove" data-remove-company="${i}">✕</button>
      </div>
    `).join("");
    wrap.querySelectorAll("[data-company-name]").forEach((el) => el.addEventListener("input", (e) => { draftCompanies[+el.dataset.companyName].name = e.target.value; }));
    wrap.querySelectorAll("[data-remove-company]").forEach((el) => el.addEventListener("click", () => { draftCompanies.splice(+el.dataset.removeCompany, 1); renderCompaniesList(); }));
  }
  function addCompany() { draftCompanies.push({ id: generateId("co"), name: "" }); renderCompaniesList(); }

  // =========================================================================
  // Team sub-form
  // =========================================================================

  function renderTeamList() {
    const wrap = document.getElementById("team-list");
    wrap.innerHTML = draftTeam.map((t, i) => `
      <div class="sub-item-row">
        <input type="text" data-team-name="${i}" placeholder="الاسم..." value="${t.name}" style="flex:1;" />
        <input type="text" data-team-role="${i}" placeholder="الوظيفة..." value="${t.role}" style="flex:1;" />
        <button type="button" class="sub-item-remove" data-remove-team="${i}">✕</button>
      </div>
    `).join("");
    wrap.querySelectorAll("[data-team-name]").forEach((el) => el.addEventListener("input", (e) => { draftTeam[+el.dataset.teamName].name = e.target.value; }));
    wrap.querySelectorAll("[data-team-role]").forEach((el) => el.addEventListener("input", (e) => { draftTeam[+el.dataset.teamRole].role = e.target.value; }));
    wrap.querySelectorAll("[data-remove-team]").forEach((el) => el.addEventListener("click", () => { draftTeam.splice(+el.dataset.removeTeam, 1); renderTeamList(); }));
  }
  function addTeamMember() { draftTeam.push({ id: generateId("team"), name: "", role: "" }); renderTeamList(); }

  // =========================================================================
  // Add / Edit event
  // =========================================================================

  function openAddModal() {
    document.getElementById("event-editing-id").value = "";
    document.getElementById("event-modal-title").textContent = "إضافة فعالية جديدة";
    document.getElementById("event-location").value = "";
    document.getElementById("event-date").value = todayISO();
    document.getElementById("event-people-count").value = "0";
    draftExpenseItems = [];
    draftCompanies = [];
    draftTeam = [];
    renderExpenseItemsList();
    renderCompaniesList();
    renderTeamList();
    document.getElementById("modal-event-form").classList.add("is-open");
  }

  function openEditModal(id) {
    const record = readEvents().find((r) => r.id === id);
    if (!record) { alert("الفعالية لم تعد موجودة."); return; }

    document.getElementById("event-editing-id").value = record.id;
    document.getElementById("event-modal-title").textContent = `تعديل: ${record.location}`;
    document.getElementById("event-location").value = record.location;
    document.getElementById("event-date").value = record.date;
    document.getElementById("event-people-count").value = record.peopleCount;

    draftExpenseItems = record.expenseItems.map((e) => ({ ...e }));
    draftCompanies = record.companies.map((c) => ({ ...c }));
    draftTeam = record.team.map((t) => ({ ...t }));
    renderExpenseItemsList();
    renderCompaniesList();
    renderTeamList();

    document.getElementById("modal-event-form").classList.add("is-open");
  }

  function saveEvent() {
    const location = document.getElementById("event-location").value.trim();
    const date = document.getElementById("event-date").value;
    const peopleCount = Number(document.getElementById("event-people-count").value) || 0;
    const editingId = document.getElementById("event-editing-id").value;

    if (!location) { alert("مكان الفعالية مطلوب."); return; }
    if (!date) { alert("تاريخ الفعالية مطلوب."); return; }
    if (peopleCount < 0) { alert("عدد الأفراد لا يمكن أن يكون سالبًا."); return; }

    // Validate every expense item that has ANY content — an empty row
    // (never touched) is silently dropped rather than rejected, but a
    // partially-filled one (description without amount, etc.) is flagged.
    const cleanedExpenseItems = [];
    for (const item of draftExpenseItems) {
      const hasAnyContent = item.description.trim() || item.amount > 0;
      if (!hasAnyContent) continue;
      if (!item.description.trim()) { alert("كل بند صرف لازم يكون له بيان."); return; }
      if (!(item.amount > 0)) { alert(`بند "${item.description}" — المبلغ لازم يكون أكبر من صفر.`); return; }
      cleanedExpenseItems.push({ id: item.id, description: item.description.trim(), category: item.category, amount: item.amount });
    }

    const cleanedCompanies = draftCompanies.filter((c) => c.name.trim()).map((c) => ({ id: c.id, name: c.name.trim() }));
    const cleanedTeam = draftTeam.filter((t) => t.name.trim() || t.role.trim());
    for (const member of cleanedTeam) {
      if (!member.name.trim()) { alert("كل عضو في الفريق لازم يكون له اسم."); return; }
    }

    const totalSpent = Math.round(cleanedExpenseItems.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;

    const rows = readEvents();
    if (editingId) {
      const idx = rows.findIndex((r) => r.id === editingId);
      if (idx === -1) { alert("الفعالية لم تعد موجودة."); return; }
      rows[idx] = { ...rows[idx], location, date, peopleCount, expenseItems: cleanedExpenseItems, companies: cleanedCompanies, team: cleanedTeam, totalSpent };
    } else {
      rows.push({
        id: generateId("event"), location, date, peopleCount,
        expenseItems: cleanedExpenseItems, companies: cleanedCompanies, team: cleanedTeam,
        totalSpent, createdAt: todayISO(),
      });
    }

    if (writeEvents(rows)) {
      document.getElementById("modal-event-form").classList.remove("is-open");
      renderEventsTable();
    }
  }

  function deleteEvent(id) {
    const rows = readEvents();
    const record = rows.find((r) => r.id === id);
    if (!record) { alert("الفعالية لم تعد موجودة."); return; }
    if (!confirm(`حذف فعالية "${record.location}" نهائيًا؟`)) return;
    writeEvents(rows.filter((r) => r.id !== id));
    renderEventsTable();
  }

  // =========================================================================
  // View details
  // =========================================================================

  function viewEvent(id) {
    const record = readEvents().find((r) => r.id === id);
    if (!record) { alert("الفعالية لم تعد موجودة."); return; }

    document.getElementById("event-view-title").textContent = record.location;
    const expenseRows = record.expenseItems.map((e) => `
      <tr><td>${e.category === "purchase" ? "مشتريات" : "استئجار"}</td><td>${e.description}</td><td class="num">${fmtMoney(e.amount)}</td></tr>
    `).join("") || `<tr><td colspan="3" style="text-align:center;color:var(--text-faint);">لا توجد بنود صرف</td></tr>`;

    document.getElementById("event-view-body").innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;margin-bottom:18px;">
        <div><strong>التاريخ:</strong> ${record.date}</div>
        <div><strong>عدد الأفراد:</strong> ${record.peopleCount}</div>
        <div><strong>إجمالي الصرف:</strong> ${fmtMoney(record.totalSpent)}</div>
        <div><strong>الشركات المشاركة:</strong> ${record.companies.map((c) => c.name).join("، ") || "—"}</div>
      </div>

      <h4 style="font-family:'Cairo',sans-serif;font-weight:800;font-size:13px;margin-bottom:8px;">تفاصيل المصروفات</h4>
      <table class="ledger" style="min-width:0;width:100%;margin-bottom:18px;">
        <thead><tr><th>النوع</th><th>البيان</th><th>المبلغ</th></tr></thead>
        <tbody>${expenseRows}</tbody>
      </table>

      <h4 style="font-family:'Cairo',sans-serif;font-weight:800;font-size:13px;margin-bottom:8px;">Team Management</h4>
      ${record.team.length === 0
        ? `<p style="font-size:12px;color:var(--text-faint);">لا يوجد فريق مسجّل</p>`
        : `<ul style="font-size:12.5px;padding-inline-start:18px;">${record.team.map((t) => `<li>${t.name} — ${t.role || "بدون وظيفة محددة"}</li>`).join("")}</ul>`}
    `;
    document.getElementById("modal-event-view").classList.add("is-open");
  }

  // =========================================================================
  // Main table
  // =========================================================================

  function renderEventsTable() {
    const query = (document.getElementById("events-search").value || "").trim().toLowerCase();
    let rows = readEvents();
    if (query) rows = rows.filter((r) => r.location.toLowerCase().includes(query));
    rows = [...rows].sort((a, b) => (b.id > a.id ? 1 : -1));

    const tbody = document.getElementById("events-table-body");
    const table = document.getElementById("events-table");
    const empty = document.getElementById("events-empty-state");

    if (rows.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td><strong>${r.location}</strong></td>
        <td>${r.date}</td>
        <td class="num">${fmtMoney(r.totalSpent)}</td>
        <td>${r.peopleCount}</td>
        <td>${r.companies.length}</td>
        <td>${r.team.length}</td>
        <td>
          <button class="row-action-btn" data-view-event="${r.id}" title="عرض التفاصيل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg></button>
          <button class="row-action-btn" data-edit-event="${r.id}" title="تعديل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
          <button class="row-action-btn is-danger" data-delete-event="${r.id}" title="حذف"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg></button>
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("[data-view-event]").forEach((b) => b.addEventListener("click", () => viewEvent(b.dataset.viewEvent)));
    tbody.querySelectorAll("[data-edit-event]").forEach((b) => b.addEventListener("click", () => openEditModal(b.dataset.editEvent)));
    tbody.querySelectorAll("[data-delete-event]").forEach((b) => b.addEventListener("click", () => deleteEvent(b.dataset.deleteEvent)));
  }

  // =========================================================================
  // Export
  // =========================================================================

  function csvEscape(value) {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportEventsToCsv() {
    const rows = readEvents();
    if (rows.length === 0) { alert("لا توجد فعاليات لتصديرها."); return; }
    const lines = [["المكان", "التاريخ", "إجمالي الصرف", "عدد الأفراد", "الشركات المشاركة", "حجم الفريق"].map(csvEscape).join(",")];
    rows.forEach((r) => {
      lines.push([r.location, r.date, r.totalSpent.toFixed(2), r.peopleCount, r.companies.map((c) => c.name).join(" / "), r.team.length].map(csvEscape).join(","));
    });
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Voyvista-Events-${todayISO()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-close-modal]").forEach((btn) => btn.addEventListener("click", () => document.getElementById(btn.dataset.closeModal)?.classList.remove("is-open")));
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open")); });

    document.getElementById("btn-open-add-event").addEventListener("click", openAddModal);
    document.getElementById("btn-save-event").addEventListener("click", saveEvent);
    document.getElementById("events-search").addEventListener("input", renderEventsTable);
    document.getElementById("btn-export-events-excel").addEventListener("click", exportEventsToCsv);
    document.getElementById("btn-add-expense-item").addEventListener("click", addExpenseItem);
    document.getElementById("btn-add-company").addEventListener("click", addCompany);
    document.getElementById("btn-add-team-member").addEventListener("click", addTeamMember);

    renderEventsTable();
  });
})();