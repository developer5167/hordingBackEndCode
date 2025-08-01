var serviceAccount = require("./serviceAccount/serviceAccoun.json");
const admin = require("firebase-admin");
console.log("Initializing Firebase...");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "gs://swap-80375.appspot.com",
});
console.log("Firebase initialized successfully!");

const fcm = admin.messaging();

module.exports = { admin, fcm };
