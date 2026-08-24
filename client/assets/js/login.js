/**
 * Voyvista ERP - Login Script
 */

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const btnLogin = document.getElementById("btn-login");

  // Redirect Map based on User Role from Django
  const ROLE_REDIRECTS = {
    owner: "owner.html",
    it_manager: "it.html",
    it_admin: "it.html",
    accountant: "accounts.html",
    accounts: "accounts.html",
    sales: "sales.html",
    manager: "index.html",
  };

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.style.display = "none";
    btnLogin.disabled = true;
    btnLogin.textContent = "جاري التحقق...";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    try {
      // 1. Send Credentials to Django JWT Endpoint
      const response = await fetch(`${API_BASE_URL}/api/token/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "اسم المستخدم أو كلمة المرور غير صحيحة.");
      }

      // 2. Save Tokens and User Metadata
      localStorage.setItem("access_token", data.access);
      localStorage.setItem("refresh_token", data.refresh);
      localStorage.setItem("user_role", data.role || "employee");
      localStorage.setItem("user_name", data.name || username);

      // 3. Redirect to appropriate page
      const userRole = (data.role || "").toLowerCase();
      const redirectUrl = ROLE_REDIRECTS[userRole] || "index.html";
      
      window.location.href = redirectUrl;

    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = "تسجيل الدخول";
    }
  });
});