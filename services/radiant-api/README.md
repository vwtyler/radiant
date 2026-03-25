# Radiant API Service

Node.js HTTP service for public radio data endpoints, user authentication, admin operations, reporting exports, and ACRCloud ingestion.

## Authentication

The API uses JWT-based authentication with automatic token refresh.

### Features

- **Access tokens**: Valid for 7 days (configurable)
- **Refresh tokens**: Valid for 90 days with "remember me" option
- **Token storage**: PostgreSQL with automatic cleanup
- **Password hashing**: scrypt with adaptive cost factor
- **Role-based access**: super_admin, admin, dj

## Auth Endpoints

### Public (No Authentication Required)

```
POST /v1/admin/auth/login
Body: { email, password, rememberMe? }
Response: { accessToken, refreshToken, expiresAt, user }

POST /v1/admin/auth/refresh
Body: { refreshToken }
Response: { accessToken, expiresAt }

POST /v1/admin/auth/accept
Body: { token, password }
Response: { message, userId }

POST /v1/admin/auth/forgot
Body: { email }
Response: { message } (always returns success to prevent enumeration)

POST /v1/admin/auth/reset
Body: { token, password }
Response: { message }
```

### Protected (Requires Bearer Token)

```
GET /v1/admin/auth/me
Headers: Authorization: Bearer <token>
Response: { id, email, role, status, djId, createdAt, lastLoginAt }

POST /v1/admin/auth/logout
Headers: Authorization: Bearer <token>
Response: { message }

POST /v1/admin/auth/change-password
Headers: Authorization: Bearer <token>
Body: { currentPassword, newPassword }
Response: { message }

POST /v1/admin/auth/link-dj
Headers: Authorization: Bearer <token>
Body: { djId } (null to unlink)
Response: { message, djId }
```

## User Management (Admin Only)

These endpoints require admin or super_admin role.

```
GET /v1/admin/users
Headers: Authorization: Bearer <token>
Response: { items: [{ id, email, role, status, djId, createdAt, lastLoginAt }] }

POST /v1/admin/auth/invite
Headers: Authorization: Bearer <token>
Body: { email, role, djId? }
Response: { message, email, role, emailSent }

PATCH /v1/admin/users/:id
Headers: Authorization: Bearer <token>
Body: { role?, status? }
Response: { message }

DELETE /v1/admin/users/:id
Headers: Authorization: Bearer <token>
Response: { message }

POST /v1/admin/users/:id/reset-password
Headers: Authorization: Bearer <token>
Body: { password }
Response: { message }
```

### Role Restrictions

- **super_admin**: Can do everything including managing other super_admins
- **admin**: Can manage users (except create super_admins), full access to schedule/shows
- **dj**: Can view schedule, edit own shows, link DJ profile

## Public Radio Endpoints

These endpoints are read-only and don't require authentication.

```
GET /v1/now-playing
Response: Current track or show information

GET /v1/schedule
Response: Weekly schedule with slots

GET /v1/schedule/live
Response: Currently live shows

GET /v1/shows/:slug
Response: Show details

GET /v1/djs/:slug
Response: DJ details

GET /v1/playlist/recent
Response: Recent playlist items
```

## Admin Operations

Protected endpoints for station management (require valid JWT).

### Shows & DJs
```
GET /v1/admin/shows
GET /v1/admin/djs
POST /v1/admin/djs
PATCH /v1/admin/djs/:id
POST /v1/admin/shows/:id/djs
DELETE /v1/admin/shows/:id/djs/:djId
```

### Schedule
```
GET /v1/admin/schedule/slots
POST /v1/admin/schedule/slots
PATCH /v1/admin/schedule/slots/:id
DELETE /v1/admin/schedule/slots/:id
```

### Reports
```
GET /v1/admin/reports/types
POST /v1/admin/reports/generate
```

### Icecast Settings
```
GET /v1/admin/settings/icecast
PATCH /v1/admin/settings/icecast
POST /v1/admin/settings/icecast/test
```

## ACRCloud Ingestion

```
POST /v1/acrcloud/callback
Secured by: ACRCLOUD_CALLBACK_SECRET header
```

## Environment Variables

### Required

```bash
# Database
DATABASE_URL=postgres://user:pass@host:5432/db

# JWT (generate with: openssl rand -hex 32)
JWT_SECRET=your-secure-jwt-secret

# Mailgun (for email invitations)
MAILGUN_DOMAIN=mg.yourdomain.com
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_FROM=noreply@yourdomain.com

# Directus (for data storage)
DIRECTUS_URL=http://directus:8055
DIRECTUS_ADMIN_EMAIL=admin@example.com
DIRECTUS_ADMIN_PASSWORD=secure-password
```

### Optional

```bash
# Token expiration (default values shown)
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_EXPIRES_IN=90d

# CORS and rate limiting
CORS_ALLOWED_ORIGINS=https://admin.example.com,https://www.example.com
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120

# ACRCloud
ACRCLOUD_CALLBACK_SECRET=your-secret
ACRCLOUD_CALLBACK_TOKEN=your-token

# Icecast metadata push (optional)
ICECAST_META_ENABLED=false
ICECAST_META_HOST=icecast.example.com
ICECAST_META_PORT=8000
ICECAST_META_MOUNT=stream
ICECAST_META_USERNAME=source
ICECAST_META_PASSWORD=password
```

## Database Schema

### app_admin_users
```sql
- id (serial primary key)
- email (unique, not null)
- password_hash (not null)
- role (enum: super_admin, admin, dj)
- dj_id (foreign key to djs, nullable)
- status (enum: active, inactive, pending)
- email_verified (boolean)
- created_at, updated_at, last_login_at (timestamps)
```

### app_admin_sessions
```sql
- id (serial primary key)
- user_id (foreign key)
- token (jwt access token)
- refresh_token
- expires_at, refresh_expires_at
- ip_address, user_agent
- created_at
```

### app_admin_invitations
```sql
- id (serial primary key)
- email
- token (secure random)
- role, dj_id
- invited_by (foreign key)
- expires_at, accepted_at
```

## Email Templates

The API sends transactional emails for:

- **Invitations**: Welcome email with acceptance link (7-day expiry)
- **Password Reset**: Reset link email (1-hour expiry)
- **Welcome**: Post-acceptance confirmation

All templates are responsive HTML with branded styling.

## Security Features

1. **Password Requirements**:
   - Minimum 8 characters
   - At least one uppercase letter
   - At least one lowercase letter
   - At least one number

2. **Token Security**:
   - Cryptographically secure random tokens
   - Automatic expiration and cleanup
   - Refresh token rotation on use

3. **Rate Limiting**:
   - Login attempts limited
   - Email sending throttled
   - General API rate limiting configurable

4. **Audit Trail**:
   - Login timestamps tracked
   - IP address and user agent logged
   - Failed login attempts can be monitored

## Local Development

```bash
# Start database
docker compose up postgres -d

# Run migrations
docker exec -i radiant-postgres psql -U radiant -d radiant < migrations/001_add_admin_auth.sql

# Start API
docker compose up radiant-api -d

# Test health
curl http://localhost:3000/healthz

# Test login
curl -X POST http://localhost:3000/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'
```

## Health Checks

```
GET /healthz
Response: { status: "ok" }

GET /readyz
Response: { status: "ok", checks: {...} }
```

## Error Responses

Standard error format:
```json
{
  "error": "error_code",
  "message": "Human readable message"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (invalid/missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate email, etc.)
- `500` - Internal Server Error

## See Also

- [Root README](../../README.md) - Project overview
- [Admin App README](../radiant-admin/README.md) - Frontend documentation
- [DEVELOPMENT.md](../../DEVELOPMENT.md) - Local development guide
