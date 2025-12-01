#!/usr/bin/env bash
# Activate device (TV side)
# Usage: BASE_URL=http://localhost:3000 ACTIVATION_CODE=code EMAIL=staff@example.com PASSWORD=secret bash scripts/activate-device.sh

BASE_URL=${BASE_URL:-"http://localhost:3000"}
ACTIVATION_CODE=${ACTIVATION_CODE:-"REPLACE_ACTIVATION_CODE"}
EMAIL=${EMAIL:-"staff@example.com"}
PASSWORD=${PASSWORD:-"REPLACE_PASSWORD"}

curl -s -X POST "$BASE_URL/devices/activate" \
  -H "Content-Type: application/json" \
  -d "{ \"activation_code\": \"$ACTIVATION_CODE\", \"email\": \"$EMAIL\", \"password\": \"$PASSWORD\" }" | jq
