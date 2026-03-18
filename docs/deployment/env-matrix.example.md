# Environment Matrix (Example)

Use this matrix to keep `dev`, `demo`, and `prod-like` aligned.

| Variable | dev | demo | prod-like |
|---|---|---|---|
| `NODE_ENV` | `development` | `production` | `production` |
| `APP_NAME` | `radiant` | `radiant` | `radiant` |
| `TZ` | `America/Los_Angeles` | `America/Los_Angeles` | `America/Los_Angeles` |
| `ADMIN_PUBLIC_URL` | `http://localhost:1337` | `https://kaad-admin.tjackson.me` | `https://kaad-admin.tjackson.me` |
| `API_PUBLIC_URL` | `http://localhost:3000` | `https://kaad-api.tjackson.me` | `https://kaad-api.tjackson.me` |
| `WP_ORIGIN` | `http://localhost:8080` | `https://www.kaad-lp.org` | `https://www.kaad-lp.org` |
| `POSTGRES_DB` | `radiant` | `radiant` | `radiant` |
| `POSTGRES_USER` | `radiant` | `radiant` | `radiant` |
| `POSTGRES_PASSWORD` | local secret | demo secret | prod secret |
| `DATABASE_URL` | local DSN | demo DSN | prod DSN |
| `DIRECTUS_KEY` | local secret | demo secret | prod secret |
| `DIRECTUS_SECRET` | local secret | demo secret | prod secret |
| `DIRECTUS_ADMIN_EMAIL` | local admin email | demo admin email | prod admin email |
| `DIRECTUS_ADMIN_PASSWORD` | local admin password | demo admin password | prod admin password |
| `DIRECTUS_URL` | `http://directus:8055` | `http://directus:8055` | `http://directus:8055` |
| `CF_TUNNEL_ID` | optional | required | required |
| `CF_TUNNEL_CREDENTIALS` | optional | required | required |
| `NOW_PLAYING_CONFIDENCE_MIN` | `0.80` | `0.80` | `0.80` |
| `NOW_PLAYING_FRESH_SECONDS` | `30` | `30` | `30` |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8080` | `https://www.kaad-lp.org` | `https://www.kaad-lp.org` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | `60000` | `60000` |
| `RATE_LIMIT_MAX` | `120` | `120` | `120` |
| `RADIANT_ADMIN_TOKEN` | local secret | demo secret | prod secret |
| `RADIANT_ADMIN_API_BASE_URL` | `http://localhost:3000` | `https://kaad-api.tjackson.me` | `https://kaad-api.tjackson.me` |
| `ACRCLOUD_CALLBACK_SECRET` | local secret | demo secret | prod secret |
| `ACRCLOUD_CALLBACK_TOKEN` | local token | demo token | prod token |
| `ACRCLOUD_DEDUPE_SECONDS` | `120` | `120` | `120` |
| `ACRCLOUD_EXPECTED_PROJECT_ID` | `<stream_id>` | `<stream_id>` | `<stream_id>` |

Notes:
- Store actual secret values in a password manager or secret backend, not git.
- Keep key names identical across environments; only values change.
