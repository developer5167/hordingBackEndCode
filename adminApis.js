const express = require("./express_file");
const path = require("path");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const multer = require("multer");
const jwtToken = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const auth = require("./middleware/auth");
const checkValidClient = require("./middleware/checkValidClient");
const checkDomainAndReturnClientId = require("./middleware/checkDomainAndReturnClientId");

const timers = {};
const { admin, fcm } = require("./firebaseAdmin");
const { secureHeapUsed } = require("crypto");
const { log } = require("console");
const e = require("cors");
const { request } = require("http");

const upload = multer({ storage: multer.memoryStorage() });
const bucket = admin.storage().bucket();
// router.js (or a separate advertiser.routes.js if you want to keep clean)
const express = require("express");
const router = express.Router();
const db = require("./db");
const auth = require("./auth"); // your JWT + token check
const checkValidClient = require("./checkValidClient");




// Admin Login
router.post("/admin/login", checkValidClient, async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientId = req.client_id; // from checkValidClient middleware

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Step 1: Find admin
    const query = `
      SELECT id, name, email, password, role, tokens
      FROM users
      WHERE email = $1 AND client_id = $2 AND role = 'admin'
      LIMIT 1
    `;
    const { rows } = await db.query(query, [email, clientId]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials or not an admin"
      });
    }

    const admin = rows[0];

    // Step 2: Verify password
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials"
      });
    }
     const token = jwtToken.sign({ email }, "THISISTESTAPPFORHORDING");
    // Step 3: Generate JWT
    

    // Step 4: Store token
    const updateTokens = `
      UPDATE users
      SET tokens = array_append(tokens, $1)
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

// router.js
router.get("/admin/profile", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user.id;      
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
router.put("/admin/profile", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user.id;      
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
router.patch("/admin/change-password", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user.id;      
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
      SELECT id, password 
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
    const validPassword = await bcrypt.compare(old_password, admin.password);
    if (!validPassword) {
      return res.status(401).json({
        success: false,
        message: "Old password is incorrect"
      });
    }

    // Step 3: Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Step 4: Update password
    const updateQuery = `
      UPDATE users
      SET password = $1
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
router.post("/admin/logout", checkValidClient, auth, async (req, res) => {
  try {
    const adminId = req.user.id;      
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
router.get("/admin/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;  

    const query = `
      SELECT id, device_name, location, width, height, status, created_at
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
router.get("/admin/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;
    const query = `
      SELECT id, device_name, location, width, height, status, created_at
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
router.post("/admin/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { device_name, location, width, height, status } = req.body;

    if (!device_name || !location || !width || !height) {
      return res.status(400).json({
        success: false,
        message: "device_name, location, width, and height are required"
      });
    }

    const query = `
      INSERT INTO devices (client_id, device_name, location, width, height, status)
      VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'active'))
      RETURNING id, device_name, location, width, height, status, created_at
    `;
    const values = [clientId, device_name, location, width, height, status || null];

    const { rows } = await db.query(query, values);

    return res.status(201).json({
      success: true,
      message: "Device added successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error adding device:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while adding device",
      error: error.message
    });
  }
});


// API: Update Device
router.put("/admin/devices/:id", checkValidClient, auth, async (req, res) => {
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
      SET device_name = COALESCE($1, device_name),
          location = COALESCE($2, location),
          width = COALESCE($3, width),
          height = COALESCE($4, height),
          status = COALESCE($5, status)
      WHERE id = $6 AND client_id = $7
      RETURNING id, device_name, location, width, height, status, created_at
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
router.delete("/admin/devices/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      DELETE FROM devices
      WHERE id = $1 AND client_id = $2
      RETURNING id, device_name, location
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
router.get("/admin/devices/:id/ads", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // device id

    // Step 1: Ensure device belongs to client
    const deviceCheck = await db.query(
      `SELECT id FROM devices WHERE id = $1 AND client_id = $2 LIMIT 1`,
      [id, clientId]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Device not found"
      });
    }

    // Step 2: Fetch ads for this device
    const query = `
      SELECT id, title, description, media_type, media_url, fileName,
             status, start_date, end_date, created_at
      FROM ads
      WHERE device_id = $1 AND client_id = $2
      ORDER BY created_at DESC
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
router.get("/admin/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params; // ad id

    const query = `
      SELECT a.id, a.title, a.description, a.media_type, a.media_url, a."fileName",
             a.status, a.start_date, a.end_date, a.status_updated_at,
             d.device_name, d.location, d.width, d.height
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
// API: Pause Ad
router.patch("/admin/ads/:id/pause", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      UPDATE ads
      SET status = 'paused',
          status_updated_at = NOW()
      WHERE id = $1 AND client_id = $2
      RETURNING id, title, status, status_updated_at
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or not authorized"
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


//API: Resume Ad
// router.js
router.patch("/admin/ads/:id/resume", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      UPDATE ads
      SET status = 'active',
          status_updated_at = NOW()
      WHERE id = $1 AND client_id = $2
      RETURNING id, title, status, status_updated_at
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or not authorized"
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

// API: Delete Ad

import { deleteFileFromFirebase } from "./firebaseHelper.js"; 
// make sure you have a helper function to delete files from Firebase
router.delete("/admin/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    // Step 1: Find ad to get fileName
    const findQuery = `
      SELECT id, title, "fileName"
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
    const { rows } = await db.query(deleteQuery, [id, clientId]);

    // Step 3: Delete file from Firebase Storage
    if (ad.fileName) {
      try {
        await deleteFileFromFirebase(ad.fileName);
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

// API: List Ads Pending Review

router.get("/admin/review/pending", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { device_id } = req.query;

    let query = `
      SELECT a.id, a.title, a.description, a.media_type, a.media_url, a."fileName",
             a.start_date, a.end_date, a.status, a.created_at,
             d.device_name, d.location
      FROM ads a
      JOIN devices d ON a.device_id = d.id
      WHERE a.client_id = $1 AND a.status = 'in_review'
    `;
    let params = [clientId];

    if (device_id) {
      query += ` AND a.device_id = $2`;
      params.push(device_id);
    }

    query += ` ORDER BY a.created_at DESC`;

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

// API: Approve Ad
router.patch("/admin/review/:id/approve", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      UPDATE ads
      SET status = 'approved',
          status_updated_at = NOW()
      WHERE id = $1 AND client_id = $2 AND status = 'in_review'
      RETURNING id, title, status, status_updated_at
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Ad not found, not in review, or not authorized"
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

// API: Reject Ad
router.patch("/admin/review/:id/reject", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required"
      });
    }

    const query = `
      UPDATE ads
      SET status = 'rejected',
          status_updated_at = NOW(),
          rejection_reason = $1
      WHERE id = $2 AND client_id = $3 AND status = 'in_review'
      RETURNING id, title, status, rejection_reason, status_updated_at
    `;
    const { rows } = await db.query(query, [reason, id, clientId]);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Ad not found, not in review, or not authorized"
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

// Emergency / Company Ads
// API: Play Company Ad

// router.js
router.post("/admin/company-ads/play", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { title, media_type, media_url, fileName, device_ids, start_date, end_date } = req.body;

    if (!title || !media_type || !device_ids || device_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "title, media_type, and at least one device_id are required"
      });
    }

    // Insert company ad for each device
    const query = `
      INSERT INTO ads (title, media_type, media_url, "fileName", client_id, device_id, 
                       start_date, end_date, status, status_updated_at, company_ad)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW(), true)
      RETURNING id, title, media_type, device_id, status
    `;

    let results = [];
    for (const deviceId of device_ids) {
      const { rows } = await db.query(query, [
        title,
        media_type,
        media_url || null,
        fileName || null,
        clientId,
        deviceId,
        start_date || new Date(),
        end_date || null
      ]);
      results.push(rows[0]);
    }

    return res.status(201).json({
      success: true,
      message: "Company ad(s) started successfully",
      data: results
    });
  } catch (error) {
    console.error("Error playing company ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while starting company ad",
      error: error.message
    });
  }
});

// Stop Company Ad
router.patch("/admin/company-ads/:id/stop", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;
    const { id } = req.params;

    const query = `
      UPDATE ads
      SET status = 'stopped',
          status_updated_at = NOW()
      WHERE id = $1 AND client_id = $2 AND company_ad = true
      RETURNING id, title, status, status_updated_at
    `;
    const { rows } = await db.query(query, [id, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Company ad not found or already stopped"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Company ad stopped successfully",
      data: rows[0]
    });
  } catch (error) {
    console.error("Error stopping company ad:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while stopping company ad",
      error: error.message
    });
  }
});

// Reports & Analytics APIs
// API: Get Ad Analytics

// router.js
router.get("/admin/reports/ads", checkValidClient, auth, async (req, res) => {
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
      FROM ads
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

// API: Get Device Usage Report
router.get("/admin/analytics/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;

    const query = `
      SELECT d.id, d.device_name, d.location, d.status,
             COUNT(a.id) AS total_ads
      FROM devices d
      LEFT JOIN ads a ON d.id = a.device_id AND a.client_id = $1
      WHERE d.client_id = $1
      GROUP BY d.id, d.device_name, d.location, d.status
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
// Admin Pricing APIs
// ✅ Create Pricing Rule
router.post("/", checkValidClient, async (req, res) => {
  try {
    const { device_id, media_type, duration_seconds, base_price } = req.body;
    const clientId = req.clientId;

    // Validation
    if (!device_id || !media_type || !base_price) {
      return res.status(400).json({
        success: false,
        message: "device_id, media_type, and base_price are required"
      });
    }

    // Insert into DB
    const result = await db.query(
      `INSERT INTO pricing (client_id, device_id, media_type, duration_seconds, base_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, device_id, media_type, duration_seconds, base_price, created_at`,
      [clientId, device_id, media_type, duration_seconds || null, base_price]
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
router.put("/:id", checkValidClient, async (req, res) => {
  try {
    const { id } = req.params;
    const { base_price, media_type, duration_seconds, device_id } = req.body;
    const clientId = req.client_id;

    // Check if exists
    const checkRes = await db.query(
      `SELECT * FROM pricing WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pricing rule not found"
      });
    }

    // Update
    const result = await db.query(
      `UPDATE pricing
       SET base_price = COALESCE($1, base_price),
           media_type = COALESCE($2, media_type),
           duration_seconds = COALESCE($3, duration_seconds),
           device_id = COALESCE($4, device_id)
       WHERE id = $5 AND client_id = $6
       RETURNING id, device_id, media_type, duration_seconds, base_price, created_at`,
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
router.delete("/:id", checkValidClient, async (req, res) => {
  try {
    const { id } = req.params;
    const clientId = req.client_id;

    // Check if exists
    const checkRes = await db.query(
      `SELECT * FROM pricing WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pricing rule not found"
      });
    }

    // Delete
    await db.query(`DELETE FROM pricing WHERE id = $1 AND client_id = $2`, [
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
router.get("/", checkValidClient, async (req, res) => {
  try {
    const clientId = req.client_id  ;

    const result = await db.query(
      `SELECT id, device_id, media_type, duration_seconds, base_price, created_at
       FROM pricing
       WHERE client_id = $1
       ORDER BY device_id, media_type, duration_seconds NULLS FIRST`,
      [clientId]
    );

    return res.json({
      success: true,
      pricing_rules: result.rows
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
