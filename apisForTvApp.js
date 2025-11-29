const {
  express,
  jsonwebtoken,
   bcrypt,
  db} = require("./deps");
const deviceAuth = require("./middleware/deviceAuth");
const router = express.Router();
router.post("/ad-statistics", deviceAuth,async (req, res) => {
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

    const validPass = await bcrypt.compare(password, staff.rows[0].password);
    if (!validPass)
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
      { device_id: device.rows[0].id, client_id: device.rows[0].client_id },
      process.env.JWT_SECRET,
    );
    const baseUrl = `${req.protocol}://${req.get("host")}`;

    return res.json({
      success: true,
      message: "Device activated successfully",
      token,
      device_id:device.rows[0].id,
      baseUrl
    });
  } catch (err) {
    console.error("Activation error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});
router.get("/ads", deviceAuth, async (req, res) => {
  const { device_id } = req.query;
  const ads = await db.query(
    `SELECT a.id, a.title, a.media_url, a.media_type, ad.duration
     FROM ad_devices ad
     JOIN ads a ON a.id = ad.ad_id
     WHERE ad.device_id = $1 AND ad.status='active'`,
    [device_id]
  );
  res.json({ success: true, ads: ads.rows });
});

module.exports = router;


