const { express, auth, db } = require("./deps");
const crypto = require("crypto");

const router = express.Router();
const razorpay = require("./razorpay");
const checkValidClient = require("./middleware/checkValidClient");
const uuidV4 = require("uuid-v4");


// Razorpay instance (env vars required)

// Helper: convert rupees to paise
function toPaise(amountRupee) {
  return Math.round(Number(amountRupee) * 100);
}

// POST /superadmin/payments/create-plan
router.post('/create-plan', async (req, res) => {
  try {
    const { name, amount, period, max_devices, description } = req.body;
    if (!name || !amount || !period) {
      return res.status(400).json({ error: "name, amount, period required" });
    }

    const q = `
      INSERT INTO subscription_plans (name, amount, period, max_devices, description)
      VALUES ($1,$2,$3,$4,$5) RETURNING *`;
    const { rows } = await db.query(q, [name, amount, period, max_devices, description]);

    res.json({ success: true, plan: rows[0] });
  } catch (err) {
    console.error("Create plan error:", err);
    res.status(500).json({ error: "Failed to create plan" });
  }
});


router.get("/get-plans", async (req, res) => {
  try {
    const selectPlans = `select * from subscription_plans where status=true ORDER BY amount`;
    const { rows } = await db.query(selectPlans);
    return res.json(rows);
  } catch (err) {
    console.error("Error creating plan:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "failed_create_plan",
        detail: err.message,
      });
  }
});
router.post("/create-order", checkValidClient, auth, async (req, res) => {
  try {
    let { plan_id } = req.body; // amount in paise (e.g. 50000 = ₹500)

    const query = `select * from subscription_plans where id=$1`
    const result = await db.query(query,[plan_id])

    const planDetails = result.rows[0];

  
    const finalAmount = planDetails.amount * 100;
    const transactionId = `TXN-${uuidV4()}`;
    const receipt = `rcpt_${generateRandomId()}`;

    const options = {
      amount: finalAmount, // convert to paise
      currency:  "INR",
      receipt: receipt,
      payment_capture: 1,
       notes: { plan_id }, // auto-capture after auth
    };
  

    const order = await razorpay.orders.create(options);

    console.log(order.id)
      const initpayment =
      "insert into payments(client_id,amount,total_amount,status,transaction_id,receipt,razorpay_order_id)VALUES($1,$2,$3,$4,$5,$6,$7)";

    await db.query(initpayment, [
      req.client_id,
      finalAmount,
      finalAmount,
      "pending",
      transactionId,
      receipt,
      order.id
    ]);
    console.log(order)
    
    res.json({ ...order });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating order");
  }
});
// ✅ Verify Payment
router.post("/verify-payment", checkValidClient, auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const client_id = req.client_id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Step 1: Verify signature
    const hmac = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET) // use env var
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (hmac !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Signature mismatch" });
    }

    // Step 2: Fetch order details from Razorpay
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const plan_id = order.notes.plan_id;

    // Step 3: Fetch plan details
    const planRes = await db.query(`SELECT * FROM subscription_plans WHERE id=$1`, [plan_id]);
    if (planRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }
    const plan = planRes.rows[0];
    const now = new Date();

    // Step 4: Save successful payment in DB
    const updatePayment = `update payments set status='PAID',razorpay_payment_id=$2,razorpay_signature=$3,plan_id=$4 where razorpay_order_id=$1 AND client_id = $5 RETURNING *`;
   const payRes2= await db.query(updatePayment, [razorpay_order_id,razorpay_payment_id,razorpay_signature,plan_id, req.client_id]);
    const paymentRow = payRes2.rows[0];

    // Step 5: Delete all old pending orders for same client+plan
    

    // Step 6: Handle subscription logic
    const activeSubQ = `
      SELECT * FROM client_subscriptions 
      WHERE client_id=$1 AND status='active'
      ORDER BY current_period_end DESC
      LIMIT 1`;
    const activeSubRes = await db.query(activeSubQ, [client_id]);
    const existingSub = activeSubRes.rows[0] || null;

    if (existingSub && new Date(existingSub.current_period_end) > now) {
      // extend from current end date
      const base = new Date(existingSub.current_period_end);
      const newEnd = computeNewEnd(base, plan);

      const updateSubQ = `
        UPDATE client_subscriptions
        SET current_period_end=$1, updated_at=NOW()
        WHERE id=$2
        RETURNING *`;
      const updated = await db.query(updateSubQ, [newEnd, existingSub.id]);
      const updatedSub = updated.rows[0];

      return res.json({
        success: true,
        message: "Payment verified, subscription extended",
        payment: paymentRow,
        subscription: updatedSub,
      });
    } else {
      // new subscription starting today
      const startDate = now;
      const endDate = computeNewEnd(startDate, plan);

      const insertSubQ = `
        INSERT INTO client_subscriptions
          (client_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
        VALUES ($1,$2,'active',$3,$4,NOW(),NOW())
        RETURNING *`;
      const ins = await db.query(insertSubQ, [client_id, plan_id, startDate, endDate]);
      const newSub = ins.rows[0];
await db.query(
      `DELETE FROM payments 
       WHERE client_id=$1 AND plan_id=$2 
       AND status='pending'`,
      [client_id, plan_id]
    );
      return res.json({
        success: true,
        message: "Payment verified, subscription created",
        payment: paymentRow,
        subscription: newSub,
      });
    }
  } catch (err) {
    console.error("Payment verify error:", err);
    res.status(500).json({ success: false, error: "Failed to verify payment" });
  }
});


router.post('/webhook', express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
    if (expected !== signature) return res.status(400).send("Invalid signature");

    const payload = JSON.parse(req.body.toString());
    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const { id, amount, status, notes } = payment;

      // Mark payment success
      await db.query(`UPDATE payments SET status='success' WHERE razorpay_payment_id=$1`, [id]);

      // Extend or create subscription
      const planRes = await db.query(`SELECT duration_days FROM subscription_plans WHERE id=$1`, [notes.plan_id]);
      const durationDays = planRes.rows[0].duration_days;

      const subRes = await db.query(
        `SELECT * FROM client_subscriptions WHERE client_id=$1 AND status='active' ORDER BY current_period_end DESC LIMIT 1`,
        [notes.client_id]
      );

      let start = new Date();
      let end = new Date();
      if (subRes.rows.length > 0 && new Date(subRes.rows[0].current_period_end) > new Date()) {
        start = subRes.rows[0].current_period_start;
        end = new Date(subRes.rows[0].current_period_end);
        end.setDate(end.getDate() + durationDays);
      } else {
        end.setDate(start.getDate() + durationDays);
      }

      await db.query(
        `INSERT INTO client_subscriptions (client_id, plan_id, current_period_start, current_period_end, status)
         VALUES ($1,$2,$3,$4,'active')`,
        [notes.client_id, notes.plan_id, start, end]
      );
    }

    res.send("ok");
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("internal_error");
  }
});
router.get("/subscription", checkValidClient, auth, async (req, res) => {
  try {
    const client_id = req.client_id;

    const q = `
      SELECT 
        cs.id AS subscription_id,
        cs.client_id,
        cs.plan_id,
        cs.status,
        cs.current_period_start,
        cs.current_period_end,
        cs.updated_at,
        sp.name AS plan_name,
        sp.amount,
        sp.period,
        sp.max_devices
      FROM client_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.client_id = $1 AND cs.status = 'active'
      ORDER BY cs.current_period_end DESC
      LIMIT 1
    `;

    const { rows } = await db.query(q, [client_id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active subscription found",
      });
    }

    const sub = rows[0];
    const now = new Date();
    const expired = new Date(sub.current_period_end) < now;

    res.json({
      success: true,
      subscription: {
        subscription_id: sub.subscription_id,
        client_id: sub.client_id,
        plan_id: sub.plan_id,
        plan_name: sub.plan_name,
        amount: sub.amount,
        period: sub.period,
        max_devices: sub.max_devices,
        current_period_start: sub.current_period_start,
        current_period_end: sub.current_period_end,
        status: expired ? "expired" : sub.status,
        updated_at: sub.updated_at,
      },
    });
  } catch (err) {
    console.error("Get subscription error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch subscription" });
  }
});



/**
 * 6) Get All Payments (Super Admin)
 * GET /superadmin/payments
 * Query params: ?limit=&offset=&status=
 */
router.get("/get-payments", checkValidClient,auth,async (req, res) => {
  try {
    const { limit = 4, offset = 0, status } = req.query;
    let q = `SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON c.id = p.client_id`;
    const params = [];
    if (status) {
      params.push(status);
      q += ` WHERE p.status = $${params.length}`;
    }
    q += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;
    params.push(Number(limit));
    params.push(Number(offset));
    const { rows } = await db.query(q, params);
    return res.json({ success: true, payments: rows });
  } catch (err) {
    console.error("Error fetching payments:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "failed_fetch_payments",
        detail: err.message,
      });
  }
});
router.get("/get-recent-payments", async (req, res) => {
  try {
    const { limit = 4, offset = 0, status } = req.query;
    let q = `SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON c.id = p.client_id`;
    const params = [];
    if (status) {
      params.push(status);
      q += ` WHERE p.status = $${params.length}`;
    }
    q += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${
      params.length + 2
    }`;
    params.push(Number(limit));
    params.push(Number(offset));
    const { rows } = await db.query(q, params);
    return res.json({ success: true, payments: rows });
  } catch (err) {
    console.error("Error fetching payments:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "failed_fetch_payments",
        detail: err.message,
      });
  }
});

/**
 * 7) Get Payments for a Client
 * GET /superadmin/clients/:id/payments
 */
router.get("/clients/:id/payments", async (req, res) => {
  try {
    const clientId = req.params.id;
    const q = `
      SELECT p.*, cs.razorpay_subscription_id, sp.name as plan_name
      FROM payments p
      LEFT JOIN client_subscriptions cs ON p.subscription_id = cs.id
      LEFT JOIN subscription_plans sp ON cs.plan_id = sp.id
      WHERE p.client_id = $1
      ORDER BY p.created_at DESC
      LIMIT 200
    `;
    const { rows } = await db.query(q, [clientId]);
    return res.json({ success: true, payments: rows });
  } catch (err) {
    console.error("Error fetching client payments:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "failed_fetch_client_payments",
        detail: err.message,
      });
  }
});

/**
 * 8) Revenue Summary / Dashboard
 * GET /superadmin/payments/summary
 */
router.get("/summary", async (req, res) => {
  try {
    const revenueQ = `
      SELECT
        COALESCE(SUM(CASE WHEN p.created_at >= date_trunc('month', current_date) THEN p.amount ELSE 0 END),0) as monthly_revenue,
        COALESCE(SUM(CASE WHEN p.created_at >= date_trunc('year', current_date) THEN p.amount ELSE 0 END),0) as yearly_revenue,
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END),0) as pending_amount,
        COUNT(DISTINCT CASE WHEN cs.status = 'active' THEN cs.client_id END) as active_clients,
        COUNT(DISTINCT CASE WHEN cs.status IN ('past_due','pending') THEN cs.client_id END) as overdue_clients
      FROM payments p
      LEFT JOIN client_subscriptions cs ON p.subscription_id = cs.id
    `;
    const { rows } = await db.query(revenueQ);
    const summary = rows[0] || {};
    return res.json({ success: true, summary });
  } catch (err) {
    console.error("Error fetching summary:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "failed_fetch_summary",
        detail: err.message,
      });
  }
});

module.exports = router;
function generateRandomId(length = 20) {
  return crypto
    .randomBytes(length)
    .toString("base64") // convert to base64 (A–Z, a–z, 0–9, +, /)
    .replace(/[^a-zA-Z0-9]/g, "") // remove non-alphanumeric
    .substring(0, length);
}
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function addMonths(date, months) {
  const d = new Date(date);
  const origDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);

  // handle month overflow (e.g., Jan 31 + 1 month => Feb 28/29)
  if (d.getUTCDate() < origDay) {
    // set to last day of previous month (which is intended behavior)
    d.setUTCDate(0);
  }
  return d;
}

function computeNewEnd(baseDate, plan) {
  // if plan.duration_days exists and is integer use days
  if (plan.duration_days && Number.isInteger(Number(plan.duration_days))) {
    return addDays(baseDate, Number(plan.duration_days));
  }

  // fallback to period string
  const period = (plan.period || '').toLowerCase();
  switch (period) {
    case 'daily':
    case 'day':
      return addDays(baseDate, 1);
    case 'weekly':
    case 'week':
      return addDays(baseDate, 7);
    case 'monthly':
    case 'month':
      return addMonths(baseDate, 1);
    case 'quarterly':
      return addMonths(baseDate, 3);
    case 'half-yearly':
    case 'halfyear':
    case 'half-year':
      return addMonths(baseDate, 6);
    case 'yearly':
    case 'annual':
    case 'year':
      return addMonths(baseDate, 12);
    default:
      // default: 30 days
      return addDays(baseDate, 30);
  }
}