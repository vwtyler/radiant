(function () {
  const cfg = window.radiantWpGridConfig || {};
  const apiBaseUrl = String(cfg.apiBaseUrl || "").replace(/\/$/, "");
  const defaultTimezone = String(cfg.defaultTimezone || "America/Los_Angeles");
  const proxyUrl = String(cfg.proxyUrl || "");

  const DAYS = [
    { num: 7, label: "Sun" },
    { num: 1, label: "Mon" },
    { num: 2, label: "Tue" },
    { num: 3, label: "Wed" },
    { num: 4, label: "Thu" },
    { num: 5, label: "Fri" },
    { num: 6, label: "Sat" },
  ];

  const PX_PER_MINUTE = 1.2;
  const COMPRESSED_END = 7 * 60;
  const COMPRESSED_VISUAL = 60;
  const DAY_VISIBLE_MINUTES = COMPRESSED_VISUAL + (24 * 60 - COMPRESSED_END);
  const SLOT_GAP_PX = 4;

  const showDetailsCache = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function parseHHMM(value) {
    const parts = String(value || "").split(":");
    const h = Number(parts[0] || 0);
    const m = Number(parts[1] || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    if (h < 0 || h > 24 || m < 0 || m > 59) return 0;
    return h === 24 ? 24 * 60 : h * 60 + m;
  }

  function visualMinute(minute) {
    const safe = Math.max(0, Math.min(24 * 60, Math.round(minute)));
    if (safe <= COMPRESSED_END) return (safe / COMPRESSED_END) * COMPRESSED_VISUAL;
    return COMPRESSED_VISUAL + (safe - COMPRESSED_END);
  }

  function visualMinutePx(minute) {
    return Math.round(visualMinute(minute) * PX_PER_MINUTE);
  }

  function durationMinutes(slot) {
    const start = parseHHMM(slot.start_time);
    const end = parseHHMM(slot.end_time);
    if (end > start) return end - start;
    if (end === 0 && start > 0) return 24 * 60 - start;
    return 30;
  }

  function visualDuration(startMinute, duration) {
    const end = Math.min(24 * 60, startMinute + Math.max(0, duration));
    return Math.max(0, visualMinute(end) - visualMinute(startMinute));
  }

  function formatTime(minutes) {
    const h24 = Math.floor(minutes / 60) % 24;
    const min = String(minutes % 60).padStart(2, "0");
    const meridiem = h24 >= 12 ? "PM" : "AM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${min} ${meridiem}`;
  }

  function formatRange(slot) {
    const start = parseHHMM(slot.start_time);
    const end = parseHHMM(slot.end_time);
    return `${formatTime(start)} - ${formatTime(end)}`;
  }

  function formatDateLabel(dateLocal) {
    const raw = String(dateLocal || "").trim();
    if (!raw) return "";
    const date = new Date(`${raw}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  }

  function formatAiringLabel(airing) {
    const weekday = String(airing.weekday_name || "").trim();
    const date = formatDateLabel(airing.date_local);
    const start = formatTime(parseHHMM(airing.start_time));
    const end = formatTime(parseHHMM(airing.end_time));
    return `${weekday} ${date} · ${start} - ${end}`.trim();
  }

  function getTodayWeekdayNum(timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: timezone,
      }).format(new Date());
      const map = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      return map[parts] || 7;
    } catch (_error) {
      return 7;
    }
  }

  async function fetchJson(path, query) {
    const params = query || {};

    if (proxyUrl) {
      try {
        const url = new URL(proxyUrl, window.location.origin);
        url.searchParams.set("action", "radiant_wp_proxy");
        url.searchParams.set("radiant_path", path);
        Object.entries(params).forEach(([key, value]) => {
          if (value != null && value !== "") url.searchParams.set(key, String(value));
        });

        const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, credentials: "same-origin" });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || payload.success !== true) {
          const message =
            (payload && payload.data && payload.data.message) ||
            (payload && payload.message) ||
            `Proxy request failed (${response.status})`;
          throw new Error(message);
        }
        return payload.data;
      } catch (proxyError) {
        if (!apiBaseUrl) {
          throw proxyError;
        }
      }
    }

    if (!apiBaseUrl) throw new Error("Radiant API Base URL is not configured.");
    const directUrl = new URL(path, `${apiBaseUrl}/`);
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== "") directUrl.searchParams.set(key, String(value));
    });
    const directResponse = await fetch(directUrl.toString(), { headers: { Accept: "application/json" } });
    const directData = await directResponse.json().catch(() => ({}));
    if (!directResponse.ok) {
      throw new Error(directData && (directData.message || directData.error) ? directData.message || directData.error : "Request failed");
    }
    return directData;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function slotShow(slot) {
    return slot && slot.show && typeof slot.show === "object" ? slot.show : null;
  }

  function buildHourMarkers() {
    const markers = [0, COMPRESSED_END];
    for (let hour = 8; hour <= 24; hour += 1) markers.push(hour * 60);
    return markers;
  }

  function makeSlotCard(slot, onClick, isLive) {
    const start = parseHHMM(slot.start_time);
    const duration = durationMinutes(slot);
    const rawTop = visualMinutePx(start);
    const rawHeight = Math.max(Math.round(visualDuration(start, duration) * PX_PER_MINUTE), 36);
    const top = rawTop + Math.floor(SLOT_GAP_PX / 2);
    const height = Math.max(rawHeight - SLOT_GAP_PX, 24);

    const card = el("button", "radiant-grid-slot");
    if (isLive) card.classList.add("is-live");
    card.type = "button";
    card.style.top = `${top}px`;
    card.style.height = `${height}px`;

    const time = el("span", "radiant-grid-slot-time", formatRange(slot));
    const title = el("span", "radiant-grid-slot-title", slotShow(slot)?.title || "Unassigned Show");
    card.appendChild(time);
    card.appendChild(title);
    card.addEventListener("click", () => onClick(slot));
    return card;
  }

  function makeDayColumn(day, slots, state, onSlotClick) {
    const col = el("section", "radiant-grid-day");
    const head = el("header", "radiant-grid-day-header", day.label);
    const body = el("div", "radiant-grid-day-body");
    body.style.height = `${Math.round(DAY_VISIBLE_MINUTES * PX_PER_MINUTE)}px`;

    buildHourMarkers().forEach((minute) => {
      const line = el("div", "radiant-grid-hour-line");
      line.style.top = `${visualMinutePx(minute)}px`;
      body.appendChild(line);
    });

    if (!slots.length) {
      body.appendChild(el("p", "radiant-grid-empty", "No scheduled slots"));
    }

    slots.forEach((slot) => {
      const isLive = state.liveSlot && state.liveSlot.start_time === slot.start_time && state.liveSlot.end_time === slot.end_time && Number(state.liveSlot.weekday) === Number(slot.weekday);
      body.appendChild(makeSlotCard(slot, onSlotClick, !!isLive));
    });

    col.appendChild(head);
    col.appendChild(body);
    return col;
  }

  function makeModal(state) {
    const overlay = el("div", "radiant-grid-modal-overlay");
    const modal = el("div", "radiant-grid-modal");
    const close = el("button", "radiant-grid-modal-close", "×");
    close.type = "button";
    close.addEventListener("click", () => {
      overlay.remove();
      document.body.classList.remove("radiant-grid-modal-open");
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        overlay.remove();
        document.body.classList.remove("radiant-grid-modal-open");
      }
    });

    const title = el("h3", "radiant-grid-modal-title", state.title || "Show Details");
    const time = el("p", "radiant-grid-modal-time", state.time || "");

    const djWrap = el("div", "radiant-grid-modal-section");
    djWrap.appendChild(el("h4", "", "DJs"));
    if (state.djs && state.djs.length) {
      const ul = el("ul", "radiant-grid-modal-list");
      state.djs.forEach((dj) => ul.appendChild(el("li", "", dj)));
      djWrap.appendChild(ul);
    } else {
      djWrap.appendChild(el("p", "radiant-grid-muted", "No DJs listed."));
    }

    const airingsWrap = el("div", "radiant-grid-modal-section");
    const airingsTitle = el("h4", "", "Recent Airings");
    airingsWrap.appendChild(airingsTitle);

    const tracksWrap = el("div", "radiant-grid-modal-section");
    const playlistTitle = el("h4", "", "Playlist");
    tracksWrap.appendChild(playlistTitle);

    const airings = Array.isArray(state.airings) ? state.airings : [];
    const tracksByAiring = state.tracksByAiring && typeof state.tracksByAiring === "object" ? state.tracksByAiring : {};

    if (airings.length) {
      const airingButtons = el("div", "radiant-grid-airings");
      const tracksList = el("ul", "radiant-grid-modal-list");
      const tracksEmpty = el("p", "radiant-grid-muted", "No tracks found for this airing.");

      let selectedKey = (airings.find((item) => (tracksByAiring[item.key] || []).length > 0) || airings[0]).key;

      function updateButtons() {
        const buttons = airingButtons.querySelectorAll("button");
        buttons.forEach((button) => {
          if (button.getAttribute("data-airing-key") === selectedKey) button.classList.add("active");
          else button.classList.remove("active");
        });
      }

      function renderTracks() {
        clearNode(tracksList);
        const activeAiring = airings.find((item) => item.key === selectedKey) || null;
        let activeTracks = Array.isArray(tracksByAiring[selectedKey]) ? tracksByAiring[selectedKey] : [];
        if ((!activeTracks || !activeTracks.length) && activeAiring && activeAiring.inProgress && state.currentTrack) {
          activeTracks = [state.currentTrack];
        }
        if ((!activeTracks || !activeTracks.length) && state.tracks && state.tracks.length) {
          activeTracks = state.tracks.slice(0, 25);
        }
        playlistTitle.textContent = `Playlist${activeAiring ? ` · ${activeAiring.label}` : ""}`;

        if (!activeTracks.length) {
          tracksList.style.display = "none";
          tracksEmpty.style.display = "block";
          return;
        }

        tracksList.style.display = "block";
        tracksEmpty.style.display = "none";
        activeTracks.forEach((track) => {
          const li = el("li");
          li.textContent = `${track.artist || "Unknown Artist"} - ${track.title || "Unknown Track"}`;
          tracksList.appendChild(li);
        });
      }

      airings.forEach((airing) => {
        const btn = el("button", "radiant-grid-airing-btn", airing.label || "Airing");
        btn.type = "button";
        btn.setAttribute("data-airing-key", airing.key);
        btn.addEventListener("click", () => {
          selectedKey = airing.key;
          updateButtons();
          renderTracks();
        });
        airingButtons.appendChild(btn);
      });

      updateButtons();
      renderTracks();

      airingsWrap.appendChild(airingButtons);
      tracksWrap.appendChild(tracksList);
      tracksWrap.appendChild(tracksEmpty);
    } else {
      airingsWrap.appendChild(el("p", "radiant-grid-muted", "No recent airings found."));

      if (state.tracks && state.tracks.length) {
        const ul = el("ul", "radiant-grid-modal-list");
        state.tracks.forEach((track) => {
          const li = el("li");
          li.textContent = `${track.artist || "Unknown Artist"} - ${track.title || "Unknown Track"}`;
          ul.appendChild(li);
        });
        tracksWrap.appendChild(ul);
      } else {
        tracksWrap.appendChild(el("p", "radiant-grid-muted", "No recent tracks found for this show."));
      }
    }

    modal.appendChild(close);
    modal.appendChild(title);
    modal.appendChild(time);
    modal.appendChild(djWrap);
    modal.appendChild(airingsWrap);
    modal.appendChild(tracksWrap);
    overlay.appendChild(modal);
    return overlay;
  }

  async function loadShowDetails(slot, timezone) {
    const show = slotShow(slot);
    if (!show || !show.slug) {
      return {
        title: show && show.title ? show.title : "Show",
        time: formatRange(slot),
        djs: [],
        tracks: [],
      };
    }

    if (showDetailsCache.has(show.slug)) {
      return {
        ...showDetailsCache.get(show.slug),
        time: formatRange(slot),
      };
    }

    const [insights, nowPlaying] = await Promise.all([
      fetchJson(`/v1/shows/${encodeURIComponent(show.slug)}/insights`, {
        tz: timezone,
        include_current: 1,
      }),
      fetchJson("/v1/now-playing", { tz: timezone }),
    ]);

    const djs = Array.isArray(insights.djs)
      ? insights.djs
          .map((row) => (row && row.dj && row.dj.name ? row.dj.name : ""))
          .filter(Boolean)
      : [];

    const recentBroadcasts = Array.isArray(insights.recent_broadcasts) ? insights.recent_broadcasts : [];
    const playlistByBroadcast = Array.isArray(insights.playlist_by_broadcast) ? insights.playlist_by_broadcast : [];

    const tracksByAiring = {};
    playlistByBroadcast.forEach((bucket) => {
      if (!bucket || !bucket.broadcast_key) return;
      tracksByAiring[bucket.broadcast_key] = Array.isArray(bucket.tracks)
        ? bucket.tracks.map((track) => ({
            artist: track && track.artist ? track.artist : "",
            title: track && track.title ? track.title : "",
          }))
        : [];
    });

    const airings = recentBroadcasts.map((airing) => ({
      key: airing.key,
      label: formatAiringLabel(airing),
      playlistCount: Number(airing.playlist_count || 0),
      inProgress: Boolean(airing.in_progress),
    }));

    let currentTrack = null;
    if (
      nowPlaying &&
      nowPlaying.show &&
      nowPlaying.show.slug === show.slug &&
      nowPlaying.track &&
      (nowPlaying.track.artist || nowPlaying.track.title)
    ) {
      currentTrack = {
        artist: nowPlaying.track.artist || "",
        title: nowPlaying.track.title || "",
      };
    }

    const fallbackTracks = Array.isArray(insights.playlist_recent)
      ? insights.playlist_recent.slice(0, 25).map((track) => ({
          artist: track && track.artist ? track.artist : "",
          title: track && track.title ? track.title : "",
        }))
      : [];

    const details = {
      title: (insights.show && insights.show.title) || show.title || "Show",
      djs,
      airings,
      tracksByAiring,
      tracks: fallbackTracks,
      currentTrack,
    };

    showDetailsCache.set(show.slug, details);
    return {
      ...details,
      time: formatRange(slot),
    };
  }

  function renderRoot(root, state) {
    clearNode(root);

    if (state.error) {
      root.appendChild(el("div", "radiant-grid-error", state.error));
      return;
    }

    if (!state.schedule || !Array.isArray(state.schedule.days)) {
      root.appendChild(el("div", "radiant-grid-error", "Schedule unavailable."));
      return;
    }

    const controls = el("div", "radiant-grid-controls");
    if (state.showToggle) {
      const weekBtn = el("button", state.view === "week" ? "active" : "", "Week");
      weekBtn.type = "button";
      weekBtn.addEventListener("click", () => {
        state.view = "week";
        renderRoot(root, state);
      });
      const dayBtn = el("button", state.view === "day" ? "active" : "", "Day");
      dayBtn.type = "button";
      dayBtn.addEventListener("click", () => {
        state.view = "day";
        renderRoot(root, state);
      });
      controls.appendChild(weekBtn);
      controls.appendChild(dayBtn);
    }

    const dayTabs = el("div", "radiant-grid-day-tabs");
    DAYS.forEach((day) => {
      const btn = el("button", state.selectedDay === day.num ? "active" : "", day.label);
      btn.type = "button";
      btn.addEventListener("click", () => {
        state.selectedDay = day.num;
        state.view = "day";
        renderRoot(root, state);
      });
      dayTabs.appendChild(btn);
    });

    const shell = el("div", state.view === "day" ? "radiant-grid-shell day-mode" : "radiant-grid-shell");
    const daysByNum = new Map((state.schedule.days || []).map((day) => [Number(day.weekday), day]));
    const visibleDays = state.view === "day" ? DAYS.filter((day) => day.num === state.selectedDay) : DAYS;

    visibleDays.forEach((dayDef) => {
      const day = daysByNum.get(dayDef.num) || { weekday: dayDef.num, weekday_name: dayDef.label, slots: [] };
      const slots = Array.isArray(day.slots) ? day.slots : [];
      shell.appendChild(
        makeDayColumn(
          dayDef,
          slots,
          state,
          async (slot) => {
            try {
              const details = await loadShowDetails(slot, state.timezone);
              document.body.classList.add("radiant-grid-modal-open");
              document.body.appendChild(makeModal(details));
            } catch (error) {
              document.body.classList.add("radiant-grid-modal-open");
              document.body.appendChild(
                makeModal({
                  title: slotShow(slot)?.title || "Show",
                  time: formatRange(slot),
                  djs: [],
                  tracks: [],
                })
              );
            }
          }
        )
      );
    });

    root.appendChild(controls);
    root.appendChild(dayTabs);
    root.appendChild(shell);
  }

  async function bootstrap(root) {
    const state = {
      view: root.dataset.defaultView === "day" ? "day" : "week",
      timezone: root.dataset.timezone || defaultTimezone,
      showToggle: root.dataset.showToggle !== "0",
      showLive: root.dataset.showLive !== "0",
      selectedDay: getTodayWeekdayNum(root.dataset.timezone || defaultTimezone),
      schedule: null,
      liveSlot: null,
      error: "",
    };

    try {
      const [schedule, nowPlaying] = await Promise.all([
        fetchJson("/v1/schedule", { tz: state.timezone }),
        state.showLive ? fetchJson("/v1/now-playing", { tz: state.timezone }) : Promise.resolve(null),
      ]);
      state.schedule = schedule;
      if (nowPlaying && nowPlaying.context && nowPlaying.context.slot) {
        state.liveSlot = nowPlaying.context.slot;
      }
    } catch (error) {
      state.error = error && error.message ? error.message : "Failed to load schedule.";
    }

    renderRoot(root, state);
  }

  function init() {
    const roots = document.querySelectorAll(".radiant-grid-root");
    roots.forEach((root) => {
      bootstrap(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
