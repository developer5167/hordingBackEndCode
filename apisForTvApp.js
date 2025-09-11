const {
  express,
  upload,       // multer memory-storage ready
  uuidv4,
  jwt,
  bcrypt,
  nodemailer,
  path,
  crypto,
  consoleLog,
  http,
  cors,
  db,
  admin,
  auth
} = require("./deps");
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
module.exports = router;