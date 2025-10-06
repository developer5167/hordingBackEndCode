const { express, auth, db } = require("./deps");
const crypto = require("crypto");

const router = express.Router();
const razorpay = require("./razorpay");
const checkValidClient = require("./middleware/checkValidClient");
const uuidV4 = require("uuid-v4");

router.post('/webhook', express.raw({ type: "*/*" }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];
    const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");

    // Step 1: Verify signature
    if (expected !== signature) {
      console.warn("❌ Invalid Razorpay signature");
      return res.status(400).send("Invalid signature");
    }

    // Step 2: Parse event payload
    const payload = JSON.parse(req.body.toString());
    const event = payload.event;
    console.log(`✅ Razorpay Webhook Event Received: ${event}`);

    if (event === "payment.captured") {
      const payment = payload.payload.payment.entity;
      const { id, amount, status, notes } = payment;

      const client_id = notes?.client_id;
      const plan_id = notes?.plan_id;

      if (!client_id || !plan_id) {
        console.warn("⚠️ Missing plan_id or client_id in notes.");
        return res.status(200).send("ok"); // ack, don’t retry
      }

      // Step 3: Update payment status
      await db.query(
        `UPDATE payments SET status='PAID', updated_at=NOW()
         WHERE razorpay_payment_id=$1 OR razorpay_order_id=$2`,
        [id, payment.order_id]
      );

      // Step 4: Delete all pending payments for same client & plan
      await db.query(
        `DELETE FROM payments 
         WHERE client_id=$1 AND plan_id=$2 AND status='pending'`,
        [client_id, plan_id]
      );

      // Step 5: Get plan details
      const planRes = await db.query(
        `SELECT period, duration_days FROM subscription_plans WHERE id=$1`,
        [plan_id]
      );
      if (planRes.rows.length === 0) {
        console.warn("⚠️ Plan not found:", plan_id);
        return res.status(200).send("ok");
      }
      const plan = planRes.rows[0];
      const durationDays = plan.duration_days || 30; // fallback if null

      // Step 6: Extend or create subscription
      const subRes = await db.query(
        `SELECT * FROM client_subscriptions 
         WHERE client_id=$1 AND status='active'
         ORDER BY current_period_end DESC LIMIT 1`,
        [client_id]
      );

      let start = new Date();
      let end = new Date();

      if (subRes.rows.length > 0 && new Date(subRes.rows[0].current_period_end) > new Date()) {
        // extend current active subscription
        start = subRes.rows[0].current_period_start;
        end = new Date(subRes.rows[0].current_period_end);
        end.setDate(end.getDate() + durationDays);

        await db.query(
          `UPDATE client_subscriptions
           SET current_period_end=$1, updated_at=NOW()
           WHERE id=$2`,
          [end, subRes.rows[0].id]
        );
      } else {
        // create a new subscription
        end.setDate(start.getDate() + durationDays);

        // avoid duplicates if webhook retries
        await db.query(
          `INSERT INTO client_subscriptions (client_id, plan_id, current_period_start, current_period_end, status)
           VALUES ($1,$2,$3,$4,'active')
           ON CONFLICT (client_id, plan_id) DO NOTHING`,
          [client_id, plan_id, start, end]
        );
      }

      console.log(`✅ Subscription updated for client ${client_id}`);
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("💥 Webhook error:", err);
    res.status(500).send("internal_error");
  }
});

module.exports=router