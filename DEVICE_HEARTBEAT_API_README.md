# Device Heartbeat API

This API allows you to check if a device is online or offline by querying its last heartbeat timestamp. Devices should update their heartbeat every 10 seconds.

## Endpoint

### GET /devices/:id/heartbeat
Checks the heartbeat status for a device.

**Request:**
- Path param: `id` (device UUID)
- Auth: Requires client token and checkValidClient/auth middleware

**Response (200):**
```
{
  success: true,
  device_id: "...",
  name: "...",
  online: true, // true if heartbeat within last 20s
  last_heartbeat: "2026-01-13T12:34:56.789Z",
  seconds_since_heartbeat: 4
}
```
- `online` is true if the last heartbeat was within 20 seconds.
- `seconds_since_heartbeat` is the number of seconds since the last heartbeat.

**Response (404):**
```
{ success: false, message: "Device not found" }
```

## How to Use in React Frontend

### Example: Poll Heartbeat Every 10 Seconds
```javascript
import { useEffect, useState } from "react";

function useDeviceHeartbeat(deviceId, token) {
  const [status, setStatus] = useState({ online: false, seconds: null });

  useEffect(() => {
    let interval = setInterval(() => {
      fetch(`/admin/devices/${deviceId}/heartbeat`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          setStatus({ online: data.online, seconds: data.seconds_since_heartbeat });
        });
    }, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, [deviceId, token]);

  return status;
}

// Usage in a component
function DeviceStatusIndicator({ deviceId, token }) {
  const { online } = useDeviceHeartbeat(deviceId, token);
  return (
    <div>
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          display: "inline-block",
          background: online ? "#0f0" : "#888",
          animation: online ? "blink 1s infinite" : "none"
        }}
      />
      <span>{online ? "Online" : "Offline"}</span>
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
```

## Notes
- Devices should update their `last_heartbeat` field in the database every 10 seconds.
- The API only reads the timestamp; you must ensure the device sends heartbeats.
- You can adjust the polling interval or online threshold as needed.

---
File: adminApis.js (see `/devices/:id/heartbeat` route)
