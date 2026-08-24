/**
 * settings.js — client/settings.html (الإعدادات)
 * -----------------------------------------------------------------------
 * Two things here are REAL, functional, and immediately visible
 * elsewhere in the app:
 *   1. Company logo — uploading here writes to VV_CONFIG.STORAGE_KEYS
 *      .COMPANY_LOGO (vv_company_logo_url), which components.js's
 *      getCompanyLogo() already reads and renders in the sidebar on
 *      every single page. This is the missing piece config.js was
 *      already documented as expecting from this exact file.
 *   2. Display name — writes to vv_user.full_name, the same field
 *      auth.js/components.js already read for "Demo User" everywhere.
 *
 * Dark Mode and RTL/LTR direction are saved as a stored PREFERENCE
 * (vv_ui_preferences) but are honestly NOT wired into every page's
 * actual rendering — this project's entire CSS (colors, spacing,
 * layout) is built assuming one light, RTL theme throughout, and
 * making both real would mean designing and testing a full alternate
 * color system and mirrored layout across every single page — a much
 * larger, separate piece of work. Saving the toggle here without
 * pretending it's already fully wired everywhere would be misleading,
 * so this file is explicit about that boundary via the on-page notice
 * and the save confirmation message.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  const MAX_LOGO_BYTES = 500 * 1024;
  const PREFS_KEY = "vv_ui_preferences";

  function readUser() {
    try { return JSON.parse(localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER)) || {}; } catch (e) { return {}; }
  }
  function writeUser(user) { localStorage.setItem(VV_CONFIG.STORAGE_KEYS.USER, JSON.stringify(user)); }

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || { darkMode: false, direction: "rtl" }; }
    catch (e) { return { darkMode: false, direction: "rtl" }; }
  }
  function writePrefs(prefs) { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }

  function renderLogoPreview(dataUrl) {
    const box = document.getElementById("logo-preview-box");
    box.innerHTML = dataUrl
      ? `<img src="${dataUrl}" alt="لوجو الشركة" />`
      : `<span class="logo-placeholder">بدون لوجو</span>`;
  }

  function loadCurrentValues() {
    const user = readUser();
    document.getElementById("setting-user-name").value = user.full_name || "";

    const currentLogo = (window.VVComponents && typeof window.VVComponents.getCompanyLogo === "function")
      ? window.VVComponents.getCompanyLogo()
      : (localStorage.getItem(VV_CONFIG.STORAGE_KEYS.COMPANY_LOGO) || null);
    renderLogoPreview(currentLogo);

    const prefs = readPrefs();
    document.getElementById("setting-dark-mode").checked = !!prefs.darkMode;
    document.getElementById("setting-direction").value = prefs.direction || "rtl";
  }

  function handleLogoUpload() {
    const input = document.getElementById("setting-logo-upload");
    const file = input.files && input.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("الملف المختار مش صورة — اختار صورة صحيحة.");
      input.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      alert(`حجم الصورة كبير جدًا (${Math.round(file.size / 1024)} كيلوبايت) — الحد الأقصى ${Math.round(MAX_LOGO_BYTES / 1024)} كيلوبايت.`);
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      localStorage.setItem(VV_CONFIG.STORAGE_KEYS.COMPANY_LOGO, reader.result);
      renderLogoPreview(reader.result);
      showSaveStatus("تم رفع اللوجو — هيظهر فورًا في القائمة الجانبية لكل الصفحات.");
    };
    reader.onerror = () => alert("تعذّرت قراءة الصورة — جرّب ملف تاني.");
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    if (!confirm("إزالة لوجو الشركة الحالي؟ هيرجع الشعار الافتراضي في كل الصفحات.")) return;
    localStorage.removeItem(VV_CONFIG.STORAGE_KEYS.COMPANY_LOGO);
    renderLogoPreview(null);
    document.getElementById("setting-logo-upload").value = "";
    showSaveStatus("تمت إزالة اللوجو.");
  }

  function showSaveStatus(message) {
    const el = document.getElementById("save-status-msg");
    el.textContent = message;
    el.classList.add("save-status-msg--ok");
    setTimeout(() => { el.textContent = ""; el.classList.remove("save-status-msg--ok"); }, 4000);
  }

  function saveAllSettings() {
    const newName = document.getElementById("setting-user-name").value.trim();
    if (!newName) { alert("اسم الموظف الظاهر مطلوب — ما ينفعش يبقى فاضي."); return; }

    const user = readUser();
    user.full_name = newName;
    writeUser(user);

    const darkMode = document.getElementById("setting-dark-mode").checked;
    const direction = document.getElementById("setting-direction").value;
    writePrefs({ darkMode, direction });

    // Refresh the sidebar/topbar's own display of the name immediately,
    // without needing a full page reload, if components.js exposes a
    // refresh hook — otherwise the change is already saved and will show
    // correctly on next navigation regardless.
    if (window.VVComponents && typeof window.VVComponents.mount === "function") {
      window.VVComponents.mount({ page: "settings", title: "الإعدادات" });
    }

    if (darkMode || direction === "ltr") {
      showSaveStatus("تم الحفظ. تنبيه: الوضع الداكن/LTR اتسجّلوا كتفضيل، لكن التفعيل الكامل على كل الصفحات لسه مش جاهز.");
    } else {
      showSaveStatus("تم حفظ التغييرات بنجاح.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadCurrentValues();
    document.getElementById("setting-logo-upload").addEventListener("change", handleLogoUpload);
    document.getElementById("btn-remove-logo").addEventListener("click", handleRemoveLogo);
    document.getElementById("btn-save-settings").addEventListener("click", saveAllSettings);
  });
})();