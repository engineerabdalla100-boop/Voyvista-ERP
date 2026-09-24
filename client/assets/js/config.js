/**
 * config.js
 * -----------------------------------------------------------------------
 * Central configuration for the client + the real API paths served by
 * Django REST Framework backend. Update BASE_URL when switching between
 * local and production. Storage keys used for the Token and current
 * user must match what auth.js uses.
 * -----------------------------------------------------------------------
 */

const VV_CONFIG = {
  // Change this line only when switching between local and production
  BASE_URL: (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://127.0.0.1:8000/api"
    : window.location.origin + "/api",

  ENDPOINTS: {
    // --- Auth (Token auth via rest_framework.authtoken, not JWT) ---
    // POST body: { username, password } -> res: { token, user: {...} }
    LOGIN: "/auth/login/",
    // POST (no body) -> res: 204
    LOGOUT: "/auth/logout/",
    // GET -> res: { id, username, email, first_name, last_name, phone, role, is_active_employee, date_joined }
    ME: "/auth/me/",

    // --- Employees (employee directory, ADMIN only) ---
    EMPLOYEES: "/employees/",                     // GET (list) / POST (create)
    EMPLOYEE_DETAIL: (id) => `/employees/${id}/`, // GET / PATCH / DELETE
    EMPLOYEE_TOGGLE_ACTIVE: (id) => `/employees/${id}/toggle_active/`, // POST
    EMPLOYEE_AVAILABLE_MODULES: "/employees/available_modules/",       // GET

    // --- Core (Chart of accounts + Maker-Checker approvals) ---
    ACCOUNTS: "/accounts/",
    ACCOUNT_DETAIL: (id) => `/accounts/${id}/`,
    CHANGE_REQUESTS: "/change-requests/",
    CHANGE_REQUEST_APPROVE: (id) => `/change-requests/${id}/approve/`, // POST
    CHANGE_REQUEST_REJECT: (id) => `/change-requests/${id}/reject/`,   // POST body: { reason }

    // --- Operations (department=flight|hotel|visa) ---
    BOOKINGS: "/bookings/",

    // --- Accounting ---
    ACCOUNTS_COA: "/accounts-coa/",
    ACCOUNTS_COA_DETAIL: (id) => `/accounts-coa/${id}/`,
    JOURNAL_ENTRIES: "/journal-entries/",
    JOURNAL_ENTRY_DETAIL: (id) => `/journal-entries/${id}/`,
    CUSTODY: "/custody/",
    CUSTODY_DETAIL: (id) => `/custody/${id}/`,
    EXPENSES_ACC: "/expenses/",
    EXPENSE_DETAIL: (id) => `/expenses/${id}/`,
    VOUCHERS: "/vouchers/",
    VOUCHER_DETAIL: (id) => `/vouchers/${id}/`,
    INVOICES: "/invoices/",
    INVOICE_DETAIL: (id) => `/invoices/${id}/`,
    FINANCIAL_PERIODS: "/financial-periods/",
    FINANCIAL_PERIOD_DETAIL: (id) => `/financial-periods/${id}/`,
    REPORT_PROFIT_LOSS: "/reports/profit-loss/",
    REPORT_DEPARTMENT_PERFORMANCE: "/reports/department-performance/",
    REPORT_LEDGER: "/reports/ledger/",
    REPORT_TRIAL_BALANCE: "/reports/trial-balance/",
    REPORT_AUDIT_LOG: "/reports/audit-log/",
    REPORT_AR_AP_AGING: "/reports/ar-ap-aging/",
    RECURRING_EXPENSES: "/recurring-expenses/",
    RECURRING_EXPENSE_DETAIL: (id) => `/recurring-expenses/${id}/`,
    RECURRING_POST_PAYROLL: "/recurring-expenses/post_payroll_batch/",
    HOTELS_DIRECTORY: "/hotels-directory/",
    HOTELS_DIRECTORY_DETAIL: (id) => `/hotels-directory/${id}/`,
    PARTY_SEARCH_CODES: "/parties/search_codes/",
    PARTY_RESOLVE_CODE: "/parties/resolve_code/",
    PARTY_PEEK_NEXT_CODE: "/parties/peek_next_code/",
    DEALS: "/deals/",
    DEAL_DETAIL: (id) => `/deals/${id}/`,
    DEAL_MOVE_STAGE: (id) => `/deals/${id}/move_stage/`,
    ACTIVITIES: "/activities/",
    PARTY_HISTORY: (id) => `/parties/${id}/history/`,
    PARTY_LINK_ALIAS: (id) => `/parties/${id}/link_alias/`,
    OPERATIONS_PENDING: "/operations/pending/",
    OPERATIONS_APPROVE: (id) => `/operations/${id}/approve/`,
    OPERATIONS_CANCEL: (id) => `/operations/${id}/cancel/`,
    BOOKING_DETAIL: (id) => `/bookings/${id}/`,
    BOOKING_CONFIRM: (id) => `/bookings/${id}/confirm/`,
    BOOKING_FILE_NUMBERS: "/bookings/file-numbers/",

    // --- Staff (HR employee registry) ---
    STAFF: "/staff/",
    STAFF_DETAIL: (id) => `/staff/${id}/`,
    STAFF_END_CONTRACT: (id) => `/staff/${id}/end-contract/`,
    STAFF_REACTIVATE: (id) => `/staff/${id}/reactivate/`,

    // --- Events ---
    EVENTS: "/events/",
    EVENT_DETAIL: (id) => `/events/${id}/`,

    // --- Data (B2B/B2C customers) ---
    PARTIES: "/parties/",
    PARTY_DETAIL: (id) => `/parties/${id}/`,
    PARTY_DOCUMENTS: "/party-documents/",
    PARTY_CRM_LOG: "/party-crm-log/",

    // --- Sales ---
    SALES: "/sales/",
    SALES_DETAIL: (id) => `/sales/${id}/`,
    SALES_QUOTES: "/sales-quotes/",
    SALES_CUSTOMER_NOTES: "/sales-customer-notes/",
    SALES_COMMUNICATION_LOG: "/sales-communication-log/",
    SALES_SETTINGS: "/sales-settings/", // GET / PUT

    // --- Cars ---
    CARS: "/cars/",
    CAR_DETAIL: (id) => `/cars/${id}/`,
    CAR_MOVEMENTS: "/car-movements/", // ?car=<id>

    // --- Guides ---
    GUIDES: "/guides/",
    GUIDE_DETAIL: (id) => `/guides/${id}/`,

    // --- Dashboard (IT + Owner) ---
    BROADCAST: "/broadcast/",
    COMPANY_SETTINGS: "/company-settings/",
    OWNER_FILES: "/owner-files/",       // GET (list) / POST multipart { name, file }
    OWNER_FILE_DETAIL: (id) => `/owner-files/${id}/`, // DELETE
    DASHBOARD_OVERVIEW: "/dashboard-overview/",       // GET (ADMIN only)
    AUDIT_LOG_EXPORT: "/audit-log/export/",           // GET -> CSV file (ADMIN only)
  },

  // -----------------------------------------------------------------------
  // Storage keys used for the Token and current user -- must match what
  // auth.js uses
  // -----------------------------------------------------------------------
  STORAGE_KEYS: {
    TOKEN: "vv_access_token",   // token saved after login, read by every request via auth.js
    USER: "vv_user",            // { id, username, email, role, is_active_employee, ... }
  },

  // -----------------------------------------------------------------------
  // Role definitions matching users.User.Role in the backend
  // -----------------------------------------------------------------------
  ADMIN_ONLY_ROLES: ["ADMIN"],
  CHECKER_ROLES: ["ADMIN", "ACCOUNTANT"], // matches core/policy.py's _CHECKER_ROLES
  ALL_ROLES: ["ADMIN", "ACCOUNTANT", "OPERATIONS", "SALES"],
};