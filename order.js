const { express, auth, db } = require("./deps");
const crypto = require("crypto");

const router = express.Router();
const razorpay = require("./razorpay");
const checkValidClient = require("./middleware/checkValidClient");
const uuidV4 = require("uuid-v4");

router.post("/create-order", checkValidClient, auth, async (req, res) => {
  try {
    let { amount, currency, adId } = req.body; // amount in paise (e.g. 50000 = ₹500)

    if (adId == "") {
      adId = uuidV4();
    }
    const finalAmount = amount * 100;
    const transactionId = `TXN-${uuidV4()}`;
    const receipt = `rcpt_${generateRandomId()}`;

    const options = {
      amount: finalAmount, // convert to paise
      currency: currency || "INR",
      receipt: receipt,
      payment_capture: 1, // auto-capture after auth
      notes: { ad_id: adId },
    };
    const initpayment =
      "insert into payments(ad_id,advertiser_id,client_id,amount,total_amount,status,transaction_id,receipt)VALUES($1,$2,$3,$4,$5,$6,$7,$8)";

    await db.query(initpayment, [
      adId,
      req.user_id,
      req.client_id,
      finalAmount,
      finalAmount,
      "pending",
      transactionId,
      receipt,
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
    .toString("base64") // convert to base64 (A–Z, a–z, 0–9, +, /)
    .replace(/[^a-zA-Z0-9]/g, "") // remove non-alphanumeric
    .substring(0, length);
}
// e.g. "a9B72kD3qX4zLm0V8yRp"

router.post("/verify-payment", checkValidClient, auth, async (req, res) => {
  const { order_id, payment_id, signature } = req.body;

  const hmac = crypto.createHmac("sha256", "js5dxGk4eqclWc4OAGezJ0AQ");
  hmac.update(order_id + "|" + payment_id);
  const generatedSignature = hmac.digest("hex");

  if (generatedSignature === signature) {
    const order = await razorpay.orders.fetch(order_id);
    const adId = order.notes.ad_id;
    const updatePayment = `update payments set status='PAID' where advertiser_id=$1 AND client_id = $2 AND ad_id=$3`;
    await db.query(updatePayment, [req.user_id, req.client_id, adId]);
    res.status(200).send({
      success: true,
      message: "Payment verified succesfully",
      data: { adId },
    });
  } else {
    res.status(400).send("Invalid signature");
  }
});

module.exports = router;
