const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: "rzp_test_RJM8FvdcvaNN4p",   // Replace with your test Key ID
  key_secret: "js5dxGk4eqclWc4OAGezJ0AQ",  // Replace with your test Key Secret
});

module.exports = razorpay;
