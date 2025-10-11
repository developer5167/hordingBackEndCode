const {
  express,
  jsonwebtoken,
  db} = require("./deps");
const checkValidClient = require("./middleware/checkValidClient");
const router = express.Router();
router.post("/ad-statistics", checkValidClient,async (req, res) => {
  try {
    const { ad_id, device_id, duration_played, location } = req.body;

    if (!ad_id || !device_id) {
      return res.status(400).json({ error: "ad_id and device_id are required" });
    }

    const result = await db.query(
      `INSERT INTO ad_statistics (ad_id, device_id, duration_played, location)
       VALUES ($1, $2, COALESCE($3, 0), $4)
       RETURNING id, play_time`,
      [ad_id, device_id, duration_played || 0, location || null]
    );

    res.json({
      message: "Ad statistics recorded",
      id: result.rows[0].id,
      play_time: result.rows[0].play_time
    });
  } catch (err) {
    console.error("Error saving ad statistics:", err);
    res.status(500).json({ error: "Failed to record ad statistics" });
  }
});
router.post("/activate", async (req, res) => {
  const { activationCode, staffUsername, password } = req.body;

  if (!activationCode || !staffUsername || !password)
    return res.status(400).json({ success: false, message: "Missing fields" });

  try {
    const staff = await db.query(
      "SELECT * FROM staffs WHERE username=$1",
      [staffUsername]
    );
    if (staff.rows.length === 0)
      return res.status(401).json({ success: false, message: "Invalid user" });

    // const validPass = await bcrypt.compare(password, staff.rows[0].password);
    if (password!=staff.rows[0].password)
      return res.status(401).json({ success: false, message: "Incorrect password" });

    const device = await db.query(
      "SELECT * FROM devices WHERE activation_code=$1",
      [activationCode]
    );
    if (device.rows.length === 0)
      return res.status(400).json({ success: false, message: "Invalid activation code" });

    // Mark device as activated
    await db.query(
      "UPDATE devices SET status='active', activated_by=$1, activated_at=NOW() WHERE activation_code=$2",
      [staff.rows[0].id, activationCode]
    );

    // Generate token
    const token = jsonwebtoken.sign(
      { device_id: device.rows[0].id, staff_id: staff.rows[0].id },
      process.env.JWT_SECRET,
  
    );

    return res.json({
      success: true,
      message: "Device activated successfully",
      token,
    });
  } catch (err) {
    console.error("Activation error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});
module.exports = router;


