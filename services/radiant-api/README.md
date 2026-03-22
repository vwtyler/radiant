# Radiant API Service

Node.js HTTP service for public radio data endpoints, admin operations, reporting exports, and ACRCloud ingestion.

## Purpose

- Serve public read endpoints for schedule/now-playing/show/DJ/playlist
- Power `radiant-admin` protected endpoints for schedule/reporting operations
- Accept secured ACRCloud callbacks and write recognized tracks

## Runtime

- Source entrypoint: `services/radiant-api/src/server.js`
- Docker service: `radiant-api`
- Default port: `3000`

## Public endpoints (`/v1`)

- `GET /v1/now-playing`
- `GET /v1/schedule`
- `GET /v1/schedule/live`
- `GET /v1/shows/:slug`
- `GET /v1/djs/:slug`
- `GET /v1/playlist/recent`

Health:

- `GET /healthz`
- `GET /readyz`

Ingestion:

- `POST /v1/acrcloud/callback` (secured)

Icecast metadata integration:

- On successful ACRCloud ingest, pushes metadata to Icecast when enabled
- Song text format: `Artist - Title`
- Fallback when no track text is available: current show title

## Admin endpoints (`/v1/admin/*`)

Protected by header:

- `X-RADIANT-ADMIN-TOKEN: <RADIANT_ADMIN_TOKEN>`

Primary groups:

- shows + show insights + DJ attachments
- DJs CRUD helpers
- schedule slots CRUD
- report types + report generation
- Icecast metadata settings + test endpoint

Icecast admin endpoints:

- `GET /v1/admin/settings/icecast`
- `PATCH /v1/admin/settings/icecast`
- `POST /v1/admin/settings/icecast/test`

## Report generation status

Ready:

- `SOUND_EXCHANGE_ROU_ATH` (pipe-delimited text)
- `BMI_MUSIC_PLAYS` (CSV)

Other report types return `report_in_development`.

## Required environment variables

- `DIRECTUS_URL`
- `DIRECTUS_ADMIN_EMAIL`
- `DIRECTUS_ADMIN_PASSWORD`
- `RADIANT_ADMIN_TOKEN`

Also uses edge/ingestion controls from root `.env.example` (CORS, rate limits, ACRCloud secrets, etc.).

Optional Icecast defaults can be provided via env vars (`ICECAST_META_*`), but runtime settings are persisted to JSON at `ICECAST_META_CONFIG_PATH` (default `/app/data/icecast-meta-config.json`). In compose, `/app/data` is backed by a named volume so credentials are not committed to git.

## Local verify

```bash
docker compose up -d --build radiant-api
curl -sS http://127.0.0.1:3000/healthz
curl -sS http://127.0.0.1:3000/v1/now-playing
```
