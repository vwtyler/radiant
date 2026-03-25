# Radiant

Radiant is a self-hosted **radi**o operations **a**ge**nt** platform for schedule management, now playing, playlist history, reporting exports, and WordPress-friendly display components.

## What's New

### Authentication & User Management
- **JWT-based authentication** - Secure login with automatic token refresh
- **Role-based access control** - Super Admin, Admin, and DJ roles
- **Email invitations** - Invite users via Mailgun with secure acceptance links
- **User management** - Admins can invite, edit, delete users and reset passwords
- **User profiles** - Link DJ accounts, change passwords
- **Password security** - 8+ chars, uppercase, lowercase, number requirements

## Components

- `services/radiant-api/` - API service with authentication, user management, and radio operations
- `services/radiant-admin/` - Web app for schedule editing, reporting, and user management
- `wordpress-plugins/radiant-wp-shortcodes/` - WordPress shortcode plugin for public displays

## Quickstart

1. **Setup environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings (see Environment Variables below)
   ```

2. **Start infrastructure:**
   ```bash
   docker compose up postgres directus -d
   sleep 5
   ```

3. **Run database migrations:**
   ```bash
   docker exec -i radiant-postgres psql -U radiant -d radiant < migrations/001_add_admin_auth.sql
   ```

4. **Start services:**
   ```bash
   docker compose up -d radiant-api radiant-admin
   ```

5. **Create initial admin user:**
   - The migration creates an invitation for `vwtyler@gmail.com`
   - Visit `/accept-invite?token=<token>` to set password
   - Or use the API directly to create a user

6. **Access the app:**
   - Admin: http://localhost:5173
   - API: http://localhost:3000
   - Directus: http://localhost:1337

## Environment Variables

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing (generate: `openssl rand -hex 32`)
- `MAILGUN_DOMAIN` - Your Mailgun domain (e.g., `mg.example.com`)
- `MAILGUN_API_KEY` - Mailgun API key
- `MAILGUN_FROM` - Sender email address

### Optional
- `JWT_EXPIRES_IN` - Access token expiry (default: `7d`)
- `REFRESH_TOKEN_EXPIRES_IN` - Refresh token expiry (default: `90d`)
- `DIRECTUS_*` - Directus configuration (see .env.example)

## Architecture

- **Authentication**: JWT tokens with automatic refresh
- **Authorization**: Role-based access (super_admin > admin > dj)
- **Email**: Mailgun API for transactional emails
- **Security**: scrypt password hashing, secure token generation
- **Database**: PostgreSQL with connection pooling

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed local development instructions.

```bash
# Quick dev mode
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Deployment

Push to GitHub triggers automatic deployment via GitHub Actions:

```bash
git push origin main
```

The workflow will:
1. Build and test containers
2. Deploy to VPS via SSH
3. Run health checks

See `docs/deployment/` for detailed runbooks.

## Project Structure

```
radiant/
├── services/
│   ├── radiant-api/          # Node.js API server
│   │   └── src/
│   │       ├── auth/         # Authentication (JWT, password, email)
│   │       └── server.js     # Main server with auth routes
│   └── radiant-admin/        # React admin interface
│       └── src/
│           ├── auth/         # Auth components and context
│           └── pages/        # User management, profile
├── migrations/               # Database migrations
├── docs/deployment/          # Deployment runbooks
└── docker-compose.yml        # Service orchestration
```

## Security Notes

- **Never commit secrets** - Keep all credentials in `.env` only
- **JWT_SECRET** - Must be cryptographically secure (32+ hex chars)
- **Mailgun** - Use API keys with restricted sending permissions
- **Passwords** - Minimum 8 chars, uppercase, lowercase, number required
- **Sessions** - Automatic cleanup of expired tokens via PostgreSQL

## Key Files

- `services/radiant-api/README.md` - API documentation
- `services/radiant-admin/README.md` - Admin app documentation
- `DEVELOPMENT.md` - Local development guide
- `docker-compose.yml` - Production compose configuration
- `docker-compose.dev.yml` - Development overrides

## License

[LICENSE](../LICENSE)
