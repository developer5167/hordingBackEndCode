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
const router = express.Router()

const checkValidClient = require("./middleware/checkValidClient");
// ----------------------
// GET /ads/my
// ----------------------
router.get("/ads/my", checkValidClient, auth, async (req, res) => {
  try {
    const userId =  req.user_id; // set in auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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
    const userId = req.user_id;      // from auth middleware
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

// router.js
router.patch("/profile/change-password", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;      
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
    const userId = req.user_id;      
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
    const advertiserId = req.user_id; // from auth middleware

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
    const advertiserId = req.user_id; // from auth middleware

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
    const advertiserId = req.user_id;
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
// advertiserDashboardApi.js


/**
 * GET /advertiser/dashboard
 * Returns dashboard summary for the logged-in advertiser.
 *
 * Expected response:
 * {
 *   "total_ads": 12,
 *   "active_ads": 6,
 *   "in_review": 2,
 *   "expired": 3,
 *   "total_plays": 1240,
 *   "total_watch_time_seconds": 452300
 * }
 */
// advertiserDashboardApi.js

/**
 * GET /advertiser/dashboard
 * Returns dashboard summary for the logged-in advertiser.
 */
router.get("/dashboard", auth, async (req, res) => {
  try {
    // assume auth middleware sets req.user_id (advertiser user id)
    const userId = req.user && (req.user_id || req.user.user_id || req.user.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // 1) Counts for ads
    const countsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE true)                             AS total_ads,
        COUNT(*) FILTER (WHERE status = 'active')                AS active_ads,
        COUNT(*) FILTER (WHERE status = 'in_review')             AS in_review,
        COUNT(*) FILTER (WHERE status = 'expired' OR end_date < NOW()) AS expired
      FROM ads
      WHERE user_id = $1
    `;
    const countsRes = await db.query(countsQuery, [userId]);
    const counts = countsRes.rows[0] || {
      total_ads: 0,
      active_ads: 0,
      in_review: 0,
      expired: 0
    };

    // 2) Determine if ad_statistics table exists
    // to_regclass returns null if the table doesn't exist
    const tableCheck = await db.query(
      `SELECT to_regclass('public.ad_statistics') as reg`
    );

    let totalPlays = 0;
    let totalWatchTime = 0;

    if (tableCheck.rows[0] && tableCheck.rows[0].reg) {
      // table exists -> compute aggregates
      const statsQuery = `
        SELECT
          COALESCE(SUM(sub.play_count), 0) AS total_plays,
          COALESCE(SUM(sub.duration_played), 0) AS total_watch_time_seconds
        FROM (
          SELECT ad_statistics.ad_id,
                 COUNT(ad_statistics.id) AS play_count,
                 SUM(COALESCE(ad_statistics.duration_played, 0)) AS duration_played
          FROM ad_statistics
          INNER JOIN ads ON ads.id = ad_statistics.ad_id
          WHERE ads.user_id = $1
          GROUP BY ad_statistics.ad_id
        ) sub
      `;
      const statsRes = await db.query(statsQuery, [userId]);
      const stats = statsRes.rows[0] || { total_plays: 0, total_watch_time_seconds: 0 };
      totalPlays = Number(stats.total_plays) || 0;
      totalWatchTime = Number(stats.total_watch_time_seconds) || 0;
    } else {
      // table doesn't exist -> safe fallback to zeros
      totalPlays = 0;
      totalWatchTime = 0;
    }

    const response = {
      total_ads: Number(counts.total_ads) || 0,
      active_ads: Number(counts.active_ads) || 0,
      in_review: Number(counts.in_review) || 0,
      expired: Number(counts.expired) || 0,
      total_plays: totalPlays,
      total_watch_time_seconds: totalWatchTime
    };

    return res.json(response);
  } catch (err) {
    console.error("Error fetching advertiser dashboard:", err);
    return res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

// recentAdsApi.js
/**
 * GET /ads/recent
 * Fetch the latest 5 ads (by created_at) for the logged-in advertiser.
 * Example response:
 * [
 *   { "id": "1", "title": "Ad 1", "status": "active", "start_date": "...", "end_date": "..." },
 *   { "id": "2", "title": "Ad 2", "status": "expired", "start_date": "...", "end_date": "..." }
 * ]
 */
router.get("/ads/recent", auth, async (req, res) => {
  try {
    const userId = req.user && (req.user_id || req.user.user_id || req.user.userId);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const result = await db.query(
      `SELECT id, title, status, start_date, end_date
       FROM ads
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching recent ads:", err);
    res.status(500).json({ error: "Failed to fetch recent ads" });
  }
});

// delete helper
async function deleteFileFromStorage(filePath) {
  try {
    await bucket.file(filePath).delete();
    console.log("File deleted successfully:", filePath);
    return true;
  } catch (err) {
    console.error("File delete failed for", filePath, err);
    // don't rethrow to avoid hiding original error — return false for caller decision
    return false;
  }
}

/**
 * POST /ads/create
 * multipart/form-data:
 *  - file: media file
 *  - user_id: uuid
 *  - title: string
 *  - description: string (optional)
 *  - meme_type: image|video
 *  - selected_devices: JSON stringified array of device ids OR multiple form fields
 *  - start_date: ISO string or yyyy-mm-dd
 *  - end_date: ISO string or yyyy-mm-dd
 *
 * Middleware: checkValidClient (sets req.client_id) and auth (sets req.user maybe)
 */
router.post('/ads/create', checkValidClient, auth, upload.single('file'), async (req, res) => {
  const file = req.file;
  try {
    // Basic req fields
    const clientId = req.client_id || req.clientId || req.clientIdFromMiddleware || req.headers['x-client-id']; // adapt if different
    if (!clientId) return res.status(400).json({ error: 'client_id_missing' });

    const {
      user_id, title, description = '', meme_type, start_date, end_date,
    } = req.body || {};

    // selected_devices might come as JSON string or as repeated fields (array)
    let selected_devices = req.body.selected_devices;
    if (!selected_devices) selected_devices = req.body['selected_devices[]']; // sometimes arrays sent like this
    // normalize
    if (typeof selected_devices === 'string') {
      try {
        selected_devices = JSON.parse(selected_devices);
      } catch (err) {
        // maybe comma separated
        selected_devices = selected_devices.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(selected_devices)) {
      // maybe single value
      if (selected_devices) selected_devices = [selected_devices];
      else selected_devices = [];
    }

    // Validation
    if (!user_id) return res.status(400).json({ error: 'user_id_required' });
    if (!title || title.toString().trim().length === 0) return res.status(400).json({ error: 'title_required' });
    if (!meme_type || !['image', 'video'].includes(meme_type)) return res.status(400).json({ error: 'invalid_media_type' });
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_and_end_dates_required' });
    if (!file) return res.status(400).json({ error: 'file_required' });
    if (selected_devices.length === 0) return res.status(400).json({ error: 'select_at_least_one_device' });

    // parse dates
    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'invalid_date_format' });

    // start must be at least 24 hours from now
    const minStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (start < minStart) return res.status(400).json({ error: 'start_must_be_at_least_24_hours_from_now' });

    if (end <= start) return res.status(400).json({ error: 'end_must_be_after_start' });

    // Prepare firebase filename
    const timestamp = Date.now();
    const safeOriginal = file.originalname.replace(/\s+/g, '_');
    const filename = `uploads/${clientId}/${user_id}/${timestamp}_${safeOriginal}`;

    // Upload to firebase storage
    const fileUpload = bucket.file(filename);
    const uuid = uuidv4();
    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          firebaseStorageDownloadTokens: uuid,
        },
      },
      resumable: false,
    });

    // Wrap upload in a promise
    const uploadPromise = new Promise((resolve, reject) => {
      blobStream.on('error', (err) => {
        console.error('Firebase upload error:', err);
        reject(err);
      });

      blobStream.on('finish', () => {
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${uuid}`;
        resolve({ url, filename });
      });

      blobStream.end(file.buffer);
    });

    let uploaded;
    try {
      uploaded = await uploadPromise; // { url, filename }
    } catch (err) {
      console.error('Upload failed:', err);
      return res.status(500).json({ error: 'file_upload_failed' });
    }

    // At this point file is successfully uploaded. Now insert ads in DB inside a transaction.
    // We'll use a transaction - if any insert fails - rollback and delete the uploaded file.
    const insertQuery = `
      INSERT INTO ads (
        id, client_id, user_id, device_id, title, description,
        media_type, media_url, start_time, end_time, filename, status, status_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, now()
      ) RETURNING id
    `;

    const insertedAdIds = [];
    const failedDevices = [];

    try {
      await client.query('BEGIN');

      for (const deviceId of selected_devices) {
        const adId = uuidv4();
        try {
          const values = [
            adId,
            clientId,
            user_id,
            deviceId,
            title,
            description,
            meme_type,
            uploaded.url,
            start.toISOString(),
            end.toISOString(),
            uploaded.filename,
            'in_review', // default initial status
          ];
          const result = await client.query(insertQuery, values);
          insertedAdIds.push(result.rows[0].id);
        } catch (insertErr) {
          console.error(`Error inserting ad for device ${deviceId}:`, insertErr);
          failedDevices.push(deviceId);
          // Don't break immediately - we want to attempt other inserts or fail the whole thing
        }
      }

      if (failedDevices.length > 0) {
        // Something failed - rollback and delete uploaded file
        await client.query('ROLLBACK');
        await deleteFileFromStorage(uploaded.filename);
        return res.status(500).json({
          error: 'ad_insert_failed_for_some_devices',
          failedDevices,
        });
      } else {
        // All good
        await client.query('COMMIT');
        return res.status(201).json({
          success: true,
          message: 'Ads created for devices',
          ads: insertedAdIds,
          media: {
            url: uploaded.url,
            filename: uploaded.filename,
            media_type: meme_type,
          },
        });
      }
    } catch (txErr) {
      console.error('Transaction error:', txErr);
      try { await client.query('ROLLBACK'); } catch (_) {}
      // clean up uploaded file
      await deleteFileFromStorage(uploaded.filename);
      return res.status(500).json({ error: 'database_error', detail: txErr.message });
    }
  } catch (err) {
    console.error('Unexpected error in /ads/create:', err);
    return res.status(500).json({ error: 'server_error', detail: err.message });
  }
});

router.post('/login', checkValidClient, async (req, res) => {
  try {
    const clientId = req.clientId || req.client_id || req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({ error: 'Client not identified' });
    }

    const { email, mobile_number, password, fcmtoken } = req.body ?? {};
    if ((!email && !mobile_number) || !password) {
      return res.status(400).json({ error: 'email or mobile_number and password are required' });
    }

    // Find user by email OR mobile_number for the given client
    const findQ = `
      SELECT id, client_id, name, email, mobile_number, password_hash, role, isactive, fcmtoken
      FROM users
      WHERE client_id = $1 AND (lower(email) = lower($2) OR mobile_number = $3)
      LIMIT 1
    `;
    const findValues = [clientId, email || '', mobile_number || null];
    const result = await db.query(findQ, findValues);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    const user = result.rows[0];

    // check active
    if (user.isactive === false) {
      return res.status(403).json({ error: 'account_inactive' });
    }

    // verify password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // generate token (payload with userId and clientId)
    const tokenPayload = { userId: user.id, clientId: user.client_id, role: user.role };
    const token = jwt.sign(tokenPayload, "THISISTESTAPPFORHORDING");

    // update user's tokens column and optionally fcmtoken
    // Here we store the latest token string in tokens column. If you use multiple sessions, change strategy.
    const updateQ = `
      UPDATE users
      SET tokens = $1, fcmtoken = COALESCE($2, fcmtoken)
      WHERE id = $3
    `;
    await db.query(updateQ, [[token], fcmtoken || null, user.id]);

    // Return safe user details + token
    const responseUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile_number: user.mobile_number,
      role: user.role,
      client_id: user.client_id,
    };

    return res.status(200).json({ success: true, user: responseUser, token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});

router.post('/signup', checkValidClient, async (req, res) => {
  try {
    const clientId = req.clientId || req.client_id || req.headers['x-client-id'];
    if (!clientId) return res.status(400).json({ error: 'Client not identified' });

    const { name, email, password, role } = req.body ?? {};

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required' });
    }
    // Basic email regex (simple)
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) return res.status(400).json({ error: 'invalid email' });

    // password strength simple check (adjust as needed)
    if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

    // Check if email already exists for this client
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1 AND client_id = $2 LIMIT 1',
      [email.toLowerCase(), clientId]
    );
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'email already registered for this client' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 8);

    // Create user id
    const userId = uuidv4();

    // Generate JWT token
    const token = jwt.sign({ userId, clientId }, "THISISTESTAPPFORHORDING");

    // Insert user. tokens column stores current token (string). Adjust if you prefer an array or sessions table.
    const insertQuery = `
      INSERT INTO users ( client_id, name, email, password_hash, role, tokens)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, client_id
    `;
    const values = [ clientId, name.trim(), email.toLowerCase().trim(), passwordHash, role ?? 'advertiser', [token]];

    const { rows } = await db.query(insertQuery, values);
    const created = rows[0];

    // return user (safe fields) + token
    return res.status(201).json({
      success: true,
      user: {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
        client_id: created.client_id,
      },
      token,
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
});
module.exports=router
