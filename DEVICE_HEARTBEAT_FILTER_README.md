# Device Heartbeat Filter & Status API

This guide covers the updated GET /devices API with heartbeat-based filtering and real-time status indicators.

## API Changes

### GET /devices (Updated)
Fetches devices with real-time online/offline status based on last heartbeat.

**Query Parameters:**
- `search` (optional) - Search by name, location, or ID
- `status_filter` (optional) - Filter by status: `all`, `active`, `stopped` (default: `all`)

**Example Requests:**
```bash
# Get all devices
curl -H "Authorization: Bearer <TOKEN>" "https://api.example.com/admin/devices"

# Get only active devices
curl -H "Authorization: Bearer <TOKEN>" "https://api.example.com/admin/devices?status_filter=active"

# Get only offline/stopped devices
curl -H "Authorization: Bearer <TOKEN>" "https://api.example.com/admin/devices?status_filter=stopped"

# Search + filter
curl -H "Authorization: Bearer <TOKEN>" "https://api.example.com/admin/devices?search=store&status_filter=active"
```

**Response (200):**
```json
{
  "success": true,
  "message": "Devices fetched successfully",
  "total": 5,
  "status_filter": "all",
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Store-Display-1",
      "location": "Mumbai",
      "width": 1920,
      "height": 1080,
      "status": "active",
      "is_assigned": true,
      "assigned_to": "staff-id",
      "created_at": "2026-01-10T10:30:00Z",
      "last_seen": "2026-01-13T12:34:50Z",
      "online": true,
      "seconds_since_last_seen": 5
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "name": "Store-Display-2",
      "location": "Delhi",
      "width": 1920,
      "height": 1080,
      "status": "active",
      "is_assigned": true,
      "assigned_to": "staff-id",
      "created_at": "2026-01-10T10:30:00Z",
      "last_seen": "2026-01-13T12:30:00Z",
      "online": false,
      "seconds_since_last_seen": 274
    }
  ]
}
```

**Response Fields:**
- `online` (boolean) - `true` if last heartbeat within 10 seconds, `false` otherwise
- `seconds_since_last_seen` (number) - Seconds elapsed since last heartbeat
- `last_seen` (ISO timestamp) - Last heartbeat timestamp from device

---

## React Implementation

### 1. Hook for Polling Device Status

```javascript
import { useEffect, useState } from "react";

function useDevicesWithHeartbeat(token, statusFilter = "all", pollInterval = 5000) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDevices = async () => {
      setLoading(true);
      try {
        const url = `/admin/devices?status_filter=${statusFilter}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          setDevices(data.data);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDevices();
    const interval = setInterval(fetchDevices, pollInterval); // Poll every 5s
    return () => clearInterval(interval);
  }, [token, statusFilter, pollInterval]);

  return { devices, loading, error };
}
```

### 2. Device Card Component with Blinking Indicator

```javascript
import React from "react";

function DeviceCard({ device }) {
  const getStatusColor = () => {
    return device.online ? "#00ff00" : "#cccccc"; // green if online, gray if offline
  };

  const getStatusText = () => {
    return device.online ? "Online" : "Offline";
  };

  return (
    <div style={{
      border: "1px solid #ddd",
      borderRadius: "8px",
      padding: "16px",
      marginBottom: "12px",
      backgroundColor: "#f9f9f9",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3>{device.name}</h3>
          <p style={{ margin: "4px 0", fontSize: "14px", color: "#666" }}>
            Location: {device.location}
          </p>
          <p style={{ margin: "4px 0", fontSize: "14px", color: "#666" }}>
            Size: {device.width}x{device.height}
          </p>
        </div>
        
        {/* Heartbeat Indicator */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              backgroundColor: getStatusColor(),
              margin: "0 auto 8px",
              animation: device.online ? "blink 1s infinite" : "none",
              boxShadow: device.online ? `0 0 10px ${getStatusColor()}` : "none",
            }}
          />
          <span style={{ fontSize: "12px", fontWeight: "bold" }}>
            {getStatusText()}
          </span>
          {device.seconds_since_last_seen !== null && (
            <p style={{ fontSize: "11px", color: "#999", margin: "4px 0 0" }}>
              {device.seconds_since_last_seen}s ago
            </p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

export default DeviceCard;
```

### 3. Device List with Filters

```javascript
import React, { useState } from "react";
import DeviceCard from "./DeviceCard";
import { useDevicesWithHeartbeat } from "./useDevicesWithHeartbeat";

function DevicesList({ token }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const { devices, loading, error } = useDevicesWithHeartbeat(token, statusFilter);

  if (loading) return <div>Loading devices...</div>;
  if (error) return <div style={{ color: "red" }}>Error: {error}</div>;

  const activeCount = devices.filter((d) => d.online).length;
  const offlineCount = devices.filter((d) => !d.online).length;

  return (
    <div style={{ padding: "20px" }}>
      <h2>Device Status Dashboard</h2>
      
      {/* Summary Stats */}
      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        <div style={{
          flex: 1,
          padding: "12px",
          backgroundColor: "#e8f5e9",
          borderRadius: "6px",
          textAlign: "center"
        }}>
          <strong style={{ color: "#2e7d32" }}>Active: {activeCount}</strong>
        </div>
        <div style={{
          flex: 1,
          padding: "12px",
          backgroundColor: "#f5f5f5",
          borderRadius: "6px",
          textAlign: "center"
        }}>
          <strong style={{ color: "#666" }}>Offline: {offlineCount}</strong>
        </div>
        <div style={{
          flex: 1,
          padding: "12px",
          backgroundColor: "#fff3e0",
          borderRadius: "6px",
          textAlign: "center"
        }}>
          <strong style={{ color: "#e65100" }}>Total: {devices.length}</strong>
        </div>
      </div>

      {/* Filter Buttons */}
      <div style={{ marginBottom: "20px" }}>
        <button
          onClick={() => setStatusFilter("all")}
          style={{
            padding: "8px 16px",
            marginRight: "8px",
            backgroundColor: statusFilter === "all" ? "#1976d2" : "#ddd",
            color: statusFilter === "all" ? "white" : "black",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          All ({devices.length})
        </button>
        <button
          onClick={() => setStatusFilter("active")}
          style={{
            padding: "8px 16px",
            marginRight: "8px",
            backgroundColor: statusFilter === "active" ? "#388e3c" : "#ddd",
            color: statusFilter === "active" ? "white" : "black",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Active ({activeCount})
        </button>
        <button
          onClick={() => setStatusFilter("stopped")}
          style={{
            padding: "8px 16px",
            backgroundColor: statusFilter === "stopped" ? "#d32f2f" : "#ddd",
            color: statusFilter === "stopped" ? "white" : "black",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Offline ({offlineCount})
        </button>
      </div>

      {/* Device List */}
      <div>
        {devices.length === 0 ? (
          <p style={{ textAlign: "center", color: "#999" }}>No devices found</p>
        ) : (
          devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))
        )}
      </div>
    </div>
  );
}

export default DevicesList;
```

### 4. Integration in Main App

```javascript
import React from "react";
import DevicesList from "./components/DevicesList";

function App() {
  const token = localStorage.getItem("authToken"); // Get your auth token

  if (!token) {
    return <div>Please login first</div>;
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif" }}>
      <header style={{ padding: "20px", backgroundColor: "#1976d2", color: "white" }}>
        <h1>Device Management Dashboard</h1>
      </header>
      <DevicesList token={token} />
    </div>
  );
}

export default App;
```

---

## Key Features

1. **Real-time Heartbeat Status**
   - Devices online if `last_seen` within 10 seconds
   - Auto-updates via polling (configurable interval)

2. **Visual Indicators**
   - 🟢 Green blinking circle = Online/Active
   - ⚫ Gray circle = Offline/Stopped
   - Shows seconds since last heartbeat

3. **Filter Options**
   - `all` - All devices
   - `active` - Only online devices
   - `stopped` - Only offline devices

4. **Summary Dashboard**
   - Count of active devices
   - Count of offline devices
   - Total device count

---

## Device Heartbeat Updates (Backend)

Ensure your device app updates `last_seen` every 10 seconds:

```sql
-- Update device's last_seen timestamp
UPDATE devices SET last_seen = NOW() WHERE id = $1;
```

Or via API (if you have a device heartbeat endpoint):
```bash
POST /device/heartbeat
Body: { device_id: "..." }
```

---

## Polling Intervals

- **Frontend Poll**: Every 5 seconds (recommended - balances responsiveness vs load)
- **Backend Threshold**: 10 seconds (heartbeat timeout)
- **Adjust as needed** based on your requirements

---

## Notes

- `last_seen` must be updated by the device every 10 seconds
- The UI updates automatically every 5 seconds via polling
- No WebSockets needed - simple polling is efficient for most use cases
- You can reduce polling to 3-5 seconds for more real-time feel
- Increase to 10-15 seconds for lower server load

---

File: adminApis.js (updated `/devices` route)
