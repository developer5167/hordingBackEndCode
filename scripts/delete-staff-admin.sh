#!/usr/bin/env bash
# Delete staff test script
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id STAFF_ID=staff-id bash scripts/delete-staff-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
STAFF_ID=${STAFF_ID:-"REPLACE_WITH_STAFF_ID"}

curl -i -X DELETE "$BASE_URL/admin/staff/$STAFF_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID"
