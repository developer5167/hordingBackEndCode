#!/usr/bin/env bash
# Simple test script to fetch company ads list for admin
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id bash scripts/get-company-ads-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
PAGE=${PAGE:-1}
LIMIT=${LIMIT:-20}
MEDIA_TYPE=${MEDIA_TYPE:-}

[ -n "$MEDIA_TYPE" ] && URL="$URL&media_type=$MEDIA_TYPE"
URL="$BASE_URL/admin/company-ads?page=$PAGE&limit=$LIMIT"
[ -n "$MEDIA_TYPE" ] && URL="$URL&media_type=$MEDIA_TYPE"

curl -s -X GET "$URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
