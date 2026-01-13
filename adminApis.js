const {
  express,
  upload, // multer memory-storage ready
  uuidv4,
  jsonwebtoken,
  bcrypt,
  nodemailer,
  path,
  crypto,
  consoleLog,
  http,
  cors,
  db,
  admin,
  auth,
} = require("./deps");
const bucket = admin.storage().bucket();
// router.js (or a separate advertiser.routes.js if you want to keep clean)
const router = express.Router();

const checkValidClient = require("./middleware/checkValidClient");
const deviceAuth = require("./middleware/deviceAuth");

// ----------------------
// Staff Management Helpers
// ----------------------
function generateStaffPassword() {
  return Math.random().toString(36).slice(-8);
}

async function sendStaffEmail(to, email, password, devices = []) {
  // re-use project's SMTP settings (same as superadminApis)
  const mailRequest = nodemailer.createTransport({
    host: "smtpout.secureserver.net",
    port: 445,
    auth: {
      user: "support@sandboxdeveloper.com",
      pass: "Sam@@@5167",
    },
  });
  
  // build device table HTML if devices provided
  let deviceTableHTML = '';
  if (devices && devices.length > 0) {
    deviceTableHTML = `
      <h3>Assigned Devices</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%;">
        <tr style="background-color: #f2f2f2;">
          <th>S.No</th>
          <th>Device Name</th>
          <th>Location</th>
          <th>Activation Code</th>
        </tr>
    `;
    devices.forEach((device, index) => {
      deviceTableHTML += `
        <tr>
          <td>${index + 1}</td>
          <td>${device.name || 'N/A'}</td>
          <td>${device.location || 'N/A'}</td>
          <td><strong>${device.activation_code || 'N/A'}</strong></td>
        </tr>
      `;
    });
    deviceTableHTML += '</table>';
  }
  
  const mailingOptions = {
    from: "support@sandboxdeveloper.com",
    to: to,
    subject: "Your Staff Account - Credentials & Assigned Devices",
    html: `<p>Hello ${email},</p>
      <p>A staff account has been created for you.</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Password:</strong> ${password}</p>
      <p>Please use these credentials to login during device setup.</p>
      ${deviceTableHTML}
      <p>Best regards,<br/>ListNow Team</p>`,
  };
  try {
    await mailRequest.sendMail(mailingOptions);
  } catch (ex) {
    console.error("sendStaffEmail error:", ex);
  }
}

// Admin Login
router.post("/login", checkValidClient, async (req, res) => {
  console.log("DASDASD");

  try {
    const { email, password } = req.body;
    const clientId = req.client_id; // from checkValidClient middleware

    if (!email || !password) {
      return res.status(200).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Step 1: Find admin
    const query = `
      SELECT id, name, email, password_hash, role, tokens,client_id
      FROM users
      WHERE email = $1 AND client_id = $2 AND role = 'admin'
      LIMIT 1
    `;
    const { rows } = await db.query(query, [email, clientId]);

    if (rows.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Invalid credentials or not an admin",
      });
    }

    const admin = rows[0];

    // Step 2: Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(200).json({
        success: false,
        message: "Invalid credentials",
      });
    }
    const tokenPayload = {
      userId: admin.id,
      clientId: admin.client_id,
      role: admin.role,
      email: admin.email,
    };
    const token = jsonwebtoken.sign(tokenPayload, "THISISTESTAPPFORHORDING");
    // Step 3: Generate JWT

    // Step 4: Store token
    const updateTokens = `
      UPDATE users
      SET tokens = $1
      WHERE id = $2
    `;
    await db.query(updateTokens, [token, admin.id]);

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      data: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Error in admin login:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong during login.",
      error: error.message,
    });
  }
});
router.get("/getWalletBalance", checkValidClient, auth, async (req, res) => {
  const query = `select balance, updated_at from client_wallets where client_id = $1`;
  try {
    const { rows } = await db.query(query, [req.client_id]);
    if (rows.length > 0) {
      return res.json({
        success: true,
        message: "Wallet balance fetched successfully.",
        data: rows[0],
      });
    } else {
      return res.json({
        success: true,
        message: "Wallet balance fetched successfully.",
        data: {
          balance: 0,
          update_at: `${
            new Date().toLocaleDateString() +
            "," +
            new Date().toLocaleTimeString()
          }`,
        },
      });
    }
  } catch (e) {
    console.log(e);

    res.status(500).json({
      success: false,
      message: "Failed to fetch wallet balance",
      detail: err.message,
    });
  }
});
// router.js
router.get("/profile", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user_id;
    const clientId = req.client_id;

    const query = `
      SELECT id, name, email, role, client_id, created_at
      FROM users
      WHERE id = $1 AND client_id = $2 AND role = 'admin'
      LIMIT 1
    `;
    const { rows } = await db.query(query, [adminId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin profile fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching admin profile:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching profile",
      error: error.message,
    });
  }
});
// router.js
router.put("/profile", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user_id;
    const clientId = req.client_id;
    const { name, email } = req.body;

    if (!name && !email) {
      return res.status(400).json({
        success: false,
        message: "At least one field (name or email) must be provided",
      });
    }

    const updateQuery = `
      UPDATE users
      SET name = COALESCE($1, name),
          email = COALESCE($2, email)
      WHERE id = $3 AND client_id = $4 AND role = 'admin'
      RETURNING id, name, email, role, client_id
    `;
    const values = [name || null, email || null, adminId, clientId];

    const { rows } = await db.query(updateQuery, values);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found or not authorized",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error updating admin profile:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile",
      error: error.message,
    });
  }
});

// router.js
router.patch("/change-password", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user_id;
    const clientId = req.client_id;
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: "Both old_password and new_password are required",
      });
    }

    // Step 1: Get admin
    const query = `
      SELECT id, password_hash 
      FROM users
      WHERE id = $1 AND client_id = $2 AND role = 'admin'
      LIMIT 1
    `;
    const { rows } = await db.query(query, [adminId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    const admin = rows[0];

    // Step 2: Check old password
    const validPassword = await bcrypt.compare(
      old_password,
      admin.password_hash
    );
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Old password is incorrect",
      });
    }

    // Step 3: Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 8);

    // Step 4: Update password
    const updateQuery = `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      RETURNING id, name, email, role, client_id
    `;
    const updated = await db.query(updateQuery, [hashedPassword, adminId]);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
      data: updated.rows[0],
    });
  } catch (error) {
    console.error("Error changing admin password:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while changing password",
      error: error.message,
    });
  }
});

router.post("/logout", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user_id;
    const clientId = req.client_id;
    const token = req.token; // from auth middleware

    const query = `
      UPDATE users
      SET tokens = array_remove(tokens, $1)
      WHERE id = $2 AND client_id = $3 AND role = 'admin'
      RETURNING id, email
    `;
    const { rows } = await db.query(query, [token, adminId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found or already logged out",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Error logging out admin:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while logging out",
      error: error.message,
    });
  }
});

// Device Management APIs (List, Add, Update, Delete, etc.).
// API: List Devices with Heartbeat Status
router.get("/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const search = req.query.search ? String(req.query.search).trim() : null;
    const statusFilter = req.query.status_filter ? String(req.query.status_filter).toLowerCase().trim() : 'all'; // 'all', 'active', 'stopped'

    // build optional search filtering
    let where = `WHERE client_id = $1`;
    const params = [clientId];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR location ILIKE $${params.length} OR id::text ILIKE $${params.length})`;
    }

    const query = `
      SELECT id, name, location, width, height, status, is_assigned, assigned_to, created_at, last_seen
      FROM devices
      ${where}
      ORDER BY created_at DESC
    `;
    const { rows } = await db.query(query, params);

    // Process rows: calculate online/offline based on last_seen (10 second heartbeat)
    const now = new Date();
    const HEARTBEAT_THRESHOLD = 10000; // 10 seconds in milliseconds
    
    const processedRows = rows.map((device) => {
      let online = false;
      let secondsSinceLastSeen = null;
      
      if (device.last_seen) {
        const lastSeen = new Date(device.last_seen);
        const timeDiff = now - lastSeen;
        secondsSinceLastSeen = Math.floor(timeDiff / 1000);
        online = timeDiff <= HEARTBEAT_THRESHOLD;
      }
      
      return {
        ...device,
        online, // true = active/online, false = offline/stopped
        seconds_since_last_seen: secondsSinceLastSeen,
      };
    });

    // Apply status filter after calculating online status
    let filtered = processedRows;
    if (statusFilter === 'active') {
      filtered = processedRows.filter((d) => d.online === true);
    } else if (statusFilter === 'stopped') {
      filtered = processedRows.filter((d) => d.online === false);
    }
    // 'all' returns everything

    return res.status(200).json({
      success: true,
      message: "Devices fetched successfully",
      total: filtered.length,
      status_filter: statusFilter,
      data: filtered,
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching devices",
      error: error.message,
    });
  }
});

// API: Get Device Details
router.get("/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;
    const query = `
      SELECT id, name, location, width, height, status, created_at
      FROM devices
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Device details fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching device details:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching device details",
      error: error.message,
    });
  }
});

// API: Add Device
// POST /admin/devices
router.post("/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { name, location, width, height, status } = req.body;

    if (!name || !location || !width || !height) {
      return res.status(400).json({
        success: false,
        message: "name, location, width, height required",
      });
    }

    // 1. Get client's active subscription
    const subQ = `
      SELECT sp.max_devices
      FROM client_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.client_id = $1 AND cs.status = 'active'
      ORDER BY cs.created_at DESC
      LIMIT 1
    `;
    const subRes = await db.query(subQ, [clientId]);
    if (subRes.rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No active subscription" });
    }
    const maxDevices = subRes.rows[0].max_devices;

    // 2. Count existing devices
    const countQ = `SELECT COUNT(*)::int AS device_count FROM devices WHERE client_id = $1`;
    const countRes = await db.query(countQ, [clientId]);
    const deviceCount = countRes.rows[0].device_count;

    // 3. Enforce limit
    if (maxDevices && deviceCount >= maxDevices) {
      return res.status(403).json({
        success: false,
        message: `Device limit reached. Your plan allows only ${maxDevices} devices.`,
      });
    }

    // 4. Insert device
    const insertQ = `
      INSERT INTO devices (client_id, name, location, width, height, status,activation_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
    const values = [
      clientId,
      name,
      location,
      width,
      height,
      "not-allocated",
      generateActivationCode()
    ];
    const { rows } = await db.query(insertQ, values);

    res.status(201).json({ success: true, device: rows[0] });
  } catch (err) {
    console.error("Error adding device:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Update Device
router.put("/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;
    const { device_name, location, width, height, status } = req.body;

    if (!device_name && !location && !width && !height && !status) {
      return res.status(400).json({
        success: false,
        message: "At least one field must be provided for update",
      });
    }

    const query = `
      UPDATE devices
      SET name = COALESCE($1, name),
          location = COALESCE($2, location),
          width = COALESCE($3, width),
          height = COALESCE($4, height),
          status = COALESCE($5, status)
      WHERE id = $6 AND client_id = $7
      RETURNING id, name, location, width, height, status, created_at
    `;
    const values = [
      device_name || null,
      location || null,
      width || null,
      height || null,
      status || null,
      id,
      clientId,
    ];

    const { rows } = await db.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Device updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error updating device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating device",
      error: error.message,
    });
  }
});
  // API: Delete Device
router.delete("/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // perform all deletions in a transaction to keep DB consistent
    await db.query("BEGIN");
    try {
      // Delete ad-device mappings for this device (client-scoped)
      await db.query(`DELETE FROM ad_devices WHERE device_id = $1 AND client_id = $2`, [id, clientId]);

      // Delete emergency/company ad mappings that include this device
      await db.query(`DELETE FROM emergency_ad_devices WHERE device_id = $1`, [id]);

      // Delete staff-device assignments
      await db.query(`DELETE FROM staffs_devices WHERE device_id = $1`, [id]);

      // Delete pricing rules for this device (client-scoped)
      await db.query(`DELETE FROM pricing_rules WHERE device_id = $1 AND client_id = $2`, [id, clientId]);

      // Delete ad statistics and generic stats related to this device
      await db.query(`DELETE FROM ad_statistics WHERE device_id = $1`, [id]);


      // Finally delete the device row (client-scoped)
      const delDevice = await db.query(`DELETE FROM devices WHERE id = $1 AND client_id = $2 RETURNING id, name, location`, [id, clientId]);

      await db.query("COMMIT");

      if (delDevice.rows.length === 0) {
        return res.status(404).json({ success: false, message: "Device not found or not authorized" });
      }

      return res.status(200).json({ success: true, message: "Device deleted successfully", device: delDevice.rows[0] });
    } catch (innerErr) {
      await db.query("ROLLBACK");
      console.error("Error during device delete transaction:", innerErr);
      return res.status(500).json({ success: false, message: "Failed to delete device and related records", error: innerErr.message });
    }
  } catch (error) {
    console.error("Error deleting device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting device",
      error: error.message,
    });
  }
});

// Ad Management (Admin side)

//List Ads by Device
router.get("/devices/:id/ads", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // device id

    // Step 1: Ensure device belongs to client
    const deviceCheck = await db.query(
      `SELECT id, name, location FROM devices WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [id, clientId]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    // Step 2: Fetch ads for this device (join ads + ad_devices)
    const query = `
      SELECT 
        a.id AS ad_id,
        a.title,
        a.description,
        a.media_type,
        a.media_url,
        a.filename,
        a.created_at,
        ad.status,
        ad.start_date,
        ad.end_date,
        ad.status_updated_at,
        d.id AS device_id,
        d.name AS device_name,
        d.location
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      JOIN devices d ON d.id = ad.device_id
      WHERE ad.device_id = $1 AND a.client_id = $2
      ORDER BY ad.start_date DESC
    `;

    const { rows } = await db.query(query, [id, clientId]);

    return res.status(200).json({
      success: true,
      message: "Ads fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching ads by device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ads",
      error: error.message,
    });
  }
});

// API: Get Ad Details
router.get("/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // ad id

    const query = `
      SELECT a.id, a.title, a.description, a.media_type, a.media_url, a."fileName",
             a.status, a.start_date, a.end_date, a.status_updated_at,
             d.name, d.location, d.width, d.height
      FROM ads a
      JOIN devices d ON a.device_id = d.id
      WHERE a.id = $1 AND a.client_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad details fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching ad details:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad details",
      error: error.message,
    });
  }
});
router.post("/ads", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { device_id, status, location, page = 1, limit = 10 } = req.body;

    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        a.id AS ad_id,
        a.title,
        a.description,
        a.media_type,
        a.media_url,
        a.filename,
        a.created_at,
        ad.status,
        ad.start_date,
        ad.end_date,
        ad.status_updated_at,
        d.id AS device_id,
        d.name AS device_name,
        d.location
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      JOIN devices d ON d.id = ad.device_id
      WHERE a.client_id = $1
        AND ($2::uuid IS NULL OR d.id = $2)
        AND ($3::text IS NULL OR ad.status = $3)
        AND ($4::text IS NULL OR d.location = $4)
      ORDER BY ad.start_date DESC
      LIMIT $5 OFFSET $6
    `;

    const { rows } = await db.query(query, [
      clientId,
      device_id || null,
      status || null,
      location || null,
      limit,
      offset,
    ]);

    // count total for pagination
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      JOIN devices d ON d.id = ad.device_id
      WHERE a.client_id = $1
        AND ($2::uuid IS NULL OR d.id = $2)
        AND ($3::text IS NULL OR ad.status = $3)
        AND ($4::text IS NULL OR d.location = $4)
    `;
    const { rows: countRows } = await db.query(countQuery, [
      clientId,
      device_id || null,
      status || null,
      location || null,
    ]);

    return res.status(200).json({
      success: true,
      message: "Ads fetched successfully",
      data: rows,
      pagination: {
        total: Number(countRows[0].total),
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(Number(countRows[0].total) / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching ads:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ads",
      error: error.message,
    });
  }
});
// ✅ Get full user profile with ad info
router.get("/users/:id/profile", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const userQuery = `
      SELECT id AS user_id, name, email, mobile_number, role, isactive, created_at
      FROM users
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
    const { rows: userRows } = await db.query(userQuery, [id, clientId]);

    if (userRows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const user = userRows[0];

    const adsQuery = `
      SELECT 
        a.id AS ad_id,
        a.title,
        a.description,
        a.media_type,
        a.media_url,
        a.created_at,
        ad.start_date,
        ad.end_date,
        ad.status,
        d.id AS device_id,
        d.name AS device_name,
        d.location
      FROM ads a
      JOIN ad_devices ad ON ad.ad_id = a.id
      JOIN devices d ON d.id = ad.device_id
      WHERE a.user_id = $1 AND a.client_id = $2
      ORDER BY a.created_at DESC
    `;
    const { rows: ads } = await db.query(adsQuery, [id, clientId]);

    return res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: {
        ...user,
        total_ads: ads.length,
        ads,
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching user profile",
      error: error.message,
    });
  }
});
// ✅ Toggle user active status
router.patch(
  "/users/:id/toggle-status",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { id } = req.params;

      // Fetch current status
      const userCheck = await db.query(
        `SELECT id, isactive FROM users WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [id, clientId]
      );
      if (userCheck.rows.length === 0)
        return res
          .status(404)
          .json({ success: false, message: "User not found" });

      const isActive = userCheck.rows[0].isactive;

      // Toggle it
      const updated = await db.query(
        `UPDATE users SET isactive = ${!isActive} WHERE id = $1 RETURNING id, name, email, isactive`,
        [id]
      );

      const newStatus = updated.rows[0].isactive ? "activated" : "deactivated";

      return res.status(200).json({
        success: true,
        message: `User ${newStatus} successfully`,
        data: updated.rows[0],
      });
    } catch (error) {
      console.error("Error toggling user status:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while toggling user status",
        error: error.message,
      });
    }
  }
);

router.post("/users", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { page = 1, limit = 10, search = "" } = req.body;
    const offset = (page - 1) * limit;

    // 🩵 Use ILIKE for case-insensitive search (Postgres)
    const searchPattern = `%${search.trim()}%`;

    const query = `
      SELECT 
        id AS user_id,
        name AS user_name,
        email,
        mobile_number,
        role,
        isactive,
        created_at
      FROM users
      WHERE client_id = $1
        AND role = 'advertiser'
        AND ($2 = '%%' OR name ILIKE $2 OR email ILIKE $2 OR mobile_number ILIKE $2)
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `;
    const { rows } = await db.query(query, [
      clientId,
      searchPattern,
      limit,
      offset,
    ]);

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM users
      WHERE client_id = $1
        AND role = 'advertiser'
        AND ($2 = '%%' OR name ILIKE $2 OR email ILIKE $2 OR mobile_number ILIKE $2)
    `;
    const { rows: countRows } = await db.query(countQuery, [
      clientId,
      searchPattern,
    ]);

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: rows,
      pagination: {
        total: Number(countRows[0].total),
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(Number(countRows[0].total) / limit),
        hasNext: page * limit < Number(countRows[0].total),
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching users",
      error: error.message,
    });
  }
});

// make sure you have a helper function to delete files from Firebase
router.delete("/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // Step 1: Find ad to get fileName
    const findQuery = `
      SELECT id, title, fileName
      FROM ads
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
    const { rows: adRows } = await db.query(findQuery, [id, clientId]);

    if (adRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found",
      });
    }

    const ad = adRows[0];

    // Step 2: Delete ad from DB
    const deleteQuery = `
      DELETE FROM ads
      WHERE id = $1 AND client_id = $2
      RETURNING id, title
    `;
    const deleteQueryFromAdDevices = `
      DELETE FROM ad_devices
      WHERE ad_id = $1 AND client_id = $2
      
    `;
    const { rows } = await db.query(deleteQuery, [id, clientId]);
    await db.query(deleteQueryFromAdDevices, [id, clientId]);

    // Step 3: Delete file from Firebase Storage
    if (ad.filename) {
      try {
        await deleteFileFromStorage(ad.filename);
      } catch (firebaseError) {
        console.error(
          "Error deleting file from Firebase:",
          firebaseError.message
        );
        // Don't fail the whole API, just log error
      }
    }

    return res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error deleting ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting ad",
      error: error.message,
    });
  }
});
async function deleteFileFromStorage(filePath) {
  try {
    await bucket.file(filePath).delete();
    console.log("File deleted successfully");
  } catch (err) {
    throw new exception("File Delete failed");
  }
}
// API: List Ads Pending Review

router.get("/review/pending", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { device_id } = req.query;

    let query = `
      SELECT 
        a.id AS ad_id,
        a.title,
        a.description,
        a.media_url,
        a.media_type,
        ad.status,
        ad.device_id,
        ad.status_updated_at,
        d.name AS device_name,
        d.location AS device_location
      FROM ad_devices ad
      JOIN ads a ON ad.ad_id = a.id
      JOIN devices d ON ad.device_id = d.id
      WHERE a.client_id = $1
        AND ad.status = 'in_review'
    `;
    const params = [clientId];

    if (device_id) {
      query += ` AND ad.device_id = $2`;
      params.push(device_id);
    }

    query += ` ORDER BY a.created_at DESC, ad.start_date ASC`;

    const { rows } = await db.query(query, params);

    return res.status(200).json({
      success: true,
      message: "Pending review ads fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching pending review ads:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching pending ads",
      error: error.message,
    });
  }
});
// Approve Ad (per device)
router.patch(
  "/review/:adId/devices/:deviceId/approve",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { adId, deviceId } = req.params;

      const query = `
      UPDATE ad_devices ad
      SET status = 'active',
          status_updated_at = NOW()
      FROM ads a
      WHERE ad.ad_id = a.id
        AND ad.ad_id = $1
        AND ad.device_id = $2
        AND a.client_id = $3
        AND ad.status = 'in_review'
      RETURNING ad.ad_id, ad.device_id, ad.status, ad.status_updated_at
    `;
      const { rows } = await db.query(query, [adId, deviceId, clientId]);

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Ad not found for this device, not in review, or not authorized",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Ad approved successfully",
        data: rows[0],
      });
    } catch (error) {
      console.error("Error approving ad:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while approving ad",
        error: error.message,
      });
    }
  }
);

// Reject Ad (per device)
router.patch(
  "/review/:adId/devices/:deviceId/reject",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { adId, deviceId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        return res
          .status(400)
          .json({ success: false, message: "Rejection reason is required" });
      }

      const query = `
      UPDATE ad_devices ad
      SET status = 'Rejected',
          status_updated_at = NOW(),
          rejection_reason = $1
      FROM ads a
      WHERE ad.ad_id = a.id
        AND ad.ad_id = $2
        AND ad.device_id = $3
        AND a.client_id = $4
        AND ad.status = 'in_review'
      RETURNING ad.ad_id, ad.device_id, ad.status, ad.rejection_reason, ad.status_updated_at
    `;
      const { rows } = await db.query(query, [
        reason,
        adId,
        deviceId,
        clientId,
      ]);

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Ad not found for this device, not in review, or not authorized",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Ad rejected successfully",
        data: rows[0],
      });
    } catch (error) {
      console.error("Error rejecting ad:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while rejecting ad",
        error: error.message,
      });
    }
  }
);

// Pause Ad (per device)
router.patch(
  "/review/:adId/devices/:deviceId/pause",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { adId, deviceId } = req.params;

      const query = `
      UPDATE ad_devices ad
      SET status = 'Paused',
          status_updated_at = NOW()
      FROM ads a
      WHERE ad.ad_id = a.id
        AND ad.ad_id = $1
        AND ad.device_id = $2
        AND a.client_id = $3
      RETURNING ad.ad_id, ad.device_id, ad.status, ad.status_updated_at
    `;
      const { rows } = await db.query(query, [adId, deviceId, clientId]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Ad not found or not authorized for this device",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Ad paused successfully",
        data: rows[0],
      });
    } catch (error) {
      console.error("Error pausing ad:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while pausing ad",
        error: error.message,
      });
    }
  }
);

// Resume Ad (per device)
router.patch(
  "/review/:adId/devices/:deviceId/resume",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { adId, deviceId } = req.params;

      const query = `
      UPDATE ad_devices ad
      SET status = 'active',
          status_updated_at = NOW()
      FROM ads a
      WHERE ad.ad_id = a.id
        AND ad.ad_id = $1
        AND ad.device_id = $2
        AND a.client_id = $3
      RETURNING ad.ad_id, ad.device_id, ad.status, ad.status_updated_at`;
      const { rows } = await db.query(query, [adId, deviceId, clientId]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Ad not found or not authorized for this device",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Ad resumed successfully",
        data: rows[0],
      });
    } catch (error) {
      console.error("Error resuming ad:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while resuming ad",
        error: error.message,
      });
    }
  }
);

// in adminApis.js / advertiserApis.js (wherever you have emergency-ads route)
router.post(
  "/emergency-ads/create",

  // 1) require multipart/form-data
  (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("multipart/form-data")) {
      return res
        .status(400)
        .json({ error: "Content-Type must be multipart/form-data" });
    }
    next();
  },

  // 2) accept multiple files in `files` field (one device only)
  upload.array('files', 10),

  // 3) your auth middleware(s) (keep as-is)
  checkValidClient,
  auth,

  // 4) handler
  async (req, res) => {
    try {
      // helpful debug logs (remove later)
      console.log("=== /emergency-ads/create incoming ===");
      console.log("content-type:", req.headers["content-type"]);
      console.log("req.files keys:", req.files ? Object.keys(req.files) : null);
      console.log("req.body keys:", Object.keys(req.body || {}));
      // console.log("req.body raw:", req.body);

      // safety: req.body might be undefined (but multer should set it); use body = {}
      const body = req.body || {};

      const title = body.title;
      const media_type = body.media_type;
      const start_date = body.start_date;
      const end_date = body.end_date;
      const deviceId = body.device_id || body.device;

      // files uploaded as array
      const files = Array.isArray(req.files) ? req.files : [];

      // ---------- validations ----------
      if (!title) return res.status(400).json({ error: "title_required" });
      if (!media_type || !["image", "video"].includes(media_type))
        return res.status(400).json({ error: "invalid_media_type" });
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "files_required", detail: "At least one file must be uploaded in 'files' field" });
      }
      if (!start_date || !end_date)
        return res.status(400).json({ error: "start_and_end_dates_required" });
      if (!deviceId) return res.status(400).json({ error: "device_id_required" });

      // verify device belongs to client
      const devCheck = await db.query(`SELECT id FROM devices WHERE id = $1 AND client_id = $2 LIMIT 1`, [deviceId, req.client_id]);
      if (devCheck.rows.length === 0) return res.status(404).json({ error: 'device_not_found_or_unauthorized' });

      // ---------- upload each file to firebase and insert rows in a transaction ----------
      const uploadedResults = [];
      try {
        await db.query('BEGIN');

        for (const file of files) {
          const timestamp = Date.now();
          const safeOriginal = file.originalname.replace(/\s+/g, "_");
          const filename = `emergency_ads/${req.client_id}/${timestamp}_${safeOriginal}`;

          const fileUpload = bucket.file(filename);
          const uuid = uuidv4();
          const blobStream = fileUpload.createWriteStream({
            metadata: {
              contentType: file.mimetype,
              metadata: { firebaseStorageDownloadTokens: uuid },
            },
            resumable: false,
          });

          const uploadPromise = new Promise((resolve, reject) => {
            blobStream.on("error", (err) => reject(err));
            blobStream.on("finish", () => {
              const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${uuid}`;
              resolve({ url, filename });
            });
            blobStream.end(file.buffer);
          });

          let uploaded;
          try {
            uploaded = await uploadPromise;
          } catch (err) {
            throw new Error(`firebase_upload_failed: ${err.message || err}`);
          }

          // insert emergency_ad row
          const newAdId = uuidv4();
          const insertCompanyAd = `
            INSERT INTO emergency_ads (
              id, client_id, title, media_type, media_url, filename,
              start_date, end_date, status, status_updated_at, created_at
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pause',NOW(), NOW())
            RETURNING id
          `;
          const { rows: adRows } = await db.query(insertCompanyAd, [
            newAdId,
            req.client_id,
            title,
            media_type,
            uploaded.url,
            uploaded.filename,
            start_date,
            end_date,
          ]);

          const finalCompanyAdId = adRows.length ? adRows[0].id : newAdId;

          // insert mapping for single device
          const insertDeviceMapping = `
            INSERT INTO emergency_ad_devices
              (company_ad_id, device_id, start_date, end_date, status, status_updated_at)
            VALUES ($1,$2,$3,$4,'active',NOW())
          `;
          await db.query(insertDeviceMapping, [finalCompanyAdId, deviceId, start_date, end_date]);

          uploadedResults.push({ company_ad_id: finalCompanyAdId, media: uploaded });
        }

        await db.query('COMMIT');

        return res.status(201).json({ success: true, message: 'company_ads_created', created: uploadedResults });
      } catch (txErr) {
        console.error('DB tx error or upload error:', txErr);
        try { await db.query('ROLLBACK'); } catch (_) {}
        // best-effort cleanup of uploaded files
        for (const r of uploadedResults) {
          try { await bucket.file(r.media.filename).delete(); } catch (_) {}
        }
        return res.status(500).json({ error: 'database_or_upload_error', detail: txErr.message });
      }
    } catch (err) {
      console.error("Unexpected error in /emergency-ads/create:", err);
      return res
        .status(500)
        .json({ error: "server_error", detail: err.message });
    }
  }
);

// ----------------------
// POST /company-ads/upload
// Admin upload: insert simple record into company_ads table with client-scoped folder in Firebase
// Fields in DB: id, client_id, media_type, filename, media_url
// Accepts multipart/form-data with file + media_type and optional client_id (if admin passes a specific client)
// Requires checkValidClient + auth middleware
// ----------------------
router.post(
  "/company-ads/upload",

  // require multipart/form-data
  (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    }
    next();
  },

  upload.fields([{ name: "file", maxCount: 1 }]),
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      // pick uploaded file
      const file = (req.files && req.files.file && req.files.file[0]) || null;
      if (!file) return res.status(400).json({ error: "file_required" });

      // body parsing
      const body = req.body || {};
      const media_type = (body.media_type || "").toLowerCase().trim();

      if (!media_type || !["image", "video"].includes(media_type)) {
        return res.status(400).json({ error: "invalid_media_type", allowed: ["image", "video"] });
      }

      // client to upload for - allow client_id in body (admin can pass) otherwise use req.client_id
      const targetClientId = body.client_id || req.client_id;

      // validate target client exists
      const clientCheck = await db.query(`SELECT id FROM clients WHERE id = $1 LIMIT 1`, [targetClientId]);
      if (clientCheck.rows.length === 0) {
        return res.status(404).json({ error: "client_not_found" });
      }

      // upload to firebase under company_ads/<client_id>/
      const timestamp = Date.now();
      const safeOriginal = file.originalname.replace(/\s+/g, "_");
      const filename = `company_ads/${targetClientId}/${timestamp}_${safeOriginal}`;

      const fileUpload = bucket.file(filename);
      const uuid = uuidv4();
      const blobStream = fileUpload.createWriteStream({
        metadata: {
          contentType: file.mimetype,
          metadata: { firebaseStorageDownloadTokens: uuid },
        },
        resumable: false,
      });

      const uploadPromise = new Promise((resolve, reject) => {
        blobStream.on("error", (err) => reject(err));
        blobStream.on("finish", () => {
          const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${uuid}`;
          resolve({ url, filename });
        });
        blobStream.end(file.buffer);
      });

      let uploaded;
      try {
        uploaded = await uploadPromise;
      } catch (err) {
        console.error("Firebase upload error:", err);
        return res.status(500).json({ error: "file_upload_failed", detail: err.message });
      }

      // insert into company_ads
      // generate id here for clarity, though DB may have default gen_random_uuid()
      const newId = uuidv4();

      const insQ = `INSERT INTO company_ads (id, client_id, media_type, filename, media_url, file) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`;
      const insVals = [newId, targetClientId, media_type, uploaded.filename, uploaded.url, safeOriginal];
      const { rows: inserted } = await db.query(insQ, insVals);

      return res.status(201).json({ success: true, message: "company_ad_uploaded", company_ad: inserted[0] });
    } catch (err) {
      console.error("Error in /company-ads/upload:", err);
      return res.status(500).json({ error: "server_error", detail: err.message });
    }
  }
);

// ----------------------
// POST /staffs
// Create a staffs record, auto-generate an 8-char password, email the password
// ----------------------
router.post("/staff", checkValidClient, auth, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: "name_and_email_required" });

    // generate password and hash
    const plainPassword = generateStaffPassword();
    const hashed = await bcrypt.hash(plainPassword, 10);

    // default status active
    const status = true;

    // include client scoping: prefer to store per client
    const newId = uuidv4();
    const insertQ = `INSERT INTO staffs (id, client_id, username, password, status, created_at, email) VALUES ($1,$2,$3,$4,$5,NOW(),$6) RETURNING *`;
    const { rows } = await db.query(insertQ, [newId, req.client_id, name, hashed, status, email]);

    // send email with plain password
    try { await sendStaffEmail(email, email, plainPassword); } catch (e) { console.error('Failed to send staffs email', e); }

    const staffsRow = rows[0] || null;
    if (staffsRow) delete staffsRow.password; // do not expose password hash
    return res.status(201).json({ success: true, message: 'staffs_created', staff: staffsRow });
  } catch (err) {
    console.error('Error creating staffs:', err);
    return res.status(500).json({ error: 'create_failed', detail: err.message });
  }
});

// ----------------------
// DELETE /staffs/:id
// Delete a staffs record
// ----------------------
router.delete("/staff/:id", checkValidClient, auth, async (req, res) => {
  try {
    const { id } = req.params;
    const delQ = `DELETE FROM staffs WHERE id = $1 AND client_id = $2 RETURNING id, username, email`;
    const { rows } = await db.query(delQ, [id, req.client_id]);
    if (rows.length === 0) return res.status(404).json({ error: 'staffs_not_found' });
    return res.status(200).json({ success: true, message: 'staffs_deleted', staffs: rows[0] });
  } catch (err) {
    console.error('Error deleting staffs:', err);
    return res.status(500).json({ error: 'delete_failed', detail: err.message });
  }
});

// ----------------------
// PATCH /staffs/:id/enable
// PATCH /staffs/:id/disable
// Enable / Disable staffs by updating status
// ----------------------
router.patch("/staff/:id/enable", checkValidClient, auth, async (req, res) => {
  try {
    const { id } = req.params;
    const upd = `UPDATE staffs SET status=$3 WHERE id = $1 AND client_id = $2 RETURNING id, username, email, status`;
    const { rows } = await db.query(upd, [id, req.client_id, true]);
    if (rows.length === 0) return res.status(404).json({ error: 'staffs_not_found' });
    return res.json({ success: true, message: 'staffs_enabled', staffs: rows[0] });
  } catch (err) {
    console.error('Error enabling staffs:', err);
    return res.status(500).json({ error: 'enable_failed', detail: err.message });
  }
});

router.patch("/staff/:id/disable", checkValidClient, auth, async (req, res) => {
  try {
    const { id } = req.params;
    const upd = `UPDATE staffs SET status=$3 WHERE id = $1 AND client_id = $2 RETURNING id, username, email, status`;
    const { rows } = await db.query(upd, [id, req.client_id, false]);
    if (rows.length === 0) return res.status(404).json({ error: 'staffs_not_found' });
    return res.json({ success: true, message: 'staffs_disabled', staffs: rows[0] });
  } catch (err) {
    console.error('Error disabling staffs:', err);
    return res.status(500).json({ error: 'disable_failed', detail: err.message });
  }
});

// ----------------------
// GET /staffs
// Returns paginated, searchable staffs list for the client
// Query params: page, limit, search, status
// ----------------------
router.get("/staff", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : null;
    const status = req.query.status ? String(req.query.status).trim() : null;

    // Build dynamic where clause
    const params = [clientId];
    let where = `WHERE client_id = $1`;
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (username ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }

    // count
    const countQ = `SELECT COUNT(*)::int AS total FROM staffs ${where}`;
    const { rows: countRows } = await db.query(countQ, params);
    const total = countRows[0] ? Number(countRows[0].total) : 0;

    // fetch page
    const pageParams = params.concat([limit, offset]);
    const q = `SELECT id, username, email, status, created_at FROM staffs ${where} ORDER BY created_at DESC LIMIT $${pageParams.length-1} OFFSET $${pageParams.length}`;
    const { rows } = await db.query(q, pageParams);

    return res.status(200).json({
      success: true,
      message: 'staffs_list_fetched',
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: rows,
    });
  } catch (err) {
    console.error('Error fetching staffs list:', err);
    return res.status(500).json({ success: false, error: 'fetch_failed', detail: err.message });
  }
});

// ----------------------
// POST /staff/:id/send-password
// Generate a temporary password, set it for the staff (hashed), and email it to them.
// This is a recover/reset flow (we do NOT store or retrieve plain passwords).
// ----------------------
router.post('/staff/:id/send-password', checkValidClient, auth, async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.client_id;

    // verify staff exists for this client
    const staffQ = `SELECT id, email, username FROM staffs WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const { rows } = await db.query(staffQ, [id, clientId]);
    if (rows.length === 0) return res.status(404).json({ error: 'staff_not_found' });

    const staff = rows[0];

    // fetch all devices assigned to this staff
    const devicesQ = `
      SELECT d.id, d.name, d.location, d.activation_code
      FROM staffs_devices sd
      JOIN devices d ON sd.device_id = d.id
      WHERE sd.staff_id = $1 AND d.client_id = $2
      ORDER BY d.created_at ASC
    `;
    const { rows: devices } = await db.query(devicesQ, [id, clientId]);

    // generate temporary password
    const tempPassword = generateStaffPassword();
    const hashed = await bcrypt.hash(String(tempPassword), 10);

    // update DB with new hashed password
    const updQ = `UPDATE staffs SET password = $1 WHERE id = $2 AND client_id = $3 RETURNING id, username, email`;
    const { rows: updated } = await db.query(updQ, [hashed, id, clientId]);

    // send email with temporary password and device table
    try {
      await sendStaffEmail(staff.email, staff.email, tempPassword, devices);
    } catch (mailErr) {
      console.error('Failed to send password email:', mailErr);
      return res.status(500).json({ error: 'email_send_failed', detail: String(mailErr.message || mailErr) });
    }

    return res.status(200).json({ success: true, message: 'password_sent', staff: updated[0], assigned_devices_count: devices.length });
  } catch (err) {
    console.error('Error in send-password:', err);
    return res.status(500).json({ error: 'send_password_failed', detail: err.message });
  }
});
router.post("/staff/:id/devices", checkValidClient, auth, async (req, res) => {
    try {
      const staffId = req.params.id;
      const clientId = req.client_id;
      const { device_ids } = req.body;

      if (!Array.isArray(device_ids) || device_ids.length === 0) {
        return res.status(400).json({ error: "device_ids_required" });
      }

      // validate staff belongs to client
      const staffQ = `SELECT id FROM staffs WHERE id = $1 AND client_id = $2 LIMIT 1`;
      const staffRes = await db.query(staffQ, [staffId, clientId]);
      if (staffRes.rows.length === 0) return res.status(404).json({ error: 'staff_not_found' });

      // fetch devices and verify they belong to client
      const devicesQ = `SELECT id, is_assigned, assigned_to FROM devices WHERE id = ANY($1::uuid[]) AND client_id = $2`;
      const { rows: foundDevices } = await db.query(devicesQ, [device_ids, clientId]);

      const foundIds = new Set(foundDevices.map((d) => d.id));
      const missing = device_ids.filter((id) => !foundIds.has(id));
      if (missing.length > 0) return res.status(404).json({ error: 'devices_not_found', missing });

      // check for conflicting assignments
      const conflicts = foundDevices.filter((d) => d.assigned_to && d.assigned_to !== staffId);
      if (conflicts.length > 0) {
        return res.status(409).json({ error: 'device_assigned_elsewhere', devices: conflicts.map(c => c.id) });
      }

      // everything OK — perform inserts and updates in a transaction
      await db.query('BEGIN');
      try {
        const createdMappings = [];
        for (const deviceId of device_ids) {
          const mapId = uuidv4();
          // safe insert: avoid duplicate mappings if already exists
          const ins = `INSERT INTO staffs_devices (id, staff_id, device_id, created_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (device_id) DO NOTHING RETURNING *`;
          const { rows } = await db.query(ins, [mapId, staffId, deviceId]);
          if (rows && rows[0]) createdMappings.push(rows[0]);

          // update device flags (idempotent)
          await db.query(`UPDATE devices SET is_assigned = true, assigned_to = $1 WHERE id = $2 AND client_id = $3`, [staffId, deviceId, clientId]);
        }

        await db.query('COMMIT');
        return res.status(201).json({ success: true, message: 'devices_assigned', assigned: createdMappings });
      } catch (err) {
        await db.query('ROLLBACK');
        console.error('Error assigning devices to staff:', err);
        return res.status(500).json({ error: 'assign_failed', detail: err.message });
      }
    } catch (err) {
      console.error('Error in /staff/:id/devices POST:', err);
      return res.status(500).json({ error: 'server_error', detail: err.message });
    }
  });
// ----------------------
// GET /staff/:id/devices
// List devices assigned to a staff (paginated) — grouped near staff endpoints
// ----------------------
router.get("/staff/:id/devices", checkValidClient, auth, async (req, res) => {
  try {
    const staffId = req.params.id;
    const clientId = req.client_id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    // ensure staff belongs to client
    const staffQ = `SELECT id FROM staffs WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const staffRes = await db.query(staffQ, [staffId, clientId]);
    if (staffRes.rows.length === 0) return res.status(404).json({ error: 'staff_not_found' });

    // total count
    const countQ = `SELECT COUNT(*)::int as total FROM staffs_devices sd JOIN devices d ON sd.device_id = d.id WHERE sd.staff_id = $1 AND d.client_id = $2`;
    const { rows: countRows } = await db.query(countQ, [staffId, clientId]);
    const total = countRows[0] ? Number(countRows[0].total) : 0;

    // fetch page
    const q = `SELECT d.id, d.name, d.location, d.width, d.height, d.status, d.is_assigned, d.assigned_to, sd.created_at AS assigned_at
               FROM staffs_devices sd
               JOIN devices d ON sd.device_id = d.id
               WHERE sd.staff_id = $1 AND d.client_id = $2
               ORDER BY sd.created_at DESC
               LIMIT $3 OFFSET $4`;
    const { rows } = await db.query(q, [staffId, clientId, limit, offset]);

    return res.status(200).json({ success: true, message: 'staff_devices_fetched', pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }, data: rows });
  } catch (err) {
    console.error('Error in GET /staff/:id/devices:', err);
    return res.status(500).json({ error: 'fetch_failed', detail: err.message });
  }
});

// ----------------------
// DELETE /staff/:id/devices/:device_id
// Remove a device assignment from a staff (single device)
// ----------------------
router.delete('/staff/:id/devices/:device_id', checkValidClient, auth, async (req, res) => {
  try {
    const staffId = req.params.id;
    const deviceId = req.params.device_id;
    const clientId = req.client_id;

    // verify mapping exists and both staff & device belong to client
    const checkQ = `SELECT sd.id AS map_id FROM staffs_devices sd JOIN devices d ON sd.device_id = d.id WHERE sd.staff_id = $1 AND sd.device_id = $2 AND d.client_id = $3 LIMIT 1`;
    const { rows: checkRows } = await db.query(checkQ, [staffId, deviceId, clientId]);
    if (checkRows.length === 0) return res.status(404).json({ error: 'assignment_not_found' });

    await db.query('BEGIN');
    try {
      // delete mapping
      await db.query(`DELETE FROM staffs_devices WHERE staff_id = $1 AND device_id = $2`, [staffId, deviceId]);
      // clear device flags
      await db.query(`UPDATE devices SET is_assigned = false, assigned_to = NULL WHERE id = $1 AND client_id = $2`, [deviceId, clientId]);
      await db.query('COMMIT');
      return res.status(200).json({ success: true, message: 'device_unassigned', device_id: deviceId });
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Error unassigning device:', err);
      return res.status(500).json({ error: 'unassign_failed', detail: err.message });
    }
  } catch (err) {
    console.error('Error in DELETE /staff/:id/devices/:device_id:', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

router.get(
  "/check-account-status",
  checkValidClient,
  auth,
  async (req, res) => {
    const clientId = req.client_id;

    const checkClientStatus = `select id from clients where id = $1`;
    const result = await db.query(checkClientStatus, [clientId]);
    if (result.rowCount > 0) {
      const subscriptionQuery = `select subscription_status from clients where id = $1`;
      const subscriptionResult = await db.query(subscriptionQuery, [clientId]);
      if (subscriptionResult.rows[0]["subscription_status"] === "blocked"||subscriptionResult.rows[0]["subscription_status"] === "suspended") {
        return res.status(500).json({ message: "Account is "+subscriptionResult.rows[0]["subscription_status"] });
      }
      console.log(subscriptionResult.rows[0]["subscription_status"]);
    } else {
      return res.status(500).json({ message: "client not found" });
    }
    return res.status(200).json({ message: "Account is active" });
  }
);

// ===============================
// Delete Company Ad
// ===============================
router.delete("/emergency-ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // company_ad_id

    // Step 1: Check if the company ad exists
    const adCheck = await db.query(
      `SELECT id, filename 
       FROM emergency_ads 
       WHERE id = $1 AND client_id = $2 
       LIMIT 1`,
      [id, clientId]
    );

    if (adCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company ad not found or not authorized",
      });
    }

    const ad = adCheck.rows[0];

    // Step 2: Delete device mappings
    await db.query(`DELETE FROM emergency_ad_devices WHERE company_ad_id = $1`, [
      id,
    ]);

    // Step 3: Delete company ad row
    await db.query(`DELETE FROM emergency_ads WHERE id = $1 AND client_id = $2`, [
      id,
      clientId,
    ]);

    // Step 4: Delete file from Firebase (if exists)
    if (ad.filename) {
      try {
        const file = bucket.file(ad.filename);
        await file.delete();
        console.log("Deleted company ad file:", ad.filename);
      } catch (err) {
        console.error("Error deleting company ad file:", err.message);
        // Don't fail API if file deletion fails
      }
    }

    return res.status(200).json({
      success: true,
      message: "Company ad deleted successfully",
      deleted_id: id,
    });
  } catch (error) {
    console.error("Error deleting company ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting company ad",
      error: error.message,
    });
  }
});

// ----------------------
// POST /emergency-ads/:id/status
// Change status for a company ad (by owner) — allowed values: active, pause|paused
// Updates both emergency_ads.status and emergency_ad_devices.status in a transaction
// Uses same middleware as other company-ad operations
// ----------------------
router.post(
  "/emergency-ads/:id/status",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const userId = req.user_id;
      const { id } = req.params; // company_ad_id
      let { status } = req.body;

      if (!status) return res.status(400).json({ error: "status_required" });

      // normalize some common inputs
      status = String(status).toLowerCase().trim();
      if (status === "pause") status = "paused"; // allow 'pause' for backward compatibility

      if (!["active", "paused"].includes(status))
        return res.status(400).json({ error: "invalid_status", allowed: ["active", "paused"] });

      // Start transaction
      await db.query("BEGIN");

      // verify ownership and existence
      const adQ = `SELECT id, client_id, filename, start_date, end_date, status FROM emergency_ads WHERE id = $1 AND client_id = $2 LIMIT 1`;
      const adRes = await db.query(adQ, [id, clientId]);
      if (adRes.rows.length === 0) {
        await db.query("ROLLBACK");
        return res.status(404).json({ error: "company_ad_not_found_or_unauthorized" });
      }

      const ad = adRes.rows[0];

      // if trying to activate a company ad that's already expired
      if (status === "active" && new Date(ad.end_date) <= new Date()) {
        await db.query("ROLLBACK");
        return res.status(400).json({ error: "cannot_activate_expired" });
      }

      if (ad.status === status) {
        await db.query("ROLLBACK");
        return res.status(200).json({ success: true, message: "no_change", company_ad: ad });
      }

      // update emergency_ads row
      const updCompanyQ = `UPDATE emergency_ads SET status = $1, status_updated_at = NOW() WHERE id = $2 AND client_id = $3 RETURNING *`;
      const updCompany = await db.query(updCompanyQ, [status, id, clientId]);

      // update device mappings for this company ad
      // - if activating -> mark active for non-expired mappings
      // - if paused -> mark paused regardless of end_date
      let updDevicesQ;
      if (status === "active") {
        updDevicesQ = `UPDATE emergency_ad_devices SET status = 'active', status_updated_at = NOW() WHERE company_ad_id = $1 AND (end_date IS NULL OR end_date > NOW()) RETURNING *`;
      } else {
        updDevicesQ = `UPDATE emergency_ad_devices SET status = 'paused', status_updated_at = NOW() WHERE company_ad_id = $1 RETURNING *`;
      }

      const updDevicesRes = await db.query(updDevicesQ, [id]);

      await db.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "company_ad_status_updated",
        company_ad: updCompany.rows[0],
        devices: updDevicesRes.rows,
      });
    } catch (err) {
      try {
        await db.query("ROLLBACK");
      } catch (e) {}
      console.error("Error updating company ad status:", err);
      return res.status(500).json({ error: "update_failed", detail: err.message });
    }
  }
);

// ----------------------
// DELETE /company-ads/:id/file
// Remove the stored file reference from company_ads and delete the file from Firebase storage.
// Note: company_ads.filename/media_url are required fields in the schema; this endpoint clears them to empty strings.
// ----------------------
router.delete("/company-ads/:id/file", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // fetch company ad
    const q = `SELECT id, filename, media_url FROM company_ads WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const r = await db.query(q, [id, clientId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'company_ad_not_found_or_unauthorized' });

    const ad = r.rows[0];
    if (!ad.filename) return res.status(400).json({ error: 'no_file_attached' });

    // clear file references in DB (use empty strings since columns are expected not-null)
    await db.query('BEGIN');
    const updQ = `UPDATE company_ads SET filename = '', media_url = '' WHERE id = $1 AND client_id = $2 RETURNING *`;
    const upd = await db.query(updQ, [id, clientId]);
    await db.query('COMMIT');

    // attempt to delete file from Firebase storage — best-effort
    let storageDeleted = false;
    try {
      const file = bucket.file(ad.filename);
      await file.delete();
      await db.query('BEGIN');
      const updQ = `delete from company_ads WHERE id = $1 AND client_id = $2`;
      const upd = await db.query(updQ, [id, clientId]);
      await db.query('COMMIT');
      storageDeleted = true;
    } catch (e) {
      // if file not found, warn but still succeed
      if (e && e.code === 404) {
        console.warn('Firebase file not found:', ad.filename);
      } else {
        console.error('Error deleting file from firebase:', e && e.message ? e.message : e);
      }
    }
    return res.status(200).json({ success: true, message: 'company_ad_file_removed', company_ad: upd.rows[0], storageDeleted });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('Error removing company ad file:', err);
    return res.status(500).json({ error: 'remove_failed', detail: err.message });
  }
});

// ----------------------
// GET /company-ads
// Fetch list of company ads uploaded for this client (paginated + filters)
// Query params: page, limit, status, media_type
// ----------------------
router.get("/company-ads", checkValidClient, auth, async (req, res) => {
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
    const q = `SELECT id, client_id, media_type, filename, media_url, created_at, file
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
router.get("/my-status", checkValidClient, auth, async (req, res) => {
  const query = `select subscription_status from clients where id=$1`;
  try {
    const { rows } = await db.query(query, [req.client_id]);

    res.status(200).json({
      success: true,
      message: "Client status fetched successfully",
      clientStatus: rows[0].subscription_status,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching client status",
      error: error.message,
    });
  }
});
router.post("/use-wallet", checkValidClient, auth, async (req, res) => {
  try {
    const client_id = req.client_id;
    const { plan_id } = req.body;
    if (!plan_id)
      return res
        .status(400)
        .json({ success: false, message: "plan_id required" });

    // fetch plan
    const planRes = await db.query(
      `SELECT * FROM subscription_plans WHERE id=$1`,
      [plan_id]
    );
    if (planRes.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    const plan = planRes.rows[0];
    const newPlanPrice = Number(plan.amount || 0);

    // fetch active subscription to compute proration
    const activeSubRes = await db.query(
      `SELECT cs.*, sp.amount AS old_plan_amount, sp.period AS old_plan_period, sp.name AS old_plan_name
       FROM client_subscriptions cs
       LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
       WHERE cs.client_id=$1 AND cs.status='active'
       ORDER BY cs.current_period_end DESC
       LIMIT 1`,
      [client_id]
    );
    const existingSub = activeSubRes.rows[0] || null;

    // compute credit
    const now = new Date();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    let credit = 0;
    if (
      existingSub &&
      existingSub.current_period_end &&
      new Date(existingSub.current_period_end) > now
    ) {
      const endDate = new Date(existingSub.current_period_end);
      const startDate = existingSub.current_period_start
        ? new Date(existingSub.current_period_start)
        : null;
      let totalPeriodDays = (existingSub.old_plan_period || "")
        .toLowerCase()
        .startsWith("month")
        ? 28
        : Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) ||
          1;
      const remainingMs = endDate.getTime() - now.getTime();
      const days_remaining =
        remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_DAY) : 0;
      const oldPlanAmount = Number(existingSub.old_plan_amount || 0);
      const dailyRate = oldPlanAmount / totalPeriodDays;
      credit = Number(
        Math.min(dailyRate * days_remaining, oldPlanAmount).toFixed(2)
      );
    }

    let payable = Number((newPlanPrice - credit).toFixed(2));
    if (payable < 0) payable = 0;

    // fetch wallet balance
    const wallet = await getWalletBalance(client_id);
    const available = wallet.available || wallet.balance || 0;

    if (available < payable) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
        payable,
        available,
      });
    }

    // Debit wallet and create subscription in same atomic flow
    try {
      await db.query("BEGIN");
      // debit wallet
      const up = await upsertWallet(client_id, -Number(payable), {
        reference_type: "use_wallet",
        reference_id: null,
        description: `Wallet debit for switching to plan ${plan.name}`,
        idempotency_key: `use_wallet_${client_id}_${plan_id}_${Date.now()}`,
      });

      if (up.error) {
        await db.query("ROLLBACK");
        return res
          .status(400)
          .json({ success: false, message: "Insufficient funds" });
      }

      // create subscription row
      const startDate = new Date();
      const endDate = new Date();
      const period = (plan.period || "").toLowerCase();
      if (period.startsWith("week")) endDate.setDate(endDate.getDate() + 7);
      else if (period.startsWith("month"))
        endDate.setDate(endDate.getDate() + 28);
      else if (period.startsWith("quarter"))
        endDate.setMonth(endDate.getMonth() + 3);
      else if (period.startsWith("year"))
        endDate.setFullYear(endDate.getFullYear() + 1);
      else endDate.setDate(endDate.getDate() + 28);

      const ins = await db.query(
        `INSERT INTO client_subscriptions (client_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
        VALUES ($1,$2,'active',$3,$4,NOW(),NOW()) RETURNING *`,
        [client_id, plan_id, startDate, endDate]
      );

      // record a payments row marking wallet used
      const payIns = await db.query(
        `INSERT INTO payments (client_id, plan_id, amount, total_amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
        [
          client_id,
          plan_id,
          toPaise(payable),
          toPaise(payable),
          "PAID",
          `WALLET-${uuidv4()}`,
          `rcpt_wallet_${Date.now()}`,
          `wallet_${Date.now()}`,
          Number(payable),
        ]
      );

      await db.query("COMMIT");
      return res.json({
        success: true,
        subscription: ins.rows[0],
        wallet: { balance: up.balance_after },
      });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  } catch (err) {
    console.error("use-wallet error:", err);
    return res.status(500).json({
      success: false,
      message: "failed_use_wallet",
      detail: err.message,
    });
  }
});
function toPaise(amountRupee) {
  return Math.round(Number(amountRupee) * 100);
}
async function createWalletTransaction(txClient, payload) {
  const {
    client_id,
    tr_type,
    amount,
    balance_after,
    description = "",
    idempotency_key = null,
    reference_type = null,
    reference_id = null,
    created_by = null,
  } = payload;

  // If idempotency_key provided, try to return existing txn
  if (idempotency_key) {
    const checkQ = `SELECT * FROM wallet_transactions WHERE idempotency_key = $1 LIMIT 1`;
    const check = txClient
      ? await txClient.query(checkQ, [idempotency_key])
      : await db.query(checkQ, [idempotency_key]);
    if (check.rows.length) return check.rows[0];
  }

  const id = uuidv4();

  const insertQ = `
    INSERT INTO wallet_transactions
      (id, client_id, amount, tr_type, balance_after, description, reference_type, reference_id, idempotency_key, created_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    RETURNING *
  `;
  const vals = [
    id,
    client_id,
    amount,
    tr_type,
    balance_after,
    description,
    reference_type,
    reference_id,
    idempotency_key,
    created_by,
  ];

  const inserted = txClient
    ? await txClient.query(insertQ, vals)
    : await db.query(insertQ, vals);
  return inserted.rows[0];
}
async function getWalletBalance(client_id) {
  const r = await db.query(
    `SELECT balance FROM client_wallets WHERE client_id = $1 LIMIT 1`,
    [client_id]
  );
  const balance = r.rows.length ? Number(r.rows[0].balance) : 0.0;
  // For now we don't implement holds; held=0
  return { balance, held: 0.0, available: balance };
}

async function upsertWallet(client_id, delta_amount, options = {}) {
  try {
    await db.query("BEGIN");

    // ensure a wallet row exists; lock it
    let sel = await db.query(
      `SELECT id, balance FROM client_wallets WHERE client_id=$1 FOR UPDATE`,
      [client_id]
    );
    if (sel.rows.length === 0) {
      // create
      const wid = uuidV4();
      await db.query(
        `INSERT INTO client_wallets (id, client_id, balance, updated_at) VALUES ($1,$2,$3,NOW())`,
        [wid, client_id, 0.0]
      );
      sel = await db.query(
        `SELECT id, balance FROM client_wallets WHERE client_id=$1 FOR UPDATE`,
        [client_id]
      );
    }

    const current = sel.rows[0];
    const curAmount = Number(current.balance || 0);
    const newAmount = Number((curAmount + Number(delta_amount)).toFixed(2));

    // prevent negative balance
    if (newAmount < 0) {
      await db.query("ROLLBACK");
      return { error: "INSUFFICIENT_FUNDS", balance: curAmount };
    }

    // idempotency: if idempotency_key provided and txn exists, return it (no-op)
    if (options.idempotency_key) {
      const exist = await db.query(
        `SELECT * FROM wallet_transactions WHERE idempotency_key=$1 LIMIT 1`,
        [options.idempotency_key]
      );
      if (exist.rows.length) {
        await db.query("COMMIT");
        return {
          balance_after: exist.rows[0].balance_after,
          txn: exist.rows[0],
        };
      }
    }

    // update wallet
    await db.query(
      `UPDATE client_wallets SET balance=$1, updated_at=NOW() WHERE client_id=$2`,
      [newAmount, client_id]
    );

    // insert wallet transaction
    const tr_type = Number(delta_amount) >= 0 ? "credit" : "debit";
    const desc =
      options.description ||
      (tr_type === "credit" ? "Wallet credit" : "Wallet debit");

    const txn = await createWalletTransaction(db, {
      client_id,
      tr_type,
      amount: Math.abs(Number(delta_amount)),
      balance_after: newAmount,
      description: desc,
      idempotency_key: options.idempotency_key || null,
      reference_type: options.reference_type || null,
      reference_id: options.reference_id || null,
      created_by: options.created_by || null,
    });

    await db.query("COMMIT");
    return { balance_after: newAmount, txn };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

// router.js
router.get("/reports/ads", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;

    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE status = 'active') AS active_ads,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused_ads,
        COUNT(*) FILTER (WHERE status = 'in_review') AS in_review_ads,
        COUNT(*) FILTER (WHERE status = 'approved') AS approved_ads,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected_ads,
        COUNT(*) AS total_ads
      FROM ad_devices
      WHERE client_id = $1
    `;
    const { rows } = await db.query(query, [clientId]);

    return res.status(200).json({
      success: true,
      message: "Ad analytics fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching ad analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad analytics",
      error: error.message,
    });
  }
});
// adminApis.js
router.get("/recent-activity", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const query = `
      (
        SELECT 
          ad.ad_id AS entity_id,
          'ad' AS entity_type,
          'Ad ' || a.title || ' status changed to ' || ad.status AS description,
          ad.status_updated_at AS created_at,
          a.title,
          a.media_type,
          a.media_url,
          ad.status,
          ad.start_date,
          ad.end_date,
          ad.device_id,
          d.name AS device_name,
          d.location
        FROM ad_devices ad
        JOIN ads a ON a.id = ad.ad_id
        JOIN devices d ON d.id = ad.device_id
        WHERE a.client_id = $1
      )
      UNION ALL
      (
        SELECT 
          d.id AS entity_id,
          'device' AS entity_type,
          'Device ' || d.name || ' status: ' || d.status AS description,
          d.created_at,
          NULL, NULL, NULL, d.status, NULL, NULL, d.id, d.name, d.location
        FROM devices d
        WHERE d.client_id = $1
      )
      UNION ALL
      (
        SELECT 
          p.id AS entity_id,
          'payment' AS entity_type,
          'Payment of ₹' || p.amount || ' ' || p.status AS description,
          p.created_at,
          NULL, NULL, NULL, p.status, NULL, NULL, NULL, NULL, NULL
        FROM payments p
        WHERE p.client_id = $1
      )
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const { rows } = await db.query(query, [clientId]);
    return res.json({
      success: true,
      message: "Recent activity fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching recent activity",
      error: error.message,
    });
  }
});
// ===============================
// Get Company Ads by Device
// ===============================
router.get(
  "/emergency-ads/devices/:deviceId",
  checkValidClient, auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { deviceId } = req.params;

      // ✅ Step 1: Verify device belongs to this client
      const deviceCheck = await db.query(
        `SELECT id, name FROM devices WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [deviceId, clientId]
      );
      if (deviceCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Device not found or not authorized",
        });
      }

      // ✅ Step 2: Fetch company ads linked to this device
      const query = `
      SELECT 
        ca.id AS company_ad_id,
        ca.title,
        ca.media_type,
        ca.media_url,
        ca.filename,
        ca.start_date,
        ca.end_date,
        ca.status,
        ca.status_updated_at,
        cad.device_id,
        d.name AS device_name,
        d.location AS device_location,
        cad.status AS device_status
      FROM emergency_ads ca
      JOIN emergency_ad_devices cad ON cad.company_ad_id = ca.id
      JOIN devices d ON d.id = cad.device_id
      WHERE cad.device_id = $1 AND ca.client_id = $2
      ORDER BY ca.created_at DESC
    `;
      const { rows } = await db.query(query, [deviceId, clientId]);

      return res.status(200).json({
        success: true,
        message: "Emergency ads for device fetched successfully",
        data: rows,
      });
    } catch (error) {
      console.error("Error fetching company ads by device:", error);
      return res.status(500).json({
        success: false,
        message: "Something went wrong while fetching company ads",
        error: error.message,
      });
    }
  }
);

// DELETE /admin/emergency-ads/:id
router.delete("/emergency-ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // Step 1: Find the ad (for file cleanup)
    const findQuery = `
      SELECT id, filename
      FROM emergency_ads
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
    const { rows: adRows } = await db.query(findQuery, [id, clientId]);

    if (adRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company ad not found or not authorized",
      });
    }

    const ad = adRows[0];

    // Step 2: Delete mappings from emergency_ad_devices
    await db.query(`DELETE FROM emergency_ad_devices WHERE company_ad_id = $1`, [
      id,
    ]);

    // Step 3: Delete from emergency_ads
    const deleteQuery = `
      DELETE FROM emergency_ads
      WHERE id = $1 AND client_id = $2
      RETURNING id, title
    `;
    const { rows } = await db.query(deleteQuery, [id, clientId]);

    // Step 4: Delete file from Firebase
    if (ad.filename) {
      try {
        await bucket.file(ad.filename).delete();
      } catch (err) {
        console.error("Error deleting file from Firebase:", err.message);
        // Don't fail API if file deletion fails
      }
    }

    return res.status(200).json({
      success: true,
      message: "Company ad deleted successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error deleting company ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting company ad",
      error: error.message,
    });
  }
});

// API: Get Device Usage Report
router.get("/analytics/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;

    const query = `
  SELECT 
      d.id,
      d.name,
      d.location,
      d.status,
      COUNT(ad.id) AS total_ads
  FROM devices d
  LEFT JOIN ad_devices adv ON adv.device_id = d.id
  LEFT JOIN ads ad ON ad.id = adv.ad_id AND ad.client_id = $1
  WHERE d.client_id = $1
  GROUP BY d.id, d.name, d.location, d.status
  ORDER BY d.created_at DESC;
`;

    const { rows } = await db.query(query, [clientId]);

    return res.status(200).json({
      success: true,
      message: "Device usage report fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching device usage report:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching device usage report",
      error: error.message,
    });
  }
});
// ✅ Create Pricing Rule
router.post(
  "/create-pricing-rule",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const { id, media_type, duration_seconds, base_price } = req.body;
      const clientId = req.client_id;

      // Validation
      if (!id || !media_type || !base_price) {
        return res.status(400).json({
          success: false,
          message: "id, media_type, and price_per_day are required",
        });
      }
      let finalDuration;
      if (media_type == "image") {
        finalDuration =
          duration_seconds == undefined || duration_seconds == null
            ? 5
            : duration_seconds;
      } else {
        finalDuration =
          duration_seconds == undefined || duration_seconds == null
            ? 10
            : duration_seconds;
      }
      const select = `select * from pricing_rules where client_id=$1 and media_type=$2 and device_id=$3`;
      const { rows } = await db.query(select, [clientId, media_type, id]);
      if (rows.length > 0) {
        return res.status(200).json({
          success: false,
          message: "Pricing rule already exists for selected media type ",
        });
      }
      // Insert into DB
      const result = await db.query(
        `INSERT INTO pricing_rules (client_id, device_id, media_type, duration, price_per_day)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, device_id, media_type, duration, price_per_day, created_at`,
        [clientId, id, media_type, duration_seconds || null, base_price]
      );

      return res.status(201).json({
        success: true,
        message: "Pricing rule created successfully",
        pricing_rule: result.rows[0],
      });
    } catch (error) {
      console.error("Error creating pricing rule:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create pricing rule",
        error: error.message,
      });
    }
  }
);

// API 2: Update Pricing Rule
router.put(
  "/update-pricing-rule:id",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { base_price, media_type, duration_seconds, device_id } = req.body;
      const clientId = req.client_id;

      // Check if exists
      const checkRes = await db.query(
        `SELECT * FROM pricing_rules WHERE id = $1 AND client_id = $2`,
        [id, clientId]
      );
      if (checkRes.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "pricing rule not found",
        });
      }

      // Update
      const result = await db.query(
        `UPDATE pricing_rules
       SET price_per_day = COALESCE($1, price_per_day),
           media_type = COALESCE($2, media_type),
           duration = COALESCE($3, duration),
           device_id = COALESCE($4, device_id),updated_at = NOW()
       WHERE id = $5 AND client_id = $6
       RETURNING id, device_id, media_type, duration, price_per_day, created_at,updated_at`,
        [base_price, media_type, duration_seconds, device_id, id, clientId]
      );

      return res.json({
        success: true,
        message: "Pricing rule updated successfully",
        pricing_rule: result.rows[0],
      });
    } catch (error) {
      console.error("Error updating pricing rule:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update pricing rule",
        error: error.message,
      });
    }
  }
);
// API 3: Delete Pricing Rule
router.delete("/delete-pricing-rule:id", checkValidClient, async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.client_id;

    // Check if exists
    const checkRes = await db.query(
      `SELECT * FROM pricing_rules WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "pricing rule not found",
      });
    }

    // Delete
    await db.query(
      `DELETE FROM pricing_rules WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );

    return res.json({
      success: true,
      message: "Pricing rule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting pricing rule:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete pricing rule",
      error: error.message,
    });
  }
});
// API 4: List Pricing Rules
router.get("/get-pricing-rules", checkValidClient, async (req, res) => {
  try {
    const clientId = req.client_id;

    const result = await db.query(
      `SELECT 
         pr.id,
         pr.device_id,
         d.name AS device_name,
         d.location AS device_location,
         pr.media_type,
         pr.duration,
         pr.price_per_day,
         pr.created_at,
         pr.updated_at
       FROM pricing_rules pr
       JOIN devices d ON pr.device_id = d.id
       WHERE pr.client_id = $1
       ORDER BY d.name, pr.media_type, pr.duration NULLS FIRST`,
      [clientId]
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching pricing rules:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pricing rules",
      error: error.message,
    });
  }
});

// ----------------------
// Payments APIs (Client Admin)
// - Summary, recent transactions, payments by user
// ----------------------
router.get("/payments/summary", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const q = `
      SELECT
        COUNT(*)::int AS total_transactions,
        COALESCE(SUM(amount),0)::bigint AS total_amount_paise,
        COALESCE(SUM(CASE WHEN UPPER(status) = 'PAID' THEN amount ELSE 0 END),0)::bigint AS paid_amount_paise,
        COUNT(*) FILTER (WHERE UPPER(status) = 'PAID') AS paid_count,
        COUNT(*) FILTER (WHERE UPPER(status) IN ('FAILED','FAIL')) AS failed_count,
        COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN amount ELSE 0 END),0)::bigint AS today_amount_paise,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END),0)::bigint AS month_amount_paise
      FROM payments
      WHERE client_id = $1
    `;
    const { rows } = await db.query(q, [clientId]);
    const r = rows[0] || {};
    const toRupees = (v) => Number((Number(v || 0) / 100).toFixed(2));
    return res.status(200).json({
      success: true,
      data: {
        total_transactions: r.total_transactions || 0,
        total_amount_paise: Number(r.total_amount_paise || 0),
        total_amount: toRupees(r.total_amount_paise),
        paid_amount_paise: Number(r.paid_amount_paise || 0),
        paid_amount: toRupees(r.paid_amount_paise),
        paid_count: Number(r.paid_count || 0),
        failed_count: Number(r.failed_count || 0),
        today_amount_paise: Number(r.today_amount_paise || 0),
        today_amount: toRupees(r.today_amount_paise),
        month_amount_paise: Number(r.month_amount_paise || 0),
        month_amount: toRupees(r.month_amount_paise),
      },
    });
  } catch (err) {
    console.error('Error fetching payments summary:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_payments_summary', detail: err.message });
  }
});

router.get('/payments/recent', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const offset = (page - 1) * limit;
    const status = req.query.status ? String(req.query.status).trim().toUpperCase() : null;

    const params = [clientId];
    let where = 'WHERE client_id = $1';
    if (status) {
      params.push(status);
      where += ` AND UPPER(status) = UPPER($${params.length})`;
    }

    params.push(limit);
    params.push(offset);
    const q = `SELECT id, plan_id, amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at FROM payments ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const { rows } = await db.query(q, params);
    const mapped = rows.map((p) => ({
      id: p.id,
      plan_id: p.plan_id,
      amount_paise: Number(p.amount || 0),
      amount: Number(((Number(p.amount || 0) / 100) || 0).toFixed(2)),
      status: p.status,
      transaction_id: p.transaction_id,
      receipt: p.receipt,
      razorpay_order_id: p.razorpay_order_id,
      wallet_applied: Number(p.wallet_applied || 0),
      created_at: p.created_at,
    }));

    return res.status(200).json({ success: true, page, limit, data: mapped });
  } catch (err) {
    console.error('Error fetching recent payments:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_recent_payments', detail: err.message });
  }
});

// aggregated recent by user (top payers)
router.get('/payments/recent-by-user', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const q = `
      SELECT advertiser_id, COUNT(*)::int AS tx_count, COALESCE(SUM(amount),0)::bigint AS amount_paise
      FROM payments
      WHERE client_id = $1 AND advertiser_id IS NOT NULL
      GROUP BY advertiser_id
      ORDER BY amount_paise DESC
      LIMIT $2
    `;
    const { rows } = await db.query(q, [clientId, limit]);
    const mapped = rows.map((r) => ({
      advertiser_id: r.advertiser_id,
      tx_count: r.tx_count,
      amount_paise: Number(r.amount_paise || 0),
      amount: Number(((Number(r.amount_paise || 0) / 100) || 0).toFixed(2)),
    }));
    return res.status(200).json({ success: true, data: mapped });
  } catch (err) {
    console.error('Error fetching payments by user:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_payments_by_user', detail: err.message });
  }
});

// payments for a specific user (advertiser_id) scoped to client
router.get('/payments/user/:userId', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const userId = req.params.userId;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;

    const q = `SELECT id, plan_id, amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at FROM payments WHERE client_id=$1 AND created_by=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
    const { rows } = await db.query(q, [clientId, userId, limit, offset]);
    const mapped = rows.map((p) => ({
      id: p.id,
      plan_id: p.plan_id,
      amount_paise: Number(p.amount || 0),
      amount: Number(((Number(p.amount || 0) / 100) || 0).toFixed(2)),
      status: p.status,
      transaction_id: p.transaction_id,
      receipt: p.receipt,
      razorpay_order_id: p.razorpay_order_id,
      wallet_applied: Number(p.wallet_applied || 0),
      created_at: p.created_at,
    }));
    return res.status(200).json({ success: true, page, limit, data: mapped });
  } catch (err) {
    console.error('Error fetching payments for user:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_user_payments', detail: err.message });
  }
});

// ----------------------
// Wallet APIs (Client Admin)
// ----------------------

// GET /wallet/balance
router.get('/wallet/balance', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const q = `SELECT id, balance FROM client_wallets WHERE client_id = $1 LIMIT 1`;
    const { rows } = await db.query(q, [clientId]);
    const wallet = rows[0] || { id: null, balance: 0 };
    return res.status(200).json({
      success: true,
      data: {
        balance_paise: Number(wallet.balance || 0),
        balance: Number(((Number(wallet.balance || 0) / 100) || 0).toFixed(2)),
      },
    });
  } catch (err) {
    console.error('Error fetching wallet balance:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_wallet_balance', detail: err.message });
  }
});

// GET /wallet/transactions
router.get('/wallet/transactions', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = (page - 1) * limit;
    const tr_type = req.query.tr_type ? String(req.query.tr_type).trim() : null;

    const params = [clientId];
    let where = 'WHERE client_id = $1';
    if (tr_type) {
      params.push(tr_type);
      where += ` AND tr_type = $${params.length}`;
    }

    // count
    const countQ = `SELECT COUNT(*)::int AS total FROM wallet_transactions ${where}`;
    const { rows: countRows } = await db.query(countQ, params);
    const total = countRows[0]?.total || 0;

    params.push(limit);
    params.push(offset);
    const q = `SELECT id, amount, tr_type, balance_after, description, reference_type, reference_id, created_by, updated_at FROM wallet_transactions ${where} ORDER BY updated_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const { rows } = await db.query(q, params);
    const mapped = rows.map((t) => ({
      id: t.id,
      amount_paise: Number(t.amount || 0),
      amount: Number(((Number(t.amount || 0) / 100) || 0).toFixed(2)),
      tr_type: t.tr_type,
      balance_after_paise: Number(t.balance_after || 0),
      balance_after: Number(((Number(t.balance_after || 0) / 100) || 0).toFixed(2)),
      description: t.description,
      reference_type: t.reference_type,
      reference_id: t.reference_id,
      created_by: t.created_by,
      updated_at: t.updated_at,
    }));
    return res.status(200).json({ success: true, page, limit, total, totalPages: Math.ceil(total / limit), data: mapped });
  } catch (err) {
    console.error('Error fetching wallet transactions:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_wallet_transactions', detail: err.message });
  }
});

// GET /wallet/transactions/:id
router.get('/wallet/transactions/:id', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const txnId = req.params.id;
    const q = `SELECT id, amount, tr_type, balance_after, description, reference_type, reference_id, created_by, updated_at FROM wallet_transactions WHERE id = $1 AND client_id = $2 LIMIT 1`;
    const { rows } = await db.query(q, [txnId, clientId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'transaction_not_found' });
    }
    const t = rows[0];
    return res.status(200).json({
      success: true,
      data: {
        id: t.id,
        amount_paise: Number(t.amount || 0),
        amount: Number(((Number(t.amount || 0) / 100) || 0).toFixed(2)),
        tr_type: t.tr_type,
        balance_after_paise: Number(t.balance_after || 0),
        balance_after: Number(((Number(t.balance_after || 0) / 100) || 0).toFixed(2)),
        description: t.description,
        reference_type: t.reference_type,
        reference_id: t.reference_id,
        created_by: t.created_by,
        updated_at: t.updated_at,
      },
    });
  } catch (err) {
    console.error('Error fetching wallet transaction:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_wallet_transaction', detail: err.message });
  }
});

// ----------------------
// CSV Export APIs
// ----------------------

// GET /payments/export/csv
router.get('/payments/export/csv', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const status = req.query.status ? String(req.query.status).trim() : null;

    const params = [clientId];
    let where = 'WHERE client_id = $1';
    if (status) {
      params.push(status);
      where += ` AND UPPER(status) = UPPER($${params.length})`;
    }

    const q = `SELECT id, plan_id, amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at FROM payments ${where} ORDER BY created_at DESC`;
    const { rows } = await db.query(q, params);

    // Build CSV headers
    const headers = ['ID', 'Plan ID', 'Amount (Paise)', 'Amount (Rupees)', 'Status', 'Transaction ID', 'Receipt', 'Razorpay Order ID', 'Wallet Applied', 'Created At'];
    const csvRows = [headers.join(',')];

    // Add data rows
    rows.forEach((p) => {
      const row = [
        `"${p.id}"`,
        `"${p.plan_id || ''}"`,
        Number(p.amount || 0),
        Number(((Number(p.amount || 0) / 100) || 0).toFixed(2)),
        `"${p.status}"`,
        `"${p.transaction_id || ''}"`,
        `"${p.receipt || ''}"`,
        `"${p.razorpay_order_id || ''}"`,
        Number(p.wallet_applied || 0),
        `"${new Date(p.created_at).toISOString()}"`,
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments_${clientId}_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Error exporting payments CSV:', err);
    return res.status(500).json({ success: false, message: 'failed_export_payments_csv', detail: err.message });
  }
});

// GET /wallet/transactions/export/csv
router.get('/wallet/transactions/export/csv', checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const tr_type = req.query.tr_type ? String(req.query.tr_type).trim() : null;

    const params = [clientId];
    let where = 'WHERE client_id = $1';
    if (tr_type) {
      params.push(tr_type);
      where += ` AND tr_type = $${params.length}`;
    }

    const q = `SELECT id, amount, tr_type, balance_after, description, reference_type, reference_id, created_by, updated_at FROM wallet_transactions ${where} ORDER BY updated_at DESC`;
    const { rows } = await db.query(q, params);

    // Build CSV headers
    const headers = ['ID', 'Amount (Paise)', 'Amount (Rupees)', 'Type', 'Balance After (Paise)', 'Balance After (Rupees)', 'Description', 'Reference Type', 'Reference ID', 'Created By', 'Updated At'];
    const csvRows = [headers.join(',')];

    // Add data rows
    rows.forEach((t) => {
      const row = [
        `"${t.id}"`,
        Number(t.amount || 0),
        Number(((Number(t.amount || 0) / 100) || 0).toFixed(2)),
        `"${t.tr_type}"`,
        Number(t.balance_after || 0),
        Number(((Number(t.balance_after || 0) / 100) || 0).toFixed(2)),
        `"${(t.description || '').replace(/"/g, '""')}"`,
        `"${t.reference_type || ''}"`,
        `"${t.reference_id || ''}"`,
        `"${t.created_by || ''}"`,
        `"${new Date(t.updated_at).toISOString()}"`,
      ];
      csvRows.push(row.join(','));
    });

    const csv = csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="wallet_transactions_${clientId}_${Date.now()}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error('Error exporting wallet transactions CSV:', err);
    return res.status(500).json({ success: false, message: 'failed_export_wallet_csv', detail: err.message });
  }
});

module.exports = router;

function generateActivationCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}


