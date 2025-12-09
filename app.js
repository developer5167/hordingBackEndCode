const { express } = require("./deps");
const { Server } = require("socket.io");
const http = require("http");
require('dotenv').config();
const client = require("./db");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;
const webhook = require("./weebhook");
// Middleware
app.use(cors());
app.use("/superadmin/payments/webhooks", webhook)
app.use(express.json())
const rootRouterAdvertiser = require("./advertiserApis");
const order = require("./order");
const adminApis = require("./adminApis");
const apiRoutes = require("./routes/index");
const superAdminApis = require("./superadminApis");
const superadminAnalyticsApis = require("./superadminAnalyticsApis");
const superadminPayments = require("./superadminPayments");
const apisForTv = require("./apisForTvApp");
const { log } = require("console");
const {jsonwebtoken} =require("./deps")

app.use("/superadmin", superAdminApis);
app.use("/superadmin", superadminAnalyticsApis);
app.use("/superadmin/payments", superadminPayments);
app.use("/advertiser", rootRouterAdvertiser); // e.g. GET /
app.use("/admin", adminApis); // e.g. GET /
app.use("/api", apiRoutes); // e.g. GET /api/users
app.use("/tvApp", apisForTv); // e.g. GET /api/users
app.use("/advertiser/payments", order)


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow Android app
    methods: ["GET", "POST"],
  },
});
io.use((socket, next) => {
  try {
    const token = socket.handshake.query.token;
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
    socket.device_id = decoded.device_id;
    socket.client_id = decoded.client_id;
    return next();
  } catch (err) {
    console.log("❌ Invalid device token. "+err);
    return next(new Error("Unauthorized"));
  }
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
