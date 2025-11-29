#!/usr/bin/env bash
# Fetch staff list for admin
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id bash scripts/get-staff-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
PAGE=${PAGE:-1}
LIMIT=${LIMIT:-20}
SEARCH=${SEARCH:-}
STATUS=${STATUS:-}

URL="$BASE_URL/admin/staff?page=$PAGE&limit=$LIMIT"
[ -n "$SEARCH" ] && URL="$URL&search=$(printf '%s' "$SEARCH" | jq -s -R -r @uri)"
[ -n "$STATUS" ] && URL="$URL&status=$STATUS"

curl -s -X GET "$URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
