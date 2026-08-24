/**
 * accounts_core.js — client/modules/accounts/
 * -----------------------------------------------------------------------
 * Two things live here, shared by every Part 1 module file:
 *
 *   1. switchAccountView(viewId, params) / backToDashboard() [alias: restoreDashboard()]
 *      A full-width, no-reload view switcher. Clicking a Quick Action
 *      card hides #dashboard-main-view and renders the chosen module at
 *      full width inside #module-detail-view, with a single shared
 *      toolbar (back button + title). Each module registers itself into
 *      `window.VVAccountsModules[viewId]` — this file never needs to know
 *      what a specific module renders, only how to mount it.
 *
 *      NOTE: this file intentionally does NOT contain the Treasury,
 *      Expenses, Custody, or Vouchers UI/logic themselves — those live in
 *      their own dedicated files (treasury.js, expenses.js, custody.js,
 *      vouchers.js) that register into VVAccountsModules the same way.
 *      Keeping this file to just the switcher + workflow engine is what
 *      lets every module file stay independent and DRY.
 *
 *   2. The Draft -> Submitted -> Approved -> Posted workflow state
 *      machine every voucher/expense/custody record moves through.
 *      Records can only ever be deleted while still a Draft — once
 *      Submitted, the only way forward is through the workflow (or, for
 *      Posted records, a reversal — never a silent delete).
 *
 * Load order: this file must load BEFORE accounts.js and before every
 * other Part 1 module file, and it does not touch the DOM at parse time
 * — safe to sit in <head> like the rest of the shared assets.
 * -----------------------------------------------------------------------
 */

(function (global) {
  "use strict";

  // =========================================================================
  // 1) View registry + switcher
  // =========================================================================

  // Each module file does: window.VVAccountsModules.expenses = function(params) {...}
  global.VVAccountsModules = global.VVAccountsModules || {};

  const MODULE_TITLES = {
    receipt: "سندات القبض",
    payment: "سندات الصرف",
    expenses: "المصروفات",
    treasury: "الخزينة والبنوك",
    custody: "العهد",
    parties: "العملاء والموردين",
    journal: "القيود اليومية",
    chartOfAccounts: "شجرة الحسابات",
  };

  function switchAccountView(viewId, params) {
    const dashboard = document.getElementById("dashboard-main-view");
    const detail = document.getElementById("module-detail-view");
    if (!dashboard || !detail) {
      console.error("accounts_core.js: #dashboard-main-view / #module-detail-view not found on this page.");
      return;
    }

    dashboard.style.display = "none";
    detail.style.display = "block";
    // RTL order: the title comes FIRST in the markup so it lands on the
    // right (the start side in RTL), and the back button second so it
    // lands on the left — matching a plain flex row with
    // justify-content:space-between under dir="rtl".
    detail.innerHTML = `
      <div class="module-toolbar">
        <h2 class="module-toolbar__title">${MODULE_TITLES[viewId] || ""}</h2>
        <button class="module-back-btn" id="btn-back-dashboard" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          رجوع
        </button>
      </div>
      <div id="module-body"></div>
    `;
    document.getElementById("btn-back-dashboard").addEventListener("click", backToDashboard);

    const renderer = global.VVAccountsModules[viewId];
    if (typeof renderer === "function") {
      renderer(params || {});
    } else {
      document.getElementById("module-body").innerHTML =
        `<div class="empty-state"><p>الوحدة "${viewId}" غير متاحة بعد.</p></div>`;
    }
  }

  function backToDashboard() {
    const dashboard = document.getElementById("dashboard-main-view");
    const detail = document.getElementById("module-detail-view");
    if (!dashboard || !detail) return;
    detail.style.display = "none";
    detail.innerHTML = "";
    dashboard.style.display = "block";
    // The dashboard's own KPI/recent-transactions numbers may be stale
    // after posting something in a module — accounts.js exposes this hook.
    if (typeof global.refreshAccountsDashboard === "function") {
      global.refreshAccountsDashboard();
    }
  }

  global.switchAccountView = switchAccountView;
  global.backToDashboard = backToDashboard;
  // Alias requested alongside switchAccountView — same function, so every
  // existing module file (which already calls backToDashboard/the shared
  // "← العودة للوحة التحكم" button wired above) keeps working unchanged.
  global.restoreDashboard = backToDashboard;

  // =========================================================================
  // 2) Workflow state machine — Draft -> Submitted -> Approved -> Posted
  // =========================================================================

  const WORKFLOW_ORDER = ["draft", "submitted", "approved", "posted"];

  const WORKFLOW_LABELS_AR = {
    draft: "مسودة",
    submitted: "بانتظار الاعتماد",
    approved: "معتمد",
    posted: "مرحّل",
    reversed: "ملغي (بقيد عكسي)",
  };

  const WORKFLOW_NEXT_ACTION_LABEL = {
    draft: "إرسال للاعتماد",
    submitted: "اعتماد",
    approved: "ترحيل",
  };

  const WORKFLOW_BADGE_CLASS = {
    draft: "badge--pending",
    submitted: "badge--pending",
    approved: "badge--posted",
    posted: "badge--posted",
    reversed: "badge--pending",
  };

  function vvWorkflowLabel(status) { return WORKFLOW_LABELS_AR[status] || status; }
  function vvWorkflowBadgeHtml(status) {
    return `<span class="badge ${WORKFLOW_BADGE_CLASS[status] || "badge--pending"}">${vvWorkflowLabel(status)}</span>`;
  }
  function vvNextState(status) {
    const idx = WORKFLOW_ORDER.indexOf(status);
    return idx >= 0 && idx < WORKFLOW_ORDER.length - 1 ? WORKFLOW_ORDER[idx + 1] : status;
  }
  function vvNextActionLabel(status) { return WORKFLOW_NEXT_ACTION_LABEL[status] || null; }
  function vvCanDelete(status) { return status === "draft"; }
  function vvIsPosted(status) { return status === "posted"; }

  /**
   * Renders the workflow action cell for one record: the "advance" button
   * (Submit/Approve/Post, whichever applies next) plus a Delete button
   * that only ever appears for Drafts. Posted records get neither — a
   * "عكس القيد" (Reverse) button instead, wired by the caller via
   * `allowReverse`, since only some modules support reversal in Part 1.
   */
  function vvWorkflowActionsHtml(record, { allowReverse = false } = {}) {
    let html = '<div class="row-actions">';
    const nextLabel = vvNextActionLabel(record.status);
    if (nextLabel) {
      html += `<button class="btn-workflow-next" data-workflow-next="${record.id}">${nextLabel}</button>`;
    }
    if (vvCanDelete(record.status)) {
      html += `<button class="row-action-btn is-danger" data-workflow-delete="${record.id}" title="حذف" aria-label="حذف">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;
    } else if (vvIsPosted(record.status) && allowReverse && !record.reversed) {
      html += `<button class="row-action-btn" data-workflow-reverse="${record.id}" title="عكس القيد" aria-label="عكس القيد">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-6.7L3 9"/></svg>
      </button>`;
    }
    html += "</div>";
    return html;
  }

  /**
   * Wires up every [data-workflow-next] / [data-workflow-delete] /
   * [data-workflow-reverse] button inside `container`. The caller supplies
   * `records` (the live array) and three callbacks so this file never has
   * to know which localStorage key or side-effects (ledger/cash updates)
   * a given module needs when a record moves state.
   */
  function vvWireWorkflowButtons(container, { records, onAdvance, onDelete, onReverse }) {
    container.querySelectorAll("[data-workflow-next]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const record = records.find((r) => String(r.id) === btn.dataset.workflowNext);
        if (!record) return;
        const fromStatus = record.status;
        record.status = vvNextState(record.status);
        if (typeof onAdvance === "function") onAdvance(record, fromStatus);
      });
    });
    container.querySelectorAll("[data-workflow-delete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const record = records.find((r) => String(r.id) === btn.dataset.workflowDelete);
        if (!record) return;
        if (!vvCanDelete(record.status)) {
          alert("لا يمكن حذف سجل تم اعتماده أو ترحيله — فقط المسوّدات يمكن حذفها.");
          return;
        }
        if (!confirm("حذف هذه المسوّدة نهائيًا؟")) return;
        if (typeof onDelete === "function") onDelete(record);
      });
    });
    container.querySelectorAll("[data-workflow-reverse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const record = records.find((r) => String(r.id) === btn.dataset.workflowReverse);
        if (!record) return;
        if (!vvIsPosted(record.status)) return;
        if (!confirm("سيتم إنشاء قيد عكسي بنفس القيمة لإلغاء أثر هذا السجل — الأصل يبقى في السجل كما هو. متابعة؟")) return;
        record.reversed = true;
        if (typeof onReverse === "function") onReverse(record);
      });
    });
  }

  global.VVWorkflow = {
    ORDER: WORKFLOW_ORDER,
    label: vvWorkflowLabel,
    badgeHtml: vvWorkflowBadgeHtml,
    nextState: vvNextState,
    nextActionLabel: vvNextActionLabel,
    canDelete: vvCanDelete,
    isPosted: vvIsPosted,
    actionsHtml: vvWorkflowActionsHtml,
    wireButtons: vvWireWorkflowButtons,
  };

  // =========================================================================
  // 3) Small shared helpers every module file needs (kept here once, DRY)
  // =========================================================================

  function vvTodayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function vvParseLocalDate(dateStr) {
    if (!dateStr) return new Date(NaN);
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function vvFormatMoney(amount, currency) {
    const symbols = { EGP: "ج.م", USD: "$", EUR: "€", SAR: "ر.س", AED: "د.إ" };
    return `${Number(amount || 0).toLocaleString("en-US")} ${symbols[currency] || currency || "ج.م"}`;
  }
  function vvReadStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error(`accounts_core.js: corrupt data at ${key}, resetting.`, e);
      return fallback;
    }
  }
  function vvWriteStore(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  global.VVAccountsCore = {
    todayISO: vvTodayISO,
    parseLocalDate: vvParseLocalDate,
    formatMoney: vvFormatMoney,
    readStore: vvReadStore,
    writeStore: vvWriteStore,
  };

  // =========================================================================
  // "Recent Activity — All Sections" panel on the main dashboard
  // -----------------------------------------------------------------------
  // Pulls the latest items from every module's own store (vouchers,
  // expenses, custody, treasury, journal entries) and merges them into
  // one feed — this file is the one place guaranteed to load on every
  // visit, so it owns the cross-module rollup rather than any single
  // module file reaching into stores it doesn't own.
  //
  // The panel is injected into #dashboard-main-view via JS (not baked
  // into accounts.html) so nothing else about the page markup has to
  // change, and it re-renders automatically every time backToDashboard()
  // runs, since it's exposed as window.refreshAccountsDashboard — the
  // exact hook backToDashboard() already calls if present.
  // =========================================================================

  const STATUS_LABELS_AR = { draft: "مسودة", submitted: "مُقدّم", approved: "معتمد", posted: "مُرحّل", open: "مفتوحة", settled: "مسوّاة" };

  function extractTimestamp(id) {
    const match = String(id || "").match(/(\d{10,})/);
    return match ? Number(match[1]) : 0;
  }

  function collectRecentActivity() {
    const items = [];

    vvReadStore("vv_vouchers", []).forEach((v) => {
      items.push({
        id: v.id, ts: extractTimestamp(v.id), date: v.date,
        module: v.type === "receipt" ? "سند قبض" : "سند صرف",
        description: `${v.partyName} — ${v.description}`,
        amount: v.amount, direction: v.type === "receipt" ? "in" : "out",
        status: STATUS_LABELS_AR[v.status] || v.status,
      });
    });

    vvReadStore("vv_expenses", []).forEach((e) => {
      items.push({
        id: e.id, ts: extractTimestamp(e.id), date: e.date,
        module: "مصروفات",
        description: `${e.category} — ${e.description}`,
        amount: e.amount, direction: "out",
        status: STATUS_LABELS_AR[e.status] || e.status,
      });
    });

    vvReadStore("vv_custody", []).forEach((c) => {
      items.push({
        id: c.id, ts: extractTimestamp(c.id), date: c.date,
        module: "العهد",
        description: `${c.employee} — ${c.purpose}`,
        amount: c.amount, direction: "out",
        status: STATUS_LABELS_AR[c.status] || c.status,
      });
    });

    vvReadStore("vv_treasury_transactions", []).forEach((t) => {
      const typeLabels = { deposit: "إيداع", withdraw: "سحب", transfer: "تحويل" };
      items.push({
        id: t.id, ts: extractTimestamp(t.id), date: t.date,
        module: `الخزينة (${typeLabels[t.type] || t.type})`,
        description: t.reason || `${t.fromAccount} ← ${t.toAccount}`,
        amount: t.amount, direction: t.type === "deposit" ? "in" : t.type === "withdraw" ? "out" : "neutral",
        status: "مُرحّل",
      });
    });

    vvReadStore("vv_journal_entries", []).forEach((j) => {
      items.push({
        id: j.id, ts: extractTimestamp(j.id), date: j.date,
        module: "قيد يومي",
        description: `${j.number} — ${j.description}`,
        amount: j.totalDebit, direction: "neutral",
        status: STATUS_LABELS_AR[j.status] || j.status,
      });
    });

    return items.sort((a, b) => b.ts - a.ts).slice(0, 12);
  }

  function ensureActivityPanelExists() {
    if (document.getElementById("dashboard-recent-activity")) return;
    const dashboard = document.getElementById("dashboard-main-view");
    if (!dashboard) return;

    const panel = document.createElement("div");
    panel.id = "dashboard-recent-activity";
    panel.style.cssText = "margin-top:34px;";
    panel.innerHTML = `
      <div class="section-title" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
        <h2 style="font-family:'Cairo',sans-serif; font-weight:800; font-size:16px;">آخر العمليات — كل الأقسام</h2>
      </div>
      <div class="ledger-scroll">
        <table class="acc-table" id="recent-activity-table">
          <thead><tr><th>التاريخ</th><th>القسم</th><th>البيان</th><th>المبلغ</th><th>الحالة</th></tr></thead>
          <tbody id="recent-activity-body"></tbody>
        </table>
      </div>
      <div class="empty-state" id="recent-activity-empty" style="display:none;"><p>لا توجد عمليات مسجّلة بعد في أي قسم</p></div>
    `;
    dashboard.appendChild(panel);
  }

  function renderRecentActivity() {
    ensureActivityPanelExists();
    const items = collectRecentActivity();

    const tbody = document.getElementById("recent-activity-body");
    const table = document.getElementById("recent-activity-table");
    const empty = document.getElementById("recent-activity-empty");
    if (!tbody || !table || !empty) return;

    if (items.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      return;
    }
    table.style.display = "table";
    empty.style.display = "none";

    tbody.innerHTML = items.map((item) => {
      const amountClass = item.direction === "in" ? "amount-in" : item.direction === "out" ? "amount-out" : "";
      const sign = item.direction === "in" ? "+" : item.direction === "out" ? "-" : "";
      return `
        <tr>
          <td>${item.date}</td>
          <td class="cell-primary">${item.module}</td>
          <td>${item.description}</td>
          <td class="num ${amountClass}">${sign}${vvFormatMoney(item.amount)}</td>
          <td>${item.status}</td>
        </tr>`;
    }).join("");
  }

  // Reuse the exact hook backToDashboard() already looks for — no change
  // needed there.
  global.refreshAccountsDashboard = function () {
    renderRecentActivity();
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderRecentActivity();
  });
})(window);