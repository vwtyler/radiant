# Radiant Admin App

Standalone web app for station operations (schedule editing + reporting exports).

## Purpose

- Visual weekly/day scheduler for recurring slots
- Staged editing workflow before commit
- Reporting tab for generating API-backed exports
- Mobile-usable controls for day-by-day schedule management

## Runtime

- Dev/build stack: Vite + React
- Served by Docker service: `radiant-admin`
- Default URL: `http://127.0.0.1:5173`

## Required environment variables

Injected via compose:

- `VITE_API_BASE_URL` - base URL of `radiant-api`
- `VITE_ADMIN_TOKEN` - token sent as `X-RADIANT-ADMIN-TOKEN`

## Key features currently implemented

- Sun-first schedule ordering
- Week + day view with mobile day tabs
- Drag/move + resize for slots
- Add/edit/delete slot workflow
- Alternating same-window slot support
- Slot action menu (`...`) for edit/show detail/delete
- Reporting tab with report type loading fallback
- In-development report types disabled in UI

## Reporting behavior

Ready report types currently exposed by API:

- `SOUND_EXCHANGE_ROU_ATH`
- `BMI_MUSIC_PLAYS`

Other report types are marked `in_development` and disabled from generation.

## Local dev

From repository root:

```bash
docker compose up -d --build radiant-api radiant-admin
```

Then open:

- `http://127.0.0.1:5173`
