const { express } = require("./deps");
const { Server } = require("socket.io");
const http = require("http");
require('dotenv').config();
const client = require("./db");
const app = express();

const cors = require("cors");
const port = process.env.PORT || 4000;
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

client.on("notification", async (msg) => {
  if (msg.channel === "device_status_channel") {
     console.log(msg.payload);
    if (msg.payload.change_type === "status") {
      io.to(msg.payload.device_id).emit("device_status_updated", msg.payload);
    } else if (msg.payload.change_type === "emergency") {
      io.to(msg.payload.device_id).emit("emergency_mode_updated", msg.payload);
    }
  } else if (msg.channel === "client_subscription_channel") {
    console.log(msg.channel);
    
    
    const { client_id, subscription_status } =msg. payload;
    console.log(msg. payload);

    // fetch all devices under this client
    const devicesRes = await client.query(
      `SELECT id FROM devices WHERE client_id = $1`,
      [client_id]
    );
    // broadcast to all devices in that client's group
    for (const row of devicesRes.rows) {
      io.to(row.id).emit("subscription_status_updated", payload);
    }
  }
});

client.query("LISTEN device_status_channel");
client.query("LISTEN client_subscription_channel");

server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running at: http://localhost:${port}`);
});
