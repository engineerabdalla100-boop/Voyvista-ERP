/**
 * login.js -- client/login.html
 * -----------------------------------------------------------------------
 * نسخة حقيقية متصلة بالباكيند (Django REST Framework عبر VVApi) -- بتحل
 * محل النسخة القديمة اللي كانت بتقبل أي username/password بلا أي تحقق
 * فعلي وتخزّن دور "employee" ثابت. دلوقتي:
 *   - بيبعت طلب حقيقي لـ /api/auth/login/
 *   - باسورد غلط أو مستخدم مش موجود = رفض حقيقي من السيرفر (400)
 *   - الرول (role) اللي بيتخزن جاي من السيرفر نفسه، مش قيمة ثابتة
 *   - full_name بيتبني هنا من first_name/last_name -- الباكيند بيرجّع
 *     الاتنين منفصلين، لكن باقي الفرونت إند (components.js وغيره)
 *     بيدوّر على حقل full_name واحد مجمّع، فبنبنيه هنا بدل ما نغيّر
 *     شكل الباكيند نفسه.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  var LANDING_PAGE = "/client/modules/operations/flights.html";

  async function handleLoginSubmit(e) {
    e.preventDefault();

    var username = document.getElementById("username").value.trim();
    var password = document.getElementById("password").value;
    var submitBtn = document.querySelector(".login-btn");

    if (!username) { alert("اكتب اسم المستخدم."); return; }
    if (!password) { alert("اكتب كلمة المرور."); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "جاري الدخول...";

    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.LOGIN, {
        method: "POST",
        body: { username: username, password: password },
      });

      var user = result.data.user;
      var fullName = ((user.first_name || "") + " " + (user.last_name || "")).trim();
      user.full_name = fullName || user.username;

      localStorage.setItem(VV_CONFIG.STORAGE_KEYS.TOKEN, result.data.token);
      localStorage.setItem(VV_CONFIG.STORAGE_KEYS.USER, JSON.stringify(user));

      window.location.href = LANDING_PAGE;
    } catch (err) {
      alert(err.message || "فشل تسجيل الدخول.");
      submitBtn.disabled = false;
      submitBtn.textContent = "تسجيل الدخول";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("login-form");
    if (form) form.addEventListener("submit", handleLoginSubmit);
  });
})();