const {
  express,
  upload,       // multer memory-storage ready
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
  auth
} = require("./deps");
const bucket = admin.storage().bucket();
// router.js (or a separate advertiser.routes.js if you want to keep clean)
const router = express.Router();


const checkValidClient = require("./middleware/checkValidClient");


// Admin Login
router.post("/login", checkValidClient, async (req, res) => {
  console.log("DASDASD");
  
  try {
    const { email, password } = req.body;
    const clientId = req.client_id; // from checkValidClient middleware

    if (!email || !password) {
      return res.status(200).json({
        success: false,
        message: "Email and password are required"
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
        message: "Invalid credentials or not an admin"
      });
    }

    const admin = rows[0];

    // Step 2: Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(200).json({
        success: false,
        message: "Invalid credentials"
      });
    }
    const tokenPayload = {
      userId: admin.id,
      clientId: admin.client_id,
      role: admin.role,
      email:admin.email
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
        role: admin.role
      }
    });
  } catch (error) {
    console.error("Error in admin login:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong during login.",
      error: error.message
    });
  }
});
router.get("/getWalletBalance",checkValidClient,auth,async(req,res)=>{
  const query= `select balance, updated_at from client_wallets where client_id = $1`
  try{
    const {rows} = await db.query(query,[req.client_id])
    if(rows.length>0){
     return res.json({
      success: true,
      message: "Wallet balance fetched successfully.",
      data: rows[0],
    });
  }else{
    return res.json({
      success: true,
      message: "Wallet balance fetched successfully.",
      data: {balance:0,update_at: `${new Date().toLocaleDateString() +","+new Date().toLocaleTimeString()}`},
    });
  }
  }catch(e){
    console.log(e);
    
    res.status(500).json({ success: false, message: "Failed to fetch wallet balance", detail: err.message });
  }
})
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
        message: "Admin profile not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Admin profile fetched successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error fetching admin profile:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching profile",
      error: error.message
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
        message: "At least one field (name or email) must be provided"
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
        message: "Admin profile not found or not authorized"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error updating admin profile:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile",
      error: error.message
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
        message: "Both old_password and new_password are required"
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
        message: "Admin not found"
      });
    }

    const admin = rows[0];

    // Step 2: Check old password
    const validPassword = await bcrypt.compare(old_password, admin.password_hash);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Old password is incorrect"
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
      data: updated.rows[0]
    });
  } catch (error) {
    console.error("Error changing admin password:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while changing password",
      error: error.message
    });
  }
});

// router.js
router.post("/logout", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user_id;      
    const clientId = req.client_id;  
    const token = req.token;          // from auth middleware

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
        message: "Admin not found or already logged out"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Error logging out admin:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while logging out",
      error: error.message
    });
  }
});

// Device Management APIs (List, Add, Update, Delete, etc.).
// API: List Devices
router.get("/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;  

    const query = `
      SELECT id, name, location, width, height, status, created_at
      FROM devices
      WHERE client_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await db.query(query, [clientId]);

    return res.status(200).json({
      success: true,
      message: "Devices fetched successfully",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching devices",
      error: error.message
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
        message: "Device not found"
      });
    }
    return res.status(200).json({
      success: true,
      message: "Device details fetched successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error fetching device details:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching device details",
      error: error.message
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
      return res.status(400).json({ success: false, message: "name, location, width, height required" });
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
      return res.status(403).json({ success: false, message: "No active subscription" });
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
      INSERT INTO devices (client_id, name, location, width, height, status)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `;
    const values = [clientId, name, location, width, height, status || 'active'];
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
        message: "At least one field must be provided for update"
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
    const values = [device_name || null, location || null, width || null, height || null, status || null, id, clientId];

    const { rows } = await db.query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Device updated successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error updating device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating device",
      error: error.message
    });
  }
});


// API: Delete Device
router.delete("/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      DELETE FROM devices
      WHERE id = $1 AND client_id = $2
      RETURNING id, name, location
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found or already deleted"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Device deleted successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error deleting device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting device",
      error: error.message
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
        message: "Device not found"
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
      data: rows
    });
  } catch (error) {
    console.error("Error fetching ads by device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ads",
      error: error.message
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
        message: "Ad not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad details fetched successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error fetching ad details:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad details",
      error: error.message
    });
  }
});
router.post("/ads",checkValidClient, auth, async (req, res) => {
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

// API: Delete Ad

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
        message: "Ad not found"
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
        console.error("Error deleting file from Firebase:", firebaseError.message);
        // Don't fail the whole API, just log error
      }
    }

    return res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error deleting ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting ad",
      error: error.message
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
      data: rows
    });
  } catch (error) {
    console.error("Error fetching pending review ads:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching pending ads",
      error: error.message
    });
  }
});
// Approve Ad (per device)
router.patch("/review/:adId/devices/:deviceId/approve", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { adId, deviceId } = req.params;

    const query = `
      UPDATE ad_devices ad
      SET status = 'Active',
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
        message: "Ad not found for this device, not in review, or not authorized"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad approved successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error approving ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while approving ad",
      error: error.message
    });
  }
});


// Reject Ad (per device)
router.patch("/review/:adId/devices/:deviceId/reject", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { adId, deviceId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: "Rejection reason is required" });
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
    const { rows } = await db.query(query, [reason, adId, deviceId, clientId]);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Ad not found for this device, not in review, or not authorized"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad rejected successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error rejecting ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while rejecting ad",
      error: error.message
    });
  }
});


// Pause Ad (per device)
router.patch("/review/:adId/devices/:deviceId/pause", checkValidClient, auth, async (req, res) => {
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
        message: "Ad not found or not authorized for this device"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ad paused successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error pausing ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while pausing ad",
      error: error.message
    });
  }
});


// Resume Ad (per device)
router.patch("/review/:adId/devices/:deviceId/resume", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { adId, deviceId } = req.params;

    const query = `
      UPDATE ad_devices ad
      SET status = 'Active',
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
        message: "Ad not found or not authorized for this device"
      });
    }
    return res.status(200).json({
      success: true,
      message: "Ad resumed successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error resuming ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while resuming ad",
      error: error.message
    });
  }
});


// in adminApis.js / advertiserApis.js (wherever you have company-ads route)
router.post(
  "/company-ads/create",

  // 1) require multipart/form-data
  (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    if (!ct.includes("multipart/form-data")) {
      return res.status(400).json({ error: "Content-Type must be multipart/form-data" });
    }
    next();
  },

  // 2) accept any file field (we'll pick "file" if present). fields() allows files + fields parsing.
  upload.fields([{ name: "file", maxCount: 1 }]),

  // 3) your auth middleware(s) (keep as-is)
  checkValidClient,
  auth,

  // 4) handler
  async (req, res) => {
    try {
      // helpful debug logs (remove later)
      console.log("=== /company-ads/create incoming ===");
      console.log("content-type:", req.headers["content-type"]);
      console.log("req.files keys:", req.files ? Object.keys(req.files) : null);
      console.log("req.body keys:", Object.keys(req.body || {}));
      // console.log("req.body raw:", req.body);

      // pick uploaded file robustly
      const file =
        (req.files && req.files.file && req.files.file[0]) ||
        (req.file ? req.file : null);

      // safety: req.body might be undefined (but multer should set it); use body = {}
      const body = req.body || {};

      const title = body.title;
      const media_type = body.media_type;
      const start_date = body.start_date;
      const end_date = body.end_date;
      const companyAdId = body.companyAdId;

      // ------- parse selected_devices in multiple possible formats -------
      let selected_devices = [];

      // 1) JSON string in field: selected_devices = '["id1","id2"]'
      if (body.selected_devices) {
        if (Array.isArray(body.selected_devices)) {
          // unlikely for stringified array, but handle it
          selected_devices = body.selected_devices.flatMap((v) => {
            if (typeof v === "string") {
              try {
                return JSON.parse(v);
              } catch {
                return v.split(",").map((s) => s.trim()).filter(Boolean);
              }
            }
            return [v];
          });
        } else {
          // single string
          try {
            selected_devices = JSON.parse(body.selected_devices);
            if (!Array.isArray(selected_devices)) {
              // if parsed to single value, normalize
              selected_devices = [String(selected_devices)];
            }
          } catch (e) {
            // fallback: comma-separated string "id1,id2"
            selected_devices = String(body.selected_devices)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
      } else if (body["selected_devices[]"]) {
        // repeated fields: selected_devices[]=id1 & selected_devices[]=id2
        selected_devices = Array.isArray(body["selected_devices[]"])
          ? body["selected_devices[]"]
          : [body["selected_devices[]"]];
      } else {
        // maybe client sent multiple fields named selected_devices each separately
        // multer would give a single joined string for same keys in many setups; keep fallback
        selected_devices = [];
      }

      // ---------- validations ----------
      if (!title) return res.status(400).json({ error: "title_required" });
      if (!media_type || !["image", "video"].includes(media_type))
        return res.status(400).json({ error: "invalid_media_type" });
      if (!file) {
        // return helpful debug to client so you can see what arrived
        return res.status(400).json({
          error: "file_required",
          debug: {
            files: req.files ? Object.keys(req.files) : null,
            bodyKeys: Object.keys(body),
          },
        });
      }
      if (!start_date || !end_date)
        return res.status(400).json({ error: "start_and_end_dates_required" });
      if (!selected_devices || selected_devices.length === 0)
        return res.status(400).json({ error: "select_at_least_one_device" });

      // ---------- upload to firebase (same as your logic) ----------
      const timestamp = Date.now();
      const safeOriginal = file.originalname.replace(/\s+/g, "_");
      const filename = `company_ads/${req.client_id}/${timestamp}_${safeOriginal}`;

      const fileUpload = bucket.file(filename);
      const uuid = uuidv4();
      const blobStream = fileUpload.createWriteStream({
        metadata: { contentType: file.mimetype, metadata: { firebaseStorageDownloadTokens: uuid } },
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
        return res.status(500).json({ error: "file_upload_failed" });
      }

      // ---------- insert into company_ads + company_ad_devices in a transaction ----------
      try {
        await db.query("BEGIN");

        const compAdId = companyAdId || uuidv4();
        const insertCompanyAd = `
          INSERT INTO company_ads (
            id, client_id, title, media_type, media_url, filename,
            start_date, end_date, status, status_updated_at, created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        const { rows: adRows } = await db.query(insertCompanyAd, [
          compAdId,
          req.client_id,
          title,
          media_type,
          uploaded.url,
          uploaded.filename,
          start_date,
          end_date,
        ]);
        const finalCompanyAdId = adRows.length ? adRows[0].id : compAdId;

        const insertDeviceMapping = `
          INSERT INTO company_ad_devices
            (company_ad_id, device_id, start_date, end_date, status, status_updated_at)
          VALUES ($1,$2,$3,$4,'active',NOW())
        `;
        for (const device of selected_devices) {
          await db.query(insertDeviceMapping, [
            finalCompanyAdId,
            device,
            start_date,
            end_date,
          ]);
        }

        await db.query("COMMIT");

        return res.status(201).json({
          success: true,
          message: "Company ad created successfully",
          company_ad_id: finalCompanyAdId,
          devices: selected_devices,
          media: uploaded,
        });
      } catch (txErr) {
        console.error("DB tx error:", txErr);
        try { await db.query("ROLLBACK"); } catch(_) {}
        // delete firebase file
        try { await bucket.file(uploaded.filename).delete(); } catch(_) {}
        return res.status(500).json({ error: "database_error", detail: txErr.message });
      }
    } catch (err) {
      console.error("Unexpected error in /company-ads/create:", err);
      return res.status(500).json({ error: "server_error", detail: err.message });
    }
  }
);
// ===============================
// Delete Company Ad
// ===============================
router.delete("/company-ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // company_ad_id

    // Step 1: Check if the company ad exists
    const adCheck = await db.query(
      `SELECT id, filename 
       FROM company_ads 
       WHERE id = $1 AND client_id = $2 
       LIMIT 1`,
      [id, clientId]
    );

    if (adCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company ad not found or not authorized"
      });
    }

    const ad = adCheck.rows[0];

    // Step 2: Delete device mappings
    await db.query(`DELETE FROM company_ad_devices WHERE company_ad_id = $1`, [id]);

    // Step 3: Delete company ad row
    await db.query(`DELETE FROM company_ads WHERE id = $1 AND client_id = $2`, [id, clientId]);

    // Step 4: Delete file from Firebase (if exists)
    if (ad.filename) {
      try {
        const file = bucket.file(ad.filename);
        await file.delete();
        console.log("Deleted company ad file:", ad.filename);
      } catch (err) {
        if (err.code === 404) {
          console.warn("File not found in Firebase:", ad.filename);
        } else {
          console.error("Error deleting company ad file:", err.message);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Company ad deleted successfully",
      deleted_id: id
    });
  } catch (error) {
    console.error("Error deleting company ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting company ad",
      error: error.message
    });
  }
});
router.post("/use-wallet", checkValidClient, auth, async (req, res) => {
  try {
    const client_id = req.client_id;
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ success: false, message: "plan_id required" });

    // fetch plan
    const planRes = await db.query(`SELECT * FROM subscription_plans WHERE id=$1`, [plan_id]);
    if (planRes.rows.length === 0) return res.status(404).json({ success: false, message: "Plan not found" });
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
    const MS_PER_DAY = 1000*60*60*24;
    let credit = 0;
    if (existingSub && existingSub.current_period_end && new Date(existingSub.current_period_end) > now) {
      const endDate = new Date(existingSub.current_period_end);
      const startDate = existingSub.current_period_start ? new Date(existingSub.current_period_start) : null;
      let totalPeriodDays = (existingSub.old_plan_period||'').toLowerCase().startsWith('month') ? 28 : Math.ceil((endDate.getTime()-startDate.getTime())/MS_PER_DAY) || 1;
      const remainingMs = endDate.getTime() - now.getTime();
      const days_remaining = remainingMs>0 ? Math.ceil(remainingMs/MS_PER_DAY) : 0;
      const oldPlanAmount = Number(existingSub.old_plan_amount || 0);
      const dailyRate = oldPlanAmount / totalPeriodDays;
      credit = Number(Math.min(dailyRate * days_remaining, oldPlanAmount).toFixed(2));
    }

    let payable = Number((newPlanPrice - credit).toFixed(2));
    if (payable < 0) payable = 0;

    // fetch wallet balance
    const wallet = await getWalletBalance(client_id);
    const available = wallet.available || wallet.balance || 0;

    if (available < payable) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance", payable, available });
    }

    // Debit wallet and create subscription in same atomic flow
    try {
      await db.query('BEGIN');
      // debit wallet
      const up = await upsertWallet(client_id, -Number(payable), {
        reference_type: 'use_wallet',
        reference_id: null,
        description: `Wallet debit for switching to plan ${plan.name}`,
        idempotency_key: `use_wallet_${client_id}_${plan_id}_${Date.now()}`
      });

      if (up.error) {
        await db.query('ROLLBACK');
        return res.status(400).json({ success: false, message: "Insufficient funds" });
      }

      // create subscription row
      const startDate = new Date();
      const endDate = new Date();
      const period = (plan.period || "").toLowerCase();
      if (period.startsWith("week")) endDate.setDate(endDate.getDate() + 7);
      else if (period.startsWith("month")) endDate.setDate(endDate.getDate() + 28);
      else if (period.startsWith("quarter")) endDate.setMonth(endDate.getMonth() + 3);
      else if (period.startsWith("year")) endDate.setFullYear(endDate.getFullYear() + 1);
      else endDate.setDate(endDate.getDate() + 28);

      const ins = await db.query(`INSERT INTO client_subscriptions (client_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
        VALUES ($1,$2,'active',$3,$4,NOW(),NOW()) RETURNING *`, [client_id, plan_id, startDate, endDate]);

      // record a payments row marking wallet used
      const payIns = await db.query(`INSERT INTO payments (client_id, plan_id, amount, total_amount, status, transaction_id, receipt, razorpay_order_id, wallet_applied, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`, [
          client_id,
          plan_id,
          toPaise(payable),
          toPaise(payable),
          'PAID',
          `WALLET-${uuidv4()}`,
          `rcpt_wallet_${Date.now()}`,
          `wallet_${Date.now()}`,
          Number(payable)
      ]);

      await db.query('COMMIT');
      return res.json({ success: true, subscription: ins.rows[0], wallet: { balance: up.balance_after } });
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }   

  } catch (err) {
    console.error("use-wallet error:", err);
    return res.status(500).json({ success: false, message: "failed_use_wallet", detail: err.message });
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
    const check = txClient ? await txClient.query(checkQ, [idempotency_key]) : await db.query(checkQ, [idempotency_key]);
    if (check.rows.length) return check.rows[0];
  }

  const id = uuidv4();

  const insertQ = `
    INSERT INTO wallet_transactions
      (id, client_id, amount, tr_type, balance_after, description, reference_type, reference_id, idempotency_key, created_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    RETURNING *
  `;
  const vals = [id, client_id, amount, tr_type, balance_after, description, reference_type, reference_id, idempotency_key, created_by];

  const inserted = txClient ? await txClient.query(insertQ, vals) : await db.query(insertQ, vals);
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
    let sel = await db.query(`SELECT id, balance FROM client_wallets WHERE client_id=$1 FOR UPDATE`, [client_id]);
    if (sel.rows.length === 0) {
      // create
      const wid = uuidV4();
      await db.query(`INSERT INTO client_wallets (id, client_id, balance, updated_at) VALUES ($1,$2,$3,NOW())`, [wid, client_id, 0.0]);
      sel = await db.query(`SELECT id, balance FROM client_wallets WHERE client_id=$1 FOR UPDATE`, [client_id]);
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
        return { balance_after: exist.rows[0].balance_after, txn: exist.rows[0] };
      }
    }

    // update wallet
    await db.query(`UPDATE client_wallets SET balance=$1, updated_at=NOW() WHERE client_id=$2`, [newAmount, client_id]);

    // insert wallet transaction
    const tr_type = Number(delta_amount) >= 0 ? "credit" : "debit";
    const desc = options.description || (tr_type === "credit" ? "Wallet credit" : "Wallet debit");

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
      data: rows[0]
    });
  } catch (error) {
    console.error("Error fetching ad analytics:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ad analytics",
      error: error.message
    });
  }
});
// adminApis.js

// adminApis.js

// adminApis.js
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
      data: rows
    });
  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching recent activity",
      error: error.message
    });
  }
});
// ===============================
// Get Company Ads by Device
// ===============================
router.get("/company-ads/devices/:deviceId", checkValidClient, auth, async (req, res) => {
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
        message: "Device not found or not authorized"
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
      FROM company_ads ca
      JOIN company_ad_devices cad ON cad.company_ad_id = ca.id
      JOIN devices d ON d.id = cad.device_id
      WHERE cad.device_id = $1 AND ca.client_id = $2
      ORDER BY ca.created_at DESC
    `;
    const { rows } = await db.query(query, [deviceId, clientId]);

    return res.status(200).json({
      success: true,
      message: "Company ads for device fetched successfully",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching company ads by device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching company ads",
      error: error.message
    });
  }
});

// DELETE /admin/company-ads/:id
router.delete("/company-ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // Step 1: Find the ad (for file cleanup)
    const findQuery = `
      SELECT id, filename
      FROM company_ads
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

    // Step 2: Delete mappings from company_ad_devices
    await db.query(`DELETE FROM company_ad_devices WHERE company_ad_id = $1`, [id]);

    // Step 3: Delete from company_ads
    const deleteQuery = `
      DELETE FROM company_ads
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
      SELECT d.id, d.name, d.location, d.status,
             COUNT(a.id) AS total_ads
      FROM devices d
      LEFT JOIN ads a ON d.id = a.id AND a.client_id = $1
      WHERE d.client_id = $1
      GROUP BY d.id, d.name, d.location, d.status
      ORDER BY d.created_at DESC
    `;
    const { rows } = await db.query(query, [clientId]);

    return res.status(200).json({
      success: true,
      message: "Device usage report fetched successfully",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching device usage report:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching device usage report",
      error: error.message
    });
  }
});
// ✅ Create Pricing Rule
router.post("/create-pricing-rule", checkValidClient,auth, async (req, res) => {
  try {
    const { id, media_type, duration_seconds, base_price } = req.body;
    const clientId = req.client_id;

    // Validation
    if (!id || !media_type || !base_price) {
      return res.status(400).json({
        success: false,
        message: "id, media_type, and price_per_day are required"
      });
    }
    let finalDuration;
    if(media_type=="image"){
      finalDuration = (duration_seconds==undefined||duration_seconds==null)?5:duration_seconds
    }else{
      finalDuration = (duration_seconds==undefined||duration_seconds==null)?10:duration_seconds
    }
    const select =`select * from pricing_rules where client_id=$1 and media_type=$2`;
    const {rows} = await db.query(select,[clientId,media_type])
    if(rows.length>0){
     return res.status(200).json({
      success: false,
      message: "Pricing rule already exists for selected media type ",
    })
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
      pricing_rule: result.rows[0]
    });
  } catch (error) {
    console.error("Error creating pricing rule:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create pricing rule",
      error: error.message
    });
  }
});

// API 2: Update Pricing Rule
router.put("/update-pricing-rule:id", checkValidClient,auth, async (req, res) => {
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
        message: "pricing rule not found"
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
      pricing_rule: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating pricing rule:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update pricing rule",
      error: error.message
    });
  }
});
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
        message: "pricing rule not found"
      });
    }

    // Delete
    await db.query(`DELETE FROM pricing_rules WHERE id = $1 AND client_id = $2`, [
      id,
      clientId
    ]);

    return res.json({
      success: true,
      message: "Pricing rule deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting pricing rule:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete pricing rule",
      error: error.message
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
      data: result.rows
    });
  } catch (error) {
    console.error("Error fetching pricing rules:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pricing rules",
      error: error.message
    });
  }
});



module.exports=router
