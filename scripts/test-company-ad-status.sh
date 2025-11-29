#!/usr/bin/env bash
# Simple script to test company ad status update endpoint
# Replace these values before running
BASE_URL=${BASE_URL:-"http://localhost:3000"}
TOKEN=${TOKEN:-"YOUR_ADMIN_BEARER_TOKEN"}
COMPANY_AD_ID=${COMPANY_AD_ID:-"your-company-ad-id"}
NEW_STATUS=${NEW_STATUS:-"active"}

curl -s -X POST "$BASE_URL/admin/company-ads/$COMPANY_AD_ID/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{ \"status\": \"$NEW_STATUS\" }" | jq
