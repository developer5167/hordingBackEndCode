#!/usr/bin/env bash
# Create staff test script
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id NAME='Name' EMAIL='staff@example.com' bash scripts/create-staff-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
NAME=${NAME:-"New Staff"}
EMAIL=${EMAIL:-"staff@example.com"}

curl -s -X POST "$BASE_URL/admin/staff" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" \
  -H "Content-Type: application/json" \
  -d "{ \"name\": \"$NAME\", \"email\": \"$EMAIL\" }" | jq
