// superadminApis.js
const { express, bcrypt, jwt, nodemailer, db, uuidv4 } = require("./deps");

const router = express.Router();

// 📌 Utility: generate random password
function generatePassword() {
  return Math.random().toString(36).slice(-8);
}

async function sendAdminEmail(to, email, password, clientId) {
  console.log(password);

  const mailRequest = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailingOptions = {
    from: process.env.SMTP_FROM,
    to: to,
    subject: "Your Admin Account Has Been Created",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #3399cc; margin-bottom: 4px;">Welcome to Hoarding SaaS</h2>
        <p style="color: #555; margin-top: 0;">Your admin account has been created. Use the credentials and Company ID below to log in.</p>

        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <tr style="background: #f5f5f5;">
            <td style="padding: 12px 16px; font-weight: bold; color: #333; width: 40%;">Email</td>
            <td style="padding: 12px 16px; color: #333;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; font-weight: bold; color: #333;">Password</td>
            <td style="padding: 12px 16px; color: #333;">${password}</td>
          </tr>
          <tr style="background: #f5f5f5;">
            <td style="padding: 12px 16px; font-weight: bold; color: #333;">Company ID</td>
            <td style="padding: 12px 16px; font-family: monospace; color: #3399cc; font-size: 15px;">${clientId}</td>
          </tr>
        </table>

        <div style="margin-top: 24px; padding: 14px 16px; background: #fff8e1; border-left: 4px solid #ffc107; border-radius: 4px;">
          <strong style="color: #555;">Important:</strong>
          <p style="color: #555; margin: 6px 0 0;">Enter the <strong>Company ID</strong> on the login page when prompted. Please change your password after your first login.</p>
        </div>

        <p style="color: #999; font-size: 12px; margin-top: 32px;">This is an automated message from Hoarding SaaS. Please do not reply to this email.</p>
      </div>
    `,
  };

  try {
    const data = await mailRequest.sendMail(mailingOptions);
    console.log(data);
  } catch (excemption) {
    console.log(excemption);
  }
}
/**
 * 1. Create Client + Admin
 * POST /superadmin/clients
 */
router.post("/clients", async (req, res) => {
  const { name, domain, email } = req.body;

  if (!name || !domain || !email) {
    return res
      .status(400)
      .json({ error: "name, domain, adminEmail are required" });
  }

  try {
    // Insert client
    const clientResult = await db.query(
      `INSERT INTO clients (name, client_domains, subscription_status, created_at,email)
       VALUES ($1, $2, 'active', NOW(),$3)
       RETURNING id`,
      [name, domain, email]
    );

    const clientId = clientResult.rows[0].id;

    // Create admin user
    const tempPassword = generatePassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.query(
      `INSERT INTO users (client_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [clientId, "Admin", email, passwordHash]
    );

    // Send email with credentials + company ID
    await sendAdminEmail(email, email, tempPassword, clientId);

    const response = await db.query(`select * from clients where id = $1`, [
      clientId,
    ]);
    return res.json(response.rows[0]);
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
      `SELECT id, name, client_domains, email,subscription_status, created_at
       FROM clients
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

router.get("/clients-recent", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM clients
       ORDER BY created_at DESC limit 4`
    );
    const statsQuery = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)) AS this_month,
        COUNT(*) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - interval '1 month')) AS last_month
      FROM clients
    `);
    const { this_month, last_month } = statsQuery.rows[0];
    const thisMonth = parseInt(this_month, 10) || 0;
    const lastMonth = parseInt(last_month, 10) || 0;

    let growth = 0;
    if (lastMonth > 0) {
      growth = ((thisMonth - lastMonth) / lastMonth) * 100;
    } else if (thisMonth > 0) {
      growth = 100; // if last month had 0 but new clients exist
    }
    const clientsWithGrowth = result.rows.map((row) => ({
      ...row,
      growth: growth.toFixed(1), // e.g. "15.3"
    }));
    console.log(clientsWithGrowth);

    res.json(clientsWithGrowth);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch clients" });
  }
});

/**
 * 3. Update Client Info
 * PUT /superadmin/clients/:id
 */
// insert client id in ad_devices while inserting ad
router.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { name, domain, subscription_status } = req.body;

  try {
    const result = await db.query(
      `UPDATE clients
       SET name = COALESCE($1, name),
           client_domains = COALESCE($2, client_domains),
           subscription_status = COALESCE($3, subscription_status)
       WHERE id = $4 RETURNING *`,
      [name, domain, subscription_status, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update client" });
  }
});

router.post("/disable-subscription/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const query = `select status from subscription_plans where id=$1`;
    const { rows } = await db.query(query, [id]);
    console.log(rows[0].status)
    let status_value;
    if (rows[0].status == true) {
      status_value = false;
    } else {
      status_value = true;
    }
    const result = await db.query(
      `UPDATE subscription_plans
       SET status =${status_value} WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json(result.rows[0]);
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
    const clientResult = await db.query(
      `UPDATE clients SET subscription_status = 'blocked' WHERE id = $1 RETURNING *`,
      [id]
    );

    // Pause all ads of this client
    await db.query(
      `UPDATE ad_devices SET status = 'paused', status_updated_at = NOW()
       WHERE client_id = $1 AND status = 'active'`,
      [id]
    );
    res.json(clientResult.rows[0]);
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
    const result = await db.query(
      `UPDATE clients SET subscription_status = 'active' WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to unblock client" });
  }
});
/**
 * 6. Delete Client
 * DELETE /superadmin/clients/:id
 */
router.delete("/clients/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Delete all related data (cascade cleanup)
    await db.query("BEGIN");

    // Delete ads (and cascade ad_devices)
    await db.query(`DELETE FROM ads WHERE client_id = $1`, [id]);

    // Delete devices
    await db.query(`DELETE FROM devices WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM ad_devices WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM ad_statistics WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM ad_reviews WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM company_ads WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM payments WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM pricing_rules WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM pricing WHERE client_id = $1`, [id]);
    await db.query(`DELETE FROM subscriptions where client_id = $1`, [id]);

    // Delete users
    await db.query(`DELETE FROM users WHERE client_id = $1`, [id]);

    // Finally delete client
    const result = await db.query(
      `DELETE FROM clients WHERE id = $1 RETURNING *`,
      [id]
    );

    await db.query("COMMIT");

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json({
      message: "Client deleted successfully",
      client: result.rows[0],
    });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Failed to delete client" });
  }
});

module.exports = router;
