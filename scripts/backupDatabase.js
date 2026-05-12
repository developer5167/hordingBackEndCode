/**
 * PostgreSQL backup via pg_dump.
 *
 * Standalone:   node scripts/backupDatabase.js
 * From code:   const { runBackupSync, installShutdownBackup } = require("./scripts/backupDatabase");
 *
 * Env (same as app): DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 * Optional: SKIP_SHUTDOWN_BACKUP=1 — skip hook when server exits (e.g. nodemon)
 * Optional: DB_BACKUP_DIR — absolute or relative path for .dump files (default: backend/backups)
 *
 * Output is PostgreSQL custom format (-Fc). Restore: pg_restore -h HOST -p PORT -U USER -d DBNAME file.dump
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function backupDir() {
  if (process.env.DB_BACKUP_DIR) {
    return path.isAbsolute(process.env.DB_BACKUP_DIR)
      ? process.env.DB_BACKUP_DIR
      : path.join(__dirname, "..", process.env.DB_BACKUP_DIR);
  }
  return path.join(__dirname, "..", "backups");
}

function runBackupSync(reason = "manual") {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_NAME;
  const port = String(process.env.DB_PORT || 5432);

  if (!host || !user || !database) {
    console.error(
      "[db-backup] Missing DB_HOST / DB_USER / DB_NAME — check .env"
    );
    return null;
  }

  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeReason = String(reason).replace(/[^a-zA-Z0-9_-]+/g, "_");
  const filename = `db-backup_${stamp}_${safeReason}.dump`;
  const outfile = path.join(dir, filename);

  const env = { ...process.env, PGPASSWORD: password || "" };

  const args = [
    "-h",
    host,
    "-p",
    port,
    "-U",
    user,
    "-d",
    database,
    "-F",
    "c",
    "--no-owner",
    "-f",
    outfile,
  ];

  const result = spawnSync("pg_dump", args, {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    console.error("[db-backup] pg_dump not found or failed to run:", result.error.message);
    console.error("[db-backup] Install PostgreSQL client tools so `pg_dump` is on your PATH.");
    return null;
  }

  if (result.status !== 0) {
    console.error("[db-backup] pg_dump exited", result.status);
    if (result.stderr) console.error(result.stderr);
    return null;
  }

  console.log("[db-backup] Saved:", outfile);
  return outfile;
}

let shutdownHookInstalled = false;
let isExiting = false;

function installShutdownBackup() {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;

  const onSignal = (signal) => {
    if (process.env.SKIP_SHUTDOWN_BACKUP === "1") {
      console.log(`[db-backup] SKIP_SHUTDOWN_BACKUP=1 — not running backup (${signal})`);
      process.exit(0);
      return;
    }
    if (isExiting) return;
    isExiting = true;
    console.log(`\n[db-backup] Server stopping (${signal}), dumping database...`);
    runBackupSync(signal);
    process.exit(0);
  };

  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
}

if (require.main === module) {
  runBackupSync("cli");
}

module.exports = { runBackupSync, installShutdownBackup, backupDir };
