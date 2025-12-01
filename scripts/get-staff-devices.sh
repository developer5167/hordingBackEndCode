#!/usr/bin/env bash
# Fetch devices assigned to staff
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id STAFF_ID=staff-id PAGE=1 LIMIT=20 bash scripts/get-staff-devices.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
STAFF_ID=${STAFF_ID:-"REPLACE_WITH_STAFF_ID"}
PAGE=${PAGE:-1}
LIMIT=${LIMIT:-20}

URL="$BASE_URL/admin/staff/$STAFF_ID/devices?page=$PAGE&limit=$LIMIT"

curl -s -X GET "$URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
