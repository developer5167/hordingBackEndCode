const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,   // Replace with your test Key ID
  key_secret: process.env.RAZORPAY_KEY_SECRET,  // Replace with your test Key Secret
});
module.exports = razorpay;
