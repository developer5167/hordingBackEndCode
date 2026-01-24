# Admin Ad Statistics - React.js Integration Guide

## Overview
This guide covers the implementation of ad statistics viewing in your React.js admin dashboard. The API allows you to fetch, filter, and display ad playback statistics with pagination and summary metrics.

---

## 📊 API Endpoint

### Get Ad Statistics

**Endpoint:** `GET /admin/ad-statistics`

**Authentication:** Required (Admin JWT token)

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `device_id` | UUID | No | Filter by specific device |
| `ad_id` | UUID | No | Filter by specific ad |
| `start_date` | ISO DateTime | No | Filter from date (e.g., "2026-01-01T00:00:00Z") |
| `end_date` | ISO DateTime | No | Filter to date (e.g., "2026-01-31T23:59:59Z") |
| `page` | Number | No | Page number (default: 1) |
| `limit` | Number | No | Items per page (default: 20) |

**Request Headers:**
```
Authorization: Bearer <admin_jwt_token>
Content-Type: application/json
```

**Example Request:**
```
GET /admin/ad-statistics?device_id=abc-123&page=1&limit=20
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Ad statistics fetched successfully",
  "data": [
    {
      "id": 1,
      "ad_id": "ad-uuid-123",
      "device_id": "device-uuid-456",
      "location": "Mall-A, Screen-1",
      "play_time": "2026-01-24T10:30:45.123Z",
      "ad_title": "Summer Sale 2026",
      "ad_media_type": "video",
      "ad_media_url": "https://cdn.example.com/ad1.mp4",
      "device_name": "Screen 1",
      "device_location": "Mall-A, Ground Floor"
    }
  ],
  "summary": {
    "total_plays": 1543,
    "unique_devices": 12,
    "unique_ads": 8,
    "active_days": 15
  },
  "pagination": {
    "total": 1543,
    "page": 1,
    "limit": 20,
    "totalPages": 78
  }
}
```

**Error Responses:**
- `400` - No active subscription
- `401` - Invalid or missing authentication token
- `500` - Server error
---
## 🐛 Troubleshooting

### Issue: No data showing
- Check if device_id filter is correct UUID format
- Verify authentication token is valid
- Check network tab for API errors

### Issue: Pagination not working
- Ensure page number is being passed correctly
- Check if totalPages calculation is correct

### Issue: Export fails
- Verify statistics array has data
- Check browser console for errors

---

## 📞 Support

For issues or questions:
- Check API response in browser DevTools
- Verify authentication token
- Review server logs for errors
- Contact backend team with device_id and timestamps
