#!/usr/bin/env bash
# Remove (unassign) device from staff
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id STAFF_ID=staff-id DEVICE_ID=device-id bash scripts/remove-device-from-staff.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
STAFF_ID=${STAFF_ID:-"REPLACE_WITH_STAFF_ID"}
DEVICE_ID=${DEVICE_ID:-"REPLACE_WITH_DEVICE_ID"}

curl -s -X DELETE "$BASE_URL/admin/staff/$STAFF_ID/devices/$DEVICE_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
