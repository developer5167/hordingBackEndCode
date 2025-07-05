const express = require("./express_file");
const path = require("path");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const multer = require("multer");

const jwtToken = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const auth = require("./middleware/auth");
const client = require("./db");
const WebSocket = require("ws");

const router = express.Router();
const timers = {};
const { admin, fcm } = require("./firebaseAdmin");

const upload = multer({ storage: multer.memoryStorage() });
const bucket = admin.storage().bucket();

// Static access to .well-known folder (e.g., for SSL certs)
router.use("/.well-known", express.static(path.join(__dirname, ".well-known")));

// Basic health check or welcome route
router.get("/", (req, res) => {
  res.send("welcome");
});

router.post("/createUser", async function (req, res) {
  const { email, password, name, mobile_number, isActive, fcmtoken } = req.body;
  const hashedPassword = await bcrypt.hash(password, 8);
  console.log(email, hashedPassword.length, fcmtoken);
  try {
    await client.query(
      "INSERT INTO hording_users(email,password,name,mobile_number,isActive,fcmtoken)VALUES($1,$2,$3,$4,$5,$6)",
      [email, hashedPassword, name, mobile_number, isActive, fcmtoken]
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

router.post("/upload", auth, upload.single("file"), async (req, res) => {
  const file = req.file;
  const userId = req.body.user_id;
  if (!file || !userId) {
    return res.status(400).json({ error: "File and user_id are required" });
  }
  try {
    const filename = `uploads/${userId}/${Date.now()}_${file.originalname}`;
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
  const { email } = req.body;
  try {
    const validation = await checkEmail(email);
    // const validation = true;
    validation
      ? (await sendEmail(email))
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
async function checkEmail(email) {
  const query = `SELECT count(*) email from hording_users where email=$1`;
  try {
    const rowss = await client.query(query, [email]);
    console.log(rowss.rows[0]["email"]);
    return rowss.rows[0]["email"] == 0 ? false : true;
  } catch (exception) {
    console.log(exception);
    return false;
  }
}
async function sendEmail(email) {
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
    const query = `insert into otp (email,otp) values($1,$2)`;
    await client.query(query, [email, OTP]);
    countdown(3 * 60, email);
    return true;
  } catch (excemption) {
    return false;
  }
}
const countdown = (duration, email) => {
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
      deleteOtpFromDB(email);
      clearInterval(timerInterval);
      delete timers[timerInterval];
      console.log("Time is up!");
    }
  }, 1000);
  timers[email] = timerInterval;
};
const deleteOtpFromDB = async (email) => {
  const query = "delete from otp where email =$1";
  await client.query(query, [email]);
  console.log("OTP DELETED");
};
router.post("/verifyOtp", async (req, res) => {
  const { email, otp } = req.body;
  const query = `select otp from otp where email='${email}' order by created_at desc limit 1`;
  console.log(email, otp);
  try {
    const result = await client.query(query);
    console.log(result);
    if (result.rows.length > 0) {
      const DbOtp = result.rows[0]["otp"];
      console.log(DbOtp, otp);
      if (DbOtp === otp) {
        const query = "delete from otp where email =$1";
        await client.query(query, [email]);
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
    clearInterval(timers[email]); // Cancel the timer
    delete timers[email];
    res.status(500).json({ error: err });
  }
});

router.post("/changeLoginPassword", async (req, res) => {
  const { password, email } = req.body;
  console.log(password, email);
  if (password == undefined || email == undefined) {
    res.status(400).json({ message: "Bad request" });
    return;
  }
  const encryptPassword = await bcrypt.hash(password, 8);
  const query = `Update hording_users set password=$1,tokens=$2 where email=$3`;
  try {
    await client.query(query, [encryptPassword, [], email]);
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
});
router.post("/saveAdData", async (req, res) => {
  const {
    user_id,
    fileName,
    end_date,
    start_date,
    device_id,
    description,
    title,
    ad_data,
    isactive,
    isapproved,
    meme_type,
  } = req.body;
  const query = `insert into ads(ad_id, ad_data, user_id, isapproved, meme_type, isactive, start_date, end_date, title, description, device_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;
  try {
    await client.query(query, [
      generateAdId(),
      ad_data,
      user_id,
      isapproved,
      meme_type,
      isactive,
      start_date,
      end_date,
      title,
      description,
      device_id,
    ]);
    res.status(200).send({ message: "Saved Successfully" });
  } catch (e) {
    console.log(`Exception: ${e}`);
    deleteFileFromStorage(fileName);
    res.status(500).send({ message: "Something went wrong" });
  }
});
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
  const query = `insert into company_ads(ad_id, ad_data, meme_type, isactive, title, description, device_id)
  VALUES($1,$2,$3,$4,$5,$6,$7)`;
  try {
    await client.query(query, [
      generateAdId(),
      ad_data,
      meme_type,
      isactive,
      title,
      description,
      device_id,
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
    console.error("Error deleting file:", err.message);
  }
}
function generateAdId() {
  const randomNumber = Math.floor(10000000 + Math.random() * 90000000);
  return `AD-${randomNumber}`;
}
router.post("/login", async (request, response) => {
  const { email, password, fcmtoken } = request.body;
  console.log(email, password);
  try {
    var sql = "SELECT email,tokens,password FROM hording_users WHERE email=$1";
    const { rows } = await client.query(sql, [email]);
    console.log(rows);
    const newTokenList = [];
    if (rows.length != 0) {
      const existingToken = rows[0].tokens;

      if (existingToken != null) {
        for (let i = 0; i < existingToken.length; i++) {
          newTokenList.push(existingToken[i]);
        }
      }
      const DbPassword = rows[0].password;
      const isMatched = await bcrypt.compare(password, DbPassword);
      console.log(isMatched);
      if (isMatched) {
        const newToken = jwtToken.sign({ email }, "THISISTESTAPP");
        newTokenList.push(newToken);
        const queryText =
          "UPDATE hording_users SET tokens =$1,fcmtoken=$3 WHERE email = $2 RETURNING *";
        await client.query(
          queryText,
          [newTokenList, email, fcmtoken],
          function (err, result) {
            if (result) {
              var token = "";
              if (result.rows[0].tokens.length > 0) {
                token = result.rows[0].tokens[result.rows[0].tokens.length - 1];
              } else {
                token = newToken;
              }
              response.status(200).send({
                email: result.rows[0].email,
                token: token,
                user_id: result.rows[0].user_id,
                name: result.rows[0].name,
                joined: result.rows[0].joined_date,
                mobile_number: result.rows[0].mobile_number,
              });
            } else {
              response.status(200).send({
                message: err["details"],
              });
            }
          }
        );
      } else {
        response.status(500).send({ message: "invalid credentials" });
      }
    } else {
      response.status(500).send({ message: "invalid credentials" });
    }
  } catch (e) {
    console.log(e);
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

router.get("/fetchUserActiveAds", async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isapproved=true and isactive=true and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserPausedAds", async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isactive=false and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserInReviewAds", async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() BETWEEN start_date AND end_date AND isapproved=false and isactive=false and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});
router.get("/fetchUserExpiredAds", async (req, response) => {
  const { user_id } = req.query;
  const query = `SELECT * FROM ads WHERE NOW() > end_date and user_id=${user_id}`;
  const result2 = await client.query(query);
  if (result2.rowCount > 0) {
    response.status(200).json(result2.rows);
  } else {
    response.status(200).json([]);
  }
});

router.get("/getDeviceIds", async (request, response) => {
  const query = `select * from hording_devices`;
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

router.get("/getStatics", async (request, response) => {
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
router.post("/addStats", async (request, response) => {
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
router.get("/turnOfClientAds", async (request, response) => {
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
router.get("/turnOffAllAds", async (request, response) => {
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
router.get("/getAllSettingsEvent", async (request, response) => {
  const { device_id } = request.query;
  const insertQuery = `select * from show_ad_type where device_id ='${device_id}'`;
  try {
    const result = await client.query(insertQuery);
    const device_id = result.rows[0]["device_id"];
    const disable_client_ads = result.rows[0]["disable_client_ads"];
    const pause_all_ads = result.rows[0]["pause_all_ads"];
    response
      .status(200)
      .json({ deviceId: device_id, showClientAds: disable_client_ads,pauseAllAds:pause_all_ads });
  } catch (e) {
    console.log(e);
    response.status(500);
  }
});

module.exports = router;
