function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}

function inferApiFromWindowLocation() {
  if (typeof window === "undefined") return "";
  const { protocol, hostname } = window.location;
  if (!hostname) return "";

  if (isLoopbackHost(hostname)) {
    return `${protocol}//${hostname}:3000`;
  }

  const candidates = [
    hostname.replace("admin.", "api."),
    hostname.replace("-admin.", "-api."),
    hostname.replace("admin-", "api-"),
  ];
  const apiHost = candidates.find((value) => value && value !== hostname) || "";
  return apiHost ? `${protocol}//${apiHost}` : "";
}

function resolveApiBaseUrl() {
  const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (!isLoopbackHost(parsed.hostname)) return configured;
      const inferred = inferApiFromWindowLocation();
      if (inferred && !isLoopbackHost(new URL(inferred).hostname)) return inferred;
      return configured;
    } catch (_error) {
      return configured;
    }
  }
  return inferApiFromWindowLocation() || "http://localhost:3000";
}

const API_BASE_URL = resolveApiBaseUrl();
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || "";

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (ADMIN_TOKEN) headers["X-RADIANT-ADMIN-TOKEN"] = ADMIN_TOKEN;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const bodyText = await response.text();
  let data = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch (_error) {
      data = { message: bodyText.slice(0, 200) };
    }
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export const apiAdapter = {
  getAdminShows() {
    return request("/v1/admin/shows", { method: "GET" });
  },
  getAdminShowInsights(showId) {
    return request(`/v1/admin/shows/${showId}/insights`, { method: "GET" });
  },
  getAdminDjs() {
    return request("/v1/admin/djs", { method: "GET" });
  },
  createAdminDj(payload) {
    return request("/v1/admin/djs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateAdminDj(djId, payload) {
    return request(`/v1/admin/djs/${djId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  attachDjToShow(showId, payload) {
    return request(`/v1/admin/shows/${showId}/djs`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  detachDjFromShow(showId, djId) {
    return request(`/v1/admin/shows/${showId}/djs/${djId}`, {
      method: "DELETE",
    });
  },
  updateAdminShow(showId, payload) {
    return request(`/v1/admin/shows/${showId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  getAdminScheduleSlots() {
    return request("/v1/admin/schedule/slots", { method: "GET" });
  },
  createAlternatingOverrides(payload) {
    return request("/v1/admin/schedule/alternating", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getReportTypes() {
    return request("/v1/admin/reports/types", { method: "GET" });
  },
  generateReport(payload) {
    return request("/v1/admin/reports/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getAdminIcecastSettings() {
    return request("/v1/admin/settings/icecast", { method: "GET" });
  },
  updateAdminIcecastSettings(payload) {
    return request("/v1/admin/settings/icecast", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  testAdminIcecastSettings() {
    return request("/v1/admin/settings/icecast/test", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  createScheduleSlot(payload) {
    return request("/v1/admin/schedule/slots", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateScheduleSlot(id, payload) {
    return request(`/v1/admin/schedule/slots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  deleteScheduleSlot(id) {
    return request(`/v1/admin/schedule/slots/${id}`, {
      method: "DELETE",
    });
  },
};
