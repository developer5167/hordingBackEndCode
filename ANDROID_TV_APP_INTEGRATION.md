# Android TV App - API Integration Guide

## Overview
This guide covers the API integration flow for Android TV devices, including device activation, heartbeat monitoring, ad fetching, and statistics reporting.

---

## 🔄 Complete Integration Flow

```
1. Device Activation → 2. Start Heartbeat → 3. Fetch Ads → 4. Play & Report Stats → Loop (2-4)
```

### Flow Details:
1. **Device Activation** - One-time activation using activation code, staff email, and password
2. **Heartbeat Loop** - Send heartbeat every 10 seconds to maintain online status
3. **Fetch Active Ads** - Retrieve assigned ads for the device
4. **Play Ads** - Display ads and track playback
5. **Report Statistics** - Send ad playback statistics after each ad completes

---

## 📡 API Endpoints

### 1. Device Activation (One-time Setup)

**Endpoint:** `POST /devices/activate`

**Purpose:** Activate device and obtain authentication token

**Request:**
```json
{
  "activation_code": "ABC123XYZ",
  "email": "staff@example.com",
  "password": "staffPassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "device_activated",
  "device": {
    "id": "device-uuid",
    "status": "active",
    "is_assigned": true,
    "assigned_to": "staff-uuid"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "baseUrl": "https://api.example.com"
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Invalid credentials
- `403` - Device not assigned or staff not active
- `404` - Invalid activation code or staff not found

**Android Implementation Notes:**
- Call this once during initial setup
- Store the `token` securely (SharedPreferences/EncryptedSharedPreferences)
- Store `device.id` and `baseUrl` for subsequent API calls
- Token expires in 30 days

---

### Device Heartbeat (Continuous)

**Endpoint:** `POST /device/heartbeat`

**Purpose:** Keep device online status updated

**Authentication:** Required (Bearer token)

**Request Headers:**
```
Authorization: Bearer <your_device_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "device_id": "device-uuid"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "heartbeat_updated",
  "device_id": "device-uuid",
  "last_seen": "2026-01-24T10:30:45.123Z"
}
```

**Error Responses:**
- `400` - Missing device_id
- `401` - Invalid or expired token
- `404` - Device not found
- `500` - Server error

**Android Implementation Notes:**
- Send heartbeat every **10 seconds** using WorkManager or Handler
- If heartbeat fails, retry after 5 seconds
- Device shows as offline after 10 seconds without heartbeat
- Continue sending even when screen is off

---

### 3. Get Device Status

**Endpoint:** `GET /device/status?device_id={device_id}`

**Purpose:** Check current device status

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <your_device_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "status": "active"
}
```

**Status Values:**
- `active` - Device is operational
- `maintenance` - Device under maintenance
- `offline` - Device is offline
- `emergency-mode` - Device in emergency mode

**Error Responses:**
- `400` - Missing device_id
- `401` - Invalid token
- `404` - Device not found

**Android Implementation Notes:**
- Check status before fetching ads
- Handle each status appropriately in UI

---

### 4. Fetch Active Ads

**Endpoint:** `GET /ads?device_id={device_id}`

**Purpose:** Get list of active ads assigned to device

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <your_device_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "ads": [
    {
      "id": "ad-uuid-1",
      "title": "Summer Sale 2026",
      "media_url": "https://cdn.example.com/videos/ad1.mp4",
      "media_type": "video",
      "start_date": "2026-01-01T00:00:00Z",
      "end_date": "2026-02-01T23:59:59Z"
    },
    {
      "id": "ad-uuid-2",
      "title": "New Product Launch",
      "media_url": "https://cdn.example.com/images/ad2.jpg",
      "media_type": "image",
      "start_date": "2026-01-15T00:00:00Z",
      "end_date": "2026-01-31T23:59:59Z"
    }
  ]
}
```

**Media Types:**
- `video` - Video file (mp4, webm, etc.)
- `image` - Image file (jpg, png, etc.)

**Error Responses:**
- `401` - Invalid token
- `500` - Server error

**Android Implementation Notes:**
- Fetch ads periodically (every 5-10 minutes)
- Cache ads locally for offline playback
- Validate start_date and end_date before displaying
- Pre-download media files for smooth playback

---

### 5. Fetch Emergency Ads

**Endpoint:** `GET /emergency-ads/devices/{device_id}`

**Purpose:** Get emergency ads for immediate display

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <your_device_token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Emergency ads for device fetched successfully",
  "data": [
    {
      "company_ad_id": "emergency-ad-uuid",
      "title": "Emergency Alert",
      "media_type": "video",
      "media_url": "https://cdn.example.com/emergency/alert.mp4",
      "filename": "alert.mp4",
      "start_date": "2026-01-24T00:00:00Z",
      "end_date": "2026-01-25T23:59:59Z",
      "status": "active",
      "device_id": "device-uuid",
      "device_status": "active"
    }
  ]
}
```

**Error Responses:**
- `404` - Device not found or not authorized
- `500` - Server error

**Android Implementation Notes:**
- Check for emergency ads when device status is "emergency-mode"
- Priority display over regular ads
- Refresh every minute during emergency mode

---

### 6. Report Ad Statistics

**Endpoint:** `POST /ad-statistics`

**Purpose:** Record ad playback statistics

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <your_device_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "ad_id": "ad-uuid",
  "device_id": "device-uuid",
  "duration_played": 30,
  "location": "Mall-A, Screen-1"
}
```

**Request Fields:**
- `ad_id` (required) - ID of the ad played
- `device_id` (required) - ID of the device
- `duration_played` (optional) - Duration in seconds (defaults to 0)
- `location` (optional) - Physical location details

**Success Response (200):**
```json
{
  "message": "Ad statistics recorded",
  "id": 789,
  "play_time": "2026-01-24T10:30:45.123Z"
}
```

**Error Responses:**
- `400` - Missing required fields
- `401` - Invalid token
- `500` - Server error

**Android Implementation Notes:**
- Send statistics immediately after ad completes
- For videos: Track actual duration played
- For images: Track display duration
- Queue failed reports and retry when online
- Include location if device has GPS/stored location

---

## 🔧 Android Implementation Checklist

### Initial Setup
- [ ] Implement activation screen with activation code, email, password inputs
- [ ] Store authentication token securely
- [ ] Save device_id and baseUrl

### Background Services
- [ ] Create HeartbeatService to send heartbeat every 10 seconds
- [ ] Use WorkManager for reliable background execution
- [ ] Implement retry logic for failed heartbeats
- [ ] Continue service when screen is off

### Ad Management
- [ ] Fetch ads periodically (every 5-10 minutes)
- [ ] Cache ads in local database (Room)
- [ ] Pre-download media files
- [ ] Validate ad dates before display
- [ ] Implement ad playlist/rotation logic

### Statistics Tracking
- [ ] Track video playback duration
- [ ] Track image display duration
- [ ] Queue statistics when offline
- [ ] Retry failed statistics submissions
- [ ] Clear queue after successful submission

### Error Handling
- [ ] Handle 401 errors (re-authenticate)
- [ ] Handle network failures gracefully
- [ ] Show appropriate error messages
- [ ] Implement offline mode

### UI States
- [ ] Loading state during activation
- [ ] Active/Playing state
- [ ] Offline state
- [ ] Emergency mode state
- [ ] Maintenance state

---

## ⏱️ Timing Recommendations

| Task | Interval | Priority |
|------|----------|----------|
| Heartbeat | Every 10 seconds | Critical |
| Fetch Ads | Every 5-10 minutes | High |
| Check Status | Every 30 seconds | Medium |
| Report Statistics | Immediately after playback | High |
| Emergency Ads Check | Every 1 minute (if in emergency mode) | Critical |

---

## 🔐 Security Notes

1. **Token Storage**: Use EncryptedSharedPreferences for token storage
2. **HTTPS Only**: All API calls must use HTTPS
3. **Token Expiry**: Handle 401 responses and re-authenticate
4. **Sensitive Data**: Never log tokens or passwords
5. **Network Security**: Implement certificate pinning if possible

---

## 📱 Sample Android Architecture

```
MainActivity
├── ActivationFragment (One-time)
├── AdPlayerFragment (Main screen)
└── Services
    ├── HeartbeatService (Background)
    ├── AdFetchService (Periodic)
    └── StatisticsService (Queue processor)

Repository Layer
├── DeviceRepository
├── AdRepository
└── StatisticsRepository

Local Database (Room)
├── CachedAds
├── PendingStatistics
└── DeviceConfig

Network Layer
├── ApiService (Retrofit/OkHttp)
└── AuthInterceptor
```

---

## 🐛 Troubleshooting

### Device Shows Offline
- Check if heartbeat service is running
- Verify 10-second interval
- Check network connectivity
- Verify token is valid

### No Ads Displayed
- Verify device is activated
- Check if ads are assigned to device
- Validate ad date ranges
- Check network connectivity

### Statistics Not Recording
- Check if statistics are queued locally
- Verify network connectivity
- Check for 401 errors (token expiry)
- Ensure ad_id and device_id are correct

---

## 📞 Support

For API issues or integration help, contact the backend team with:
- Device ID
- Error messages
- Timestamp of issue
- API endpoint affected
