/**
 * Dev helper: clear advertiser-facing data so you can register and pay again from scratch.
 * Keeps clients, client admins (role = admin), devices, subscriptions, plans, platform config.
 *
 * Usage:
 *   node scripts/resetDevDatabase.js
 *   node scripts/resetDevDatabase.js --all-payments   # also DELETE all rows in payments (incl. subscription rows)
 *   node scripts/resetDevDatabase.js --all-users      # DELETE every user (admins too — use only if you know)
 *
 * Requires .env with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { Client } = require("pg");

const args = process.argv.slice(2);
const ALL_PAYMENTS = args.includes("--all-payments");
const ALL_USERS = args.includes("--all-users");

async function safeQuery(client, label, sql) {
  try {
    await client.query(sql);
    console.log("✓", label);
  } catch (err) {
    console.warn("⚠", label, "—", err.message);
  }
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  console.log("Connected. Starting reset…");

  try {
    await client.query("BEGIN");

    await safeQuery(
      client,
      "advertiser_payment_invoices",
      "DELETE FROM advertiser_payment_invoices"
    );

    await safeQuery(
      client,
      "ad_lifecycle_notifications",
      "DELETE FROM ad_lifecycle_notifications"
    );

    await safeQuery(client, "ad_statistics", "DELETE FROM ad_statistics");

    await safeQuery(client, "ad_device_history", "DELETE FROM ad_device_history");

    await safeQuery(client, "ad_devices", "DELETE FROM ad_devices");

    await safeQuery(client, "ads", "DELETE FROM ads");

    if (ALL_PAYMENTS) {
      await safeQuery(client, "payments (all rows)", "DELETE FROM payments");
    } else {
      await safeQuery(
        client,
        "payments (ad/advertiser rows only)",
        `DELETE FROM payments
         WHERE advertiser_id IS NOT NULL OR ad_id IS NOT NULL`
      );
    }

    await safeQuery(client, "otp", "DELETE FROM otp");

    await safeQuery(
      client,
      "signup_email_verifications",
      "DELETE FROM signup_email_verifications"
    );

    if (ALL_USERS) {
      await safeQuery(client, "coupon_usages (all)", "DELETE FROM coupon_usages");
    } else {
      await safeQuery(
        client,
        "coupon_usages (advertiser users)",
        `DELETE FROM coupon_usages cu
       USING users u
       WHERE cu.user_id = u.id
         AND LOWER(COALESCE(u.role, 'advertiser')) = 'advertiser'`
      );
    }

    if (ALL_USERS) {
      await safeQuery(client, "users (all)", "DELETE FROM users");
    } else {
      await safeQuery(
        client,
        "users (advertisers only)",
        `DELETE FROM users
         WHERE LOWER(COALESCE(role, 'advertiser')) = 'advertiser'`
      );
    }

    await client.query("COMMIT");
    console.log("\nDone. You can register advertiser accounts again (same client keys in the app).\n");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Reset failed:", e);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
