// superadminPayments.js
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('./deps'); // or wherever db is exported
const checkValidClient = require('./middleware/checkValidClient');
const auth = require('./middleware/auth');
const razorpay = require("./razorpay");

// Razorpay instance (env vars required)


// Helper: convert rupees to paise
function toPaise(amountRupee) {
  return Math.round(Number(amountRupee) * 100);
}

/**
 * 1) Create Subscription Plan (SuperAdmin)
 * POST /superadmin/payments/plans
 * Body: { name, period: "monthly"|"yearly", amount (rupees), description?, interval? }
 */
router.post('/create-plan', async (req, res) => {
  try {
    const { name, period, amount, description = '', interval = 1 } = req.body;
    if (!name || !period || !amount) {
      return res.status(400).json({ success: false, message: 'name, period and amount are required' });
    }
    const periodMap = {
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
      quarterly: 'quarterly',
      'half-yearly': 'half-yearly',
      yearly: 'annual',   // alias
      annual: 'annual'
    };

    const normalizedPeriod = periodMap[period.toLowerCase()];
    if (!normalizedPeriod) {
      return res.status(400).json({
        success: false,
        message: `Invalid period. Allowed values: ${Object.keys(periodMap).join(', ')}`
      });
    }
    // Build Razorpay plan payload
    const planPayload = {
      period: period.toLowerCase() === 'yearly' ? 'annual' : period.toLowerCase(), // razorpay supports 'monthly' | 'quarterly' | 'half-yearly' | 'annual' etc. 'annual' used for 'yearly'
      interval: Number(interval) || 1,
      item: {
        name,
        amount: toPaise(amount),   // paise
        currency: 'INR',
        description: description || ''
      }
    };
    console.log(planPayload);
    
    // Create plan on Razorpay
    const rpPlan = await razorpay.plans.create(planPayload);

    // Store plan in DB
    const insertQ = `
      INSERT INTO subscription_plans (razorpay_plan_id, name, amount, amount_paise, period, interval, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;
    const values = [rpPlan.id, name, Number(amount), toPaise(amount), period, interval, description];
    const { rows } = await db.query(insertQ, values);

    return res.json(rows[0]);
  } catch (err) {
    console.error('Error creating plan:', err);
    return res.status(500).json({ success: false, message: 'failed_create_plan', detail: err.message });
  }
});
router.get('/get-plans', async (req, res) => {
  try {
    const selectPlans = `select * from subscription_plans`;
    const { rows } = await db.query(selectPlans);

    return res.json(rows);
  } catch (err) {
    console.error('Error creating plan:', err);
    return res.status(500).json({ success: false, message: 'failed_create_plan', detail: err.message });
  }
});



/**
 * 2) Assign Plan to Client (Create subscription on Razorpay)
 * POST /superadmin/clients/:id/subscription
 * Body: { plan_db_id, start_at? (timestamp ISO), total_count? }
 */
router.post('/clients/:id/subscription', async (req, res) => {
  try {
    const clientId = req.params.id;
    const { plan_db_id, start_at, total_count } = req.body;
    if (!plan_db_id) return res.status(400).json({ success: false, message: 'plan_db_id required' });

    // Fetch plan from DB
    const planQ = `SELECT * FROM subscription_plans WHERE id = $1 LIMIT 1`;
    const planRes = await db.query(planQ, [plan_db_id]);
    if (planRes.rows.length === 0) return res.status(404).json({ success: false, message: 'plan not found' });
    const plan = planRes.rows[0];
    if (!plan.razorpay_plan_id) return res.status(400).json({ success: false, message: 'plan not linked to razorpay' });

    // Create "customer" in Razorpay for this client (optional but recommended)
    // You might want to keep a mapping table for razorpay_customer_id per client. For simplicity, we'll use client info (if present) or create a customer with notes.
    // Try to fetch client details from clients table
    const clientQ = `SELECT id, name, domain FROM clients WHERE id = $1 LIMIT 1`;
    const clientRes = await db.query(clientQ, [clientId]);
    if (clientRes.rows.length === 0) return res.status(404).json({ success: false, message: 'client not found' });
    const clientRow = clientRes.rows[0];
    // Create subscription on Razorpay
    const subscriptionPayload = {
      plan_id: plan.razorpay_plan_id,
      total_count: total_count || null,     // null for infinite recurring until cancelled (Razorpay may expect null or omit)
      // optionally set start_at (unix timestamp in seconds)
      ...(start_at ? { start_at: Math.floor(new Date(start_at).getTime() / 1000) } : {}),
      // pass notes so we can map back
      notes: { client_id: clientId, client_name: clientRow.name || clientRow.domain || '' },
    };

    const razorpaySub = await razorpay.subscriptions.create(subscriptionPayload);

    // Insert into client_subscriptions
    const insertSubQ = `
      INSERT INTO client_subscriptions (
        client_id, plan_id, razorpay_subscription_id, status,
        current_period_start, current_period_end, next_billing_at, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
      RETURNING *
    `;
    // Parse current/next period timestamps if present
    const curStart = razorpaySub.current_start_at ? new Date(razorpaySub.current_start_at * 1000) : null;
    const curEnd = razorpaySub.current_end_at ? new Date(razorpaySub.current_end_at * 1000) : null;
    const nextBilling = razorpaySub.next_retry_at ? new Date(razorpaySub.next_retry_at * 1000) : (razorpaySub.next_billing_at ? new Date(razorpaySub.next_billing_at * 1000) : null);

    const subValues = [
      clientId,
      plan_db_id,
      razorpaySub.id,
      razorpaySub.status || 'active',
      curStart,
      curEnd,
      nextBilling
    ];
    const dbSubRes = await db.query(insertSubQ, subValues);

    return res.status(201).json({ success: true, subscription: dbSubRes.rows[0], razorpay: razorpaySub });
  } catch (err) {
    console.error('Error creating subscription:', err);
    return res.status(500).json({ success: false, message: 'failed_create_subscription', detail: err.message });
  }
});

/**
 * 3) Get Client Subscription
 * GET /superadmin/clients/:id/subscription
 */
router.get('/clients/:id/subscription', async (req, res) => {
  try {
    const clientId = req.params.id;
    const q = `
      SELECT cs.*, sp.name as plan_name, sp.amount, sp.period, sp.razorpay_plan_id
      FROM client_subscriptions cs
      JOIN subscription_plans sp ON sp.id = cs.plan_id
      WHERE cs.client_id = $1
      ORDER BY cs.created_at DESC
      LIMIT 1
    `;
    const { rows } = await db.query(q, [clientId]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'no subscription found for client' });
    return res.json({ success: true, subscription: rows[0] });
  } catch (err) {
    console.error('Error fetching client subscription:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_subscription', detail: err.message });
  }
});

/**
 * 4) Cancel Subscription (Super Admin action)
 * POST /superadmin/clients/:id/subscription/cancel
 * Body: { cancel_at_cycle_end: boolean }  (optional)
 */
router.post('/clients/:id/subscription/cancel', async (req, res) => {
  try {
    const clientId = req.params.id;
    const { cancel_at_cycle_end = true } = req.body;

    // fetch subscription
    const sQ = `SELECT * FROM client_subscriptions WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`;
    const sRes = await db.query(sQ, [clientId]);
    if (sRes.rows.length === 0) return res.status(404).json({ success: false, message: 'subscription not found' });
    const sub = sRes.rows[0];
    if (!sub.razorpay_subscription_id) return res.status(400).json({ success: false, message: 'subscription not linked to razorpay' });

    // Cancel on razorpay
    const cancelPayload = cancel_at_cycle_end ? { cancel_at_cycle_end: true } : {cancel_at_cycle_end: false};
    razorpay.subscriptions.cancel(sub.razorpay_subscription_id, cancelPayload);

    // Update DB
    const updQ = `UPDATE client_subscriptions SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *`;
    const upd = await db.query(updQ, [sub.id]);

    return res.json({ success: true, message: 'subscription_cancelled', subscription: upd.rows[0] });
  } catch (err) {
    console.error('Error cancelling subscription:', err);
    return res.status(500).json({ success: false, message: 'failed_cancel_subscription', detail: err.message });
  }
});

/**
 * 5) Webhook (Razorpay) - to be configured in Razorpay Dashboard
 * POST /superadmin/payments/webhook
 *
 * IMPORTANT: Configure the webhook URL in Razorpay dashboard and set the secret in RAZORPAY_WEBHOOK_SECRET.
 */
router.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body; // raw buffer
    if (!signature || !webhookSecret) {
      console.warn('Webhook: missing signature or secret');
      return res.status(400).send('missing_signature_or_secret');
    }

    // Verify signature
    const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
    if (expected !== signature) {
      console.warn('Webhook signature mismatch');
      return res.status(400).send('signature_mismatch');
    }

    // Parse payload
    const payload = JSON.parse(body.toString());
    const event = payload.event;

    // Handle useful events: payment.captured, subscription.charged, subscription.activated, subscription.cancelled, payment.failed
    if (event === 'payment.captured' || event === 'payment.failed') {
      const paymentEntity = payload.payload && (payload.payload.payment || payload.payload.entity || {}).entity;
      // normalized extraction
      const entity = paymentEntity || (payload.payload.payment ? payload.payload.payment.entity : (payload.payload.entity ? payload.payload.entity : null));
      if (entity) {
        const razorpay_payment_id = entity.id;
        const amount_paise = entity.amount;
        const amount = amount_paise / 100;
        const status = entity.status;
        const notes = entity.notes || {};
        // try map to subscription_id via notes.subscription_id or notes.client_id
        const rpSubscriptionId = notes.subscription_id || entity.subscription_id || null;
        const client_id_from_notes = notes.client_id || null;

        // Insert payment record
        const insertQ = `
          INSERT INTO payments (ad_id, client_id, user_id, amount, status, razorpay_payment_id, notes, created_at, gateway)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(), 'razorpay') RETURNING *`;
        // ad_id, user_id are nullable here — subscription payments likely not tied to an ad
        // Use client_id_from_notes if present else null
        const dbValues = [null, client_id_from_notes, null, amount, status, razorpay_payment_id, JSON.stringify(entity)];
        try {
          await db.query(insertQ, dbValues);
        } catch (e) {
          console.error('Failed saving webhook payment to DB', e);
        }

        // If subscription payment captured → mark client_subscriptions status active and update timings
        if (status === 'captured' && rpSubscriptionId) {
          // Try find subscription
          const csQ = `SELECT id FROM client_subscriptions WHERE razorpay_subscription_id = $1 LIMIT 1`;
          const csRes = await db.query(csQ, [rpSubscriptionId]);
          if (csRes.rows.length > 0) {
            // Update subscription status and next billing window
            // Fetch full subscription from Razorpay to get dates (best-effort, but we can set status = active)
            try {
              const rpSub = await razorpay.subscriptions.fetch(rpSubscriptionId);
              const curStart = rpSub.current_start_at ? new Date(rpSub.current_start_at * 1000) : null;
              const curEnd = rpSub.current_end_at ? new Date(rpSub.current_end_at * 1000) : null;
              const nextBilling = rpSub.next_billing_at ? new Date(rpSub.next_billing_at * 1000) : null;
              await db.query(
                `UPDATE client_subscriptions
                 SET status = $1, current_period_start = $2, current_period_end = $3, next_billing_at = $4, updated_at = NOW()
                 WHERE razorpay_subscription_id = $5`,
                ['active', curStart, curEnd, nextBilling, rpSubscriptionId]
              );
            } catch (e) {
              console.warn('Could not fetch subscription from razorpay during webhook:', e.message);
              await db.query(`UPDATE client_subscriptions SET status = $1, updated_at = NOW() WHERE razorpay_subscription_id = $2`, ['active', rpSubscriptionId]);
            }
          }
        }

        // If payment.failed -> mark subscription past_due or overdue
        if ((event === 'payment.failed' || status === 'failed') && rpSubscriptionId) {
          await db.query(`UPDATE client_subscriptions SET status = 'past_due', updated_at = NOW() WHERE razorpay_subscription_id = $1`, [rpSubscriptionId]);

          // Optionally: pause/ block client accounts (business rule) -> you can call your existing block API here
          // const clientSub = await db.query(`SELECT client_id FROM client_subscriptions WHERE razorpay_subscription_id = $1`, [rpSubscriptionId]);
          // if (clientSub.rows[0]) { await db.query(`UPDATE clients SET subscription_status='blocked' WHERE id = $1`, [clientSub.rows[0].client_id]); }
        }
      }
    } else if (event && event.startsWith('subscription.')) {
      // subscription.activated, subscription.cancelled, subscription.charged, etc.
      const subscriptionEntity = payload.payload.subscription ? payload.payload.subscription.entity : (payload.payload.entity ? payload.payload.entity : null);
      if (subscriptionEntity) {
        const rpSubId = subscriptionEntity.id;
        const status = subscriptionEntity.status;
        // update DB mapping
        await db.query(`UPDATE client_subscriptions SET status = $1, updated_at = NOW() WHERE razorpay_subscription_id = $2`, [status, rpSubId]);
      }
    }
    // ack
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).send('internal_error');
  }
});
/**
 * 6) Get All Payments (Super Admin)
 * GET /superadmin/payments
 * Query params: ?limit=&offset=&status=
 */
router.get('/get-payments', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    let q = `SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON c.id = p.client_id`;
    const params = [];
    if (status) {
      params.push(status);
      q += ` WHERE p.status = $${params.length}`;
    }
    q += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit));
    params.push(Number(offset));
    const { rows } = await db.query(q, params);
    return res.json({ success: true, payments: rows });
  } catch (err) {
    console.error('Error fetching payments:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_payments', detail: err.message });
  }
});
router.get('/get-recent-payments', async (req, res) => {
  try {
    const { limit = 4, offset = 0, status } = req.query;
    let q = `SELECT p.*, c.name as client_name FROM payments p LEFT JOIN clients c ON c.id = p.client_id`;
    const params = [];
    if (status) {
      params.push(status);
      q += ` WHERE p.status = $${params.length}`;
    }
    q += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit));
    params.push(Number(offset));
    const { rows } = await db.query(q, params);
    return res.json({ success: true, payments: rows });
  } catch (err) {
    console.error('Error fetching payments:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_payments', detail: err.message });
  }
});

/**
 * 7) Get Payments for a Client
 * GET /superadmin/clients/:id/payments
 */
router.get('/clients/:id/payments', async (req, res) => {
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
    console.error('Error fetching client payments:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_client_payments', detail: err.message });
  }
});

/**
 * 8) Revenue Summary / Dashboard
 * GET /superadmin/payments/summary
 */
router.get('/summary', async (req, res) => {
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
    console.error('Error fetching summary:', err);
    return res.status(500).json({ success: false, message: 'failed_fetch_summary', detail: err.message });
  }
});

module.exports = router;
