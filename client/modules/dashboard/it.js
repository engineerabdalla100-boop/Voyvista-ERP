/**
 * it.js — IT Administration dashboard logic.
 * -----------------------------------------------------------------------
 * Reads REAL local data — handles audit approvals, employee account
 * provisioning with 11-module granular access control, local storage
 * health diagnostics, system broadcasts, and safe data purges.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  function openModal(id) { document.getElementById(id)?.classList.add("is-open"); }
  function closeModal(id) { document.getElementById(id)?.classList.remove("is-open"); }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("it-open-audit")?.addEventListener("click", () => { openModal("modal-audit"); renderAuditLog(); });
    document.getElementById("it-open-employees")?.addEventListener("click", () => { openModal("modal-employees"); renderEmployees(); });
    document.getElementById("it-open-health")?.addEventListener("click", () => { openModal("modal-health"); runDiagnostics(); });
    document.getElementById("it-open-broadcast")?.addEventListener("click", () => openModal("modal-broadcast"));
    document.getElementById("it-open-sessions")?.addEventListener("click", () => { openModal("modal-sessions"); renderCurrentSession(); });
    document.getElementById("it-open-recovery")?.addEventListener("click", () => openModal("modal-recovery"));
    document.getElementById("it-open-reset-accounts")?.addEventListener("click", resetAccountsData);

    document.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close-modal")));
    });
    document.querySelectorAll(".vv-modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.querySelectorAll(".vv-modal-overlay.is-open").forEach((o) => o.classList.remove("is-open"));
    });

    document.getElementById("btn-send-broadcast")?.addEventListener("click", sendBroadcast);
    document.getElementById("btn-clear-broadcast")?.addEventListener("click", clearBroadcast);

    // Initialize Employee Creation Form Handler
    initUserFormHandler();
  });

  // =========================================================================
  // 1) Audit Log Engine
  // =========================================================================

  const CHANGE_TYPE_LABELS = { create: "New Account", edit: "Edit Account", deactivate: "Deactivate", delete: "Delete Account", link: "Link Party", unlink: "Unlink Party" };
  const STATUS_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", apply_failed: "Apply Failed" };

  const requestsInFlight = new Set();
  let expandedRequestId = null;

  function updateAuditPendingBadge() {
    const card = document.getElementById("it-open-audit");
    if (!card || !window.VVChangeRequests) return;
    const count = window.VVChangeRequests.getPending().length;
    let badge = document.getElementById("it-audit-pending-badge");
    const titleEl = card.querySelector(".it-card__title");
    if (count === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "it-audit-pending-badge";
      badge.className = "pending-count-badge";
      titleEl.appendChild(badge);
    }
    badge.textContent = count;
  }

  function renderAuditLog() {
    const tbody = document.getElementById("audit-log-body");
    const empty = document.getElementById("audit-log-empty");
    if (!window.VVChangeRequests) { tbody.innerHTML = ""; empty.style.display = "block"; return; }

    const all = [...window.VVChangeRequests.getAll()].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    if (all.length === 0) { tbody.innerHTML = ""; empty.style.display = "block"; return; }
    empty.style.display = "none";

    tbody.innerHTML = all.map((req) => {
      const isPending = req.status === "pending";
      const inFlight = requestsInFlight.has(req.id);
      const isExpanded = expandedRequestId === req.id;

      const actionsHtml = isPending
        ? `<button class="btn-approve" data-approve-audit="${req.id}" ${inFlight ? "disabled" : ""}>${inFlight ? "…" : "✓ Approve"}</button>
           <button class="btn-reject" data-reject-audit="${req.id}" ${inFlight ? "disabled" : ""}>${inFlight ? "…" : "✕ Reject"}</button>
           <button class="btn-details" data-toggle-audit-details="${req.id}">${isExpanded ? "Hide" : "Details"}</button>`
        : `<button class="btn-details" data-toggle-audit-details="${req.id}">${isExpanded ? "Hide" : "Details"}</button>`;

      let rows = `
      <tr>
        <td style="font-size:11px; color:var(--text-faint);">${req.requestedAt}</td>
        <td><strong>${req.requestedBy}</strong></td>
        <td>${CHANGE_TYPE_LABELS[req.changeType] || req.changeType}</td>
        <td>${req.targetLabel}</td>
        <td><span class="status-badge status-badge--${req.status}">${STATUS_LABELS[req.status] || req.status}</span></td>
        <td style="font-size:11px; color:var(--text-faint);">${req.reviewedBy ? `${req.reviewedBy} — ${req.reviewedAt}` : "—"}</td>
        <td style="white-space:nowrap;">${actionsHtml}</td>
      </tr>`;

      if (isExpanded) {
        rows += `
      <tr class="audit-details-row">
        <td colspan="7">
          <div class="detail-line"><strong>Request ID:</strong> ${req.id}</div>
          <div class="detail-line"><strong>Module:</strong> ${req.module}</div>
          <div class="detail-line"><strong>Change Type:</strong> ${req.changeType}</div>
          <div class="detail-line"><strong>Target:</strong> ${req.targetLabel} ${req.targetId ? `(${req.targetId})` : "(new)"}</div>
          <div class="detail-line"><strong>Current Status:</strong> ${STATUS_LABELS[req.status] || req.status}</div>
          ${(req.fieldChanges && req.fieldChanges.length > 0) ? `<div class="detail-line"><strong>Field Changes:</strong> ${req.fieldChanges.map((c) => `${c.field}: "${c.oldValue ?? "—"}" ➜ "${c.newValue ?? "—"}"`).join(" | ")}</div>` : ""}
          ${req.payload ? `<div class="detail-line"><strong>Payload:</strong> <code style="font-size:10.5px;">${escapeHtml(JSON.stringify(req.payload))}</code></div>` : ""}
          <div class="detail-line"><strong>Requested By:</strong> ${req.requestedBy} — ${req.requestedAt}</div>
          <div class="detail-line"><strong>Reviewed By:</strong> ${req.reviewedBy ? `${req.reviewedBy} — ${req.reviewedAt}` : "— (not yet reviewed)"}</div>
          ${req.status === "rejected" ? `<div class="detail-line"><strong>Rejection Reason:</strong> ${req.rejectionReason}</div>` : ""}
          ${req.status === "apply_failed" ? `<div class="detail-line" style="color:var(--coral);"><strong>Apply Failure Reason:</strong> ${req.applyFailureReason}</div>` : ""}
        </td>
      </tr>`;
      }
      return rows;
    }).join("");

    tbody.querySelectorAll("[data-approve-audit]").forEach((btn) => {
      btn.addEventListener("click", () => handleAuditApprove(btn.dataset.approveAudit));
    });
    tbody.querySelectorAll("[data-reject-audit]").forEach((btn) => {
      btn.addEventListener("click", () => handleAuditReject(btn.dataset.rejectAudit));
    });
    tbody.querySelectorAll("[data-toggle-audit-details]").forEach((btn) => {
      btn.addEventListener("click", () => {
        expandedRequestId = expandedRequestId === btn.dataset.toggleAuditDetails ? null : btn.dataset.toggleAuditDetails;
        renderAuditLog();
      });
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function handleAuditApprove(requestId) {
    if (requestsInFlight.has(requestId)) return;
    requestsInFlight.add(requestId);
    renderAuditLog();
    updateAuditPendingBadge();
    window.VVChangeRequests.approve(requestId, () => {
      requestsInFlight.delete(requestId);
      renderAuditLog();
      updateAuditPendingBadge();
    });
  }

  function handleAuditReject(requestId) {
    if (requestsInFlight.has(requestId)) return;
    requestsInFlight.add(requestId);
    renderAuditLog();
    updateAuditPendingBadge();
    window.VVChangeRequests.reject(requestId, () => {
      requestsInFlight.delete(requestId);
      renderAuditLog();
      updateAuditPendingBadge();
    });
  }

  // =========================================================================
  // 2) Employee Accounts & Granular 11-Module Permissions
  // =========================================================================

  function renderEmployees() {
    if (window.VVEmployees) {
      window.VVEmployees.renderDirectoryInto("it-employee-directory");
    } else {
      const users = JSON.parse(localStorage.getItem("vv_employees")) || [];
      const container = document.getElementById("it-employee-directory");
      if (!container) return;

      if (!users.length) {
        container.innerHTML = `<div style="text-align:center; padding:20px; font-size:12px; color:var(--text-soft);">No accounts created yet.</div>`;
        return;
      }

      container.innerHTML = `
        <table class="it-table">
          <thead>
            <tr><th>Full Name</th><th>Username</th><th>Role</th><th>Allowed Modules</th></tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><strong>${escapeHtml(u.full_name || u.name)}</strong></td>
                <td><code>${escapeHtml(u.username)}</code></td>
                <td><span class="status-badge status-badge--approved">${escapeHtml(u.role)}</span></td>
                <td style="font-size:11px; color:var(--text-soft);">${(u.allowedModules || []).join(", ") || "All Modules"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }
  }

  function initUserFormHandler() {
    const userForm = document.getElementById("vv-it-user-form");
    if (!userForm) return;

    userForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const selectedModules = Array.from(document.querySelectorAll(".it-mod-chk:checked")).map(cb => cb.value);
      const newUser = {
        id: "usr_" + Date.now(),
        full_name: document.getElementById("it-u-fullname").value.trim(),
        username: document.getElementById("it-u-username").value.trim().toLowerCase(),
        password: document.getElementById("it-u-password").value,
        role: document.getElementById("it-u-role").value,
        allowedModules: selectedModules,
        createdAt: new Date().toISOString()
      };

      const users = JSON.parse(localStorage.getItem("vv_employees")) || [];
      users.push(newUser);
      localStorage.setItem("vv_employees", JSON.stringify(users));

      alert(`Account created successfully for ${newUser.full_name}!`);
      userForm.reset();
      renderEmployees();
    });
  }

  // =========================================================================
  // 3) System Health Engine
  // =========================================================================

  const KNOWN_STORES = [
    { key: "vv_sales_data", label: "Flights sales" },
    { key: "vv_hotel_sales_data", label: "Hotels sales" },
    { key: "vv_visa_sales_data", label: "Visas sales" },
    { key: "vv_requests_data", label: "Flights pending requests" },
    { key: "vv_hotel_requests_data", label: "Hotels pending requests" },
    { key: "vv_visa_requests_data", label: "Visas pending requests" },
    { key: "vv_acc_customers", label: "Customers (financial)" },
    { key: "vv_acc_party_meta", label: "Customer/company profiles" },
    { key: "vv_chart_of_accounts", label: "Chart of Accounts" },
    { key: "vv_journal_entries", label: "Journal Entries" },
    { key: "vv_change_requests", label: "Change Requests (Maker-Checker)" },
    { key: "vv_employees", label: "Employee Directory" },
    { key: "vv_owner_files", label: "Owner's personal files" },
  ];

  function runDiagnostics() {
    const results = document.getElementById("diagnostics-results");

    let totalBytes = 0;
    let totalKeys = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key) || "";
        totalBytes += (key.length + value.length) * 2;
        totalKeys++;
      }
    } catch (e) { /* ignore */ }

    const storeRows = KNOWN_STORES.map((store) => {
      const raw = localStorage.getItem(store.key);
      const sizeKb = raw ? (raw.length * 2 / 1024).toFixed(1) : "0.0";
      let count = "—";
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) count = parsed.length; else if (parsed && typeof parsed === "object") count = Object.keys(parsed).length; } catch (e) {}
      return `<div class="health-metric"><span>${store.label}</span><span class="health-status health-status--ok">${count} records — ${sizeKb} KB</span></div>`;
    }).join("");

    const totalMb = (totalBytes / 1024 / 1024).toFixed(2);
    const quotaWarning = totalBytes > 4 * 1024 * 1024;

    results.innerHTML = `
      <div class="health-metric">
        <span>Total local storage used (this browser)</span>
        <span class="health-status ${quotaWarning ? "health-status--warn" : "health-status--ok"}">${totalMb} MB across ${totalKeys} keys</span>
      </div>
      ${storeRows}
      <div class="honest-note" style="margin-top:14px; margin-bottom:0;">This is real data read directly from this browser's storage — not a simulated database or API check, since there's no backend server to check yet. If usage approaches the browser's limit (typically 5–10 MB), the oldest records in the biggest stores are the first place to look.</div>
    `;
  }

  // =========================================================================
  // 4) Broadcast Message
  // =========================================================================

  function sendBroadcast() {
    const level = document.getElementById("broadcast-level").value;
    const message = document.getElementById("broadcast-message").value.trim();
    if (!message) { alert("Please enter a message."); return; }

    localStorage.setItem("vv_active_broadcast", JSON.stringify({ level, message, postedAt: new Date().toISOString() }));
    alert("Banner published — it will show on every page in this browser.");
    document.getElementById("broadcast-message").value = "";
    closeModal("modal-broadcast");
  }

  function clearBroadcast() {
    localStorage.removeItem("vv_active_broadcast");
    alert("Banner cleared.");
    closeModal("modal-broadcast");
  }

  // =========================================================================
  // 5) Session Tracker
  // =========================================================================

  function renderCurrentSession() {
    const tbody = document.getElementById("current-session-body");
    const user = (typeof VVComponents !== "undefined" && VVComponents.getCurrentUser) ? VVComponents.getCurrentUser() : {};
    const rows = [
      ["User", user.full_name || "Demo User"],
      ["Role", user.role || "employee"],
      ["Browser", navigator.userAgent],
      ["Page loaded at", new Date().toLocaleString()],
      ["IP Address", "Not available client-side — requires a backend request"],
    ];
    tbody.innerHTML = rows.map(([label, value]) => `<tr><td style="font-weight:700; width:140px;">${label}</td><td>${value}</td></tr>`).join("");
  }

  // =========================================================================
  // 6) Reset Accounts Data
  // =========================================================================

  const ACCOUNTS_RESET_KEYS = ["vv_chart_of_accounts", "vv_change_requests", "vv_journal_entries"];

  function resetAccountsData() {
    const firstConfirm = confirm(
      "هل أنت متأكد إنك عايز تمسح كل بيانات الحسابات؟\n\n" +
      "هيتمسح: شجرة الحسابات كاملة، كل القيود اليومية، وكل طلبات التعديل المعلّقة والمنتهية.\n" +
      "مش هيتأثر: الطيران/الفنادق/الفيزا، العملاء، الموظفين.\n\n" +
      "اضغط OK للمتابعة."
    );
    if (!firstConfirm) return;

    const secondConfirm = confirm(
      "تأكيد أخير — العملية دي لا يمكن التراجع عنها.\n\n" +
      "اضغط OK فقط لو متأكد 100%."
    );
    if (!secondConfirm) return;

    ACCOUNTS_RESET_KEYS.forEach((key) => localStorage.removeItem(key));
    alert("تم مسح بيانات الحسابات بنجاح. الصفحة هتعمل Refresh دلوقتي.");
    location.reload();
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateAuditPendingBadge();
    if (document.getElementById("modal-audit")) renderAuditLog();

    window.addEventListener("storage", (e) => {
      if (e.key === "vv_change_requests") {
        updateAuditPendingBadge();
        if (document.getElementById("modal-audit")?.classList.contains("is-open")) renderAuditLog();
      }
    });
  });
})();