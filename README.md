# Radiant

Most station websites are good at pages and posts, but weak at live radio operations. Schedules drift, alternating shows get messy, and "now playing" data ends up scattered across services.

Radiant exists to make that operational layer first-class: a self-hosted backend for schedules, shows, DJs, now playing, and playlist history.

It runs separately from WordPress and exposes stable read APIs so your site can render radio data without embedding broadcast logic into a theme or plugin.

## What this project delivers

- A station-friendly admin surface in Directus (`Radiant Admin`)
- A public, frontend-focused read API (`Radiant API`)
- Schedule resolution with override support
- ACRCloud callback ingestion for song recognition

## Project status

API + ingestion are live (Phases 1-5). WordPress integration (Phase 6) is still in development.

## Current stack

- Docker Compose (Ubuntu)
- Directus (`radiant-admin`)
- Node.js API service (`radiant-api`)
- PostgreSQL
- Cloudflare Tunnel

## Core data model

- `shows`
- `djs`
- `show_djs`
- `schedule_slots` (weekly recurring baseline)
- `schedule_overrides` (alternating/special date-specific events)
- `playlist_tracks` (songs only)

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

Detailed deployment runbooks are available in `docs/deployment/`.

Active operator runbooks are:

- `docs/deployment/phase-1-runbook.md`
- `docs/deployment/phase-2-runbook.md`
- `docs/deployment/phase-5-runbook.md`

Archived phase runbooks are in `docs/deployment/archive/`.

## Quickstart

1. Copy environment template: `cp .env.example .env`
2. Fill required values in `.env` (secrets, domain URLs, callback auth)
3. Start services: `docker compose up -d --build`
4. Populate station data in Directus:
   - Manual entry in `Radiant Admin` for a fresh setup, or
   - Import existing data if you already have it.
   - Example legacy import from a JSON endpoint: `python3 scripts/import_creek_legacy.py`
5. Verify API:
   - `curl -sS http://127.0.0.1:3000/healthz`
   - `curl -sS http://127.0.0.1:3000/v1/now-playing`

## Key paths

- `docker-compose.yml` - service orchestration
- `services/radiant-api/src/server.js` - API/resolver/ingestion logic
- `scripts/import_creek_legacy.py` - example one-time import from legacy JSON endpoints
- `docs/deployment/` - active + archived deployment docs
- `docs/migrations/` - migration notes and legacy import guidance

## Security notes

- Keep real secrets in local `.env` only (do not commit).
- Treat API/bearer tokens as sensitive and rotate if exposed.
- Keep admin surface protected (e.g., Cloudflare Access).
- Keep public API read-only and rate-limited.
