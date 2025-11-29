const {
  express,
  upload, // multer memory-storage ready
  uuidv4,
  jsonwebtoken,
  bcrypt,
  db,
  auth,
} = require("./deps");
const nodemailer = require("nodemailer");

const { admin, fcm } = require("./firebaseAdmin");
const bucket = admin.storage().bucket();
const router = express.Router();
const timers = {};

const checkValidClient = require("./middleware/checkValidClient");
// ----------------------
// GET /ads/my
// ----------------------
router.get("/", async (req, res) => {
  res.send("Welcome");
});
router.post("/send-otp", checkValidClient, async (req, res) => {
  const { email } = req.body;
  try {
    if (!email)
      return res.status(401).send({ message: "email id is required" });
    const query = `select * from users where email = $1 and client_id=$2`;
    const { rows } = await db.query(query, [email, req.client_id]);
    if (rows.length == 0)
      return res.status(401).send({ message: "invalid email" });
    const fetchedEmailId = rows[0].email;
    const isSent = await sendEmail(fetchedEmailId, req.client_id);
    if (isSent) {
      res
        .status(200)
        .send({ message: "OTP sent successfully to the registered email valid for 3 min" });
    } else {
      res.status(500).send({ message: "Failed to send OTP" });
    }
  } catch (e) {
    res.status(500).send({ message: "Something went wrong" });
  }
});
async function sendEmail(email, client_id) {
  const OTP = Math.floor(100000 + Math.random() * 900000).toString();
  const mailRequest = nodemailer.createTransport({
    host: "smtpout.secureserver.net",
    port: 465,
    auth: {
      user: "info@listnow.in",
      pass: "Sam@#)*&&$$5167",
    },
  });
  const mailingOptions = {
    from: "info@listnow.in",
    to: email,
    subject: "Your OTP Code",
    html: `<body style='background:#f2f2f2;text-align:center;border-top:5px solid #2D317D;width:100%;'><div style='padding:35px 50px;'><p style='font-weight:bold;'>Dear Customer, Your OTP to Login  is</p><h1 style='letter-spacing: 1.1rem;'> ${OTP} </h1><p style='font-weight:bold;'>OTP is valid for 3 minutes.</p><p style='font-weight:bold;'> Thank you</p></div><div style='background:#1b1f6d;padding:20px;'></div></body>`,
  };
  try {
    const data = await mailRequest.sendMail(mailingOptions);
    console.log(data);
    const query = `insert into otp (email,otp,client_id) values($1,$2,$3)`;
    await db.query(query, [email, OTP, client_id]);
    countdown(3 * 60, email, client_id);
    return true;
  } catch (excemption) {
    return false;
  }
}
const countdown = (duration, email, client_id) => {
  let remainingTime = duration; // Time in seconds
  const timerInterval = setInterval(() => {
    const minutes = Math.floor(remainingTime / 60);
    const seconds = remainingTime % 60;

    // Format time as MM:SS
    const formattedTime = `${String(minutes).padStart(2, "0")}:${String(
      seconds
    ).padStart(2, "0")}`;
    console.log(formattedTime);
    remainingTime--;
    // Stop the timer when it reaches 0
    if (remainingTime < 0) {
      deleteOtpFromDB(email, client_id);
      clearInterval(timerInterval);
      delete timers[timerInterval];
      console.log("Time is up!");
    }
  }, 1000);
  timers[email] = timerInterval;
};
const deleteOtpFromDB = async (email, client_id) => {
  const query = "delete from otp where email =$1 and client_id = $2";
  await client.query(query, [email, client_id]);
  console.log("OTP DELETED");
};
router.post("/verify-otp", checkValidClient,async (req, res) => {
  const { email, otp } = req.body;
  if(!email||!otp)return res.status(400).send({"message":"email or otp is required"})
  const query = `select otp from otp where email='${email}' and client_id ='${req.client_id}' order by created_at desc limit 1`;
  console.log(email, otp);
  try {
    const result = await db.query(query);
    console.log(result);
    if (result.rows.length > 0) {
      const DbOtp = result.rows[0]["otp"];
      console.log(DbOtp, otp);
      if (DbOtp === otp) {
        const query = "delete from otp where email =$1 and client_id =$2";
        await db.query(query, [email, req.client_id]);
       clearInterval(timers[email]); // Cancel the timer
      delete timers[email];
        res.status(200).json({
          message: "OTP Verified successfully",
          email: email,
          status: 201,
        });
      } else {
        clearInterval(timers[email]); // Cancel the timer
      delete timers[email];
        res.status(500).json({ message: "Invalid OTP", status: 202 });
      }
    } else {
      clearInterval(timers[email]); // Cancel the timer
      delete timers[email]; 
      res.status(500).json({ message: "Invalid OTP", status: 203 });
    }
  } catch (err) {
    clearInterval(timers[email]); // Cancel the timer
    delete timers[email];
    console.log(err);
    res.status(500).send({"message":"Something went wrong"});
  }
});

// router.get("/ads/my", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id; // set in auth middleware
//     const clientId = req.client_id; // set in checkValidClient middleware
//     const { status } = req.query;

//     // Base query
//     let query = `
//       SELECT id, title, description, status, media_type, media_url, start_date, end_date, created_at
//       FROM ads
//       WHERE user_id = $1 AND client_id = $2
//     `;
//     const params = [userId, clientId];

//     // Optional filter by status
//     if (status) {
//       query += ` AND status = $3`;
//       params.push(status);
//     }

//     query += ` ORDER BY created_at DESC`;

//     const { rows } = await db.query(query, params);

//     if (rows.length === 0) {
//       return res.status(200).json({
//         success: true,
//         message: status
//           ? `No ads found with status '${status}'.`
//           : "No ads found.",
//         data: [],
//       });
//     }
//     console.log(rows);
//     return res.status(200).json({
//       success: true,
//       message: "Ads fetched successfully",
//       data: rows,
//     });
//   } catch (error) {
//     console.error("Error fetching ads:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while fetching ads.",
//       error: error.message, // advertiser can see actual error
//     });
//   }
// });
// router.get("/ads/my", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id; // from auth middleware
//     const clientId = req.client_id; // from checkValidClient middleware
//     const { status } = req.query;

//     // Base query: join ads + ad_devices + devices
//     let query = `
//       SELECT 
//         a.id AS ad_id,
//         a.title,
//         a.description,
//         a.media_type,
//         a.media_url,
//         a.created_at,
//         ad.device_id,
//         ad.start_date,
//         ad.end_date,
//         ad.status,
//         ad.status_updated_at,
//         d.name AS device_name,
//         d.location AS device_location
//       FROM ads a
//       JOIN ad_devices ad ON ad.ad_id = a.id
//       JOIN devices d ON d.id = ad.device_id
//       WHERE a.user_id = $1 AND a.client_id = $2
//     `;
//     const params = [userId, clientId];

//     // Optional filter by status (device-level status)
//     if (status) {
//       query += ` AND ad.status = $3`;
//       params.push(status);
//     }

//     query += ` ORDER BY a.created_at DESC, ad.start_date ASC`;

//     const { rows } = await db.query(query, params);

//     if (rows.length === 0) {
//       return res.status(200).json({
//         success: true,
//         message: status
//           ? `No ads found with status '${status}'.`
//           : "No ads found.",
//         data: [],
//       });
//     }

//     // Group ads with their devices
//     const grouped = {};
//     for (const row of rows) {
//       if (!grouped[row.ad_id]) {
//         grouped[row.ad_id] = {
//           ad_id: row.ad_id,
//           title: row.title,
//           description: row.description,
//           media_type: row.media_type,
//           media_url: row.media_url,
//           created_at: row.created_at,
//           devices: []
//         };
//       }
//       grouped[row.ad_id].devices.push({
//         device_id: row.device_id,
//         device_name: row.device_name,
//         device_location: row.device_location,
//         start_date: row.start_date,
//         end_date: row.end_date,
//         status: row.status,
//         status_updated_at: row.status_updated_at
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Ads fetched successfully",
//       data: Object.values(grouped),
//     });
//   } catch (error) {
//     console.error("Error fetching ads:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while fetching ads.",
//       error: error.message,
//     });
//   }
// });
router.get("/ads/my", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;
    const clientId = req.client_id;
    const { status } = req.query;

    // Query only ads table
    let query = `
      SELECT id AS ad_id, title, description, media_type, media_url, created_at
      FROM ads
      WHERE user_id = $1 AND client_id = $2
    `;
    const params = [userId, clientId];

    // Optional filter: ads that have at least one device with this status
    if (status) {
      query += ` AND EXISTS (
        SELECT 1 FROM ad_devices ad
        WHERE ad.ad_id = ads.id AND ad.status = $3
      )`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const { rows } = await db.query(query, params);

    return res.status(200).json({
      success: true,
      message: "Ads fetched successfully",
      data: rows
    });
  } catch (error) {
    console.error("Error fetching ads:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching ads.",
      error: error.message,
    });
  }
});
router.get("/ads/details", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;
    const clientId = req.client_id;
    const { id } = req.query; // ad_id

    if (!id) {
      return res.status(400).json({ success: false, message: "ad_id is required" });
    }

    const query = `
      SELECT 
        a.id AS ad_id,
        a.title,
        a.description,
        a.media_type,
        a.media_url,
        a.filename,
        a.created_at,
        a.user_id,
        ad.device_id,
        ad.start_date,
        ad.end_date,
        ad.status,
        ad.status_updated_at,
        d.name AS device_name,
        d.location AS device_location
      FROM ads a
      JOIN ad_devices ad ON ad.ad_id = a.id
      JOIN devices d ON d.id = ad.device_id
      WHERE a.id = $1 AND a.user_id = $2 AND a.client_id = $3
      ORDER BY ad.start_date ASC
    `;
    const params = [id, userId, clientId];
    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Ad not found or you don't have access to it",
      });
    }

    // Group ad + devices
    const ad = {
      ad_id: rows[0].ad_id,
      title: rows[0].title,
      description: rows[0].description,
      media_type: rows[0].media_type,
      media_url: rows[0].media_url,
      filename: rows[0].filename,
      created_at: rows[0].created_at,
      user_id: rows[0].user_id,
      devices: rows.map((row) => ({
        device_id: row.device_id,
        device_name: row.device_name,
        device_location: row.device_location,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        status_updated_at: row.status_updated_at
      })),
    };

    return res.status(200).json({
      success: true,
      message: "Ad details fetched successfully",
      data: ad,
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
// router.get("/ads/details", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id; // from auth middleware
//     const clientId = req.client_id; // from checkValidClient middleware
//     const { id } = req.query;

//     const query = `
//       SELECT id, title, description, status, media_type, media_url, 
//              start_date, end_date, created_at,user_id,filename,status_updated_at
//       FROM ads
//       WHERE id = $1 AND user_id = $2 AND client_id = $3
//       LIMIT 1
//     `;
//     const params = [id, userId, clientId];
//     const { rows } = await db.query(query, params);

//     if (rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Ad not found or you don't have access to it",
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       message: "Ad details fetched successfully",
//       data: rows[0],
//     });
//   } catch (error) {
//     console.error("Error fetching ad details:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while fetching ad details.",
//       error: error.message,
//     });
//   }
// });



// router.js
router.delete("/ads/delete", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id; // from auth middleware
    const clientId = req.client_id; // from checkValidClient middleware
    const { id } = req.query;

    // Step 1: Check if ad exists and belongs to this user & client
    const checkQuery = `
      SELECT id, status,filename
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
    deleteAdFileIfUnused(ad.filename, id);

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
router.post("/ads/extend", checkValidClient, auth, async (req, res) => {
  const { id } = req.query;
  const { end_date } = req.body;

  if (!end_date) {
    return res.status(400).json({ error: "end_date is required" });
  }

  try {
    // 1. Fetch current ad
    const adRes = await db.query(
      `SELECT end_date, status FROM ads WHERE id = $1`,
      [id]
    );
    if (adRes.rows.length === 0) {
      return res.status(404).json({ error: "Ad not found" });
    }

    const current = new Date(adRes.rows[0].end_date);
    const requested = new Date(end_date);

    // 2. Validate
    if (isNaN(requested.getTime())) {
      return res.status(400).json({ error: "Invalid date format" });
    }
    if (requested <= current) {
      return res
        .status(400)
        .json({ error: "New end_date must be after current end_date" });
    }

    // 3. Update
    const updateRes = await db.query(
      `UPDATE ads
       SET end_date = $1, status_updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, end_date, status`,
      [end_date, id]
    );

    return res.json({
      success: true,
      message: "Ad end date extended",
      ad: updateRes.rows[0],
    });
  } catch (err) {
    console.error("Error extending ad:", err);
    return res.status(500).json({ error: "Failed to extend ad" });
  }
});
/**
 * Delete ad file if no other ads are using it
 * @param {string} adId - The ID of the ad being deleted
 */
async function deleteAdFileIfUnused(filename, adId) {
  try {
    // 1. Check if other ads still use this file
    const checkRes = await db.query(
      `SELECT COUNT(*) FROM ads WHERE filename = $1 AND id <> $2`,
      [filename, adId]
    );

    const count = parseInt(checkRes.rows[0].count, 10);

    if (count === 0) {
      // 2. Safe to delete file
      const file = bucket.file(filename);
      await file.delete().catch((err) => {
        if (err.code === 404) {
          console.warn(`File not found in storage: ${filename}`);
        } else {
          throw err;
        }
      });
      console.log(`Deleted file from storage: ${filename}`);
    } else {
      console.log(
        `File ${filename} is still used by ${count} other ad(s), skipping delete`
      );
    }
  } catch (err) {
    console.error("Error deleting ad file:", err);
  }
}

// router.js
router.put("/ads/update", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id; // from auth middleware
    const clientId = req.client_id; // from checkValidClient middleware
    const { id } = req.query;
    const { title, description, start_time, end_time, media_url, media_type } =
      req.body;

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
          start_date = COALESCE($3, start_date),
          end_date = COALESCE($4, end_date),
          media_url = COALESCE($5, media_url),
          media_type = COALESCE($6, media_type),
          status_updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `;
    const updateParams = [
      title,
      description,
      start_time,
      end_time,
      media_url,
      media_type,
      id,
    ];

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
// router.patch("/ads/pause", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id; // from auth middleware
//     const clientId = req.client_id; // from checkValidClient middleware
//     const { id } = req.query;

//     // Step 1: Check ad ownership
//     const checkQuery = `
//       SELECT id, status 
//       FROM ads
//       WHERE id = $1 AND user_id = $2 AND client_id = $3
//       LIMIT 1
//     `;
//     const { rows } = await db.query(checkQuery, [id, userId, clientId]);

//     if (rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Ad not found or you don't have access to it",
//       });
//     }

//     const ad = rows[0];

//     // Step 2: Only allow pause if status = approved or active
//     if (ad.status !== "approved" && ad.status !== "active") {
//       return res.status(200).json({
//         success: false,
//         message: `Ad cannot be paused because it is currently '${ad.status}'. Only 'approved' or 'active' ads can be paused.`,
//       });
//     }

//     // Step 3: Update status to paused
//     const updateQuery = `
//       UPDATE ads
//       SET status = 'paused', status_updated_at = NOW()
//       WHERE id = $1
//       RETURNING *
//     `;
//     const updatedAd = await db.query(updateQuery, [id]);

//     return res.status(200).json({
//       success: true,
//       message: "Ad paused successfully",
//       data: updatedAd.rows[0],
//     });
//   } catch (error) {
//     console.error("Error pausing ad:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while pausing ad.",
//       error: error.message,
//     });
//   }
// });
router.post('/ads/:adId/devices/:deviceId/pause', checkValidClient, auth, async (req, res) => {
  const { adId, deviceId } = req.params;
  const userId = req.user_id;
  try {
    await db.query('BEGIN');

    // lock the row (and join ad to check owner)
    const sel = `
      SELECT ad.*, a.user_id AS owner_id
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      WHERE ad.ad_id = $1 AND ad.device_id = $2
      FOR UPDATE
    `;
    const r = await db.query(sel, [adId, deviceId]);
    if (r.rows.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'mapping_not_found' });
    }

    const row = r.rows[0];
    if (String(row.owner_id) !== String(userId)) {
      await db.query('ROLLBACK');
      return res.status(403).json({ error: 'forbidden' });
    }

    if (row.status === 'paused') {
      // idempotent
      await db.query('COMMIT');
      return res.json({ success: true, message: 'already_paused', device: row });
    }

    if (row.status === 'expired') {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'cannot_pause_expired' });
    }
    if (row.status === 'in_review') {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'Ads In Review cant pause' });
    }

    const upd = `
      UPDATE ad_devices
      SET status = 'paused', status_updated_at = now()
      WHERE ad_id = $1 AND device_id = $2
      RETURNING *
    `;
    const updRes = await db.query(upd, [adId, deviceId]);

    // audit log
    // await db.query(
    //   `INSERT INTO ad_device_history (ad_id, device_id, action, actor_user_id, details)
    //    VALUES ($1,$2,'paused',$3,$4)`,
    //   [adId, deviceId, userId, JSON.stringify({ reason: req.body.reason || null })]
    // );

    await db.query('COMMIT');

    // notify device (pseudo)
    // notifyDevice(deviceId, { action: 'pause', ad_id: adId });

    return res.json({ success: true, message: 'paused', device: updRes.rows[0] });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch(_) {}
    console.error('Pause error', err);
    return res.status(500).json({ error: 'pause_failed', detail: err.message });
  }
});
router.post('/ads/:adId/devices/:deviceId/resume', checkValidClient, auth, async (req, res) => {
  const { adId, deviceId } = req.params;
  const userId = req.user_id;
  try {
    await db.query('BEGIN');

    const sel = `
      SELECT ad.*, a.user_id AS owner_id
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      WHERE ad.ad_id = $1 AND ad.device_id = $2
      FOR UPDATE
    `;
    const r = await db.query(sel, [adId, deviceId]);
    if (r.rows.length === 0) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'mapping_not_found' }); }
    const row = r.rows[0];
    if (String(row.owner_id) !== String(userId)) { await db.query('ROLLBACK'); return res.status(403).json({ error: 'forbidden' }); }

    if (row.status !== 'paused') {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'cannot_resume_not_paused' });
    }

    const now = new Date();
    if (new Date(row.end_date) <= now) {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'end_date_expired', message: 'extend_before_resuming' });
    }

    const upd = `
      UPDATE ad_devices
      SET status = 'active', status_updated_at = now()
      WHERE ad_id = $1 AND device_id = $2
      RETURNING *
    `;
    const updRes = await db.query(upd, [adId, deviceId]);

    // await db.query(
    //   `INSERT INTO ad_device_history (ad_id, device_id, action, actor_user_id, details)
    //    VALUES ($1,$2,'resumed',$3,$4)`,
    //   [adId, deviceId, userId, JSON.stringify({ reason: req.body.reason || null })]
    // );

    await db.query('COMMIT');

    // notify device: notifyDevice(deviceId,{action:'resume', ad_id:adId});

    return res.json({ success: true, message: 'resumed', device: updRes.rows[0] });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch(_) {}
    console.error('Resume error', err);
    return res.status(500).json({ error: 'resume_failed', detail: err.message });
  }
});
router.post('/ads/:adId/devices/:deviceId/extend', checkValidClient, auth, async (req, res) => {
  const { adId, deviceId } = req.params;
  const { end_date } = req.body;
  if (!end_date) return res.status(400).json({ error: 'end_date_required' });
  try {
    const upd = `UPDATE ad_devices SET end_date = $1, status_updated_at = now() WHERE ad_id = $2 AND device_id = $3 RETURNING *`;
    const updRes = await db.query(upd, [end_date, adId, deviceId]);
    
    return res.json({ success: true, message: 'extended', device: updRes.rows[0] });
  } catch (err) {
    console.error('Extend error', err);
    return res.status(500).json({ error: 'extend_failed', detail: err.message });
  }
});
router.delete('/ads/:adId/devices/:deviceId', checkValidClient, auth, async (req, res) => {
  const { adId, deviceId } = req.params;
  const userId = req.user_id;

  try {
    await db.query('BEGIN');

    // verify ownership
    const verify = `SELECT a.user_id FROM ads a WHERE a.id = $1`;
    const vr = await db.query(verify, [adId]);
    if (vr.rows.length === 0) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'ad_not_found' }); }
    if (String(vr.rows[0].user_id) !== String(userId)) { await db.query('ROLLBACK'); return res.status(403).json({ error: 'forbidden' }); }

    const del = `DELETE FROM ad_devices WHERE ad_id = $1 AND device_id = $2 RETURNING *`;
    const delRes = await db.query(del, [adId, deviceId]);
    if (delRes.rows.length === 0) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'mapping_not_found' }); }

    // await db.query(
    //   `INSERT INTO ad_device_history (ad_id, device_id, action, actor_user_id, details)
    //    VALUES ($1,$2,'deleted',$3,$4)`,
    //   [adId, deviceId, userId, JSON.stringify({ reason: req.body?.reason || null })]
    // );

    // If no devices left -> optional cleanup
    const count = await db.query(`SELECT COUNT(*) as c FROM ad_devices WHERE ad_id = $1`, [adId]);
    if (Number(count.rows[0].c) === 0) {
      // Option A (recommended): keep ad but mark status/published=false
      // Option B: delete ad row and remove file
      // Example: delete ad completely:
      const adRow = await db.query(`SELECT filename FROM ads WHERE id = $1`, [adId]);
      await db.query(`DELETE FROM ads WHERE id = $1`, [adId]);

      // remove file from storage if you want:
      if (adRow.rows[0] && adRow.rows[0].filename) {
        try { await deleteFileFromStorage(adRow.rows[0].filename); } catch(e) { /* log but don't fail */ }
      }
    }

    await db.query('COMMIT');

    // notify device & other systems
    // notifyDevice(deviceId, {action:'delete', ad_id:adId})

    return res.json({ success: true, message: 'mapping_deleted', deleted: delRes.rows[0] });
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch(_) {}
    console.error('Delete mapping error', err);
    return res.status(500).json({ error: 'delete_mapping_failed', detail: err.message });
  }
});
router.put('/ads/:adId', checkValidClient, auth, upload.single('file'), async (req, res) => {
  const { adId } = req.params;
  const userId = req.user_id;
  const { title, description } = req.body;
  const file = req.file;

  try {
    // verify ownership
    const adRes = await db.query('SELECT * FROM ads WHERE id = $1', [adId]);
    if (adRes.rows.length === 0) return res.status(404).json({ error: 'ad_not_found' });
    const ad = adRes.rows[0];
    if (String(ad.user_id) !== String(userId)) return res.status(403).json({ error: 'forbidden' });

    // if file provided -> upload first
    let uploaded = null;
    if (file) {
      const timestamp = Date.now();
      const safeOriginal = file.originalname.replace(/\s+/g, '_');
      const filename = `uploads/${req.client_id}/${userId}/${timestamp}_${safeOriginal}`;
      // upload logic (same as earlier)
      // ... upload to firebase ...
      // uploaded = { url, filename }
      // for brevity assume uploadPromise uploaded variable is set
    }

    await db.query('BEGIN');

    const updates = [];
    const params = [];
    let idx = 1;
    if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description); }
    if (uploaded) { updates.push(`media_url = $${idx++}`); params.push(uploaded.url); updates.push(`filename = $${idx++}`); params.push(uploaded.filename); }

    if (updates.length > 0) {
      const q = `UPDATE ads SET ${updates.join(', ')}, created_at = created_at WHERE id = $${idx} RETURNING *`;
      params.push(adId);
      const upd = await db.query(q, params);
      // audit
      await db.query(`INSERT INTO ad_device_history (ad_id, device_id, action, actor_user_id, details)
                      VALUES ($1,NULL,'ad_updated',$2,$3)`, [adId, userId, JSON.stringify({ updated: Object.keys(req.body) })]);
      await db.query('COMMIT');

      // delete old file after commit (non-blocking) to be safe
      if (uploaded && ad.filename) {
        try { await deleteFileFromStorage(ad.filename); } catch(e) { console.warn('failed deleting old file', e); }
      }

      return res.json({ success: true, message: 'updated', ad: upd.rows[0] });
    } else {
      await db.query('ROLLBACK');
      return res.status(400).json({ error: 'nothing_to_update' });
    }
  } catch (err) {
    try { await db.query('ROLLBACK'); } catch(_) {}
    console.error('Update ad error', err);
    // if we uploaded but failed: delete newly uploaded file to avoid orphans
    if (uploaded) { try { await deleteFileFromStorage(uploaded.filename); } catch(_){} }
    return res.status(500).json({ error: 'update_failed', detail: err.message });
  }
});

// router.js
// router.patch("/ads/resume", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id; // from auth middleware
//     const clientId = req.client_id; // from checkValidClient middleware
//     const { id } = req.query;

//     // Step 1: Check ad ownership
//     const checkQuery = `
//       SELECT id, status 
//       FROM ads
//       WHERE id = $1 AND user_id = $2 AND client_id = $3
//       LIMIT 1
//     `;
//     const { rows } = await db.query(checkQuery, [id, userId, clientId]);

//     if (rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Ad not found or you don't have access to it",
//       });
//     }

//     const ad = rows[0];

//     // Step 2: Validate status
//     if (ad.status !== "paused") {
//       return res.status(400).json({
//         success: false,
//         message: `Ad cannot be resumed because it is currently '${ad.status}'. Only 'paused' ads can be resumed.`,
//       });
//     }

//     // Step 3: Update status to active
//     const updateQuery = `
//       UPDATE ads
//       SET status = 'active', updated_at = NOW()
//       WHERE id = $1
//       RETURNING *
//     `;
//     const updatedAd = await db.query(updateQuery, [id]);

//     return res.status(200).json({
//       success: true,
//       message: "Ad resumed successfully",
//       data: updatedAd.rows[0],
//     });
//   } catch (error) {
//     console.error("Error resuming ad:", error);

//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while resuming ad.",
//       error: error.message,
//     });
//   }
// });

// router.js
router.get("/profile", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id; // from auth middleware
    const clientId = req.client_id; // from checkValidClient middleware

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
    const userId = req.user_id; // from auth middleware
    const clientId = req.client_id; // from checkValidClient middleware
    const { name, email } = req.body;

    if (!name && !email) {
      return res.status(400).json({
        success: false,
        message:
          "At least one field (name or email) must be provided for update",
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
router.patch(
  "/profile/change-password",
  checkValidClient,
  auth,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const userId = req.user_id;
      const { old_password, new_password } = req.body;

      if (!old_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: "Both old_password and new_password are required",
        });
      }

      // Step 1: Get user
      const userQuery = `
      SELECT id, password_hash 
      FROM users
      WHERE id = $1 AND client_id = $2
      LIMIT 1
    `;
      const { rows } = await db.query(userQuery, [userId, clientId]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found or you don't have access",
        });
      }

      const user = rows[0];

      // Step 2: Check old password
      const validPassword = await bcrypt.compare(
        old_password,
        user.password_hash
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
      const updatedUser = await db.query(updateQuery, [hashedPassword, userId]);

      return res.status(200).json({
        success: true,
        message: "Password changed successfully",
        data: updatedUser.rows[0],
      });
    } catch (error) {
      console.error("Error changing password:", error);

      return res.status(500).json({
        success: false,
        message: "Something went wrong while changing password.",
        error: error.message,
      });
    }
  }
);

router.patch(
  "/profile/change-pass-without-auth",
  checkValidClient,
  async (req, res) => {
    try {
      const clientId = req.client_id;
      const { old_password, new_password,email } = req.body;

      if (!old_password || !new_password) {
        return res.status(400).json({
          success: false,
          message: "Both old_password and new_password are required",
        });
      }

      // Step 1: Get user
      const userQuery = `
      SELECT id, password_hash 
      FROM users
      WHERE email = $1 AND client_id = $2
      LIMIT 1
    `;
      const { rows } = await db.query(userQuery, [email, clientId]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found or you don't have access",
        });
      }

      // const user = rows[0];

      // Step 2: Check old password
      // const validPassword = await bcrypt.compare(
      //   old_password,
      //   user.password_hash
      // );
      // if (!validPassword) {
      //   return res.status(401).json({
      //     success: false,
      //     message: "Old password is incorrect",
      //   });
      // }

      // Step 3: Hash new password
      const hashedPassword = await bcrypt.hash(new_password, 8);

      // Step 4: Update password
      const updateQuery = `
      UPDATE users
      SET password_hash = $1
      WHERE email = $2
      RETURNING id, name, email, role, client_id
    `;
      const updatedUser = await db.query(updateQuery, [hashedPassword, email]);

      return res.status(200).json({
        success: true,
        message: "Password changed successfully",
        data: updatedUser.rows[0],
      });
    } catch (error) {
      console.error("Error changing password:", error);

      return res.status(500).json({
        success: false,
        message: "Something went wrong while changing password.",
        error: error.message,
      });
    }
  }
);
// router.js
router.post("/logout", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;
    const clientId = req.client_id;
    const token = req.token; // from auth middleware

    // Remove this token from user's tokens
    const query = `
      UPDATE users
      SET tokens = $1
      WHERE id = $2 AND client_id = $3
      RETURNING id, email
    `;
    const { rows } = await db.query(query, [null, userId, clientId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or already logged out",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
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

/**
 * POST /ads/preview-pricing
 * Body:
 * {
 *   "client_id": "...",
 *   "user_id": "...",
 *   "title": "...",
 *   "description": "...",
 *   "media_type": "video",
 *   "duration_seconds": 30,
 *   "start_date": "2025-09-20T10:00:00.000Z",
 *   "end_date": "2025-09-25T10:00:00.000Z",
 *   "selected_devices": ["uuid-device-1", "uuid-device-2"]
 * }
 */
router.post(
  "/ads/preview-pricing",
  checkValidClient,
  auth,
  async (req, res) => {
    const client_id = req.client_id;
    const {
      title,
      description = "",
      media_type,
      start_date,
      end_date,
      selected_devices,
    } = req.body;

    if (
      !client_id ||
      !media_type ||
      !start_date ||
      !end_date ||
      !selected_devices?.length
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const start = new Date(start_date);
      const end = new Date(end_date);
      const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

      const result = await db.query(
        `SELECT d.id as device_id, d.name, d.location,
              p.price_per_day, p.location_factor
       FROM devices d
       JOIN pricing_rules p
         ON p.device_id = d.id
        AND p.media_type = $1
       WHERE d.id = ANY($2) AND d.client_id = $3`,
        [(media_type || "").toLowerCase(), selected_devices, client_id]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "No pricing rules found for devices" });
      }

      // Build per-device items
      const items = result.rows.map((r) => {
        const daily = Number(r.price_per_day) * Number(r.location_factor);
        const total = daily * days;
        return {
          device_id: r.device_id,
          device_name: r.name,
          location: r.location,
          price_per_day: Number(r.price_per_day),
          location_factor: Number(r.location_factor),
          adjusted_per_day: daily,
          days,
          total,
        };
      });

      // Totals
      const subtotal = items.reduce((sum, i) => sum + i.total, 0);
      const gst = subtotal * 0.18;
      const handling = 30;
      const grandTotal = subtotal + gst + handling;

      return res.json({
        success: true,
        ad_preview: {
          title,
          description,
          media_type,
          start_date,
          end_date,
          devices: items,
          totals: {
            subtotal,
            gst,
            handling,
            grand_total: grandTotal,
          },
        },
      });
    } catch (err) {
      console.error("Pricing preview error:", err);
      res.status(500).json({ error: "Failed to calculate pricing" });
    }
  }
);

// API 3: Create Payment Intent

router.post("/payments/create", checkValidClient, auth, async (req, res) => {
  try {
    const { total_amount } = req.body;
    const clientId = req.client_id;
    const advertiserId = req.user_id; // from auth middleware

    if (!total_amount) {
      return res.status(400).json({
        success: false,
        message: "ad_id and total_amount are required",
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
      [
        advertiserId,
        advertiserId,
        clientId,
        total_amount,
        total_amount,
        transactionId,
      ]
    );

    return res.json({
      success: true,
      message: "Payment intent created",
      payment: result.rows[0],
      gateway_details: {
        transaction_id: transactionId,
        payable_amount: total_amount,
        mock_gateway_url: `https://mockpay.com/checkout/${transactionId}`,
      },
    });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create payment intent",
      error: error.message,
    });
  }
});
// API 4: Verify Payment
router.post("/verify", checkValidClient, auth, async (req, res) => {
  try {
    const { transaction_id, status } = req.body;
    const advertiserId = req.user_id; // from auth middleware

    if (!transaction_id || !status) {
      return res.status(400).json({
        success: false,
        message: "transaction_id and status are required",
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
        message: "Payment not found",
      });
    }

    const payment = paymentRes.rows[0];

    // Update payment status
    await db.query(`UPDATE payments SET status = $1 WHERE id = $2`, [
      status,
      payment.id,
    ]);

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
      new_ad_status: status === "success" ? "in_review" : "pending_payment",
    });
  } catch (error) {
    console.error("Error verifying payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message,
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
      payments: result.rows,
    });
  } catch (error) {
    console.error("Error fetching advertiser payments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
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
// router.get("/dashboard", checkValidClient, auth, async (req, res) => {
//   try {
//     // assume auth middleware sets req.user_id (advertiser user id)
//     const userId = req.user_id;
//     if (!userId) return res.status(401).json({ error: "Unauthorized" });

//     // 1) Counts for ads
//     const countsQuery = `
//       SELECT
//         COUNT(*) FILTER (WHERE true)                             AS total_ads,
//         COUNT(*) FILTER (WHERE status = 'active')                AS active_ads,
//         COUNT(*) FILTER (WHERE status = 'in_review')             AS in_review,
//         COUNT(*) FILTER (WHERE status = 'expired' OR end_date < NOW()) AS expired
//       FROM ads
//       WHERE user_id = $1
//     `;
//     const countsRes = await db.query(countsQuery, [userId]);
//     const counts = countsRes.rows[0] || {
//       total_ads: 0,
//       active_ads: 0,
//       in_review: 0,
//       expired: 0,
//     };

//     // 2) Determine if ad_statistics table exists
//     // to_regclass returns null if the table doesn't exist
//     const tableCheck = await db.query(
//       `SELECT to_regclass('public.ad_statistics') as reg`
//     );

//     let totalPlays = 0;
//     let totalWatchTime = 0;

//     if (tableCheck.rows[0] && tableCheck.rows[0].reg) {
//       // table exists -> compute aggregates
//       const statsQuery = `
//         SELECT
//           COALESCE(SUM(sub.play_count), 0) AS total_plays,
//           COALESCE(SUM(sub.duration_played), 0) AS total_watch_time_seconds
//         FROM (
//           SELECT ad_statistics.ad_id,
//                  COUNT(ad_statistics.id) AS play_count,
//                  SUM(COALESCE(ad_statistics.duration_played, 0)) AS duration_played
//           FROM ad_statistics
//           INNER JOIN ads ON ads.id = ad_statistics.ad_id
//           WHERE ads.user_id = $1
//           GROUP BY ad_statistics.ad_id
//         ) sub
//       `;
//       const statsRes = await db.query(statsQuery, [userId]);
//       const stats = statsRes.rows[0] || {
//         total_plays: 0,
//         total_watch_time_seconds: 0,
//       };
//       totalPlays = Number(stats.total_plays) || 0;
//       totalWatchTime = Number(stats.total_watch_time_seconds) || 0;
//     } else {
//       // table doesn't exist -> safe fallback to zeros
//       totalPlays = 0;
//       totalWatchTime = 0;
//     }

//     const response = {
//       total_ads: Number(counts.total_ads) || 0,
//       active_ads: Number(counts.active_ads) || 0,
//       in_review: Number(counts.in_review) || 0,
//       expired: Number(counts.expired) || 0,
//       total_plays: totalPlays,
//       total_watch_time_seconds: totalWatchTime,
//     };

//     return res.json(response);
//   } catch (err) {
//     console.error("Error fetching advertiser dashboard:", err);
//     return res.status(500).json({ error: "Failed to fetch dashboard summary" });
//   }
// });
router.get("/dashboard", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;
    const clientId = req.client_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // 1) Counts for ads (from ad_devices, joined with ads for filtering)
    const countsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE true)                             AS total_ads,
        COUNT(*) FILTER (WHERE ad.status = 'active')             AS active_ads,
        COUNT(*) FILTER (WHERE ad.status = 'in_review')          AS in_review,
        COUNT(*) FILTER (WHERE ad.status = 'Rejected')           AS rejected,
        COUNT(*) FILTER (WHERE ad.status = 'expired' OR ad.end_date < NOW()) AS expired
      FROM ad_devices ad
      JOIN ads a ON a.id = ad.ad_id
      WHERE a.user_id = $1 AND a.client_id = $2
    `;
    const countsRes = await db.query(countsQuery, [userId, clientId]);
    const counts = countsRes.rows[0] || {
      total_ads: 0,
      active_ads: 0,
      in_review: 0,
      expired: 0,
    };

    // 2) Check if ad_statistics table exists
    const tableCheck = await db.query(
      `SELECT to_regclass('public.ad_statistics') as reg`
    );

    let totalPlays = 0;
    let totalWatchTime = 0;

    if (tableCheck.rows[0] && tableCheck.rows[0].reg) {
      // Aggregate stats per ad across all devices
      const statsQuery = `
        SELECT
          COALESCE(SUM(sub.play_count), 0) AS total_plays,
          COALESCE(SUM(sub.duration_played), 0) AS total_watch_time_seconds
        FROM (
          SELECT ad_statistics.ad_id,
                 COUNT(ad_statistics.id) AS play_count,
                 SUM(COALESCE(ad_statistics.duration_played, 0)) AS duration_played
          FROM ad_statistics
          INNER JOIN ads a ON a.id = ad_statistics.ad_id
          WHERE a.user_id = $1 AND a.client_id = $2
          GROUP BY ad_statistics.ad_id
        ) sub
      `;
      const statsRes = await db.query(statsQuery, [userId, clientId]);
      const stats = statsRes.rows[0] || {
        total_plays: 0,
        total_watch_time_seconds: 0,
      };
      totalPlays = Number(stats.total_plays) || 0;
      totalWatchTime = Number(stats.total_watch_time_seconds) || 0;
    }

    const response = {
      total_ads: Number(counts.total_ads) || 0,
      active_ads: Number(counts.active_ads) || 0,
      in_review: Number(counts.in_review) || 0,
      expired: Number(counts.expired) || 0,
      rejected: Number(counts.rejected) || 0,
      total_plays: totalPlays,
      total_watch_time_seconds: totalWatchTime,
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
// router.get("/ads/recent", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id;
//     if (!userId) return res.status(401).json({ error: "Unauthorized" });

//     const result = await db.query(
//       `SELECT id, title, status, start_date, end_date,description
//        FROM ads
//        WHERE user_id = $1
//        ORDER BY created_at DESC
//        LIMIT 5`,
//       [userId]
//     );

//     res.json(result.rows);
//   } catch (err) {
//     console.error("Error fetching recent ads:", err);
//     res.status(500).json({ error: "Failed to fetch recent ads" });
//   }
// });
// router.get("/ads/recent", checkValidClient, auth, async (req, res) => {
//   try {
//     const userId = req.user_id;
//     const clientId = req.client_id;
//     if (!userId) return res.status(401).json({ error: "Unauthorized" });

//     const query = `
//       SELECT 
//         a.id AS ad_id,
//         a.title,
//         a.description,
//         a.created_at,
//         ad.device_id,
//         ad.start_date,
//         ad.end_date,
//         ad.status,
//         d.name AS device_name,
//         d.location AS device_location
//       FROM ads a
//       JOIN ad_devices ad ON ad.ad_id = a.id
//       JOIN devices d ON d.id = ad.device_id
//       WHERE a.user_id = $1 AND a.client_id = $2
//       ORDER BY a.created_at DESC
//       LIMIT 20
//     `;

//     const { rows } = await db.query(query, [userId, clientId]);

//     // Group ads by ad_id
//     const grouped = {};
//     for (const row of rows) {
//       if (!grouped[row.ad_id]) {
//         grouped[row.ad_id] = {
//           ad_id: row.ad_id,
//           title: row.title,
//           description: row.description,
//           created_at: row.created_at,
//           devices: []
//         };
//       }
//       grouped[row.ad_id].devices.push({
//         device_id: row.device_id,
//         device_name: row.device_name,
//         device_location: row.device_location,
//         start_date: row.start_date,
//         end_date: row.end_date,
//         status: row.status
//       });
//     }

//     res.json({
//       success: true,
//       message: "Recent ads fetched successfully",
//       data: Object.values(grouped).slice(0, 5) // ensure only top 5 ads
//     });
//   } catch (err) {
//     console.error("Error fetching recent ads:", err);
//     res.status(500).json({ error: "Failed to fetch recent ads" });
//   }
// });
router.get("/ads/recent", checkValidClient, auth, async (req, res) => {
  try {
    const userId = req.user_id;
    const clientId = req.client_id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const query = `
      SELECT id AS ad_id, title, description, media_type, media_url, created_at
      FROM ads
      WHERE user_id = $1 AND client_id = $2
      ORDER BY created_at DESC
      LIMIT 5
    `;

    const { rows } = await db.query(query, [userId, clientId]);

    res.json({
      success: true,
      message: "Recent ads fetched successfully",
      data: rows
    });
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
router.post(
  "/ads/create",
  checkValidClient,
  auth,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;

    try {
      // Basic req fields
      const clientId = req.client_id; // adapt if different
      const user_id = req.user_id;
      if (!clientId)
        return res.status(400).json({ error: "client_id_missing" });

      const {
        title,
        description = "",
        meme_type,
        start_date,
        end_date,
        adId,
        duration = 10
      } = req.body || {};

      // selected_devices might come as JSON string or as repeated fields (array)
      let selected_devices = req.body.selected_devices;
      if (!selected_devices) selected_devices = req.body["selected_devices[]"]; // sometimes arrays sent like this
      // normalize
      if (typeof selected_devices === "string") {
        try {
          selected_devices = JSON.parse(selected_devices);
        } catch (err) {
          // maybe comma separated
          selected_devices = selected_devices
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
      if (!Array.isArray(selected_devices)) {
        // maybe single value
        if (selected_devices) selected_devices = [selected_devices];
        else selected_devices = [];
      }

      // Validation
      if (!user_id) return res.status(400).json({ error: "user_id_required" });
      if (!title || title.toString().trim().length === 0)
        return res.status(400).json({ error: "title_required" });
      if (!meme_type || !["image", "video"].includes(meme_type))
        return res.status(400).json({ error: "invalid_media_type" });
      if (!start_date || !end_date)
        return res.status(400).json({ error: "start_and_end_dates_required" });
      if (!file) return res.status(400).json({ error: "file_required" });
      if (selected_devices.length === 0)
        return res.status(400).json({ error: "select_at_least_one_device" });

      // parse dates
      // const start = new Date(start_date);
      // const end = new Date(end_date);
      // if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'invalid_date_format' });

      // start must be at least 24 hours from now
      // const minStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      // if (start < minStart) return res.status(400).json({ error: 'start_must_be_at_least_24_hours_from_now' });

      // if (end <= start) return res.status(400).json({ error: 'end_must_be_after_start' });

      // Prepare firebase filename
      const timestamp = Date.now();
      const safeOriginal = file.originalname.replace(/\s+/g, "_");
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
        blobStream.on("error", (err) => {
          console.error("Firebase upload error:", err);
          reject(err);
        });

        blobStream.on("finish", () => {
          const url = `https://firebasestorage.googleapis.com/v0/b/${
            bucket.name
          }/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${uuid}`;
          resolve({ url, filename });
        });

        blobStream.end(file.buffer);
      });

      let uploaded;
      try {
        uploaded = await uploadPromise; // { url, filename }
      } catch (err) {
        console.error("Upload failed:", err);
        return res.status(500).json({ error: "file_upload_failed" });
      }
    // duration=  duration==undefined?10:duration
      try {
        await db.query("BEGIN");

        const insertAdQuery = `
        INSERT INTO ads (
          id, client_id, user_id, title, description,
          media_type, media_url, filename
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
        const adResult = await db.query(insertAdQuery, [
          adId, // one ad_id (generated before payment)
          clientId,
          user_id,
          title,
          description,
          meme_type,
          uploaded.url,
          uploaded.filename,
        ]);
        const finalAdId = adResult.rows.length > 0 ? adResult.rows[0].id : adId;
        const insertDeviceQuery = `
        INSERT INTO ad_devices (ad_id, device_id, start_date, end_date, status,client_id)
        VALUES ($1, $2, $3, $4, 'in_review',$5)
      `;
        for (const device of selected_devices) {
        await db.query(insertDeviceQuery, [finalAdId, device, start_date, end_date,clientId]);
      }
        await db.query("COMMIT");
        return res.status(201).json({
          success: true,
          message: "Ads created for devices",
          ads: finalAdId,
         devices: selected_devices,
          media: {
            url: uploaded.url,
            filename: uploaded.filename,
            media_type: meme_type,
          },
        });
      } catch (txErr) {
        console.error("Transaction error:", txErr);
        try {
          await db.query("ROLLBACK");
        } catch (_) {}
        await deleteFileFromStorage(uploaded.filename);
        return res
          .status(500)
          .json({ error: "database_error", detail: txErr.message });
      }
    } catch (err) {
       
      console.error("Unexpected error in /ads/create:", err);
      return res
        .status(500)
        .json({ error: "server_error", detail: err.message });
    }
  }
);

router.post("/login", checkValidClient, async (req, res) => {
  try {
    const clientId =
      req.clientId || req.client_id || req.headers["x-client-id"];
    if (!clientId) {
      return res.status(400).json({ error: "Client not identified" });
    }

    const { email, mobile_number, password, fcmtoken } = req.body ?? {};
    if ((!email && !mobile_number) || !password) {
      return res
        .status(400)
        .json({ error: "email or mobile_number and password are required" });
    }

    // Find user by email OR mobile_number for the given client
    const findQ = `
      SELECT id, client_id, name, email, mobile_number, password_hash, role, isactive, fcmtoken
      FROM users
      WHERE client_id = $1 AND (lower(email) = lower($2) OR mobile_number = $3)
      LIMIT 1
    `;
    const findValues = [clientId, email || "", mobile_number || null];
    const result = await db.query(findQ, findValues);

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const user = result.rows[0];

    // check active
    if (user.isactive === false) {
      return res.status(403).json({ error: "account_inactive" });
    }

    // verify password
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    // generate token (payload with userId and clientId)
    const tokenPayload = {
      userId: user.id,
      clientId: user.client_id,
      role: user.role,
      email:user.email
    };
    const token = jsonwebtoken.sign(tokenPayload, "THISISTESTAPPFORHORDING");

    // update user's tokens column and optionally fcmtoken
    // Here we store the latest token string in tokens column. If you use multiple sessions, change strategy.
    const updateQ = `
      UPDATE users
      SET tokens = $1, fcmtoken = COALESCE($2, fcmtoken)
      WHERE id = $3
    `;
    await db.query(updateQ, [token, fcmtoken || null, user.id]);

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
    console.error("Login error:", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});
router.get("/ads/:id/statistics",checkValidClient, auth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT device_id, location, play_time, duration_played
       FROM ad_statistics
       WHERE ad_id = $1
       ORDER BY play_time DESC`,
      [id]
    );

    return res.json({ stats: result.rows });
  } catch (err) {
    console.error("Error fetching ad statistics:", err);
    return res.status(500).json({ error: "Failed to fetch ad statistics" });
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
    const userBlocked =`select isactive from users where id = $1`;
    const userResult = await db.query(userBlocked, [req.user_id]);
    if(userResult.rows[0]["isactive"]===false){
      return res.status(500).json({ message: "User account is inactive" });
    }
    return res.status(200).json({ message: "Account is active" });
  }
);




router.post("/signup", checkValidClient, async (req, res) => {
  try {
    const clientId =req.clientId || req.client_id || req.headers["x-client-id"];
    if (!clientId)
      return res.status(400).json({ error: "Client not identified" });

    const { name, email, password, role, mobile } = req.body ?? {};

    // Basic validation
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, email and password are required" });
    }
    // Basic email regex (simple)
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email))
      return res.status(400).json({ error: "invalid email" });

    // password strength simple check (adjust as needed)
    if (password.length < 6)
      return res
        .status(400)
        .json({ error: "password must be at least 6 characters" });

    // Check if email already exists for this client
    const existing = await db.query(
      "SELECT id FROM users WHERE email = $1 AND client_id = $2 LIMIT 1",
      [email.toLowerCase(), clientId]
    );
    if (existing.rowCount > 0) {
      return res
        .status(409)
        .json({ error: "email already registered for this client" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 8);

    // Create user id
    const userId = uuidv4();

    // Generate JWT token
    // const token = jwt.sign({ userId, clientId }, "THISISTESTAPPFORHORDING");

    // Insert user. tokens column stores current token (string). Adjust if you prefer an array or sessions table.
    const insertQuery = `
      INSERT INTO users ( client_id, name, email, password_hash, role,mobile_number)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, email, role, client_id
    `;
    const values = [
      clientId,
      name.trim(),
      email.toLowerCase().trim(),
      passwordHash,
      role ?? "advertiser",
      mobile,
    ];

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
      token: "",
    });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
});
// router.get("/devices", checkValidClient, auth, async (req, res) => {
//   try {
//     const clientId = req.client_id;
//     const query = `
//       SELECT id, name, location, width, height, status, created_at
//       FROM devices
//       WHERE client_id = $1
//       ORDER BY created_at DESC
//     `;
//     const { rows } = await db.query(query, [clientId]);

//     return res.status(200).json({
//       success: true,
//       message: "Devices fetched successfully",
//       data: rows
//     });
//   } catch (error) {
//     console.error("Error fetching devices:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong while fetching devices",
//       error: error.message
//     });
//   }
// });
router.get("/devices", checkValidClient, auth, async (req, res) => {
  try {
    const clientId = req.client_id;

    const query = `
      SELECT d.id, d.name, d.location, d.width, d.height, d.status, d.created_at,
             COALESCE((
               SELECT jsonb_object_agg(pr.media_type, pr.price_per_day * pr.location_factor)
               FROM pricing_rules pr
               WHERE pr.device_id = d.id
             ), '{}'::jsonb) as pricing
      FROM devices d
      WHERE d.client_id = $1
      ORDER BY d.created_at DESC
    `;

    const { rows } = await db.query(query, [clientId]);

    return res.status(200).json({
      success: true,
      message: "Devices fetched successfully",
      data: rows,
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

module.exports = router;
