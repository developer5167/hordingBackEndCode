const { express, jsonwebtoken, bcrypt, db } = require("./deps");

require("dotenv").config();
const deviceAuth = require("./middleware/deviceAuth");
const router = express.Router();
router.post("/ad-statistics", deviceAuth, async (req, res) => {
  try {
    const { ad_id, device_id, duration_played, location } = req.body;

    if (!ad_id || !device_id) {
      return res
        .status(400)
        .json({ error: "ad_id and device_id are required" });
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
      play_time: result.rows[0].play_time,
    });
  } catch (err) {
    console.error("Error saving ad statistics:", err);
    res.status(500).json({ error: "Failed to record ad statistics" });
  }
});

router.get("/ads", deviceAuth, async (req, res) => {
  const { device_id } = req.query;
  const ads = await db.query(
    `SELECT 
    ads.id,
    ads.title,
    ads.media_url,
    ads.media_type,
    ad_devices.start_date,
    ad_devices.end_date
FROM ad_devices
JOIN ads ON ads.id = ad_devices.ad_id
WHERE ad_devices.device_id = $1
  AND ad_devices.status = 'active'
  AND ad_devices.start_date <= NOW()
  AND ad_devices.end_date >= NOW();
`,
    [device_id]
  );
  console.log(ads.rows);

  res.json({ success: true, ads: ads.rows });
});


router.post("/devices/activate", async (req, res) => {
  try {
    const { activation_code, email, password } = req.body || {};
    if (!activation_code || !email || !password) {
      return res
        .status(400)
        .json({
          success: false,
          error: "activation_code_email_password_required",
        });
    }

    // lookup device by activation_code
    const devQ = `SELECT id, client_id, is_assigned, assigned_to, status FROM devices WHERE activation_code = $1 LIMIT 1`;
    const { rows: devRows } = await db.query(devQ, [activation_code]);
    if (devRows.length === 0)
      return res
        .status(404)
        .json({ success: false, error: "invalid_activation_code" });

    const device = devRows[0];

    // Device must be assigned to a staff (per requirement)
    if (!device.is_assigned || !device.assigned_to) {
      return res
        .status(403)
        .json({ success: false, error: "device_not_assigned" });
    }

    // Lookup staff by assigned_to id and client scope
    const staffQ = `SELECT id, username, email, password, status FROM staffs WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const { rows: staffRows } = await db.query(staffQ, [
      device.assigned_to,
      device.client_id,
    ]);
    if (staffRows.length === 0)
      return res
        .status(404)
        .json({ success: false, error: "assigned_staff_not_found" });

    const staff = staffRows[0];
    if (
      !staff.email ||
      staff.email.toLowerCase().trim() !== String(email).toLowerCase().trim()
    ) {
      return res
        .status(401)
        .json({ success: false, error: "invalid_staff_credentials" });
    }

    // verify password
    const ok = await bcrypt.compare(String(password), staff.password);
    if (!ok)
      return res
        .status(401)
        .json({ success: false, error: "invalid_staff_credentials" });

    // optional: ensure staff is active
    if (
      staff.status === false ||
      String(staff.status).toLowerCase() === "disabled"
    ) {
      return res
        .status(403)
        .json({ success: false, error: "staff_not_active" });
    }

    // All checks passed — activate device (mark status active and preserve assigned_to)
    const updQ = `UPDATE devices SET status = 'active', is_assigned = true WHERE id = $1 RETURNING id, status, is_assigned, assigned_to`;
    const { rows: updated } = await db.query(updQ, [device.id]);

    // generate JWT token for the device/session
    const jwtSecret = process.env.JWT_SECRET;
    const tokenPayload = {
      device_id: updated[0].id,
      client_id: device.client_id,
      staff_id: staff.id,
    };
    const token = jsonwebtoken.sign(tokenPayload, jwtSecret, {
      expiresIn: "30d",
    });
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res
      .status(200)
      .json({
        success: true,
        message: "device_activated",
        device: updated[0],
        token,
        baseUrl,
      });
  } catch (err) {
    console.error("Error activating device:", err);
    return res
      .status(500)
      .json({
        success: false,
        error: "activation_failed",
        detail: err.message,
      });
  }
});
router.get("/company-ads", deviceAuth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const media_type = req.query.media_type || null;

    // build where clause with parameterized queries
    const baseParams = [clientId];
    let where = `WHERE client_id = $1`;
    if (status) {
      baseParams.push(status);
      where += ` AND status = $${baseParams.length}`;
    }
    if (media_type) {
      baseParams.push(media_type);
      where += ` AND media_type = $${baseParams.length}`;
    }

    // total count
    const countQ = `SELECT COUNT(*)::int AS total FROM company_ads ${where}`;
    const { rows: countRows } = await db.query(countQ, baseParams);
    const total = countRows[0] ? Number(countRows[0].total) : 0;

    // page query
    const pageParams = baseParams.concat([limit, offset]);
    // select only columns present in company_ads table
    const q = `SELECT id, client_id, media_type, filename, media_url,created_at,file
           FROM company_ads ${where} ORDER BY id DESC LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`;

    // Note: $${pageParams.length -1} is limit and $${pageParams.length} is offset
    const { rows } = await db.query(q, pageParams);

    return res.status(200).json({
      success: true,
      message: "company_ads_fetched",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: rows,
    });
  } catch (err) {
    console.error("Error fetching company ads:", err);
    return res.status(500).json({ success: false, error: "fetch_failed", detail: err.message });
  }
});

module.exports = router;
