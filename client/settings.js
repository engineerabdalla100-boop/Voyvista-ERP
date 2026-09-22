/**
 * settings.js -- client/settings.html
 * -----------------------------------------------------------------------
 * نسخة حقيقية متصلة بالباكيند:
 *   - اسم العرض: PATCH /api/auth/me/ الحقيقي (first_name/last_name)،
 *     مش localStorage بس.
 *   - لوجو الشركة: PATCH /api/company-settings/ -- إعداد مشترك حقيقي
 *     لكل المستخدمين (بعكس vv_company_logo_url القديمة الخاصة بمتصفح
 *     واحد فقط).
 *   - الوضع الداكن + الاتجاه: تفعيل حقيقي فوري عبر VVTheme (theme.js)،
 *     مش مجرد تفضيل محفوظ بلا أثر زي النسخة القديمة.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  var MAX_LOGO_BYTES = 500 * 1024;

  function renderLogoPreview(url) {
    var box = document.getElementById("logo-preview-box");
    if (url) {
      box.innerHTML = "<img src=\"" + url + "\" alt=\"logo\" />";
    } else {
      box.innerHTML = "<span class=\"logo-placeholder\">No logo</span>";
    }
  }

  async function loadCurrentValues() {
    try {
      var meResult = await VVApi.request(VV_CONFIG.ENDPOINTS.ME);
      document.getElementById("setting-user-name").value = meResult.data.full_name || "";
    } catch (err) {
      alert(err.message || "تعذّر تحميل بيانات الحساب.");
    }

    try {
      var companyResult = await VVApi.request("/company-settings/");
      renderLogoPreview(companyResult.data.logo);
    } catch (err) {
      renderLogoPreview(null);
    }

    var prefs = VVTheme.getPrefs();
    document.getElementById("setting-dark-mode").checked = !!prefs.darkMode;
    document.getElementById("setting-direction").value = prefs.direction || "rtl";
  }

  async function handleLogoUpload() {
    var input = document.getElementById("setting-logo-upload");
    var file = input.files && input.files[0];
    if (!file) return;

    if (file.type.indexOf("image/") !== 0) {
      alert("الملف المختار مش صورة -- اختار صورة صحيحة.");
      input.value = "";
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      var sizeKb = Math.round(file.size / 1024);
      var maxKb = Math.round(MAX_LOGO_BYTES / 1024);
      alert("حجم الصورة كبير جدًا (" + sizeKb + " كيلوبايت) -- الحد الأقصى " + maxKb + " كيلوبايت.");
      input.value = "";
      return;
    }

    var formData = new FormData();
    formData.append("logo", file);

    try {
      var result = await VVApi.request("/company-settings/", { method: "PATCH", body: formData, isFormData: true });
      renderLogoPreview(result.data.logo);
      showSaveStatus("تم رفع اللوجو -- هيظهر فورًا في القائمة الجانبية لكل المستخدمين.");
    } catch (err) {
      alert(err.message || "تعذّر رفع اللوجو.");
    }
  }

  async function handleRemoveLogo() {
    if (!confirm("إزالة لوجو الشركة الحالي؟ هيتأثر كل المستخدمين.")) return;
    try {
      await VVApi.request("/company-settings/", { method: "PATCH", body: { logo: null } });
      renderLogoPreview(null);
      document.getElementById("setting-logo-upload").value = "";
      showSaveStatus("تمت إزالة اللوجو لكل المستخدمين.");
    } catch (err) {
      alert(err.message || "تعذّر إزالة اللوجو.");
    }
  }

  function showSaveStatus(message) {
    var el = document.getElementById("save-status-msg");
    el.textContent = message;
    el.classList.add("save-status-msg--ok");
    setTimeout(function () {
      el.textContent = "";
      el.classList.remove("save-status-msg--ok");
    }, 4000);
  }

  async function saveAllSettings() {
    var newName = document.getElementById("setting-user-name").value.trim();
    if (!newName) { alert("اسم الموظف الظاهر مطلوب."); return; }

    var nameParts = newName.split(" ");
    var firstName = nameParts.shift() || "";
    var lastName = nameParts.join(" ");

    var saveBtn = document.getElementById("btn-save-settings");
    saveBtn.disabled = true;

    try {
      var meResult = await VVApi.request(VV_CONFIG.ENDPOINTS.ME, {
        method: "PATCH",
        body: { first_name: firstName, last_name: lastName },
      });

      var storedUser = JSON.parse(localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER) || "{}");
      storedUser.full_name = meResult.data.full_name;
      localStorage.setItem(VV_CONFIG.STORAGE_KEYS.USER, JSON.stringify(storedUser));

      var darkMode = document.getElementById("setting-dark-mode").checked;
      var direction = document.getElementById("setting-direction").value;
      VVTheme.save({ darkMode: darkMode, direction: direction });

      if (window.VVComponents && typeof window.VVComponents.mount === "function") {
        window.VVComponents.mount({ page: "settings", title: "الإعدادات" });
      }

      showSaveStatus("تم حفظ التغييرات بنجاح.");
    } catch (err) {
      alert(err.message || "تعذّر حفظ التغييرات.");
    } finally {
      saveBtn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadCurrentValues();
    document.getElementById("setting-logo-upload").addEventListener("change", handleLogoUpload);
    document.getElementById("btn-remove-logo").addEventListener("click", handleRemoveLogo);
    document.getElementById("btn-save-settings").addEventListener("click", saveAllSettings);
  });
})();