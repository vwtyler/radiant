import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiAdapter } from "./lib/apiAdapter";

const DAYS = [
  { num: 7, label: "Sun" },
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
];

const PX_PER_MINUTE = 1.1;
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

function getSideBySideInfo(daySlots, targetSlot) {
  const targetMeta = parseAlternatingMeta(targetSlot.slot_key);
  if (!targetMeta.enabled) return { count: 1, index: 0 };

  const siblings = daySlots
    .filter((slot) => sameWindow(slot, targetSlot) && areAlternatingPair(slot, targetSlot))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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
  const style = {
    top: `${minuteToVisualMinute(start) * PX_PER_MINUTE}px`,
    height: `${Math.max(rangeToVisualMinutes(start, duration) * PX_PER_MINUTE, 24)}px`,
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
    alternating_enabled: false,
    alternating_group: "",
  });

  useEffect(() => {
    if (!open) return;
    if (!form.show && shows[0]) {
      setForm((prev) => ({ ...prev, show: String(shows[0].id) }));
    }
  }, [open, shows, form.show]);

  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.alternating_enabled}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                alternating_enabled: event.target.checked,
                alternating_group: event.target.checked ? prev.alternating_group : "",
              }))
            }
          />
          Alternating with another show in this slot
        </label>

        {form.alternating_enabled ? (
          <label>
            Alternating Group
            <input
              type="text"
              value={form.alternating_group}
              onChange={(event) => setForm((prev) => ({ ...prev, alternating_group: event.target.value }))}
              placeholder="example: tuesday-overnight"
            />
          </label>
        ) : null}

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
    const alternating = parseAlternatingMeta(slot.slot_key);
    setForm({
      weekday: Number(slot.weekday),
      start_time: slot.start_time,
      end_time: slot.end_time,
      show: Number(slot.show),
      timezone: slot.timezone || "America/Los_Angeles",
      slot_key: slot.slot_key || "",
      alternating_enabled: alternating.enabled,
      alternating_group: alternating.group,
    });
  }, [open, slot]);

  if (!open || !slot || !form) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={Boolean(form.alternating_enabled)}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                alternating_enabled: event.target.checked,
                alternating_group: event.target.checked ? prev.alternating_group : "",
              }))
            }
          />
          Alternating with another show in this slot
        </label>

        {form.alternating_enabled ? (
          <label>
            Alternating Group
            <input
              type="text"
              value={form.alternating_group || ""}
              onChange={(event) => setForm((prev) => ({ ...prev, alternating_group: event.target.value }))}
              placeholder="example: tuesday-overnight"
            />
          </label>
        ) : null}

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
    <div className="modal-overlay popup" role="dialog" aria-modal="true">
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

function ShowDetailsDialog({ open, showId, onClose }) {
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
  const [form, setForm] = useState({ title: "", slug: "", show_type: "music", description: "" });

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
      });
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
    <div className="modal-overlay" role="dialog" aria-modal="true">
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
        <div className="modal-overlay popup" role="dialog" aria-modal="true">
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

export function App() {
  const [slots, setSlots] = useState([]);
  const [shows, setShows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [showDetailsShowId, setShowDetailsShowId] = useState(null);
  const [activeMobileDay, setActiveMobileDay] = useState(7);
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches) {
      return "day";
    }
    return "week";
  });
  const [activeTab, setActiveTab] = useState("schedule");
  const [slotMenuId, setSlotMenuId] = useState(null);
  const gridRef = useRef(null);
  const tempIdRef = useRef(1);

  const [dragState, setDragState] = useState(null);
  const [pendingCreates, setPendingCreates] = useState([]);
  const [pendingUpdates, setPendingUpdates] = useState({});
  const [pendingDeletes, setPendingDeletes] = useState([]);
  const [committing, setCommitting] = useState(false);

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

  useEffect(() => {
    loadData();
  }, []);

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
    if (formPayload.alternating_enabled && !String(formPayload.alternating_group || "").trim()) {
      setError("Alternating Group is required when alternating is enabled.");
      return;
    }
    const slotKey = formPayload.alternating_enabled
      ? buildAlternatingSlotKey({
          weekday: Number(formPayload.weekday),
          startTime: formPayload.start_time,
          endTime: formPayload.end_time,
          group: formPayload.alternating_group,
          previousSlotKey: "",
        })
      : "";
    const tempId = `tmp-${tempIdRef.current}`;
    tempIdRef.current += 1;
    const slot = normalizeSlot({
      id: tempId,
      slot_key: slotKey,
      weekday: Number(formPayload.weekday),
      start_time: formPayload.start_time,
      end_time: formPayload.end_time,
      timezone: formPayload.timezone,
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
          slot_key: slotKey,
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
    if (payload.alternating_enabled && !String(payload.alternating_group || "").trim()) {
      setError("Alternating Group is required when alternating is enabled.");
      return;
    }
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
    const alternatingEnabled = payload.alternating_enabled == null
      ? parseAlternatingMeta(payload.slot_key == null ? current?.slot_key : payload.slot_key).enabled
      : Boolean(payload.alternating_enabled);
    const alternatingGroup = payload.alternating_group == null
      ? parseAlternatingMeta(payload.slot_key == null ? current?.slot_key : payload.slot_key).group
      : String(payload.alternating_group || "");
    const nextSlotKey = alternatingEnabled
      ? buildAlternatingSlotKey({
          weekday: Number(resolvedWeekday),
          startTime: formatMinutesToTime(parseTimeToMinutes(resolvedStart)),
          endTime: formatMinutesToTime(parseTimeToMinutes(resolvedEnd)),
          group: alternatingGroup,
          previousSlotKey: payload.slot_key == null ? current?.slot_key : payload.slot_key,
        })
      : "";

    const normalized = {
      weekday: Number(resolvedWeekday),
      start_time: formatMinutesToTime(parseTimeToMinutes(resolvedStart)),
      end_time: formatMinutesToTime(parseTimeToMinutes(resolvedEnd)),
      show: Number(resolvedShow),
      timezone: resolvedTimezone || "America/Los_Angeles",
      slot_key: nextSlotKey,
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

  return (
    <div className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Radiant</p>
          <h1>KAAD-lp Admin</h1>
          <p className="subhead">
            {activeTab === "schedule"
              ? "Sun-Sat visual planner with drag, resize, and quick slot creation."
              : "Generate and download reporting exports for station operations."}
          </p>
        </div>
        <div className="topbar-actions">
          <div className="tab-row">
            <button
              className={activeTab === "schedule" ? "ghost active" : "ghost"}
              type="button"
              aria-pressed={activeTab === "schedule"}
              onClick={() => setActiveTab("schedule")}
            >
              Schedule
            </button>
            <button
              className={activeTab === "reports" ? "ghost active" : "ghost"}
              type="button"
              aria-pressed={activeTab === "reports"}
              onClick={() => setActiveTab("reports")}
            >
              Reporting
            </button>
          </div>

          <div className={activeTab === "schedule" ? "control-row" : "control-row is-hidden"}>
            <button
              className={viewMode === "week" ? "ghost active" : "ghost"}
              type="button"
              aria-pressed={viewMode === "week"}
              onClick={() => setViewMode("week")}
              disabled={activeTab !== "schedule"}
            >
              Week
            </button>
            <button
              className={viewMode === "day" ? "ghost active" : "ghost"}
              type="button"
              aria-pressed={viewMode === "day"}
              onClick={() => setViewMode("day")}
              disabled={activeTab !== "schedule"}
            >
              Day
            </button>
            <label className={viewMode === "day" && activeTab === "schedule" ? "day-picker" : "day-picker hidden"}>
              Day
              <select
                value={String(activeMobileDay)}
                onChange={(event) => setActiveMobileDay(Number(event.target.value))}
                disabled={activeTab !== "schedule" || viewMode !== "day"}
              >
                {DAYS.map((day) => (
                  <option key={day.num} value={String(day.num)}>
                    {day.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              onClick={handleCommitChanges}
              type="button"
              disabled={activeTab !== "schedule" || pendingCount === 0 || committing}
              title="Commit staged schedule changes"
            >
              {committing ? "Committing..." : `Commit Changes (${pendingCount})`}
            </button>
            <button
              className="primary"
              onClick={() => setAddDialogOpen(true)}
              type="button"
              disabled={activeTab !== "schedule"}
            >
              Add Slot
            </button>
            <button className="ghost" onClick={loadData} type="button" disabled={activeTab !== "schedule"}>
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="status-strip">
        {loading ? <span>Loading schedule...</span> : null}
        {!loading && pendingCount > 0 ? <span>{pendingCount} staged change(s)</span> : null}
        {info ? <span className="status-good">{info}</span> : null}
        {error ? <span className="status-bad">{error}</span> : null}
      </section>

      {activeTab === "schedule" ? (
        <>
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
                {day.label}
              </button>
            ))}
          </section>

          <section className={viewMode === "day" ? "schedule-wrap day-mode" : "schedule-wrap"}>
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

        <div className={viewMode === "day" ? "grid-shell day-mode" : "grid-shell"} ref={gridRef}>
          {(viewMode === "day" ? DAYS.filter((day) => day.num === activeMobileDay) : DAYS).map((day) => {
            const daySlots = slotsByDay.get(day.num) || [];
            return (
              <div
                key={day.num}
                className="day-column"
              >
                <header className="day-header">{day.label}</header>
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
                    const alternating = parseAlternatingMeta(slot.slot_key);
                    return (
                      <article
                        key={slot.id}
                        className={
                          [
                            "slot-card",
                            hasConflict ? "conflict" : "",
                            slotMenuId === slot.id ? "menu-open" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                        style={{
                          ...blockStyle(slot, sideBySide),
                          zIndex: slotMenuId === slot.id ? 80 : 2,
                        }}
                        onPointerDown={(event) => beginDrag(event, slot, "move")}
                      >
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
                        <p>{`${minuteToDisplay(parseTimeToMinutes(slot.start_time))} - ${minuteToDisplay(parseTimeToMinutes(slot.end_time))}`}</p>
                        {alternating.enabled ? <p className="alt-note">Alternating: {alternating.group}</p> : null}
                        {hasConflict ? <p className="conflict-note">Schedule conflict</p> : null}
                        <div
                          className="resize-handle"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            beginDrag(event, slot, "resize");
                          }}
                          role="presentation"
                        />
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
      ) : (
        <ReportingTab />
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
      />
    </div>
  );
}
