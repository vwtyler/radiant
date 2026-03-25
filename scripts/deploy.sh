#!/bin/bash

# Deployment script for GitHub Actions
# Run on VPS via SSH from GitHub Actions

set -e

echo "🚀 Starting deployment..."

# Pre-deploy cleanup - kill orphaned processes
echo "🧹 Cleaning up orphaned processes..."
sudo pkill -f "node server.js" 2>/dev/null || true
sudo pkill -f "vite" 2>/dev/null || true
sleep 2

# Verify ports are free
echo "🔍 Checking port availability..."
for port in 3000 5173 13000 15173; do
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo "⚠️  Port $port is still in use, attempting to free it..."
        sudo kill -9 $(lsof -Pi :$port -sTCP:LISTEN -t) 2>/dev/null || true
        sleep 1
    fi
done

# Deploy
echo "📦 Pulling latest code..."
cd ~/radiant
git pull origin main

echo "🛑 Stopping existing containers..."
docker compose down --remove-orphans

echo "🏗️  Building and starting containers..."
docker compose up -d --build

# Wait for startup
echo "⏳ Waiting 20 seconds for containers to start..."
sleep 20

# Health checks
echo "🏥 Running health checks..."

API_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13000/healthz || echo "000")
ADMIN_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:15173/ || echo "000")

echo "   API Health: $API_HEALTH"
echo "   Admin Health: $ADMIN_HEALTH"

if [ "$API_HEALTH" != "200" ] || [ "$ADMIN_HEALTH" != "200" ]; then
    echo ""
    echo "❌ Health checks failed!"
    echo ""
    echo "📋 Recent container logs:"
    echo "=============================="
    docker compose logs --tail 50
    echo "=============================="
    echo ""
    echo "🔧 Current container status:"
    docker compose ps
    exit 1
fi

echo ""
echo "✅ Deployment successful!"
echo ""
docker compose ps
