-- Admin Auth System Migration
-- Run this to set up authentication tables
-- Tables use app_ prefix to avoid conflicts with existing Directus tables

-- Enable pgcrypto for secure random generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- App admin users table (separate from directus_users for security isolation)
CREATE TABLE IF NOT EXISTS app_admin_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'dj')),
    dj_id INTEGER REFERENCES djs(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    email_verified BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP
);

-- App sessions table
CREATE TABLE IF NOT EXISTS app_admin_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES app_admin_users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    refresh_token VARCHAR(255) UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    refresh_expires_at TIMESTAMP,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- App invitations table
CREATE TABLE IF NOT EXISTS app_admin_invitations (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token VARCHAR(255) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('super_admin', 'admin', 'dj')),
    dj_id INTEGER REFERENCES djs(id) ON DELETE SET NULL,
    invited_by INTEGER REFERENCES app_admin_users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- App password reset tokens
CREATE TABLE IF NOT EXISTS app_password_resets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES app_admin_users(id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_app_admin_users_email ON app_admin_users(email);
CREATE INDEX IF NOT EXISTS idx_app_admin_users_role ON app_admin_users(role);
CREATE INDEX IF NOT EXISTS idx_app_admin_sessions_token ON app_admin_sessions(token);
CREATE INDEX IF NOT EXISTS idx_app_admin_sessions_refresh_token ON app_admin_sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_app_admin_sessions_user_id ON app_admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_admin_invitations_token ON app_admin_invitations(token);
CREATE INDEX IF NOT EXISTS idx_app_admin_invitations_email ON app_admin_invitations(email);
CREATE INDEX IF NOT EXISTS idx_app_password_resets_token ON app_password_resets(token);

-- Create initial invitation for super admin
-- This will be sent immediately after migration
INSERT INTO app_admin_invitations (email, token, role, invited_by, expires_at)
SELECT 
    'vwtyler@gmail.com',
    encode(digest(random()::text || clock_timestamp()::text, 'sha256'), 'hex'),
    'super_admin',
    NULL,
    NOW() + INTERVAL '7 days'
WHERE NOT EXISTS (
    SELECT 1 FROM app_admin_invitations WHERE email = 'vwtyler@gmail.com' AND accepted_at IS NULL
);

-- Add comment explaining the tables
COMMENT ON TABLE app_admin_users IS 'Admin panel users with role-based access control';
COMMENT ON TABLE app_admin_sessions IS 'JWT sessions with optional refresh tokens';
COMMENT ON TABLE app_admin_invitations IS 'Pending invitations for new admin users';
COMMENT ON TABLE app_password_resets IS 'Password reset tokens with expiry';
