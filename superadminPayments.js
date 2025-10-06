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
router.post("/create-plan", async (req, res) => {
  try {
    const { name, amount, period, max_devices, description } = req.body;
    if (!name || !amount || !period) {
      return res.status(400).json({ error: "name, amount, period required" });
    }

    const q = `
      INSERT INTO subscription_plans (name, amount, period, max_devices, description)
      VALUES ($1,$2,$3,$4,$5)`;
    const { rows } = await db.query(q, [
      name,
      amount,
      period,
      max_devices,
      description,
    ]);

    res.json({ success: true, plan: rows[0] });
  } catch (err) {
    console.error("Create plan error:", err);
    res.status(500).json({ error: "Failed to create plan" });
  }
});

router.get("/get-plans", async (req, res) => {
  try {
    const selectPlans = `select * from subscription_plans ORDER BY amount`;
    const { rows } = await db.query(selectPlans);
    return res.json(rows);
  } catch (err) {
    console.error("Error creating plan:", err);
    return res.status(500).json({
      success: false,
      message: "failed_create_plan",
      detail: err.message,
    });
  }
});
router.post("/create-order", checkValidClient, auth, async (req, res) => {
  try {
    let { plan_id, amount_override } = req.body; // amount_override in rupees (optional)
    if (!plan_id)
      return res
        .status(400)
        .json({ success: false, message: "plan_id required" });

    const query = `select * from subscription_plans where id=$1`;
    const result = await db.query(query, [plan_id]);
    if (result.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });

    const planDetails = result.rows[0];

    // use override if provided (in rupees) otherwise plan price
    const amountInRupees =
      amount_override !== undefined && amount_override !== null
        ? Number(amount_override)
        : Number(planDetails.amount);

    if (isNaN(amountInRupees) || amountInRupees < 0)
      return res
        .status(400)
        .json({ success: false, message: "Invalid amount_override" });

    const finalAmountPaise = toPaise(amountInRupees); // helper function exists

    const transactionId = `TXN-${uuidV4()}`;
    const receipt = `rcpt_${generateRandomId()}`;

    const options = {
      amount: finalAmountPaise,
      currency: "INR",
      receipt: receipt,
      payment_capture: 1,
      notes: { plan_id, client_id: req.client_id }, // helpful for webhook
    };

    const order = await razorpay.orders.create(options);

    // insert pending payment
    const initpaymentQ = `INSERT INTO payments(client_id, plan_id, amount, total_amount, status, transaction_id, receipt, razorpay_order_id, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`;

    const payRes = await db.query(initpaymentQ, [
      req.client_id,
      plan_id,
      finalAmountPaise, // amount stored in paise
      finalAmountPaise,
      "pending",
      transactionId,
      receipt,
      order.id,
    ]);

    return res.json({ success: true, order, payment: payRes.rows[0] });
  } catch (error) {
    console.error("create-order error:", error);
    res.status(500).send("Error creating order");
  }
});

// ✅ Verify Payment
router.post("/verify-payment", checkValidClient, auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
      req.body;
    const client_id = req.client_id;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    // Step 1: Verify signature
    const hmac = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");
    if (hmac !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Signature mismatch" });
    }

    // Step 2: Fetch payment and ensure captured
    let payment;
    for (let i = 0; i < 3; i++) {
      payment = await razorpay.payments.fetch(razorpay_payment_id);
      if (payment.status === "captured") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (payment.status !== "captured") {
      return res.status(400).json({
        success: false,
        message: `Payment not successful. Current status: ${payment.status}`,
      });
    }

    // Step 3: Fetch order & plan
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const plan_id =
      order.notes &&
      (order.notes.plan_id || order.notes.planDbId || order.notes.planId);
    if (!plan_id) {
      return res
        .status(400)
        .json({ success: false, message: "Order missing plan_id in notes" });
    }

    const planRes = await db.query(
      `SELECT * FROM subscription_plans WHERE id=$1`,
      [plan_id]
    );
    if (planRes.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });
    const plan = planRes.rows[0];
    const newPlanPrice = Number(plan.amount || 0); // rupees

    // Step 4: Update payment record (mark paid)
    const updatePayment = `
      UPDATE payments
      SET status='PAID', razorpay_payment_id=$2, razorpay_signature=$3, plan_id=$4
      WHERE razorpay_order_id=$1 AND client_id=$5
      RETURNING *
    `;
    const payRes = await db.query(updatePayment, [
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      plan_id,
      client_id,
    ]);
    const paymentRow = payRes.rows[0];

    // Step 5: Cleanup older pending payments for same client+plan
    await db.query(
      `DELETE FROM payments WHERE client_id=$1 AND plan_id=$2 AND status='pending' AND razorpay_order_id != $3`,
      [client_id, plan_id, razorpay_order_id]
    );

    // Step 6: Find any active subscription (with plan info)
    const activeSubQ = `
      SELECT cs.*, sp.amount AS old_plan_amount, sp.period AS old_plan_period, sp.name AS old_plan_name
      FROM client_subscriptions cs
      LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.client_id=$1 AND cs.status='active'
      ORDER BY cs.current_period_end DESC
      LIMIT 1`;
    const activeSubRes = await db.query(activeSubQ, [client_id]);
    const existingSub = activeSubRes.rows[0] || null;

    // Step 7: Compute proration credit based on actual period dates (safer)
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const now = new Date();
    let credit = 0.0;
    let days_remaining = 0;
    let old_plan_amount = 0;
    if (
      existingSub &&
      existingSub.current_period_end &&
      new Date(existingSub.current_period_end) > now
    ) {
      const endDate = new Date(existingSub.current_period_end);
      const startDate = existingSub.current_period_start
        ? new Date(existingSub.current_period_start)
        : null;

      let totalPeriodDays;
      if (
        (existingSub.old_plan_period || "").toLowerCase().startsWith("month")
      ) {
        totalPeriodDays = 28;
      } else {
        totalPeriodDays =
          Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) ||
          1;
      }

      const remainingMs = endDate.getTime() - now.getTime();
      days_remaining =
        remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_DAY) : 0;

      old_plan_amount = Number(existingSub.old_plan_amount || 0);

      // precise daily rate (do NOT round here)
      const dailyRate = old_plan_amount / totalPeriodDays;
      const rawCredit = dailyRate * days_remaining;

      // defensive cap: credit can't exceed what was paid for the original period
      credit = Number(Math.min(rawCredit, old_plan_amount).toFixed(2));
    }

    // Step 8: Compute payable and leftover logic
    let payable = Number((newPlanPrice - credit).toFixed(2));
    if (payable < 0) payable = 0;

    // paid amount from Razorpay (payment.amount is paise)
    const paidAmount =
      payment && payment.amount
        ? Number(payment.amount) / 100
        : Number(paymentRow?.amount || 0);

    // leftover credit (credit that remains after covering new plan price)
    const leftoverFromCredit =
      credit > newPlanPrice ? Number((credit - newPlanPrice).toFixed(2)) : 0;
    // leftover from overpaying via gateway
    const leftoverFromPaid =
      paidAmount > payable ? Number((paidAmount - payable).toFixed(2)) : 0;
    const totalLeftover = Number(
      (leftoverFromCredit + leftoverFromPaid).toFixed(2)
    );

    // Step 9: Add leftover to wallet if any (use robust upsert)
    let walletBalanceAfter = null;
    if (totalLeftover > 0) {
      walletBalanceAfter = await upsertWallet(db, client_id, totalLeftover);
    }

    // Step 10: Create/extend subscription
    function getEndDate(startDate, period) {
      const end = new Date(startDate);
      switch ((period || "").toLowerCase()) {
        case "weekly":
        case "week":
          end.setDate(end.getDate() + 7);
          break;
        case "monthly":
        case "month":
          end.setMonth(end.getMonth() + 1);
          break;
        case "quarterly":
        case "quarter":
          end.setMonth(end.getMonth() + 3);
          break;
        case "yearly":
        case "annual":
        case "year":
          end.setFullYear(end.getFullYear() + 1);
          break;
        default:
          end.setMonth(end.getMonth() + 1);
      }
      return end;
    }

    let subscriptionResult;
    if (
      existingSub &&
      String(existingSub.plan_id) === String(plan_id) &&
      new Date(existingSub.current_period_end) > now
    ) {
      // renew same plan: extend from existing end date
      const base = new Date(existingSub.current_period_end);
      const newEnd = getEndDate(base, plan.period);
      const updateSubQ = `
        UPDATE client_subscriptions
        SET current_period_end=$1, updated_at=NOW()
        WHERE id=$2
        RETURNING *
      `;
      const updated = await db.query(updateSubQ, [newEnd, existingSub.id]);
      subscriptionResult = updated.rows[0];
    } else {
      // new subscription / switching plan -> start today
      const startDate = now;
      const endDate = getEndDate(startDate, plan.period);
      const insertSubQ = `
        INSERT INTO client_subscriptions
          (client_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
        VALUES ($1,$2,'active',$3,$4,NOW(),NOW())
        RETURNING *`;
      const ins = await db.query(insertSubQ, [
        client_id,
        plan_id,
        startDate,
        endDate,
      ]);
      subscriptionResult = ins.rows[0];

      // expire old subscription record (defensive) if present
      if (existingSub) {
        try {
          await db.query(
            `UPDATE client_subscriptions SET status='expired', updated_at=NOW() WHERE id=$1`,
            [existingSub.id]
          );
        } catch (e) {
          console.warn("Failed to expire old subscription:", e.message);
        }
      }
    }

    // Step 11: Respond (include proration & wallet info so frontend can show details)
    return res.json({
      success: true,
      message: "Payment verified successfully",
      payment: paymentRow,
      proration: {
        credit,
        days_remaining,
        payable,
        paidAmount,
        leftoverFromCredit,
        leftoverFromPaid,
        totalLeftover,
      },
      wallet:
        walletBalanceAfter !== null ? { balance: walletBalanceAfter } : null,
      subscription: subscriptionResult,
    });
  } catch (err) {
    console.error("Payment verify error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to verify payment",
      detail: err.message,
    });
  }
});

router.post("/confirm-switch-plan", checkValidClient, auth, async (req, res) => {
  try {
    const client_id = req.client_id;
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ success: false, message: "plan_id required" });

    // fetch plan
    const planRes = await db.query(`SELECT * FROM subscription_plans WHERE id=$1`, [plan_id]);
    if (planRes.rows.length === 0) return res.status(404).json({ success: false, message: "Plan not found" });
    const plan = planRes.rows[0];
    const newPlanPrice = Number(plan.amount || 0);

    // fetch existing active subscription with plan info
    const activeSubQ = `
      SELECT cs.*, sp.amount AS old_plan_amount, sp.period AS old_plan_period, sp.name AS old_plan_name
      FROM client_subscriptions cs
      LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.client_id=$1 AND cs.status='active'
      ORDER BY cs.current_period_end DESC
      LIMIT 1`;
    const activeSubRes = await db.query(activeSubQ, [client_id]);
    const existingSub = activeSubRes.rows[0] || null;

    // compute credit (same logic as verify-payment), but enforce monthly=28
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const now = new Date();
    let credit = 0.0;
    let days_remaining = 0;
    let old_plan_amount = 0;
    let totalPeriodDays = 0;

    if (existingSub && existingSub.current_period_start && existingSub.current_period_end && new Date(existingSub.current_period_end) > now) {
      const endDate = new Date(existingSub.current_period_end);
      const startDate = new Date(existingSub.current_period_start);

      // prefer real dates unless period is monthly (we want monthly=28)
      const oldPeriod = (existingSub.old_plan_period || "").toLowerCase();
      if (oldPeriod.startsWith("month")) {
        totalPeriodDays = 28;
      } else {
        totalPeriodDays = Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) || 1;
      }

      const remainingMs = endDate.getTime() - now.getTime();
      days_remaining = remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_DAY) : 0;

      old_plan_amount = Number(existingSub.old_plan_amount || 0);

      // full-precision daily rate, do not round here
      const dailyRate = old_plan_amount / totalPeriodDays;
      const rawCredit = dailyRate * days_remaining;

      // defensive cap: credit cannot exceed what was paid for the original period
      credit = Number(Math.min(rawCredit, old_plan_amount).toFixed(2));
    }

    // compute payable and leftover (zero-pay flow)
    let payable = Number((newPlanPrice - credit).toFixed(2));
    if (payable < 0) payable = 0;

    const leftoverFromCredit = credit > newPlanPrice ? Number((credit - newPlanPrice).toFixed(2)) : 0;
    const totalLeftover = leftoverFromCredit; // confirm-switch-plan is zero-pay, no gateway paid amount here

    let walletBalanceAfter = null;
    if (totalLeftover > 0) {
      walletBalanceAfter = await upsertWallet(db, client_id, totalLeftover);
    }

    // getEndDate helper: monthly -> +28 days
    function getEndDate(startDate, period) {
      const end = new Date(startDate);
      switch ((period || "").toLowerCase()) {
        case "weekly":
        case "week":
          end.setDate(end.getDate() + 7);
          break;
        case "monthly":
        case "month":
          end.setDate(end.getDate() + 28); // <-- use 28 days
          break;
        case "quarterly":
        case "quarter":
          end.setDate(end.getDate() + 28 * 3); // keep consistent (optional)
          break;
        case "yearly":
        case "annual":
        case "year":
          end.setFullYear(end.getFullYear() + 1);
          break;
        default:
          end.setDate(end.getDate() + 28);
      }
      return end;
    }

    // create or extend subscription
    let subscriptionResult;
    if (existingSub && String(existingSub.plan_id) === String(plan_id) && new Date(existingSub.current_period_end) > now) {
      const newEnd = getEndDate(new Date(existingSub.current_period_end), plan.period);
      const updated = await db.query(`UPDATE client_subscriptions SET current_period_end=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [newEnd, existingSub.id]);
      subscriptionResult = updated.rows[0];
    } else {
      const startDate = now;
      const endDate = getEndDate(startDate, plan.period);
      const ins = await db.query(
        `INSERT INTO client_subscriptions (client_id, plan_id, status, current_period_start, current_period_end, created_at, updated_at)
         VALUES ($1,$2,'active',$3,$4,NOW(),NOW()) RETURNING *`,
        [client_id, plan_id, startDate, endDate]
      );
      subscriptionResult = ins.rows[0];

      if (existingSub) {
        await db.query(`UPDATE client_subscriptions SET status='expired', updated_at=NOW() WHERE id=$1`, [existingSub.id]);
      }
    }

    return res.json({
      success: true,
      message: "Plan switched successfully (zero payable). Any leftover credit added to wallet.",
      proration: { credit, days_remaining, payable, leftover: totalLeftover },
      wallet: walletBalanceAfter !== null ? { balance: walletBalanceAfter } : null,
      subscription: {
        ...subscriptionResult,
        current_period_start: subscriptionResult.current_period_start ? new Date(subscriptionResult.current_period_start).toISOString() : null,
        current_period_end: subscriptionResult.current_period_end ? new Date(subscriptionResult.current_period_end).toISOString() : null
      },
    });
  } catch (err) {
    console.error("Zero-pay confirm error:", err);
    res.status(500).json({ success: false, message: "Failed to confirm switch", detail: err.message });
  }
});

router.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");
    if (expected !== signature)
      return res.status(400).send("Invalid signature");

    const payload = JSON.parse(req.body.toString());
    if (payload.event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const { id, amount, status, notes } = payment;

      // Mark payment success
      await db.query(
        `UPDATE payments SET status='PAID' WHERE razorpay_payment_id=$1`,
        [id]
      );

      // Extend or create subscription
      const planRes = await db.query(
        `SELECT duration_days FROM subscription_plans WHERE id=$1`,
        [notes.plan_id]
      );
      const durationDays = planRes.rows[0].duration_days;

      const subRes = await db.query(
        `SELECT * FROM client_subscriptions WHERE client_id=$1 AND status='active' ORDER BY current_period_end DESC LIMIT 1`,
        [notes.client_id]
      );

      let start = new Date();
      let end = new Date();
      if (
        subRes.rows.length > 0 &&
        new Date(subRes.rows[0].current_period_end) > new Date()
      ) {
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
      return res.status(200).json({
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
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch subscription" });
  }
});

/**
 * 6) Get All Payments (Super Admin)
 * GET /superadmin/payments
 * Query params: ?limit=&offset=&status=
 */
router.get("/get-payments", async (req, res) => {
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
    return res.status(500).json({
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
    return res.status(500).json({
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
    return res.status(500).json({
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
    return res.status(500).json({
      success: false,
      message: "failed_fetch_summary",
      detail: err.message,
    });
  }
});
// POST /compute-proration
// Body: { plan_id: "<new-plan-uuid>" }
router.post("/compute-proration", checkValidClient, auth, async (req, res) => {
  try {
    const client_id = req.client_id;
    const { plan_id } = req.body;
    if (!plan_id) {
      return res
        .status(400)
        .json({ success: false, message: "plan_id required" });
    }

    // Fetch new plan
    const planRes = await db.query(
      `SELECT id, name, amount, period, max_devices FROM subscription_plans WHERE id=$1`,
      [plan_id]
    );
    if (planRes.rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Plan not found" });

    const newPlan = planRes.rows[0];
    const newPlanPrice = Number(newPlan.amount);

    // Fetch current active subscription (with plan amounts)
    const activeSubRes = await db.query(
      `SELECT cs.*, sp.amount AS old_plan_amount, sp.period AS old_plan_period, sp.name AS old_plan_name
       FROM client_subscriptions cs
       JOIN subscription_plans sp ON sp.id = cs.plan_id
       WHERE cs.client_id=$1 AND cs.status='active'
       ORDER BY cs.current_period_end DESC
       LIMIT 1`,
      [client_id]
    );
    const existingSub = activeSubRes.rows[0] || null;

    const now = new Date();
    const MS_PER_DAY = 1000 * 60 * 60 * 24;

    let credit = 0;
    let days_remaining = 0;
    let old_plan_name = null;
    let old_plan_amount = 0;

    if (
      existingSub &&
      existingSub.current_period_end &&
      new Date(existingSub.current_period_end) > now
    ) {
      const endDate = new Date(existingSub.current_period_end);
      const startDate = existingSub.current_period_start
        ? new Date(existingSub.current_period_start)
        : null;

      // total days in the original paid period (use actual dates if available)
      let totalPeriodDays;
      if (
        (existingSub.old_plan_period || "").toLowerCase().startsWith("month")
      ) {
        totalPeriodDays = 28;
      } else {
        totalPeriodDays =
          Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) ||
          1;
      }

      // remaining days from now until endDate
      const remainingMs = endDate.getTime() - now.getTime();
      days_remaining =
        remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_DAY) : 0;

      old_plan_amount = Number(existingSub.old_plan_amount || 0);
      old_plan_name = existingSub.old_plan_name;

      // compute precise daily rate (do NOT round here)
      const dailyRate = old_plan_amount / totalPeriodDays;

      // compute credit and cap it to the original paid amount (can't exceed what they paid)
      const rawCredit = dailyRate * days_remaining;
      credit = Number(Math.min(rawCredit, old_plan_amount).toFixed(2)); // round to 2 decimals for display
    }

    // compute payable (non-negative)
    let payable = Number((newPlanPrice - credit).toFixed(2));
    if (payable < 0) payable = 0;

    // If credit > newPlanPrice, move remaining credit to wallet and set payable 0
    if (credit > newPlanPrice) {
      const remaining = Number((credit - newPlanPrice).toFixed(2));
      await db.query(
        `INSERT INTO client_wallets (client_id, balance, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (client_id) DO UPDATE
           SET balance = client_wallets.balance + EXCLUDED.balance,
               updated_at = NOW()`,
        [client_id, remaining]
      );
      payable = 0;
    }

    // Compute new plan end date (if switching today)
    const endDate = new Date(now);
    const period = (newPlan.period || "").toLowerCase();
    if (period === "weekly" || period === "week")
      endDate.setDate(endDate.getDate() + 7);
    else if (period === "monthly" || period === "month")
      endDate.setDate(endDate.getDate() + 28);
    else if (period === "quarterly" || period === "quarter")
      endDate.setMonth(endDate.getMonth() + 3);
    else if (period === "yearly" || period === "year" || period === "annual")
      endDate.setFullYear(endDate.getFullYear() + 1);
    else endDate.setDate(endDate.getDate() + 30); // default fallback

    return res.json({
      success: true,
      data: {
        client_id,
        existing_subscription: existingSub
          ? {
              id: existingSub.id,
              plan_id: existingSub.plan_id,
              plan_name: old_plan_name,
              plan_amount: old_plan_amount,
              current_period_start: existingSub.current_period_start,
              current_period_end: existingSub.current_period_end,
              days_remaining,
            }
          : null,
        new_plan: {
          id: newPlan.id,
          name: newPlan.name,
          price: newPlanPrice,
          period: newPlan.period,
          max_devices: newPlan.max_devices,
          start_date: now.toISOString(), // send ISO strings for frontend
          end_date: endDate.toISOString(),
        },
        proration: {
          credit,
          payable,
        },
      },
    });
  } catch (err) {
    console.error("Proration error:", err);
    return res.status(500).json({
      success: false,
      message: "failed_proration",
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
  const period = (plan.period || "").toLowerCase();
  switch (period) {
    case "daily":
    case "day":
      return addDays(baseDate, 1);
    case "weekly":
    case "week":
      return addDays(baseDate, 7);
    case "monthly":
    case "month":
      return addMonths(baseDate, 1);
    case "quarterly":
      return addMonths(baseDate, 3);
    case "half-yearly":
    case "halfyear":
    case "half-year":
      return addMonths(baseDate, 6);
    case "yearly":
    case "annual":
    case "year":
      return addMonths(baseDate, 12);
    default:
      // default: 30 days
      return addDays(baseDate, 30);
  }
}
function computeDurationDays(plan) {
  const period = (plan.period || "").toLowerCase();
  switch (period) {
    case "daily":
    case "day":
      return 1;
    case "weekly":
    case "week":
      return 7;
    case "monthly":
    case "month":
      return 28;
    case "quarterly":
    case "quarter":
      return 90;
    case "halfyear":
    case "half-year":
    case "half-yearly":
      return 182;
    case "yearly":
    case "annual":
    case "year":
      return 365;
    default:
      return 28; // fallback
  }
}
