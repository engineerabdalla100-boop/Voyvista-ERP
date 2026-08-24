/**
 * config.js
 * -----------------------------------------------------------------------
 * الإعدادات المشتركة لكل صفحات الـ client + "عقد" الـ API المتوقع من الـ
 * Backend (Django REST Framework). أي تعديل في شكل الـ endpoints بيتم من
 * هنا بس، وكل ملفات JS التانية بتستورد VV_CONFIG بدل ما تكتب الـ URL يدوي.
 *
 * ⚠️ لازم يتحمّل هذا الملف بـ <script> قبل أي ملف JS تاني في كل صفحة.
 * -----------------------------------------------------------------------
 */

/**
 * -----------------------------------------------------------------------
 * كل قسم من (flights / hotels / visas / accounts / sales) بيتبني بنفس
 * الشكل بالظبط: 3 Action Hubs (فواتير / حجوزات / بيانات خاصة). عشان منكررش
 * نفس الـ 12 endpoint خمس مرات، الدالة دي بتبني خريطة endpoints موحدة
 * لأي موديول بمجرد ما تديها اسمه.
 *
 * مثال الاستخدام:
 *   VV_CONFIG.ENDPOINTS.FLIGHTS.INVOICES            ->  "/flights/invoices/"
 *   VV_CONFIG.ENDPOINTS.FLIGHTS.INVOICE_DETAIL(12)   ->  "/flights/invoices/12/"
 *   VV_CONFIG.ENDPOINTS.FLIGHTS.BOOKINGS_ARCHIVE_ALL ->  "/flights/bookings/archive-all/"
 * -----------------------------------------------------------------------
 */
function vvModuleEndpoints(moduleSlug) {
  const base = `/${moduleSlug}`;
  return {
    // 1) Invoices Hub — فواتير A4 قابلة للطباعة/PDF
    // GET (list) / POST (create) body: { client_name, items[], total, notes }
    INVOICES: `${base}/invoices/`,
    // GET / PATCH / DELETE
    INVOICE_DETAIL: (id) => `${base}/invoices/${id}/`,
    // POST body: multipart/form-data { file } -> رفع صورة فاتورة ورقية خارجية
    INVOICE_UPLOAD_SCAN: `${base}/invoices/upload-scan/`,
    // PATCH body: { save_in: "suppliers" | "clients" | "main_treasury" | "expenses" }
    // (يظهر فقط لدور accounts/محاسب قبل الاعتماد)
    INVOICE_SET_SAVE_IN: (id) => `${base}/invoices/${id}/save-in/`,
    // POST body: {} -> يقفل الفاتورة نهائياً بعد تحديد save_in
    INVOICE_APPROVE_CLOSE: (id) => `${base}/invoices/${id}/approve-close/`,
    // POST body: { email } -> يبعت نسخة الفاتورة على إيميل العميل
    INVOICE_SEND_TO_CLIENT: (id) => `${base}/invoices/${id}/send-to-client/`,

    // 2) Bookings Hub — إدخال وإدارة الحجوزات
    // GET (list, فيها فقط الحجوزات المفتوحة/غير المؤرشفة) / POST (create)
    BOOKINGS: `${base}/bookings/`,
    // GET / PATCH / DELETE
    BOOKING_DETAIL: (id) => `${base}/bookings/${id}/`,
    // POST body: {} -> يؤرشف كل الحجوزات المكتملة دفعة واحدة وينضف الشاشة
    BOOKINGS_ARCHIVE_ALL: `${base}/bookings/archive-all/`,
    // GET -> عرض أرشيف الحجوزات المقفولة (شاشة منفصلة عند الطلب فقط)
    BOOKINGS_ARCHIVED: `${base}/bookings/archived/`,

    // 3) Private Data Drive — مرفقات ومجلدات لكل رحلة/عميل
    // GET (list groups) / POST (create group) body: { name }
    DRIVE_GROUPS: `${base}/drive/groups/`,
    // GET / PATCH / DELETE
    DRIVE_GROUP_DETAIL: (id) => `${base}/drive/groups/${id}/`,
    // GET (list files in group) / POST body: multipart/form-data { file, group_id }
    DRIVE_FILES: `${base}/drive/files/`,
    // DELETE
    DRIVE_FILE_DETAIL: (id) => `${base}/drive/files/${id}/`,
  };
}

const VV_CONFIG = {
  // غيّر السطر ده بس لما ننتقل من local إلى production (Coolify)
  BASE_URL: "http://localhost:8000/api/v1",

  // -----------------------------------------------------------------------
  // خريطة الـ Endpoints المتوقعة (Contract) — يراجعها الطرفين قبل الربط الفعلي
  // -----------------------------------------------------------------------
  ENDPOINTS: {
    // --- Auth (نمط DRF SimpleJWT القياسي) ---
    // POST  body: { email, password }
    // res:  { access, refresh, user: { id, full_name, email, role } }
    LOGIN: "/auth/login/",
    // POST  body: { refresh }  ->  res: { access }
    REFRESH: "/auth/refresh/",
    // POST  body: { refresh }  ->  res: 205 (بدون body)
    LOGOUT: "/auth/logout/",
    // GET   ->  res: { id, full_name, email, role, department }
    ME: "/auth/me/",

    // --- Users & Roles (owner / it_manager / it_admin / manager / supervisor / employee) ---
    // ⚠️ الإدارة الكاملة للموظفين (إضافة/حذف/تعديل) مقصورة على IT فقط من واجهة it_dashboard.html
    USERS: "/users/",                 // GET (list) / POST (create)
    USER_DETAIL: (id) => `/users/${id}/`, // GET / PATCH / DELETE

    // --- Dashboard ---
    DASHBOARD_SUMMARY: "/dashboard/summary/", // GET -> { total_bookings, active_deals, pending_requests, total_revenue, ... }
    DASHBOARD_RECENT: "/dashboard/recent/",   // GET -> { results: [...] }

    // --- Modules التشغيلية — كلها بنفس شكل الـ 3 Action Hubs ---
    // الطيران بياخد نفس الـ 3 Action Hubs + نظام Requests/Sales Report
    // الخاص بيه بس (Dual-Workflow: طلبات تحت التنفيذ ثم ترحيل تلقائي لتقرير
    // المبيعات المؤكد بمجرد ما الحالة تتغيّر لـ Confirmed)
    FLIGHTS: {
      ...vvModuleEndpoints("flights"),
      // GET (list) / POST (create) — نفس الـ 14 حقل المتفق عليها بالظبط
      REQUESTS: "/flights/requests/",
      REQUEST_DETAIL: (id) => `/flights/requests/${id}/`,
      // POST body: { file_number } (سواء كود موجود أو كود جديد) ->
      // بيرحّل الطلب بكل حقوله لتقرير المبيعات ويرجع السجل الجديد هناك
      REQUEST_CONFIRM: (id) => `/flights/requests/${id}/confirm/`,
      // GET (?search=&file_number=) / يدعم البحث بالاسم أو رقم الملف
      SALES_REPORT: "/flights/sales-report/",
      SALES_REPORT_DETAIL: (id) => `/flights/sales-report/${id}/`,
      // POST body: {} -> يقفل السنة الحالية (أرشفة) ويبدأ تقرير مبيعات جديد فاضي
      SALES_REPORT_CLOSE_PERIOD: "/flights/sales-report/close-period/",
    },
    HOTELS: vvModuleEndpoints("hotels"),
    VISAS: vvModuleEndpoints("visas"),
    SALES: vvModuleEndpoints("sales"),
    // الحسابات بتاخد نفس الـ 3 Action Hubs + حتتين إضافيتين خاصتين بيها بس:
    // الخزينة (Treasury) واستلام فواتير الموظفين في أماكن بيسميها المحاسب بنفسه
    ACCOUNTS: {
      ...vvModuleEndpoints("accounts"),
      // --- Treasury: كل عملية سحب/إيداع لازم تتسجل بملاحظة (note) ---
      // GET (list) / POST body: { type: "deposit"|"withdraw", amount, note }
      TREASURY_TRANSACTIONS: "/accounts/treasury/transactions/",
      // GET -> { balance }
      TREASURY_BALANCE: "/accounts/treasury/balance/",
      // --- Invoice Inbox: أماكن بيسميها المحاسب لاستلام فواتير الموظفين ---
      // GET (list) / POST body: { name } -> إنشاء مكان جديد
      INVOICE_INBOX_PLACES: "/accounts/invoice-inbox/places/",
      INVOICE_INBOX_PLACE_DETAIL: (id) => `/accounts/invoice-inbox/places/${id}/`,
      // GET (?place_id=) / POST multipart { file, place_id } -> استلام فاتورة من موظف
      INVOICE_INBOX_ITEMS: "/accounts/invoice-inbox/items/",
    },

    // --- Owner panel (طابع تنفيذي — Full Access على الأقسام، بدون إدارة الموظفين) ---
    OWNER_REPORTS: "/owner/reports/",
    // GET -> { total_bookings, pending_approvals, revenue_today, active_agents }
    // (أرقام الـ KPI Ticker اللي ظاهرة أعلى لوحة المالك)
    // مساحة ملفات خاصة بالـ Owner فقط (منفصلة عن drive بتاع كل موديول)
    OWNER_DRIVE_FILES: "/owner/drive/files/",   // GET (list) / POST multipart { file }
    OWNER_DRIVE_FILE_DETAIL: (id) => `/owner/drive/files/${id}/`, // DELETE
    // نفس نسخة الخزينة بتاعة المحاسب، بس للمالك بس (View + تصفير شهري)
    OWNER_TREASURY_STATEMENT: "/owner/treasury/statement/", // GET -> { balance, transactions: [...] }
    // POST body: {} -> يقفل شهر الخزينة الحالي ويبدأ من صفر (بعد أرشفة الشهر القديم)
    OWNER_TREASURY_RESET: "/owner/treasury/reset-monthly/",
    // GET -> { results: [{ department, href, active_bookings_count, active_bookings_color,
    //           invoices_pending }] } لجدول "Cross-Department Performance" في لوحة المالك
    OWNER_DEPARTMENTS_OVERVIEW: "/owner/departments-overview/",

    // --- IT Dashboard (Full Access كامل على كل شيء بالسيستم) ---
    IT_AUDIT_LOGS: "/it/audit-logs/", // GET -> { results: [{ id, actor, action, module, target, before, after, created_at }] }
    // POST body: {} -> يرجع البيانات لحالتها قبل العملية دي (Undo/Rollback)
    IT_AUDIT_ROLLBACK: (logId) => `/it/audit-logs/${logId}/rollback/`,
    IT_SYSTEM_STATS: "/it/system-stats/", // GET -> نظرة شاملة على كل الأقسام لدور الـ IT

    // --- Settings (فيها رفع لوجو الشركة) ---
    SETTINGS: "/settings/",              // GET / PATCH -> إعدادات عامة
    // POST body: multipart/form-data { file } -> يحدّث لوجو الشركة في كل الصفحات وفاتورة الـ A4
    SETTINGS_LOGO_UPLOAD: "/settings/logo/",
  },

  // -----------------------------------------------------------------------
  // مفاتيح تخزين الـ Tokens والمستخدم محلياً (localStorage) — يستخدمها auth.js
  // -----------------------------------------------------------------------
  STORAGE_KEYS: {
    ACCESS_TOKEN: "vv_access_token",
    REFRESH_TOKEN: "vv_refresh_token",
    USER: "vv_user",       // { id, full_name, email, role, department }
    COMPANY_LOGO: "vv_company_logo_url", // يتحدّث بعد أي رفع لوجو جديد من settings.html
  },

  // -----------------------------------------------------------------------
  // خرائط الصلاحيات (Route Guards) — يستخدمها auth.js لحماية الصفحات
  // -----------------------------------------------------------------------
  // Full Access كامل على كل شيء بالسيستم (المستخدمين، الصلاحيات، كل الأقسام، الـ Rollback)
  IT_FULL_ACCESS_ROLES: ["it_manager", "it_admin"],
  // مسموح لهم فتح it_dashboard.html
  IT_DASHBOARD_ROLES: ["it_manager", "it_admin"],
  // مسموح لهم فتح owner.html (المالك + IT لأن IT شايف كل حاجة)
  OWNER_PANEL_ROLES: ["owner", "it_manager", "it_admin"],
  // مسموح لهم رؤية Audit Logs وزرار Undo/Rollback
  AUDIT_LOG_ROLES: ["it_manager", "it_admin", "manager", "owner"],

  // رابط Gemini اللي بيتفتح في تبويب جديد من زرار الـ AI Assist
  AI_ASSIST_URL: "https://gemini.google.com/app",
};