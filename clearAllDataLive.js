/**
 * Wipe all rows in every table under schema `public`. Tables, columns, and
 * constraints stay; only data is removed (sequences reset).
 *
 * Usage:
 *   node clearAllDataLive.js
 *
 * Uses process.env.DATABASE_URL from .env file for the connection.
 */
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false // needed for self-signed certs on cloud providers
    }
  });

  await client.connect();
  console.log(`Connected to database at ${process.env.DATABASE_URL.split('@')[1] || process.env.DATABASE_URL}. Truncating all public tables…`);

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
