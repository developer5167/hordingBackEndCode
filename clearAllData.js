/**
 * Wipe all rows in every table under schema `public`. Tables, columns, and
 * constraints stay; only data is removed (sequences reset).
 *
 *   node clearAllData.js
 *
 * Requires .env with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (same as app).
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await client.connect();
  console.log("Connected. Truncating all public tables…");

  try {
    await client.query(`
      DO $truncate$
      DECLARE
        stmt text;
      BEGIN
        SELECT 'TRUNCATE TABLE ' || string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
               || ' RESTART IDENTITY CASCADE'
        INTO stmt
        FROM pg_tables
        WHERE schemaname = 'public';
        IF stmt IS NOT NULL THEN
          EXECUTE stmt;
        END IF;
      END
      $truncate$;
    `);
    console.log("Done. All table data cleared; schema unchanged.\n");
  } catch (e) {
    console.error("Truncate failed:", e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
