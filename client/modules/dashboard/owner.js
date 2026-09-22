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

  var DEPT_LABELS = { flight: "Flights", hotel: "Hotels", visa: "Visas" };
  var DEPT_COLORS = { flight: "#1F9D6E", hotel: "#D1499A", visa: "#C98A1E" };

  var revenueChartInstance = null;
  var countChartInstance = null;
  var ownerFilesCache = [];

  document.addEventListener("DOMContentLoaded", function () {
    var currentUser = null;
    try { currentUser = JSON.parse(localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER)); } catch (e) {}
    if (!currentUser || currentUser.role !== "ADMIN") {
      var itLink = document.querySelector("a[href*=\"it_dashboard\"]");
      if (itLink) itLink.style.display = "none";
    }

    loadOverview();

    document.getElementById("btn-refresh-overview")?.addEventListener("click", loadOverview);
    document.getElementById("btn-open-owner-drive")?.addEventListener("click", function () { openModal("modal-owner-drive"); loadOwnerFiles(); });
    document.getElementById("btn-upload-owner-file")?.addEventListener("click", function () { document.getElementById("owner-file-input").click(); });
    document.getElementById("owner-file-input")?.addEventListener("change", handleFileUpload);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach(function (o) { o.classList.remove("is-open"); });
    });
  });

  // =========================================================================
  // Financial Overview + Charts
  // =========================================================================

  async function loadOverview() {
    var grid = document.getElementById("owner-report-grid");
    grid.innerHTML = "<div class=\"empty-state\">Loading...</div>";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.DASHBOARD_OVERVIEW);
      renderReportGrid(result.data);
      renderCharts(result.data);
    } catch (err) {
      grid.innerHTML = "<div class=\"empty-state\">" + escapeHtml(err.message || "Failed to load overview.") + "</div>";
    }
  }

  function renderReportGrid(data) {
    var grid = document.getElementById("owner-report-grid");
    var currencies = Object.keys(data.totals_by_currency || {});

    var revenueLines = currencies.length
      ? currencies.map(function (c) { return "<div class=\"stat-tile__currency-line\">" + fmtMoney(data.totals_by_currency[c].revenue) + " " + escapeHtml(c) + "</div>"; }).join("")
      : "<div class=\"stat-tile__currency-line\">0.00</div>";

    var profitLines = currencies.length
      ? currencies.map(function (c) { return "<div class=\"stat-tile__currency-line\">" + fmtMoney(data.totals_by_currency[c].profit) + " " + escapeHtml(c) + "</div>"; }).join("")
      : "<div class=\"stat-tile__currency-line\">0.00</div>";

    grid.innerHTML =
      "<div class=\"stat-tile\">" +
        "<div class=\"stat-tile__icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"2\"/><path d=\"M3 9h18\"/></svg></div>" +
        "<div class=\"stat-tile__currency-line\">" + (data.total_bookings || 0) + "</div>" +
        "<div class=\"stat-tile__label\">Total Bookings</div>" +
      "</div>" +
      "<div class=\"stat-tile\">" +
        "<div class=\"stat-tile__icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6\"/></svg></div>" +
        revenueLines +
        "<div class=\"stat-tile__label\">Total Revenue (by currency)</div>" +
      "</div>" +
      "<div class=\"stat-tile\">" +
        "<div class=\"stat-tile__icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M22 12h-4l-3 9L9 3l-3 9H2\"/></svg></div>" +
        profitLines +
        "<div class=\"stat-tile__label\">Net Profit (by currency)</div>" +
      "</div>" +
      "<div class=\"stat-tile\">" +
        "<div class=\"stat-tile__icon\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\"><path d=\"M3 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15\"/><path d=\"M14 10h6a1 1 0 0 1 1 1v10\"/></svg></div>" +
        "<div class=\"stat-tile__currency-line\">" + Object.keys(data.by_department || {}).length + "</div>" +
        "<div class=\"stat-tile__label\">Departments Tracked</div>" +
      "</div>";
  }

  function renderCharts(data) {
    var deptKeys = Object.keys(data.by_department || {});
    var labels = deptKeys.map(function (k) { return DEPT_LABELS[k] || k; });
    var colors = deptKeys.map(function (k) { return DEPT_COLORS[k] || "#999"; });
    var counts = deptKeys.map(function (k) { return data.by_department[k].count || 0; });

    // Revenue chart: sums the largest currency bucket per department for
    // a simple visual comparison -- exact per-currency figures are in
    // the stat tiles above, never combined there.
    var revenueByDept = deptKeys.map(function (k) {
      var byCurrency = data.by_department[k].totals_by_currency || {};
      var values = Object.values(byCurrency).map(function (v) { return Number(v.revenue) || 0; });
      return values.length ? Math.max.apply(null, values) : 0;
    });

    if (typeof Chart === "undefined") return;

    var revCanvas = document.getElementById("chart-revenue-by-dept");
    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(revCanvas, {
      type: "bar",
      data: { labels: labels, datasets: [{ label: "Revenue", data: revenueByDept, backgroundColor: colors }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });

    var countCanvas = document.getElementById("chart-count-by-dept");
    if (countChartInstance) countChartInstance.destroy();
    countChartInstance = new Chart(countCanvas, {
      type: "doughnut",
      data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
    });
  }

  // =========================================================================
  // My Files
  // =========================================================================

  async function loadOwnerFiles() {
    var list = document.getElementById("owner-files-list");
    list.innerHTML = "<div class=\"empty-state\">Loading...</div>";
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.OWNER_FILES);
      ownerFilesCache = result.data.results || result.data;
      renderOwnerFilesList();
    } catch (err) {
      list.innerHTML = "<div class=\"empty-state\">" + escapeHtml(err.message || "Failed to load files.") + "</div>";
    }
  }

  function renderOwnerFilesList() {
    var list = document.getElementById("owner-files-list");
    if (ownerFilesCache.length === 0) {
      list.innerHTML = "<div class=\"empty-state\">No files uploaded yet.</div>";
      return;
    }
    list.innerHTML = ownerFilesCache.map(function (f) {
      return "<div class=\"owner-file-row\">" +
        "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z\"/></svg>" +
        "<span class=\"name\">" + escapeHtml(f.name) + "</span>" +
        "<a href=\"" + f.file + "\" target=\"_blank\" style=\"font-size:11px; color:var(--gold-deep); text-decoration:none;\">Open</a>" +
        "<button class=\"remove-btn\" data-remove-file=\"" + f.id + "\" title=\"Delete\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>" +
      "</div>";
    }).join("");

    list.querySelectorAll("[data-remove-file]").forEach(function (btn) {
      btn.addEventListener("click", function () { removeOwnerFile(btn.dataset.removeFile); });
    });
  }

  async function handleFileUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var formData = new FormData();
    formData.append("name", file.name);
    formData.append("file", file);

    try {
      var token = localStorage.getItem(VV_CONFIG.STORAGE_KEYS.TOKEN);
      var res = await fetch(VV_CONFIG.BASE_URL + VV_CONFIG.ENDPOINTS.OWNER_FILES, {
        method: "POST",
        headers: { "Authorization": "Token " + token },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed (status " + res.status + ").");
      e.target.value = "";
      await loadOwnerFiles();
    } catch (err) {
      alert(err.message || "Failed to upload file.");
    }
  }

  async function removeOwnerFile(id) {
    if (!confirm("Delete this file permanently?")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.OWNER_FILE_DETAIL(id), { method: "DELETE" });
      await loadOwnerFiles();
    } catch (err) {
      alert(err.message || "Failed to delete file.");
    }
  }
})();