# Phase 6 Runbook - Radiant Admin Web App

Phase 6 introduces a standalone `radiant-admin` web app for schedule operations.

This app is intentionally decoupled from Directus internals so the backend can be replaced later with minimal UI rewrites.

## Goals delivered in this phase

- Separate admin web app service (`radiant-admin`)
- Weekly Sun-Sat visual scheduler with time-grid layout
- Drag to move slots across time/day
- Resize slot duration from block handle
- Create and delete schedule slots in UI
- Adapter-style API client layer in frontend
- Admin schedule mutation endpoints in `radiant-api`

## Services and ports

- `radiant-admin` -> `http://localhost:5173` (LAN exposed per compose)
- `radiant-api` -> `http://localhost:3000`

## Admin API endpoints (internal)

- `GET /v1/admin/shows`
- `GET /v1/admin/schedule/slots`
- `POST /v1/admin/schedule/slots`
- `PATCH /v1/admin/schedule/slots/:id`
- `DELETE /v1/admin/schedule/slots/:id`

All require header:

- `X-RADIANT-ADMIN-TOKEN: <RADIANT_ADMIN_TOKEN>`

## Environment variables

- API service:
  - `RADIANT_ADMIN_TOKEN`
- Admin web app:
  - `VITE_API_BASE_URL` (via compose from `RADIANT_ADMIN_API_BASE_URL`)
  - `VITE_ADMIN_TOKEN` (via compose from `RADIANT_ADMIN_TOKEN`)

## Bring up / verify

```bash
docker compose up -d --build radiant-api radiant-admin
docker compose ps
curl -I http://127.0.0.1:5173
```

Open:

- `http://<server-lan-ip>:5173`

## Notes

- Current scheduler focuses on slots (recurring baseline). Override visual editing is a follow-up enhancement.
- Authentication is token-header based for this phase; plan to replace with session-based auth before broad production use.
