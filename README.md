# Radiant

Radiant is a self-hosted **radi**o operations **a**ge**nt** platform for schedule management, now playing, playlist history, reporting exports, and WordPress-friendly display components.

## Components

- `services/radiant-api/` - API service (public read endpoints + protected admin endpoints)
- `services/radiant-admin/` - standalone scheduler/reporting web app
- `wordpress-plugins/radiant-wp-shortcodes/` - WordPress shortcode plugin

Each component has its own detailed README:

- `services/radiant-api/README.md`
- `services/radiant-admin/README.md`
- `wordpress-plugins/radiant-wp-shortcodes/README.md`

## Current status

- Phases 1-6 are complete.
- Phase 7 (WordPress integration) is started, including shortcode plugin MVP.

## Quickstart

1. Copy environment template: `cp .env.example .env`
2. Fill required values in `.env`
3. Start services: `docker compose up -d --build`
4. Verify API health: `curl -sS http://127.0.0.1:3000/healthz`
5. Open admin app: `http://127.0.0.1:5173`

## Key paths

- `docker-compose.yml` - service orchestration
- `services/radiant-api/README.md` - API setup/endpoints/admin/report behavior
- `services/radiant-admin/README.md` - admin app behavior, UX, reporting tab notes
- `wordpress-plugins/radiant-wp-shortcodes/README.md` - plugin install and shortcode usage
- `dist/radiant-wp-shortcodes.zip` - importable plugin archive
- `docs/deployment/` - active runbooks
- `docs/deployment/archive/` - archived runbooks

## Deployment runbooks

- `docs/deployment/phase-1-runbook.md`
- `docs/deployment/phase-2-runbook.md`
- `docs/deployment/phase-5-runbook.md`
- `docs/deployment/phase-6-runbook.md`
- `docs/deployment/phase-7-runbook.md`

## Security notes

- Keep secrets in local `.env` only (never commit live secrets)
- Keep admin routes protected and rotate tokens when needed
- Keep public API read-only and rate-limited
