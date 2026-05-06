// couponApis.js — Coupon system for Digital Hording Manager by SOTER SYSTEMS
const { express, db } = require("./deps");
const router = express.Router();

async function ensureCouponsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code VARCHAR(30) UNIQUE NOT NULL,
      creator_type VARCHAR(20) NOT NULL CHECK (creator_type IN ('SUPERADMIN', 'CLIENT')),
      creator_id UUID, 
      target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('CLIENT', 'CUSTOMER')),
      is_global BOOLEAN DEFAULT FALSE,
      target_id UUID, 
      discount_pct NUMERIC(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS coupon_usages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
      user_id UUID NOT NULL, 
      used_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(coupon_id, user_id)
    );
  `);
}
ensureCouponsTable().catch(console.error);

function makeCouponCode(prefix = "DHM") {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = prefix + "-";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ────────────────────────────────────────────
// POST /create
// Body: { target_id (uuid | 'ALL'), discount_pct, expires_at? }
// ────────────────────────────────────────────
router.post("/create", async (req, res) => {
  try {
    const { target_id, discount_pct, expires_at } = req.body;
    if (!target_id || !discount_pct) {
      return res.status(400).json({ success: false, message: "target_id and discount_pct are required" });
    }
    if (Number(discount_pct) <= 0 || Number(discount_pct) > 100) {
      return res.status(400).json({ success: false, message: "discount_pct must be between 1 and 100" });
    }

    const is_global = target_id === 'ALL';
    const final_target_id = is_global ? null : target_id;
    let creator_type, creator_id, target_type, targetName = "All";

    if (req.baseUrl.includes("/superadmin")) {
      creator_type = "SUPERADMIN";
      creator_id = null;
      target_type = "CLIENT";
      if (!is_global) {
        const check = await db.query("SELECT name FROM clients WHERE id = $1", [final_target_id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, message: "Client not found" });
        targetName = check.rows[0].name;
      } else {
        targetName = "All Clients";
      }
    } else if (req.baseUrl.includes("/admin")) {
      creator_type = "CLIENT";
      creator_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];
      if (!creator_id) return res.status(401).json({ success: false, message: "Missing client key" });
      target_type = "CUSTOMER";
      if (!is_global) {
        const check = await db.query("SELECT name FROM users WHERE id = $1 AND client_id = $2", [final_target_id, creator_id]);
        if (check.rows.length === 0) return res.status(404).json({ success: false, message: "Customer not found" });
        targetName = check.rows[0].name;
      } else {
        targetName = "All Customers";
      }
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized creation route" });
    }

    const code = makeCouponCode(creator_type === "SUPERADMIN" ? "SOT" : "CUP");
    const { rows } = await db.query(
      `INSERT INTO coupons (code, creator_type, creator_id, target_type, is_global, target_id, discount_pct, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, creator_type, creator_id, target_type, is_global, final_target_id, Number(discount_pct), expires_at || null]
    );

    // TODO: Send Push Notification here if target_type == CUSTOMER && !is_global
    if (target_type === "CUSTOMER" && !is_global) {
      // Use existing notification logic if available, or fetch FCM token
      try {
        const adminApis = require('./adminApis'); // fallback if needed, or query db
        const userCheck = await db.query("SELECT fcmtoken FROM users WHERE id = $1", [final_target_id]);
        if (userCheck.rows.length > 0 && userCheck.rows[0].fcmtoken) {
          const fcmToken = userCheck.rows[0].fcmtoken;
          const payload = {
            notification: {
              title: "Exclusive Discount For You! 🎉",
              body: `Apply code ${code} for ${discount_pct}% off your next payment.`,
            },
          };
          const { admin } = require("./deps");
          if (admin) {
            admin.messaging().sendToDevice(fcmToken, payload).catch(console.error);
          }
        }
      } catch (pushErr) {
        console.error("Failed to send push notification:", pushErr);
      }
    }

    return res.json({
      success: true,
      coupon: {
        ...rows[0],
        target_name: targetName
      }
    });
  } catch (err) {
    console.error("Create coupon error:", err);
    res.status(500).json({ success: false, message: "Failed to create coupon", detail: err.message });
  }
});

// ────────────────────────────────────────────
// GET /
// Returns list of created coupons (for dashboards) or available coupons (for flutter app)
// ────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    if (req.baseUrl.includes("/superadmin")) {
      let q = `
        SELECT c.*, COALESCE(cl.name, 'All Clients') AS target_name,
               (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id) as usage_count
        FROM coupons c
        LEFT JOIN clients cl ON cl.id = c.target_id
        WHERE c.creator_type = 'SUPERADMIN'
        ORDER BY c.created_at DESC
      `;
      const { rows } = await db.query(q);
      return res.json({ success: true, coupons: rows });
    } else if (req.baseUrl.includes("/admin")) {
      const creator_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];
      let q = `
        SELECT c.*, COALESCE(u.name, 'All Customers') AS target_name,
               (SELECT COUNT(*) FROM coupon_usages us WHERE us.coupon_id = c.id) as usage_count
        FROM coupons c
        LEFT JOIN users u ON u.id = c.target_id
        WHERE c.creator_type = 'CLIENT' AND c.creator_id = $1
        ORDER BY c.created_at DESC
      `;
      const { rows } = await db.query(q, [creator_id]);
      return res.json({ success: true, coupons: rows });
    } else if (req.baseUrl.includes("/advertiser")) {
      const client_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];
      const { customer_id } = req.query;
      if (!customer_id) return res.status(400).json({ success: false, message: "customer_id is required" });

      let q = `
        SELECT c.*
        FROM coupons c
        WHERE c.creator_type = 'CLIENT' 
          AND c.creator_id = $1
          AND c.target_type = 'CUSTOMER'
          AND (c.is_global = TRUE OR c.target_id = $2)
          AND (c.expires_at IS NULL OR c.expires_at > NOW())
          AND NOT EXISTS (SELECT 1 FROM coupon_usages u WHERE u.coupon_id = c.id AND u.user_id = $2)
        ORDER BY c.created_at DESC
      `;
      const { rows } = await db.query(q, [client_id, customer_id]);
      return res.json({ success: true, coupons: rows });
    }
  } catch (err) {
    console.error("List coupons error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch coupons" });
  }
});

// ────────────────────────────────────────────
// DELETE /:id  (revoke coupon)
// ────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const usages = await db.query("SELECT 1 FROM coupon_usages WHERE coupon_id = $1", [id]);
    if (usages.rows.length > 0) return res.status(400).json({ success: false, message: "Cannot delete a coupon that has been used" });

    // verify ownership
    if (req.baseUrl.includes("/admin")) {
      const creator_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];
      const check = await db.query("SELECT * FROM coupons WHERE id = $1 AND creator_id = $2", [id, creator_id]);
      if (check.rows.length === 0) return res.status(404).json({ success: false, message: "Coupon not found" });
    }

    await db.query("DELETE FROM coupons WHERE id = $1", [id]);
    return res.json({ success: true, message: "Coupon deleted" });
  } catch (err) {
    console.error("Delete coupon error:", err);
    res.status(500).json({ success: false, message: "Failed to delete coupon" });
  }
});

// ────────────────────────────────────────────
// POST /validate
// Body: { code, customer_id? }
// ────────────────────────────────────────────
router.validateCouponLogic = async (code, user_id, expected_target_type, expected_creator_id = null) => {
  const { rows } = await db.query("SELECT * FROM coupons WHERE code = $1 AND target_type = $2", [code.trim().toUpperCase(), expected_target_type]);
  if (rows.length === 0) throw new Error("Invalid coupon code");
  const coupon = rows[0];

  if (expected_creator_id && String(coupon.creator_id) !== String(expected_creator_id)) {
    throw new Error("This coupon is not valid for your account");
  }

  if (!coupon.is_global && String(coupon.target_id) !== String(user_id)) {
    throw new Error("This coupon is not valid for your account");
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    throw new Error("This coupon has expired");
  }

  const usages = await db.query("SELECT 1 FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2", [coupon.id, user_id]);
  if (usages.rows.length > 0) {
    throw new Error("This coupon has already been used by you");
  }

  return coupon;
};

router.post("/validate", async (req, res) => {
  try {
    const { code, customer_id } = req.body;
    const client_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];

    if (!code) return res.status(400).json({ success: false, message: "Coupon code is required" });

    let coupon;
    if (req.baseUrl.includes("/admin")) {
      coupon = await router.validateCouponLogic(code, client_id, 'CLIENT', null);
    } else if (req.baseUrl.includes("/advertiser")) {
      if (!customer_id) return res.status(400).json({ success: false, message: "customer_id is required" });
      coupon = await router.validateCouponLogic(code, customer_id, 'CUSTOMER', client_id);
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized validation route" });
    }

    return res.json({
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_pct: Number(coupon.discount_pct),
        expires_at: coupon.expires_at,
      },
    });
  } catch (err) {
    return res.json({ success: false, message: err.message || "Failed to validate coupon" });
  }
});

// ────────────────────────────────────────────
// POST /mark-used
// Body: { coupon_id, customer_id? }
// ────────────────────────────────────────────
router.post("/mark-used", async (req, res) => {
  try {
    const { coupon_id, customer_id } = req.body;
    const client_id = req.headers["clientauthorisationkey"] || req.headers["clientauthorisationKey"];
    if (!coupon_id) return res.status(400).json({ success: false, message: "coupon_id is required" });

    let user_id;
    if (req.baseUrl.includes("/admin")) {
      user_id = client_id;
    } else if (req.baseUrl.includes("/advertiser")) {
      if (!customer_id) return res.status(400).json({ success: false, message: "customer_id is required" });
      user_id = customer_id;
    } else {
      return res.status(403).json({ success: false, message: "Unauthorized route" });
    }

    const check = await db.query("SELECT 1 FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2", [coupon_id, user_id]);
    if (check.rows.length > 0) {
      return res.status(400).json({ success: false, message: "Coupon already used" });
    }

    await db.query(
      "INSERT INTO coupon_usages (coupon_id, user_id) VALUES ($1, $2)",
      [coupon_id, user_id]
    );
    return res.json({ success: true, message: "Coupon marked as used" });
  } catch (err) {
    console.error("Mark-used coupon error:", err);
    res.status(500).json({ success: false, message: "Failed to mark coupon as used" });
  }
});

module.exports = router;
