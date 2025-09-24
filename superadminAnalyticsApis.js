
// superadminAnalyticsApis.js
const { express, db } = require("./deps");
const router = express.Router();

/**
 * GET /superadmin/analytics/overview
 * Returns overall platform stats
 */
router.get("/analytics/overview", async (req, res) => {
  try {
    const clientStats = await db.query(`
      SELECT 
        COUNT(*) AS total_clients,
        COUNT(*) FILTER (WHERE subscription_status = 'active') AS active_clients,
        COUNT(*) FILTER (WHERE subscription_status = 'blocked') AS blocked_clients
      FROM clients
    `);

    const adStats = await db.query(`
      SELECT 
        COUNT(*) AS total_ads,
        COUNT(*) FILTER (WHERE status = 'active') AS active_ads,
        COUNT(*) FILTER (WHERE status = 'paused') AS paused_ads,
        COUNT(*) FILTER (WHERE status = 'in_review') AS in_review_ads
      FROM ad_devices
    `);

    const revenueStats = await db.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_revenue
      FROM payments
      WHERE status = 'success'
    `);

    return res.json({
      success: true,
      data: {
        ...clientStats.rows[0],
        ...adStats.rows[0],
        ...revenueStats.rows[0]
      }
    });
  } catch (err) {
    console.error("Error fetching overview analytics:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch overview analytics" });
  }
});

/**
 * GET /superadmin/analytics/revenue-by-client
 */
router.get("/analytics/revenue-by-client", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT c.id AS client_id, c.name AS client_name, COALESCE(SUM(p.amount), 0) AS revenue
      FROM clients c
      LEFT JOIN payments p ON p.client_id = c.id AND p.status = 'success'
      GROUP BY c.id, c.name
      ORDER BY revenue DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching revenue by client:", err);
    res.status(500).json({ success: false, error: "Failed to fetch revenue by client" });
  }
});

/**
 * GET /superadmin/analytics/ads-by-client
 */
// GET /superadmin/analytics/ads-by-client
router.get("/analytics/ads-by-client", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        c.id AS client_id,
        c.name AS client_name,
        COUNT(DISTINCT a.id) AS total_ads,
        COUNT(ad.*) FILTER (WHERE ad.status = 'active') AS active_ads,
        COUNT(ad.*) FILTER (WHERE ad.status = 'paused') AS paused_ads,
        COUNT(ad.*) FILTER (WHERE ad.status = 'in_review') AS in_review_ads,
        COUNT(ad.*) FILTER (WHERE ad.status = 'expired') AS expired_ads
      FROM clients c
      LEFT JOIN ads a ON a.client_id = c.id
      LEFT JOIN ad_devices ad ON ad.ad_id = a.id
      GROUP BY c.id, c.name
      ORDER BY total_ads DESC
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching ads by client:", err);
    res.status(500).json({ success: false, error: "Failed to fetch ads by client" });
  }
});


/**
 * GET /superadmin/analytics/recent-payments
 */
router.get("/analytics/recent-payments", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id AS payment_id, p.amount, p.status, p.created_at,
             c.name AS client_name, u.name AS advertiser_name
      FROM payments p
      JOIN clients c ON p.client_id = c.id
      JOIN users u ON p.advertiser_id = u.id
      WHERE p.status = 'success'
      ORDER BY p.created_at DESC
      LIMIT 10
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("Error fetching recent payments:", err);
    res.status(500).json({ success: false, error: "Failed to fetch recent payments" });
  }
});

/**
 * GET /superadmin/analytics/trends?period=month
 */
router.get("/analytics/trends", async (req, res) => {
  try {
    const period = req.query.period || "month";
    const trunc = period === "day" ? "day" : "month";

    const clientsQ = db.query(`
      SELECT DATE_TRUNC($1, created_at) AS period, COUNT(*) AS new_clients
      FROM clients
      GROUP BY period
      ORDER BY period DESC
      LIMIT 12
    `, [trunc]);

    const adsQ = db.query(`
      SELECT DATE_TRUNC($1, created_at) AS period, COUNT(*) AS new_ads
      FROM ads
      GROUP BY period
      ORDER BY period DESC
      LIMIT 12
    `, [trunc]);

    const revenueQ = db.query(`
      SELECT DATE_TRUNC($1, created_at) AS period, SUM(amount) AS revenue
      FROM payments
      WHERE status = 'success'
      GROUP BY period
      ORDER BY period DESC
      LIMIT 12
    `, [trunc]);

    const [clients, ads, revenue] = await Promise.all([clientsQ, adsQ, revenueQ]);

    res.json({
      success: true,
      data: {
        clients: clients.rows,
        ads: ads.rows,
        revenue: revenue.rows
      }
    });
  } catch (err) {
    console.error("Error fetching trends:", err);
    res.status(500).json({ success: false, error: "Failed to fetch trends" });
  }
});

module.exports = router;
