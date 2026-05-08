const { express, auth, db } = require("./deps");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { computeExpectedAdPaymentRupees } = require("./services/adOrderPricing");

const router = express.Router();
const razorpay = require("./razorpay");
const checkValidClient = require("./middleware/checkValidClient");
const uuidV4 = require("uuid-v4");

function buildInvoiceHtml(invoice) {
  const razorpayId =
    invoice.payment_id_provider || invoice.razorpay_payment_id || "-";
  const gst = invoice.gst_snapshot;
  const taxLines =
    gst &&
    gst.gst_breakdown &&
    gst.gst_breakdown.tax_mode &&
    gst.gst_breakdown.tax_mode !== "no_gst"
      ? `<p><strong>Taxable (ads):</strong> INR ${Number(gst.subtotal || 0).toFixed(2)}</p>
         <p><strong>CGST / SGST / IGST:</strong> ${Number(gst.gst_breakdown.cgst || 0).toFixed(2)} / ${Number(gst.gst_breakdown.sgst || 0).toFixed(2)} / ${Number(gst.gst_breakdown.igst || 0).toFixed(2)} (${gst.gst_breakdown.tax_mode})</p>`
      : `<p><strong>Tax note:</strong> ${gst && gst.tax_note ? gst.tax_note : "GST not charged or not applicable for this supplier / place of supply."}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${invoice.invoice_number}</title></head><body style="font-family:Arial,sans-serif">
  <h2>Invoice ${invoice.invoice_number}</h2>
  <p><strong>Advertiser:</strong> ${invoice.advertiser_name} (${invoice.advertiser_email})</p>
  <p><strong>Ad:</strong> ${invoice.ad_title}</p>
  <p><strong>Transaction:</strong> ${invoice.transaction_id}</p>
  <p><strong>Razorpay payment id:</strong> ${razorpayId}</p>
  <p><strong>Total paid:</strong> INR ${(Number(invoice.amount_paise || 0) / 100).toFixed(2)}</p>
  ${taxLines}
  <p><strong>Status:</strong> ${invoice.status}</p>
  <p><strong>Date:</strong> ${new Date(invoice.paid_at).toLocaleString()}</p>
  </body></html>`;
}

async function sendAdPaymentInvoiceEmail(invoice) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: invoice.advertiser_email,
    subject: `Payment Invoice - ${invoice.invoice_number}`,
    html: buildInvoiceHtml(invoice),
  });
}

async function ensureAdvertiserPaymentsInvoiceTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS advertiser_payment_invoices (
      id BIGSERIAL PRIMARY KEY,
      payment_id UUID,
      ad_id UUID,
      advertiser_id UUID,
      client_id UUID,
      invoice_number TEXT UNIQUE,
      transaction_id TEXT,
      payment_id_provider TEXT,
      amount_paise BIGINT,
      status TEXT,
      paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      email_sent BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await db.query(`
    ALTER TABLE advertiser_payment_invoices
    ADD COLUMN IF NOT EXISTS gst_snapshot JSONB
  `);
}

router.post("/create-order", checkValidClient, auth, async (req, res) => {
  try {
    let { amount, currency, adId } = req.body;
    /* amount: total payable in rupees (matches app); Razorpay receives paise */

    if (adId == "") {
      adId = uuidV4();
    }

    await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes JSONB`);

    const pricing = await computeExpectedAdPaymentRupees(db, req.client_id, adId);
    let finalAmountPaise;
    let paymentNotes = null;

    if (!pricing.error) {
      const clientClaim = Number(amount);
      if (Number.isNaN(clientClaim) || Math.abs(clientClaim - pricing.grand_total) > 0.05) {
        return res.status(400).json({
          success: false,
          message: "amount_mismatch",
          expected_total: pricing.grand_total,
        });
      }
      finalAmountPaise = Math.round(pricing.grand_total * 100);
      paymentNotes = {
        ad_pricing: {
          subtotal: pricing.subtotal,
          gst_breakdown: pricing.gst_breakdown,
          gst_amount: pricing.gst_amount,
          handling: pricing.handling,
          grand_total: pricing.grand_total,
          tax_note:
            pricing.gst_breakdown.tax_mode === "no_gst"
              ? "GST not charged based on supplier registration and place of supply."
              : "GST as per line items below.",
        },
      };
    } else if (pricing.error === "ad_not_found") {
      finalAmountPaise = Math.round(Number(amount) * 100);
    } else {
      return res.status(400).json({
        success: false,
        message: pricing.error || "pricing_failed",
        detail: pricing,
      });
    }

    const transactionId = `TXN-${uuidV4()}`;
    const receipt = `rcpt_${generateRandomId()}`;

    const options = {
      amount: finalAmountPaise,
      currency: currency || "INR",
      receipt: receipt,
      payment_capture: 1,
      notes: { ad_id: adId },
    };
    const initpayment =
      "insert into payments(ad_id,advertiser_id,client_id,amount,total_amount,status,transaction_id,receipt,notes)values($1,$2,$3,$4,$5,$6,$7,$8,$9)";

    await db.query(initpayment, [
      adId,
      req.user_id,
      req.client_id,
      finalAmountPaise,
      finalAmountPaise,
      "pending",
      transactionId,
      receipt,
      paymentNotes,
    ]);

    const order = await razorpay.orders.create(options);
    res.json({ ...order, adId });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating order");
  }
});

function generateRandomId(length = 20) {
  return crypto
    .randomBytes(length)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .substring(0, length);
}

router.post("/verify-payment", checkValidClient, auth, async (req, res) => {
  const { order_id, payment_id, signature } = req.body;

  const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
  hmac.update(order_id + "|" + payment_id);
  const generatedSignature = hmac.digest("hex");

  if (generatedSignature === signature) {
    const order = await razorpay.orders.fetch(order_id);
    const adId = order.notes.ad_id;
    const updatePayment = `update payments set status='PAID' where advertiser_id=$1 AND client_id = $2 AND ad_id=$3`;
    await db.query(updatePayment, [req.user_id, req.client_id, adId]);

    await ensureAdvertiserPaymentsInvoiceTable();
    const paymentRowRes = await db.query(
      `SELECT p.*, a.title AS ad_title, u.name AS advertiser_name, u.email AS advertiser_email
       FROM payments p
       LEFT JOIN ads a ON a.id = p.ad_id
       LEFT JOIN users u ON u.id = p.advertiser_id
       WHERE p.advertiser_id = $1 AND p.client_id = $2 AND p.ad_id = $3
       ORDER BY p.created_at DESC LIMIT 1`,
      [req.user_id, req.client_id, adId]
    );
    const paymentRow = paymentRowRes.rows[0];
    let gstSnapshot = paymentRow?.notes?.ad_pricing || null;
    if (!gstSnapshot && paymentRow) {
      const again = await computeExpectedAdPaymentRupees(db, req.client_id, adId);
      if (!again.error) {
        gstSnapshot = {
          subtotal: again.subtotal,
          gst_breakdown: again.gst_breakdown,
          gst_amount: again.gst_amount,
          handling: again.handling,
          grand_total: again.grand_total,
          tax_note: "Recomputed on verify",
        };
      }
    }
    if (paymentRow) {
      const dup = await db.query(
        `SELECT id FROM advertiser_payment_invoices
         WHERE advertiser_id = $1 AND client_id = $2 AND payment_id_provider = $3 LIMIT 1`,
        [req.user_id, req.client_id, payment_id]
      );
      if (dup.rowCount === 0) {
        const invoiceNumber = `ADINV-${Date.now()}`;
        const inserted = await db.query(
          `INSERT INTO advertiser_payment_invoices
          (payment_id, ad_id, advertiser_id, client_id, invoice_number, transaction_id, payment_id_provider, amount_paise, status, paid_at, email_sent, gst_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),FALSE,$10)
         RETURNING *`,
          [
            paymentRow.id,
            paymentRow.ad_id,
            paymentRow.advertiser_id,
            paymentRow.client_id,
            invoiceNumber,
            paymentRow.transaction_id,
            payment_id,
            paymentRow.amount,
            "PAID",
            gstSnapshot,
          ]
        );
        const invoice = {
          ...inserted.rows[0],
          advertiser_name: paymentRow.advertiser_name || "Advertiser",
          advertiser_email: paymentRow.advertiser_email,
          ad_title: paymentRow.ad_title || "Ad",
          gst_snapshot: gstSnapshot,
        };
        if (invoice.advertiser_email) {
          try {
            await sendAdPaymentInvoiceEmail(invoice);
            await db.query(
              `UPDATE advertiser_payment_invoices SET email_sent = TRUE WHERE id = $1`,
              [invoice.id]
            );
          } catch (mailErr) {
            console.error("invoice email send failed:", mailErr.message);
          }
        }
      }
    }
    res.status(200).json({
      success: true,
      message: "Payment verified succesfully",
      data: { adId },
    });
  } else {
    res.status(400).send("Invalid signature");
  }
});

router.get("/history", checkValidClient, auth, async (req, res) => {
  try {
    await ensureAdvertiserPaymentsInvoiceTable();
    const r = await db.query(
      `SELECT i.invoice_number, i.transaction_id, i.payment_id_provider AS payment_id, i.amount_paise, i.status, i.paid_at,
              i.ad_id, a.title AS ad_title, i.email_sent, i.gst_snapshot
       FROM advertiser_payment_invoices i
       LEFT JOIN ads a ON a.id = i.ad_id
       WHERE i.advertiser_id = $1 AND i.client_id = $2
       ORDER BY i.paid_at DESC`,
      [req.user_id, req.client_id]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch history", detail: err.message });
  }
});

router.get("/invoice/:invoiceNumber", checkValidClient, auth, async (req, res) => {
  try {
    await ensureAdvertiserPaymentsInvoiceTable();
    const { invoiceNumber } = req.params;
    const r = await db.query(
      `SELECT i.*, a.title AS ad_title, u.name AS advertiser_name, u.email AS advertiser_email
       FROM advertiser_payment_invoices i
       LEFT JOIN ads a ON a.id = i.ad_id
       LEFT JOIN users u ON u.id = i.advertiser_id
       WHERE i.invoice_number = $1 AND i.advertiser_id = $2 AND i.client_id = $3
       LIMIT 1`,
      [invoiceNumber, req.user_id, req.client_id]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: "invoice_not_found" });
    const invoice = r.rows[0];
    return res.json({
      success: true,
      data: {
        ...invoice,
        invoice_html: buildInvoiceHtml(invoice),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch invoice", detail: err.message });
  }
});

module.exports = router;
