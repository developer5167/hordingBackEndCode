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
const client = require("./db");
const WebSocket = require("ws");

const router = express.Router();
const timers = {};
const { admin, fcm } = require("./firebaseAdmin");
const { secureHeapUsed } = require("crypto");
const { log } = require("console");
const e = require("cors");
const { request } = require("http");

const upload = multer({ storage: multer.memoryStorage() });
const bucket = admin.storage().bucket();

// Static access to .well-known folder (e.g., for SSL certs)
router.use("/.well-known", express.static(path.join(__dirname, ".well-known")));

// Basic health check or welcome route
router.get("/", (req, res) => {
  res.send("welcome");
});

router.post("/createUser", checkValidClient, async function (req, res) {
  const { email, name, password, isActive, role } = req.body;
  const hashedPassword = await bcrypt.hash(password, 8);
  console.log(email, hashedPassword.length);
  try {
    await client.query(
      "INSERT INTO users(email,password_hash,name,isActive,role,client_id)VALUES($1,$2,$3,$4,$5,$6)",
      [email, hashedPassword, name, isActive, role, req.client_id]
    );
    res.status(201).send({ message: "User Created Successfully" });
  } catch (err) {
    console.log(err);
    const value = err["detail"];
    if (value.includes("already exists")) {
      res.status(200).send({ message: "User already exists" });
    } else {
      res.status(500).send({ message: value });
    }
  }
});
router.post("/createRole", checkValidClient, auth, async function (req, res) {
  const { email, password_hash, name, mobile_number, role } = req.body;
  const hashedPassword = await bcrypt.hash(password_hash, 8);
  console.log(email, hashedPassword.length);
  try {
    await client.query(
      "INSERT INTO users(email,password_hash,name,mobile_number,isActive,role,client_id)VALUES($1,$2,$3,$4,$5,$6,$7)",
      [email, hashedPassword, name, mobile_number, true, role, req.client_id]
    );
    res.status(201).send({ message: "User Created Successfully" });
  } catch (err) {
    console.log(err["detail"]);
    const value = err["detail"];
    if (value.includes("already exists")) {
      res.status(200).send({ message: "User already exists" });
    } else {
      res.status(500).send({ message: value });
    }
  }
});

router.post("/upload", checkValidClient,auth, upload.single("file"), async (req, res) => {
  const file = req.file;
  const userId = req.body.user_id;
  if (!file || !userId) {
    return res.status(400).json({ error: "File and user_id are required" });
  }
  try {
    const filename = `uploads/${req.client_id}/${userId}/${Date.now()}_${file.originalname}`;
    const fileUpload = bucket.file(filename);
    const uuid = uuidv4();
    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        metadata: {
          firebaseStorageDownloadTokens: uuid,
        },
      },
    });

    blobStream.on("error", (err) => {
      console.error("Upload error:", err);
      res.status(500).send({ error: "Upload failed" });
    });

    blobStream.on("finish", () => {
      const url = `https://firebasestorage.googleapis.com/v0/b/${
        bucket.name
      }/o/${encodeURIComponent(fileUpload.name)}?alt=media&token=${uuid}`;
      res.status(200).send({ url, filename });
    });

    blobStream.end(file.buffer);
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).send({ error: error.message });
  }
});

router.post("/sendOtp", async (req, res) => {
  const { email, client_id } = req.body;
  if (!email) {
    res.send({ message: "please enter valid email" });
    return;
  }
  if (!client_id) {
    res.send({ message: "invalid client_id" });
    return;
  }
  try {
    const validation = await checkEmail(email, client_id);
    // const validation = true;
    validation
      ? (await sendEmail(email, client_id))
        ? res.status(200).json({
            message: "OTP sent successfully",
            status: 201,
            email: email,
          })
        : res.status(200).json({ message: "Failed to send OTP", status: 202 })
      : res.status(200).json({ message: "Email not Found", status: 203 });
    // console.log(validation)
    // validation? res.status(200).json({ message: "Email found" }) : res.status(200).json({ message: "Email not Found" });
  } catch (err) {
    res.status(500).json({ error: err });
  }
});
async function checkEmail(email, client_id) {
  const query = `SELECT count(*) email from users where email=$1 and client_id = $2`;
  try {
    const rowss = await client.query(query, [email, client_id]);
    console.log(rowss.rows[0]["email"]);
    return rowss.rows[0]["email"] == 0 ? false : true;
  } catch (exception) {
    console.log(exception);
    return false;
  }
}
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
    await client.query(query, [email, OTP, client_id]);
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
router.post("/verifyOtp", async (req, res) => {
  const { email, otp, client_id } = req.body;
  const query = `select otp from otp where email='${email}' and client_id ='${client_id}' order by created_at desc limit 1`;
  console.log(email, otp);
  try {
    const result = await client.query(query);
    console.log(result);
    if (result.rows.length > 0) {
      const DbOtp = result.rows[0]["otp"];
      console.log(DbOtp, otp);
      if (DbOtp === otp) {
        const query = "delete from otp where email =$1 and client_id =$2";
        await client.query(query, [email, client_id]);
        res.status(200).json({
          message: "OTP Verified successfully",
          email: email,
          status: 201,
        });
        if (timers[email]) {
          clearInterval(timers[email]); // Cancel the timer
          delete timers[email]; // Clean up the reference
          console.log(`Countdown for ${email} has been cancelled.`);
        } else {
          console.log(`No active countdown found for ${email}.`);
        }
      } else {
        res.status(200).json({ message: "Invalid OTP", status: 202 });
      }
    } else {
      res.status(200).json({ message: "Invalid OTP", status: 203 });
    }
  } catch (err) {
    console.log(err);

    clearInterval(timers[email]); // Cancel the timer
    delete timers[email];
    res.status(500).json({ error: err });
  }
});

router.post(
  "/changeLoginPassword",
  checkValidClient,
  auth,
  async (req, res) => {
    const { password, email } = req.body;
    console.log(password, email);
    if (password == undefined || email == undefined) {
      res.status(400).json({ message: "Bad request" });
      return;
    }
    const encryptPassword = await bcrypt.hash(password, 8);
    const query = `Update users set password_hash=$1,tokens=$2 where email=$3 and client_id = $4`;
    try {
      await client.query(query, [encryptPassword, [], email, req.client_id]);
      res.status(200).json({
        message:
          "Password updated successfully, You have been loggedout of all devices",
        status: 201,
      });
    } catch (excemption) {
      res.status(500).json({
        message: "Oops! unable to update password ,please try again later",
      });
    }
  }
);

router.get(
  "/getAdminDashboardCounts",
  checkValidClient,
  auth,
  async (req, res) => {
    const query = `select count(*) from devices where client_id = '${req.client_id}' and status='active'`;
    const pendingRewviewAdsCount = `select count(*) from ads where client_id = '${req.client_id}' and status='in_review'`;
    const emergencyAdsCount = `select count(*) from emergency_ads where client_id ='${req.client_id}' and status=true`;
    const teamMembersCount = `select count(*) from users where client_id ='${req.client_id}' and role!='advertiser'`;
    try {
      const deviceCount = await client.query(query);
      const pendingCount = await client.query(pendingRewviewAdsCount);
      const emergencyCount = await client.query(emergencyAdsCount);
      const teamCount = await client.query(teamMembersCount);
      console.log(
        deviceCount.rows[0]["count"],
        pendingCount.rows[0]["count"],
        emergencyCount.rows[0]["count"],
        teamCount.rows[0]["count"]
      );
      res.status(200).send({
        active: deviceCount.rows[0]["count"],
        pendingReviews: pendingCount.rows[0]["count"],
        emergencyAds: emergencyCount.rows[0]["count"],
        teamMembers: teamCount.rows[0]["count"],
      });
    } catch (excemption) {
      console.log(excemption);

      res.status(500).json({
        message: "Oops! unable fetData",
      });
    }
  }
);
router.post("/saveAdData",checkValidClient, async (req, res) => {
  const {
    user_id,
    fileName,
    end_date,
    start_date,
    description,
    title,
    ad_data,
    selected_devices,
    meme_type,
  } = req.body;
const queryMain = `INSERT INTO ads (
    client_id, user_id, device_id, title, description, media_type, media_url, start_time, end_time,filename
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10
);`
  const failedDevices = [];
  try {
    for (const device_id of selected_devices || []) {
      try {
        await client.query(queryMain, [
          req.client_id,
          user_id,
          device_id,
          title,
          description,
          meme_type,
          ad_data,
          start_date,
          end_date,
          fileName,
        ]);
      } catch (e) {
        console.error(`Error inserting for device ${device_id}:`, e);
        failedDevices.push(device_id);
        await deleteFileFromStorage(fileName); // Only if needed
      }
    }

    if (failedDevices.length > 0) {
      return res.status(500).json({
        message: "Some inserts failed",
        failedDevices,
      });
    }

    return res.status(200).json({ message: "All ads saved successfully" });
  } catch (e) {
    console.error("Unexpected error:", e);
    return res.status(500).json({ message: "Server error", error: e.message });
  }
});

// router.post("/saveAdData", async (req, res) => {
//   const {
//     user_id,
//     fileName,
//     end_date,
//     start_date,
//     device_id,
//     description,
//     title,
//     ad_data,
//     selected_devices,
//     isactive,
//     isapproved,
//     meme_type,
//   } = req.body;
//   const query = `insert into ads(ad_id, ad_data, user_id, isapproved, meme_type, isactive, start_date, end_date, title, description, device_id,file_name)
//   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`;

//   selected_devices.forEach(async(item, index) => {
// try {
//     await client.query(query, [
//       generateAdId(),
//       ad_data,
//       user_id,
//       isapproved,
//       meme_type,
//       isactive,
//       start_date,
//       end_date,
//       title,
//       description,
//       item,
//       fileName,
//     ]);
//   } catch (e) {
//     console.log(`Exception: ${e}`);
//     deleteFileFromStorage(fileName);

//   }
// });
//   res.status(500).send({ message: "Something went wrong" });
//   res.status(200).send({ message: "Saved Successfully" });
// });
router.post("/saveCompanyAdData", async (req, res) => {
  const {
    fileName,
    device_id,
    description,
    title,
    ad_data,
    isactive,
    meme_type,
  } = req.body;
  const query = `insert into company_ads(ad_id, ad_data, meme_type, isactive, title, description, device_id,file_name)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`;
  try {
    await client.query(query, [
      generateAdId(),
      ad_data,
      meme_type,
      isactive,
      title,
      description,
      device_id,
      fileName,
    ]);
    res.status(200).send({ message: "Saved Successfully" });
  } catch (e) {
    console.log(`Exception: ${e}`);
    deleteFileFromStorage(fileName);
    res.status(500).send({ message: "Something went wrong" });
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
function generateAdId() {
  const randomNumber = Math.floor(10000000 + Math.random() * 90000000);
  return `AD-${randomNumber}`;
}
router.post("/login", checkValidClient, async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Check if user exists
    const sql =
      "SELECT id, name, email, tokens, password_hash, client_id, role, created_at, isactive FROM users WHERE client_id=$1 AND email=$2";
    const userResult = await client.query(sql, [req.client_id, email]);

    if (userResult.rowCount === 0) {
      return res.status(401).json({ message: "Invalid credentials" }); // 401 Unauthorized
    }

    const user = userResult.rows[0];

    // 2. Compare password
    const isMatched = await bcrypt.compare(password, user.password_hash);
    if (!isMatched) {
      return res.status(401).json({ message: "Invalid credentials" }); // 401 Unauthorized
    }

    // 3. Generate new JWT
    const newToken = jwtToken.sign({ email }, "THISISTESTAPPFORHORDING");
    const updatedTokens = [...(user.tokens || []), newToken];

    // 4. Update tokens in DB
    const updateQuery =
      "UPDATE users SET tokens=$1 WHERE email=$2 AND client_id=$3 RETURNING *";
    const updatedUserResult = await client.query(updateQuery, [
      updatedTokens,
      email,
      user.client_id,
    ]);
    const updatedUser = updatedUserResult.rows[0];

    // 5. Get client details
    const companyQuery =
      "SELECT name, subscription_status FROM clients WHERE id=$1";
    const companyResult = await client.query(companyQuery, [user.client_id]);
    const clientDetails = companyResult.rows[0];

    // 6. Prepare clean response (avoid sending password hash)
    const responseUser = {
      id: updatedUser.id,
      client_id: updatedUser.client_id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      created_at: updatedUser.created_at,
      isactive: updatedUser.isactive,
      token: updatedUser.tokens[updatedUser.tokens.length - 1], // send only latest token
    };

    return res.status(200).json({
      clientDetails,
      userDetails: responseUser,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Internal server error" }); // 500 Internal Error
  }
});


router.get("/fetchAds", async (req, response) => {
  const { device_id } = req.query;

  const showClientAdsStatusQuery = `SELECT * FROM show_ad_type WHERE device_id=$1`;
  const companyAdsQuery = `SELECT * FROM company_ads WHERE device_id=$1 and isactive =true`;
  const mainQuery = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND device_id=$1 AND isapproved=true AND isactive=true`;

  // Default fallback values
  let showClientAdsStatusResult = { device_id: true };
  let pauseAllAdsResult = { device_id: false };
  let companyAdsResult = [];

  try {
    // Try to fetch showClientAdsStatus
    try {
      const result = await client.query(showClientAdsStatusQuery, [device_id]);
      if (result.rows.length > 0) {
        showClientAdsStatusResult = result.rows[0]["disable_client_ads"];
        pauseAllAdsResult = result.rows[0]["pause_all_ads"];
      }
    } catch (err) {
      console.warn("showClientAdsStatus query failed, using default.");
    }

    // Try to fetch companyAds
    try {
      const result = await client.query(companyAdsQuery, [device_id]);
      companyAdsResult = result.rows;
    } catch (err) {
      console.warn("companyAds query failed, using default.");
    }

    // Fetch main ads
    const result2 = await client.query(mainQuery, [device_id]);

    const adsData = result2.rows;

    response.status(200).json({
      ads: adsData,
      isClientAdsDisabled: showClientAdsStatusResult,
      pauseAllAds: pauseAllAdsResult,
      companyAds: companyAdsResult,
    });
  } catch (e) {
    console.error("Main query failed", e);
    response.status(500).json({ message: "Internal Server Error" });
  }
});

router.get("/fetchUserActiveAds", auth, async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isapproved=true and isactive=true and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserPausedAds", auth, async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isactive=false and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserInReviewAds", auth, async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isapproved=false and isactive=true and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserExpiredAds", auth, async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() > end_date and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/getRejectedAds", auth, async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE isRejected=true and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});

router.get("/getDeviceIds",checkValidClient, auth, async (request, response) => {
  const query = `select * from devices where client_id=$1`;
  try {
    const result = await client.query(query,[request.client_id]);
    if (result.rowCount > 0) {
      console.log(result.rows)
      response.status(200).json(result.rows);
    } else {
      response.status(200).json([]);
    }
  } catch (e) {
    console.log(e)
    response.status(500);
  }
});

router.get("/getStatics", auth, async (request, response) => {
  const { ad_id } = request.query;
  const query = `select * from stats where ad_id = '${ad_id}'`;
  try {
    const result = await client.query(query);
    if (result.rowCount > 0) {
      response.status(200).json(result.rows);
    } else {
      response.status(200).json([]);
    }
  } catch (e) {
    response.status(500);
  }
});
router.post("/addStats", auth, async (request, response) => {
  const { ad_id, user_id, device_id, time_at, end_time } = request.body;
  const insertQuery = `insert into stats(ad_id,user_id,time_at,device_id,end_time)VALUES($1,$2,$3,$4,$5)`;
  try {
    await client.query(insertQuery, [
      ad_id,
      user_id,
      time_at,
      device_id,
      end_time,
    ]);
    response.status(200).send();
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});
router.get("/turnOfClientAds", auth, async (request, response) => {
  const { device_id, isEnabled } = request.query;
  const insertQuery = `update show_ad_type set disable_client_ads=${isEnabled} where device_id = '${device_id}' RETURNING *`;
  try {
    const result = await client.query(insertQuery);
    response.status(200).send(result.rows[0]["disable_client_ads"]);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});
router.get("/turnOffAllAds", auth, async (request, response) => {
  const { device_id, isEnabled } = request.query;
  const insertQuery = `update show_ad_type set pause_all_ads=${isEnabled} where device_id = '${device_id}' RETURNING *`;
  try {
    const result = await client.query(insertQuery);
    response.status(200).send(result.rows[0]["pause_all_ads"]);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});
router.get("/getAllSettingsEvent", auth, async (request, response) => {
  const { device_id } = request.query;
  const insertQuery = `select * from show_ad_type where device_id ='${device_id}'`;
  try {
    const result = await client.query(insertQuery);
    const device_id = result.rows[0]["device_id"];
    const disable_client_ads = result.rows[0]["disable_client_ads"];
    const pause_all_ads = result.rows[0]["pause_all_ads"];
    response.status(200).json({
      deviceId: device_id,
      showClientAds: disable_client_ads,
      pauseAllAds: pause_all_ads,
    });
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});

router.get("/deleteAd", auth, async (request, response) => {
  const { user_id, ad_id } = request.query;
  const selectQuery = `select file_name from ads where user_id=$1 and ad_id=$2`;
  try {
    const result = await client.query(selectQuery, [user_id, ad_id]);
    const fileName = result.rows[0]["file_name"];
    deleteFileFromStorage(fileName);
    const query = `delete from ads where user_id=$1 and ad_id=$2`;
    try {
      await client.query(query, [user_id, ad_id]);
      response.status(200).send({ message: "Ad deleted successfully" });
    } catch (e) {
      response.status(500);
    }
  } catch (e) {
    response.status(500);
  }
});
router.post("/pausePlayAds", auth, async (request, response) => {
  const { pauseOrPlay, ad_id, user_id } = request.body;
  const query = `update ads set isActive = $1 where ad_id = $2 and user_id = $3 RETURNING *`;
  try {
    const result = await client.query(query, [pauseOrPlay, ad_id, user_id]);
    response.status(200).json(result.rows[0]);
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});

router.post("/add_client", async (request, response) => {
  const { name, email } = request.body;
  const query = `INSERT INTO clients (name, email)VALUES ($1, $2);`;
  try {
    const result = await client.query(query, [name, email]);
    response.status(200).send({ message: "client added successfully" });
  } catch (e) {
    if (
      e.toString().includes("duplicate key value violates unique constraint")
    ) {
      console.log(e);
      response.status(200).send({ message: "email already exists" });
    }
  }
});
router.post(
  "/createAccount",
  checkDomainAndReturnClientId,
  async (request, response) => {
    const { name, email, password, role, mobileNumber } = request.body;
    const query = `INSERT INTO users(name, email,password_hash,role,client_id,mobile_number)VALUES ($1,$2,$3,$4,$5,$6);`;
    try {
      await client.query(query, [
        name,
        email,
        password,
        role,
        request.client_id,
        mobileNumber,
      ]);
      response.status(200).send({ message: "account created successfully" });
    } catch (e) {
      console.log(e);
      if (
        e.toString().includes("duplicate key value violates unique constraint")
      ) {
        console.log(e);
        response.status(200).send({ message: "email already exists" });
      }
    }
  }
);

router.get(
  "/getRecentAdSubmission",
  checkDomainAndReturnClientId,
  auth,
  async (request, response) => {
    const query = `select title,description,status,created_at from ads where client_id='${request.client_id}' order by created_at limit 4`;
    try {
      const result = await client.query(query);
      response.status(200).json(result.rows);
    } catch (e) {
      response.status(500).send("Something went wrong");
    }
  }
);
router.get(
  "/getScreenStatus",
  checkDomainAndReturnClientId,
  auth,
  async (request, response) => {
    const query = `select device_name,location,status,registered_at from devices where client_id='${request.client_id}' order by registered_at limit 4`;
    try {
      const result = await client.query(query);
      response.status(200).json(result.rows);
    } catch (e) {
      response.status(500).send("Something went wrong");
    }
  }
);
router.get(
  "/getScreenManagementCounts",
  checkValidClient,
  auth,
  async (req, res) => {
    const query = `select count(*) from devices where client_id = '${req.client_id}'`;
    const onlineDevices = `select count(*) from devices where client_id = '${req.client_id}' and status='active'`;
    const offlineDevices = `select count(*) from devices where client_id ='${req.client_id}' and status='offline'`;
    const playingAds = `select count(*) from ads where client_id ='${req.client_id}' and status='approved'`;
    try {
      const deviceCount = await client.query(query);
      const onlineDevicesCount = await client.query(onlineDevices);
      const offlineCount = await client.query(offlineDevices);
      const playingAdsCount = await client.query(playingAds);
      console.log(
        deviceCount.rows[0]["count"],
        onlineDevicesCount.rows[0]["count"],
        offlineCount.rows[0]["count"],
        playingAdsCount.rows[0]["count"]
      );
      res.status(200).send({
        totalDevices: deviceCount.rows[0]["count"],
        onlineDevices: onlineDevicesCount.rows[0]["count"],
        offlineDevices: offlineCount.rows[0]["count"],
        playingAds: playingAdsCount.rows[0]["count"],
      });
    } catch (excemption) {
      console.log(excemption);

      res.status(500).json({
        message: "Oops! unable fetData",
      });
    }
  }
);

router.get("/getAllScreensData", checkValidClient, auth, async (req, res) => {
  // const query = `SELECT a.*, d.device_name,d.location,d.status AS device_status,d.registered_at FROM ads a  JOIN devices d ON a.device_id=d.id where a.client_id='${req.client_id}' and d.client_id = '${req.client_id}'`;
  const query = `SELECT 
    d.id AS device_id,
    d.device_name,
    d.location,
    d.status AS device_status,
    d.registered_at,
    d.emergency_mode,
    json_agg(
        json_build_object(
            'ad_id', a.id,
            'title', a.title,
            'description', a.description,
            'created_at', a.created_at,
            'started_at',a.start_time ,
            'end_time',a.end_time,
            'media_type',a.media_type,
            'media_url',a.media_url,
            'status',a.status
        )
    ) AS ads
FROM devices d
LEFT JOIN ads a ON a.device_id = d.id AND a.client_id = d.client_id
WHERE d.client_id = '${req.client_id}'
GROUP BY d.id, d.device_name, d.location, d.status, d.registered_at,d.emergency_mode;`;

  try {
    const adsAndDeviceData = await client.query(query);
    res.status(200).json(adsAndDeviceData.rows);
  } catch (excemption) {
    console.log(excemption);

    res.status(500).json({
      message: "Oops! unable fetData",
    });
  }
});
router.get("/getAdReviewCounts", checkValidClient, auth, async (req, res) => {
  const query = `select count(*) from ads where client_id = '${req.client_id}' and status='in_review'`;
  const todayApproved = `SELECT status, COUNT(*) AS count FROM ads WHERE client_id = '${req.client_id}'and DATE(status_updated_at) = CURRENT_DATE GROUP BY status;`;
  const rejected = `select count(*) from ads where client_id ='${req.client_id}' and status='rejected'`;
  const totalReviewed = `select count(*) from ads where client_id ='${req.client_id}' and status!='in_review'`;
  try {
    const reviewPendingCount = await client.query(query);
    const todayApprovedCount = await client.query(todayApproved);
    const recjectedCount = await client.query(rejected);
    const totalReviewedCount = await client.query(totalReviewed);
    console.log(
      reviewPendingCount.rows[0]["count"],
      todayApprovedCount.rows,
      recjectedCount.rows[0]["count"],
      totalReviewedCount.rows[0]["count"]
    );
    res.status(200).send({
      totalPending: reviewPendingCount.rows[0]["count"],
      approvedToday: todayApprovedCount.rows,
      rejected: recjectedCount.rows[0]["count"],
      totalReviewed: totalReviewedCount.rows[0]["count"],
    });
  } catch (excemption) {
    console.log(excemption);

    res.status(500).json({
      message: "Oops! unable fetData",
    });
  }
});
router.get("/getAdreviewData", checkValidClient, auth, async (req, res) => {
  const query = `select * from ads where client_id = '${req.client_id}' and status='in_review'`;
  const approved = `select * from ads where client_id = '${req.client_id}' and status='approved'`;
  const rejected = `select * from ads where client_id = '${req.client_id}' and status='rejected'`;
  try {
    const reviewPendingCount = await client.query(query);
    const todayApprovedCount = await client.query(approved);
    const recjectedCount = await client.query(rejected);
    console.log(
      reviewPendingCount.rows,
      todayApprovedCount.rows,
      recjectedCount.rows
    );
    res.status(200).send({
      pendingAds: reviewPendingCount.rows,
      approvedAds: todayApprovedCount.rows,
      rejected: recjectedCount.rows,
    });
  } catch (excemption) {
    console.log(excemption);

    res.status(500).json({
      message: "Oops! unable fetData",
    });
  }
});
router.post(
  "/deviceAction",
  checkValidClient,
  auth,
  async (request, response) => {
    const { device_id, status } = request.body;
    const query = `update devices set status ='${status}' where client_id = '${request.client_id}' and id ='${device_id}' RETURNING *`;

    try {
      const result = await client.query(query);
      response.status(200).json(result.rows[0]);
    } catch (e) {
      response.status(500).send({ message: "somthing went wrong" });
    }
  }
);
router.post( "/enableEmergencyMode",checkValidClient,auth,  async (request, response) => {
    const { device_id, status } = request.body;
    const query = `update devices set emergency_mode ='${status}' where client_id = '${request.client_id}' and id ='${device_id}' RETURNING *`;

    try {
      const result = await client.query(query);
      response.status(200).json(result.rows[0]);
    } catch (e) {
      response.status(500).send({ message: "somthing went wrong" });
    }
  }
);
router.post( "/approveRejectAd",  checkValidClient,  auth, async (request, response) => {
    const { ad_id, status } = request.body;
    const query = `update ads set status ='${status}' where client_id = '${request.client_id}' and id ='${ad_id}'`;
    try {
      const result = await client.query(query);
      response.status(200).json(result.rows[0]);
    } catch (e) {
      response.status(500).send({ message: "somthing went wrong" });
    }
  }
);
router.get(
  "/checkDeviceStatus",
  checkValidClient,
  auth,
  async (request, response) => {
    const { device_id } = request.query;
    const query = `
SELECT 
    d.id AS device_id,
    d.device_name,
    d.location,
    d.status AS device_status,
    d.registered_at,
    d.emergency_mode,
    json_agg(
        json_build_object(
            'ad_id', a.id,
            'title', a.title,
            'description', a.description,
            'created_at', a.created_at,
            'started_at',a.start_time ,
            'end_time',a.end_time,
            'media_type',a.media_type,
            'media_url',a.media_url,
            'status',a.status
          
        )
    ) AS ads
FROM devices d
LEFT JOIN ads a 
    ON a.device_id = d.id 
    AND a.client_id = d.client_id
WHERE d.client_id = '${request.client_id}'
  AND d.id = '${device_id}'
GROUP BY d.id, d.device_name, d.location, d.status, d.registered_at,d.emergency_mode;
`;
    try {
      const result = await client.query(query);
      response.status(200).json(result.rows[0]);
    } catch (e) {
      response.status(500).send({ message: "somthing went wrong" });
    }
  }
);

router.get("/getDevices", checkValidClient, auth, async (request, response) => {
  const query = `select * from devices where client_id = $1`;

  try {
    const result = await client.query(query, [request.client_id]);
    response.status(200).json(result.rows);
  } catch (e) {
    response.status(500).send({ message: "error fetching devices" });
  }
});
router.get(
  "/getEmergencyAds",
  checkValidClient,
  auth,
  async (request, response) => {
    const { id } = request.query;
    const query = `select * from ads where client_id = $1 and device_id=$2`;

    try {
      const result = await client.query(query, [request.client_id, id]);
      response.status(200).json(result.rows);
    } catch (e) {
      response.status(500).send({ message: "error fetching devices" });
    }
  }
);
router.get("/saveDevice", checkValidClient, auth, async (request, response) => {
  const { status, location } = request.query;
  const nameQuery = `select name from clients where id = '${request.client_id}'`;

  try {
    const nameResult = await client.query(nameQuery);
    const name = nameResult.rows[0]["name"];

    const query = `insert into devices (client_id,device_name,location,status)VALUES('${
      request.client_id
    }','${generateDID(name)}','${location}','${status}')`;
    try {
      const result = await client.query(query);
      response.status(200).send({ message: "Device added" });
    } catch (e) {
      response.status(200).send({ message: "error adding device" });
    }
  } catch (e) {
    response.status(200).send({ message: "error finding client" });
  }
});
function generateDID(str) {
  // Take first 4 characters and make them uppercase
  const prefix = str.substring(0, 4).toUpperCase();

  // Generate a random 4-digit number (1000–9999)
  const randomNum = Math.floor(1000 + Math.random() * 9000);

  return `${prefix}-${randomNum}`;
}

router.get(
  "/deleteDevice",
  checkValidClient,
  auth,
  async (request, response) => {
    const { id } = request.query;
    const query = `delete from devices where id=$1 and client_id =$2`;
    try {
      const result = await client.query(query, [id, request.client_id]);
      response.status(200).send({ message: "Device deleted" });
    } catch (e) {
      response.status(200).send({ message: "Error deleting device" });
    }
  }
);
module.exports = router;
