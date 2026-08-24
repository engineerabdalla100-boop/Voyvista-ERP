/**
 * login.js — client/login.html
 * -----------------------------------------------------------------------
 * login.html's form had no submit handler at all — hitting the button
 * just did a native page reload with nothing saved. This wires it up
 * for real, consistent with how the rest of this project already works.
 *
 * HONEST LIMITATION (matching auth.js's own explicit disclaimer): there
 * is no real backend yet, so this can't actually verify a password
 * against anything. The password field is required (can't be submitted
 * empty) but its value is never checked — this is a Frontend-only
 * placeholder, not a security boundary, exactly like every other
 * "auth" moment in this project until the real Django API exists. What
 * this DOES do for real: creates a genuine vv_user session using
 * whatever username was typed, so the whole rest of the app (which
 * already reads vv_user everywhere) works correctly right after login —
 * name in the topbar, role-based visibility, etc.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  // Where to land right after logging in. There's no formal "home" page
  // in this project (VVRouter is explicitly a stub with no real routing —
  // see router.js) — Flights is the first item in the main nav and the
  // most natural default landing spot.
  const LANDING_PAGE = "/client/modules/operations/flights.html";

  function handleLoginSubmit(e) {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username) { alert("اكتب اسم المستخدم أو البريد الإلكتروني."); return; }
    if (!password) { alert("اكتب كلمة المرور."); return; }

    const user = {
      id: Date.now(),
      full_name: username,
      username: username, // needed so it_dashboard's per-employee module restrictions (employees.js) can actually match this session back to a vv_employees record
      email: username.includes("@") ? username : "",
      role: "employee", // default — anyone can switch roles afterward via the testing role-switcher already in the topbar (components.js), same as everywhere else in this project
      department: "—",
    };

    try {
      localStorage.setItem(VV_CONFIG.STORAGE_KEYS.USER, JSON.stringify(user));
    } catch (err) {
      alert("تعذّر حفظ الجلسة — تأكد إن التخزين المحلي (localStorage) مفعّل في المتصفح.");
      return;
    }

    window.location.href = LANDING_PAGE;
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("login-form")?.addEventListener("submit", handleLoginSubmit);
  });
})();