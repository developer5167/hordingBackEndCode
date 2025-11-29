#!/usr/bin/env bash
# Upload test for admin company ad upload endpoint
# Usage: BASE_URL=http://localhost:3000 ADMIN_TOKEN=token CLIENT_ID=client_id FILE=./my.jpg MEDIA=image bash scripts/upload-company-ad-admin.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ADMIN_TOKEN=${ADMIN_TOKEN:-"REPLACE_WITH_TOKEN"}
CLIENT_ID=${CLIENT_ID:-"REPLACE_WITH_CLIENT_ID"}
FILE=${FILE:-"./test.jpg"}
MEDIA=${MEDIA:-"image"}

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE"
  exit 1
fi

curl -i -X POST "$BASE_URL/admin/company-ads/upload" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "clientAuthorisationKey: $CLIENT_ID" \
  -F "file=@$FILE" \
  -F "media_type=$MEDIA"
