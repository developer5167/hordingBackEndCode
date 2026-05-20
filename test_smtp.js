require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
  const mailRequest = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    requireTLS: true,
  });

  const mailingOptions = {
    from: process.env.SMTP_FROM,
    to: 'test@example.com',
    subject: "Your OTP Code",
    html: "<p>Test</p>"
  };

  try {
    const data = await mailRequest.sendMail(mailingOptions);
    console.log("Success:", data);
  } catch (error) {
    console.error("Error sending email:");
    console.error(error);
  }
}

testEmail();
