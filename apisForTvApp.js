const {
  express,
  jsonwebtoken,
   bcrypt,
  db} = require("./deps");

  require("dotenv").config();
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

// ----------------------
// POST /devices/activate
// Activate a device using activation_code + staff email + password
// Only the staff assigned to the device may activate it.
// Body: { activation_code, email, password }
// ----------------------

// router.post("/activate", async (req, res) => {
//   const { activationCode, email, password } = req.body;

//   if (!activationCode || !email || !password)
//     return res.status(400).json({ success: false, message: "Missing fields" });

//   try {
//     const staff = await db.query(
//       "SELECT * FROM staffs WHERE email=$1",
//       [email]
//     );
//     if (staff.rows.length === 0)
//       return res.status(401).json({ success: false, message: "Invalid user" });

//     const validPass = await bcrypt.compare(password, staff.rows[0].password);
//     if (!validPass)
//       return res.status(401).json({ success: false, message: "Incorrect password" });

//     const device = await db.query(
//       "SELECT * FROM devices WHERE activation_code=$1",
//       [activationCode]
//     );
//     if (device.rows.length === 0)
//       return res.status(400).json({ success: false, message: "Invalid activation code" });

//     // Mark device as activated
//     await db.query(
//       "UPDATE devices SET status='active', activated_by=$1, activated_at=NOW() WHERE activation_code=$2",
//       [staff.rows[0].id, activationCode]
//     );

//     // Generate token
//     const token = jsonwebtoken.sign(
//       { device_id: device.rows[0].id, client_id: device.rows[0].client_id },
//       process.env.JWT_SECRET,
//     );
//     const baseUrl = `${req.protocol}://${req.get("host")}`;

//     return res.json({
//       success: true,
//       message: "Device activated successfully",
//       token,
//       device_id:device.rows[0].id,
//       baseUrl
//     });
//   } catch (err) {
//     console.error("Activation error:", err);
//     return res.status(500).json({ success: false, message: "Server error" });
//   }
// });



router.post("/devices/activate", async (req, res) => {
  try {
    const { activation_code, email, password } = req.body || {};
    if (!activation_code || !email || !password) {
      return res.status(400).json({ success: false, error: 'activation_code_email_password_required' });
    }

    // lookup device by activation_code
    const devQ = `SELECT id, client_id, is_assigned, assigned_to, status FROM devices WHERE activation_code = $1 LIMIT 1`;
    const { rows: devRows } = await db.query(devQ, [activation_code]);
    if (devRows.length === 0) return res.status(404).json({ success: false, error: 'invalid_activation_code' });

    const device = devRows[0];

    // Device must be assigned to a staff (per requirement)
    if (!device.is_assigned || !device.assigned_to) {
      return res.status(403).json({ success: false, error: 'device_not_assigned' });
    }

    // Lookup staff by assigned_to id and client scope
    const staffQ = `SELECT id, username, email, password, status FROM staffs WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const { rows: staffRows } = await db.query(staffQ, [device.assigned_to, device.client_id]);
    if (staffRows.length === 0) return res.status(404).json({ success: false, error: 'assigned_staff_not_found' });

    const staff = staffRows[0];
    if (!staff.email || staff.email.toLowerCase().trim() !== String(email).toLowerCase().trim()) {
      return res.status(401).json({ success: false, error: 'invalid_staff_credentials' });
    }

    // verify password
    const ok = await bcrypt.compare(String(password), staff.password);
    if (!ok) return res.status(401).json({ success: false, error: 'invalid_staff_credentials' });

    // optional: ensure staff is active
    if (staff.status === false || String(staff.status).toLowerCase() === 'disabled') {
      return res.status(403).json({ success: false, error: 'staff_not_active' });
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
    const token = jsonwebtoken.sign(tokenPayload, jwtSecret, { expiresIn: '30d' });
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    return res.status(200).json({ success: true, message: 'device_activated', device: updated[0], token,baseUrl });
  } catch (err) {
    console.error('Error activating device:', err);
    return res.status(500).json({ success: false, error: 'activation_failed', detail: err.message });
  }
});

module.exports = router;


