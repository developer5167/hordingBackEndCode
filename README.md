# hordingBackEndCode

Simple backend for advertising / hoarding management.

## New API: Update company ad status

Endpoint: POST /admin/company-ads/:id/status

- Middleware: checkValidClient, auth
- Body: { "status": "active" } or { "status": "pause" } (we accept `pause` or `paused`)

Example curl (replace BASE_URL, ADMIN_TOKEN and COMPANY_AD_ID):

```bash
curl -X POST "$BASE_URL/admin/company-ads/COMPANY_AD_ID/status" \
	-H "Authorization: Bearer ADMIN_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{ "status": "active" }'
```

Response example:

```json
{
	"success": true,
	"message": "company_ad_status_updated",
	"company_ad": { /* updated company_ad row */ },
	"devices": [ /* device mappings that had their status updated */ ]
}
```

## New API: Admin upload company ad file

Endpoint: POST /admin/company-ads/upload

- Middleware: checkValidClient, auth
- Body (multipart/form-data):
	- file (binary) — required
	- media_type — required: "image" or "video"
	- client_id — optional (admin can specify a client id), otherwise uses header clientAuthorisationKey

The uploaded file is stored under Firebase folder: company_ads/<client_id>/

Example curl (replace BASE_URL, ADMIN_TOKEN and CLIENT_ID):

```bash
curl -X POST "$BASE_URL/admin/company-ads/upload" \
	-H "Authorization: Bearer ADMIN_TOKEN" \
	-H "clientAuthorisationKey: CLIENT_ID" \
	-F "file=@my-ad.jpg" \
	-F "media_type=image"
```

Response example:

```json
{
	"success": true,
	"message": "company_ad_uploaded",
	"company_ad": { /* inserted row: id, client_id, media_type, filename, media_url */ }
}
```

### Delete uploaded file from company_ad (DB + Firebase)

Endpoint: DELETE /admin/company-ads/:id/file

- Middleware: checkValidClient, auth
- Behavior: clears filename and media_url for the specified company_ad (use empty strings to respect NOT NULL columns) and attempts to delete the file from Firebase storage. Returns success even if the storage deletion was a best-effort (e.g., file not found).

Example curl:

```bash
curl -X DELETE "$BASE_URL/admin/company-ads/COMPANY_AD_ID/file" \
	-H "Authorization: Bearer ADMIN_TOKEN" \
	-H "clientAuthorisationKey: CLIENT_ID"
```

Response example:

```json
{
	"success": true,
	"message": "company_ad_file_removed",
	"company_ad": { /* updated row with cleared filename/media_url */ },
	"storageDeleted": true
}
```

## Get company ads (list)

Endpoint: GET /admin/company-ads

- Middleware: checkValidClient, auth

- Query params (optional): page (default 1), limit (default 20, max 200), media_type

Example curl (replace placeholders):

```bash
curl "$BASE_URL/admin/company-ads?page=1&limit=10&media_type=image" \
	-H "Authorization: Bearer ADMIN_TOKEN" \
	-H "clientAuthorisationKey: CLIENT_ID"
```

Response example:

```json
{
	"success": true,
	"message": "company_ads_fetched",
	"pagination": { "total": 12, "page": 1, "limit": 10, "totalPages": 2 },
	"data": [ /* array of company_ads rows */ ]
}
```

## Staff management (admin)

1) Create staff

Endpoint: POST /admin/staff

-- Body JSON: { "name": "Staff Name", "email": "staff@example.com" }
-- Behavior: creates the staff record scoped to the current client (requires clientAuthorisationKey header), generates an 8-character password, stores hashed password in DB, and sends the plain password to staff email.

Response: 201, created staff row (without showing plain password)

2) Delete staff

Endpoint: DELETE /admin/staff/:id

- Removes the staff record. Returns deleted staff id/name/email.

3) Enable / Disable staff

Endpoints:
- PATCH /admin/staff/:id/enable
- PATCH /admin/staff/:id/disable

- Response returns updated staff row with new status.

4) Get staff list (paginated)

Endpoint: GET /admin/staff

- Middleware: checkValidClient, auth
- Query params:
	- page (default 1)
	- limit (default 20, max 200)
	- search (searches name or email, case-insensitive)
	- status (optional: "active" or "disabled")

This endpoint returns a paginated, searchable list scoped to the authenticated client (use the clientAuthorisationKey header).

Example curl:

```bash
curl "$BASE_URL/admin/staff?page=1&limit=25&search=alice&status=active" \
	-H "Authorization: Bearer ADMIN_TOKEN" \
	-H "clientAuthorisationKey: CLIENT_ID"
```

Response example:

```json
{
	"success": true,
	"message": "staff_list_fetched",
	"pagination": { "total": 42, "page": 1, "limit": 25, "totalPages": 2 },
	"data": [ /* id, name, email, status, created_at */ ]
}
```
# hordingBackEndCode
# hordingBackEndCode
