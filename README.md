# Radiant

Radiant is a self-hosted radio operations backend and admin app for managing schedules, shows, DJs, now-playing, playlist history, and operational exports.

It runs separately from WordPress and exposes stable read APIs so station data can be rendered on a site without embedding broadcast logic in a theme or plugin.

The name is intentional but understated: Radio + Agent = Radiant.

## What Radiant does today

- Runs a standalone schedule/admin UI for day-to-day station operations
- Serves a public read API for schedule, now-playing, shows, DJs, and recent tracks
- Resolves weekly schedule slots with support for overrides
- Ingests ACRCloud callbacks for track recognition
- Generates operational/export reports from tracked play history

## Project status

- API + ingestion are live (Phases 1-5)
- Phase 6 scheduler/admin app is live and actively used
- WordPress integration remains a future phase

## Current stack

- Docker Compose (Ubuntu)
- Directus (`radiant-cms`)
- Standalone admin/scheduler web app (`radiant-admin`)
- Node.js API service (`radiant-api`)
- PostgreSQL
- Cloudflare Tunnel (current deployment path)

## Admin app (Phase 6) highlights

The standalone admin app includes:

- Schedule + Reporting tabs
- Sun-first weekly schedule
- Day/Week views with improved mobile defaults (Day mode on mobile)
- Drag/resize schedule editing with staged changes and commit workflow
- Alternating show support for same-slot alternating programs
- Slot actions menu (`...`) with Edit Slot, Show Detail, and Delete Slot
- Mobile day navigation improvements and day-state fixes
- Compressed overnight timeline block (12:00 AM-7:00 AM visually condensed)

## Reporting status

### Available now (ready)

- `SOUND_EXCHANGE_ROU_ATH`
  - Pipe-delimited text export
  - Transmission category `B`
  - Filename style: `DDMMYYYY-DDMMYYYY_B.txt`
- `BMI_MUSIC_PLAYS`
  - CSV export matching station spreadsheet column structure

### In development (disabled in UI)

- `SOUND_EXCHANGE_ROU_ATP`
- `SOUND_EXCHANGE_SOA_ATP`
- `SOUND_EXCHANGE_SOA_ATH`
- `NPR_LISTENERS`
- `NPR_SONGS`
- `BMI_MUSIC_IMPRESSIONS`

## Core data model

- `shows`
- `djs`
- `show_djs`
- `schedule_slots` (weekly recurring baseline)
- `schedule_overrides` (date-specific adjustments)
- `playlist_tracks` (recognized/ingested track history)

## Public API (`/v1`)

Base URL example: `https://api.<your-domain>`

- `GET /v1/now-playing`
- `GET /v1/schedule`
- `GET /v1/schedule/live`
- `GET /v1/shows/:slug`
- `GET /v1/djs/:slug`
- `GET /v1/playlist/recent`

Internal health:

- `GET /healthz`
- `GET /readyz`

Internal ingestion:

- `POST /v1/acrcloud/callback` (secured)

## Admin API (protected)

Used by the standalone admin app:

- `GET /v1/admin/schedule/slots`
- `POST /v1/admin/schedule/slots`
- `PATCH /v1/admin/schedule/slots/:id`
- `DELETE /v1/admin/schedule/slots/:id`
- `GET /v1/admin/shows`
- `GET /v1/admin/reports/types`
- `POST /v1/admin/reports/generate`

## Quickstart

1. Copy environment template: `cp .env.example .env`
2. Fill required values in `.env` (secrets, domain URLs, callback auth)
3. Start services: `docker compose up -d --build`
4. Populate station data in Directus:
   - Manual entry in the CMS/admin collections, or
   - Import existing data if available
   - Example legacy import: `python3 scripts/import_creek_legacy.py`
5. Verify API:
   - `curl -sS http://127.0.0.1:3000/healthz`
   - `curl -sS http://127.0.0.1:3000/v1/now-playing`
6. Open admin app:
   - `http://127.0.0.1:5173`

## Key paths

- `docker-compose.yml` - service orchestration
- `services/radiant-admin/` - standalone admin/scheduler UI
- `services/radiant-api/src/server.js` - API/resolver/ingestion/report logic
- `scripts/import_creek_legacy.py` - one-time legacy data import example
- `docs/deployment/` - active + archived deployment docs
- `docs/migrations/` - migration notes and import guidance

## Deployment docs

Detailed deployment runbooks are in `docs/deployment/`.

Active runbooks:

- `docs/deployment/phase-1-runbook.md`
- `docs/deployment/phase-2-runbook.md`
- `docs/deployment/phase-5-runbook.md`
- `docs/deployment/phase-6-runbook.md`

Archived phase docs are in `docs/deployment/archive/`.

## Security notes

- Keep real secrets in local `.env` only (do not commit)
- Treat API/admin tokens as sensitive and rotate if exposed
- Keep admin routes protected behind access controls
- Keep public API read-only and rate-limited

## Deferred roadmap (not implemented yet)

- Stats page:
  - Icecast admin listener metrics
  - Geo map of listener origin
- Additional report formatting/compliance refinement
- Admin auth feature:
  - Evaluate Zero Trust vs local auth (given `kaad-lp.org` is not on Cloudflare)
