// var serviceAccount = require("./serviceAccount/serviceAccount.json");


const admin = require("firebase-admin");
console.log("Initializing Firebase...");

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log("Firebase initialized successfully!");

const fcm = admin.messaging();

module.exports = { admin, fcm };
