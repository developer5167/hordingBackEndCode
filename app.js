const { express } = require("./deps");
const { Server } = require("socket.io");
const http = require("http");
require('dotenv').config();
const { installShutdownBackup } = require("./scripts/backupDatabase");
installShutdownBackup();
const client = require("./db");
const app = express();
const cors = require("cors");
const {
  buildAllowedOriginSet,
  corsOriginCallback,
} = require("./corsConfig");
const port = process.env.PORT || 3000;
const webhook = require("./weebhook");
// Middleware — browser SPAs / marketing site; append CORS_EXTRA_ORIGINS in .env if needed
const allowedOrigins = buildAllowedOriginSet();
app.use(cors({ origin: corsOriginCallback(allowedOrigins) }));
app.use("/superadmin/payments/webhooks", webhook)
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}))
app.use("/", (req, res) => {
  res.send({
    message: "Hording API is alive",
  });
});
const rootRouterAdvertiser = require("./advertiserApis");
const order = require("./order");
const adminApis = require("./adminApis");
const apiRoutes = require("./routes/index");
const superAdminApis = require("./superadminApis");
const superadminAnalyticsApis = require("./superadminAnalyticsApis");
const superadminPayments = require("./superadminPayments");
const apisForTv = require("./apisForTvApp");
const couponApis = require("./couponApis");
const marketingApis = require("./marketingApis");
const complianceApis = require("./complianceApis");
const { log } = require("console");
const { jsonwebtoken } = require("./deps")
const { processAdLifecycle } = require("./services/adLifecycleService");

app.use("/superadmin", superAdminApis);
app.use("/superadmin", superadminAnalyticsApis);
app.use("/superadmin/payments", superadminPayments);
app.use("/superadmin", marketingApis);
app.use("/superadmin/compliance", complianceApis);
app.use("/advertiser", rootRouterAdvertiser); // e.g. GET /
app.use("/admin", adminApis); // e.g. GET /
app.use("/admin/compliance", complianceApis);
app.use("/api", apiRoutes); // e.g. GET /api/users
app.use("/tvApp", apisForTv); // e.g. GET /api/users
app.use("/website", marketingApis);
app.use("/advertiser/payments", order);
app.use("/superadmin/coupons", couponApis);
app.use("/admin/coupons", couponApis);
app.use("/advertiser/coupons", couponApis);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow Android app
    methods: ["GET", "POST"],
  },
});


io.use((socket, next) => {
  try {
    const token =
      socket.handshake.query?.token ||
      socket.handshake.auth?.token;
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
    socket.device_id = decoded.device_id;
    socket.client_id = decoded.client_id;
    return next();
  } catch (err) {
    console.log("❌ Invalid device token. " + err);
    return next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => {
  console.log("🟢 Device connected:", socket.device_id);

  // 🔑 JOIN ROOM = device_id
  socket.on("join_device", (deviceId) => {
    socket.join(deviceId);
    console.log(`Device ${deviceId} joined room`);
  });
  console.log(`📥 Device ${socket.device_id} joined room`);

  socket.on("disconnect", () => {
    console.log("🔴 Device disconnected:", socket.device_id);
  });
});
io.on("connect_error", (err) => {
  console.log("❌ Socket.IO error:", err.message);
});
client.on("notification", async (msg) => {
  const channel = msg.channel;
  const payload = JSON.parse(msg.payload);

  switch (channel) {
    // 🔔 DEVICE STATUS CHANGE (direct device update)
    case "device_status_channel":
      console.log("📡 Device status change:", payload);
      io.to(payload.device_id).emit("device_status", payload);
      break;

    // 🔔 CLIENT SUBSCRIPTION CHANGE (affects all devices under client)
    case "client_subscription_channel":
      console.log("📦 Subscription changed:", payload);

      const { client_id, subscription_status } = payload;

      // Decide new status for devices
      // const newDeviceStatus = subscription_status === "blocked" ? "paused" : "active";

      // Update all device statuses — triggers will automatically notify device_status_channel
      const updateQuery = `
          UPDATE devices
          SET status = $1
          WHERE client_id = $2
        `;
      await client.query(updateQuery, [subscription_status, client_id]);

      console.log(
        `✅ Updated all devices for client ${client_id} to '${subscription_status}'`
      );
      // ⚠️ DO NOT emit manually here — triggers will handle per-device emits
      break;
  }
});


client.query("LISTEN device_status_channel");
client.query("LISTEN client_subscription_channel");

server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running at: http://localhost:${port}`);
});

// Ad lifecycle automation:
// - mark expired ads immediately by end_date
// - notify advertisers about 2-day grace period
// - delete expired ads (DB + S3) after grace
setInterval(async () => {
  try {
    await processAdLifecycle();
  } catch (err) {
    console.error("Ad lifecycle background run failed:", err.message);
  }
}, 60 * 60 * 1000); // hourly

processAdLifecycle().catch((err) => {
  console.error("Initial ad lifecycle run failed:", err.message);
});
