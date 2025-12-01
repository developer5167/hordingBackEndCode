#!/usr/bin/env bash
# Fetch devices list for admin (supports search)
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id SEARCH="term" bash scripts/get-devices-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
SEARCH=${SEARCH:-}

URL="$BASE_URL/admin/devices"
[ -n "$SEARCH" ] && URL="$URL?search=$(printf '%s' "$SEARCH" | jq -s -R -r @uri)"

curl -s -X GET "$URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
