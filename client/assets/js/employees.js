/**
 * employees.js — client/assets/js/ (دليل الموظفين — Owner + IT)
 * -----------------------------------------------------------------------
 * A shared, self-contained employee directory. Loaded by BOTH owner.html
 * and it_dashboard.html so there's one list, one source of truth — an
 * employee added from either page shows up for the other immediately.
 *
 * Honest limitation, stated up front: this controls what a role CAN SEE
 * in the app (sidebar visibility, approval rights) — it is NOT a real
 * login system. There's no backend yet, so nobody can actually sign in
 * as the employee you create from a different device, and the password
 * field below is stored in plain text purely as a placeholder for a
 * future real login — it is never checked against anything today
 * (matching auth.js's own explicit disclaimer that nothing here is a
 * real security boundary yet).
 *
 * Data store: vv_employees — [{
 *   id, fullName, username, password, role, department, isActive,
 *   createdAt, createdBy, notes, allowedModules
 * }]
 *   role: "owner" | "it_manager" | "it_admin" | "manager" | "employee"
 *   (matches VV_CONFIG's role constants exactly, so a role assigned here
 *   immediately controls sidebar visibility for Owner Panel / IT Dashboard)
 *
 *   allowedModules: null | string[] — null (or omitted) means "no
 *   explicit restriction, sidebar visibility is governed only by role"
 *   — the original, unrestricted behavior. An array (even an empty one)
 *   means "ONLY these module keys are visible in the sidebar for this
 *   specific employee" — an extra, per-employee restriction layer on
 *   TOP of the existing role-based one, enforced in components.js's
 *   buildNavHTML(). Module keys match VV_NAV's own item.key values
 *   exactly (flights, hotels, visas, staff, guides, cars, events, sales,
 *   data, accounts, owner, it_dashboard, settings).
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const ROLE_LABELS_AR = {
    owner: "المالك (Owner)",
    it_manager: "مدير تقنية المعلومات",
    it_admin: "إداري تقنية المعلومات",
    manager: "مدير قسم",
    employee: "موظف",
  };

  const ALL_MODULES = [
    { key: "flights", label: "Flights" }, { key: "hotels", label: "Hotels" }, { key: "visas", label: "Visas" },
    { key: "staff", label: "Staff" }, { key: "guides", label: "Tour Guides" }, { key: "cars", label: "Cars" }, { key: "events", label: "Events" },
    { key: "sales", label: "Sales" }, { key: "data", label: "Data" }, { key: "accounts", label: "Accounts" },
    { key: "owner", label: "Owner Panel" }, { key: "it_dashboard", label: "IT Dashboard" }, { key: "settings", label: "Settings" },
  ];

  function readEmployees() {
    try {
      return JSON.parse(localStorage.getItem("vv_employees")) || [];
    } catch (e) {
      return [];
    }
  }

  function writeEmployees(rows) {
    localStorage.setItem("vv_employees", JSON.stringify(rows));
  }

  function currentActorName() {
    if (window.VVAuth && typeof window.VVAuth.getCurrentUser === "function") {
      const user = window.VVAuth.getCurrentUser();
      if (user && user.full_name) return user.full_name;
    }
    return "Demo User";
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Seed the Demo User itself as the first employee on first run, so the
  // directory isn't empty and immediately shows who "you" are in the list.
  function seedIfEmpty() {
    const rows = readEmployees();
    if (rows.length > 0) return rows;
    rows.push({
      id: `emp_${Date.now()}`,
      fullName: "Demo User",
      username: "demo.user",
      password: "",
      role: "owner",
      department: "Management",
      isActive: true,
      createdAt: todayISO(),
      createdBy: "System",
      notes: "الحساب الافتراضي — أول تشغيل للنظام",
      allowedModules: ["flights", "hotels", "visas", "staff", "guides", "cars", "events", "sales", "data", "accounts", "owner", "it_dashboard", "settings"]
    });
    writeEmployees(rows);
    return rows;
  }

  function getAll() {
    return seedIfEmpty();
  }

  function getActive() {
    return getAll().filter((e) => e.isActive);
  }

  function addEmployee({ fullName, username, password, role, department, notes, allowedModules }) {
    const rows = readEmployees();
    if (rows.some((e) => e.username.toLowerCase() === username.toLowerCase())) {
      return { ok: false, error: `اسم المستخدم "${username}" مستخدم بالفعل.` };
    }
    const employee = {
      id: `emp_${Date.now()}`,
      fullName,
      username,
      password: password || "",
      role,
      department: department || "—",
      isActive: true,
      createdAt: todayISO(),
      createdBy: currentActorName(),
      notes: notes || "",
      // null = unrestricted (role-based visibility only) — the safe
      // default when the "restrict access" checkbox was never ticked in
      // the form, so a freshly-created account is never accidentally
      // locked out of everything.
      allowedModules: allowedModules === undefined ? null : allowedModules,
    };
    rows.push(employee);
    writeEmployees(rows);
    return { ok: true, employee };
  }

  function updateEmployee(id, changes) {
    const rows = readEmployees();
    const idx = rows.findIndex((e) => e.id === id);
    if (idx === -1) return { ok: false, error: "الموظف غير موجود." };
    rows[idx] = { ...rows[idx], ...changes };
    writeEmployees(rows);
    return { ok: true, employee: rows[idx] };
  }

  function setActive(id, isActive) {
    return updateEmployee(id, { isActive });
  }

  function removeEmployee(id) {
    const rows = readEmployees();
    writeEmployees(rows.filter((e) => e.id !== id));
  }

  window.VVEmployees = {
    ROLE_LABELS_AR,
    getAll,
    getActive,
    addEmployee,
    updateEmployee,
    setActive,
    removeEmployee,
  };

  // =========================================================================
  // Shared, embeddable UI — both owner.js and it.js call this exact same
  // function so there's one implementation, not two copies drifting apart.
  // =========================================================================

  let editingEmployeeId = null;

  function renderDirectoryInto(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
        <div class="search-wrap" style="display:flex; align-items:center; gap:8px; background:var(--surface); border:1px solid var(--border); border-radius:var(--radius-sm); padding:7px 12px; width:260px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="emp-search" placeholder="Search by name or username..." style="border:none; outline:none; width:100%; background:transparent; font-size:12.5px;" />
        </div>
        <button class="btn btn--primary" id="btn-toggle-add-employee" type="button">+ Add Employee</button>
      </div>
      <div id="emp-form-wrap" style="display:none; margin-bottom:18px;"></div>
      <div class="ledger-scroll" style="overflow-x:auto; border:1px solid var(--border); border-radius:var(--radius-md);">
        <table class="it-table" style="width:100%; min-width:720px;">
          <thead>
            <tr>
              <th>Full Name</th>
              <th>Username</th>
              <th>Role</th>
              <th>Department</th>
              <th>Access</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="emp-table-body"></tbody>
        </table>
      </div>
    `;

    document.getElementById("emp-search").addEventListener("input", renderEmployeeTable);
    document.getElementById("btn-toggle-add-employee").addEventListener("click", () => {
      editingEmployeeId = null;
      const wrap = document.getElementById("emp-form-wrap");
      const isOpen = wrap.style.display === "block";
      wrap.style.display = isOpen ? "none" : "block";
      if (!isOpen) renderEmployeeForm();
    });

    renderEmployeeTable();
  }

  function renderEmployeeForm() {
    const wrap = document.getElementById("emp-form-wrap");
    const editing = editingEmployeeId ? getAll().find((e) => e.id === editingEmployeeId) : null;
    const restricted = editing ? Array.isArray(editing.allowedModules) : false;

    wrap.style.display = "block";
    wrap.innerHTML = `
      <div style="background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:16px;">
        <h4 style="font-family:var(--font-display); font-size:13.5px; font-weight:700; margin-bottom:12px;">${editing ? `Edit "${editing.fullName}"` : "New Employee"}</h4>
        <div class="vv-field-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="vv-field"><label>Full Name</label><input type="text" id="emp-full-name" /></div>
          <div class="vv-field"><label>Username</label><input type="text" id="emp-username" ${editing ? "readonly" : ""} /></div>
        </div>
        <div class="vv-field-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="vv-field"><label>Password ${editing ? "(leave blank to keep unchanged)" : ""}</label><input type="password" id="emp-password" placeholder="${editing ? "••••••••" : "Initial password"}" /></div>
          <div class="vv-field"><label>Role</label>
            <select id="emp-role">
              ${Object.entries(ROLE_LABELS_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="vv-field"><label>Department</label><input type="text" id="emp-department" placeholder="e.g. Flights, Accounting..." /></div>
        <div class="vv-field"><label>Notes</label><input type="text" id="emp-notes" placeholder="Optional" /></div>

        <div class="vv-field">
          <label style="display:flex; align-items:center; gap:7px; cursor:pointer; width:fit-content; margin-bottom:8px;">
            <input type="checkbox" id="emp-restrict-modules" style="width:15px;height:15px;" ${restricted ? "checked" : ""} />
            Restrict sidebar access to specific modules (unchecked = full access allowed by their role, same as before)
          </label>
          <div class="modules-access-grid" id="emp-modules-grid" style="display:${restricted ? "grid" : "none"}; grid-template-columns:repeat(3,1fr); gap:8px; background:var(--surface); padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm);">
            ${ALL_MODULES.map((m) => `<label style="font-size:11.5px; display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" class="emp-mod-chk" value="${m.key}" ${restricted && editing.allowedModules.includes(m.key) ? "checked" : ""} /> ${m.label}</label>`).join("")}
          </div>
        </div>

        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn--primary" id="btn-save-employee" type="button">${editing ? "Save Changes" : "Add Employee"}</button>
          <button class="btn btn--ghost" id="btn-cancel-employee" type="button">Cancel</button>
        </div>
      </div>
    `;

    if (editing) {
      document.getElementById("emp-full-name").value = editing.fullName;
      document.getElementById("emp-username").value = editing.username;
      document.getElementById("emp-role").value = editing.role;
      document.getElementById("emp-department").value = editing.department;
      document.getElementById("emp-notes").value = editing.notes || "";
    }

    document.getElementById("emp-restrict-modules").addEventListener("change", (e) => {
      document.getElementById("emp-modules-grid").style.display = e.target.checked ? "grid" : "none";
    });

    document.getElementById("btn-cancel-employee").addEventListener("click", () => {
      editingEmployeeId = null;
      document.getElementById("emp-form-wrap").style.display = "none";
    });
    document.getElementById("btn-save-employee").addEventListener("click", saveEmployeeFromForm);
  }

  function saveEmployeeFromForm() {
    const fullName = document.getElementById("emp-full-name").value.trim();
    const username = document.getElementById("emp-username").value.trim();
    const password = document.getElementById("emp-password").value;
    const role = document.getElementById("emp-role").value;
    const department = document.getElementById("emp-department").value.trim();
    const notes = document.getElementById("emp-notes").value.trim();

    if (!fullName || !username) {
      alert("Full name and username are required.");
      return;
    }
    if (!editingEmployeeId && !password) {
      alert("Password is required for a new account.");
      return;
    }

    const restrictChecked = document.getElementById("emp-restrict-modules").checked;
    const allowedModules = restrictChecked
      ? [...document.querySelectorAll(".emp-mod-chk:checked")].map((cb) => cb.value)
      : null;

    if (editingEmployeeId) {
      const changes = { fullName, role, department, notes, allowedModules };
      if (password) changes.password = password; // only overwrite if a new one was actually typed
      updateEmployee(editingEmployeeId, changes);
    } else {
      const result = addEmployee({ fullName, username, password, role, department, notes, allowedModules });
      if (!result.ok) {
        alert(result.error);
        return;
      }
    }

    editingEmployeeId = null;
    document.getElementById("emp-form-wrap").style.display = "none";
    renderEmployeeTable();
  }

  function renderEmployeeTable() {
    const query = (document.getElementById("emp-search")?.value || "").trim().toLowerCase();
    let rows = getAll();
    if (query) {
      rows = rows.filter((e) => e.fullName.toLowerCase().includes(query) || e.username.toLowerCase().includes(query));
    }

    const tbody = document.getElementById("emp-table-body");
    if (!tbody) return;

    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td><strong>${e.fullName}</strong></td>
        <td class="mono">${e.username}</td>
        <td>${ROLE_LABELS_AR[e.role] || e.role}</td>
        <td>${e.department || "—"}</td>
        <td style="font-size:11px;">${Array.isArray(e.allowedModules) ? `${e.allowedModules.length} module${e.allowedModules.length === 1 ? "" : "s"} only` : "Full (role-based)"}</td>
        <td><span class="health-status ${e.isActive ? "health-status--ok" : "health-status--warn"}">${e.isActive ? "Active" : "Disabled"}</span></td>
        <td style="font-size:11px; color:var(--text-faint);">${e.createdAt}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn--ghost" style="padding:5px 10px; font-size:11px;" data-edit-employee="${e.id}">Edit</button>
            <button class="btn btn--ghost" style="padding:5px 10px; font-size:11px;" data-toggle-active="${e.id}">${e.isActive ? "Disable" : "Enable"}</button>
            <button class="btn btn--ghost" style="padding:5px 10px; font-size:11px; color:var(--coral); border-color:var(--coral);" data-delete-employee="${e.id}">Delete</button>
          </div>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("[data-edit-employee]").forEach((btn) => btn.addEventListener("click", () => {
      editingEmployeeId = btn.dataset.editEmployee;
      renderEmployeeForm();
    }));
    tbody.querySelectorAll("[data-toggle-active]").forEach((btn) => btn.addEventListener("click", () => {
      const emp = getAll().find((e) => e.id === btn.dataset.toggleActive);
      if (!emp) return;
      if (emp.isActive && !confirm(`Disable "${emp.fullName}"'s account? They'll lose access immediately.`)) return;
      setActive(emp.id, !emp.isActive);
      renderEmployeeTable();
    }));
    tbody.querySelectorAll("[data-delete-employee]").forEach((btn) => btn.addEventListener("click", () => {
      const emp = getAll().find((e) => e.id === btn.dataset.deleteEmployee);
      if (!emp) return;
      if (!confirm(`Permanently delete "${emp.fullName}"'s account? This cannot be undone.`)) return;
      removeEmployee(emp.id);
      renderEmployeeTable();
    }));
  }

  window.VVEmployees.renderDirectoryInto = renderDirectoryInto;
})();