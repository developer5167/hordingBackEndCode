const express = require("./express_file");
const { Server } = require("socket.io");
const http = require("http");
const client = require("./db");
const app = express();

const cors = require("cors");
const port = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON body

// Routers
// const rootRouter = require("./router");
const rootRouterAdvertiser = require("./advertiserApis");
const order = require("./order");
const adminApis = require("./adminApis");
const apiRoutes = require("./routes/index");
const superAdminApis = require("./superadminApis");
const apisForTv = require("./apisForTvApp");
app.use("/superadmin", superAdminApis);
app.use("/advertiser", rootRouterAdvertiser); // e.g. GET /
app.use("/admin", adminApis); // e.g. GET /
app.use("/api", apiRoutes); // e.g. GET /api/users
app.use("/tvApp", apisForTv); // e.g. GET /api/users
app.use("/advertiser/payments",order)
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow Android app
    methods: ["GET", "POST"],
  },
});

client.query("LISTEN pause_all_ads_channel");

client.on("notification", (msg) => {
  const payload = JSON.parse(msg.payload);
  console.log("DB change:", payload);

  // Send to connected clients
  io.emit("pauseAllAdsUpdate", payload);
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
  
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running at: http://localhost:${port}`);
});
