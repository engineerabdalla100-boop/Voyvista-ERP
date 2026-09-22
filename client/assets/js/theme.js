/**
 * theme.js -- تطبيق فوري للـTheme المحفوظ (Dark/Light) قبل ما الصفحة
 * تترسم، عشان نتفادى "الوميض" اللحظي بالألوان الفاتحة قبل التحويل.
 * لازم يتحمّل في أول <head>، قبل ملف الـCSS الرئيسي.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  var PREFS_KEY = "vv_ui_preferences";

  function readPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || { darkMode: false, direction: "rtl" };
    } catch (e) {
      return { darkMode: false, direction: "rtl" };
    }
  }

  function applyTheme(prefs) {
    var root = document.documentElement;
    if (prefs.darkMode) {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    root.setAttribute("dir", prefs.direction === "ltr" ? "ltr" : "rtl");
  }

  applyTheme(readPrefs());

  window.VVTheme = {
    getPrefs: readPrefs,
    apply: applyTheme,
    save: function (prefs) {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      applyTheme(prefs);
    },
  };
})();