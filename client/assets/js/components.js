/**
 * components.js
 * -----------------------------------------------------------------------
 * Shared UI elements across every page: Sidebar, Topbar, and the AI
 * Assist button. Every page calls VVComponents.mount(...) once after
 * the DOM is ready.
 *
 * Depends on: config.js (must load before this file)
 * -----------------------------------------------------------------------
 */

const VVIcons = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  flights: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.53.5L4 14l3 1 2-2.5 3 6 1.5-1L12 10l6-3.5c1-.6 1-2 0-2.6-.7-.4-1.5-.3-2.2.1L10.5 8"/></svg>`,
  hotels: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15"/><path d="M14 10h6a1 1 0 0 1 1 1v10"/><path d="M7 9h1M7 13h1M10 9h1M10 13h1"/><path d="M3 21h18"/></svg>`,
  visas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="12" r="2.2"/><path d="M14 9.5h5M14 12h5M14 14.5h3"/></svg>`,
  staff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15 20a4.5 4.5 0 0 1 8 0"/></svg>`,
  guides: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="M12 3v1.5M9 4l1 1M15 4l-1 1"/></svg>`,
  cars: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 13l1.5-5A2 2 0 0 1 6.4 6.5h11.2A2 2 0 0 1 19.5 8L21 13"/><path d="M3 13h18v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z"/><circle cx="7.5" cy="16" r="1.3"/><circle cx="16.5" cy="16" r="1.3"/></svg>`,
  events: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1.2"/><circle cx="12" cy="14.5" r="1.2"/><circle cx="15.5" cy="14.5" r="1.2"/></svg>`,
  sales: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12l4-5 4 3 6-7 4 4"/><path d="M17 3h4v4"/><path d="M3 20h18"/></svg>`,
  customers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M15 20a4.5 4.5 0 0 1 8 0"/></svg>`,
  accounts: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.6-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2"/></svg>`,
  data: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`,
  owner: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z"/></svg>`,
  itDashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/><path d="M7 8.5l2 2-2 2M12.5 12.5h3"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 .1-2l2-1.5-2-3.4-2.3.6a7.7 7.7 0 0 0-1.7-1L15 3h-4l-.5 2.7a7.7 7.7 0 0 0-1.7 1l-2.3-.6-2 3.4L6.5 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.6c.5.4 1.1.8 1.7 1L10.5 21h4l.5-2.7c.6-.2 1.2-.6 1.7-1l2.3.6 2-3.4-2-1.5z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 8-2.5 8h17S18 14 18 8z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 15l6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.6L19.5 9l-5.7 1.4L12 16l-1.8-5.6L4.5 9l5.7-1.4L12 2z"/><path d="M19 14l.9 2.7L22.5 17l-2.6.8L19 20.5l-.9-2.7-2.6-.8 2.6-.8L19 14z" opacity=".6"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  externalLink: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4h6v6M20 4l-9 9M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>`,
  invoice: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M9.5 12h5M9.5 15h5M9.5 9h2.5"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13"/></svg>`,
  print: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M6 17v4h12v-4"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>`,
  plusCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`,
  file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 9v4"/><circle cx="12" cy="16.3" r=".4" fill="currentColor" stroke="none"/><path d="M10.6 3.9L2.4 18a1.5 1.5 0 0 0 1.3 2.2h16.6a1.5 1.5 0 0 0 1.3-2.2L13.4 3.9a1.5 1.5 0 0 0-2.8 0z"/></svg>`,
};

// -----------------------------------------------------------------------
// Sidebar navigation map (regular roles)
// -----------------------------------------------------------------------
const VV_NAV = [
  {
    group: "Bookings",
    items: [
      { key: "flights", label: "Flights", href: "/client/modules/operations/flights.html", icon: "flights" },
      { key: "hotels", label: "Hotels", href: "/client/modules/operations/hotels.html", icon: "hotels" },
      { key: "visas", label: "Visas", href: "/client/modules/operations/visas.html", icon: "visas" },
      { key: "staff", label: "Staff", href: "/client/modules/operations/staff.html", icon: "staff" },
      { key: "guides", label: "Tour Guides", href: "/client/modules/operations/guides.html", icon: "guides" },
      { key: "cars", label: "Cars", href: "/client/modules/operations/cars.html", icon: "cars" },
      { key: "events", label: "Events", href: "/client/modules/operations/events.html", icon: "events" },
    ],
  },
  {
    group: "Operations",
    items: [
      { key: "sales", label: "Sales", href: "/client/modules/operations/sales.html", icon: "sales" },
      { key: "data", label: "Data", href: "/client/modules/master_data/data.html", icon: "data" },
      { key: "accounts", label: "Accounts", icon: "accounts", children: [
        { key: "acc_coa", label: "Chart of Accounts", href: "/client/modules/accounts/chart_of_accounts.html" },
        { key: "acc_operations", label: "Operations", href: "/client/modules/accounts/operations.html" },
        { key: "acc_expenses", label: "Expenses & Custody", href: "/client/modules/accounts/expenses.html" },
        { key: "acc_treasury", label: "AR/AP & Treasury", href: "/client/modules/accounts/treasury.html" },
        { key: "acc_invoicing", label: "Invoicing", href: "/client/modules/accounts/invoicing.html" },
        { key: "acc_closing", label: "Monthly Closing", href: "/client/modules/accounts/monthly_closing.html" },
        { key: "acc_reports", label: "Reports & Audit Log", href: "/client/modules/accounts/reports.html" },
      ] },
    ],
  },
  {
    group: "Management",
    items: [
      { key: "owner", label: "Owner Panel", href: "/client/modules/dashboard/owner.html", icon: "owner" },
      { key: "it_dashboard", label: "IT Dashboard", href: "/client/modules/dashboard/it_dashboard.html", icon: "itDashboard", allowedRoles: ["ADMIN", "IT"] },
      { key: "settings", label: "Settings", href: "/client/settings.html", icon: "settings" },
    ],
  },
];

// -----------------------------------------------------------------------
// Owner's own sidebar -- intentionally separate list, operational
// sections only, no Sales/Accounts/IT Dashboard/Settings.
// -----------------------------------------------------------------------
const OWNER_SIDEBAR_ITEMS = [
  { key: "flights", label: "Flights", href: "/client/modules/operations/flights.html", icon: "flights" },
  { key: "hotels", label: "Hotels", href: "/client/modules/operations/hotels.html", icon: "hotels" },
  { key: "visas", label: "Visas", href: "/client/modules/operations/visas.html", icon: "visas" },
  { key: "staff", label: "Staff", href: "/client/modules/operations/staff.html", icon: "staff" },
  { key: "guides", label: "Tour Guides", href: "/client/modules/operations/guides.html", icon: "guides" },
  { key: "cars", label: "Cars", href: "/client/modules/operations/cars.html", icon: "cars" },
  { key: "events", label: "Events", href: "/client/modules/operations/events.html", icon: "events" },
  { key: "data", label: "Data", href: "/client/modules/master_data/data.html", icon: "data" },
];

const ROLE_LABELS = {
  ADMIN: "System Administrator",
  OWNER: "Owner",
  IT: "IT",
  ACCOUNTANT: "Accountant",
  OPERATIONS: "Operations Staff",
  SALES: "Sales Executive",
};

// Keys of Accounts submodule pages -- used so the Accounts group starts
// expanded automatically when the user is already on one of its pages.
const ACCOUNTS_CHILD_KEYS = ["acc_operations", "acc_expenses", "acc_treasury", "acc_invoicing", "acc_closing", "acc_reports"];

const VVComponents = (() => {
  function getCurrentUser() {
    try {
      const raw = localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* ignore parsing errors */
    }
    return { id: 0, full_name: "User", role: "OPERATIONS" };
  }

  function getCompanyLogo() {
    try {
      return localStorage.getItem(VV_CONFIG.STORAGE_KEYS.COMPANY_LOGO) || null;
    } catch (e) {
      return null;
    }
  }

  function initials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    return parts.slice(0, 2).map((p) => p[0]).join("");
  }

  function renderLink(item, activePage) {
    const activeClass = item.key === activePage ? " is-active" : "";
    return `
      <a class="nav-link${activeClass}" href="${item.href}" data-page="${item.key}">
        ${VVIcons[item.icon] || ""}
        <span>${item.label}</span>
      </a>`;
  }

  // Renders a single item -- either a plain link, or (when `children` is
  // present) an expandable Accordion group: a toggle row with a chevron
  // that flips, and its child links indented underneath. Auto-expands
  // when the current page is one of its own children, so navigating
  // directly to a sub-page never hides itself.
  function renderNavItem(item, activePage) {
    if (!item.children) return renderLink(item, activePage);

    const isChildActive = item.children.some((child) => child.key === activePage);
    const childLinks = item.children.map((child) => renderLink(child, activePage)).join("");

    return `
      <div class="nav-accordion${isChildActive ? " is-expanded" : ""}" data-accordion-key="${item.key}">
        <button type="button" class="nav-link nav-accordion__toggle" data-accordion-toggle="${item.key}">
          ${VVIcons[item.icon] || ""}
          <span>${item.label}</span>
          <span class="nav-accordion__chevron">${VVIcons.chevronDown}</span>
        </button>
        <div class="nav-accordion__panel">
          ${childLinks}
        </div>
      </div>`;
  }

  function buildNavHTML(activePage, role) {
    const user = getCurrentUser();
    // allowed_modules is null/undefined for roles that should see
    // everything (Admin, Owner, IT); for a regular employee it's an
    // explicit array of module keys set by the admin, and anything
    // not in that list must not render in the sidebar at all.
    const hasModuleRestriction = Array.isArray(user.allowed_modules);

    return VV_NAV.map((section) => {
      const visibleItems = section.items.filter((item) => {
        if (item.allowedRoles && !item.allowedRoles.includes(role)) return false;
        if (hasModuleRestriction && !user.allowed_modules.includes(item.key)) return false;
        return true;
      });
      if (visibleItems.length === 0) return "";

      const groupLabel = section.group
        ? `<div class="sidebar__group-label">${section.group}</div>`
        : "";

      const links = visibleItems.map((item) => renderNavItem(item, activePage)).join("");

      return groupLabel + links;
    }).join("");
  }

  function wireAccordionToggles(container) {
    container.querySelectorAll("[data-accordion-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const wrapper = btn.closest(".nav-accordion");
        if (wrapper) wrapper.classList.toggle("is-expanded");
      });
    });
  }

  // Owner's own sidebar: a fixed "Back to Owner Panel" link at the top,
  // then only the operational sections -- deliberately its own separate
  // list (OWNER_SIDEBAR_ITEMS), not filtered from VV_NAV, so it never
  // accidentally picks up Sales/Accounts/IT Dashboard/Settings if those
  // lists change later.
  function renderOwnerSidebar(activePage) {
    const mountEl = document.getElementById("app-sidebar");
    if (!mountEl) return;

    const links = OWNER_SIDEBAR_ITEMS.map((item) => renderLink(item, activePage)).join("");

    mountEl.innerHTML = `
      <div class="sidebar">
        <a href="/client/modules/dashboard/owner.html" style="display:flex; align-items:center; gap:9px; padding:14px 18px; margin:10px 12px 6px; background:var(--ink); color:var(--gold); border-radius:8px; text-decoration:none; font-size:12.5px; font-weight:700;">
          ${VVIcons.arrowLeft}
          <span>Back to Owner Panel</span>
        </a>
        <div class="stub-divider"></div>
        <nav class="sidebar__nav">
          <div class="sidebar__group-label">Operations</div>
          ${links}
        </nav>
      </div>
    `;
  }

  function renderSidebar(activePage) {
    const mountEl = document.getElementById("app-sidebar");
    if (!mountEl) return;

    const user = getCurrentUser();

    if (user.role === "OWNER") {
      renderOwnerSidebar(activePage);
      return;
    }

    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const logoUrl = getCompanyLogo();
    const brandMarkInner = logoUrl
      ? `<img src="${logoUrl}" alt="Company logo" style="width:100%;height:100%;object-fit:cover;border-radius:9px;" />`
      : VVIcons.flights;

    mountEl.innerHTML = `
      <div class="sidebar">
        <div class="sidebar__brand">
          <div class="sidebar__brand-mark">
            ${brandMarkInner}
          </div>
          <div class="sidebar__brand-text">
            <span class="sidebar__brand-name">Voyvista</span>
            <span class="sidebar__brand-sub">Travel ERP</span>
          </div>
        </div>
        <div class="stub-divider"></div>
        <nav class="sidebar__nav">
          ${buildNavHTML(activePage, user.role)}
        </nav>
        <div class="stub-divider"></div>
        <div class="sidebar__footer">
          <div class="sidebar__user-avatar">${initials(user.full_name)}</div>
          <div class="sidebar__user-meta">
            <div class="sidebar__user-name">${user.full_name}</div>
            <div class="sidebar__user-role">${roleLabel}</div>
          </div>
        </div>
      </div>
    `;

    wireAccordionToggles(mountEl);
  }

  function renderTopbar({ title } = {}) {
    const mountEl = document.getElementById("app-topbar");
    if (!mountEl) return;

    const user = getCurrentUser();
    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const today = new Date().toLocaleDateString("en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });

    mountEl.innerHTML = `
      <div class="topbar">
        <div class="topbar__search">
          ${VVIcons.search}
          <span>Search bookings, clients, requests...</span>
          <kbd>Ctrl K</kbd>
        </div>
        <div class="topbar__spacer"></div>
        <div class="topbar__chip">
          ${VVIcons.calendar}
          <span>${today}</span>
        </div>
        <button class="topbar__icon-btn" aria-label="Notifications">
          ${VVIcons.bell}
          <span class="dot"></span>
        </button>
        <div class="topbar__profile">
          <div class="sidebar__user-avatar" style="background:var(--gold-soft);color:var(--gold-deep);">
            ${initials(user.full_name)}
          </div>
          <div class="topbar__profile-meta">
            <div class="topbar__profile-name">${user.full_name}</div>
            <div class="topbar__profile-role">${roleLabel}</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderAIButton() {
    if (document.querySelector(".ai-fab")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <button class="ai-fab" id="vv-ai-fab" aria-label="AI Assistant">
        ${VVIcons.sparkle}
      </button>
      <div class="ai-panel-overlay" id="vv-ai-overlay"></div>
      <div class="ai-panel" id="vv-ai-panel">
        <div class="ai-panel__header">
          <div class="ai-panel__header-icon">${VVIcons.sparkle}</div>
          <div class="ai-panel__header-text">
            <div class="ai-panel__header-title">Voyvista Assistant</div>
            <div class="ai-panel__header-sub">Ask about anything you need help with</div>
          </div>
          <button class="ai-panel__close" id="vv-ai-close" aria-label="Close">${VVIcons.close}</button>
        </div>
        <div class="ai-panel__body">
          ${VVIcons.sparkle}
          <h3>Opens in a new tab</h3>
          <p>Click the button below to open Gemini in a separate tab for any questions.</p>
          <button class="btn btn--primary" id="vv-ai-open-external">
            ${VVIcons.externalLink} Open Assistant
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    const fab = document.getElementById("vv-ai-fab");
    const overlay = document.getElementById("vv-ai-overlay");
    const panel = document.getElementById("vv-ai-panel");
    const closeBtn = document.getElementById("vv-ai-close");
    const openExternalBtn = document.getElementById("vv-ai-open-external");

    const openPanel = () => {
      overlay.classList.add("is-open");
      panel.classList.add("is-open");
    };
    const closePanel = () => {
      overlay.classList.remove("is-open");
      panel.classList.remove("is-open");
    };

    fab.addEventListener("click", openPanel);
    overlay.addEventListener("click", closePanel);
    closeBtn.addEventListener("click", closePanel);
    openExternalBtn.addEventListener("click", () => {
      window.open(VV_CONFIG.AI_ASSIST_URL, "_blank", "noopener,noreferrer");
    });
  }

  function buildHubGrid(hubs) {
    return `
      <div class="hub-grid">
        ${hubs
          .map(
            (hub) => `
          <button class="hub-card" data-hub-key="${hub.key}">
            <div class="hub-card__icon hub-card__icon--${hub.colorClass}">
              ${VVIcons[hub.icon] || ""}
            </div>
            <div class="hub-card__title">${hub.title}</div>
            <div class="hub-card__desc">${hub.desc}</div>
            <div class="hub-card__cta">Open ${VVIcons.arrowLeft}</div>
          </button>`
          )
          .join("")}
      </div>
    `;
  }

  function buildHubViewHead({ title, subtitle }) {
    return `
      <div class="hub-view-head">
        <button class="hub-back-btn" id="hub-back-btn" aria-label="Back">${VVIcons.arrowLeft}</button>
        <div>
          <h2>${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ""}
        </div>
      </div>
    `;
  }

  function buildInlineNotice(message) {
    return `<div class="inline-notice">${VVIcons.alert}<span>${message}</span></div>`;
  }

  function mount({ page, title } = {}) {
    renderSidebar(page);
    renderTopbar({ title });
    renderAIButton();
  }

  return { mount, getCurrentUser, getCompanyLogo, buildHubGrid, buildHubViewHead, buildInlineNotice };
})();
