(function () {
  "use strict";

  var MODULE_TITLES = { b2b: "B2B - Company Accounts", b2c: "B2C - Individual & Family Accounts", accounting: "Accounting - Sales Report & Analysis" };
  var MODULE_RENDERERS = {};

  var expandedRoots = {};
  var filterExpiringPassports = false;
  var filterUpcomingBirthdays = false;
  var showAddForm = false;
  var editingPartyId = null;
  var allPartiesCache = [];
  var draftContactNumbers = [];
  var draftSocialLinks = [];

  var DATA_ACC_ROLES = ["ADMIN", "OWNER", "IT", "ACCOUNTANT"];

  function getCurrentUserRole() {
    try {
      var user = JSON.parse(localStorage.getItem(VV_CONFIG.STORAGE_KEYS.USER));
      return user && user.role ? user.role : null;
    } catch (e) {
      return null;
    }
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function parseLocalDate(s) {
    if (!s) return new Date(NaN);
    var parts = s.split("-").map(Number);
    return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
  }
  function isPassportExpiringSoon(expiry) {
    if (!expiry) return false;
    var daysLeft = (parseLocalDate(expiry).getTime() - parseLocalDate(todayISO()).getTime()) / 86400000;
    return daysLeft < 90;
  }
  function isBirthdayUpcoming(dob) {
    if (!dob) return false;
    var today = parseLocalDate(todayISO());
    var d = parseLocalDate(dob);
    var next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
    if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
    var daysUntil = (next.getTime() - today.getTime()) / 86400000;
    return daysUntil >= 0 && daysUntil <= 30;
  }
  function fmtMoney(n) {
    return (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .split(String.fromCharCode(39)).join("&#039;");
  }

  // =========================================================================
  // SPA switcher
  // =========================================================================

  function switchDataView(viewId) {
    var dashboard = document.getElementById("dashboard-main-view");
    var detail = document.getElementById("module-detail-view");
    dashboard.style.display = "none";
    detail.style.display = "block";
    detail.innerHTML =
      "<div class=\"module-toolbar\">" +
        "<h2 class=\"module-toolbar__title\">" + escapeHtml(MODULE_TITLES[viewId] || "") + "</h2>" +
        "<button class=\"module-back-btn\" id=\"btn-back-data-dashboard\" type=\"button\">" +
          "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" width=\"14\" height=\"14\"><path d=\"M19 12H5M12 19l-7-7 7-7\"/></svg> Back" +
        "</button>" +
      "</div>" +
      "<div id=\"module-body\"></div>";
    document.getElementById("btn-back-data-dashboard").addEventListener("click", backToDataDashboard);

    var renderer = MODULE_RENDERERS[viewId];
    if (typeof renderer === "function") renderer();
  }

  function backToDataDashboard() {
    document.getElementById("module-detail-view").style.display = "none";
    document.getElementById("module-detail-view").innerHTML = "";
    document.getElementById("dashboard-main-view").style.display = "block";
  }

  // =========================================================================
  // Family/company package
  // =========================================================================

  var CURRENCY_OPTIONS = ["EGP", "USD", "EUR", "SAR", "KWD", "GBP", "JPY", "CNY", "CAD"];

  async function loadParties(category) {
    try {
      allPartiesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.PARTIES + "?type=customer&client_category=" + category);
    } catch (err) {
      allPartiesCache = [];
    }
  }

  function renderFamilyPackage(category) {
    expandedRoots = {};
    filterExpiringPassports = false;
    filterUpcomingBirthdays = false;
    showAddForm = false;
    editingPartyId = null;

    var body = document.getElementById("module-body");
    body.innerHTML =
      "<div class=\"table-controls\">" +
        "<div style=\"display:flex; gap:10px; flex-wrap:wrap; align-items:center;\">" +
          "<div class=\"search-wrap\">" +
            "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M21 21l-4.3-4.3\"/></svg>" +
            "<input type=\"text\" id=\"fam-search\" placeholder=\"Search by name or code...\" />" +
          "</div>" +
          "<label class=\"filter-chip\"><input type=\"checkbox\" id=\"fam-filter-passport\" style=\"width:14px;height:14px;\" /> Passports expiring soon (under 3 months)</label>" +
          "<label class=\"filter-chip\"><input type=\"checkbox\" id=\"fam-filter-birthday\" style=\"width:14px;height:14px;\" /> Upcoming birthdays (30 days)</label>" +
        "</div>" +
        "<button class=\"btn btn--primary\" id=\"btn-toggle-add-fam\" type=\"button\">+ Add new " + (category === "b2b" ? "company" : "customer") + "</button>" +
      "</div>" +
      "<div id=\"add-fam-form-wrap\" style=\"display:none; margin-bottom:22px;\"></div>" +
      "<div class=\"ledger-scroll\">" +
        "<table class=\"acc-table\" id=\"fam-table\">" +
          "<thead><tr><th></th><th>Code</th><th>Name</th><th>Role</th><th>VIP</th><th>Phone</th><th>Passport</th><th>Expires</th><th>DOB</th><th>Actions</th></tr></thead>" +
          "<tbody id=\"fam-table-body\"></tbody>" +
        "</table>" +
      "</div>" +
      "<div class=\"empty-state\" id=\"fam-empty-state\" style=\"display:none;\"><p>No accounts yet</p></div>";

    document.getElementById("fam-search").addEventListener("input", function () { renderFamilyTable(category); });
    document.getElementById("fam-filter-passport").addEventListener("change", function (e) { filterExpiringPassports = e.target.checked; renderFamilyTable(category); });
    document.getElementById("fam-filter-birthday").addEventListener("change", function (e) { filterUpcomingBirthdays = e.target.checked; renderFamilyTable(category); });
    document.getElementById("btn-toggle-add-fam").addEventListener("click", function () { showAddForm = !showAddForm; editingPartyId = null; renderAddFamForm(category); });

    loadParties(category).then(function () { renderFamilyTable(category); });
  }

  function renderContactNumbersList() {
    var wrap = document.getElementById("company-contacts-list");
    if (!wrap) return;
    wrap.innerHTML = draftContactNumbers.map(function (c, i) {
      return "<div style=\"display:flex; gap:8px; margin-bottom:8px;\">" +
        "<input type=\"text\" data-contact-number=\"" + i + "\" placeholder=\"Phone number\" value=\"" + escapeHtml(c.number) + "\" style=\"flex:2; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:12px;\" />" +
        "<input type=\"text\" data-contact-label=\"" + i + "\" placeholder=\"Label (optional)\" value=\"" + escapeHtml(c.label) + "\" style=\"flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:12px;\" />" +
        "<button type=\"button\" data-remove-contact=\"" + i + "\" style=\"width:30px; border-radius:6px; border:1px solid #F2C4C4; background:#FBE2E2; color:#B02A2A; cursor:pointer;\">X</button>" +
      "</div>";
    }).join("");
    wrap.querySelectorAll("[data-contact-number]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftContactNumbers[+el.dataset.contactNumber].number = e.target.value; });
    });
    wrap.querySelectorAll("[data-contact-label]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftContactNumbers[+el.dataset.contactLabel].label = e.target.value; });
    });
    wrap.querySelectorAll("[data-remove-contact]").forEach(function (el) {
      el.addEventListener("click", function () { draftContactNumbers.splice(+el.dataset.removeContact, 1); renderContactNumbersList(); });
    });
  }
  function addContactNumber() { draftContactNumbers.push({ number: "", label: "" }); renderContactNumbersList(); }

  function renderSocialLinksList() {
    var wrap = document.getElementById("company-social-list");
    if (!wrap) return;
    wrap.innerHTML = draftSocialLinks.map(function (s, i) {
      return "<div style=\"display:flex; gap:8px; margin-bottom:8px;\">" +
        "<input type=\"text\" data-social-platform=\"" + i + "\" placeholder=\"Platform\" value=\"" + escapeHtml(s.platform) + "\" style=\"flex:1; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:12px;\" />" +
        "<input type=\"text\" data-social-handle=\"" + i + "\" placeholder=\"Link or @username\" value=\"" + escapeHtml(s.handle_or_url) + "\" style=\"flex:2; padding:8px 10px; border:1px solid var(--border); border-radius:6px; font-size:12px;\" />" +
        "<button type=\"button\" data-remove-social=\"" + i + "\" style=\"width:30px; border-radius:6px; border:1px solid #F2C4C4; background:#FBE2E2; color:#B02A2A; cursor:pointer;\">X</button>" +
      "</div>";
    }).join("");
    wrap.querySelectorAll("[data-social-platform]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftSocialLinks[+el.dataset.socialPlatform].platform = e.target.value; });
    });
    wrap.querySelectorAll("[data-social-handle]").forEach(function (el) {
      el.addEventListener("input", function (e) { draftSocialLinks[+el.dataset.socialHandle].handle_or_url = e.target.value; });
    });
    wrap.querySelectorAll("[data-remove-social]").forEach(function (el) {
      el.addEventListener("click", function () { draftSocialLinks.splice(+el.dataset.removeSocial, 1); renderSocialLinksList(); });
    });
  }
  function addSocialLink() { draftSocialLinks.push({ platform: "", handle_or_url: "" }); renderSocialLinksList(); }

  function renderAddFamForm(category, prefilledParentId) {
    var wrap = document.getElementById("add-fam-form-wrap");
    if (!showAddForm) { wrap.style.display = "none"; wrap.innerHTML = ""; return; }

    var roots = allPartiesCache.filter(function (p) { return !p.parent_party; });
    var editingParty = editingPartyId ? allPartiesCache.find(function (p) { return String(p.id) === String(editingPartyId); }) : null;
    var isRootCompanyForm = category === "b2b" && !prefilledParentId && (!editingParty || !editingParty.parent_party);

    wrap.style.display = "block";
    if (isRootCompanyForm) renderCompanyForm(editingParty);
    else renderPersonForm(category, prefilledParentId, editingParty, roots);
  }

  function renderCompanyForm(editingParty) {
    var wrap = document.getElementById("add-fam-form-wrap");
    wrap.innerHTML =
      "<div style=\"background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px;\">" +
        "<h3 style=\"font-family:var(--font-display); font-size:14px; font-weight:700; margin-bottom:14px;\">" + (editingParty ? "Edit company: " + escapeHtml(editingParty.full_name) : "New Company") + "</h3>" +
        "<div class=\"vv-field\"><label>Company Name *</label><input type=\"text\" id=\"company-name\" /></div>" +
        "<div class=\"vv-field\"><label>Industry / Field</label><input type=\"text\" id=\"company-industry\" placeholder=\"e.g. Travel Agency\" /></div>" +
        "<div class=\"vv-field\"><label>Address</label><input type=\"text\" id=\"company-address\" /></div>" +
        "<div class=\"vv-field\"><label>Company Email</label><input type=\"email\" id=\"company-email\" /></div>" +
        "<div class=\"vv-field\"><label>Contact Numbers</label><div id=\"company-contacts-list\"></div><button type=\"button\" class=\"btn btn--ghost\" id=\"btn-add-contact-number\" style=\"font-size:11.5px; padding:6px 12px;\">+ Add phone number</button></div>" +
        "<div class=\"vv-field\" style=\"margin-top:14px;\"><label>Social Media Accounts</label><div id=\"company-social-list\"></div><button type=\"button\" class=\"btn btn--ghost\" id=\"btn-add-social-link\" style=\"font-size:11.5px; padding:6px 12px;\">+ Add social account</button></div>" +
        "<div class=\"vv-field-row\" style=\"margin-top:14px;\">" +
          "<div class=\"vv-field\"><label>Currency</label><select id=\"company-currency\">" + CURRENCY_OPTIONS.map(function (c) { return "<option value=\"" + c + "\">" + c + "</option>"; }).join("") + "</select></div>" +
          "<div class=\"vv-field\"><label>Credit Limit</label><input type=\"number\" min=\"0\" step=\"0.01\" id=\"company-credit-limit\" value=\"0\" /></div>" +
        "</div>" +
        "<div class=\"vv-field\"><label>Opening Balance</label><input type=\"number\" step=\"0.01\" id=\"company-opening-balance\" value=\"0\" /></div>" +
        "<div style=\"display:flex; gap:10px;\">" +
          "<button class=\"btn btn--primary\" id=\"btn-save-company\" type=\"button\">" + (editingParty ? "Save changes" : "Save") + "</button>" +
          "<button class=\"btn btn--ghost\" id=\"btn-cancel-fam\" type=\"button\">Cancel</button>" +
        "</div>" +
      "</div>";

    if (editingParty) {
      document.getElementById("company-name").value = editingParty.full_name;
      document.getElementById("company-industry").value = editingParty.industry || "";
      document.getElementById("company-address").value = editingParty.address || "";
      document.getElementById("company-email").value = editingParty.email || "";
      document.getElementById("company-currency").value = editingParty.currency || "EGP";
      document.getElementById("company-credit-limit").value = editingParty.credit_limit || 0;
      document.getElementById("company-opening-balance").value = editingParty.opening_balance || 0;
      draftContactNumbers = (editingParty.contact_numbers || []).map(function (c) { return { number: c.number, label: c.label }; });
      draftSocialLinks = (editingParty.social_links || []).map(function (s) { return { platform: s.platform, handle_or_url: s.handle_or_url }; });
    } else {
      draftContactNumbers = [];
      draftSocialLinks = [];
    }
    renderContactNumbersList();
    renderSocialLinksList();

    document.getElementById("btn-add-contact-number").addEventListener("click", addContactNumber);
    document.getElementById("btn-add-social-link").addEventListener("click", addSocialLink);
    document.getElementById("btn-cancel-fam").addEventListener("click", function () { showAddForm = false; editingPartyId = null; renderAddFamForm("b2b"); });
    document.getElementById("btn-save-company").addEventListener("click", saveCompany);
  }

  async function saveCompany() {
    var name = document.getElementById("company-name").value.trim();
    if (!name) { alert("Company name is required."); return; }
    var creditLimit = Number(document.getElementById("company-credit-limit").value) || 0;
    if (creditLimit < 0) { alert("Credit limit cannot be negative."); return; }

    var payload = {
      type: "customer", client_category: "b2b", full_name: name,
      industry: document.getElementById("company-industry").value.trim(),
      address: document.getElementById("company-address").value.trim(),
      email: document.getElementById("company-email").value.trim(),
      currency: document.getElementById("company-currency").value,
      credit_limit: creditLimit,
      opening_balance: Number(document.getElementById("company-opening-balance").value) || 0,
      contact_numbers: draftContactNumbers.filter(function (c) { return c.number.trim(); }),
      social_links: draftSocialLinks.filter(function (s) { return s.platform.trim() && s.handle_or_url.trim(); }),
    };

    var btn = document.getElementById("btn-save-company");
    if (btn) btn.disabled = true;
    try {
      if (editingPartyId) {
        await VVApi.request(VV_CONFIG.ENDPOINTS.PARTY_DETAIL(editingPartyId), { method: "PATCH", body: payload });
      } else {
        await VVApi.request(VV_CONFIG.ENDPOINTS.PARTIES, { method: "POST", body: payload });
      }
      showAddForm = false; editingPartyId = null;
      await loadParties("b2b");
      renderAddFamForm("b2b");
      renderFamilyTable("b2b");
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderPersonForm(category, prefilledParentId, editingParty, roots) {
    var wrap = document.getElementById("add-fam-form-wrap");
    wrap.innerHTML =
      "<div style=\"background:var(--canvas); border:1px solid var(--border); border-radius:var(--radius-md); padding:18px;\">" +
        "<h3 style=\"font-family:var(--font-display); font-size:14px; font-weight:700; margin-bottom:14px;\">" + (editingParty ? "Edit \"" + escapeHtml(editingParty.full_name) + "\"" : "New " + (category === "b2b" ? "employee" : "customer") + " account") + "</h3>" +
        (!editingParty ? (
          "<div class=\"vv-field\">" +
            "<label>Parent account (optional)</label>" +
            "<select id=\"fam-parent\"><option value=\"\">-- None (standalone account) --</option>" +
            roots.map(function (r) { return "<option value=\"" + r.id + "\"" + (String(r.id) === String(prefilledParentId) ? " selected" : "") + ">" + escapeHtml(r.full_name) + "</option>"; }).join("") +
            "</select>" +
          "</div>" +
          "<div class=\"vv-field\" id=\"fam-relation-field\" style=\"display:" + (prefilledParentId ? "flex" : "none") + "; flex-direction:column;\">" +
            (category === "b2b"
              ? "<label>Job Title</label><input type=\"text\" id=\"fam-relation\" placeholder=\"e.g. Sales Manager\" />"
              : "<label>Relationship to parent</label><select id=\"fam-relation\"><option value=\"\">-- Select --</option><option value=\"Father\">Father</option><option value=\"Mother\">Mother</option><option value=\"Brother\">Brother</option><option value=\"Sister\">Sister</option><option value=\"Husband\">Husband</option><option value=\"Wife\">Wife</option><option value=\"Son\">Son</option><option value=\"Daughter\">Daughter</option><option value=\"Relative\">Relative</option></select>") +
          "</div>"
        ) : "") +
        "<div class=\"vv-field\"><label>Name</label><input type=\"text\" id=\"fam-name\" /></div>" +
        "<div class=\"vv-field-row\">" +
          "<div class=\"vv-field\"><label>Phone</label><input type=\"text\" id=\"fam-phone\" placeholder=\"01xxxxxxxxx\" /></div>" +
          "<div class=\"vv-field\"><label>Email</label><input type=\"email\" id=\"fam-email\" /></div>" +
        "</div>" +
        "<div class=\"vv-field\"><label>Address</label><input type=\"text\" id=\"fam-address\" /></div>" +
        "<div class=\"vv-field-row\">" +
          "<div class=\"vv-field\"><label>Passport Number</label><input type=\"text\" id=\"fam-passport\" /></div>" +
          "<div class=\"vv-field\"><label>Passport Expiry</label><input type=\"date\" id=\"fam-passport-expiry\" /></div>" +
        "</div>" +
        "<div class=\"vv-field-row\">" +
          "<div class=\"vv-field\"><label>Date of Birth</label><input type=\"date\" id=\"fam-dob\" /></div>" +
          "<div class=\"vv-field\"><label>National ID</label><input type=\"text\" id=\"fam-national-id\" /></div>" +
        "</div>" +
        (editingParty && editingParty.parent_party ? (
          "<div class=\"vv-field\"><label>" + (category === "b2b" ? "Job Title" : "Relationship") + "</label><input type=\"text\" id=\"fam-relation\" /></div>"
        ) : "") +
        "<div class=\"vv-field-row\">" +
          "<div class=\"vv-field\"><label>Currency</label><select id=\"fam-currency\">" + CURRENCY_OPTIONS.map(function (c) { return "<option value=\"" + c + "\">" + c + "</option>"; }).join("") + "</select></div>" +
          "<div class=\"vv-field\"><label>Credit Limit</label><input type=\"number\" min=\"0\" step=\"0.01\" id=\"fam-credit-limit\" value=\"0\" /></div>" +
        "</div>" +
        "<div class=\"vv-field\"><label>Opening Balance</label><input type=\"number\" step=\"0.01\" id=\"fam-opening-balance\" value=\"0\" /></div>" +
        "<div class=\"vv-field\"><label style=\"display:flex; align-items:center; gap:7px; cursor:pointer; width:fit-content;\"><input type=\"checkbox\" id=\"fam-vip\" style=\"width:16px;height:16px;\" /> VIP customer</label></div>" +
        "<div style=\"display:flex; gap:10px;\">" +
          "<button class=\"btn btn--primary\" id=\"btn-save-fam\" type=\"button\">" + (editingParty ? "Save changes" : "Save") + "</button>" +
          "<button class=\"btn btn--ghost\" id=\"btn-cancel-fam\" type=\"button\">Cancel</button>" +
        "</div>" +
      "</div>";

    if (editingParty) {
      document.getElementById("fam-name").value = editingParty.full_name;
      document.getElementById("fam-phone").value = editingParty.phone || "";
      document.getElementById("fam-email").value = editingParty.email || "";
      document.getElementById("fam-address").value = editingParty.address || "";
      document.getElementById("fam-passport").value = editingParty.passport_number || "";
      document.getElementById("fam-passport-expiry").value = editingParty.passport_expiry || "";
      document.getElementById("fam-dob").value = editingParty.date_of_birth || "";
      document.getElementById("fam-national-id").value = editingParty.national_id || "";
      document.getElementById("fam-currency").value = editingParty.currency || "EGP";
      document.getElementById("fam-credit-limit").value = editingParty.credit_limit || 0;
      document.getElementById("fam-opening-balance").value = editingParty.opening_balance || 0;
      document.getElementById("fam-vip").checked = !!editingParty.is_vip;
      var relationField = document.getElementById("fam-relation");
      if (relationField) relationField.value = (category === "b2b" ? editingParty.job_title : editingParty.relationship) || "";
    } else {
      document.getElementById("fam-opening-balance").value = "0";
    }

    var parentSelect = document.getElementById("fam-parent");
    if (parentSelect) {
      parentSelect.addEventListener("change", function () {
        document.getElementById("fam-relation-field").style.display = parentSelect.value ? "flex" : "none";
      });
    }
    document.getElementById("btn-cancel-fam").addEventListener("click", function () { showAddForm = false; editingPartyId = null; renderAddFamForm(category); });
    document.getElementById("btn-save-fam").addEventListener("click", function () { saveFamMember(category); });
  }

  async function saveFamMember(category) {
    var name = document.getElementById("fam-name").value.trim();
    if (!name) { alert("Name is required."); return; }
    var creditLimit = Number(document.getElementById("fam-credit-limit").value) || 0;
    if (creditLimit < 0) { alert("Credit limit cannot be negative."); return; }

    var payload = {
      type: "customer", client_category: category, full_name: name,
      phone: document.getElementById("fam-phone").value.trim(),
      email: document.getElementById("fam-email").value.trim(),
      address: document.getElementById("fam-address").value.trim(),
      passport_number: document.getElementById("fam-passport").value.trim(),
      passport_expiry: document.getElementById("fam-passport-expiry").value || null,
      date_of_birth: document.getElementById("fam-dob").value || null,
      national_id: document.getElementById("fam-national-id").value.trim(),
      currency: document.getElementById("fam-currency").value,
      credit_limit: creditLimit,
      is_vip: document.getElementById("fam-vip").checked,
    };

    var btn = document.getElementById("btn-save-fam");
    if (btn) btn.disabled = true;
    try {
      if (editingPartyId) {
        var relationFieldEdit = document.getElementById("fam-relation");
        if (relationFieldEdit) {
          if (category === "b2b") payload.job_title = relationFieldEdit.value.trim();
          else payload.relationship = relationFieldEdit.value;
        }
        payload.opening_balance = Number(document.getElementById("fam-opening-balance").value) || 0;
        await VVApi.request(VV_CONFIG.ENDPOINTS.PARTY_DETAIL(editingPartyId), { method: "PATCH", body: payload });
      } else {
        var parentId = document.getElementById("fam-parent") ? document.getElementById("fam-parent").value : "";
        if (parentId) payload.parent_party = parentId;
        var relationField = document.getElementById("fam-relation");
        if (relationField) {
          if (category === "b2b") payload.job_title = relationField.value.trim();
          else payload.relationship = relationField.value;
        }
        payload.opening_balance = Number(document.getElementById("fam-opening-balance").value) || 0;
        await VVApi.request(VV_CONFIG.ENDPOINTS.PARTIES, { method: "POST", body: payload });
      }
      showAddForm = false; editingPartyId = null;
      await loadParties(category);
      renderAddFamForm(category);
      renderFamilyTable(category);
    } catch (err) {
      alert(err.message || "Failed to save.");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderFamilyTable(category) {
    var query = (document.getElementById("fam-search").value || "").trim().toLowerCase();
    var parties = allPartiesCache.slice();
    if (query) {
      parties = parties.filter(function (p) { return p.full_name.toLowerCase().indexOf(query) !== -1 || (p.code || "").toLowerCase().indexOf(query) !== -1; });
    }
    var byId = {};
    parties.forEach(function (p) { byId[p.id] = p; });
    var childrenOf = function (parentId) { return parties.filter(function (p) { return p.parent_party === parentId; }); };
    var roots = parties.filter(function (p) { return !p.parent_party || !byId[p.parent_party]; });

    if (filterExpiringPassports || filterUpcomingBirthdays) {
      roots = roots.filter(function (root) {
        var family = [root].concat(childrenOf(root.id));
        return family.some(function (p) {
          return (filterExpiringPassports && isPassportExpiringSoon(p.passport_expiry)) || (filterUpcomingBirthdays && isBirthdayUpcoming(p.date_of_birth));
        });
      });
    }

    var tbody = document.getElementById("fam-table-body");
    var table = document.getElementById("fam-table");
    var empty = document.getElementById("fam-empty-state");
    if (roots.length === 0) { table.style.display = "none"; empty.style.display = "block"; return; }
    table.style.display = "table"; empty.style.display = "none";

    function renderPassportCell(p) {
      if (!p.passport_expiry) return "<td>" + escapeHtml(p.passport_number || "-") + "</td><td>-</td>";
      var soon = isPassportExpiringSoon(p.passport_expiry);
      return "<td>" + escapeHtml(p.passport_number || "-") + "</td><td style=\"color:" + (soon ? "var(--amber)" : "var(--text)") + "; font-weight:" + (soon ? "700" : "400") + ";\">" + (soon ? "[Soon] " : "") + escapeHtml(p.passport_expiry) + "</td>";
    }

    function renderRow(p, depth, isRoot, hasChildren, isExpanded) {
      var roleLabel = isRoot ? (category === "b2b" ? "Main Company" : "Main Account") : ((category === "b2b" ? p.job_title : p.relationship) || "-");
      var birthdaySoon = isBirthdayUpcoming(p.date_of_birth);
      return "<tr>" +
        "<td>" + (isRoot && hasChildren ? "<button class=\"row-action-btn\" data-toggle-fam=\"" + p.id + "\">" + (isExpanded ? "v" : ">") + "</button>" : "") + "</td>" +
        "<td style=\"font-size:11px; color:var(--text-faint);\">" + escapeHtml(p.code) + "</td>" +
        "<td class=\"cell-primary\" style=\"padding-inline-start:" + (depth * 20) + "px;\">" + (depth > 0 ? "&rarr; " : "") + escapeHtml(p.full_name) + "</td>" +
        "<td style=\"font-size:11.5px; color:var(--text-soft);\">" + escapeHtml(roleLabel) + "</td>" +
        "<td style=\"text-align:center;\">" + (p.is_vip ? "VIP" : "") + "</td>" +
        "<td>" + escapeHtml(p.phone || (p.contact_numbers && p.contact_numbers.length ? p.contact_numbers[0].number : "-")) + "</td>" +
        renderPassportCell(p) +
        "<td style=\"color:" + (birthdaySoon ? "var(--azure)" : "var(--text)") + ";\">" + escapeHtml(p.date_of_birth || "-") + (birthdaySoon ? " [Soon]" : "") + "</td>" +
        "<td><div class=\"row-actions\">" +
          "<button class=\"row-action-btn\" data-edit-fam=\"" + p.id + "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 20h9\"/><path d=\"M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg></button>" +
          (isRoot ? "<button class=\"row-action-btn\" data-add-sub-fam=\"" + p.id + "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M12 5v14M5 12h14\"/></svg></button>" : "") +
          "<button class=\"row-action-btn is-danger\" data-delete-fam=\"" + p.id + "\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M6 6l12 12M18 6L6 18\"/></svg></button>" +
        "</div></td></tr>";
    }

    tbody.innerHTML = roots.map(function (root) {
      var kids = childrenOf(root.id);
      var isExpanded = !!expandedRoots[root.id];
      var html = renderRow(root, 0, true, kids.length > 0, isExpanded);
      if (kids.length > 0 && isExpanded) kids.forEach(function (k) { html += renderRow(k, 1, false, false, false); });
      return html;
    }).join("");

    tbody.querySelectorAll("[data-toggle-fam]").forEach(function (btn) {
      btn.addEventListener("click", function () { var id = btn.dataset.toggleFam; expandedRoots[id] = !expandedRoots[id]; renderFamilyTable(category); });
    });
    tbody.querySelectorAll("[data-edit-fam]").forEach(function (btn) {
      btn.addEventListener("click", function () { editingPartyId = btn.dataset.editFam; showAddForm = true; renderAddFamForm(category); });
    });
    tbody.querySelectorAll("[data-add-sub-fam]").forEach(function (btn) {
      btn.addEventListener("click", function () { showAddForm = true; editingPartyId = null; renderAddFamForm(category, btn.dataset.addSubFam); });
    });
    tbody.querySelectorAll("[data-delete-fam]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteFamMember(btn.dataset.deleteFam, category); });
    });
  }

  async function deleteFamMember(id, category) {
    var party = allPartiesCache.find(function (p) { return String(p.id) === String(id); });
    if (!party) return;
    var hasChildren = allPartiesCache.some(function (p) { return String(p.parent_party) === String(id); });
    if (hasChildren) { alert("Cannot delete \"" + party.full_name + "\" - it has sub-members attached."); return; }
    if (!confirm("Delete \"" + party.full_name + "\" permanently?")) return;
    try {
      await VVApi.request(VV_CONFIG.ENDPOINTS.PARTY_DETAIL(id), { method: "DELETE" });
      await loadParties(category);
      renderFamilyTable(category);
    } catch (err) {
      alert(err.message || "Failed to delete.");
    }
  }

  MODULE_RENDERERS.b2b = function () { renderFamilyPackage("b2b"); };
  MODULE_RENDERERS.b2c = function () { renderFamilyPackage("b2c"); };

  // =========================================================================
  // Accounting package -- SIMPLIFIED: no review workflow at all. Every
  // confirmed booking in a department shows up in that department's
  // supplier chart/table immediately. Each card has ONE eye button
  // (not per-supplier) that opens the FULL detailed sales report for
  // every booking in that department.
  // =========================================================================

  var DEPARTMENTS = [
    { key: "flight", label: "Flights" },
    { key: "hotel", label: "Hotels" },
    { key: "visa", label: "Visas" },
  ];

  var SUPPLIER_PALETTE = ["#1F9D6E", "#E8B93A", "#D9534F", "#3068E0", "#8E44AD", "#E8791A", "#2E86AB"];
  var supplierColorMap = {};

  function colorForSupplier(supplier) {
    if (!supplierColorMap[supplier]) {
      var idx = Object.keys(supplierColorMap).length % SUPPLIER_PALETTE.length;
      supplierColorMap[supplier] = SUPPLIER_PALETTE[idx];
    }
    return supplierColorMap[supplier];
  }

  var bookingsByDept = { flight: [], hotel: [], visa: [] };
  var chartInstances = { flight: null, hotel: null, visa: null };

  async function loadDeptBookings(deptKey) {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.BOOKINGS + "sales-report/?department=" + deptKey);
      bookingsByDept[deptKey] = result.data || [];
    } catch (err) {
      bookingsByDept[deptKey] = [];
      if (err.status === 403) alert("Access denied - only IT, Owner, ACC, and Admin can view the sales report.");
    }
  }

  function groupBySupplier(rows) {
    var groups = {};
    rows.forEach(function (r) {
      var currency = r.currency || "EGP";
      var key = r.supplier + "||" + currency;
      if (!groups[key]) groups[key] = { supplier: r.supplier || "Unspecified", currency: currency, net: 0, profit: 0, count: 0 };
      groups[key].net = Math.round((groups[key].net + Number(r.net_rate)) * 100) / 100;
      groups[key].profit = Math.round((groups[key].profit + Number(r.profit)) * 100) / 100;
      groups[key].count += 1;
    });
    return Object.values(groups).sort(function (a, b) { return b.net - a.net; });
  }

  function renderAccountingPackage() {
    var body = document.getElementById("module-body");
    body.innerHTML = DEPARTMENTS.map(function (dept) {
      return "<div class=\"dept-analysis-card\" id=\"dept-card-" + dept.key + "\">" +
        "<div class=\"dept-analysis-card__header\">" +
          "<div class=\"dept-analysis-card__title\">" + dept.label + "</div>" +
          "<button class=\"btn btn--ghost\" data-view-full-report=\"" + dept.key + "\" style=\"font-size:12px; display:flex; align-items:center; gap:6px;\">" +
            "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" width=\"14\" height=\"14\"><path d=\"M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg> View Full Sales Report" +
          "</button>" +
        "</div>" +
        "<div class=\"dept-analysis-card__chart-wrap\"><canvas id=\"chart-" + dept.key + "\"></canvas></div>" +
        "<div class=\"ledger-scroll\"><table class=\"acc-table\">" +
          "<thead><tr><th>Supplier</th><th>Currency</th><th class=\"num\">Net Total</th><th class=\"num\">Profit Total</th><th class=\"num\">Bookings</th></tr></thead>" +
          "<tbody id=\"dept-table-body-" + dept.key + "\"></tbody>" +
        "</table></div>" +
        "<div class=\"empty-state\" id=\"dept-empty-" + dept.key + "\" style=\"display:none;\"><p>No confirmed bookings yet for this department</p></div>" +
      "</div>";
    }).join("");

    document.querySelectorAll("[data-view-full-report]").forEach(function (btn) {
      btn.addEventListener("click", function () { openFullReportModal(btn.dataset.viewFullReport); });
    });

    DEPARTMENTS.forEach(function (dept) {
      loadDeptBookings(dept.key).then(function () {
        renderDeptTable(dept.key);
        renderDeptChart(dept.key);
      });
    });
  }

  function renderDeptTable(deptKey) {
    var groups = groupBySupplier(bookingsByDept[deptKey]);
    var tbody = document.getElementById("dept-table-body-" + deptKey);
    var empty = document.getElementById("dept-empty-" + deptKey);
    if (groups.length === 0) { empty.style.display = "block"; tbody.innerHTML = ""; return; }
    empty.style.display = "none";

    tbody.innerHTML = groups.map(function (g) {
      return "<tr>" +
        "<td class=\"cell-primary\">" + escapeHtml(g.supplier) + "</td>" +
        "<td>" + escapeHtml(g.currency) + "</td>" +
        "<td class=\"num\">" + fmtMoney(g.net) + "</td>" +
        "<td class=\"num amount-in\">" + fmtMoney(g.profit) + "</td>" +
        "<td class=\"num\">" + g.count + "</td>" +
      "</tr>";
    }).join("");
  }

  function renderDeptChart(deptKey) {
    var canvas = document.getElementById("chart-" + deptKey);
    var groups = groupBySupplier(bookingsByDept[deptKey]);

    if (chartInstances[deptKey]) { chartInstances[deptKey].destroy(); chartInstances[deptKey] = null; }
    if (typeof Chart === "undefined" || groups.length === 0) return;

    var labels = groups.map(function (g) { return g.supplier; });
    var data = groups.map(function (g) { return g.net; });
    var colors = groups.map(function (g) { return colorForSupplier(g.supplier); });

    var plugins = [];
    if (typeof ChartDataLabels !== "undefined") plugins.push(ChartDataLabels);

    chartInstances[deptKey] = new Chart(canvas, {
      type: "bar",
      data: { labels: labels, datasets: [{ label: "Net Volume", data: data, backgroundColor: colors }] },
      plugins: plugins,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 24 } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: function (v) { if (v >= 1000000) return (v / 1000000) + "M"; if (v >= 1000) return (v / 1000) + "K"; return v; } } },
          x: { ticks: { display: false } },
        },
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end",
            align: "top",
            color: "#1a1a1a",
            font: { weight: "bold", size: 11 },
            formatter: function (value, ctx) { return ctx.chart.data.labels[ctx.dataIndex]; },
            clip: false,
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return "Net: " + Number(ctx.parsed.y).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              },
            },
          },
        },
      },
    });
  }

  function openFullReportModal(deptKey) {
    var rows = bookingsByDept[deptKey].slice().sort(function (a, b) { return parseLocalDate(b.date) - parseLocalDate(a.date); });
    var deptLabel = (DEPARTMENTS.find(function (d) { return d.key === deptKey; }) || {}).label;
    document.getElementById("supplier-detail-title").textContent = deptLabel + " - Full Sales Report";

    var body = document.getElementById("supplier-detail-body");
    if (rows.length === 0) {
      body.innerHTML = "<p style=\"font-size:12.5px; color:var(--text-faint);\">No bookings found.</p>";
    } else {
      body.innerHTML =
        "<div class=\"ledger-scroll\"><table class=\"acc-table\">" +
          "<thead><tr><th>Date</th><th>Customer</th><th>Supplier</th><th class=\"num\">Net</th><th class=\"num\">Selling</th><th class=\"num\">Profit</th></tr></thead>" +
          "<tbody>" + rows.map(function (r) {
            return "<tr>" +
              "<td>" + escapeHtml(r.date || "-") + "</td>" +
              "<td class=\"cell-primary\">" + escapeHtml(r.passenger_name) + "</td>" +
              "<td>" + escapeHtml(r.supplier || "-") + "</td>" +
              "<td class=\"num\">" + fmtMoney(r.net_rate) + " " + escapeHtml(r.currency) + "</td>" +
              "<td class=\"num\">" + fmtMoney(r.selling_rate) + " " + escapeHtml(r.currency) + "</td>" +
              "<td class=\"num amount-in\">" + fmtMoney(r.profit) + " " + escapeHtml(r.currency) + "</td>" +
            "</tr>";
          }).join("") + "</tbody>" +
        "</table></div>";
    }
    document.getElementById("modal-supplier-detail").classList.add("is-open");
  }

  MODULE_RENDERERS.accounting = renderAccountingPackage;

  // =========================================================================
  // Init
  // =========================================================================

  document.addEventListener("DOMContentLoaded", function () {
    var role = getCurrentUserRole();
    var accBtn = document.getElementById("pkg-accounting");
    if (accBtn && role && DATA_ACC_ROLES.indexOf(role) !== -1) {
      accBtn.style.display = "";
    }

    document.getElementById("pkg-b2b").addEventListener("click", function () { switchDataView("b2b"); });
    document.getElementById("pkg-b2c").addEventListener("click", function () { switchDataView("b2c"); });
    if (accBtn) accBtn.addEventListener("click", function () { switchDataView("accounting"); });

    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () { document.getElementById(btn.dataset.closeModal).classList.remove("is-open"); });
    });
    document.querySelectorAll(".vv-modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("is-open"); });
    });
  });
})();
