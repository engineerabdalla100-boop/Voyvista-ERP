/**
 * api_client.js -- the shared bridge every page uses to talk to the
 * backend.
 */

(function (global) {
  "use strict";

  function ApiError(message, status, data) {
    var err = new Error(message);
    err.name = "ApiError";
    err.status = status;
    err.data = data;
    return err;
  }

  function getToken() {
    return localStorage.getItem(VV_CONFIG.STORAGE_KEYS.TOKEN);
  }

  async function request(path, options) {
    options = options || {};
    var method = options.method || "GET";
    var body = options.body !== undefined ? options.body : null;
    var isFormData = options.isFormData || false;

    var headers = {};
    var token = getToken();
    if (token) headers["Authorization"] = "Token " + token;

    var requestBody = null;
    if (body !== null) {
      if (isFormData) {
        requestBody = body;
      } else {
        headers["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      }
    }

    var response;
    try {
      response = await fetch(VV_CONFIG.BASE_URL + path, {
        method: method,
        headers: headers,
        body: requestBody,
      });
    } catch (networkErr) {
      throw ApiError("\u062A\u0639\u0630\u0651\u0631 \u0627\u0644\u0627\u062A\u0635\u0627\u0644 \u0628\u0627\u0644\u0633\u064A\u0631\u0641\u0631. \u062A\u0623\u0643\u062F \u0645\u0646 \u0627\u062A\u0635\u0627\u0644\u0643 \u0628\u0627\u0644\u0625\u0646\u062A\u0631\u0646\u062A.", 0, null);
    }
 
    if (response.status === 204) {
      return { data: null, status: 204 };
    }

    var contentType = response.headers.get("content-type") || "";
    if (contentType.indexOf("application/json") === -1) {
      if (!response.ok) {
        throw ApiError("\u062D\u062F\u062B \u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639 \u0645\u0646 \u0627\u0644\u0633\u064A\u0631\u0641\u0631.", response.status, null);
      }
      return { data: await response.blob(), status: response.status };
    }

    var data = await response.json();

    if (response.status === 401) {
      localStorage.removeItem(VV_CONFIG.STORAGE_KEYS.TOKEN);
      localStorage.removeItem(VV_CONFIG.STORAGE_KEYS.USER);
      window.location.href = "/client/login.html";
      throw ApiError("\u0627\u0646\u062A\u0647\u062A \u0635\u0644\u0627\u062D\u064A\u0629 \u0627\u0644\u062C\u0644\u0633\u0629\u060C \u0628\u0631\u062C\u0627\u0621 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u062A\u0627\u0646\u064A.", 401, data);
    }

    if (!response.ok) {
      var message = (data && data.detail) ? data.detail : "\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0639\u0645\u0644\u064A\u0629.";
      throw ApiError(message, response.status, data);
    }

    return { data: data, status: response.status };
  }

  // Follows DRF's paginated "next" link until every page has been
  // collected, then returns the full combined list -- used anywhere a
  // screen must show every record (e.g. a year of sales), not just the
  // first page's worth.
  async function requestAllPages(path) {
    var allResults = [];
    var nextPath = path;
    var isFirst = true;

    while (nextPath) {
      var result = await request(nextPath);
      var data = result.data;

      if (!data || typeof data !== "object" || !("results" in data)) {
        return isFirst ? (Array.isArray(data) ? data : []) : allResults;
      }

      allResults = allResults.concat(data.results);
      nextPath = data.next ? data.next.replace(VV_CONFIG.BASE_URL, "") : null;
      isFirst = false;
    }

    return allResults;
  }

  global.VVApi = { request: request, requestAllPages: requestAllPages, ApiError: ApiError };
})(window);