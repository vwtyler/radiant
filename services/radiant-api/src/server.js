const http = require("node:http");
const crypto = require("node:crypto");
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

let directusToken = null;

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

function toIsoUtc(timestampUtc) {
  if (!timestampUtc || typeof timestampUtc !== "string") return null;
  const trimmed = timestampUtc.trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes("T") ? trimmed : `${trimmed.replace(" ", "T")}Z`;
  const dt = new Date(candidate);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
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

function isTrackFreshAndConfident(track, now) {
  if (!track?.played_at) return false;
  const confidence = Number(track.confidence || 0);
  if (confidence < nowPlayingConfidenceMin) return false;
  const ageSec = (now.getTime() - new Date(track.played_at).getTime()) / 1000;
  return ageSec >= 0 && ageSec <= nowPlayingFreshSeconds;
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
  const artist = (top.artists || []).map((a) => a?.name).filter(Boolean).join(", ") || null;
  const title = top.title || null;
  if (!artist || !title) {
    return { inserted: false, reason: "missing_artist_or_title" };
  }

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
    reason: "inserted",
    id: created?.id || null,
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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-ACR-SECRET",
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

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {}, corsHeaders);
  }

  if (!isAcrCallback && isRateLimited(req)) {
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
          `/${apiVersion}/acrcloud/callback (internal)`,
        ],
      },
      corsHeaders,
    );
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
    return sendJson(res, 200, { status: "accepted", ...result }, corsHeaders);
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
    const now = new Date();
    const [track, live] = await Promise.all([getRecentTrack(), resolveLiveSchedule(now.toISOString(), timezone)]);

    if (track && isTrackFreshAndConfident(track, now)) {
      const showMap = await getShowsByIds(track.show ? [track.show] : []);
      return sendJson(
        res,
        200,
        {
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
        },
        corsHeaders,
      );
    }

    return sendJson(
      res,
      200,
      {
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
      },
      corsHeaders,
    );
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
  process.stdout.write(`Radiant API listening on ${port}\n`);
});
