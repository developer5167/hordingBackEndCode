// superadminApis.js
const { express, bcrypt, jwt, nodemailer, db, uuidv4 } = require("./deps");

const router = express.Router();

// 📌 Utility: generate random password
function generatePassword() {
  return Math.random().toString(36).slice(-8);
}

// 📌 Utility: send email with credentials
async function sendAdminEmail(to, email, password) {
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: "Your Admin Account Created",
      text: `Hello,\n\nYour admin account has been created.\nEmail: ${email}\nPassword: ${password}\n\nPlease login and change your password.`
    });
  } catch (err) {
    console.error("Email sending failed:", err);
  }
}

/**
 * 1. Create Client + Admin
 * POST /superadmin/clients
 */
router.post("/clients", async (req, res) => {
  const { name, domain, adminEmail } = req.body;

  if (!name || !domain || !adminEmail) {
    return res.status(400).json({ error: "name, domain, adminEmail are required" });
  }

  try {
    // Insert client
    const clientResult = await db.query(
      `INSERT INTO clients (name, domain, subscription_status, created_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING id`,
      [name, domain]
    );

    const clientId = clientResult.rows[0].id;

    // Create admin user
    const tempPassword = generatePassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.query(
      `INSERT INTO users (client_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [clientId, "Admin", adminEmail, passwordHash]
    );

    // Send email
    await sendAdminEmail(adminEmail, adminEmail, tempPassword);

    return res.json({
      clientId,
      admin: {
        email: adminEmail,
        tempPassword
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create client" });
  }
});

/**
 * 2. List Clients
 * GET /superadmin/clients
 */
router.get("/clients", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, domain, subscription_status, created_at
       FROM clients
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

/**
 * 3. Update Client Info
 * PUT /superadmin/clients/:id
 */
router.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { name, domain, subscription_status } = req.body;

  try {
    await db.query(
      `UPDATE clients
       SET name = COALESCE($1, name),
           domain = COALESCE($2, domain),
           subscription_status = COALESCE($3, subscription_status)
       WHERE id = $4`,
      [name, domain, subscription_status, id]
    );

    res.json({ message: "Client updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update client" });
  }
});

/**
 * 4. Block Client
 * POST /superadmin/clients/:id/block
 */
router.post("/clients/:id/block", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE clients SET subscription_status = 'blocked' WHERE id = $1`,
      [id]
    );

    // Pause all ads of this client
    await db.query(
      `UPDATE ads SET status = 'paused', status_updated_at = NOW()
       WHERE client_id = $1 AND status = 'active'`,
      [id]
    );

    res.json({ message: "Client blocked and ads paused" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to block client" });
  }
});

/**
 * 5. Unblock Client
 * POST /superadmin/clients/:id/unblock
 */
router.post("/clients/:id/unblock", async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE clients SET subscription_status = 'active' WHERE id = $1`,
      [id]
    );
    res.json({ message: "Client unblocked" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unblock client" });
  }
});

module.exports = router;
