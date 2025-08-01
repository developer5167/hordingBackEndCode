const express = require("../express_file");
const router = express.Router();
const auth = require("../middleware/auth");
router.get("/protected", auth, async (req, res) => {
  res.send("This is a protected route.");
});

// Example public route
router.get("/status", (req, res) => {
  res.json({ status: "API is live" });
});

module.exports = router;
