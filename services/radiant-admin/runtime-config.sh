#!/bin/sh
set -eu
{
  printf 'window.__RADIANT_CONFIG__ = '
  jq -cn --arg api "${VITE_API_BASE_URL:-}" --arg token "${VITE_ADMIN_TOKEN:-}" '{VITE_API_BASE_URL:$api,VITE_ADMIN_TOKEN:$token}'
  printf ';\n'
} > /usr/share/nginx/html/runtime-config.js
