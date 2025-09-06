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

// ----------------------
// GET /ads/my
// ----------------------
router.get("/ads/my", checkValidClient, auth, async (req, res) => {
  try {
    const userId =  req.user.id; // set in auth middleware
    const clientId = req.client_id; // set in checkValidClient middleware
    const { status } = req.query;

    // Base query
    let query = `
      SELECT id, title, description, status, media_type, media_url, start_time, end_time, created_at
      FROM ads
      WHERE user_id = $1 AND client_id = $2
    `;
    const params = [userId, clientId];

    // Optional filter by status
    if (status) {
      query += ` AND status = $3`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: status
          ? `No ads found with status '${status}'.`
          : "No ads found.",
        data: [],
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ads fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("Error fetching ads:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ads.",
      error: error.message, // advertiser can see actual error
    });
  }
});

// router.js
router.get("/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { id } = req.params;

    const query = `
      SELECT id, title, description, status, media_type, media_url, 
             start_time, end_time, created_at
      FROM ads
      WHERE id = $1 AND user_id = $2 AND client_id = $3
      LIMIT 1
    `;
    const params = [id, userId, clientId];
    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
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
      message: "Something went wrong while fetching ad details.",
      error: error.message,
    });
  }
});
// router.js
router.delete("/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { id } = req.params;

    // Step 1: Check if ad exists and belongs to this user & client
    const checkQuery = `
      SELECT id, status 
      FROM ads
      WHERE id = $1 AND user_id = $2 AND client_id = $3
      LIMIT 1
    `;
    const { rows } = await db.query(checkQuery, [id, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
      });
    }

    const ad = rows[0];

    // Step 2: Validate status
    if (ad.status !== "in_review" && ad.status !== "rejected") {
      return res.status(400).json({
        success: false,
        message: `Ad cannot be deleted because it is currently '${ad.status}'. Only 'in_review' or 'rejected' ads can be deleted.`,
      });
    }

    // Step 3: Delete the ad
    await db.query("DELETE FROM ads WHERE id = $1", [id]);

    return res.status(200).json({
      success: true,
      message: "Ad deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting ad:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while deleting ad.",
      error: error.message,
    });
  }
});
// router.js
router.put("/ads/:id", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { id } = req.params;
    const { title, description, start_time, end_time, media_url, media_type } = req.body;

    // Step 1: Check if ad exists & belongs to this user & client
    const checkQuery = `
      SELECT id, status 
      FROM ads
      WHERE id = $1 AND user_id = $2 AND client_id = $3
      LIMIT 1
    `;
    const { rows } = await db.query(checkQuery, [id, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
      });
    }

    const ad = rows[0];

    // Step 2: Validate status
    if (ad.status !== "in_review" && ad.status !== "rejected") {
      return res.status(400).json({
        success: false,
        message: `Ad cannot be updated because it is currently '${ad.status}'. Only 'in_review' or 'rejected' ads can be updated.`,
      });
    }

    // Step 3: Update query
    const updateQuery = `
      UPDATE ads
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          start_time = COALESCE($3, start_time),
          end_time = COALESCE($4, end_time),
          media_url = COALESCE($5, media_url),
          media_type = COALESCE($6, media_type),
          status_updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `;
    const updateParams = [title, description, start_time, end_time, media_url, media_type, id];

    const updatedAd = await db.query(updateQuery, updateParams);

    return res.status(200).json({
      success: true,
      message: "Ad updated successfully",
      data: updatedAd.rows[0],
    });
  } catch (error) {
    console.error("Error updating ad:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating ad.",
      error: error.message,
    });
  }
});
// router.js
router.patch("/ads/:id/pause", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { id } = req.params;

    // Step 1: Check ad ownership
    const checkQuery = `
      SELECT id, status 
      FROM ads
      WHERE id = $1 AND user_id = $2 AND client_id = $3
      LIMIT 1
    `;
    const { rows } = await db.query(checkQuery, [id, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
      });
    }

    const ad = rows[0];

    // Step 2: Only allow pause if status = approved or active
    if (ad.status !== "approved" && ad.status !== "active") {
      return res.status(400).json({
        success: false,
        message: `Ad cannot be paused because it is currently '${ad.status}'. Only 'approved' or 'active' ads can be paused.`,
      });
    }

    // Step 3: Update status to paused
    const updateQuery = `
      UPDATE ads
      SET status = 'paused', status_updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const updatedAd = await db.query(updateQuery, [id]);

    return res.status(200).json({
      success: true,
      message: "Ad paused successfully",
      data: updatedAd.rows[0],
    });
  } catch (error) {
    console.error("Error pausing ad:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while pausing ad.",
      error: error.message,
    });
  }
});
// router.js
router.patch("/ads/:id/resume", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { id } = req.params;

    // Step 1: Check ad ownership
    const checkQuery = `
      SELECT id, status 
      FROM ads
      WHERE id = $1 AND user_id = $2 AND client_id = $3
      LIMIT 1
    `;
    const { rows } = await db.query(checkQuery, [id, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
      });
    }

    const ad = rows[0];

    // Step 2: Validate status
    if (ad.status !== "paused") {
      return res.status(400).json({
        success: false,
        message: `Ad cannot be resumed because it is currently '${ad.status}'. Only 'paused' ads can be resumed.`,
      });
    }

    // Step 3: Update status to active
    const updateQuery = `
      UPDATE ads
      SET status = 'active', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;
    const updatedAd = await db.query(updateQuery, [id]);

    return res.status(200).json({
      success: true,
      message: "Ad resumed successfully",
      data: updatedAd.rows[0],
    });
  } catch (error) {
    console.error("Error resuming ad:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while resuming ad.",
      error: error.message,
    });
  }
});

// router.js
router.get("/profile", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware

    const query = `
      SELECT id, name, email, role, client_id, created_at
      FROM users
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;

    const { rows } = await db.query(query, [userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error fetching profile:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching profile.",
      error: error.message,
    });
  }
});
// router.js
router.put("/profile", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      // from auth middleware
    const clientId = req.client_id;  // from checkValidClient middleware
    const { name, email } = req.body;

    if (!name && !email) {
      return res.status(400).json({
        success: false,
        message: "At least one field (name or email) must be provided for update",
      });
    }

    const updateQuery = `
      UPDATE users
      SET name = COALESCE($1, name),
          email = COALESCE($2, email)
      WHERE id = $3 AND client_id = $4
      RETURNING id, name, email, role, client_id, created_at
    `;
    const values = [name || null, email || null, userId, clientId];

    const { rows } = await db.query(updateQuery, values);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Profile not found or you don't have access",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("Error updating profile:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while updating profile.",
      error: error.message,
    });
  }
});
import bcrypt from "bcrypt";  // make sure bcrypt is installed

// router.js
router.patch("/profile/change-password", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      
    const clientId = req.client_id;  
    const { old_password, new_password } = req.body;

    if (!old_password || !new_password) {
      return res.status(400).json({
        success: false,
        message: "Both old_password and new_password are required"
      });
    }

    // Step 1: Get user
    const userQuery = `
      SELECT id, password 
      FROM users
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
    const { rows } = await db.query(userQuery, [userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or you don't have access"
      });
    }

    const user = rows[0];

    // Step 2: Check old password
    const validPassword = await bcrypt.compare(old_password, user.password);
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
    const updatedUser = await db.query(updateQuery, [hashedPassword, userId]);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
      data: updatedUser.rows[0]
    });

  } catch (error) {
    console.error("Error changing password:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while changing password.",
      error: error.message,
    });
  }
});
// router.js
router.post("/logout", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user.id;      
    const clientId = req.client_id;  
    const token = req.token;          // from auth middleware

    // Remove this token from user's tokens
    const query = `
      UPDATE users
      SET tokens = array_remove(tokens, $1)
      WHERE id = $2 AND client_id = $3
      RETURNING id, email
    `;
    const { rows } = await db.query(query, [token, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or already logged out",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully"
    });
  } catch (error) {
    console.error("Error logging out:", error);

    return res.status(500).json({
      success: false,
      message: "Something went wrong while logging out.",
      error: error.message,
    });
  }
});


// API 1: Get Pricing Rules for Device
router.get("/:deviceId", checkValidClient, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const clientId = req.client_id; // comes from middleware

    const result = await db.query(
      `SELECT id, media_type, duration_seconds, base_price
       FROM pricing
       WHERE client_id = $1 AND device_id = $2
       ORDER BY media_type, duration_seconds NULLS FIRST`,
      [clientId, deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No pricing rules found for this device"
      });
    }

    return res.json({
      success: true,
      deviceId,
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
// API 2: Calculate Price
router.post("/calculate-price", checkValidClient, async (req, res) => {
  try {
    const { device_id, media_type, duration_seconds, start_date, end_date } = req.body;
    const clientId = req.client_id;

    if (!device_id || !media_type || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "device_id, media_type, start_date, and end_date are required"
      });
    }

    // Calculate number of days
    const start = new Date(start_date);
    const end = new Date(end_date);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid date range"
      });
    }

    // Get base price
    const query = `
      SELECT base_price FROM pricing
      WHERE client_id = $1 AND device_id = $2 AND media_type = $3
      AND (duration_seconds = $4 OR ($4 IS NULL AND duration_seconds IS NULL))
      LIMIT 1
    `;
    const values = [clientId, device_id, media_type, duration_seconds || null];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No pricing rule found for given media type and duration"
      });
    }

    const basePrice = parseFloat(result.rows[0].base_price);

    // Price calculation
    const subtotal = basePrice * days;
    const gst = +(subtotal * 0.18).toFixed(2); // 18% GST
    const handling = +(subtotal * 0.05).toFixed(2); // 5% handling fee
    const total = +(subtotal + gst + handling).toFixed(2);

    return res.json({
      success: true,
      breakdown: {
        days,
        base_price_per_day: basePrice,
        subtotal,
        gst,
        handling,
        total
      }
    });
  } catch (error) {
    console.error("Error calculating price:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate price",
      error: error.message
    });
  }
});
// API 3: Create Payment Intent

router.post("/create", checkValidClient, async (req, res) => {
  try {
    const { ad_id, total_amount } = req.body;
    const clientId = req.client_id;
    const advertiserId = req.user.id; // from auth middleware

    if (!ad_id || !total_amount) {
      return res.status(400).json({
        success: false,
        message: "ad_id and total_amount are required"
      });
    }

    // Generate mock transaction id
    const transactionId = "TXN-" + uuidv4();

    // Insert into payments table
    const result = await db.query(
      `INSERT INTO payments 
       (ad_id, advertiser_id, client_id, amount, total_amount, status, transaction_id)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING id, status, transaction_id`,
      [ad_id, advertiserId, clientId, total_amount, total_amount, transactionId]
    );

    return res.json({
      success: true,
      message: "Payment intent created",
      payment: result.rows[0],
      gateway_details: {
        transaction_id: transactionId,
        payable_amount: total_amount,
        mock_gateway_url: `https://mockpay.com/checkout/${transactionId}`
      }
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment intent",
      error: error.message
    });
  }
});
// API 4: Verify Payment
router.post("/verify", checkValidClient, async (req, res) => {
  try {
    const { transaction_id, status } = req.body;
    const advertiserId = req.user.id; // from auth middleware

    if (!transaction_id || !status) {
      return res.status(400).json({
        success: false,
        message: "transaction_id and status are required"
      });
    }

    // Find payment
    const paymentRes = await db.query(
      `SELECT * FROM payments WHERE transaction_id = $1 AND advertiser_id = $2`,
      [transaction_id, advertiserId]
    );

    if (paymentRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Payment not found"
      });
    }

    const payment = paymentRes.rows[0];

    // Update payment status
    await db.query(
      `UPDATE payments SET status = $1 WHERE id = $2`,
      [status, payment.id]
    );

    // If success → mark ad as in_review
    if (status === "success") {
      await db.query(
        `UPDATE ads SET status = 'in_review', status_updated_at = NOW() WHERE id = $1`,
        [payment.ad_id]
      );
    }

    return res.json({
      success: true,
      message: `Payment ${status}`,
      transaction_id,
      ad_id: payment.ad_id,
      new_ad_status: status === "success" ? "in_review" : "pending_payment"
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message
    });
  }
});

// API 5: Get My Payment
router.get("/my", checkValidClient, async (req, res) => {
  try {
    const advertiserId = req.user.id;
    const clientId = req.client_id;

    const result = await db.query(
      `SELECT p.id, p.transaction_id, p.amount, p.gst, p.handling_fee, 
              p.total_amount, p.status, p.created_at,
              a.title AS ad_title, a.status AS ad_status
       FROM payments p
       JOIN ads a ON p.ad_id = a.id
       WHERE p.advertiser_id = $1 AND p.client_id = $2
       ORDER BY p.created_at DESC`,
      [advertiserId, clientId]
    );

    return res.json({
      success: true,
      payments: result.rows
    });
  } catch (error) {
    console.error("Error fetching advertiser payments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message
    });
  }
});

module.exports=router
