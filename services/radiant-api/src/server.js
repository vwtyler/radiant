const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const pathModule = require("node:path");
const { URL } = require("node:url");

const port = Number(process.env.PORT || 3000);
const apiVersion = process.env.API_VERSION || "v1";
const startedAt = new Date().toISOString();
const defaultTimezone = process.env.TZ || "America/Los_Angeles";
const directusBaseUrl = process.env.DIRECTUS_URL || "http://directus:8055";
const directusEmail = process.env.DIRECTUS_ADMIN_EMAIL || "";
const directusPassword = process.env.DIRECTUS_ADMIN_PASSWORD || "";
const allowedOrigins = new Set(
  String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 120);
const rateBuckets = new Map();
const nowPlayingConfidenceMin = Number(process.env.NOW_PLAYING_CONFIDENCE_MIN || 0.8);
const nowPlayingFreshSeconds = Number(process.env.NOW_PLAYING_FRESH_SECONDS || 30);
const acrCallbackSecret = process.env.ACRCLOUD_CALLBACK_SECRET || "";
const acrCallbackToken = process.env.ACRCLOUD_CALLBACK_TOKEN || "";
const acrDedupeSeconds = Number(process.env.ACRCLOUD_DEDUPE_SECONDS || 120);
const acrExpectedProjectId = String(process.env.ACRCLOUD_EXPECTED_PROJECT_ID || "").trim();
const radiantAdminToken = process.env.RADIANT_ADMIN_TOKEN || "";
const radiantAdminTitleDefault = String(process.env.RADIANT_ADMIN_TITLE || "KAAD-lp Admin").trim() || "KAAD-lp Admin";
const radiantPublicStatusTitleDefault =
  String(process.env.RADIANT_PUBLIC_STATUS_TITLE || "Public Status").trim() || "Public Status";
const icecastConfigPath = process.env.ICECAST_META_CONFIG_PATH || "/app/data/icecast-meta-config.json";
const icecastListenerHistoryPath = process.env.ICECAST_LISTENER_HISTORY_PATH || "/app/data/icecast-listener-history.json";
const icecastGeoCachePath = process.env.ICECAST_GEO_CACHE_PATH || "/app/data/icecast-geo-cache.json";
const icecastGeoCacheSuccessTtlMs = Number(process.env.ICECAST_GEO_CACHE_SUCCESS_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const icecastGeoCacheFailureTtlMs = Number(process.env.ICECAST_GEO_CACHE_FAILURE_TTL_MS || 5 * 60 * 1000);
const icecastSnapshotCacheMs = Number(process.env.ICECAST_SNAPSHOT_CACHE_MS || 20000);

function parseBooleanEnv(value, fallback = false) {
  const text = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

const icecastDefaults = {
  admin_title: radiantAdminTitleDefault,
  public_status_title: radiantPublicStatusTitleDefault,
  enabled: parseBooleanEnv(process.env.ICECAST_META_ENABLED, false),
  scheme: String(process.env.ICECAST_META_SCHEME || "http").trim().toLowerCase() === "https" ? "https" : "http",
  host: String(process.env.ICECAST_META_HOST || "").trim(),
  port: Number(process.env.ICECAST_META_PORT || 8000) || 8000,
  mount: String(process.env.ICECAST_META_MOUNT || "stream").trim(),
  username: String(process.env.ICECAST_META_USERNAME || "source").trim() || "source",
  password: String(process.env.ICECAST_META_PASSWORD || ""),
};

let directusToken = null;
let icecastConfigCache = null;
let listenerHistoryCache = null;
let geoCache = null;
let icecastCollectorStarted = false;
let icecastCollectorBusy = false;
let latestIcecastSnapshot = null;
let latestIcecastSnapshotAtMs = 0;
let icecastSnapshotInFlight = null;

const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function normalizeWeekday(weekday) {
  const num = Number(weekday);
  return Number.isFinite(num) && num >= 1 && num <= 7 ? num : null;
}

function parseClockToMinutes(input) {
  if (!input || typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  const twentyFour = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const minute = Number(twentyFour[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }
  const match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3];
  if (hour === 12) hour = 0;
  if (meridiem === "pm") hour += 12;
  return hour * 60 + minute;
}

function formatMinutesToTime(minutes) {
  const safe = clampNumber(Math.round(minutes), 0, 24 * 60);
  const hour = String(Math.floor(safe / 60) % 24).padStart(2, "0");
  const minute = String(safe % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toDateOnlyString(parts) {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getZonedParts(date, timezone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = dtf.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    weekday: weekdayMap[values.weekday] || null,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

function shiftDate(dateString, days) {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const year = String(dt.getUTCFullYear());
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveWeekStart(input, timezone, nowDate) {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  const nowParts = getZonedParts(nowDate, timezone);
  const today = toDateOnlyString(nowParts);
  const dayOffset = (nowParts.weekday || 1) - 1;
  return shiftDate(today, -dayOffset);
}

function safeShowSummary(show) {
  if (!show) return null;
  return {
    id: show.id,
    slug: show.slug,
    title: show.title,
    description: show.description || null,
    artwork_url: show.artwork_url || null,
    show_type: show.show_type || null,
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function pickFirstText(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function parseServiceTitleArtist(source) {
  if (!source || typeof source !== "object") return null;

  const title = pickFirstText([
    source.title,
    source.name,
    source.track_title,
    source.song,
    source.song_title,
    source.track_name,
    source.video_title,
    source.display_name,
    source?.track?.name,
    source?.track?.title,
    source?.music?.title,
    source?.music?.name,
  ]);

  const artist = pickFirstText([
    source.artist,
    source.artist_name,
    source.performer,
    source.singer,
    source?.track?.artist,
    source?.track?.artist_name,
    source?.music?.artist,
    source?.music?.artist_name,
    Array.isArray(source.artists) ? source.artists.map((item) => item?.name || item).filter(Boolean).join(", ") : "",
    Array.isArray(source?.track?.artists)
      ? source.track.artists.map((item) => item?.name || item).filter(Boolean).join(", ")
      : "",
  ]);

  if (!title || !artist) return null;
  return { title, artist };
}

function resolveTrackFromExternalConsensus(topMatch) {
  const external = topMatch?.external_metadata;
  if (!external || typeof external !== "object") {
    return null;
  }

  const candidates = [];
  const serviceKeys = ["aha_music", "spotify", "youtube", "deezer"];
  for (const key of serviceKeys) {
    const parsed = parseServiceTitleArtist(external[key]);
    if (!parsed) continue;
    candidates.push({
      service: key,
      title: parsed.title,
      artist: parsed.artist,
      key: `${normalizeText(parsed.artist)}::${normalizeText(parsed.title)}`,
    });
  }

  if (candidates.length < 2) return null;

  const counts = new Map();
  for (const item of candidates) {
    const current = counts.get(item.key) || { count: 0, item };
    current.count += 1;
    counts.set(item.key, current);
  }

  const winner = [...counts.values()].sort((a, b) => b.count - a.count)[0] || null;
  if (!winner || winner.count < 2) return null;

  return {
    artist: winner.item.artist,
    title: winner.item.title,
    agreed_services: candidates.filter((row) => row.key === winner.item.key).map((row) => row.service),
  };
}

function toIsoUtc(timestampUtc) {
  if (!timestampUtc || typeof timestampUtc !== "string") return null;
  const trimmed = timestampUtc.trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const dt = new Date(candidate);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function normalizeDisplayText(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const lowered = text.toLowerCase();
  if (lowered === "0" || lowered === "null") return "";
  return text;
}

function toIsoDateTime(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  return toIsoUtc(text);
}

function normalizeIcecastMount(value) {
  const trimmed = String(value || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\?.*$/, "");
  return trimmed || "stream";
}

function normalizeIcecastConfig(input = {}, existing = icecastDefaults) {
  const merged = {
    admin_title: input.admin_title == null ? existing.admin_title : String(input.admin_title),
    public_status_title: input.public_status_title == null ? existing.public_status_title : String(input.public_status_title),
    enabled: input.enabled == null ? existing.enabled : Boolean(input.enabled),
    scheme: input.scheme == null ? existing.scheme : String(input.scheme).trim().toLowerCase(),
    host: input.host == null ? existing.host : String(input.host).trim(),
    port: input.port == null || input.port === "" ? existing.port : Number(input.port),
    mount: input.mount == null ? existing.mount : String(input.mount),
    username: input.username == null ? existing.username : String(input.username).trim(),
    password: input.password == null ? existing.password : String(input.password),
  };

  return {
    admin_title: String(merged.admin_title || "").trim() || "KAAD-lp Admin",
    public_status_title: String(merged.public_status_title || "").trim() || "Public Status",
    enabled: Boolean(merged.enabled),
    scheme: merged.scheme === "https" ? "https" : "http",
    host: merged.host,
    port: Number.isInteger(Number(merged.port)) ? clampNumber(Number(merged.port), 1, 65535) : 8000,
    mount: normalizeIcecastMount(merged.mount),
    username: merged.username || "source",
    password: merged.password,
  };
}

function sanitizeIcecastConfigForClient(config) {
  return {
    admin_title: String(config.admin_title || "").trim() || "KAAD-lp Admin",
    public_status_title: String(config.public_status_title || "").trim() || "Public Status",
    enabled: Boolean(config.enabled),
    scheme: config.scheme,
    host: config.host,
    port: Number(config.port),
    mount: normalizeIcecastMount(config.mount),
    username: config.username,
    password: "",
    password_set: Boolean(String(config.password || "").trim()),
  };
}

async function loadIcecastConfig() {
  if (icecastConfigCache) return icecastConfigCache;
  try {
    const text = await fs.readFile(icecastConfigPath, "utf-8");
    const parsed = JSON.parse(text);
    icecastConfigCache = normalizeIcecastConfig(parsed, icecastDefaults);
    return icecastConfigCache;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Failed to read Icecast config: ${error.message || String(error)}`);
    }
    icecastConfigCache = normalizeIcecastConfig(icecastDefaults, icecastDefaults);
    return icecastConfigCache;
  }
}

async function writeIcecastConfig(nextConfig) {
  const normalized = normalizeIcecastConfig(nextConfig, icecastDefaults);
  const dir = pathModule.dirname(icecastConfigPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(icecastConfigPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  icecastConfigCache = normalized;
  return normalized;
}

function sanitizeStatsIp(ip) {
  return String(ip || "").trim();
}

function isPrivateOrLocalIp(ip) {
  const text = sanitizeStatsIp(ip);
  if (!text) return true;
  if (text === "127.0.0.1" || text === "::1" || text === "localhost") return true;
  if (text.startsWith("10.")) return true;
  if (text.startsWith("192.168.")) return true;
  if (text.startsWith("169.254.")) return true;
  if (text.startsWith("172.")) {
    const second = Number(text.split(".")[1] || "0");
    if (second >= 16 && second <= 31) return true;
  }
  if (text.startsWith("fc") || text.startsWith("fd") || text.startsWith("fe80:")) return true;
  return false;
}

async function loadListenerHistory() {
  if (listenerHistoryCache) return listenerHistoryCache;
  try {
    const text = await fs.readFile(icecastListenerHistoryPath, "utf-8");
    const parsed = JSON.parse(text);
    listenerHistoryCache = Array.isArray(parsed?.items) ? parsed.items : [];
    return listenerHistoryCache;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Failed to read listener history: ${error.message || String(error)}`);
    }
    listenerHistoryCache = [];
    return listenerHistoryCache;
  }
}

async function saveListenerHistory(nextItems) {
  const items = Array.isArray(nextItems) ? nextItems : [];
  const dir = pathModule.dirname(icecastListenerHistoryPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    icecastListenerHistoryPath,
    `${JSON.stringify({ updated_at: new Date().toISOString(), items }, null, 2)}\n`,
    {
      encoding: "utf-8",
      mode: 0o600,
    },
  );
  listenerHistoryCache = items;
  return items;
}

async function loadGeoCache() {
  if (geoCache) return geoCache;
  try {
    const text = await fs.readFile(icecastGeoCachePath, "utf-8");
    const parsed = JSON.parse(text);
    geoCache = parsed && typeof parsed === "object" ? parsed : {};
    return geoCache;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`Failed to read geo cache: ${error.message || String(error)}`);
    }
    geoCache = {};
    return geoCache;
  }
}

async function saveGeoCache(nextCache) {
  const payload = nextCache && typeof nextCache === "object" ? nextCache : {};
  const dir = pathModule.dirname(icecastGeoCachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(icecastGeoCachePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  geoCache = payload;
  return geoCache;
}

async function fetchIcecastJsonStats(config) {
  const endpoint = new URL(`${config.scheme}://${config.host}:${config.port}/status-json.xsl`);
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "radiant-api/icecast-stats",
    },
  });
  if (!response.ok) {
    throw new Error(`Icecast stats request failed (${response.status})`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("Icecast stats response invalid");
  }
  return payload;
}

function extractMountsFromStats(statsPayload, fallbackMount) {
  const raw = statsPayload?.icestats?.source;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const mounts = list
    .map((item) => String(item?.listenurl || item?.server_name || item?.mount || ""))
    .map((value) => {
      if (!value) return "";
      if (value.startsWith("/")) return value;
      try {
        const u = new URL(value);
        return u.pathname || "";
      } catch (_error) {
        return "";
      }
    })
    .filter(Boolean);
  if (!mounts.length) return [`/${normalizeIcecastMount(fallbackMount)}`];
  return [...new Set(mounts)];
}

async function fetchIcecastMountClients(config, mount) {
  const endpoint = new URL(`${config.scheme}://${config.host}:${config.port}/admin/listclients`);
  endpoint.searchParams.set("mount", mount);
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: "application/xml,text/xml,*/*",
      "User-Agent": "radiant-api/icecast-stats",
    },
  });
  if (!response.ok) {
    return [];
  }
  const xml = await response.text();
  const listeners = [];
  const blocks = xml.match(/<listener\b[\s\S]*?<\/listener>/gi) || [];
  for (const block of blocks) {
    const ipMatch = block.match(/<IP>([^<]+)<\/IP>/i);
    const uaMatch = block.match(/<UserAgent>([^<]+)<\/UserAgent>/i);
    const connectedMatch = block.match(/<Connected>([^<]+)<\/Connected>/i);
    const ip = sanitizeStatsIp(ipMatch?.[1] || "");
    if (!ip || isPrivateOrLocalIp(ip)) continue;
    listeners.push({
      ip,
      user_agent: uaMatch?.[1] ? String(uaMatch[1]).trim() : "",
      connected_seconds: connectedMatch?.[1] ? Number(connectedMatch[1]) || 0 : 0,
      mount,
    });
  }
  return listeners;
}

async function fetchGeoFromIpwho(ip) {
  const endpoint = new URL(`https://ipwho.is/${encodeURIComponent(ip)}`);
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "radiant-api/icecast-geo",
    },
  });
  if (!response.ok) throw new Error(`ipwho_status_${response.status}`);
  const payload = await response.json();
  if (!payload || payload.success === false) return null;

  const lat = Number(payload.latitude);
  const lon = Number(payload.longitude);
  return {
    country: payload.country || null,
    country_code: payload.country_code || null,
    region: payload.region || null,
    city: payload.city || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    provider: "ipwho.is",
    updated_at: new Date().toISOString(),
  };
}

async function fetchGeoFromIpApi(ip) {
  const endpoint = new URL(`http://ip-api.com/json/${encodeURIComponent(ip)}`);
  endpoint.searchParams.set("fields", "status,message,country,countryCode,regionName,city,lat,lon");
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "radiant-api/icecast-geo",
    },
  });
  if (!response.ok) throw new Error(`ipapi_status_${response.status}`);
  const payload = await response.json();
  if (!payload || payload.status !== "success") return null;

  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  return {
    country: payload.country || null,
    country_code: payload.countryCode || null,
    region: payload.regionName || null,
    city: payload.city || null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    provider: "ip-api.com",
    updated_at: new Date().toISOString(),
  };
}

async function lookupGeoForIp(ip) {
  const clean = sanitizeStatsIp(ip);
  if (!clean || isPrivateOrLocalIp(clean)) return null;
  const cache = await loadGeoCache();
  const cached = cache[clean];
  if (cached) {
    const cachedAt = new Date(cached.updated_at || "").getTime();
    const ageMs = Number.isFinite(cachedAt) ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
    const ttlMs = cached.failed ? icecastGeoCacheFailureTtlMs : icecastGeoCacheSuccessTtlMs;
    if (ageMs >= 0 && ageMs < ttlMs) {
      return cached;
    }
  }

  const providers = [fetchGeoFromIpwho, fetchGeoFromIpApi];
  for (const provider of providers) {
    try {
      const resolved = await provider(clean);
      if (!resolved) continue;
      cache[clean] = resolved;
      await saveGeoCache(cache);
      return resolved;
    } catch (_error) {
      // try next provider
    }
  }

  const next = {
    country: null,
    country_code: null,
    region: null,
    city: null,
    latitude: null,
    longitude: null,
    updated_at: new Date().toISOString(),
    failed: true,
  };
  cache[clean] = next;
  await saveGeoCache(cache);
  return next;
}

function aggregateGeoRows(rows, granularity = "country") {
  const mode = ["country", "region", "city"].includes(granularity) ? granularity : "country";
  const buckets = new Map();
  for (const row of rows) {
    const rawLat = row?.latitude;
    const rawLon = row?.longitude;
    if (rawLat == null || rawLon == null || rawLat === "" || rawLon === "") continue;
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const country = row.country || "Unknown";
    const countryCode = row.country_code || "??";
    const region = row.region || null;
    const city = row.city || null;

    let key = countryCode;
    let label = country;
    if (mode === "region") {
      key = `${countryCode}|${normalizeText(region || "unknown")}`;
      label = region || country;
    } else if (mode === "city") {
      key = `${countryCode}|${normalizeText(region || "unknown")}|${normalizeText(city || "unknown")}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
      label = city || region || country;
    }

    const current = buckets.get(key) || {
      country,
      country_code: countryCode,
      region,
      city,
      label,
      latitude_sum: 0,
      longitude_sum: 0,
      listeners: 0,
      ips: new Set(),
    };
    current.latitude_sum += lat;
    current.longitude_sum += lon;
    current.listeners += 1;
    if (row.ip) current.ips.add(row.ip);
    buckets.set(key, current);
  }

  return [...buckets.values()]
    .map((item) => ({
      country: item.country,
      country_code: item.country_code,
      region: item.region,
      city: item.city,
      label: item.label,
      latitude: item.listeners > 0 ? Number((item.latitude_sum / item.listeners).toFixed(4)) : null,
      longitude: item.listeners > 0 ? Number((item.longitude_sum / item.listeners).toFixed(4)) : null,
      listeners: item.listeners,
      unique_ips: item.ips.size,
    }))
    .sort((a, b) => b.unique_ips - a.unique_ips);
}

async function collectIcecastListenerSnapshot() {
  const config = await loadIcecastConfig();
  if (!config.host || !config.password) {
    const snapshot = {
      enabled: false,
      reason: !config.host ? "missing_host" : "missing_password",
      summary: null,
      listeners: [],
    };
    latestIcecastSnapshot = snapshot;
    latestIcecastSnapshotAtMs = Date.now();
    return snapshot;
  }

  const stats = await fetchIcecastJsonStats(config);
  const mounts = extractMountsFromStats(stats, config.mount);
  const listeners = [];
  for (const mount of mounts) {
    const items = await fetchIcecastMountClients(config, mount);
    listeners.push(...items);
  }

  const nowIso = new Date().toISOString();
  const history = await loadListenerHistory();
  const nextHistory = [...history];
  let historyChanged = false;

  for (const listener of listeners) {
    const geo = await lookupGeoForIp(listener.ip);
    const existingRecent = [...nextHistory]
      .reverse()
      .find(
        (entry) =>
          entry.ip === listener.ip &&
          entry.mount === listener.mount &&
          Math.abs(new Date(nowIso).getTime() - new Date(entry.ts).getTime()) <= 15 * 60 * 1000,
      );
    if (existingRecent) {
      const hasGeo = existingRecent.latitude != null && existingRecent.longitude != null;
      const nextHasGeo = geo?.latitude != null && geo?.longitude != null;
      if (!hasGeo && nextHasGeo) {
        existingRecent.country = geo.country || existingRecent.country || null;
        existingRecent.country_code = geo.country_code || existingRecent.country_code || null;
        existingRecent.region = geo.region || existingRecent.region || null;
        existingRecent.city = geo.city || existingRecent.city || null;
        existingRecent.latitude = geo.latitude;
        existingRecent.longitude = geo.longitude;
        historyChanged = true;
      }
      if (
        nextHasGeo &&
        hasGeo &&
        (Number(existingRecent.latitude) !== Number(geo.latitude) || Number(existingRecent.longitude) !== Number(geo.longitude))
      ) {
        nextHistory.push({
          ts: nowIso,
          ip: listener.ip,
          mount: listener.mount,
          user_agent: listener.user_agent || "",
          country: geo.country || null,
          country_code: geo.country_code || null,
          region: geo.region || null,
          city: geo.city || null,
          latitude: geo.latitude || null,
          longitude: geo.longitude || null,
        });
        historyChanged = true;
      }
      continue;
    }
    nextHistory.push({
      ts: nowIso,
      ip: listener.ip,
      mount: listener.mount,
      user_agent: listener.user_agent || "",
      country: geo?.country || null,
      country_code: geo?.country_code || null,
      region: geo?.region || null,
      city: geo?.city || null,
      latitude: geo?.latitude || null,
      longitude: geo?.longitude || null,
    });
  }

  if (nextHistory.length !== history.length || historyChanged) {
    await saveListenerHistory(nextHistory);
  }

  const snapshot = {
    enabled: true,
    reason: "ok",
    summary: stats,
    listeners,
    mounts,
    collected_at: nowIso,
  };
  latestIcecastSnapshot = snapshot;
  latestIcecastSnapshotAtMs = Date.now();
  return snapshot;
}

async function refreshIcecastSnapshot() {
  if (icecastSnapshotInFlight) return icecastSnapshotInFlight;
  icecastSnapshotInFlight = (async () => {
    try {
      return await collectIcecastListenerSnapshot();
    } finally {
      icecastSnapshotInFlight = null;
    }
  })();
  return icecastSnapshotInFlight;
}

function isSnapshotFresh() {
  return Boolean(latestIcecastSnapshot) && Date.now() - latestIcecastSnapshotAtMs <= Math.max(1000, icecastSnapshotCacheMs);
}

async function getIcecastSnapshotForRead() {
  if (isSnapshotFresh()) {
    return latestIcecastSnapshot;
  }
  if (latestIcecastSnapshot) {
    refreshIcecastSnapshot().catch(() => {
      // best-effort background refresh
    });
    return latestIcecastSnapshot;
  }
  return refreshIcecastSnapshot();
}

async function enrichListenerHistoryGeo(maxIpsPerRun = 20) {
  const history = await loadListenerHistory();
  if (!history.length) return 0;

  const missingByIp = new Map();
  for (const row of history) {
    if (!row?.ip) continue;
    const hasGeo = row.latitude != null && row.longitude != null;
    if (hasGeo) continue;
    missingByIp.set(row.ip, true);
  }

  const targetIps = [...missingByIp.keys()].slice(0, Math.max(1, Number(maxIpsPerRun) || 20));
  if (!targetIps.length) return 0;

  let changed = 0;
  for (const ip of targetIps) {
    const geo = await lookupGeoForIp(ip);
    const hasGeo = geo && geo.latitude != null && geo.longitude != null;
    if (!hasGeo) continue;
    for (const row of history) {
      if (row.ip !== ip) continue;
      if (row.latitude != null && row.longitude != null) continue;
      row.country = geo.country || row.country || null;
      row.country_code = geo.country_code || row.country_code || null;
      row.region = geo.region || row.region || null;
      row.city = geo.city || row.city || null;
      row.latitude = geo.latitude;
      row.longitude = geo.longitude;
      changed += 1;
    }
  }

  if (changed > 0) {
    await saveListenerHistory(history);
  }
  return changed;
}

function summarizeIcecastStats(snapshot, history) {
  const icestats = snapshot?.summary?.icestats || {};
  const rawSources = icestats?.source;
  const sourceRows = Array.isArray(rawSources) ? rawSources : rawSources ? [rawSources] : [];
  const targetMounts = new Set((snapshot?.mounts || []).map((mount) => String(mount || "").trim()).filter(Boolean));
  let streamStartIso = null;

  for (const row of sourceRows) {
    const listenurl = String(row?.listenurl || "").trim();
    let rowMount = String(row?.mount || "").trim();
    if (!rowMount && listenurl) {
      try {
        rowMount = new URL(listenurl).pathname || "";
      } catch (_error) {
        rowMount = "";
      }
    }
    const matchesTarget = targetMounts.size === 0 || (rowMount && targetMounts.has(rowMount));
    if (!matchesTarget) continue;
    streamStartIso = toIsoDateTime(row?.stream_start_iso8601 || row?.stream_start);
    if (streamStartIso) break;
  }

  if (!streamStartIso) {
    for (const row of sourceRows) {
      streamStartIso = toIsoDateTime(row?.stream_start_iso8601 || row?.stream_start);
      if (streamStartIso) break;
    }
  }

  const serverStartIso = toIsoDateTime(icestats.server_start_iso8601);
  const uptimeStartIso = streamStartIso || serverStartIso;
  const currentListeners = Number(icestats.listeners || snapshot.listeners.length || 0);
  const now = Date.now();
  const last24Cutoff = now - 24 * 60 * 60 * 1000;
  const last24Ips = new Set();
  const allIps = new Set();
  for (const row of history) {
    if (!row?.ip) continue;
    allIps.add(row.ip);
    const ts = new Date(row.ts || "").getTime();
    if (Number.isFinite(ts) && ts >= last24Cutoff) {
      last24Ips.add(row.ip);
    }
  }

  return {
    collected_at: snapshot?.collected_at || new Date().toISOString(),
    uptime_seconds: uptimeStartIso ? Math.max(0, Math.round((Date.now() - new Date(uptimeStartIso).getTime()) / 1000)) : null,
    stream_start_iso8601: streamStartIso,
    server_start_iso8601: serverStartIso,
    current_listeners: currentListeners,
    source_count: Number(icestats.sources || 0),
    mount_count: Number(snapshot?.mounts?.length || 0),
    unique_listeners_24h: last24Ips.size,
    unique_listeners_all_time: allIps.size,
  };
}

function filterHistoryByRange(history, range, currentIps) {
  const now = Date.now();
  if (range === "current") {
    const currentSet = new Set((currentIps || []).map((item) => item.ip).filter(Boolean));
    return history.filter((row) => row.ip && currentSet.has(row.ip));
  }
  if (range === "24h") {
    const cutoff = now - 24 * 60 * 60 * 1000;
    return history.filter((row) => {
      const ts = new Date(row.ts || "").getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }
  return history;
}

function startIcecastCollectorLoop() {
  if (icecastCollectorStarted) return;
  icecastCollectorStarted = true;

  const run = async () => {
    if (icecastCollectorBusy) return;
    icecastCollectorBusy = true;
    try {
      await refreshIcecastSnapshot();
      await enrichListenerHistoryGeo(20);
    } catch (_error) {
      // best-effort collector
    } finally {
      icecastCollectorBusy = false;
    }
  };

  setInterval(run, 60 * 1000);
  run();
}

function buildIcecastSongText({ artist = "", title = "", showTitle = "" }) {
  let nextArtist = normalizeDisplayText(artist);
  let nextTitle = normalizeDisplayText(title);
  if (!nextArtist && nextTitle.includes(" - ")) {
    const parts = nextTitle.split(" - ", 2).map((item) => item.trim());
    if (parts[0] && parts[1]) {
      nextArtist = parts[0];
      nextTitle = parts[1];
    }
  }
  if (nextArtist && nextTitle) return `${nextArtist} - ${nextTitle}`;
  if (nextTitle) return nextTitle;
  return normalizeDisplayText(showTitle);
}

function buildIcecastSongTextFromNowPlaying(snapshot) {
  return buildIcecastSongText({
    artist: snapshot?.track?.artist,
    title: snapshot?.track?.title,
    showTitle: snapshot?.show?.title,
  });
}

async function pushIcecastMetadata(songText, options = {}) {
  const allowDisabled = Boolean(options.allowDisabled);
  const config = normalizeIcecastConfig(options.config || (await loadIcecastConfig()), icecastDefaults);
  const cleanSong = normalizeDisplayText(songText);

  if (!cleanSong) {
    return { attempted: false, updated: false, reason: "empty_song" };
  }
  if (!allowDisabled && !config.enabled) {
    return { attempted: false, updated: false, reason: "disabled" };
  }
  if (!config.host) {
    return { attempted: false, updated: false, reason: "missing_host" };
  }
  if (!config.password) {
    return { attempted: false, updated: false, reason: "missing_password" };
  }

  const mount = `/${normalizeIcecastMount(config.mount)}`;
  const endpoint = new URL(`${config.scheme}://${config.host}:${config.port}/admin/metadata`);
  endpoint.searchParams.set("mode", "updinfo");
  endpoint.searchParams.set("mount", mount);
  endpoint.searchParams.set("song", cleanSong);

  const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
  let response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "User-Agent": "radiant-api/icecast-meta",
      },
    });
  } catch (error) {
    return {
      attempted: true,
      updated: false,
      reason: "request_failed",
      detail: error?.message || String(error),
    };
  }

  if (!response.ok) {
    const body = await response.text();
    return {
      attempted: true,
      updated: false,
      reason: "upstream_error",
      status: response.status,
      detail: String(body || "").trim().slice(0, 240) || `HTTP ${response.status}`,
    };
  }

  return {
    attempted: true,
    updated: true,
    reason: "ok",
    status: response.status,
    song: cleanSong,
    mount,
  };
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(JSON.parse(text));
      } catch (_error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

async function directusAuth() {
  if (directusToken) return directusToken;
  if (!directusEmail || !directusPassword) {
    throw new Error("Directus admin credentials missing for radiant-api");
  }
  const res = await fetch(`${directusBaseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: directusEmail, password: directusPassword }),
  });
  if (!res.ok) {
    throw new Error(`Directus login failed (${res.status})`);
  }
  const data = await res.json();
  directusToken = data?.data?.access_token || null;
  if (!directusToken) throw new Error("Directus login missing access token");
  return directusToken;
}

async function directusRequest(path, query = null, retry = true) {
  const token = await directusAuth();
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const res = await fetch(`${directusBaseUrl}${path}${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && retry) {
    directusToken = null;
    return directusRequest(path, query, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus request failed ${res.status} for ${path}: ${text}`);
  }
  const json = await res.json();
  return json?.data || [];
}

async function directusCreateItem(collection, payload, retry = true) {
  const token = await directusAuth();
  const res = await fetch(`${directusBaseUrl}/items/${collection}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 && retry) {
    directusToken = null;
    return directusCreateItem(collection, payload, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus create failed ${res.status} for ${collection}: ${text}`);
  }
  const json = await res.json();
  return json?.data || null;
}

async function directusUpdateItem(collection, id, payload, retry = true) {
  const token = await directusAuth();
  const res = await fetch(`${directusBaseUrl}/items/${collection}/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 && retry) {
    directusToken = null;
    return directusUpdateItem(collection, id, payload, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus update failed ${res.status} for ${collection}/${id}: ${text}`);
  }
  const json = await res.json();
  return json?.data || null;
}

async function directusDeleteItem(collection, id, retry = true) {
  const token = await directusAuth();
  const res = await fetch(`${directusBaseUrl}/items/${collection}/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401 && retry) {
    directusToken = null;
    return directusDeleteItem(collection, id, false);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Directus delete failed ${res.status} for ${collection}/${id}: ${text}`);
  }
  return true;
}

async function getShowsByIds(showIds) {
  if (!showIds.length) return {};
  const data = await directusRequest("/items/shows", {
    "filter[id][_in]": showIds.join(","),
    fields: "id,slug,title,description,artwork_url,show_type",
    limit: String(showIds.length + 5),
  });
  const map = {};
  for (const row of data) map[row.id] = row;
  return map;
}

async function fetchScheduleSlots() {
  return directusRequest("/items/schedule_slots", {
    fields: "id,slot_key,weekday,start_time,end_time,timezone,show",
    sort: "weekday,start_time",
    limit: "-1",
  });
}

async function fetchScheduleOverrides({ from = null, to = null } = {}) {
  const query = {
    fields: "id,start_at,end_at,override_type,note,priority,show",
    sort: "start_at",
    limit: "-1",
  };
  if (from) query["filter[end_at][_gte]"] = from;
  if (to) query["filter[start_at][_lte]"] = to;
  return directusRequest("/items/schedule_overrides", query);
}

function slotMatchesMoment(slot, zoned) {
  const slotWeekday = normalizeWeekday(slot.weekday);
  if (!slotWeekday || slotWeekday !== zoned.weekday) return false;
  const start = parseClockToMinutes(slot.start_time);
  const end = parseClockToMinutes(slot.end_time);
  if (start === null || end === null) return false;
  if (end > start) return zoned.minuteOfDay >= start && zoned.minuteOfDay < end;
  return zoned.minuteOfDay >= start || zoned.minuteOfDay < end;
}

function pickActiveOverride(overrides, atIso) {
  const at = new Date(atIso).getTime();
  const active = overrides.filter((row) => {
    const start = new Date(row.start_at).getTime();
    const end = new Date(row.end_at).getTime();
    return at >= start && at < end;
  });
  if (!active.length) return null;
  return active.sort((a, b) => (Number(a.priority || 100) - Number(b.priority || 100)) || (a.id - b.id))[0];
}

async function resolveLiveSchedule(atIso, timezone) {
  const at = new Date(atIso);
  const slots = await fetchScheduleSlots();
  const overrides = await fetchScheduleOverrides();
  const zoned = getZonedParts(at, timezone);

  const slot = slots.find((row) => slotMatchesMoment(row, zoned)) || null;
  const override = pickActiveOverride(overrides, at.toISOString());

  const showIds = [];
  if (slot?.show) showIds.push(slot.show);
  if (override?.show) showIds.push(override.show);
  const showsById = await getShowsByIds([...new Set(showIds)]);

  if (override) {
    return {
      source: "override",
      override_active: true,
      show: safeShowSummary(showsById[override.show] || null),
      slot: slot
        ? {
            id: slot.id,
            weekday: slot.weekday,
            start_time: slot.start_time,
            end_time: slot.end_time,
            timezone: slot.timezone,
          }
        : null,
      override: {
        id: override.id,
        start_at: override.start_at,
        end_at: override.end_at,
        override_type: override.override_type,
        note: override.note || null,
        priority: Number(override.priority || 100),
      },
    };
  }

  if (slot) {
    return {
      source: "slot",
      override_active: false,
      show: safeShowSummary(showsById[slot.show] || null),
      slot: {
        id: slot.id,
        weekday: slot.weekday,
        start_time: slot.start_time,
        end_time: slot.end_time,
        timezone: slot.timezone,
      },
      override: null,
    };
  }

  return {
    source: "none",
    override_active: false,
    show: null,
    slot: null,
    override: null,
  };
}

async function getRecentTrack() {
  const rows = await directusRequest("/items/playlist_tracks", {
    fields: "id,played_at,artist,title,album,artwork_url,confidence,provider,provider_ref,show",
    sort: "-played_at",
    limit: "1",
  });
  return rows[0] || null;
}

async function getRecentTrackForLiveShowWindow(live, now) {
  const showId = Number(live?.show?.id || 0);
  if (!Number.isInteger(showId) || showId <= 0) return null;

  const rows = await directusRequest("/items/playlist_tracks", {
    fields: "id,played_at,artist,title,album,artwork_url,confidence,provider,provider_ref,show",
    sort: "-played_at",
    limit: "20",
    "filter[show][_eq]": String(showId),
  });

  if (!rows.length) return null;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const maxAgeMs = 12 * 60 * 60 * 1000;
  for (const row of rows) {
    const playedMs = new Date(row.played_at || "").getTime();
    if (!Number.isFinite(playedMs)) continue;
    const age = nowMs - playedMs;
    if (age >= 0 && age <= maxAgeMs) return row;
  }

  return rows[0] || null;
}

function isTrackFreshAndConfident(track, now) {
  if (!track?.played_at) return false;
  const confidence = Number(track.confidence || 0);
  if (confidence < nowPlayingConfidenceMin) return false;
  const ageSec = (now.getTime() - new Date(track.played_at).getTime()) / 1000;
  return ageSec >= 0 && ageSec <= nowPlayingFreshSeconds;
}

async function resolveNowPlayingPayload(timezone, now = new Date()) {
  const [track, live] = await Promise.all([getRecentTrack(), resolveLiveSchedule(now.toISOString(), timezone)]);

  if (track && isTrackFreshAndConfident(track, now)) {
    const showMap = await getShowsByIds(track.show ? [track.show] : []);
    return {
      source: "track",
      resolved_at: now.toISOString(),
      fresh_until: new Date(new Date(track.played_at).getTime() + nowPlayingFreshSeconds * 1000).toISOString(),
      timezone,
      track: {
        id: track.id,
        played_at: track.played_at,
        artist: track.artist || null,
        title: track.title || null,
        album: track.album || null,
        artwork_url: track.artwork_url || null,
        confidence: track.confidence == null ? null : Number(track.confidence),
        provider: track.provider || null,
        provider_ref: track.provider_ref || null,
      },
      show: safeShowSummary(showMap[track.show] || live.show || null),
      context: {
        override_active: live.override_active,
        slot: live.slot,
      },
    };
  }

  const liveShowTrack = await getRecentTrackForLiveShowWindow(live, now);
  if (liveShowTrack) {
    const showMap = await getShowsByIds(liveShowTrack.show ? [liveShowTrack.show] : []);
    return {
      source: "track_live_window",
      resolved_at: now.toISOString(),
      fresh_until: new Date(now.getTime() + nowPlayingFreshSeconds * 1000).toISOString(),
      timezone,
      track: {
        id: liveShowTrack.id,
        played_at: liveShowTrack.played_at,
        artist: liveShowTrack.artist || null,
        title: liveShowTrack.title || null,
        album: liveShowTrack.album || null,
        artwork_url: liveShowTrack.artwork_url || null,
        confidence: liveShowTrack.confidence == null ? null : Number(liveShowTrack.confidence),
        provider: liveShowTrack.provider || null,
        provider_ref: liveShowTrack.provider_ref || null,
      },
      show: safeShowSummary(showMap[liveShowTrack.show] || live.show || null),
      context: {
        override_active: live.override_active,
        slot: live.slot,
      },
    };
  }

  return {
    source: "schedule_fallback",
    resolved_at: now.toISOString(),
    fresh_until: new Date(now.getTime() + nowPlayingFreshSeconds * 1000).toISOString(),
    timezone,
    track: null,
    show: live.show,
    context: {
      override_active: live.override_active,
      slot: live.slot,
    },
  };
}

async function buildScheduleWeek(weekStartInput, timezone) {
  const now = new Date();
  const weekStart = resolveWeekStart(weekStartInput, timezone, now);
  const weekEnd = shiftDate(weekStart, 6);
  const weekStartIso = `${weekStart}T00:00:00.000Z`;
  const weekEndIso = `${weekEnd}T23:59:59.999Z`;

  const slots = await fetchScheduleSlots();
  const overrides = await fetchScheduleOverrides({ from: weekStartIso, to: weekEndIso });
  const showIds = new Set();
  for (const row of slots) if (row.show) showIds.add(row.show);
  for (const row of overrides) if (row.show) showIds.add(row.show);
  const showsById = await getShowsByIds([...showIds]);

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = shiftDate(weekStart, i);
    const weekday = i + 1;
    const daySlots = slots
      .filter((row) => Number(row.weekday) === weekday)
      .map((row) => ({
        kind: "slot",
        id: row.id,
        weekday: Number(row.weekday),
        start_time: row.start_time,
        end_time: row.end_time,
        timezone: row.timezone,
        show: safeShowSummary(showsById[row.show] || null),
      }));

    const dayOverrides = overrides
      .filter((row) => row.start_at && row.start_at.startsWith(date))
      .map((row) => ({
        kind: "override",
        id: row.id,
        start_at: row.start_at,
        end_at: row.end_at,
        override_type: row.override_type,
        note: row.note || null,
        priority: Number(row.priority || 100),
        show: safeShowSummary(showsById[row.show] || null),
      }));

    days.push({
      date,
      weekday,
      weekday_name: weekdayNames[weekday - 1],
      slots: daySlots,
      overrides: dayOverrides,
    });
  }

  return {
    week_start: weekStart,
    week_end: weekEnd,
    timezone,
    days,
  };
}

async function buildShowDetails(slug) {
  const shows = await directusRequest("/items/shows", {
    "filter[slug][_eq]": slug,
    fields: "id,slug,title,description,artwork_url,show_type,is_active",
    limit: "1",
  });
  const show = shows[0] || null;
  if (!show) return null;

  const slots = await directusRequest("/items/schedule_slots", {
    "filter[show][_eq]": String(show.id),
    fields: "id,weekday,start_time,end_time,timezone",
    sort: "weekday,start_time",
    limit: "-1",
  });

  const nowIso = new Date().toISOString();
  const overrides = await directusRequest("/items/schedule_overrides", {
    "filter[show][_eq]": String(show.id),
    "filter[end_at][_gte]": nowIso,
    fields: "id,start_at,end_at,override_type,note,priority",
    sort: "start_at",
    limit: "10",
  });

  const showDjs = await directusRequest("/items/show_djs", {
    "filter[show][_eq]": String(show.id),
    fields: "dj.id,dj.slug,dj.name,dj.bio,dj.image_url,role",
    limit: "-1",
  });
  const djs = showDjs
    .map((row) => row.dj)
    .filter(Boolean)
    .map((dj) => ({
      id: dj.id,
      slug: dj.slug,
      name: dj.name,
      bio: dj.bio || null,
      image_url: dj.image_url || null,
    }));

  return {
    show: safeShowSummary(show),
    djs,
    weekly_slots: slots,
    upcoming_overrides: overrides,
  };
}

async function buildDjDetails(slug) {
  const djs = await directusRequest("/items/djs", {
    "filter[slug][_eq]": slug,
    fields: "id,slug,name,bio,image_url,links,roles,is_active",
    limit: "1",
  });
  const dj = djs[0] || null;
  if (!dj) return null;

  const links = await directusRequest("/items/show_djs", {
    "filter[dj][_eq]": String(dj.id),
    fields: "role,show.id,show.slug,show.title,show.description,show.artwork_url,show.show_type",
    limit: "-1",
  });

  return {
    dj: {
      id: dj.id,
      slug: dj.slug,
      name: dj.name,
      bio: dj.bio || null,
      image_url: dj.image_url || null,
      links: dj.links || null,
      roles: dj.roles || null,
      is_active: Boolean(dj.is_active),
    },
    shows: links.map((row) => ({
      role: row.role || null,
      show: safeShowSummary(row.show),
    })),
  };
}

async function buildPlaylistRecent(limitInput) {
  const limit = Math.max(1, Math.min(100, Number(limitInput || 20) || 20));
  const tracks = await directusRequest("/items/playlist_tracks", {
    fields: "id,played_at,artist,title,album,artwork_url,confidence,provider,provider_ref,show",
    sort: "-played_at",
    limit: String(limit),
  });
  const showIds = [...new Set(tracks.map((row) => row.show).filter(Boolean))];
  const showsById = await getShowsByIds(showIds);
  return {
    count: tracks.length,
    items: tracks.map((row) => ({
      id: row.id,
      played_at: row.played_at,
      artist: row.artist || null,
      title: row.title || null,
      album: row.album || null,
      artwork_url: row.artwork_url || null,
      confidence: row.confidence == null ? null : Number(row.confidence),
      provider: row.provider || null,
      provider_ref: row.provider_ref || null,
      show: safeShowSummary(showsById[row.show] || null),
    })),
  };
}

async function ingestAcrcloudPayload(payload) {
  const streamId = String(payload?.stream_id || "").trim();
  if (acrExpectedProjectId && streamId && acrExpectedProjectId !== streamId) {
    return { inserted: false, reason: "unexpected_stream_id" };
  }

  const music = payload?.data?.metadata?.music;
  if (!Array.isArray(music) || !music.length) {
    const topStatus = Number(payload?.status);
    if (Number.isFinite(topStatus) && topStatus === 0) {
      return { inserted: false, reason: "no_music_detected" };
    }
    return { inserted: false, reason: "no_music_match" };
  }

  const top = music[0] || {};
  const rawArtist = (top.artists || []).map((a) => a?.name).filter(Boolean).join(", ") || "";
  const rawTitle = String(top.title || "").trim();
  if (!rawArtist || !rawTitle) {
    return { inserted: false, reason: "missing_artist_or_title" };
  }

  const consensus = resolveTrackFromExternalConsensus(top);
  const topKey = `${normalizeText(rawArtist)}::${normalizeText(rawTitle)}`;
  const consensusKey = consensus ? `${normalizeText(consensus.artist)}::${normalizeText(consensus.title)}` : "";
  const useConsensus = Boolean(consensus && consensusKey && consensusKey !== topKey);

  const artist = useConsensus ? consensus.artist : rawArtist;
  const title = useConsensus ? consensus.title : rawTitle;

  const score = Number(top.score || 0);
  const confidence = Math.max(0, Math.min(1, score / 100));
  if (confidence < nowPlayingConfidenceMin) {
    return { inserted: false, reason: "below_confidence_threshold" };
  }

  const playedAt = toIsoUtc(payload?.data?.metadata?.timestamp_utc) || new Date().toISOString();
  const targetArtist = normalizeText(artist);
  const targetTitle = normalizeText(title);
  const recent = await directusRequest("/items/playlist_tracks", {
    fields: "id,played_at,artist,title",
    sort: "-played_at",
    limit: "10",
  });

  const duplicate = recent.find((row) => {
    const sameArtist = normalizeText(row.artist) === targetArtist;
    const sameTitle = normalizeText(row.title) === targetTitle;
    if (!sameArtist || !sameTitle || !row.played_at) return false;
    const ageSeconds = Math.abs((new Date(playedAt).getTime() - new Date(row.played_at).getTime()) / 1000);
    return ageSeconds <= acrDedupeSeconds;
  });
  if (duplicate) {
    return { inserted: false, reason: "duplicate_recent_track" };
  }

  const live = await resolveLiveSchedule(playedAt, defaultTimezone);
  const created = await directusCreateItem("playlist_tracks", {
    played_at: playedAt,
    artist,
    title,
    album: top?.album?.name || null,
    artwork_url: null,
    confidence,
    provider: "acrcloud",
    provider_ref: top?.acrid || null,
    show: live?.show?.id || null,
  });

  return {
    inserted: true,
    reason: useConsensus ? "inserted_consensus_override" : "inserted",
    id: created?.id || null,
    artist,
    title,
    show_title: live?.show?.title || null,
    corrected: useConsensus,
    corrected_from: useConsensus ? { artist: rawArtist, title: rawTitle } : null,
    corrected_to: useConsensus ? { artist, title } : null,
    corrected_services: useConsensus ? consensus.agreed_services : [],
  };
}

function isValidAcrCallbackAuth(req, requestUrl) {
  const expectedHeader = acrCallbackSecret;
  const expectedQuery = acrCallbackToken || acrCallbackSecret;

  const suppliedHeader = req.headers["x-acr-secret"];
  if (expectedHeader && typeof suppliedHeader === "string" && timingSafeEqualText(suppliedHeader, expectedHeader)) {
    return true;
  }

  const suppliedToken = requestUrl.searchParams.get("token") || "";
  if (expectedQuery && suppliedToken && timingSafeEqualText(suppliedToken, expectedQuery)) {
    return true;
  }

  return false;
}

function isValidAdminRequest(req) {
  if (!radiantAdminToken) return false;
  const supplied = req.headers["x-radiant-admin-token"];
  if (typeof supplied !== "string") return false;
  return timingSafeEqualText(supplied, radiantAdminToken);
}

function validateScheduleSlotPayload(input, existing = null) {
  const weekday = input.weekday == null ? existing?.weekday : Number(input.weekday);
  const startTime = input.start_time == null ? existing?.start_time : String(input.start_time);
  const endTime = input.end_time == null ? existing?.end_time : String(input.end_time);
  const timezone = input.timezone == null ? existing?.timezone : String(input.timezone);
  const show = input.show == null ? existing?.show : Number(input.show);
  const slotKey = input.slot_key == null ? existing?.slot_key : String(input.slot_key);

  if (!Number.isInteger(Number(weekday)) || Number(weekday) < 1 || Number(weekday) > 7) {
    throw new Error("weekday must be between 1 and 7");
  }

  const start = parseClockToMinutes(startTime);
  const end = parseClockToMinutes(endTime);
  if (start == null || end == null || end === start) {
    throw new Error("start_time and end_time must be valid times");
  }
  if (end < start && end !== 0) {
    throw new Error("end_time must be after start_time unless ending at 00:00");
  }

  if (!Number.isInteger(Number(show)) || Number(show) <= 0) {
    throw new Error("show must be a valid show id");
  }

  return {
    slot_key: slotKey || `${Number(weekday)}-${formatMinutesToTime(start)}-${formatMinutesToTime(end)}-${Date.now()}`,
    weekday: Number(weekday),
    start_time: formatMinutesToTime(start),
    end_time: formatMinutesToTime(end),
    timezone: timezone || defaultTimezone,
    show: Number(show),
  };
}

function parseDateParts(dateInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateInput || ""))) return null;
  const [y, m, d] = String(dateInput).split("-").map(Number);
  return { y, m, d };
}

function localDateTimeToIso(dateInput, timeInput, timezone) {
  const date = parseDateParts(dateInput);
  const minuteOfDay = parseClockToMinutes(timeInput);
  if (!date || minuteOfDay == null) return null;

  const h = Math.floor(minuteOfDay / 60);
  const min = minuteOfDay % 60;
  let guess = new Date(Date.UTC(date.y, date.m - 1, date.d, h, min, 0));

  for (let i = 0; i < 4; i += 1) {
    const parts = getZonedParts(guess, timezone);
    const desiredStamp = Date.UTC(date.y, date.m - 1, date.d, h, min, 0);
    const observedStamp = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      parts.hour,
      parts.minute,
      0,
    );
    const diff = desiredStamp - observedStamp;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess.toISOString();
}

async function createAlternatingOverrides(payload) {
  const baseSlotId = Number(payload.base_slot_id);
  const alternateShowId = Number(payload.alternate_show_id);
  const startDate = String(payload.start_date || "");
  const weeks = Math.max(1, Math.min(52, Number(payload.weeks || 12) || 12));
  const intervalWeeks = Math.max(1, Math.min(8, Number(payload.interval_weeks || 2) || 2));

  if (!Number.isInteger(baseSlotId) || baseSlotId <= 0) {
    throw new Error("base_slot_id is required");
  }
  if (!Number.isInteger(alternateShowId) || alternateShowId <= 0) {
    throw new Error("alternate_show_id is required");
  }
  if (!parseDateParts(startDate)) {
    throw new Error("start_date must be YYYY-MM-DD");
  }

  const rows = await directusRequest("/items/schedule_slots", {
    "filter[id][_eq]": String(baseSlotId),
    fields: "id,weekday,start_time,end_time,timezone,show",
    limit: "1",
  });
  const slot = rows[0] || null;
  if (!slot) throw new Error("base slot not found");

  const created = [];
  for (let index = 0; index < weeks; index += intervalWeeks) {
    const targetDate = shiftDate(startDate, index * 7);
    const startIso = localDateTimeToIso(targetDate, slot.start_time, slot.timezone || defaultTimezone);
    let endDate = targetDate;
    if (parseClockToMinutes(slot.end_time) <= parseClockToMinutes(slot.start_time)) {
      endDate = shiftDate(targetDate, 1);
    }
    const endIso = localDateTimeToIso(endDate, slot.end_time, slot.timezone || defaultTimezone);
    if (!startIso || !endIso) continue;

    const override = await directusCreateItem("schedule_overrides", {
      start_at: startIso,
      end_at: endIso,
      override_type: "replacement",
      show: alternateShowId,
      note: `alternating override from slot ${baseSlotId}`,
      priority: 100,
      is_active: true,
    });
    created.push(override?.id || null);
  }

  return {
    created_count: created.length,
    override_ids: created.filter(Boolean),
  };
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = cell == null ? "" : String(cell);
          return `"${value.replace(/"/g, '""')}"`;
        })
        .join(","),
    )
    .join("\n");
}

function toPipeDelimited(rows) {
  return rows
    .map((row) => row.map((cell) => String(cell == null ? "" : cell).replace(/[\r\n|]+/g, " ").trim()).join("|"))
    .join("\n");
}

function toCompactDate(value) {
  const dt = value ? new Date(value) : new Date();
  if (Number.isNaN(dt.getTime())) return "";
  const day = String(dt.getUTCDate()).padStart(2, "0");
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const year = String(dt.getUTCFullYear());
  return `${day}${month}${year}`;
}

function toQuarterLabel(value) {
  const dt = value ? new Date(value) : new Date();
  if (Number.isNaN(dt.getTime())) return "";
  const quarter = Math.floor(dt.getUTCMonth() / 3) + 1;
  return `QTR${quarter}-${dt.getUTCFullYear()}`;
}

function toBmiDateTime(value) {
  const dt = new Date(value || "");
  if (Number.isNaN(dt.getTime())) return "";
  const yyyy = String(dt.getUTCFullYear());
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  const hh = String(dt.getUTCHours()).padStart(2, "0");
  const min = String(dt.getUTCMinutes()).padStart(2, "0");
  const sec = String(dt.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}

const REPORT_TYPES = [
  {
    id: "SOUND_EXCHANGE_ROU_ATP",
    label: "SoundExchange - Report of Use - ATP (Commercial Webcaster)",
    available: false,
  },
  {
    id: "SOUND_EXCHANGE_ROU_ATH",
    label: "SoundExchange - Report of Use - ATH (Minimum Fee Broadcaster)",
    available: true,
  },
  {
    id: "SOUND_EXCHANGE_SOA_ATP",
    label: "SoundExchange - Statement of Account - ATP (Commercial Webcaster)",
    available: false,
  },
  {
    id: "SOUND_EXCHANGE_SOA_ATH",
    label: "SoundExchange - Statement of Account - ATH (Minimum Fee Broadcaster)",
    available: false,
  },
  {
    id: "NPR_LISTENERS",
    label: "NPR Digital Services - Listeners",
    available: false,
  },
  {
    id: "NPR_SONGS",
    label: "NPR Digital Services - Songs",
    available: false,
  },
  {
    id: "BMI_MUSIC_PLAYS",
    label: "BMI - Spreadsheet of Music Plays",
    available: true,
  },
  {
    id: "BMI_MUSIC_IMPRESSIONS",
    label: "BMI - Number of Music Impressions",
    available: false,
  },
];

const REPORT_TYPE_MAP = Object.fromEntries(REPORT_TYPES.map((item) => [item.id, item]));

async function buildReportExport(reportType, startDate, endDate) {
  const baseFilter = {};
  if (startDate) baseFilter["filter[played_at][_gte]"] = `${startDate}T00:00:00.000Z`;
  if (endDate) baseFilter["filter[played_at][_lte]"] = `${endDate}T23:59:59.999Z`;

  const tracks = await directusRequest("/items/playlist_tracks", {
    fields: "id,played_at,artist,title,album,show",
    sort: "played_at",
    limit: "-1",
    ...baseFilter,
  });

  if (reportType === "SOUND_EXCHANGE_ROU_ATH") {
    const grouped = new Map();
    for (const row of tracks) {
      const artist = row.artist || "";
      const title = row.title || "";
      const isrc = "";
      const album = row.album || "";
      const label = "";
      const key = [artist, title, isrc, album, label].join("\u0000");
      const current = grouped.get(key) || {
        artist,
        title,
        isrc,
        album,
        label,
        playFrequency: 0,
      };
      current.playFrequency += 1;
      grouped.set(key, current);
    }

    const body = [...grouped.values()]
      .sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`))
      .map((row) => ["", "B", row.artist, row.title, row.isrc, row.album, row.label, "0.00", "", row.playFrequency]);

    const content = toPipeDelimited([
      [
        "NAME_OF_SERVICE",
        "TRANSMISSION_CATEGORY",
        "FEATURED_ARTIST",
        "SOUND_RECORDING_TITLE",
        "ISRC",
        "ALBUM_TITLE",
        "MARKETING_LABEL",
        "AGGREGATE_TUNING_HOURS",
        "CHANNEL_OR_PROGRAM_NAME",
        "PLAY_FREQUENCY",
      ],
      ...body,
    ]);

    const startSource = startDate || tracks[0]?.played_at || new Date().toISOString();
    const endSource = endDate || tracks[tracks.length - 1]?.played_at || new Date().toISOString();
    return {
      content,
      filename: `${toCompactDate(startSource)}-${toCompactDate(endSource)}_B.txt`,
      mimeType: "text/plain; charset=utf-8",
    };
  }

  if (reportType === "BMI_MUSIC_PLAYS") {
    const reportPeriod = toQuarterLabel(startDate || tracks[0]?.played_at || new Date().toISOString());
    const rows = tracks.map((row, index) => [
      reportPeriod,
      row.id || index + 1,
      row.title || "",
      row.artist || "",
      "",
      toBmiDateTime(row.played_at),
      "",
    ]);
    return {
      content: toCsv([["Report Period", "ID", "Song Title", "Artist Name", "Writer", "Date Played", "ISRC"], ...rows]),
      filename: `bmi_music_plays_${startDate || "start"}_${endDate || "end"}.csv`,
      mimeType: "text/csv; charset=utf-8",
    };
  }

  throw new Error("unsupported report_type");
}

async function buildAdminShows() {
  const rows = await directusRequest("/items/shows", {
    fields: "id,slug,title,show_type,is_active",
    sort: "title",
    limit: "-1",
  });

  const showLinks = await directusRequest("/items/show_djs", {
    fields: "show,dj.id,dj.name,role",
    sort: "dj.name",
    limit: "-1",
  });

  const scheduleRows = await directusRequest("/items/schedule_slots", {
    fields: "show",
    limit: "-1",
  });
  const scheduledShowIds = new Set(
    scheduleRows
      .map((row) => Number(row?.show || 0))
      .filter((id) => Number.isInteger(id) && id > 0),
  );

  const djsByShow = {};
  for (const row of showLinks) {
    const showId = Number(row?.show || 0);
    if (!Number.isInteger(showId) || showId <= 0) continue;
    if (!djsByShow[showId]) djsByShow[showId] = [];
    if (!row?.dj?.id) continue;
    djsByShow[showId].push({
      id: row.dj.id,
      name: row.dj.name || "",
      role: row.role || null,
    });
  }

  const items = rows.map((row) => ({
    ...row,
    djs: djsByShow[row.id] || [],
    is_scheduled: scheduledShowIds.has(Number(row.id)),
  }));

  return {
    count: items.length,
    items,
  };
}

function validateAdminShowPayload(input, existing) {
  const title = input.title == null ? existing.title : String(input.title).trim();
  const slug = input.slug == null ? existing.slug : String(input.slug).trim();
  const description = input.description == null ? existing.description : String(input.description);
  const showType = input.show_type == null ? existing.show_type : String(input.show_type).trim();
  const isActive = input.is_active == null ? Boolean(existing.is_active) : Boolean(input.is_active);

  if (!title) throw new Error("title is required");
  if (!slug) throw new Error("slug is required");
  if (!showType) throw new Error("show_type is required");

  const allowed = new Set(["music", "talk", "mixed", "special"]);
  if (!allowed.has(showType)) {
    throw new Error("show_type must be one of: music, talk, mixed, special");
  }

  return {
    title,
    slug,
    description,
    show_type: showType,
    is_active: isActive,
  };
}

function slugifyText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function validateAdminDjPayload(input, existing = null) {
  const name = input.name == null ? existing?.name : String(input.name).trim();
  const slugCandidate = input.slug == null ? existing?.slug : String(input.slug).trim();
  const slug = slugifyText(slugCandidate || name);
  const bio = input.bio == null ? existing?.bio : String(input.bio);
  const imageUrl = input.image_url == null ? existing?.image_url : String(input.image_url);

  if (!name) throw new Error("name is required");
  if (!slug) throw new Error("slug is required");

  return {
    name,
    slug,
    bio,
    image_url: imageUrl || null,
    is_active: true,
  };
}

async function buildAdminDjs() {
  const rows = await directusRequest("/items/djs", {
    fields: "id,slug,name,bio,image_url,is_active",
    sort: "name",
    limit: "-1",
  });
  return {
    count: rows.length,
    items: rows,
  };
}

async function attachDjToShow(showId, djId, role = "host") {
  const existing = await directusRequest("/items/show_djs", {
    "filter[show][_eq]": String(showId),
    "filter[dj][_eq]": String(djId),
    fields: "id,role",
    limit: "1",
  });
  if (existing[0]) {
    const updated = await directusUpdateItem("show_djs", existing[0].id, { role: role || existing[0].role || "host" });
    return { mode: "updated", item: updated };
  }
  const created = await directusCreateItem("show_djs", {
    show: Number(showId),
    dj: Number(djId),
    role: role || "host",
  });
  return { mode: "created", item: created };
}

async function detachDjFromShow(showId, djId) {
  const existing = await directusRequest("/items/show_djs", {
    "filter[show][_eq]": String(showId),
    "filter[dj][_eq]": String(djId),
    fields: "id",
    limit: "-1",
  });

  if (!existing.length) return { removed: 0 };

  for (const row of existing) {
    if (row?.id != null) {
      await directusDeleteItem("show_djs", row.id);
    }
  }

  return { removed: existing.length };
}

async function buildAdminScheduleSlots() {
  const rows = await directusRequest("/items/schedule_slots", {
    fields: "id,slot_key,weekday,start_time,end_time,timezone,show",
    sort: "weekday,start_time",
    limit: "-1",
  });
  const showIds = [...new Set(rows.map((row) => row.show).filter(Boolean))];
  const showsById = await getShowsByIds(showIds);
  return {
    count: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      slot_key: row.slot_key || null,
      weekday: Number(row.weekday),
      start_time: row.start_time,
      end_time: row.end_time,
      timezone: row.timezone || defaultTimezone,
      show: row.show,
      show_data: safeShowSummary(showsById[row.show] || null),
    })),
  };
}

function compareBroadcastDesc(a, b) {
  if (a.date_local !== b.date_local) return a.date_local < b.date_local ? 1 : -1;
  return parseClockToMinutes(b.end_time) - parseClockToMinutes(a.end_time);
}

function buildRecentBroadcastsForSlots(slots, timezone, limit = 2, options = {}) {
  const includeCurrent = Boolean(options.includeCurrent);
  const now = new Date();
  const zonedNow = getZonedParts(now, timezone);
  const today = toDateOnlyString(zonedNow);
  const results = [];

  for (const slot of slots) {
    const slotWeekday = Number(slot.weekday);
    if (!Number.isInteger(slotWeekday) || slotWeekday < 1 || slotWeekday > 7) continue;

    const daysBack = ((zonedNow.weekday || 1) - slotWeekday + 7) % 7;
    const start = parseClockToMinutes(slot.start_time);
    const rawEnd = parseClockToMinutes(slot.end_time);
    if (start == null || rawEnd == null) continue;
    const end = rawEnd > start ? rawEnd : rawEnd === 0 ? 24 * 60 : rawEnd;

    for (const weekOffset of [0, 7, 14]) {
      const dateLocal = shiftDate(today, -(daysBack + weekOffset));
      const isToday = weekOffset === 0 && daysBack === 0;
      if (isToday && zonedNow.minuteOfDay < end && !includeCurrent) continue;

      results.push({
        key: `${dateLocal}|${slot.start_time}|${slot.end_time}`,
        date_local: dateLocal,
        weekday: slotWeekday,
        weekday_name: weekdayNames[slotWeekday - 1],
        start_time: slot.start_time,
        end_time: slot.end_time,
        timezone,
        in_progress: isToday && zonedNow.minuteOfDay >= start && zonedNow.minuteOfDay < end,
      });
    }
  }

  results.sort(compareBroadcastDesc);
  return results.slice(0, limit);
}

async function buildAdminShowInsights(showId, options = {}) {
  const id = Number(showId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const showRows = await directusRequest("/items/shows", {
    "filter[id][_eq]": String(id),
    fields: "id,slug,title,description,artwork_url,show_type,is_active",
    limit: "1",
  });
  const show = showRows[0] || null;
  if (!show) return null;

  const slotRows = await directusRequest("/items/schedule_slots", {
    "filter[show][_eq]": String(id),
    fields: "id,weekday,start_time,end_time,timezone",
    sort: "weekday,start_time",
    limit: "-1",
  });

  const timezone = slotRows[0]?.timezone || defaultTimezone;
  const recentBroadcasts = buildRecentBroadcastsForSlots(slotRows, timezone, 2, {
    includeCurrent: Boolean(options.includeCurrent),
  });

  const showDjs = await directusRequest("/items/show_djs", {
    "filter[show][_eq]": String(id),
    fields: "role,dj.id,dj.slug,dj.name,dj.bio,dj.image_url",
    sort: "dj.name",
    limit: "-1",
  });

  const tracks = await directusRequest("/items/playlist_tracks", {
    "filter[show][_eq]": String(id),
    fields: "id,played_at,artist,title,album,confidence,provider",
    sort: "-played_at",
    limit: "250",
  });

  const broadcastTracks = {};
  for (const broadcast of recentBroadcasts) {
    broadcastTracks[broadcast.key] = [];
  }

  for (const row of tracks) {
    if (!row.played_at) continue;
    const playedDate = new Date(row.played_at);
    if (Number.isNaN(playedDate.getTime())) continue;
    const playedParts = getZonedParts(playedDate, timezone);
    const playedDateLocal = toDateOnlyString(playedParts);
    const playedMinute = playedParts.minuteOfDay;

    for (const broadcast of recentBroadcasts) {
      if (broadcast.date_local !== playedDateLocal) continue;
      const start = parseClockToMinutes(broadcast.start_time);
      const endRaw = parseClockToMinutes(broadcast.end_time);
      if (start == null || endRaw == null) continue;
      const end = endRaw > start ? endRaw : endRaw === 0 ? 24 * 60 : endRaw;
      if (playedMinute >= start && playedMinute < end) {
        broadcastTracks[broadcast.key].push({
          id: row.id,
          played_at: row.played_at,
          artist: row.artist || null,
          title: row.title || null,
          album: row.album || null,
          confidence: row.confidence == null ? null : Number(row.confidence),
          provider: row.provider || null,
        });
      }
    }
  }

  const playlistByBroadcast = recentBroadcasts.map((broadcast) => ({
    broadcast_key: broadcast.key,
    tracks: (broadcastTracks[broadcast.key] || []).sort((a, b) =>
      new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
    ),
  }));

  return {
    show: {
      ...safeShowSummary(show),
      is_active: Boolean(show.is_active),
      is_scheduled: slotRows.length > 0,
    },
    djs: showDjs
      .map((row) => ({
        role: row.role || null,
        dj: row.dj
          ? {
              id: row.dj.id,
              slug: row.dj.slug,
              name: row.dj.name,
              bio: row.dj.bio || null,
              image_url: row.dj.image_url || null,
            }
          : null,
      }))
      .filter((row) => row.dj),
    weekly_slots: slotRows.map((row) => ({
      id: row.id,
      weekday: Number(row.weekday),
      weekday_name: weekdayNames[Number(row.weekday) - 1] || null,
      start_time: row.start_time,
      end_time: row.end_time,
      timezone: row.timezone || timezone,
    })),
    recent_broadcasts: recentBroadcasts.map((item) => ({
      ...item,
      playlist_count: (broadcastTracks[item.key] || []).length,
    })),
    playlist_by_broadcast: playlistByBroadcast,
    playlist_recent: tracks.map((row) => ({
      id: row.id,
      played_at: row.played_at,
      artist: row.artist || null,
      title: row.title || null,
      album: row.album || null,
      confidence: row.confidence == null ? null : Number(row.confidence),
      provider: row.provider || null,
    })),
  };
}

async function buildShowInsightsBySlug(slug, options = {}) {
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) return null;

  const showRows = await directusRequest("/items/shows", {
    "filter[slug][_eq]": cleanSlug,
    fields: "id",
    limit: "1",
  });
  const show = showRows[0] || null;
  if (!show?.id) return null;

  return buildAdminShowInsights(show.id, options);
}

function getClientIp(req) {
  const cfIp = req.headers["cf-connecting-ip"];
  if (typeof cfIp === "string" && cfIp.trim()) return cfIp.trim();
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function getCorsHeaders(req) {
  const requestOrigin = req.headers.origin;
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-ACR-SECRET, X-RADIANT-ADMIN-TOKEN",
    "Access-Control-Max-Age": "600",
  };

  if (!requestOrigin) return headers;

  if (allowedOrigins.size === 0 || allowedOrigins.has(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
  }

  return headers;
}

function isRateLimited(req) {
  const now = Date.now();
  const ip = getClientIp(req);
  const bucket = rateBuckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > rateLimitMax;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const run = async () => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = requestUrl.pathname;
  const corsHeaders = getCorsHeaders(req);
  const acrPath = `/${apiVersion}/acrcloud/callback`;
  const isAcrCallback = path === acrPath && req.method === "POST";
  const isAdminPath = path.startsWith(`/${apiVersion}/admin/`);

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {}, corsHeaders);
  }

  if (!isAcrCallback && !isAdminPath && isRateLimited(req)) {
    return sendJson(
      res,
      429,
      {
        error: "rate_limited",
        message: "Too many requests. Please retry shortly.",
      },
      corsHeaders,
    );
  }

  if (path === "/healthz") {
    return sendJson(res, 200, { status: "ok", service: "radiant-api" }, corsHeaders);
  }

  if (path === "/readyz") {
    return sendJson(
      res,
      200,
      {
        status: "ready",
        service: "radiant-api",
        version: apiVersion,
        startedAt,
      },
      corsHeaders,
    );
  }

  if (path === `/${apiVersion}`) {
    return sendJson(
      res,
      200,
      {
        name: "Radiant API",
        version: apiVersion,
        endpoints: [
          `/${apiVersion}/now-playing`,
          `/${apiVersion}/schedule`,
          `/${apiVersion}/schedule/live`,
          `/${apiVersion}/shows/:slug`,
          `/${apiVersion}/djs/:slug`,
          `/${apiVersion}/playlist/recent`,
          `/${apiVersion}/status/site-settings`,
          `/${apiVersion}/status/icecast/summary`,
          `/${apiVersion}/status/icecast/geo`,
          `/${apiVersion}/admin/shows (internal)`,
          `/${apiVersion}/admin/shows/:id/insights (internal)`,
          `/${apiVersion}/admin/djs (internal)`,
          `/${apiVersion}/admin/djs/:id (internal)`,
          `/${apiVersion}/admin/shows/:id/djs (internal)`,
          `/${apiVersion}/admin/shows/:id/djs/:djId (internal)`,
          `/${apiVersion}/admin/schedule/slots (internal)`,
          `/${apiVersion}/admin/settings/icecast (internal)`,
          `/${apiVersion}/admin/settings/icecast/test (internal)`,
          `/${apiVersion}/admin/stats/icecast/summary (internal)`,
          `/${apiVersion}/admin/stats/icecast/geo (internal)`,
          `/${apiVersion}/acrcloud/callback (internal)`,
        ],
      },
      corsHeaders,
    );
  }

  if (path === `/${apiVersion}/status/icecast/summary` && req.method === "GET") {
    const snapshot = await getIcecastSnapshotForRead();
    if (!snapshot.enabled) {
      return sendJson(
        res,
        200,
        {
          enabled: false,
          reason: snapshot.reason,
          summary: null,
        },
        corsHeaders,
      );
    }
    const history = await loadListenerHistory();
    return sendJson(
      res,
      200,
      {
        enabled: true,
        summary: summarizeIcecastStats(snapshot, history),
      },
      corsHeaders,
    );
  }

  if (path === `/${apiVersion}/status/icecast/geo` && req.method === "GET") {
    const rangeRaw = String(requestUrl.searchParams.get("range") || "current").trim().toLowerCase();
    const range = rangeRaw === "24h" || rangeRaw === "all" ? rangeRaw : "current";
    const granularityRaw = String(requestUrl.searchParams.get("granularity") || "country").trim().toLowerCase();
    const granularity = ["country", "region", "city"].includes(granularityRaw) ? granularityRaw : "country";
    const snapshot = await getIcecastSnapshotForRead();
    if (!snapshot.enabled) {
      return sendJson(
        res,
        200,
        {
          enabled: false,
          reason: snapshot.reason,
          range,
          granularity,
          items: [],
        },
        corsHeaders,
      );
    }
    const history = await loadListenerHistory();
    const rows = filterHistoryByRange(history, range, snapshot.listeners || []);
    return sendJson(
      res,
      200,
      {
        enabled: true,
        range,
        granularity,
        items: aggregateGeoRows(rows, granularity),
        listeners_considered: rows.length,
      },
      corsHeaders,
    );
  }

  if (path === `/${apiVersion}/status/site-settings` && req.method === "GET") {
    const config = await loadIcecastConfig();
    return sendJson(
      res,
      200,
      {
        item: {
          public_status_title: String(config.public_status_title || "").trim() || "Public Status",
          admin_title: String(config.admin_title || "").trim() || "KAAD-lp Admin",
        },
      },
      corsHeaders,
    );
  }

  if (path.startsWith(`/${apiVersion}/admin/`)) {
    if (!isValidAdminRequest(req)) {
      return sendJson(res, 401, { error: "unauthorized" }, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/shows` && req.method === "GET") {
      const payload = await buildAdminShows();
      return sendJson(res, 200, payload, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/reports/types` && req.method === "GET") {
      return sendJson(
        res,
        200,
        {
          items: REPORT_TYPES.map((item) => ({
            ...item,
            status: item.available ? "ready" : "in_development",
          })),
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/reports/generate` && req.method === "POST") {
      const body = await readJsonBody(req);
      const reportType = String(body?.report_type || "").trim();
      const startDate = body?.start_date ? String(body.start_date) : "";
      const endDate = body?.end_date ? String(body.end_date) : "";
      const reportTypeConfig = REPORT_TYPE_MAP[reportType];
      if (!reportTypeConfig) {
        return sendJson(res, 400, { error: "unsupported_report_type" }, corsHeaders);
      }
      if (!reportTypeConfig.available) {
        return sendJson(
          res,
          400,
          {
            error: "report_in_development",
            message: `${reportType} is currently in development and not yet available.`,
          },
          corsHeaders,
        );
      }

      const report = await buildReportExport(reportType, startDate, endDate);
      const fallbackExt = report?.mimeType && report.mimeType.includes("csv") ? "csv" : "txt";
      const filename = report?.filename || `${reportType.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${fallbackExt}`;
      return sendJson(
        res,
        200,
        {
          report_type: reportType,
          filename,
          mime_type: report?.mimeType || "text/plain; charset=utf-8",
          content: report?.content || "",
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/settings/icecast` && req.method === "GET") {
      const config = await loadIcecastConfig();
      return sendJson(
        res,
        200,
        {
          item: sanitizeIcecastConfigForClient(config),
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/settings/icecast` && req.method === "PATCH") {
      const current = await loadIcecastConfig();
      const body = await readJsonBody(req);
      const keepPassword = body?.password == null || String(body.password) === "";
      const next = normalizeIcecastConfig(
        {
          admin_title: body?.admin_title,
          public_status_title: body?.public_status_title,
          enabled: body?.enabled,
          scheme: body?.scheme,
          host: body?.host,
          port: body?.port,
          mount: body?.mount,
          username: body?.username,
          password: keepPassword ? current.password : String(body.password || ""),
        },
        current,
      );
      const saved = await writeIcecastConfig(next);
      return sendJson(
        res,
        200,
        {
          item: sanitizeIcecastConfigForClient(saved),
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/settings/icecast/test` && req.method === "POST") {
      const config = await loadIcecastConfig();
      const snapshot = await resolveNowPlayingPayload(defaultTimezone, new Date());
      const songText = buildIcecastSongTextFromNowPlaying(snapshot);
      if (!songText) {
        return sendJson(
          res,
          409,
          {
            tested: false,
            error: "nothing_to_send",
            now_playing_source: snapshot.source,
            message: "No track or show title is available to send to Icecast.",
          },
          corsHeaders,
        );
      }

      const pushResult = await pushIcecastMetadata(songText, { config, allowDisabled: true });
      return sendJson(
        res,
        pushResult.updated ? 200 : 502,
        {
          tested: pushResult.updated,
          now_playing_source: snapshot.source,
          song: songText,
          push: pushResult,
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/stats/icecast/summary` && req.method === "GET") {
      const snapshot = await getIcecastSnapshotForRead();
      if (!snapshot.enabled) {
        return sendJson(
          res,
          200,
          {
            enabled: false,
            reason: snapshot.reason,
            summary: null,
          },
          corsHeaders,
        );
      }
      const history = await loadListenerHistory();
      return sendJson(
        res,
        200,
        {
          enabled: true,
          summary: summarizeIcecastStats(snapshot, history),
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/stats/icecast/geo` && req.method === "GET") {
      const rangeRaw = String(requestUrl.searchParams.get("range") || "current").trim().toLowerCase();
      const range = rangeRaw === "24h" || rangeRaw === "all" ? rangeRaw : "current";
      const granularityRaw = String(requestUrl.searchParams.get("granularity") || "country").trim().toLowerCase();
      const granularity = ["country", "region", "city"].includes(granularityRaw) ? granularityRaw : "country";
      const snapshot = await getIcecastSnapshotForRead();
      if (!snapshot.enabled) {
        return sendJson(
          res,
          200,
          {
            enabled: false,
            reason: snapshot.reason,
            range,
            granularity,
            items: [],
          },
          corsHeaders,
        );
      }
      const history = await loadListenerHistory();
      const rows = filterHistoryByRange(history, range, snapshot.listeners || []);
      return sendJson(
        res,
        200,
        {
          enabled: true,
          range,
          granularity,
          items: aggregateGeoRows(rows, granularity),
          listeners_considered: rows.length,
        },
        corsHeaders,
      );
    }

    if (path === `/${apiVersion}/admin/djs` && req.method === "GET") {
      const payload = await buildAdminDjs();
      return sendJson(res, 200, payload, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/djs` && req.method === "POST") {
      const body = await readJsonBody(req);
      let payload;
      try {
        payload = validateAdminDjPayload(body);
      } catch (error) {
        return sendJson(res, 400, { error: "invalid_payload", message: error.message }, corsHeaders);
      }
      const created = await directusCreateItem("djs", payload);
      return sendJson(res, 201, { item: created }, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/djs/`) && req.method === "PATCH") {
      const rawId = path.replace(`/${apiVersion}/admin/djs/`, "");
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return sendJson(res, 400, { error: "invalid_id" }, corsHeaders);
      }
      const rows = await directusRequest("/items/djs", {
        "filter[id][_eq]": String(id),
        fields: "id,name,slug,bio,image_url,is_active",
        limit: "1",
      });
      const existing = rows[0] || null;
      if (!existing) return sendJson(res, 404, { error: "not_found", id }, corsHeaders);

      const body = await readJsonBody(req);
      let payload;
      try {
        payload = validateAdminDjPayload(body, existing);
      } catch (error) {
        return sendJson(res, 400, { error: "invalid_payload", message: error.message }, corsHeaders);
      }
      const updated = await directusUpdateItem("djs", id, payload);
      return sendJson(res, 200, { item: updated }, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/shows/`) && path.endsWith("/insights") && req.method === "GET") {
      const rawId = path.replace(`/${apiVersion}/admin/shows/`, "").replace("/insights", "");
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return sendJson(res, 400, { error: "invalid_id" }, corsHeaders);
      }
      const payload = await buildAdminShowInsights(id);
      if (!payload) return sendJson(res, 404, { error: "not_found", id }, corsHeaders);
      return sendJson(res, 200, payload, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/shows/`) && path.endsWith("/djs") && req.method === "POST") {
      const rawId = path.replace(`/${apiVersion}/admin/shows/`, "").replace("/djs", "");
      const showId = Number(rawId);
      if (!Number.isInteger(showId) || showId <= 0) {
        return sendJson(res, 400, { error: "invalid_show_id" }, corsHeaders);
      }
      const body = await readJsonBody(req);
      const djId = Number(body?.dj_id);
      const role = body?.role ? String(body.role) : "host";
      if (!Number.isInteger(djId) || djId <= 0) {
        return sendJson(res, 400, { error: "invalid_dj_id" }, corsHeaders);
      }
      const attached = await attachDjToShow(showId, djId, role);
      return sendJson(res, 200, attached, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/shows/`) && path.includes("/djs/") && req.method === "DELETE") {
      const raw = path.replace(`/${apiVersion}/admin/shows/`, "");
      const [showRaw, djRawWithPrefix] = raw.split("/djs/");
      const showId = Number(showRaw);
      const djId = Number(djRawWithPrefix);
      if (!Number.isInteger(showId) || showId <= 0) {
        return sendJson(res, 400, { error: "invalid_show_id" }, corsHeaders);
      }
      if (!Number.isInteger(djId) || djId <= 0) {
        return sendJson(res, 400, { error: "invalid_dj_id" }, corsHeaders);
      }
      const result = await detachDjFromShow(showId, djId);
      return sendJson(res, 200, { deleted: true, ...result }, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/shows/`) && req.method === "PATCH") {
      const rawId = path.replace(`/${apiVersion}/admin/shows/`, "");
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return sendJson(res, 400, { error: "invalid_id" }, corsHeaders);
      }
      const rows = await directusRequest("/items/shows", {
        "filter[id][_eq]": String(id),
        fields: "id,title,slug,description,show_type,is_active",
        limit: "1",
      });
      const existing = rows[0] || null;
      if (!existing) return sendJson(res, 404, { error: "not_found", id }, corsHeaders);

      const body = await readJsonBody(req);
      let payload;
      try {
        payload = validateAdminShowPayload(body, existing);
      } catch (error) {
        return sendJson(res, 400, { error: "invalid_payload", message: error.message }, corsHeaders);
      }
      const updated = await directusUpdateItem("shows", id, payload);
      return sendJson(res, 200, { item: updated }, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/schedule/slots` && req.method === "GET") {
      const payload = await buildAdminScheduleSlots();
      return sendJson(res, 200, payload, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/schedule/slots` && req.method === "POST") {
      const body = await readJsonBody(req);
      const payload = validateScheduleSlotPayload(body);
      const created = await directusCreateItem("schedule_slots", payload);
      return sendJson(res, 201, { item: created }, corsHeaders);
    }

    if (path === `/${apiVersion}/admin/schedule/alternating` && req.method === "POST") {
      const body = await readJsonBody(req);
      try {
        const result = await createAlternatingOverrides(body);
        return sendJson(res, 200, result, corsHeaders);
      } catch (error) {
        return sendJson(res, 400, { error: "invalid_payload", message: error.message }, corsHeaders);
      }
    }

    if (path.startsWith(`/${apiVersion}/admin/schedule/slots/`) && req.method === "PATCH") {
      const rawId = path.split(`/${apiVersion}/admin/schedule/slots/`)[1] || "";
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return sendJson(res, 400, { error: "invalid_id" }, corsHeaders);
      }
      const existingRows = await directusRequest("/items/schedule_slots", {
        "filter[id][_eq]": String(id),
        fields: "id,slot_key,weekday,start_time,end_time,timezone,show",
        limit: "1",
      });
      const existing = existingRows[0] || null;
      if (!existing) {
        return sendJson(res, 404, { error: "not_found", id }, corsHeaders);
      }
      const body = await readJsonBody(req);
      const payload = validateScheduleSlotPayload(body, existing);
      const updated = await directusUpdateItem("schedule_slots", id, payload);
      return sendJson(res, 200, { item: updated }, corsHeaders);
    }

    if (path.startsWith(`/${apiVersion}/admin/schedule/slots/`) && req.method === "DELETE") {
      const rawId = path.split(`/${apiVersion}/admin/schedule/slots/`)[1] || "";
      const id = Number(rawId);
      if (!Number.isInteger(id) || id <= 0) {
        return sendJson(res, 400, { error: "invalid_id" }, corsHeaders);
      }
      await directusDeleteItem("schedule_slots", id);
      return sendJson(res, 200, { deleted: true, id }, corsHeaders);
    }
  }

  if (isAcrCallback) {
    if (!acrCallbackSecret && !acrCallbackToken) {
      return sendJson(
        res,
        503,
        { error: "not_configured", message: "ACRCloud callback auth values missing" },
        corsHeaders,
      );
    }
    if (!isValidAcrCallbackAuth(req, requestUrl)) {
      return sendJson(res, 401, { error: "unauthorized" }, corsHeaders);
    }
    const body = await readJsonBody(req);
    const result = await ingestAcrcloudPayload(body);
    let icecast = { attempted: false, updated: false, reason: "not_inserted" };
    if (result.inserted) {
      const songText = buildIcecastSongText({
        artist: result.artist,
        title: result.title,
        showTitle: result.show_title,
      });
      icecast = await pushIcecastMetadata(songText);
    }
    return sendJson(res, 200, { status: "accepted", ...result, icecast }, corsHeaders);
  }

  if (path === `/${apiVersion}/schedule` && req.method === "GET") {
    const timezone = requestUrl.searchParams.get("tz") || defaultTimezone;
    const weekStart = requestUrl.searchParams.get("week_start");
    const payload = await buildScheduleWeek(weekStart, timezone);
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path === `/${apiVersion}/schedule/live` && req.method === "GET") {
    const timezone = requestUrl.searchParams.get("tz") || defaultTimezone;
    const at = requestUrl.searchParams.get("at") || new Date().toISOString();
    const resolved = await resolveLiveSchedule(at, timezone);
    return sendJson(
      res,
      200,
      {
        at,
        timezone,
        ...resolved,
      },
      corsHeaders,
    );
  }

  if (path === `/${apiVersion}/now-playing` && req.method === "GET") {
    const timezone = requestUrl.searchParams.get("tz") || defaultTimezone;
    const payload = await resolveNowPlayingPayload(timezone, new Date());
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path.startsWith(`/${apiVersion}/shows/`) && path.endsWith("/insights") && req.method === "GET") {
    const prefix = `/${apiVersion}/shows/`;
    const suffix = "/insights";
    const rawSlug = path.slice(prefix.length, -suffix.length);
    const slug = decodeURIComponent(rawSlug || "").trim();
    if (!slug || slug.includes("/")) return sendJson(res, 400, { error: "invalid_slug" }, corsHeaders);
    const includeCurrent = String(requestUrl.searchParams.get("include_current") || "").trim() === "1";
    const payload = await buildShowInsightsBySlug(slug, { includeCurrent });
    if (!payload) return sendJson(res, 404, { error: "not_found", slug }, corsHeaders);
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path.startsWith(`/${apiVersion}/shows/`) && req.method === "GET") {
    const slug = decodeURIComponent(path.split(`/${apiVersion}/shows/`)[1] || "").trim();
    if (!slug) return sendJson(res, 400, { error: "invalid_slug" }, corsHeaders);
    const payload = await buildShowDetails(slug);
    if (!payload) return sendJson(res, 404, { error: "not_found", slug }, corsHeaders);
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path.startsWith(`/${apiVersion}/djs/`) && req.method === "GET") {
    const slug = decodeURIComponent(path.split(`/${apiVersion}/djs/`)[1] || "").trim();
    if (!slug) return sendJson(res, 400, { error: "invalid_slug" }, corsHeaders);
    const payload = await buildDjDetails(slug);
    if (!payload) return sendJson(res, 404, { error: "not_found", slug }, corsHeaders);
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path === `/${apiVersion}/playlist/recent` && req.method === "GET") {
    const limit = requestUrl.searchParams.get("limit");
    const payload = await buildPlaylistRecent(limit);
    return sendJson(res, 200, payload, corsHeaders);
  }

  if (path.startsWith(`/${apiVersion}/`)) {
    return sendJson(res, 404, { error: "not_found", path }, corsHeaders);
  }

  return sendJson(res, 404, { error: "not_found", path }, corsHeaders);
  };

  run().catch((error) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const corsHeaders = getCorsHeaders(req);
    return sendJson(
      res,
      500,
      {
        error: "internal_error",
        message: "Request failed",
        path: requestUrl.pathname,
        detail: error?.message || String(error),
      },
      corsHeaders,
    );
  });
});

server.listen(port, () => {
  startIcecastCollectorLoop();
  process.stdout.write(`Radiant API listening on ${port}\n`);
});
