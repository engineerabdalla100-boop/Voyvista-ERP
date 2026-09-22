(function () {
  "use strict";

  function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .split(String.fromCharCode(39)).join("&#039;");
  }

  var editingEmployeeId = null;
  var allEmployeesCache = [];

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("it-open-employees")?.addEventListener("click", function () { openModal("modal-employees"); loadEmployees(); });
    document.getElementById("it-open-online")?.addEventListener("click", function () { openModal("modal-online"); loadOnline(); });
    document.getElementById("it-open-activity")?.addEventListener("click", function () { openModal("modal-activity"); loadActivity(); });
    document.getElementById("it-open-backup")?.addEventListener("click", downloadBackup);

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal(btn.getAttribute("data-close-modal")); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach(function (o) { o.classList.remove("is-open"); });
    });

    document.getElementById("vv-it-user-form")?.addEventListener("submit", handleFormSubmit);
    document.getElementById("it-form-cancel-btn")?.addEventListener("click", resetForm);
    document.getElementById("activity-dept-filter")?.addEventListener("change", loadActivity);
    document.getElementById("activity-date-filter")?.addEventListener("change", loadActivity);
    document.getElementById("btn-clear-activity-filters")?.addEventListener("click", function () {
      document.getElementById("activity-dept-filter").value = "";
      document.getElementById("activity-date-filter").value = "";
      loadActivity();
    });
  });

  // =========================================================================
  // 1) Employee Accounts & Access
  // =========================================================================

  async function loadEmployees() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEES);
      allEmployeesCache = result.data.results || result.data;
    } catch (err) {
      allEmployeesCache = [];
    }
    renderEmployeeDirectory();
  }

  function renderEmployeeDirectory() {
    var container = document.getElementById("it-employee-directory");
    if (allEmployeesCache.length === 0) {
      container.innerHTML = "<div class=\"empty-state\">No accounts created yet.</div>";
      return;
    }

    container.innerHTML =
      "<table class=\"it-table\">" +
        "<thead><tr><th>Full Name</th><th>Username</th><th>Role</th><th>Modules</th><th>Status</th><th>Actions</th></tr></thead>" +
        "<tbody>" + allEmployeesCache.map(function (u) {
          var actionsHtml =
            "<button class=\"row-action-btn\" data-edit-emp=\"" + u.id + "\" title=\"Edit\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg></button>" +
            "<button class=\"row-action-btn " + (u.is_active_employee ? "is-danger" : "") + "\" data-toggle-emp=\"" + u.id + "\" title=\"" + (u.is_active_employee ? "Deactivate" : "Reactivate") + "\">" +
              (u.is_active_employee
                ? "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg>"
                : "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M4 4v6h6M20 20v-6h-6\"/><path d=\"M4 10a8 8 0 0 1 14.3-4.9M20 14a8 8 0 0 1-14.3 4.9\"/></svg>") +
            "</button>";

          if (!u.is_active_employee) {
            actionsHtml += "<button class=\"row-action-btn is-danger\" data-hard-delete-emp=\"" + u.id + "\" title=\"Delete Permanently\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6\"/></svg></button>";
          }

          return "<tr>" +
            "<td><strong>" + escapeHtml(u.full_name) + "</strong></td>" +
            "<td><code>" + escapeHtml(u.username) + "</code></td>" +
            "<td><span class=\"status-badge status-badge--approved\">" + escapeHtml(u.role) + "</span></td>" +
            "<td style=\"font-size:11px; color:var(--text-soft);\">" + escapeHtml((u.allowed_modules || []).join(", ") || "All Modules") + "</td>" +
            "<td>" + (u.is_active_employee ? "<span class=\"status-badge status-badge--approved\">Active</span>" : "<span class=\"status-badge status-badge--pending\">Disabled</span>") + "</td>" +
            "<td>" + actionsHtml + "</td>" +
          "</tr>";
        }).join("") + "</tbody>" +
      "</table>";

    container.querySelectorAll("[data-edit-emp]").forEach(function (btn) {
      btn.addEventListener("click", function () { startEditEmployee(btn.dataset.editEmp); });
    });
    container.querySelectorAll("[data-toggle-emp]").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleEmployeeActive(btn.dataset.toggleEmp); });
    });
    container.querySelectorAll("[data-hard-delete-emp]").forEach(function (btn) {
      btn.addEventListener("click", function () { hardDeleteEmployee(btn.dataset.hardDeleteEmp); });
    });
  }

  function startEditEmployee(id) {
    var emp = allEmployeesCache.find(function (u) { return String(u.id) === String(id); });
    if (!emp) return;

    editingEmployeeId = id;
    document.getElementById("it-form-title").textContent = "Edit: " + emp.full_name;
    document.getElementById("it-u-editing-id").value = id;
    document.getElementById("it-u-firstname").value = emp.first_name || "";
    document.getElementById("it-u-lastname").value = emp.last_name || "";
    document.getElementById("it-u-username").value = emp.username;
    document.getElementById("it-u-email").value = emp.email;
    document.getElementById("it-u-role").value = emp.role;
    document.getElementById("it-u-password").value = "";
    document.getElementById("it-u-password").placeholder = "Leave empty to keep current password";
    document.getElementById("it-u-password-label").textContent = "New Password (optional)";
    document.getElementById("it-form-submit-btn").textContent = "Save Changes";
    document.getElementById("it-form-cancel-btn").style.display = "inline-flex";

    document.querySelectorAll(".it-mod-chk").forEach(function (chk) {
      chk.checked = (emp.allowed_modules || []).indexOf(chk.value) !== -1;
    });

    document.getElementById("vv-it-user-form").scrollIntoView({ behavior: "smooth" });
  }

  function resetForm() {
    editingEmployeeId = null;
    document.getElementById("it-form-title").textContent = "Create Employee Account & Set Permissions";
    document.getElementById("it-u-editing-id").value = "";
    document.getElementById("vv-it-user-form").reset();
    document.getElementById("it-u-password").placeholder = "Initial password";
    document.getElementById("it-u-password-label").textContent = "Password";
    document.getElementById("it-form-submit-btn").textContent = "Save Account & Grant Access";
    document.getElementById("it-form-cancel-btn").style.display = "none";
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    var selectedModules = Array.from(document.querySelectorAll(".it-mod-chk:checked")).map(function (cb) { return cb.value; });
    var password = document.getElementById("it-u-password").value;

    var payload = {
      first_name: document.getElementById("it-u-firstname").value.trim(),
      last_name: document.getElementById("it-u-lastname").value.trim(),
      username: document.getElementById("it-u-username").value.trim(),
      email: document.getElementById("it-u-email").value.trim(),
      role: document.getElementById("it-u-role").value,
      allowed_modules: selectedModules,
    };
    if (password) payload.password = password;

    var btn = document.getElementById("it-form-submit-btn");
    btn.disabled = true;

    try {
      if (editingEmployeeId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEE_DETAIL(editingEmployeeId), { method: "PATCH", body: payload });
      } else {
        if (!password) { alert("Password is required for a new account."); btn.disabled = false; return; }
        await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEES, { method: "POST", body: payload });
      }
      resetForm();
      await loadEmployees();
    } catch (err) {
      alert(err.message || "Failed to save account.");
    } finally {
      btn.disabled = false;
    }
  }

  async function toggleEmployeeActive(id) {
    var emp = allEmployeesCache.find(function (u) { return String(u.id) === String(id); });
    if (!emp) return;

    var confirmMsg = emp.is_active_employee ? "Deactivate \"" + emp.full_name + "\"?" : "Reactivate \"" + emp.full_name + "\"?";
    if (!confirm(confirmMsg)) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEE_TOGGLE_ACTIVE(id), { method: "POST" });
      await loadEmployees();
    } catch (err) {
      alert(err.message || "Failed to update.");
    }
  }

  async function hardDeleteEmployee(id) {
    var emp = allEmployeesCache.find(function (u) { return String(u.id) === String(id); });
    if (!emp) return;
    if (!confirm("Permanently delete \"" + emp.full_name + "\"? This cannot be undone.")) return;

    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEE_DETAIL(id), { method: "DELETE" });
      await loadEmployees();
    } catch (err) {
      if (err.status === 409) {
        alert("Cannot delete this account - it has related records (bookings, sales, etc). It will stay disabled instead.");
      } else {
        alert(err.message || "Failed to delete.");
      }
    }
  }

  // =========================================================================
  // 2) Who's Online
  // =========================================================================

  async function loadOnline() {
    var body = document.getElementById("online-body");
    body.innerHTML = "<div class=\"empty-state\">Loading...</div>";
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.EMPLOYEES + "online/");
      var online = result.data || [];
      if (online.length === 0) {
        body.innerHTML = "<div class=\"empty-state\">No one else is online right now.</div>";
        return;
      }
      body.innerHTML =
        "<table class=\"it-table\">" +
          "<thead><tr><th></th><th>Name</th><th>Role</th><th>Last seen</th></tr></thead>" +
          "<tbody>" + online.map(function (u) {
            var lastSeen = u.last_seen ? new Date(u.last_seen).toLocaleTimeString() : "-";
            return "<tr>" +
              "<td><span class=\"online-dot\"></span></td>" +
              "<td><strong>" + escapeHtml(u.full_name) + "</strong></td>" +
              "<td>" + escapeHtml(u.role) + "</td>" +
              "<td style=\"font-size:11px; color:var(--text-faint);\">" + escapeHtml(lastSeen) + "</td>" +
            "</tr>";
          }).join("") + "</tbody>" +
        "</table>";
    } catch (err) {
      body.innerHTML = "<div class=\"empty-state\">" + escapeHtml(err.message || "Failed to load.") + "</div>";
    }
  }

  // =========================================================================
  // 3) Recent Activity
  // =========================================================================

  async function loadActivity() {
    var body = document.getElementById("activity-body");
    body.innerHTML = "<div class=\"empty-state\">Loading...</div>";

    var dept = document.getElementById("activity-dept-filter").value;
    var date = document.getElementById("activity-date-filter").value;
    var params = [];
    if (dept) params.push("department=" + dept);
    if (date) params.push("date=" + date);
    var query = params.length ? "?" + params.join("&") : "";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS + "recent-activity/" + query);
      var rows = result.data || [];
      if (rows.length === 0) {
        body.innerHTML = "<div class=\"empty-state\">No bookings found.</div>";
        return;
      }
      body.innerHTML =
        "<table class=\"it-table\">" +
          "<thead><tr><th>Dept</th><th>Booking Date</th><th>Customer</th><th>Created By</th><th>Last Edited By</th><th>Last Updated</th></tr></thead>" +
          "<tbody>" + rows.map(function (r) {
            var updatedAt = r.updated_at ? new Date(r.updated_at).toLocaleString() : "-";
            return "<tr>" +
              "<td>" + escapeHtml(r.department) + "</td>" +
              "<td>" + escapeHtml(r.date || "-") + "</td>" +
              "<td class=\"cell-primary\">" + escapeHtml(r.passenger_name) + "</td>" +
              "<td>" + escapeHtml(r.created_by_name || "-") + "</td>" +
              "<td>" + escapeHtml(r.updated_by_name || "-") + "</td>" +
              "<td style=\"font-size:11px; color:var(--text-faint);\">" + escapeHtml(updatedAt) + "</td>" +
            "</tr>";
          }).join("") + "</tbody>" +
        "</table>";
    } catch (err) {
      body.innerHTML = "<div class=\"empty-state\">" + escapeHtml(err.message || "Failed to load.") + "</div>";
    }
  }

  // =========================================================================
  // 4) Full Database Backup
  // =========================================================================

  function downloadBackup() {
    var token = localStorage.getItem(VV_CONFIG.STORAGE_KEYS.TOKEN);
    var url = VV_CONFIG.BASE_URL + "/backup/full/";

    fetch(url, { headers: { "Authorization": "Token " + token } })
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to generate backup (status " + res.status + ").");
        var disposition = res.headers.get("Content-Disposition") || "";
        var match = disposition.match(/filename="?([^"]+)"?/);
        var filename = match ? match[1] : "Voyvista-Backup.json";
        return res.blob().then(function (blob) { return { blob: blob, filename: filename }; });
      })
      .then(function (result) {
        var link = document.createElement("a");
        link.href = URL.createObjectURL(result.blob);
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      })
      .catch(function (err) { alert(err.message || "Failed to download backup."); });
  }
})();