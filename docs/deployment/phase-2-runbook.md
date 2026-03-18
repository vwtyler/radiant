# Phase 2 Runbook - Secure Network Exposure

Phase 2 exposes `Radiant Admin` and `Radiant API` through Cloudflare Tunnel while keeping services self-hosted.

## Scope completed

- Cloudflare Tunnel ingress routes added for:
  - `kaad-admin.tjackson.me` -> `http://localhost:1337`
  - `kaad-api.tjackson.me` -> `http://localhost:3000`
- Tunnel DNS routes created for both hostnames.
- API hardening enabled:
  - CORS allowlist (`CORS_ALLOWED_ORIGINS`)
  - Basic in-memory rate limiting (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`)

## Current tunnel config path

- `/etc/cloudflared/config.yml`
- Backup created at `/etc/cloudflared/config.yml.bak.phase2`

## Validate tunnel and endpoints

```bash
systemctl status cloudflared --no-pager
curl -I https://kaad-api.tjackson.me/healthz
curl -I https://kaad-admin.tjackson.me
```

Expected:

- `kaad-api` returns `200` from API health endpoint.
- `kaad-admin` returns redirect (`302`) to Directus admin path.

## Validate firewall posture

```bash
sudo ufw status verbose
```

Expected:

- LAN allow rules exist for TCP `1337` and `3000` from `10.0.0.0/24`.
- Default incoming policy remains deny.

## Access policy (manual step)

Cloudflare Access for `kaad-admin.tjackson.me` should be configured in Cloudflare Zero Trust.

Recommended policy:

- App domain: `kaad-admin.tjackson.me`
- Decision: `Allow`
- Include: `vwtyler@gmail.com` (same principal used for SSH tunnel access)
- Exclude: none

Keep `kaad-api.tjackson.me` public for WordPress read access.

## Rollback steps

```bash
sudo cp /etc/cloudflared/config.yml.bak.phase2 /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

Then re-check service status.
