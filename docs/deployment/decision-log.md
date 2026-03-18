# Stage 0 Decision Log

## Architecture decisions

- Platform name: `Radiant`
- Admin app: `Radiant Admin` (Directus)
- Public API: `Radiant API` (Node.js/TypeScript)
- Database: PostgreSQL
- Deployment: Docker Compose on Ubuntu
- Public edge: Cloudflare Tunnel

## Network and routing

- Root domain: `tjackson.me`
- Admin hostname: `kaad-admin.tjackson.me`
- API hostname: `kaad-api.tjackson.me`
- Admin access: Cloudflare Access required
- API access: public read-only endpoints for WordPress
- Cloudflare Tunnel mode: host-managed `cloudflared` service on this machine
- Cloudflare Access policy: email-based allowlist in Cloudflare Zero Trust (same policy style as SSH tunnel), primary identity `vwtyler@gmail.com`
- Current owner/operator: `vwtyler@gmail.com`

## API contract baseline

- Versioning starts at `/v1`
- Responses are additive over time (no breaking key removals)
- Optional objects return `null` instead of key omission

## Resolver behavior baseline (`/v1/now-playing`)

- A: return fresh/confident track match when available
- B: otherwise return scheduled talk show fallback
- C: otherwise return scheduled music/mixed show fallback
- Song history remains songs-only; fallback states are never written to playlist history

## Confirmed runtime defaults

- WordPress origin for CORS: `https://www.kaad-lp.org`
- Station timezone (IANA): `America/Los_Angeles`
- Confidence threshold default: `0.80` (confirmed)
- Freshness window default: `30s` (confirmed for demo)
