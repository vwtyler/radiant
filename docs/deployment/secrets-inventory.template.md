# Secrets Inventory Template

Do not commit real secret values to git.

| Secret | Used by | Env key | Rotation owner | Rotation cadence | Stored in |
|---|---|---|---|---|---|
| Postgres password | postgres, directus, api | `POSTGRES_PASSWORD` | vwtyler@gmail.com | 90 days (post-demo) | server `.env` (gitignored) |
| Database URL | api | `DATABASE_URL` | vwtyler@gmail.com | on DB change | server `.env` (gitignored) |
| Directus key | directus | `DIRECTUS_KEY` | vwtyler@gmail.com | 180 days (post-demo) | server `.env` (gitignored) |
| Directus secret | directus | `DIRECTUS_SECRET` | vwtyler@gmail.com | 180 days (post-demo) | server `.env` (gitignored) |
| Directus admin email | directus | `DIRECTUS_ADMIN_EMAIL` | vwtyler@gmail.com | on owner change | server `.env` (gitignored) |
| Directus admin password | directus | `DIRECTUS_ADMIN_PASSWORD` | vwtyler@gmail.com | 180 days (post-demo) | server `.env` (gitignored) |
| Cloudflare tunnel credentials | cloudflared | `CF_TUNNEL_CREDENTIALS` | vwtyler@gmail.com | on tunnel rotate | host file outside repo |
| Optional ACRCloud access key | ingestion worker | `ACRCLOUD_ACCESS_KEY` | vwtyler@gmail.com | per provider policy | server `.env` (gitignored) |
| Optional ACRCloud access secret | ingestion worker | `ACRCLOUD_ACCESS_SECRET` | vwtyler@gmail.com | per provider policy | server `.env` (gitignored) |

## Handling rules

- Never store plaintext secrets in repo, docs, or screenshots.
- Use separate values per environment.
- Record last-rotated timestamps where secrets are managed.
