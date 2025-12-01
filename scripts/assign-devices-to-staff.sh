#!/usr/bin/env bash
# Assign devices to staff (bulk)
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id STAFF_ID=staff-id DEVICE_IDS='["id1","id2"]' bash scripts/assign-devices-to-staff.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
STAFF_ID=${STAFF_ID:-"REPLACE_WITH_STAFF_ID"}
DEVICE_IDS=${DEVICE_IDS:-"[\"REPLACE_DEVICE_ID\"]"}

curl -s -X POST "$BASE_URL/admin/staff/$STAFF_ID/devices" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" \
  -H "Content-Type: application/json" \
  -d "{ \"device_ids\": $DEVICE_IDS }" | jq
