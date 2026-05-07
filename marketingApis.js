const { express, db, uuidv4 } = require("./deps");

const router = express.Router();

async function ensureContactSubmissionsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      company_name TEXT,
      phone TEXT,
      subject TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

router.post("/contact-submissions", async (req, res) => {
  const {
    full_name,
    email,
    company_name = null,
    phone = null,
    subject = null,
    message,
  } = req.body || {};

  if (!full_name || !email || !message) {
    return res.status(400).json({
      success: false,
      error: "full_name, email and message are required",
    });
  }

  try {
    await ensureContactSubmissionsTable();

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO contact_submissions
        (id, full_name, email, company_name, phone, subject, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, company_name, phone, subject, message, created_at`,
      [id, full_name, email, company_name, phone, subject, message]
    );

    return res.status(201).json({
      success: true,
      message: "Thank you. Your message has been submitted.",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating contact submission:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to submit contact form" });
  }
});

router.get("/contact-submissions", async (req, res) => {
  try {
    await ensureContactSubmissionsTable();

    const result = await db.query(
      `SELECT id, full_name, email, company_name, phone, subject, message, created_at
       FROM contact_submissions
       ORDER BY created_at DESC`
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching contact submissions:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to fetch contact submissions" });
  }
});

module.exports = router;

