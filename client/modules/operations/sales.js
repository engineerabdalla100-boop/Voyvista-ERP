(function () {
  "use strict";

  var STAGES = [
    { key: "stage1", label: "\u0627\u0633\u062A\u0647\u062F\u0627\u0641 \u062C\u062F\u064A\u062F", color: "#3068E0" },
    { key: "stage2", label: "\u062C\u0627\u0631\u064A \u0627\u0644\u062A\u0648\u0627\u0635\u0644", color: "#C79A3B" },
    { key: "stage3", label: "\u0639\u0631\u0636 \u0633\u0639\u0631 / \u062A\u0641\u0627\u0648\u0636", color: "#8B5CF6" },
    { key: "stage4", label: "\u062A\u0645 \u0627\u0644\u062A\u0639\u0627\u0642\u062F (Won)", color: "#1F9D6E" },
    { key: "stage5", label: "\u0635\u0641\u0642\u0629 \u0645\u0641\u0642\u0648\u062F\u0629 (Lost)", color: "#B02A2A" },
  ];

  var dealsCache = [];
  var activitiesCache = [];

  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  function on(id, event, handler) { var el = document.getElementById(id); if (el) el.addEventListener(event, handler); return el; }

  // =========================================================================
  // Data loading -- requestAllPages from day one, no 50-record cap.
  // =========================================================================

  async function loadDeals() {
    try {
      dealsCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.DEALS);
    } catch (err) {
      dealsCache = [];
    }
    renderKanban();
    renderContactsTable();
    renderOpsTable();
    populateLogDealSelect();
  }

  async function loadActivities() {
    try {
      activitiesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.ACTIVITIES);
    } catch (err) {
      activitiesCache = [];
    }
    renderTasksTable();
  }

  // =========================================================================
  // Tabs
  // =========================================================================

  function switchTab(tab) {
    ["pipeline", "tasks", "contacts", "ops"].forEach(function (t) {
      var view = document.getElementById("crm-view-" + t);
      if (view) view.style.display = t === tab ? "block" : "none";
      var btn = document.querySelector("[data-crm-tab=\"" + t + "\"]");
      if (btn) btn.classList.toggle("is-active", t === tab);
    });
  }

  // =========================================================================
  // Kanban rendering
  // =========================================================================

  function renderKanban() {
    var grid = document.getElementById("kanban-grid");
    if (!grid) return;

    grid.innerHTML = STAGES.map(function (stage) {
      var stageDeals = dealsCache.filter(function (d) { return d.stage === stage.key; });
      var cards = stageDeals.map(function (deal) { return dealCardHtml(deal, stage.key); }).join("");
      return "<div class=\"kanban-col\">" +
        "<div class=\"kanban-col__head\">" +
          "<span class=\"kanban-col__title\" style=\"color:" + stage.color + ";\">" + stage.label + "</span>" +
          "<span class=\"kanban-col__count\">" + stageDeals.length + "</span>" +
        "</div>" +
        "<div>" + cards + "</div>" +
      "</div>";
    }).join("");

    var totalDeals = document.getElementById("crm-total-deals");
    var totalValue = document.getElementById("crm-total-value");
    if (totalDeals) totalDeals.textContent = dealsCache.length;
    if (totalValue) totalValue.textContent = fmtMoney(dealsCache.reduce(function (sum, d) { return sum + Number(d.estimated_value || 0); }, 0)) + " \u062C.\u0645";

    grid.querySelectorAll("[data-move-stage]").forEach(function (select) {
      select.addEventListener("change", function () {
        moveDealStage(select.dataset.moveStage, select.value);
      });
    });
  }

  function dealCardHtml(deal, currentStage) {
    var waLink = deal.contact_phone ? "https://wa.me/" + deal.contact_phone.replace(/[^0-9]/g, "") : "";
    var mailLink = deal.contact_email ? "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(deal.contact_email) + "&su=" + encodeURIComponent(deal.company_name) : "";

    var stageOptions = STAGES.map(function (s) {
      return "<option value=\"" + s.key + "\"" + (s.key === currentStage ? " selected" : "") + ">" + s.label + "</option>";
    }).join("");

    return "<div class=\"deal-card\">" +
      "<div class=\"deal-card__name\">" + escapeHtml(deal.company_name) + "</div>" +
      "<div class=\"deal-card__meta\">" + escapeHtml(deal.contact_name || "-") + " -- " + escapeHtml(deal.service_type || "-") + "</div>" +
      "<div class=\"deal-card__value\">" + fmtMoney(deal.estimated_value) + " \u062C.\u0645</div>" +
      "<div class=\"deal-card__actions\">" +
        (waLink ? "<a class=\"wa-link\" href=\"" + waLink + "\" target=\"_blank\">\u0648\u0627\u062A\u0633\u0627\u0628</a>" : "") +
        (mailLink ? "<a class=\"mail-link\" href=\"" + mailLink + "\" target=\"_blank\">\u0625\u064A\u0645\u064A\u0644</a>" : "") +
      "</div>" +
      "<select class=\"stage-move\" data-move-stage=\"" + deal.id + "\">" + stageOptions + "</select>" +
    "</div>";
  }

  async function moveDealStage(dealId, newStage) {
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.DEAL_MOVE_STAGE(dealId), { method: "POST", body: { stage: newStage } });
      await loadDeals();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u062D\u062F\u064A\u062B \u0645\u0631\u062D\u0644\u0629 \u0627\u0644\u0635\u0641\u0642\u0629.");
    }
  }

  // =========================================================================
  // Tasks table
  // =========================================================================

  function renderTasksTable() {
    var tbody = document.getElementById("tasks-table-body");
    var table = document.getElementById("tasks-table");
    var empty = document.getElementById("tasks-empty");
    if (!tbody || !table || !empty) return;

    if (activitiesCache.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table"; empty.style.display = "none";

    var typeLabels = {
      whatsapp: "\uD83D\uDCAC \u0648\u0627\u062A\u0633\u0627\u0628", call: "\uD83D\uDCDE \u0645\u0643\u0627\u0644\u0645\u0629",
      email: "\uD83D\uDCE7 \u0625\u064A\u0645\u064A\u0644", visit: "\uD83E\uDD1D \u0632\u064A\u0627\u0631\u0629",
    };

    tbody.innerHTML = activitiesCache.map(function (a) {
      var deal = dealsCache.find(function (d) { return d.id === a.deal; });
      return "<tr>" +
        "<td>" + escapeHtml(deal ? deal.company_name : "-") + "</td>" +
        "<td>" + (typeLabels[a.activity_type] || a.activity_type) + "</td>" +
        "<td>" + (a.reminder_at ? new Date(a.reminder_at).toLocaleString("ar-EG") : "-") + "</td>" +
        "<td>" + escapeHtml(a.note) + "</td>" +
      "</tr>";
    }).join("");
  }

  function populateLogDealSelect() {
    var select = document.getElementById("log-deal-select");
    if (!select) return;
    select.innerHTML = dealsCache.map(function (d) {
      return "<option value=\"" + d.id + "\">" + escapeHtml(d.company_name) + "</option>";
    }).join("");
  }

  // =========================================================================
  // Contacts table
  // =========================================================================

  function renderContactsTable() {
    var tbody = document.getElementById("contacts-table-body");
    var table = document.getElementById("contacts-table");
    var empty = document.getElementById("contacts-empty");
    if (!tbody || !table || !empty) return;

    if (dealsCache.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table"; empty.style.display = "none";

    tbody.innerHTML = dealsCache.map(function (d) {
      var waLink = d.contact_phone ? "https://wa.me/" + d.contact_phone.replace(/[^0-9]/g, "") : "";
      var mailLink = d.contact_email ? "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(d.contact_email) : "";
      return "<tr>" +
        "<td>" + escapeHtml(d.company_name) + "</td>" +
        "<td>" + escapeHtml(d.contact_name || "-") + "</td>" +
        "<td>" + escapeHtml(d.contact_phone || "-") + "</td>" +
        "<td>" + escapeHtml(d.contact_email || "-") + "</td>" +
        "<td>" +
          (waLink ? "<a class=\"wa-link\" style=\"margin-inline-end:6px;\" href=\"" + waLink + "\" target=\"_blank\">\u0648\u0627\u062A\u0633\u0627\u0628</a>" : "") +
          (mailLink ? "<a class=\"mail-link\" href=\"" + mailLink + "\" target=\"_blank\">\u0625\u064A\u0645\u064A\u0644</a>" : "") +
        "</td>" +
      "</tr>";
    }).join("");
  }

  // =========================================================================
  // Ops table (deals that reached "Won")
  // =========================================================================

  function renderOpsTable() {
    var tbody = document.getElementById("ops-table-body");
    var table = document.getElementById("ops-table");
    var empty = document.getElementById("ops-empty");
    if (!tbody || !table || !empty) return;

    var wonDeals = dealsCache.filter(function (d) { return d.stage === "stage4"; });
    if (wonDeals.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table"; empty.style.display = "none";

    tbody.innerHTML = wonDeals.map(function (d) {
      var statusHtml = d.booking_id
        ? "<span class=\"status-badge status-badge--posted\">\u0645\u062D\u0648\u0644 \u0644\u062D\u062C\u0632</span>"
        : "<span class=\"status-badge status-badge--pending\">\u0628\u0627\u0646\u062A\u0638\u0627\u0631 \u0627\u0644\u062A\u062D\u0648\u064A\u0644</span>";
      return "<tr>" +
        "<td>" + (d.booking_id || "-") + "</td>" +
        "<td>" + escapeHtml(d.company_name) + "</td>" +
        "<td>" + escapeHtml(d.service_type || "-") + "</td>" +
        "<td class=\"num\">" + fmtMoney(d.estimated_value) + "</td>" +
        "<td class=\"num\">-</td>" +
        "<td class=\"num\">-</td>" +
        "<td>" + statusHtml + "</td>" +
      "</tr>";
    }).join("");
  }

  // =========================================================================
  // Save deal / activity
  // =========================================================================

  async function saveDeal() {
    var payload = {
      company_name: document.getElementById("deal-company-name").value.trim(),
      contact_name: document.getElementById("deal-contact-name").value.trim(),
      contact_phone: document.getElementById("deal-contact-phone").value.trim(),
      contact_email: document.getElementById("deal-contact-email").value.trim(),
      service_type: document.getElementById("deal-service-type").value,
      estimated_value: document.getElementById("deal-value").value || "0",
    };
    if (!payload.company_name) { alert("\u0627\u0633\u0645 \u0627\u0644\u0634\u0631\u0643\u0629 \u0645\u0637\u0644\u0648\u0628."); return; }

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.DEALS, { method: "POST", body: payload });
      closeModal("modal-add-deal");
      document.getElementById("deal-company-name").value = "";
      document.getElementById("deal-contact-name").value = "";
      document.getElementById("deal-contact-phone").value = "";
      document.getElementById("deal-contact-email").value = "";
      document.getElementById("deal-value").value = "0";
      await loadDeals();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062D\u0641\u0638 \u0627\u0644\u0635\u0641\u0642\u0629.");
    }
  }

  async function saveActivity() {
    var payload = {
      deal: document.getElementById("log-deal-select").value,
      activity_type: document.getElementById("log-activity-type").value,
      note: document.getElementById("log-activity-note").value.trim(),
      reminder_at: document.getElementById("log-activity-reminder").value || null,
    };
    if (!payload.deal || !payload.note) { alert("\u0627\u062E\u062A\u0631 \u0627\u0644\u0635\u0641\u0642\u0629 \u0648\u0627\u0643\u062A\u0628 \u0645\u0644\u062E\u0635 \u0627\u0644\u062A\u0648\u0627\u0635\u0644."); return; }

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.ACTIVITIES, { method: "POST", body: payload });
      closeModal("modal-log-activity");
      document.getElementById("log-activity-note").value = "";
      document.getElementById("log-activity-reminder").value = "";
      await loadActivities();
    } catch (err) {
      alert(err.message || "\u0641\u0634\u0644 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u0646\u0634\u0627\u0637.");
    }
  }

  // =========================================================================
  // Init
  // =========================================================================

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll("[data-crm-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.crmTab); });
    });

    on("btn-open-add-deal", "click", function () { openModal("modal-add-deal"); });
    on("btn-open-log-activity", "click", function () { openModal("modal-log-activity"); });
    on("btn-save-deal", "click", saveDeal);
    on("btn-save-activity", "click", saveActivity);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });

    loadDeals();
    loadActivities();
  });
})();