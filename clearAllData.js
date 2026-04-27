const { Client } = require("pg");

const client = new Client({
  host: "localhost",
  port: 5432,
  user: "kcs",
  password: "",
  database: "hording_tenant_based",
});

// All tables in the correct order (child tables first to respect FK constraints)
const tables = [
  "ad_devices",
  "ad_reviews",
  "ad_statistics",
  "company_ad_history",
  "company_ads",
  "emergency_ad_devices",
  "emergency_ads",
  "wallet_transactions",
  "client_wallets",
  "client_subscriptions",
  "subscriptions",
  "subscription_plans",
  "payments",
  "staffs_devices",
  "staffs",
  "otp",
  "ads",
  "devices",
  "pricing_rules",
  "pricing",
  "roles",
  "clients",
  "users",
];

async function clearAllData() {
  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    // Disable triggers/FK checks temporarily using TRUNCATE ... CASCADE
    console.log("🗑️  Clearing all table data...\n");

    for (const table of tables) {
      try {
        await client.query(
          `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`
        );
        console.log(`  ✔ Cleared: ${table}`);
      } catch (err) {
        console.error(`  ✘ Failed to clear ${table}: ${err.message}`);
      }
    }

    console.log("\n✅ All tables cleared successfully. Structures preserved.");
  } catch (err) {
    console.error("❌ Connection error:", err.message);
  } finally {
    await client.end();
    console.log("🔌 Disconnected from PostgreSQL.");
  }
}

clearAllData();
