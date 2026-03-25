#!/bin/bash

# Create Initial Admin User Script
# Usage: ./scripts/create-initial-admin.sh
# Requires: INITIAL_ADMIN_EMAIL and DATABASE_URL environment variables

set -e

# Check if required environment variables are set
if [ -z "$INITIAL_ADMIN_EMAIL" ]; then
    echo "Error: INITIAL_ADMIN_EMAIL environment variable is not set"
    echo "Please set it in your .env file or export it:"
    echo "  export INITIAL_ADMIN_EMAIL=admin@your-domain.com"
    exit 1
fi

if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL environment variable is not set"
    exit 1
fi

echo "Creating initial admin invitation for: $INITIAL_ADMIN_EMAIL"

# Create the invitation using psql
psql "$DATABASE_URL" <<EOF
INSERT INTO app_admin_invitations (email, token, role, invited_by, expires_at)
SELECT 
    '$INITIAL_ADMIN_EMAIL',
    encode(digest(random()::text || clock_timestamp()::text, 'sha256'), 'hex'),
    'super_admin',
    NULL,
    NOW() + INTERVAL '7 days'
WHERE NOT EXISTS (
    SELECT 1 FROM app_admin_users WHERE email = '$INITIAL_ADMIN_EMAIL'
)
AND NOT EXISTS (
    SELECT 1 FROM app_admin_invitations 
    WHERE email = '$INITIAL_ADMIN_EMAIL' 
    AND accepted_at IS NULL 
    AND expires_at > NOW()
);
EOF

if [ $? -eq 0 ]; then
    echo "✓ Initial admin invitation created successfully"
    echo ""
    echo "Next steps:"
    echo "1. Check your email at $INITIAL_ADMIN_EMAIL for the invitation"
    echo "2. Or query the database to get the invitation token:"
    echo "   psql \"\$DATABASE_URL\" -c \"SELECT token FROM app_admin_invitations WHERE email = '$INITIAL_ADMIN_EMAIL' ORDER BY created_at DESC LIMIT 1;\""
    echo ""
    echo "3. Visit: \${ADMIN_PUBLIC_URL}/accept-invite?token=<TOKEN>"
else
    echo "✗ Failed to create initial admin invitation"
    exit 1
fi
