(function (global) {
  "use strict";

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .split(String.fromCharCode(39)).join("&#039;");
  }

  var nextCodeCache = null;
  async function fetchNextCode() {
    try {
      var result = await VVApi.request(VV_CONFIG.ENDPOINTS.PARTY_PEEK_NEXT_CODE);
      return result.data.next_code;
    } catch (err) {
      return "";
    }
  }

  async function showNextCode(prefix) {
    var display = document.getElementById(prefix + "-cc-code-display");
    if (!display) return;
    nextCodeCache = await fetchNextCode();
    display.textContent = nextCodeCache || "--";
  }

  var allPartiesCache = null;
  async function ensurePartiesLoaded() {
    if (allPartiesCache) return allPartiesCache;
    try {
      allPartiesCache = await VVApi.requestAllPages(VV_CONFIG.ENDPOINTS.PARTIES + "?type=customer");
    } catch (err) {
      allPartiesCache = [];
    }
    return allPartiesCache;
  }

  var activePrefix = null;
  var activeCategory = null;

  function openModal(id) { var el = document.getElementById(id); if (el) el.classList.add("is-open"); }
  function closeModal(id) { var el = document.getElementById(id); if (el) el.classList.remove("is-open"); }

  // Opens the customer-link modal filtered to one category (b2b or
  // b2c) -- the B2C/B2B buttons pass their own category through, so
  // the list only ever shows customers of that type.
  async function openLinkPicker(prefix, category) {
    activePrefix = prefix;
    activeCategory = category;
    var modal = document.getElementById("modal-cc-link");
    if (modal) modal.classList.add("is-open");
    var title = document.getElementById("cc-link-title");
    if (title) title.textContent = "Link with " + category.toUpperCase() + " Customer";
    var searchInput = document.getElementById("cc-link-search");
    if (searchInput) searchInput.value = "";

    var parties = await ensurePartiesLoaded();
    renderLinkList(parties.filter(function (p) { return p.client_category === category; }));
  }

  function renderLinkList(parties) {
    var list = document.getElementById("cc-link-list");
    if (!list) return;
    if (parties.length === 0) {
      list.innerHTML = "<p style='font-size:12px;color:var(--text-faint);padding:10px;'>No " + (activeCategory || "").toUpperCase() + " customers found yet.</p>";
      return;
    }
    list.innerHTML = parties.map(function (p) {
      return "<div class=\"cc-link-item\" data-party-id=\"" + p.id + "\" data-code=\"" + escapeHtml(p.code) + "\">" +
        "<span>" + escapeHtml(p.full_name) + "</span><span class=\"cc-link-item__code\">" + escapeHtml(p.code) + "</span>" +
      "</div>";
    }).join("");
    list.querySelectorAll("[data-party-id]").forEach(function (item) {
      item.addEventListener("click", function () {
        applyLink(activePrefix, item.dataset.partyId, item.dataset.code);
        closeModal("modal-cc-link");
      });
    });
  }

  function applyLink(prefix, partyId, code) {
    var resolved = document.getElementById(prefix + "-customer-code-resolved");
    var display = document.getElementById(prefix + "-cc-code-display");
    if (resolved) resolved.value = partyId;
    if (display) display.textContent = code + " (linked)";
  }

  function wireCustomerCodePicker(prefix) {
    showNextCode(prefix);
    document.querySelectorAll("[data-cc-link=\"" + prefix + "\"]").forEach(function (btn) {
      btn.addEventListener("click", function () { openLinkPicker(prefix, btn.dataset.ccCategory); });
    });
  }

  function collectCustomerCodePayload(prefix) {
    var resolved = document.getElementById(prefix + "-customer-code-resolved");
    return { customer: resolved && resolved.value ? resolved.value : null };
  }

  function resetCustomerCodeField(prefix) {
    var resolved = document.getElementById(prefix + "-customer-code-resolved");
    if (resolved) resolved.value = "";
    showNextCode(prefix);
  }

  function populateCustomerCodeField(prefix, record) {
    var resolved = document.getElementById(prefix + "-customer-code-resolved");
    var display = document.getElementById(prefix + "-cc-code-display");
    if (resolved) resolved.value = record.customer || "";
    if (display) display.textContent = record.customer ? "Linked customer" : (nextCodeCache || "--");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var searchInput = document.getElementById("cc-link-search");
    if (searchInput) {
      searchInput.addEventListener("input", async function () {
        var query = searchInput.value.trim().toLowerCase();
        var parties = await ensurePartiesLoaded();
        var filtered = parties.filter(function (p) { return p.client_category === activeCategory; });
        if (query) {
          filtered = filtered.filter(function (p) {
            return (p.full_name || "").toLowerCase().indexOf(query) !== -1 || (p.code || "").toLowerCase().indexOf(query) !== -1;
          });
        }
        renderLinkList(filtered);
      });
    }

    document.querySelectorAll("[data-close-modal=\"modal-cc-link\"]").forEach(function (btn) {
      btn.addEventListener("click", function () { closeModal("modal-cc-link"); });
    });
    var overlay = document.getElementById("modal-cc-link");
    if (overlay) {
      overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal("modal-cc-link"); });
    }
  });

  global.VVCustomerCode = {
    wirePicker: wireCustomerCodePicker,
    collectPayload: collectCustomerCodePayload,
    reset: resetCustomerCodeField,
    populate: populateCustomerCodeField,
  };
})(window);