#!/usr/bin/env bash
# Delete company ad file test
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id COMPANY_AD_ID=id bash scripts/delete-company-ad-file-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
COMPANY_AD_ID=${COMPANY_AD_ID:-"REPLACE_WITH_COMPANY_AD_ID"}

curl -i -X DELETE "$BASE_URL/admin/company-ads/$COMPANY_AD_ID/file" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID"
