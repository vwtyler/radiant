# Phase 1 Runbook - Core Infrastructure Bring-Up

This runbook is for local Ubuntu deployment with Docker Compose.

## 1) Create local `.env`

```bash
cp .env.example .env
```

Then edit `.env` and set real values for:

- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `DIRECTUS_KEY`
- `DIRECTUS_SECRET`
- `DIRECTUS_ADMIN_EMAIL`
- `DIRECTUS_ADMIN_PASSWORD`

Generate secure values with:

```bash
openssl rand -base64 48
```

Use generated values for `DIRECTUS_KEY`, `DIRECTUS_SECRET`, and `DIRECTUS_ADMIN_PASSWORD`.

## 2) Start stack

```bash
docker compose up -d --build
```

## 3) Verify health

```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS http://127.0.0.1:3000/readyz
```

Directus admin should be locally reachable at `http://127.0.0.1:1337`.

## 3b) LAN access and firewall

This deployment exposes `radiant-api` (`3000`) and `directus` (`1337`) on all interfaces.
Postgres stays loopback-only on `127.0.0.1:5432`.

Allow LAN-only inbound access (current subnet: `10.0.0.0/24`):

```bash
sudo ufw allow from 10.0.0.0/24 to any port 3000 proto tcp
sudo ufw allow from 10.0.0.0/24 to any port 1337 proto tcp
sudo ufw status verbose
```

From another LAN machine, access:

- `http://10.0.0.3:3000/healthz`
- `http://10.0.0.3:1337`

## 4) Persistence check

```bash
docker compose restart postgres
docker compose exec postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## 5) Stop/start operations

```bash
docker compose down
docker compose up -d
```

Do not use `-v` with `down` unless you intentionally want to remove data volumes.

## 6) Logs and troubleshooting

```bash
docker compose logs -f --tail=100 postgres
docker compose logs -f --tail=100 directus
docker compose logs -f --tail=100 radiant-api
```

## Exit criteria

- All services are up and healthy.
- `radiant-api` health endpoints respond successfully.
- Directus starts against Postgres without schema/auth errors.
- Postgres data persists across restart.
