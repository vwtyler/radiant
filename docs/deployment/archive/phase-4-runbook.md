# Phase 4 Runbook - Public Read API v1

Phase 4 wires `Radiant API` to Directus data and delivers production-shaped read endpoints for WordPress.

## Endpoints implemented

- `GET /v1/now-playing`
- `GET /v1/schedule`
- `GET /v1/schedule/live`
- `GET /v1/shows/:slug`
- `GET /v1/djs/:slug`
- `GET /v1/playlist/recent`

## Data sources

- Directus collections:
  - `shows`
  - `djs`
  - `show_djs`
  - `schedule_slots`
  - `schedule_overrides`
  - `playlist_tracks`

## Runtime requirements

`radiant-api` requires Directus admin credentials for read access in this demo setup:

- `DIRECTUS_URL`
- `DIRECTUS_ADMIN_EMAIL`
- `DIRECTUS_ADMIN_PASSWORD`

## API behavior notes

- `now-playing` prefers a recent confident track if available.
- Without a fresh track, `now-playing` falls back to resolved schedule show.
- `schedule/live` resolves overrides before baseline slots.
- `schedule` returns weekly baseline slots and date-scoped overrides.

## Smoke test commands

```bash
curl -sS http://127.0.0.1:3000/v1/now-playing
curl -sS "http://127.0.0.1:3000/v1/schedule?tz=America/Los_Angeles"
curl -sS "http://127.0.0.1:3000/v1/schedule/live?tz=America/Los_Angeles"
curl -sS http://127.0.0.1:3000/v1/shows/democracy-now
curl -sS http://127.0.0.1:3000/v1/djs/jim-thompson
curl -sS "http://127.0.0.1:3000/v1/playlist/recent?limit=10"
```

## Limitations (current phase)

- No ACRCloud ingestion yet (planned for Phase 5).
- Track history may be empty until ingestion starts.
