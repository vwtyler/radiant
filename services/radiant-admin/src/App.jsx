import React, { useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import countries110m from "world-atlas/countries-110m.json";
import { apiAdapter } from "./lib/apiAdapter";
import { AuthProvider, useAuth, LoginPage, UserMenu, AcceptInvitePage, ForgotPasswordPage, ResetPasswordPage } from "./auth";

const DAYS = [
  { num: 7, label: "Sun" },
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
];

const RECURRENCE_OPTIONS = [
  { value: "every_week", label: "Every Week" },
  { value: "first_third", label: "1st and 3rd" },
  { value: "second_fourth", label: "2nd and 4th" },
  { value: "fifth", label: "5th only" },
];

function normalizeScheduleRule(value) {
  const text = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (!text || text === "every_week" || text === "weekly") return "every_week";
  if (text === "first_third" || text === "first_and_third" || text === "1st_3rd") return "first_third";
  if (text === "second_fourth" || text === "second_and_fourth" || text === "2nd_4th") return "second_fourth";
  if (text === "fifth" || text === "5th") return "fifth";
  return "every_week";
}

function recurrenceLabel(rule) {
  const normalized = normalizeScheduleRule(rule);
  return RECURRENCE_OPTIONS.find((item) => item.value === normalized)?.label || "Every Week";
}

function recurrenceRulesOverlap(aRule, bRule) {
  const a = normalizeScheduleRule(aRule);
  const b = normalizeScheduleRule(bRule);
  if (a === "every_week" || b === "every_week") return true;
  if (a === b) return true;
  return false;
}

function getWeekdayOccurrenceFromDateLocal(dateLocal) {
  const match = String(dateLocal || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const day = Number(match[3]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return Math.floor((day - 1) / 7) + 1;
}

function recurrenceAppliesToDate(rule, dateLocal) {
  const normalized = normalizeScheduleRule(rule);
  const occurrence = getWeekdayOccurrenceFromDateLocal(dateLocal);
  if (!occurrence) return true;
  if (normalized === "first_third") return occurrence === 1 || occurrence === 3;
  if (normalized === "second_fourth") return occurrence === 2 || occurrence === 4;
  if (normalized === "fifth") return occurrence === 5;
  return true;
}

function parseAlternatingGroup(slotKey) {
  const raw = String(slotKey || "");
  if (!raw.startsWith("altgrp:")) return "";
  const rest = raw.slice("altgrp:".length);
  const [group] = rest.split("::");
  return String(group || "").trim().toLowerCase();
}

function getEffectiveRuleForSlot(windowSlots, slot) {
  const explicit = normalizeScheduleRule(slot?.special_rule);
  if (explicit !== "every_week") return explicit;

  const rows = Array.isArray(windowSlots) ? windowSlots : [];
  const hasExplicit = rows.some((item) => normalizeScheduleRule(item?.special_rule) !== "every_week");
  if (hasExplicit) return explicit;

  const targetGroup = parseAlternatingGroup(slot?.slot_key);
  if (!targetGroup) return explicit;

  const grouped = rows
    .filter((item) => parseAlternatingGroup(item?.slot_key) === targetGroup)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (grouped.length < 2) return explicit;

  const index = grouped.findIndex((item) => item.id === slot.id);
  if (index === 0) return "first_third";
  if (index === 1) return "second_fourth";
  return "fifth";
}

function resolveVisibleSlotsForDate(daySlots, dateLocal) {
  const rows = Array.isArray(daySlots) ? daySlots : [];
  const byWindow = new Map();
  for (const slot of rows) {
    const key = `${slot.start_time}|${slot.end_time}|${slot.timezone || ""}`;
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key).push(slot);
  }

  const selected = [];
  for (const windowSlots of byWindow.values()) {
    const applicable = windowSlots
      .map((slot) => ({ slot, rule: getEffectiveRuleForSlot(windowSlots, slot) }))
      .filter((item) => recurrenceAppliesToDate(item.rule, dateLocal));
    if (!applicable.length) continue;
    applicable.sort((a, b) => {
      const aSpecific = a.rule === "every_week" ? 0 : 1;
      const bSpecific = b.rule === "every_week" ? 0 : 1;
      if (aSpecific !== bSpecific) return bSpecific - aSpecific;
      return String(a.slot.id).localeCompare(String(b.slot.id));
    });
    selected.push(applicable[0].slot);
  }

  return selected.sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));
}

const PX_PER_MINUTE = 1.5;
const GRID_MINUTES = 24 * 60;
const COMPRESSED_BLOCK_END_MINUTES = 7 * 60;
const COMPRESSED_BLOCK_VISUAL_MINUTES = 60;

function minuteToVisualMinute(minutes) {
  const safe = clamp(minutes, 0, GRID_MINUTES);
  if (safe <= COMPRESSED_BLOCK_END_MINUTES) {
    return (safe / COMPRESSED_BLOCK_END_MINUTES) * COMPRESSED_BLOCK_VISUAL_MINUTES;
  }
  return COMPRESSED_BLOCK_VISUAL_MINUTES + (safe - COMPRESSED_BLOCK_END_MINUTES);
}

function rangeToVisualMinutes(startMinutes, duration) {
  const start = clamp(startMinutes, 0, GRID_MINUTES);
  const end = clamp(start + Math.max(0, duration), 0, GRID_MINUTES);
  if (end <= COMPRESSED_BLOCK_END_MINUTES) {
    return ((end - start) / COMPRESSED_BLOCK_END_MINUTES) * COMPRESSED_BLOCK_VISUAL_MINUTES;
  }
  if (start >= COMPRESSED_BLOCK_END_MINUTES) {
    return end - start;
  }
  const compressedPart =
    ((COMPRESSED_BLOCK_END_MINUTES - start) / COMPRESSED_BLOCK_END_MINUTES) * COMPRESSED_BLOCK_VISUAL_MINUTES;
  const normalPart = end - COMPRESSED_BLOCK_END_MINUTES;
  return compressedPart + normalPart;
}

const GRID_VISIBLE_MINUTES = minuteToVisualMinute(GRID_MINUTES);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseTimeToMinutes(timeValue) {
  if (!timeValue) return 0;
  const [hourText, minuteText] = String(timeValue).split(":");
  const hour = Number(hourText || 0);
  const minute = Number(minuteText || 0);
  return hour * 60 + minute;
}

function formatMinutesToTime(minutes) {
  const safe = clamp(Math.round(minutes), 0, GRID_MINUTES);
  const hour = String(Math.floor(safe / 60) % 24).padStart(2, "0");
  const minute = String(safe % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function minuteToDisplay(minutes) {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = String(minutes % 60).padStart(2, "0");
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${meridiem}`;
}

function zonedDateIso(date, timezone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date instanceof Date ? date : new Date(date || Date.now()));
    const map = {};
    for (const part of parts) {
      if (part.type === "year" || part.type === "month" || part.type === "day") {
        map[part.type] = part.value;
      }
    }
    if (!map.year || !map.month || !map.day) return "";
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_error) {
    return "";
  }
}

function zonedWeekdayNum(date, timezone) {
  try {
    const short = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(
      date instanceof Date ? date : new Date(date || Date.now()),
    );
    const map = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] || 7;
  } catch (_error) {
    return 7;
  }
}

function shiftDateLocal(dateLocal, days) {
  const base = new Date(`${String(dateLocal)}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) return String(dateLocal || "");
  base.setUTCDate(base.getUTCDate() + Number(days || 0));
  return base.toISOString().slice(0, 10);
}

function getCurrentWeekStartLocal(timezone) {
  const now = new Date();
  const todayLocal = zonedDateIso(now, timezone) || zonedDateIso(now, "America/Los_Angeles");
  const weekdayNum = zonedWeekdayNum(now, timezone);
  const daysBackToSunday = weekdayNum % 7;
  return shiftDateLocal(todayLocal, -daysBackToSunday);
}

function formatDateShort(dateLocal) {
  const dt = new Date(`${String(dateLocal || "")}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(dt);
}

function formatWeekRange(startLocal) {
  const endLocal = shiftDateLocal(startLocal, 6);
  const start = new Date(`${startLocal}T12:00:00Z`);
  const end = new Date(`${endLocal}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";
  const startLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(end);
  return `${startLabel} - ${endLabel}`;
}

function durationMinutes(slot) {
  const start = parseTimeToMinutes(slot.start_time);
  const end = parseTimeToMinutes(slot.end_time);
  if (end > start) return end - start;
  if (end === 0 && start > 0) return 24 * 60 - start;
  return 30;
}

function normalizeSlot(slot) {
  return {
    ...slot,
    weekday: Number(slot.weekday),
    start_time: formatMinutesToTime(parseTimeToMinutes(slot.start_time)),
    end_time: formatMinutesToTime(parseTimeToMinutes(slot.end_time)),
    special_rule: normalizeScheduleRule(slot.special_rule),
  };
}

function parseAlternatingMeta(slotKey) {
  const value = String(slotKey || "");
  const marker = "altgrp:";
  if (!value.startsWith(marker)) return { enabled: false, group: "" };
  const rest = value.slice(marker.length);
  const [group] = rest.split("::");
  return {
    enabled: Boolean(group),
    group: group || "",
  };
}

function buildAlternatingSlotKey({ weekday, startTime, endTime, group, previousSlotKey }) {
  const cleanGroup = String(group || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!cleanGroup) return previousSlotKey || "";

  const idPart =
    parseAlternatingMeta(previousSlotKey).enabled && String(previousSlotKey).includes("::")
      ? String(previousSlotKey).split("::").slice(1).join("::")
      : `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  return `altgrp:${cleanGroup}::${weekday}-${startTime}-${endTime}-${idPart}`;
}

function areAlternatingPair(a, b) {
  const aMeta = parseAlternatingMeta(a.slot_key);
  const bMeta = parseAlternatingMeta(b.slot_key);
  return aMeta.enabled && bMeta.enabled && aMeta.group === bMeta.group;
}

function sameWindow(a, b) {
  return a.start_time === b.start_time && a.end_time === b.end_time;
}

function shouldRenderSideBySide(a, b) {
  if (!sameWindow(a, b)) return false;
  if (areAlternatingPair(a, b)) return true;
  return !recurrenceRulesOverlap(a.special_rule, b.special_rule);
}

function getSideBySideInfo(daySlots, targetSlot) {
  const siblings = daySlots
    .filter((slot) => slot.id === targetSlot.id || shouldRenderSideBySide(slot, targetSlot))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (siblings.length <= 1) return { count: 1, index: 0 };
  return {
    count: siblings.length,
    index: Math.max(
      0,
      siblings.findIndex((slot) => slot.id === targetSlot.id),
    ),
  };
}

function blockStyle(slot, sideBySide) {
  const start = parseTimeToMinutes(slot.start_time);
  const duration = durationMinutes(slot);
  const topInset = 3;
  const bottomInset = 3;
  const rawHeight = Math.max(rangeToVisualMinutes(start, duration) * PX_PER_MINUTE, 24);
  const style = {
    top: `${minuteToVisualMinute(start) * PX_PER_MINUTE + topInset}px`,
    height: `${Math.max(rawHeight - topInset - bottomInset, 20)}px`,
  };

  if (sideBySide.count > 1) {
    const widthPercent = 100 / sideBySide.count;
    style.width = `calc(${widthPercent}% - 0.64rem)`;
    style.left = `calc(${sideBySide.index * widthPercent}% + 0.32rem)`;
    style.right = "auto";
  }

  return style;
}

function overlapsOnDay(slots, targetSlot) {
  const targetStart = parseTimeToMinutes(targetSlot.start_time);
  const targetEndRaw = parseTimeToMinutes(targetSlot.end_time);
  const targetEnd = targetEndRaw > targetStart ? targetEndRaw : targetEndRaw === 0 ? 24 * 60 : targetEndRaw;
  return slots.some((slot) => {
    if (slot.id === targetSlot.id) return false;
    if (areAlternatingPair(slot, targetSlot)) return false;
    if (!recurrenceRulesOverlap(slot.special_rule, targetSlot.special_rule)) return false;
    const start = parseTimeToMinutes(slot.start_time);
    const endRaw = parseTimeToMinutes(slot.end_time);
    const end = endRaw > start ? endRaw : endRaw === 0 ? 24 * 60 : endRaw;
    return targetStart < end && targetEnd > start;
  });
}

function AddSlotDialog({ open, onClose, onCreate, shows }) {
  const [form, setForm] = useState({
    weekday: 7,
    start_time: "09:00",
    end_time: "10:00",
    show: "",
    timezone: "America/Los_Angeles",
    special_rule: "every_week",
  });

  useEffect(() => {
    if (!open) return;
    if (!form.show && shows[0]) {
      setForm((prev) => ({ ...prev, show: String(shows[0].id) }));
    }
  }, [open, shows, form.show]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" style={{ zIndex: 10000 }}>
      <div className="modal-card">
        <h2>Add Schedule Slot</h2>
        <label>
          Show
          <select
            value={form.show}
            onChange={(event) => setForm((prev) => ({ ...prev, show: event.target.value }))}
          >
            {shows.map((show) => (
              <option key={show.id} value={String(show.id)}>
                {show.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          Day
          <select
            value={String(form.weekday)}
            onChange={(event) => setForm((prev) => ({ ...prev, weekday: Number(event.target.value) }))}
          >
            {DAYS.map((day) => (
              <option key={day.num} value={String(day.num)}>
                {day.label}
              </option>
            ))}
          </select>
        </label>

        <div className="time-row">
          <label>
            Start
            <input
              type="time"
              value={form.start_time}
              onChange={(event) => setForm((prev) => ({ ...prev, start_time: event.target.value }))}
            />
          </label>
          <label>
            End
            <input
              type="time"
              value={form.end_time}
              onChange={(event) => setForm((prev) => ({ ...prev, end_time: event.target.value }))}
            />
          </label>
        </div>

        <label>
          Timezone
          <input
            type="text"
            value={form.timezone}
            onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
          />
        </label>

        <label>
          Recurrence
          <select
            value={form.special_rule}
            onChange={(event) => setForm((prev) => ({ ...prev, special_rule: normalizeScheduleRule(event.target.value) }))}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary"
            onClick={() =>
              onCreate({
                ...form,
                show: Number(form.show),
              })
            }
            type="button"
          >
            Create Slot
          </button>
        </div>
      </div>
    </div>
  );
}

async function fetchShowInsightsSafe(showId) {
  return apiAdapter.getAdminShowInsights(showId);
}

function EditSlotDialog({
  open,
  slot,
  show,
  shows,
  onClose,
  onSave,
  onDelete,
  saving,
}) {
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!open || !slot) return;
    setForm({
      weekday: Number(slot.weekday),
      start_time: slot.start_time,
      end_time: slot.end_time,
      show: Number(slot.show),
      timezone: slot.timezone || "America/Los_Angeles",
      special_rule: normalizeScheduleRule(slot.special_rule),
    });
  }, [open, slot]);

  if (!open || !slot || !form) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" style={{ zIndex: 10000 }}>
      <div className="modal-card">
        <h2>Edit Schedule Slot</h2>
        <p className="slot-meta">{show?.title || "Unassigned Show"}</p>

        <label>
          Show
          <select
            value={String(form.show)}
            onChange={(event) => setForm((prev) => ({ ...prev, show: Number(event.target.value) }))}
          >
            {shows.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <label>
          Day
          <select
            value={String(form.weekday)}
            onChange={(event) => setForm((prev) => ({ ...prev, weekday: Number(event.target.value) }))}
          >
            {DAYS.map((day) => (
              <option key={day.num} value={String(day.num)}>
                {day.label}
              </option>
            ))}
          </select>
        </label>

        <div className="time-row">
          <label>
            Start
            <input
              type="time"
              value={form.start_time}
              onChange={(event) => setForm((prev) => ({ ...prev, start_time: event.target.value }))}
            />
          </label>
          <label>
            End
            <input
              type="time"
              value={form.end_time}
              onChange={(event) => setForm((prev) => ({ ...prev, end_time: event.target.value }))}
            />
          </label>
        </div>

        <label>
          Timezone
          <input
            type="text"
            value={form.timezone}
            onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
          />
        </label>

        <label>
          Recurrence
          <select
            value={form.special_rule}
            onChange={(event) => setForm((prev) => ({ ...prev, special_rule: normalizeScheduleRule(event.target.value) }))}
          >
            {RECURRENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="modal-actions between">
          <button className="danger" onClick={() => onDelete(slot.id)} type="button" disabled={saving}>
            Delete Slot
          </button>
          <div className="modal-actions inline">
            <button className="ghost" onClick={onClose} type="button" disabled={saving}>
              Cancel
            </button>
            <button className="primary" onClick={() => onSave(slot.id, form)} type="button" disabled={saving}>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlaylistPopup({ open, broadcast, tracks, onClose }) {
  if (!open || !broadcast) return null;
  return (
    <div className="modal-overlay popup" role="dialog" aria-modal="true" style={{ zIndex: 11000 }}>
      <div className="modal-card wide">
        <h2>
          Playlist: {broadcast.weekday_name} {broadcast.date_local} {broadcast.start_time}-{broadcast.end_time}
        </h2>
        <div className="playlist-list tall">
          {tracks.length ? (
            <ul>
              {tracks.map((track) => (
                <li key={track.id}>
                  <strong>{track.artist || "Unknown"}</strong> - {track.title || "Unknown Title"}
                </li>
              ))}
            </ul>
          ) : (
            <p>No playlist tracks found for this broadcast window.</p>
          )}
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose} type="button">
            Close Playlist
          </button>
        </div>
      </div>
    </div>
  );
}

function ShowDetailsDialog({ open, showId, onClose, onShowChanged }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playlistBroadcastKey, setPlaylistBroadcastKey] = useState("");
  const [catalogDjs, setCatalogDjs] = useState([]);
  const [selectedDj, setSelectedDj] = useState(null);
  const [djEditMode, setDjEditMode] = useState(false);
  const [djForm, setDjForm] = useState({ name: "", slug: "", bio: "", image_url: "" });
  const [addDjMode, setAddDjMode] = useState(false);
  const [addDjRole, setAddDjRole] = useState("host");
  const [selectedCatalogDjId, setSelectedCatalogDjId] = useState("");
  const [creatingNewDj, setCreatingNewDj] = useState(false);
  const [newDjForm, setNewDjForm] = useState({ name: "", slug: "", bio: "", image_url: "" });
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", slug: "", show_type: "music", description: "", is_active: true });

  function toShowListItem(payload) {
    if (!payload?.show?.id) return null;
    return {
      id: payload.show.id,
      slug: payload.show.slug || "",
      title: payload.show.title || "",
      show_type: payload.show.show_type || "music",
      is_active: Boolean(payload.show.is_active),
      is_scheduled: Boolean(payload.show.is_scheduled),
      djs: (payload.djs || [])
        .map((row) => ({
          id: row?.dj?.id,
          name: row?.dj?.name || "",
          role: row?.role || null,
        }))
        .filter((dj) => dj.id),
    };
  }

  async function refreshShowDetails(targetShowId) {
    const [payload, djsPayload] = await Promise.all([
      fetchShowInsightsSafe(targetShowId),
      apiAdapter.getAdminDjs(),
    ]);
    setInsights(payload);
    setCatalogDjs(djsPayload?.items || []);
    if (!selectedCatalogDjId && djsPayload?.items?.[0]) {
      setSelectedCatalogDjId(String(djsPayload.items[0].id));
    }
    return payload;
  }

  useEffect(() => {
    if (!open || !showId) return;
    let cancelled = false;

    async function loadInsights() {
      setLoading(true);
      setError("");
      try {
        const payload = await refreshShowDetails(showId);
        if (cancelled) return;
        setForm({
          title: payload?.show?.title || "",
          slug: payload?.show?.slug || "",
          show_type: payload?.show?.show_type || "music",
          description: payload?.show?.description || "",
          is_active: Boolean(payload?.show?.is_active),
        });
        setEditMode(false);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Failed to load show details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadInsights();
    return () => {
      cancelled = true;
    };
  }, [open, showId]);

  if (!open) return null;

  const playlistBroadcast =
    insights?.recent_broadcasts?.find((item) => item.key === playlistBroadcastKey) || null;
  const playlistTracks =
    insights?.playlist_by_broadcast?.find((item) => item.broadcast_key === playlistBroadcastKey)?.tracks || [];

  function openDjEditor(dj) {
    if (!dj) return;
    setSelectedDj(dj);
    setDjEditMode(false);
    setDjForm({
      name: dj.name || "",
      slug: dj.slug || "",
      bio: dj.bio || "",
      image_url: dj.image_url || "",
    });
  }

  async function handleSaveShow() {
    if (!showId) return;
    setSaving(true);
    setError("");
    try {
      await apiAdapter.updateAdminShow(showId, form);
      const refreshed = await refreshShowDetails(showId);
      setForm({
        title: refreshed?.show?.title || "",
        slug: refreshed?.show?.slug || "",
        show_type: refreshed?.show?.show_type || "music",
        description: refreshed?.show?.description || "",
        is_active: Boolean(refreshed?.show?.is_active),
      });
      const nextListItem = toShowListItem(refreshed);
      if (nextListItem && typeof onShowChanged === "function") onShowChanged(nextListItem);
      setEditMode(false);
    } catch (saveError) {
      setError(saveError.message || "Failed to update show details.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDj() {
    if (!selectedDj?.id) return;
    setSaving(true);
    setError("");
    try {
      await apiAdapter.updateAdminDj(selectedDj.id, djForm);
      await refreshShowDetails(showId);
      setDjEditMode(false);
    } catch (saveError) {
      setError(saveError.message || "Failed to update DJ details.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAttachExistingDj() {
    if (!showId || !selectedCatalogDjId) return;
    setSaving(true);
    setError("");
    try {
      await apiAdapter.attachDjToShow(showId, { dj_id: Number(selectedCatalogDjId), role: addDjRole || "host" });
      await refreshShowDetails(showId);
      setAddDjMode(false);
    } catch (attachError) {
      setError(attachError.message || "Failed to attach DJ.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDetachDj(djId) {
    if (!showId || !djId) return;
    setSaving(true);
    setError("");
    try {
      await apiAdapter.detachDjFromShow(showId, djId);
      await refreshShowDetails(showId);
      if (selectedDj?.id === djId) setSelectedDj(null);
    } catch (detachError) {
      setError(detachError.message || "Failed to remove DJ from show.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateAndAttachDj() {
    if (!showId) return;
    setSaving(true);
    setError("");
    try {
      const created = await apiAdapter.createAdminDj(newDjForm);
      const djId = created?.item?.id;
      if (!djId) throw new Error("Failed to create DJ.");
      await apiAdapter.attachDjToShow(showId, { dj_id: Number(djId), role: addDjRole || "host" });
      await refreshShowDetails(showId);
      setNewDjForm({ name: "", slug: "", bio: "", image_url: "" });
      setCreatingNewDj(false);
      setAddDjMode(false);
    } catch (createError) {
      setError(createError.message || "Failed to create and attach DJ.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" style={{ zIndex: 10000 }}>
      <div className="modal-card wide">
        <div className="show-header-row">
          <h2>{insights?.show?.title || "Show Details"}</h2>
          <button className="ghost" type="button" onClick={() => setEditMode((prev) => !prev)} disabled={loading || saving}>
            {editMode ? "Cancel Edit" : "Edit Show"}
          </button>
        </div>

        {editMode ? (
          <section className="show-edit-form">
            <label>
              Title
              <input
                type="text"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </label>
            <label>
              Slug
              <input
                type="text"
                value={form.slug}
                onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
              />
            </label>
            <label>
              Show Type
              <select
                value={form.show_type}
                onChange={(event) => setForm((prev) => ({ ...prev, show_type: event.target.value }))}
              >
                <option value="music">music</option>
                <option value="talk">talk</option>
                <option value="mixed">mixed</option>
                <option value="special">special</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(form.is_active)}
                onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
              />
              Active show
            </label>
            <label>
              Description
              <textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                rows={4}
              />
            </label>
            <div className="modal-actions inline">
              <button className="primary" type="button" onClick={handleSaveShow} disabled={saving}>
                {saving ? "Saving..." : "Save Show"}
              </button>
            </div>
          </section>
        ) : null}

        <div className="show-meta-grid">
          <div>
            <p className="meta-label">Type</p>
            <p className="meta-value">{insights?.show?.show_type || "unknown"}</p>
          </div>
          <div>
            <p className="meta-label">Slug</p>
            <p className="meta-value">{insights?.show?.slug || "n/a"}</p>
          </div>
          <div>
            <p className="meta-label">Status</p>
            <p className="meta-value">{insights?.show?.is_active ? "Active" : "Inactive"}</p>
          </div>
          <div>
            <p className="meta-label">Scheduled</p>
            <p className="meta-value">{insights?.show?.is_scheduled ? "Yes" : "No"}</p>
          </div>
        </div>
        {insights?.show?.description ? <p className="slot-meta compact">{insights.show.description}</p> : null}

        <section className="show-insights">
          {loading ? <p>Loading show details...</p> : null}
          {error ? <p className="status-bad">{error}</p> : null}
          {!loading && !error && insights ? (
            <>
              <p className="insight-title">DJs / Hosts</p>
              <div className="insight-actions">
                <button className="ghost" type="button" onClick={() => setAddDjMode((prev) => !prev)}>
                  {addDjMode ? "Close Add DJ" : "Add DJ"}
                </button>
              </div>

              {addDjMode ? (
                <div className="show-edit-form">
                  <label>
                    Role
                    <select
                      value={addDjRole}
                      onChange={(event) => setAddDjRole(event.target.value)}
                    >
                      <option value="host">host</option>
                      <option value="co-host">co-host</option>
                      <option value="producer">producer</option>
                      <option value="guest">guest</option>
                      <option value="engineer">engineer</option>
                    </select>
                  </label>

                  <label>
                    Existing DJ
                    <select
                      value={selectedCatalogDjId}
                      onChange={(event) => setSelectedCatalogDjId(event.target.value)}
                      disabled={creatingNewDj}
                    >
                      {catalogDjs.map((dj) => (
                        <option key={dj.id} value={String(dj.id)}>
                          {dj.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="modal-actions inline">
                    <button className="primary" type="button" onClick={handleAttachExistingDj} disabled={saving || creatingNewDj}>
                      Attach Existing DJ
                    </button>
                    <button className="ghost" type="button" onClick={() => setCreatingNewDj((prev) => !prev)}>
                      {creatingNewDj ? "Cancel New DJ" : "Add New DJ"}
                    </button>
                  </div>

                  {creatingNewDj ? (
                    <>
                      <label>
                        DJ Name
                        <input
                          type="text"
                          value={newDjForm.name}
                          onChange={(event) => setNewDjForm((prev) => ({ ...prev, name: event.target.value }))}
                        />
                      </label>
                      <label>
                        Slug
                        <input
                          type="text"
                          value={newDjForm.slug}
                          onChange={(event) => setNewDjForm((prev) => ({ ...prev, slug: event.target.value }))}
                        />
                      </label>
                      <label>
                        Bio
                        <textarea
                          value={newDjForm.bio}
                          onChange={(event) => setNewDjForm((prev) => ({ ...prev, bio: event.target.value }))}
                          rows={3}
                        />
                      </label>
                      <label>
                        Image URL
                        <input
                          type="text"
                          value={newDjForm.image_url}
                          onChange={(event) => setNewDjForm((prev) => ({ ...prev, image_url: event.target.value }))}
                        />
                      </label>
                      <div className="modal-actions inline">
                        <button className="primary" type="button" onClick={handleCreateAndAttachDj} disabled={saving}>
                          Create and Attach DJ
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}

              {insights.djs?.length ? (
                <ul className="dj-list">
                  {insights.djs.map((row) => (
                    <li key={row.dj.id} className="dj-row">
                      <button
                        type="button"
                        className="dj-link"
                        onClick={() => openDjEditor(row.dj)}
                      >
                        {row.dj.name}
                      </button>
                      {row.role ? <span className="dj-role">({row.role})</span> : null}
                      {row.dj.bio ? <span> - {row.dj.bio}</span> : null}
                      <button
                        type="button"
                        className="dj-remove"
                        onClick={() => handleDetachDj(row.dj.id)}
                        disabled={saving}
                        title="Remove DJ from show"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No DJ metadata linked yet.</p>
              )}

              <p className="insight-title">Recurring schedule slots</p>
              {insights.weekly_slots?.length ? (
                <ul>
                  {insights.weekly_slots.slice(0, 10).map((slot) => (
                    <li key={slot.id}>
                      {slot.weekday_name} - {slot.start_time} to {slot.end_time}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recurring slots assigned.</p>
              )}

              <p className="insight-title">Recent broadcasts</p>
              {insights.recent_broadcasts?.length ? (
                <ul>
                  {insights.recent_broadcasts.map((broadcast) => (
                    <li key={broadcast.key}>
                      <button
                        type="button"
                        className="broadcast-link"
                        onClick={() => setPlaylistBroadcastKey(broadcast.key)}
                      >
                        {broadcast.weekday_name} {broadcast.date_local} - {broadcast.start_time} to {broadcast.end_time}
                        {` (${broadcast.playlist_count || 0} tracks)`}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recent broadcasts found.</p>
              )}
            </>
          ) : null}
        </section>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>

      <PlaylistPopup
        open={Boolean(playlistBroadcast)}
        broadcast={playlistBroadcast}
        tracks={playlistTracks}
        onClose={() => setPlaylistBroadcastKey("")}
      />

      {selectedDj ? (
        <div className="modal-overlay popup" role="dialog" aria-modal="true" style={{ zIndex: 11000 }}>
          <div className="modal-card">
            <div className="show-header-row">
              <h2>{selectedDj.name}</h2>
              <button className="ghost" type="button" onClick={() => setDjEditMode((prev) => !prev)}>
                {djEditMode ? "Cancel Edit" : "Edit DJ"}
              </button>
            </div>

            {djEditMode ? (
              <section className="show-edit-form">
                <label>
                  Name
                  <input
                    type="text"
                    value={djForm.name}
                    onChange={(event) => setDjForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  Slug
                  <input
                    type="text"
                    value={djForm.slug}
                    onChange={(event) => setDjForm((prev) => ({ ...prev, slug: event.target.value }))}
                  />
                </label>
                <label>
                  Bio
                  <textarea
                    value={djForm.bio}
                    onChange={(event) => setDjForm((prev) => ({ ...prev, bio: event.target.value }))}
                    rows={4}
                  />
                </label>
                <label>
                  Image URL
                  <input
                    type="text"
                    value={djForm.image_url}
                    onChange={(event) => setDjForm((prev) => ({ ...prev, image_url: event.target.value }))}
                  />
                </label>
                <div className="modal-actions inline">
                  <button className="primary" type="button" onClick={handleSaveDj} disabled={saving}>
                    {saving ? "Saving..." : "Save DJ"}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <p className="slot-meta compact">{selectedDj.bio || "No DJ bio yet."}</p>
                {selectedDj.image_url ? (
                  <p className="meta-value">
                    <a href={selectedDj.image_url} target="_blank" rel="noreferrer">
                      {selectedDj.image_url}
                    </a>
                  </p>
                ) : null}
              </>
            )}

            <div className="modal-actions">
              <button className="ghost" onClick={() => setSelectedDj(null)} type="button">
                Close DJ
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportingTab() {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [generating, setGenerating] = useState(false);

  async function requestReportsFallback(path, payload = null) {
    const token = import.meta.env.VITE_ADMIN_TOKEN || "";
    const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
    const { protocol, hostname } = window.location;
    const inferredHost = hostname.includes("admin")
      ? hostname.replace("admin.", "api.").replace("-admin.", "-api.").replace("admin-", "api-")
      : hostname;
    const inferredBase = `${protocol}//${inferredHost}`;
    const apiBase = configured && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(configured)
      ? configured
      : inferredBase;

    const response = await fetch(`${apiBase}${path}`, {
      method: payload ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-RADIANT-ADMIN-TOKEN": token } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_error) {
      data = { message: text.slice(0, 200) };
    }

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Request failed (${response.status})`);
    }
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    async function loadTypes() {
      setLoading(true);
      setError("");
      try {
        const payload =
          typeof apiAdapter.getReportTypes === "function"
            ? await apiAdapter.getReportTypes()
            : await requestReportsFallback("/v1/admin/reports/types");
        if (cancelled) return;
        const items = payload?.items || [];
        setTypes(items);
        const firstReady = items.find((item) => item.available !== false);
        if (firstReady) setSelectedType(firstReady.id);
        else if (items[0]) setSelectedType(items[0].id);
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Failed to load report types.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadTypes();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGenerate() {
    if (!selectedType) return;
    const selectedItem = types.find((item) => item.id === selectedType);
    if (selectedItem?.available === false) return;
    setGenerating(true);
    setError("");
    try {
      const requestPayload = {
        report_type: selectedType,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      };
      const payload =
        typeof apiAdapter.generateReport === "function"
          ? await apiAdapter.generateReport(requestPayload)
          : await requestReportsFallback("/v1/admin/reports/generate", requestPayload);
      const blob = new Blob([payload.content || ""], { type: payload.mime_type || "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = payload.filename || `${selectedType.toLowerCase()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (genError) {
      setError(genError.message || "Failed to generate report.");
    } finally {
      setGenerating(false);
    }
  }

  const selectedItem = types.find((item) => item.id === selectedType);
  const selectedInDevelopment = selectedItem?.available === false;

  return (
    <section className="reports-shell">
      <h2>Reporting</h2>
      <p className="subhead">SoundExchange ROU ATH and BMI Music Plays are available now. Other report types are in development.</p>

      {loading ? <p>Loading report types...</p> : null}
      {error ? <p className="status-bad">{error}</p> : null}

      <div className="reports-controls">
        <label>
          Report Type
          <select value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
            {types.map((item) => (
              <option key={item.id} value={item.id} disabled={item.available === false}>
                {item.label}
                {item.available === false ? " (In development)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          Start Date
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>

        <label>
          End Date
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>

        <button
          className="primary"
          type="button"
          onClick={handleGenerate}
          disabled={generating || !selectedType || selectedInDevelopment}
        >
          {selectedInDevelopment ? "In Development" : generating ? "Generating..." : "Generate Export"}
        </button>
      </div>
    </section>
  );
}

function StatsTab({ mode = "admin" }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [range, setRange] = useState("current");
  const [summary, setSummary] = useState(null);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [geoItems, setGeoItems] = useState([]);
  const [statsEnabled, setStatsEnabled] = useState(true);
  const [disabledReason, setDisabledReason] = useState("");
  const [zoomState, setZoomState] = useState({ k: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragOrigin, setDragOrigin] = useState(null);
  const mapViewportRef = useRef(null);
  const hasLoadedInitialStatsRef = useRef(false);

  async function requestStatsFallback(path) {
    const token = import.meta.env.VITE_ADMIN_TOKEN || "";
    const configured = (import.meta.env.VITE_API_BASE_URL || "").trim();
    const { protocol, hostname } = window.location;
    const inferredHost = hostname.includes("admin")
      ? hostname.replace("admin.", "api.").replace("-admin.", "-api.").replace("admin-", "api-")
      : hostname;
    const inferredBase = `${protocol}//${inferredHost}`;
    const apiBase = configured && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(configured) ? configured : inferredBase;

    const response = await fetch(`${apiBase}${path}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-RADIANT-ADMIN-TOKEN": token } : {}),
      },
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_error) {
      data = { message: text.slice(0, 200) };
    }

    if (!response.ok) {
      throw new Error(data?.message || data?.error || `Request failed (${response.status})`);
    }
    return data;
  }

  const maxGeoCount = useMemo(() => {
    const counts = geoItems.map((item) => Number(item.unique_ips || 0));
    return counts.length ? Math.max(...counts, 1) : 1;
  }, [geoItems]);

  const geoGranularity = useMemo(() => {
    if (zoomState.k >= 4) return "city";
    if (zoomState.k >= 2) return "region";
    return "country";
  }, [zoomState.k]);

  const mapProjection = useMemo(
    () => geoNaturalEarth1().fitExtent([[16, 16], [984, 484]], { type: "Sphere" }),
    [],
  );
  const mapPath = useMemo(() => geoPath(mapProjection), [mapProjection]);
  const mapSpherePath = useMemo(() => mapPath({ type: "Sphere" }) || "", [mapPath]);
  const mapGraticulePath = useMemo(() => mapPath(geoGraticule10()) || "", [mapPath]);
  const landGeometries = useMemo(() => {
    const topology = countries110m;
    return feature(topology, topology.objects.countries).features;
  }, []);

  const geoDots = useMemo(() => {
    return geoItems
      .map((item, index) => {
        const lat = Number(item.latitude);
        const lon = Number(item.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const projected = mapProjection([lon, lat]);
        if (!projected) return null;
        const count = Number(item.unique_ips || 0);
        const radius = Math.max(5, Math.round((count / maxGeoCount) * 16));
        return {
          key: `${item.country_code || "xx"}-${index}`,
          country: item.country || "Unknown",
          region: item.region || null,
          city: item.city || null,
          label: item.label || item.city || item.region || item.country || "Unknown",
          count,
          x: projected[0],
          y: projected[1],
          radius,
        };
      })
      .filter(Boolean);
  }, [geoItems, mapProjection, maxGeoCount]);

  async function loadStats(targetRange = range, targetGranularity = geoGranularity, includeSummary = true) {
    setLoading(true);
    setError("");
    try {
      const geoRequest =
        mode === "public"
          ? typeof apiAdapter.getPublicIcecastGeo === "function"
            ? apiAdapter.getPublicIcecastGeo(targetRange, targetGranularity)
            : requestStatsFallback(
                `/v1/status/icecast/geo?range=${encodeURIComponent(targetRange)}&granularity=${encodeURIComponent(targetGranularity)}`,
              )
          : typeof apiAdapter.getAdminIcecastGeo === "function"
            ? apiAdapter.getAdminIcecastGeo(targetRange, targetGranularity)
            : requestStatsFallback(
              `/v1/admin/stats/icecast/geo?range=${encodeURIComponent(targetRange)}&granularity=${encodeURIComponent(targetGranularity)}`,
            );
      const nowPlayingRequest =
        typeof apiAdapter.getNowPlaying === "function"
          ? apiAdapter.getNowPlaying()
          : requestStatsFallback("/v1/now-playing");

      let summaryPayload = null;
      let geoPayload = null;
      let nowPlayingPayload = null;
      if (includeSummary) {
        const summaryRequest =
          mode === "public"
            ? typeof apiAdapter.getPublicIcecastStatsSummary === "function"
              ? apiAdapter.getPublicIcecastStatsSummary()
              : requestStatsFallback("/v1/status/icecast/summary")
            : typeof apiAdapter.getAdminIcecastStatsSummary === "function"
              ? apiAdapter.getAdminIcecastStatsSummary()
              : requestStatsFallback("/v1/admin/stats/icecast/summary");
        [summaryPayload, geoPayload, nowPlayingPayload] = await Promise.all([summaryRequest, geoRequest, nowPlayingRequest]);
      } else {
        geoPayload = await geoRequest;
      }

      const enabled = Boolean(summaryPayload?.enabled);
      if (includeSummary) {
        setStatsEnabled(enabled);
        setDisabledReason(enabled ? "" : String(summaryPayload?.reason || geoPayload?.reason || "disabled"));
        setSummary(summaryPayload?.summary || null);
        setNowPlaying(nowPlayingPayload || null);
      }
      setGeoItems(Array.isArray(geoPayload?.items) ? geoPayload.items : []);
      setRange(targetRange);
    } catch (loadError) {
      setError(loadError.message || "Failed to load listener stats.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    hasLoadedInitialStatsRef.current = true;
    loadStats("current", geoGranularity, true);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      loadStats(range, geoGranularity, true);
    }, 30000);
    return () => clearInterval(timer);
  }, [range, geoGranularity]);

  useEffect(() => {
    if (!hasLoadedInitialStatsRef.current) return;
    loadStats(range, geoGranularity, false);
  }, [geoGranularity]);

  function zoomAtClientPoint(clientX, clientY, factor, centerOnTarget = false) {
    const node = mapViewportRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    setZoomState((previous) => {
      const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
      const nextK = clamp(previous.k * safeFactor, 1, 8);
      const worldX = (px - previous.x) / previous.k;
      const worldY = (py - previous.y) / previous.k;
      const targetX = centerOnTarget ? rect.width / 2 : px;
      const targetY = centerOnTarget ? rect.height / 2 : py;
      const nextX = targetX - worldX * nextK;
      const nextY = targetY - worldY * nextK;
      return {
        k: nextK,
        x: nextX,
        y: nextY,
      };
    });
  }

  function zoomBy(factor) {
    const node = mapViewportRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    zoomAtClientPoint(cx, cy, factor);
  }

  function resetZoom() {
    setZoomState({ k: 1, x: 0, y: 0 });
  }

  function handleDoubleClick(event) {
    event.preventDefault();
    zoomAtClientPoint(event.clientX, event.clientY, 1.6, true);
  }

  function handlePointerDown(event) {
    const node = mapViewportRef.current;
    if (!node) return;
    node.setPointerCapture(event.pointerId);
    setDragging(true);
    setDragOrigin({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: zoomState.x,
      originY: zoomState.y,
    });
  }

  function handlePointerMove(event) {
    if (!dragging || !dragOrigin || dragOrigin.pointerId !== event.pointerId) return;
    const dx = event.clientX - dragOrigin.startX;
    const dy = event.clientY - dragOrigin.startY;
    setZoomState((previous) => ({
      ...previous,
      x: dragOrigin.originX + dx,
      y: dragOrigin.originY + dy,
    }));
  }

  function handlePointerUp(event) {
    const node = mapViewportRef.current;
    if (node && dragOrigin?.pointerId === event.pointerId) {
      try {
        node.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // noop
      }
    }
    setDragging(false);
    setDragOrigin(null);
  }

  const uptimeText = summary?.uptime_seconds
    ? `${Math.floor(summary.uptime_seconds / 3600)}h ${Math.floor((summary.uptime_seconds % 3600) / 60)}m`
    : "n/a";
  const currentShowTitle = nowPlaying?.show?.title || "No live show";
  const currentTrackTitle = nowPlaying?.track
    ? `${nowPlaying.track.artist || "Unknown Artist"} - ${nowPlaying.track.title || "Unknown Track"}`
    : "No track detected";

  return (
    <section className="stats-shell">
      <h2>Stats</h2>
      <p className="subhead">Live listener telemetry from Icecast plus geo tracking from now onward.</p>

      {error ? <p className="status-bad">{error}</p> : null}
      {!error && !statsEnabled ? (
        <p className="status-bad">Icecast stats are unavailable right now ({disabledReason || "configuration incomplete"}).</p>
      ) : null}

      <div className="status-now-row">
        <article className="status-now-card">
          <h3>Current Show</h3>
          <p>{currentShowTitle}</p>
        </article>
        <article className="status-now-card">
          <h3>Now Playing</h3>
          <p>{currentTrackTitle}</p>
        </article>
      </div>

      <div className="stats-row">
        <article className="stat-card">
          <h3>Current Listeners</h3>
          <p>{summary?.current_listeners ?? "-"}</p>
        </article>
        <article className="stat-card">
          <h3>Stream Uptime</h3>
          <p>{uptimeText}</p>
        </article>
        <article className="stat-card">
          <h3>Unique 24h</h3>
          <p>{summary?.unique_listeners_24h ?? "-"}</p>
        </article>
        <article className="stat-card">
          <h3>Unique All Time</h3>
          <p>{summary?.unique_listeners_all_time ?? "-"}</p>
        </article>
      </div>

      <div className="stats-toolbar">
        <div className="range-pills">
          {[
            { key: "current", label: "Current" },
            { key: "24h", label: "Last 24h" },
            { key: "all", label: "All Time" },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              className={range === item.key ? "ghost active" : "ghost"}
              onClick={() => loadStats(item.key)}
              disabled={loading}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="stats-actions">
          <span className="granularity-chip">{geoGranularity}</span>
          <button className="ghost" type="button" onClick={() => loadStats(range, geoGranularity, true)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <div className="geo-panel">
        <div
          ref={mapViewportRef}
          className={dragging ? "geo-map is-dragging" : "geo-map"}
          aria-label="Listener geo map"
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <svg className="geo-map-svg" viewBox="0 0 1000 500" role="img" aria-label="World map with listener locations">
            <g transform={`translate(${zoomState.x} ${zoomState.y}) scale(${zoomState.k})`}>
              <rect x="0" y="0" width="1000" height="500" className="geo-ocean" />

              <path className="geo-sphere" d={mapSpherePath} />
              <path className="geo-graticule-path" d={mapGraticulePath} />

              <g className="geo-land">
                {landGeometries.map((shape, index) => {
                  const d = mapPath(shape);
                  if (!d) return null;
                  return <path key={`land-${index}`} d={d} />;
                })}
              </g>

              <g className="geo-points">
                {geoDots.map((dot) => (
                  <circle key={dot.key} cx={dot.x} cy={dot.y} r={dot.radius / Math.sqrt(zoomState.k)} className="geo-dot">
                    <title>{`${dot.label}: ${dot.count}`}</title>
                  </circle>
                ))}
              </g>
            </g>
          </svg>

          <div
            className="map-controls"
            aria-label="Map controls"
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <button
              className="map-control"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                zoomBy(1.25);
              }}
              aria-label="Zoom in map"
            >
              +
            </button>
            <button
              className="map-control"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                zoomBy(0.8);
              }}
              aria-label="Zoom out map"
            >
              -
            </button>
            <button
              className="map-control reset"
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                resetZoom();
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsTab({ onSiteTitlesChange }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [form, setForm] = useState({
    admin_title: "KAAD-lp Admin",
    public_status_title: "Public Status",
    enabled: false,
    scheme: "http",
    host: "",
    port: 8000,
    mount: "stream",
    username: "source",
    password: "",
    password_set: false,
  });

  async function loadSettings() {
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const payload = await apiAdapter.getAdminIcecastSettings();
      const item = payload?.item || {};
      setForm((previous) => ({
        ...previous,
        admin_title: item.admin_title || "KAAD-lp Admin",
        public_status_title: item.public_status_title || "Public Status",
        enabled: Boolean(item.enabled),
        scheme: item.scheme === "https" ? "https" : "http",
        host: item.host || "",
        port: Number(item.port || 8000),
        mount: item.mount || "stream",
        username: item.username || "source",
        password: "",
        password_set: Boolean(item.password_set),
      }));
      if (typeof onSiteTitlesChange === "function") {
        onSiteTitlesChange({
          adminTitle: item.admin_title || "KAAD-lp Admin",
          publicStatusTitle: item.public_status_title || "Public Status",
        });
      }
    } catch (loadError) {
      setError(loadError.message || "Failed to load Icecast settings.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const payload = await apiAdapter.updateAdminIcecastSettings({
        admin_title: form.admin_title,
        public_status_title: form.public_status_title,
        enabled: form.enabled,
        scheme: form.scheme,
        host: form.host,
        port: Number(form.port),
        mount: form.mount,
        username: form.username,
        password: form.password,
      });
      const item = payload?.item || {};
      setForm((previous) => ({
        ...previous,
        admin_title: item.admin_title || "KAAD-lp Admin",
        public_status_title: item.public_status_title || "Public Status",
        enabled: Boolean(item.enabled),
        scheme: item.scheme === "https" ? "https" : "http",
        host: item.host || "",
        port: Number(item.port || 8000),
        mount: item.mount || "stream",
        username: item.username || "source",
        password: "",
        password_set: Boolean(item.password_set),
      }));
      if (typeof onSiteTitlesChange === "function") {
        onSiteTitlesChange({
          adminTitle: item.admin_title || "KAAD-lp Admin",
          publicStatusTitle: item.public_status_title || "Public Status",
        });
      }
      setInfo("Icecast settings saved.");
    } catch (saveError) {
      setError(saveError.message || "Failed to save Icecast settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-shell">
      <h2>Settings</h2>
      <p className="subhead">Configure site branding and stream connection details used by metadata and listener stats.</p>

      {loading ? <p>Loading settings...</p> : null}
      {error ? <p className="status-bad">{error}</p> : null}
      {info ? <p className="status-good">{info}</p> : null}

      <div className="settings-cards">
        <article className="settings-card site-settings-card">
          <h3>Site Settings</h3>
          <p className="subhead">Branding used across the admin shell.</p>
          <div className="settings-grid site-settings-grid">
            <label>
              Site Title
              <input
                type="text"
                value={form.admin_title}
                onChange={(event) => setForm((previous) => ({ ...previous, admin_title: event.target.value }))}
                placeholder="KAAD-lp Admin"
              />
            </label>

            <label>
              Public Status Title
              <input
                type="text"
                value={form.public_status_title}
                onChange={(event) => setForm((previous) => ({ ...previous, public_status_title: event.target.value }))}
                placeholder="Public Status"
              />
            </label>
          </div>
        </article>

        <article className="settings-card stream-settings-card">
          <h3>Stream Settings</h3>
          <p className="subhead">Connection details for metadata updates and listener stats.</p>

          <div className="settings-grid stream-settings-grid">
            <label className="checkbox-row settings-span-2">
              <input
                type="checkbox"
                checked={Boolean(form.enabled)}
                onChange={(event) => setForm((previous) => ({ ...previous, enabled: event.target.checked }))}
              />
              Enable stream integration
            </label>

            <label>
              Scheme
              <select value={form.scheme} onChange={(event) => setForm((previous) => ({ ...previous, scheme: event.target.value }))}>
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>

            <label>
              Stream Host
              <input
                type="text"
                value={form.host}
                onChange={(event) => setForm((previous) => ({ ...previous, host: event.target.value }))}
                placeholder="example: icecast.example.org"
              />
            </label>

            <label>
              Stream Port
              <input
                type="number"
                min="1"
                max="65535"
                value={form.port}
                onChange={(event) => setForm((previous) => ({ ...previous, port: event.target.value }))}
              />
            </label>

            <label>
              Stream Mount
              <input
                type="text"
                value={form.mount}
                onChange={(event) => setForm((previous) => ({ ...previous, mount: event.target.value }))}
                placeholder="stream"
              />
            </label>

            <label>
              Source Username
              <input
                type="text"
                value={form.username}
                onChange={(event) => setForm((previous) => ({ ...previous, username: event.target.value }))}
                placeholder="source"
              />
            </label>

            <label>
              Source Password {form.password_set ? "(leave blank to keep current)" : ""}
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((previous) => ({ ...previous, password: event.target.value }))}
              />
            </label>
          </div>
        </article>
      </div>

      <div className="settings-actions">
        <button className="primary" type="button" onClick={handleSave} disabled={saving || loading}>
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <button className="ghost" type="button" onClick={loadSettings} disabled={loading || saving}>
          Reload
        </button>
      </div>
    </section>
  );
}

function ShowsTab({ shows, onOpenShow }) {
  const [searchText, setSearchText] = useState("");
  const [showTypeFilter, setShowTypeFilter] = useState("all");
  const [djFilter, setDjFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("all");

  const activeFilterCount =
    (searchText.trim() ? 1 : 0) +
    (showTypeFilter !== "all" ? 1 : 0) +
    (djFilter !== "all" ? 1 : 0) +
    (activeFilter !== "all" ? 1 : 0);

  const djOptions = useMemo(() => {
    const map = new Map();
    for (const show of shows) {
      for (const dj of show.djs || []) {
        if (!dj?.id || !dj?.name) continue;
        map.set(Number(dj.id), { id: Number(dj.id), name: dj.name });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [shows]);

  const filteredShows = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    return shows.filter((show) => {
      if (showTypeFilter !== "all" && show.show_type !== showTypeFilter) return false;
      if (activeFilter === "active" && !show.is_active) return false;
      if (activeFilter === "inactive" && show.is_active) return false;
      if (djFilter !== "all") {
        const wantedDjId = Number(djFilter);
        if (!(show.djs || []).some((dj) => Number(dj.id) === wantedDjId)) return false;
      }
      if (!needle) return true;
      const haystack = `${show.title || ""} ${show.slug || ""} ${(show.show_type || "")}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [shows, searchText, showTypeFilter, djFilter, activeFilter]);

  function resetFilters() {
    setSearchText("");
    setShowTypeFilter("all");
    setDjFilter("all");
    setActiveFilter("all");
  }

  function showTypeClass(showType) {
    const normalized = String(showType || "").toLowerCase();
    if (["music", "talk", "mixed", "special"].includes(normalized)) return `type-${normalized}`;
    return "type-default";
  }

  return (
    <section className="shows-shell">
      <div className="shows-header">
        <div>
          <h2>Shows</h2>
          <p className="subhead">Filter by type, DJ, and status, then open a show to edit details.</p>
        </div>
        <div className="shows-header-meta">
          <p className="shows-count">{filteredShows.length} show(s)</p>
          {activeFilterCount ? <p className="shows-active-filters">{activeFilterCount} filter(s) active</p> : null}
        </div>
      </div>

      <div className="shows-toolbar">
        <div className="shows-filters">
          <label>
            Search
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Title or slug"
            />
          </label>

          <label>
            Show Type
            <select value={showTypeFilter} onChange={(event) => setShowTypeFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="music">Music</option>
              <option value="talk">Talk</option>
              <option value="mixed">Mixed</option>
              <option value="special">Special</option>
            </select>
          </label>

          <label>
            DJ
            <select value={djFilter} onChange={(event) => setDjFilter(event.target.value)}>
              <option value="all">All DJs</option>
              {djOptions.map((dj) => (
                <option key={dj.id} value={String(dj.id)}>
                  {dj.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Status
            <select value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <div className="shows-toolbar-actions">
          <button className="ghost" type="button" onClick={resetFilters}>
            Reset Filters
          </button>
        </div>
      </div>

      <div className="shows-grid">
        {filteredShows.map((show) => (
          <article
            key={show.id}
            className={[
              "show-card",
              showTypeClass(show.show_type),
              show.is_active ? "is-active" : "is-inactive",
            ].join(" ")}
          >
            <div className="show-card-head">
              <h3>{show.title || "Untitled Show"}</h3>
              <span className={`show-type-pill ${showTypeClass(show.show_type)}`}>{show.show_type || "unknown"}</span>
            </div>

            <p className="show-card-slug">{show.slug || "n/a"}</p>

            <div className="show-card-djs">
              {(show.djs || []).length ? (
                (show.djs || []).slice(0, 4).map((dj) => (
                  <span key={`${show.id}-${dj.id}`} className="dj-chip">
                    {dj.name}
                    {dj.role ? <em>{dj.role}</em> : null}
                  </span>
                ))
              ) : (
                <span className="dj-chip empty">No DJs linked</span>
              )}
            </div>

            <div className="show-card-stats-row">
              <span className={show.is_active ? "status-pill active" : "status-pill inactive"}>
                {show.is_active ? "Active" : "Inactive"}
              </span>
              <span className={show.is_scheduled ? "status-pill scheduled" : "status-pill unscheduled"}>
                {show.is_scheduled ? "Scheduled" : "Unscheduled"}
              </span>
              <span className="show-stat">DJs: {(show.djs || []).length}</span>
            </div>

            <div className="show-card-actions">
              <button className="primary" type="button" onClick={() => onOpenShow(show.id)}>
                Edit Details
              </button>
            </div>
          </article>
        ))}
      </div>

      {!filteredShows.length ? <p className="shows-empty">No shows match the selected filters.</p> : null}
    </section>
  );
}

function PublicStatusPage() {
  const [publicStatusTitle, setPublicStatusTitle] = useState("Public Status");

  useEffect(() => {
    let cancelled = false;
    async function loadPublicSettings() {
      try {
        const payload =
          typeof apiAdapter.getPublicSiteSettings === "function"
            ? await apiAdapter.getPublicSiteSettings()
            : await fetch("/v1/status/site-settings").then((response) => response.json());
        if (cancelled) return;
        const item = payload?.item || {};
        setPublicStatusTitle(item.public_status_title || "Public Status");
      } catch (_error) {
        if (cancelled) return;
      }
    }
    loadPublicSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = publicStatusTitle;
  }, [publicStatusTitle]);

  return (
    <div className="page-shell public-status-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Radiant</p>
          <h1>{publicStatusTitle}</h1>
          <p className="subhead">Live listener counts, stream uptime, and listener geo visibility.</p>
        </div>
      </header>
      <StatsTab mode="public" />
    </div>
  );
}

function AdminApp() {
  const [slots, setSlots] = useState([]);
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [showDetailsShowId, setShowDetailsShowId] = useState(null);
  const [activeMobileDay, setActiveMobileDay] = useState(() => zonedWeekdayNum(new Date(), "America/Los_Angeles"));
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches) {
      return "day";
    }
    return "week";
  });
  const [activeTab, setActiveTab] = useState("schedule");
  const [adminTitle, setAdminTitle] = useState("KAAD-lp Admin");
  const [visibleWeekStartLocal, setVisibleWeekStartLocal] = useState(() => getCurrentWeekStartLocal("America/Los_Angeles"));
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [slotMenuId, setSlotMenuId] = useState(null);
  const [tooltipSlotId, setTooltipSlotId] = useState(null);
  const [touchSafeMode, setTouchSafeMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 980px), (pointer: coarse)").matches;
  });
  const gridRef = useRef(null);
  const tooltipTimerRef = useRef(null);
  const tempIdRef = useRef(1);

  const [dragState, setDragState] = useState(null);
  const [pendingCreates, setPendingCreates] = useState([]);
  const [pendingUpdates, setPendingUpdates] = useState({});
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const [committing, setCommitting] = useState(false);
  const [dismissToast, setDismissToast] = useState("");
  const effectiveViewMode = touchSafeMode ? "day" : viewMode;

  const scheduleTimezone = useMemo(() => {
    const slotWithTimezone = slots.find((slot) => String(slot.timezone || "").trim());
    return slotWithTimezone?.timezone || "America/Los_Angeles";
  }, [slots]);

  const dayDateByNum = useMemo(() => {
    const map = new Map();
    DAYS.forEach((day, index) => {
      map.set(day.num, shiftDateLocal(visibleWeekStartLocal, index));
    });
    return map;
  }, [visibleWeekStartLocal]);

  const weekRangeLabel = useMemo(() => formatWeekRange(visibleWeekStartLocal), [visibleWeekStartLocal]);

  function handleSiteTitlesChange(next = {}) {
    if (next?.adminTitle) {
      setAdminTitle(next.adminTitle);
    }
  }

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [slotData, showData] = await Promise.all([
        apiAdapter.getAdminScheduleSlots(),
        apiAdapter.getAdminShows(),
      ]);
      setSlots((slotData.items || []).map(normalizeSlot));
      setShows(showData.items || []);
      setPendingCreates([]);
      setPendingUpdates({});
      setPendingDeletes([]);
      setEditingSlotId(null);
      setSlotMenuId(null);
    } catch (loadError) {
      setError(loadError.message || "Failed to load schedule data.");
    } finally {
      setLoading(false);
    }
  }

  function handleShowChanged(nextShow) {
    if (!nextShow?.id) return;
    setShows((previous) =>
      previous.map((show) => {
        if (Number(show.id) !== Number(nextShow.id)) return show;
        return {
          ...show,
          ...nextShow,
        };
      }),
    );
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAdminShellSettings() {
      try {
        const payload = await apiAdapter.getAdminIcecastSettings();
        if (cancelled) return;
        const item = payload?.item || {};
        setAdminTitle(item.admin_title || "KAAD-lp Admin");
      } catch (_error) {
        if (cancelled) return;
      }
    }
    loadAdminShellSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pageMenuOpen) return undefined;
    function onPointerDown(event) {
      if (event.target instanceof Element && event.target.closest(".page-menu")) return;
      setPageMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [pageMenuOpen]);

  useEffect(() => {
    if (!dismissToast) return undefined;
    const timer = setTimeout(() => {
      setDismissToast("");
    }, 2200);
    return () => clearTimeout(timer);
  }, [dismissToast]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = adminTitle;
  }, [adminTitle]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 980px), (pointer: coarse)");
    const syncTouchSafe = () => setTouchSafeMode(media.matches);
    syncTouchSafe();
    media.addEventListener("change", syncTouchSafe);
    return () => media.removeEventListener("change", syncTouchSafe);
  }, []);

  useEffect(() => {
    if (!touchSafeMode) return;
    setViewMode("day");
    setActiveMobileDay(zonedWeekdayNum(new Date(), scheduleTimezone));
  }, [touchSafeMode, scheduleTimezone]);

  useEffect(
    () => () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!slotMenuId) return;
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltipSlotId(null);
  }, [slotMenuId]);

  useEffect(() => {
    if (!dragState) return undefined;

    function onPointerMove(event) {
      const deltaMinutes = Math.round((event.clientY - dragState.startY) / (PX_PER_MINUTE * 15)) * 15;
      const deltaDays = Math.round((event.clientX - dragState.startX) / dragState.columnWidth);

      setSlots((previous) =>
        previous.map((slot) => {
          if (slot.id !== dragState.slotId) return slot;

          const originalDuration = dragState.originEnd - dragState.originStart;
          if (dragState.mode === "resize") {
            const nextEnd = clamp(dragState.originEnd + deltaMinutes, dragState.originStart + 15, GRID_MINUTES);
            return {
              ...slot,
              end_time: formatMinutesToTime(nextEnd),
            };
          }

          const nextWeekday = clamp(dragState.originWeekday + deltaDays, 1, 7);
          const nextStart = clamp(dragState.originStart + deltaMinutes, 0, GRID_MINUTES - originalDuration);
          const nextEnd = nextStart + originalDuration;
          return {
            ...slot,
            weekday: nextWeekday,
            start_time: formatMinutesToTime(nextStart),
            end_time: formatMinutesToTime(nextEnd),
          };
        }),
      );
    }

    async function onPointerUp() {
      const slot = slots.find((item) => item.id === dragState.slotId);
      setDragState(null);
      if (!slot) return;
      const unchanged =
        Number(slot.weekday) === dragState.originWeekday &&
        slot.start_time === formatMinutesToTime(dragState.originStart) &&
        slot.end_time === formatMinutesToTime(dragState.originEnd);
      if (unchanged) return;
      stageSlotUpdate(slot.id, {
        weekday: slot.weekday,
        start_time: slot.start_time,
        end_time: slot.end_time,
      });
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [dragState, slots]);

  const slotsByDay = useMemo(() => {
    const grouped = new Map();
    for (const day of DAYS) grouped.set(day.num, []);
    for (const slot of slots) {
      if (!grouped.has(slot.weekday)) grouped.set(slot.weekday, []);
      grouped.get(slot.weekday).push(slot);
    }
    for (const day of DAYS) {
      grouped.get(day.num).sort((a, b) => parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time));
    }
    return grouped;
  }, [slots]);

  const showById = useMemo(() => {
    const map = new Map();
    for (const show of shows) map.set(show.id, show);
    return map;
  }, [shows]);

  const editingSlot = useMemo(
    () => slots.find((slot) => slot.id === editingSlotId) || null,
    [slots, editingSlotId],
  );
  const editingShow = editingSlot ? showById.get(editingSlot.show) || null : null;

  async function handleCreateSlot(formPayload) {
    setError("");
    setInfo("");
    const tempId = `tmp-${tempIdRef.current}`;
    tempIdRef.current += 1;
    const slot = normalizeSlot({
      id: tempId,
      weekday: Number(formPayload.weekday),
      start_time: formPayload.start_time,
      end_time: formPayload.end_time,
      timezone: formPayload.timezone,
      special_rule: normalizeScheduleRule(formPayload.special_rule),
      show: Number(formPayload.show),
      show_data: showById.get(Number(formPayload.show)) || null,
    });
    setSlots((previous) => [...previous, slot]);
    setPendingCreates((previous) => [
      ...previous,
      {
        tempId,
        payload: {
          ...formPayload,
          special_rule: normalizeScheduleRule(formPayload.special_rule),
        },
      },
    ]);
    setInfo("New slot staged. Click Commit Changes to save.");
    setAddDialogOpen(false);
  }

  async function handleDeleteSlot(slotId) {
    setError("");
    setInfo("");
    const isTemp = String(slotId).startsWith("tmp-");
    setSlots((previous) => previous.filter((slot) => slot.id !== slotId));
    if (isTemp) {
      setPendingCreates((previous) => previous.filter((item) => item.tempId !== slotId));
      setInfo("Staged slot removed.");
    } else {
      setPendingDeletes((previous) => (previous.includes(slotId) ? previous : [...previous, slotId]));
      setPendingUpdates((previous) => {
        const next = { ...previous };
        delete next[slotId];
        return next;
      });
      setInfo("Slot deletion staged. Click Commit Changes to apply.");
    }
    if (editingSlotId === slotId) setEditingSlotId(null);
    if (slotMenuId === slotId) setSlotMenuId(null);
  }

  async function handleSaveSlot(slotId, payload) {
    stageSlotUpdate(slotId, payload);
    setInfo("Slot changes staged. Click Commit Changes to save.");
    setEditingSlotId(null);
  }

  function stageSlotUpdate(slotId, payload) {
    const current = slots.find((slot) => slot.id === slotId) || null;
    const resolvedWeekday = payload.weekday == null ? current?.weekday : Number(payload.weekday);
    const resolvedStart = payload.start_time == null ? current?.start_time : payload.start_time;
    const resolvedEnd = payload.end_time == null ? current?.end_time : payload.end_time;
    const resolvedShow = payload.show == null ? current?.show : Number(payload.show);
    const resolvedTimezone = payload.timezone == null ? current?.timezone : payload.timezone;
    const resolvedRule = payload.special_rule == null ? current?.special_rule : payload.special_rule;

    const normalized = {
      weekday: Number(resolvedWeekday),
      start_time: formatMinutesToTime(parseTimeToMinutes(resolvedStart)),
      end_time: formatMinutesToTime(parseTimeToMinutes(resolvedEnd)),
      show: Number(resolvedShow),
      timezone: resolvedTimezone || "America/Los_Angeles",
      special_rule: normalizeScheduleRule(resolvedRule),
    };
    setSlots((previous) =>
      previous.map((slot) => {
        if (slot.id !== slotId) return slot;
        return {
          ...slot,
          ...normalized,
          show_data: showById.get(Number(normalized.show)) || slot.show_data || null,
        };
      }),
    );
    if (String(slotId).startsWith("tmp-")) {
      setPendingCreates((previous) =>
        previous.map((item) =>
          item.tempId === slotId
            ? {
                ...item,
                payload: {
                  ...item.payload,
                  ...normalized,
                },
              }
            : item,
        ),
      );
      return;
    }
    setPendingUpdates((previous) => ({
      ...previous,
      [slotId]: {
        ...(previous[slotId] || {}),
        ...normalized,
      },
    }));
  }

  function beginTooltipHover(slotId) {
    if (touchSafeMode || slotMenuId) return;
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    tooltipTimerRef.current = setTimeout(() => {
      setTooltipSlotId(slotId);
      tooltipTimerRef.current = null;
    }, 1000);
  }

  function endTooltipHover(slotId) {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltipSlotId((current) => (current === slotId ? null : current));
  }

  async function handleCommitChanges() {
    if (committing) return;
    setCommitting(true);
    setError("");
    setInfo("");

    try {
      for (const createItem of pendingCreates) {
        const created = await apiAdapter.createScheduleSlot(createItem.payload);
        const realId = created?.item?.id;
        if (!realId) throw new Error("Failed to create staged slot.");
      }

      for (const [slotIdText, payload] of Object.entries(pendingUpdates)) {
        const slotId = Number(slotIdText);
        if (!Number.isInteger(slotId)) continue;
        if (pendingDeletes.includes(slotId)) continue;
        await apiAdapter.updateScheduleSlot(slotId, payload);
      }

      for (const slotId of pendingDeletes) {
        await apiAdapter.deleteScheduleSlot(slotId);
      }

      setInfo("All staged schedule changes committed.");
      await loadData();
    } catch (commitError) {
      setError(commitError.message || "Failed to commit staged changes.");
    } finally {
      setCommitting(false);
    }
  }

  const pendingCount = pendingCreates.length + Object.keys(pendingUpdates).length + pendingDeletes.length;

  function beginDrag(event, slot, mode) {
    if (touchSafeMode) return;
    if (!gridRef.current) return;
    const rect = gridRef.current.getBoundingClientRect();
    const columnWidth = rect.width / 7;
    setDragState({
      slotId: slot.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      originStart: parseTimeToMinutes(slot.start_time),
      originEnd: parseTimeToMinutes(slot.end_time),
      originWeekday: slot.weekday,
      columnWidth,
    });
  }

  function showPreviousWeek() {
    setVisibleWeekStartLocal((current) => shiftDateLocal(current, -7));
  }

  function showNextWeek() {
    setVisibleWeekStartLocal((current) => shiftDateLocal(current, 7));
  }

  function showCurrentWeek() {
    setVisibleWeekStartLocal(getCurrentWeekStartLocal(scheduleTimezone));
  }

  async function discardPendingChanges() {
    if (committing) return;
    setError("");
    setInfo("");
    await loadData();
    setDismissToast("Staged changes discarded");
  }

  return (
    <div className={touchSafeMode ? "page-shell touch-safe" : "page-shell"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Radiant</p>
          <h1>{adminTitle}</h1>
          <p className="subhead">
            {activeTab === "schedule"
              ? "Sun-Sat visual planner with drag, resize, and quick slot creation."
              : activeTab === "shows"
                ? "Filter and edit show records, metadata, and DJ relationships."
                : activeTab === "reports"
                  ? "Generate and download reporting exports for station operations."
                  : activeTab === "stats"
                    ? "Live listener counts, uptime, and geo visibility from Icecast data."
                  : "Configure branding and stream integration for metadata updates and listener stats."}
          </p>
        </div>
        <div className="topbar-actions">
          <div className="page-menu">
            <button
              className="ghost page-menu-trigger"
              type="button"
              aria-haspopup="menu"
              aria-expanded={pageMenuOpen}
              aria-label="Open page menu"
              onClick={() => setPageMenuOpen((value) => !value)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            {pageMenuOpen ? (
              <div className="page-menu-popover" role="menu">
                {[
                  { key: "schedule", label: "Schedule" },
                  { key: "shows", label: "Shows" },
                  { key: "reports", label: "Reporting" },
                  { key: "stats", label: "Stats" },
                  { key: "settings", label: "Settings" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={activeTab === item.key ? "active" : ""}
                    role="menuitem"
                    onClick={() => {
                      setActiveTab(item.key);
                      setPageMenuOpen(false);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className={activeTab === "schedule" ? "control-row" : "control-row is-hidden"}>
          </div>
        </div>
      </header>

      <section className="status-strip">
        {loading ? <span>Loading schedule...</span> : null}
        {!loading && pendingCount > 0 ? <span>{pendingCount} staged change(s)</span> : null}
        {info ? <span className="status-good">{info}</span> : null}
        {error ? <span className="status-bad">{error}</span> : null}
      </section>
      <UserMenu />

      {activeTab === "schedule" && pendingCount > 0 ? (
        <div className="staged-fab" role="region" aria-label="Staged schedule changes">
          <span>{pendingCount} staged</span>
          <button className="confirm" type="button" onClick={handleCommitChanges} disabled={committing} title="Commit staged changes">
            {committing ? "..." : "✓"}
          </button>
          <button className="dismiss" type="button" onClick={discardPendingChanges} disabled={committing} title="Discard staged changes">
            X
          </button>
        </div>
      ) : null}

      {dismissToast ? <div className="floating-toast">{dismissToast}</div> : null}

      {activeTab === "schedule" ? (
        <>
          <section className="schedule-toolbar">
            {!touchSafeMode ? (
              <div className="schedule-view-controls">
                <button
                  className={viewMode === "week" ? "ghost active" : "ghost"}
                  type="button"
                  aria-pressed={viewMode === "week"}
                  onClick={() => setViewMode("week")}
                >
                  Week
                </button>
                <button
                  className={viewMode === "day" ? "ghost active" : "ghost"}
                  type="button"
                  aria-pressed={viewMode === "day"}
                  onClick={() => setViewMode("day")}
                >
                  Day
                </button>
                <label className={viewMode === "day" ? "day-picker" : "day-picker hidden"}>
                  Day
                  <select
                    value={String(activeMobileDay)}
                    onChange={(event) => setActiveMobileDay(Number(event.target.value))}
                    disabled={viewMode !== "day"}
                  >
                    {DAYS.map((day) => (
                      <option key={day.num} value={String(day.num)}>
                        {day.label} {formatDateShort(dayDateByNum.get(day.num))}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            <div className="schedule-toolbar-right">
              <div className="week-nav" aria-label="Visible calendar week">
                <button className="ghost" onClick={showPreviousWeek} type="button" aria-label="Previous week">
                  ←
                </button>
                <button className="ghost" onClick={showCurrentWeek} type="button">
                  Today
                </button>
                <button className="ghost" onClick={showNextWeek} type="button" aria-label="Next week">
                  →
                </button>
                <span className="week-range-label">{weekRangeLabel}</span>
              </div>
              <button className="add-slot-plus" onClick={() => setAddDialogOpen(true)} type="button" aria-label="Add slot" title="Add slot">
                +
              </button>
            </div>
          </section>

          <section className="mobile-day-tabs">
            {DAYS.map((day) => (
              <button
                key={day.num}
                type="button"
                className={activeMobileDay === day.num ? "day-tab active" : "day-tab"}
                aria-pressed={activeMobileDay === day.num}
                onClick={() => {
                  setActiveMobileDay(day.num);
                  setViewMode("day");
                }}
              >
                {day.label} {formatDateShort(dayDateByNum.get(day.num))}
              </button>
            ))}
          </section>

          <section className={effectiveViewMode === "day" ? "schedule-wrap day-mode" : "schedule-wrap"}>
            <aside className="hours-column">
              <div className="hours-spacer" />
              <div
                className="hour-cell collapsed"
                style={{ height: `${COMPRESSED_BLOCK_VISUAL_MINUTES * PX_PER_MINUTE}px` }}
              >
                12:00 AM - 7:00 AM
              </div>
              {Array.from({ length: 17 }, (_, index) => {
                const hour = 7 + index;
                return (
                  <div key={String(hour)} className="hour-cell">
                    {minuteToDisplay(hour * 60)}
                  </div>
                );
              })}
            </aside>

        <div className={effectiveViewMode === "day" ? "grid-shell day-mode" : "grid-shell"} ref={gridRef}>
          {(effectiveViewMode === "day" ? DAYS.filter((day) => day.num === activeMobileDay) : DAYS).map((day) => {
            const daySlotsAll = slotsByDay.get(day.num) || [];
            const dayDateLocal = dayDateByNum.get(day.num);
            const daySlots = resolveVisibleSlotsForDate(daySlotsAll, dayDateLocal);
            return (
              <div
                key={day.num}
                className="day-column"
              >
                <header className="day-header">
                  <span>{day.label}</span>
                  <small>{formatDateShort(dayDateByNum.get(day.num))}</small>
                </header>
                <div className="day-body" style={{ height: `${GRID_VISIBLE_MINUTES * PX_PER_MINUTE}px` }}>
                  {[0, 7 * 60, ...Array.from({ length: 17 }, (_, index) => (8 + index) * 60)].map((minuteMark) => {
                    return (
                      <div
                        key={`${day.num}-${minuteMark}`}
                        className="hour-line"
                        style={{ top: `${minuteToVisualMinute(minuteMark) * PX_PER_MINUTE}px` }}
                      />
                    );
                  })}

                  {daySlots.map((slot) => {
                    const show = showById.get(slot.show) || slot.show_data || {};
                    const hasConflict = overlapsOnDay(daySlots, slot);
                    const sideBySide = getSideBySideInfo(daySlots, slot);
                    const effectiveRule = getEffectiveRuleForSlot(daySlotsAll.filter((item) => sameWindow(item, slot)), slot);
                    const slotTimeLabel = `${minuteToDisplay(parseTimeToMinutes(slot.start_time))} - ${minuteToDisplay(parseTimeToMinutes(slot.end_time))}`;
                    return (
                      <article
                        key={slot.id}
                        className={
                          [
                            "slot-card",
                            `type-${String(show.show_type || "default").toLowerCase()}`,
                            hasConflict ? "conflict" : "",
                            slotMenuId === slot.id ? "menu-open" : "",
                            tooltipSlotId === slot.id ? "tooltip-visible" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                        style={{
                          ...blockStyle(slot, sideBySide),
                          zIndex: slotMenuId === slot.id ? 80 : 2,
                        }}
                        onPointerDown={touchSafeMode ? undefined : (event) => beginDrag(event, slot, "move")}
                        onPointerEnter={touchSafeMode ? undefined : () => beginTooltipHover(slot.id)}
                        onPointerLeave={touchSafeMode ? undefined : () => endTooltipHover(slot.id)}
                        onFocus={touchSafeMode ? undefined : () => beginTooltipHover(slot.id)}
                        onBlur={touchSafeMode ? undefined : () => endTooltipHover(slot.id)}
                      >
                        <div className="slot-tooltip" role="note" aria-hidden="true">
                          <strong>{show.title || "Unassigned Show"}</strong>
                          <span>{slotTimeLabel}</span>
                        </div>
                        <div className="slot-head">
                          <h3>
                            <button
                              type="button"
                              className="show-link"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (show?.id) setShowDetailsShowId(show.id);
                              }}
                            >
                              {show.title || "Unassigned Show"}
                            </button>
                          </h3>
                          <div className="slot-actions">
                            <button
                              type="button"
                              className="slot-menu-trigger"
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSlotMenuId((previous) => (previous === slot.id ? null : slot.id));
                              }}
                              title="Slot actions"
                              aria-expanded={slotMenuId === slot.id}
                            >
                              ...
                            </button>
                            {slotMenuId === slot.id ? (
                              <div
                                className="slot-menu"
                                onPointerDown={(event) => event.stopPropagation()}
                                role="menu"
                              >
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingSlotId(slot.id);
                                    setSlotMenuId(null);
                                  }}
                                >
                                  Edit Slot
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (show?.id) setShowDetailsShowId(show.id);
                                    setSlotMenuId(null);
                                  }}
                                >
                                  Show Detail
                                </button>
                                <button
                                  type="button"
                                  className="danger-item"
                                  disabled={committing}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteSlot(slot.id);
                                    setSlotMenuId(null);
                                  }}
                                >
                                  Delete Slot
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <p>{slotTimeLabel}</p>
                        {normalizeScheduleRule(effectiveRule) !== "every_week" ? (
                          <p className="alt-note">Recurrence: {recurrenceLabel(effectiveRule)}</p>
                        ) : null}
                        {hasConflict ? <p className="conflict-note">Schedule conflict</p> : null}
                        {!touchSafeMode ? (
                          <div
                            className="resize-handle"
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              beginDrag(event, slot, "resize");
                            }}
                            role="presentation"
                          />
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
          </section>
        </>
      ) : activeTab === "shows" ? (
        <ShowsTab shows={shows} onOpenShow={setShowDetailsShowId} />
      ) : activeTab === "reports" ? (
        <ReportingTab />
      ) : activeTab === "stats" ? (
        <StatsTab />
      ) : (
        <SettingsTab onSiteTitlesChange={handleSiteTitlesChange} />
      )}

      <AddSlotDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        onCreate={handleCreateSlot}
        shows={shows}
      />
      <EditSlotDialog
        open={Boolean(editingSlotId)}
        slot={editingSlot}
        show={editingShow}
        shows={shows}
        onClose={() => setEditingSlotId(null)}
        onSave={handleSaveSlot}
        onDelete={handleDeleteSlot}
        saving={committing}
      />
      <ShowDetailsDialog
        open={Boolean(showDetailsShowId)}
        showId={showDetailsShowId}
        onClose={() => setShowDetailsShowId(null)}
        onShowChanged={handleShowChanged}
      />
    </div>
  );
}

function AdminAppWithAuth() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AdminApp />;
}

export function App() {
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  
  // Public routes that don't require auth
  if (path.startsWith("/status")) {
    return <PublicStatusPage />;
  }
  
  // Auth flow routes
  if (path === "/accept-invite" || search.includes("token=")) {
    return (
      <AuthProvider>
        <AcceptInvitePage />
      </AuthProvider>
    );
  }
  
  if (path === "/forgot-password") {
    return (
      <AuthProvider>
        <ForgotPasswordPage />
      </AuthProvider>
    );
  }
  
  if (path === "/reset-password") {
    return (
      <AuthProvider>
        <ResetPasswordPage />
      </AuthProvider>
    );
  }
  
  // Main admin app with auth
  return (
    <AuthProvider>
      <AdminAppWithAuth />
    </AuthProvider>
  );
}
