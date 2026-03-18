# Stage 0 - Prep and Decisions

This stage locks decisions before deployment work begins.

## Exit criteria

- Domain and subdomains confirmed.
- Timezone confirmed and documented.
- Environment variable matrix created for `dev`, `demo`, and `prod-like`.
- Secret inventory created (values stored outside git).
- Cloudflare Tunnel runtime mode selected.
- API versioning baseline confirmed (`/v1`).
- Acceptance checklist signed off.

## Inputs to collect

- Root domain used for public hostnames.
- WordPress origin host for CORS allowlist.
- Preferred station timezone (IANA format).
- Cloudflare account/tunnel ownership details.
- Staff emails or IdP group for Cloudflare Access.

## Suggested defaults

- Admin hostname: `kaad-admin.<root-domain>`
- API hostname: `kaad-api.<root-domain>`
- API base path: `/v1`
- Tunnel mode: host-managed `cloudflared` service (recommended for simple ops)
- Cloudflare Access: protect admin only
- Public API CORS: allowlist WordPress origin and localhost dev origin

## Handoff artifacts

- `docs/deployment/decision-log.md`
- `docs/deployment/env-matrix.example.md`
- `docs/deployment/secrets-inventory.template.md`
- Root `.env.example`
