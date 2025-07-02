const express = require("./express_file");
const app = express()

const cors = require("cors");
const port = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json()); // Parse JSON body

// Routers
const rootRouter = require("./router");
const apiRoutes = require("./routes/index");

app.use("/", rootRouter);        // e.g. GET /
app.use("/api", apiRoutes);      // e.g. GET /api/users

// Start Server
app.listen(port,"0.0.0.0",() => {
  console.log(`🚀 Server running at: http://localhost:${port}`);
});
