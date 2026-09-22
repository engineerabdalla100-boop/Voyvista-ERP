(function () {
  "use strict";

  var editingId = null;
  var allEvents = [];
  var draftExpenseItems = [];
  var draftCompanies = [];
  var draftTeam = [];

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  // Load and render main table
  // =========================================================================

  async function loadEvents(search) {
    try {
      var params = search ? "?search=" + encodeURIComponent(search) : "";
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EVENTS + params);
      allEvents = result.data.results || result.data;
    } catch (err) {
      allEvents = [];
    }
    renderEventsTable();
  }

  function renderEventsTable() {
    var rows = allEvents.slice().sort(function (a, b) { return a.id < b.id ? 1 : -1; });
    var tbody = document.getElementById("events-table-body");
    var table = document.getElementById("events-table");
    var empty = document.getElementById("events-empty-state");

    if (rows.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = rows.map(function (r) {
      return "<tr>" +
        "<td><strong>" + r.location + "</strong></td>" +
        "<td>" + r.date + "</td>" +
        "<td class=\"num\">" + fmtMoney(r.total_spent) + "</td>" +
        "<td>" + r.people_count + "</td>" +
        "<td>" + r.companies.length + "</td>" +
        "<td>" + r.team.length + "</td>" +
        "<td>" +
          "<button class=\"row-action-btn\" data-view-event=\"" + r.id + "\" title=\"View\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 16v-4M12 8h.01\"/></svg></button>" +
          "<button class=\"row-action-btn\" data-edit-event=\"" + r.id + "\" title=\"Edit\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z\"/></svg></button>" +
          "<button class=\"row-action-btn is-danger\" data-delete-event=\"" + r.id + "\" title=\"Delete\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6\"/></svg></button>" +
        "</td>" +
      "</tr>";
    }).join("");

    tbody.querySelectorAll("[data-view-event]").forEach(function (b) {
      b.addEventListener("click", function () { viewEvent(b.dataset.viewEvent); });
    });
    tbody.querySelectorAll("[data-edit-event]").forEach(function (b) {
      b.addEventListener("click", function () { openEditModal(b.dataset.editEvent); });
    });
    tbody.querySelectorAll("[data-delete-event]").forEach(function (b) {
      b.addEventListener("click", function () { deleteEvent(b.dataset.deleteEvent); });
    });
  }

  // =========================================================================
  // Expense items sub-form
  // =========================================================================

  function renderExpenseItemsList() {
    var wrap = document.getElementById("expense-items-list");
    wrap.innerHTML = draftExpenseItems.map(function (item, i) {
      return "<div class=\"sub-item-row\">" +
        "<select data-expense-category=\"" + i + "\" style=\"width:110px;\">" +
          "<option value=\"purchase\"" + (item.category === "purchase" ? " selected" : "") + ">Purchase</option>" +
          "<option value=\"rental\"" + (item.category === "rental" ? " selected" : "") + ">Rental</option>" +
        "</select>" +
        "<input type=\"text\" data-expense-desc=\"" + i + "\" placeholder=\"Description...\" value=\"" + item.description + "\" style=\"flex:2;\" />" +
        "<input type=\"number\" min=\"0\" step=\"0.01\" data-expense-amount=\"" + i + "\" placeholder=\"Amount\" value=\"" + item.amount + "\" style=\"width:100px;\" />" +
        "<button type=\"button\" class=\"sub-item-remove\" data-remove-expense=\"" + i + "\">X</button>" +
      "</div>";
    }).join("");

    wrap.querySelectorAll("[data-expense-category]").forEach(function (el) {
      el.addEventListener("change", function (e) { draftExpenseItems[+el.dataset.expenseCategory].category = e.target.value; });
    });
    wrap.querySelectorAll("[data-expense-desc]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftExpenseItems[+el.dataset.expenseDesc].description = e.target.value; });
    });
    wrap.querySelectorAll("[data-expense-amount]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftExpenseItems[+el.dataset.expenseAmount].amount = Number(e.target.value) || 0; updateSpentTotal(); });
    });
    wrap.querySelectorAll("[data-remove-expense]").forEach(function (el) {
      el.addEventListener("click", function () { draftExpenseItems.splice(+el.dataset.removeExpense, 1); renderExpenseItemsList(); updateSpentTotal(); });
    });

    updateSpentTotal();
  }

  function updateSpentTotal() {
    var total = draftExpenseItems.reduce(function (sum, item) { return sum + (Number(item.amount) || 0); }, 0);
    document.getElementById("event-total-spent").textContent = fmtMoney(total);
  }

  function addExpenseItem() {
    draftExpenseItems.push({ description: "", category: "purchase", amount: 0 });
    renderExpenseItemsList();
  }

  // =========================================================================
  // Companies sub-form
  // =========================================================================

  function renderCompaniesList() {
    var wrap = document.getElementById("companies-list");
    wrap.innerHTML = draftCompanies.map(function (c, i) {
      return "<div class=\"sub-item-row\">" +
        "<input type=\"text\" data-company-name=\"" + i + "\" placeholder=\"Company name...\" value=\"" + c.name + "\" style=\"flex:1;\" />" +
        "<button type=\"button\" class=\"sub-item-remove\" data-remove-company=\"" + i + "\">X</button>" +
      "</div>";
    }).join("");
    wrap.querySelectorAll("[data-company-name]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftCompanies[+el.dataset.companyName].name = e.target.value; });
    });
    wrap.querySelectorAll("[data-remove-company]").forEach(function (el) {
      el.addEventListener("click", function () { draftCompanies.splice(+el.dataset.removeCompany, 1); renderCompaniesList(); });
    });
  }
  function addCompany() {
    draftCompanies.push({ name: "" });
    renderCompaniesList();
  }

  // =========================================================================
  // Team sub-form
  // =========================================================================

  function renderTeamList() {
    var wrap = document.getElementById("team-list");
    wrap.innerHTML = draftTeam.map(function (t, i) {
      return "<div class=\"sub-item-row\">" +
        "<input type=\"text\" data-team-name=\"" + i + "\" placeholder=\"Name...\" value=\"" + t.name + "\" style=\"flex:1;\" />" +
        "<input type=\"text\" data-team-role=\"" + i + "\" placeholder=\"Role...\" value=\"" + t.role + "\" style=\"flex:1;\" />" +
        "<button type=\"button\" class=\"sub-item-remove\" data-remove-team=\"" + i + "\">X</button>" +
      "</div>";
    }).join("");
    wrap.querySelectorAll("[data-team-name]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftTeam[+el.dataset.teamName].name = e.target.value; });
    });
    wrap.querySelectorAll("[data-team-role]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftTeam[+el.dataset.teamRole].role = e.target.value; });
    });
    wrap.querySelectorAll("[data-remove-team]").forEach(function (el) {
      el.addEventListener("click", function () { draftTeam.splice(+el.dataset.removeTeam, 1); renderTeamList(); });
    });
  }
  function addTeamMember() {
    draftTeam.push({ name: "", role: "" });
    renderTeamList();
  }

  // =========================================================================
  // Add / Edit modal
  // =========================================================================

  function openAddModal() {
    editingId = null;
    document.getElementById("event-editing-id").value = "";
    document.getElementById("event-modal-title").textContent = "Add New Event";
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
    var record = allEvents.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This event no longer exists."); return; }

    editingId = id;
    document.getElementById("event-editing-id").value = record.id;
    document.getElementById("event-modal-title").textContent = "Edit: " + record.location;
    document.getElementById("event-location").value = record.location;
    document.getElementById("event-date").value = record.date;
    document.getElementById("event-people-count").value = record.people_count;

    draftExpenseItems = record.expense_items.map(function (e) { return { description: e.description, category: e.category, amount: e.amount }; });
    draftCompanies = record.companies.map(function (c) { return { name: c.name }; });
    draftTeam = record.team.map(function (t) { return { name: t.name, role: t.role }; });
    renderExpenseItemsList();
    renderCompaniesList();
    renderTeamList();

    document.getElementById("modal-event-form").classList.add("is-open");
  }

  async function saveEvent() {
    var location = document.getElementById("event-location").value.trim();
    var date = document.getElementById("event-date").value;
    var peopleCount = Number(document.getElementById("event-people-count").value) || 0;

    if (!location) { alert("Location is required."); return; }
    if (!date) { alert("Date is required."); return; }
    if (peopleCount < 0) { alert("Headcount cannot be negative."); return; }

    var cleanedExpenseItems = [];
    for (var i = 0; i < draftExpenseItems.length; i++) {
      var item = draftExpenseItems[i];
      var hasAnyContent = item.description.trim() || item.amount > 0;
      if (!hasAnyContent) continue;
      if (!item.description.trim()) { alert("Every expense item needs a description."); return; }
      if (!(item.amount > 0)) { alert("Item \"" + item.description + "\" - amount must be greater than zero."); return; }
      cleanedExpenseItems.push({ description: item.description.trim(), category: item.category, amount: item.amount });
    }

    var cleanedCompanies = draftCompanies.filter(function (c) { return c.name.trim(); }).map(function (c) { return { name: c.name.trim() }; });

    var cleanedTeam = draftTeam.filter(function (t) { return t.name.trim() || t.role.trim(); });
    for (var j = 0; j < cleanedTeam.length; j++) {
      if (!cleanedTeam[j].name.trim()) { alert("Every team member needs a name."); return; }
    }

    var payload = {
      location: location,
      date: date,
      people_count: peopleCount,
      expense_items: cleanedExpenseItems,
      companies: cleanedCompanies,
      team: cleanedTeam,
    };

    var btn = document.getElementById("btn-save-event");
    if (btn) btn.disabled = true;
    try {
      if (editingId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.EVENT_DETAIL(editingId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.EVENTS, { method: "POST", body: payload });
      }
      closeModal("modal-event-form");
      await loadEvents(document.getElementById("events-search").value);
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteEvent(id) {
    var record = allEvents.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This event no longer exists."); return; }
    if (!confirm("Delete event \"" + record.location + "\" permanently?")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EVENT_DETAIL(id), { method: "DELETE" });
      await loadEvents(document.getElementById("events-search").value);
    } catch (err) {
      alert(err.message || "Failed to delete.");
    }
  }

  // =========================================================================
  // View details
  // =========================================================================

  function viewEvent(id) {
    var record = allEvents.find(function (r) { return String(r.id) === String(id); });
    if (!record) { alert("This event no longer exists."); return; }

    var expenseRows = record.expense_items.map(function (e) {
      return "<tr><td>" + (e.category === "purchase" ? "Purchase" : "Rental") + "</td><td>" + e.description + "</td><td class=\"num\">" + fmtMoney(e.amount) + "</td></tr>";
    }).join("") || "<tr><td colspan=\"3\" style=\"text-align:center;color:var(--text-faint);\">No expense items</td></tr>";

    var companiesText = record.companies.map(function (c) { return c.name; }).join(", ") || "-";

    var teamHtml = record.team.length === 0
      ? "<p style=\"font-size:12px;color:var(--text-faint);\">No team registered</p>"
      : "<ul style=\"font-size:12.5px;padding-inline-start:18px;\">" + record.team.map(function (t) {
          return "<li>" + t.name + " - " + (t.role || "No role specified") + "</li>";
        }).join("") + "</ul>";

    document.getElementById("event-view-title").textContent = record.location;
    document.getElementById("event-view-body").innerHTML =
      "<div style=\"display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12.5px;margin-bottom:18px;\">" +
        "<div><strong>Date:</strong> " + record.date + "</div>" +
        "<div><strong>Headcount:</strong> " + record.people_count + "</div>" +
        "<div><strong>Total Spent:</strong> " + fmtMoney(record.total_spent) + "</div>" +
        "<div><strong>Participating Companies:</strong> " + companiesText + "</div>" +
      "</div>" +
      "<h4 style=\"font-family:var(--font-display);font-weight:700;font-size:13px;margin-bottom:8px;\">Expense Details</h4>" +
      "<table class=\"ledger\" style=\"min-width:0;width:100%;margin-bottom:18px;\">" +
        "<thead><tr><th>Type</th><th>Description</th><th>Amount</th></tr></thead>" +
        "<tbody>" + expenseRows + "</tbody>" +
      "</table>" +
      "<h4 style=\"font-family:var(--font-display);font-weight:700;font-size:13px;margin-bottom:8px;\">Team Management</h4>" +
      teamHtml;

    document.getElementById("modal-event-view").classList.add("is-open");
  }

  // =========================================================================
  // Export CSV
  // =========================================================================

  function csvEscape(value) {
    var s = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
  }

  function exportEventsToCsv() {
    if (allEvents.length === 0) { alert("No events to export."); return; }
    var lines = [["Location", "Date", "Total Spent", "Headcount", "Companies", "Team Size"].map(csvEscape).join(",")];
    allEvents.forEach(function (r) {
      var companiesText = r.companies.map(function (c) { return c.name; }).join(" / ");
      lines.push([r.location, r.date, Number(r.total_spent).toFixed(2), r.people_count, companiesText, r.team.length].map(csvEscape).join(","));
    });
    var csv = "\uFEFF" + lines.join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Voyvista-Events-" + todayISO() + ".csv";
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

    on("btn-open-add-event", "click", openAddModal);
    on("btn-save-event", "click", saveEvent);
    on("events-search", "input", function (e) { loadEvents(e.target.value); });
    on("btn-export-events-csv", "click", exportEventsToCsv);
    on("btn-add-expense-item", "click", addExpenseItem);
    on("btn-add-company", "click", addCompany);
    on("btn-add-team-member", "click", addTeamMember);

    loadEvents();
  });
})();