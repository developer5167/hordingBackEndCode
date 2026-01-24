# Ad Statistics API

## Overview
Records ad playback statistics from TV devices including duration played and location data.

## Endpoint
```
POST /ad-statistics
```

## Authentication
Requires device authentication token in the request header:
```
Authorization: Bearer <device_token>
```

## Request Body
```json
{
  "ad_id": "123",           // Required: ID of the ad being played
  "device_id": "456",       // Required: ID of the device playing the ad
  "duration_played": 30,    // Optional: Duration in seconds (defaults to 0)
  "location": "Mall-A"      // Optional: Physical location of the device
}
```

### Required Fields
- `ad_id` (string/number)
- `device_id` (string/number)

### Optional Fields
- `duration_played` (number) - Defaults to 0 if not provided
- `location` (string) - Defaults to null if not provided

## Response

### Success (200 OK)
```json
{
  "message": "Ad statistics recorded",
  "id": 789,
  "play_time": "2026-01-24T10:30:45.123Z"
}
```

### Error Responses

**400 Bad Request** - Missing required fields:
```json
{
  "error": "ad_id and device_id are required"
}
```

**401 Unauthorized** - Invalid or missing authentication token

**500 Internal Server Error**:
```json
{
  "error": "Failed to record ad statistics"
}
```

## Client Implementation Example

### JavaScript/React Native
```javascript
async function recordAdStatistics(adId, deviceId, durationPlayed, location) {
  try {
    const response = await fetch('https://your-api.com/ad-statistics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deviceToken}`
      },
      body: JSON.stringify({
        ad_id: adId,
        device_id: deviceId,
        duration_played: durationPlayed,
        location: location
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('Statistics recorded:', data);
      return data;
    } else {
      console.error('Error:', data.error);
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Failed to record ad statistics:', error);
    throw error;
  }
}

// Usage example
recordAdStatistics(123, 456, 30, 'Mall-A')
  .then(result => console.log('Success:', result))
  .catch(error => console.error('Failed:', error));
```

### cURL Example
```bash
curl -X POST https://your-api.com/ad-statistics \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  -d '{
    "ad_id": "123",
    "device_id": "456",
    "duration_played": 30,
    "location": "Mall-A"
  }'
```

## Notes
- Call this endpoint after each ad playback completes
- The `play_time` in the response represents the timestamp when the statistic was recorded
- For continuous monitoring, consider implementing retry logic for failed requests
- Store failed statistics locally and retry when connection is restored
