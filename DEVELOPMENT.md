# Local Development Guide

## Quick Start

### 1. Start Infrastructure

```bash
# Start postgres and directus only
docker compose up postgres directus -d

# Wait for postgres to be ready
sleep 5
```

### 2. Run API Locally (for development)

```bash
cd services/radiant-api
npm install
npm run dev
```

API will be available at: http://localhost:3000

### 3. Run Admin Frontend Locally (for development)

```bash
cd services/radiant-admin
npm install
npm run dev
```

Admin will be available at: http://localhost:5173

Directus will be at: http://localhost:1337

## Environment Variables

Local development uses `.env` file. Key variables:

- `DATABASE_URL` - Points to local postgres container
- `JWT_SECRET` - Set to a dev-only value
- `MAILGUN_API_KEY` - Use sandbox or real key for email testing
- `DIRECTUS_URL` - http://localhost:1337 for local dev

## Database Migrations

Run migrations on local postgres:

```bash
# Connect to local postgres
docker exec -i radiant-postgres psql -U radiant -d radiant < migrations/001_add_admin_auth.sql
```

## Testing Email

For local email testing without real Mailgun:
- The email service will log to console instead of sending
- Check API logs to see "EMAIL MOCK" messages

To test with real Mailgun:
- Ensure MAILGUN_API_KEY is set in .env
- Use a verified domain or Mailgun sandbox

## Production Deployment

```bash
# Push to GitHub triggers automatic deployment via GitHub Actions
git push origin main
```

The GitHub Actions workflow will:
1. Build containers
2. Deploy to VPS
3. Run health checks

## Port Mapping

Local development:
- API: localhost:3000
- Admin: localhost:5173
- Directus: localhost:1337
- Postgres: localhost:5432

Production (VPS):
- API: 127.0.0.1:13000 (behind nginx)
- Admin: 127.0.0.1:15173 (behind nginx)
- Directus: 127.0.0.1:11337 (behind nginx)
