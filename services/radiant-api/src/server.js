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
const radiantAdminToken = process.env.RADIANT_ADMIN_TOKEN || "";

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
  return {
    count: rows.length,
    items: rows,
  };
}

function validateAdminShowPayload(input, existing) {
  const title = input.title == null ? existing.title : String(input.title).trim();
  const slug = input.slug == null ? existing.slug : String(input.slug).trim();
  const description = input.description == null ? existing.description : String(input.description);
  const showType = input.show_type == null ? existing.show_type : String(input.show_type).trim();

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
    fields: "id,slug,title,description,artwork_url,show_type",
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
    show: safeShowSummary(show),
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
          `/${apiVersion}/admin/shows (internal)`,
          `/${apiVersion}/admin/shows/:id/insights (internal)`,
          `/${apiVersion}/admin/djs (internal)`,
          `/${apiVersion}/admin/djs/:id (internal)`,
          `/${apiVersion}/admin/shows/:id/djs (internal)`,
          `/${apiVersion}/admin/shows/:id/djs/:djId (internal)`,
          `/${apiVersion}/admin/schedule/slots (internal)`,
          `/${apiVersion}/acrcloud/callback (internal)`,
        ],
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
        fields: "id,title,slug,description,show_type",
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

    const liveShowTrack = await getRecentTrackForLiveShowWindow(live, now);
    if (liveShowTrack) {
      const showMap = await getShowsByIds(liveShowTrack.show ? [liveShowTrack.show] : []);
      return sendJson(
        res,
        200,
        {
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
  process.stdout.write(`Radiant API listening on ${port}\n`);
});
