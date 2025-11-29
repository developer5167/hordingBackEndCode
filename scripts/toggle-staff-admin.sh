#!/usr/bin/env bash
# Enable/Disable staff test script
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id STAFF_ID=staff-id ACTION=enable|disable bash scripts/toggle-staff-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
STAFF_ID=${STAFF_ID:-"REPLACE_WITH_STAFF_ID"}
ACTION=${ACTION:-"enable"}

if [[ "$ACTION" != "enable" && "$ACTION" != "disable" ]]; then
  echo "ACTION must be 'enable' or 'disable'"
  exit 1
fi

curl -s -X PATCH "$BASE_URL/admin/staff/$STAFF_ID/$ACTION" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" | jq
