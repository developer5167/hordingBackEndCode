const { db, admin } = require("../deps");
const { deleteFileFromS3 } = require("../s3Service");

let lifecycleInitialized = false;
let hasAdStatisticsTable = false;

async function ensureLifecycleState() {
  if (lifecycleInitialized) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS ad_lifecycle_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL,
      ad_id UUID NOT NULL,
      device_id UUID,
      event_type TEXT NOT NULL,
      event_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, ad_id, device_id, event_type, event_date)
    )
  `);

  const check = await db.query(`SELECT to_regclass('public.ad_statistics') AS reg`);
  hasAdStatisticsTable = Boolean(check.rows[0] && check.rows[0].reg);
  lifecycleInitialized = true;
}

async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const tokenRes = await db.query(
      `SELECT fcmtoken FROM users WHERE id = $1 AND fcmtoken IS NOT NULL LIMIT 1`,
      [userId]
    );
    const fcmToken = tokenRes.rows[0]?.fcmtoken;
    if (!fcmToken) return false;

    await admin.messaging().sendToDevice(fcmToken, {
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    });
    return true;
  } catch (err) {
    console.error("Failed to send lifecycle push:", err.message);
    return false;
  }
}

async function notifyOnce({ userId, adId, deviceId, eventType, title, body, data = {} }) {
  const insertRes = await db.query(
    `INSERT INTO ad_lifecycle_notifications (user_id, ad_id, device_id, event_type, event_date)
     VALUES ($1, $2, $3, $4, CURRENT_DATE)
     ON CONFLICT (user_id, ad_id, device_id, event_type, event_date) DO NOTHING
     RETURNING id`,
    [userId, adId, deviceId || null, eventType]
  );

  if (insertRes.rows.length === 0) return false;
  return sendPushToUser(userId, title, body, data);
}

async function markExpiredAndNotify() {
  const q = `
    UPDATE ad_devices ad
    SET status = 'expired',
        status_updated_at = NOW()
    FROM ads a
    WHERE ad.ad_id = a.id
      AND ad.end_date < NOW()
      AND LOWER(ad.status) <> 'expired'
    RETURNING ad.ad_id, ad.device_id, ad.end_date, a.user_id, a.title
  `;
  const { rows } = await db.query(q);

  for (const row of rows) {
    const deletionDate = new Date(new Date(row.end_date).getTime() + 2 * 24 * 60 * 60 * 1000);
    await notifyOnce({
      userId: row.user_id,
      adId: row.ad_id,
      deviceId: row.device_id,
      eventType: "expired_grace_started",
      title: "Ad expired: 2-day grace period started",
      body: `${row.title || "Your ad"} expired. Extend within 2 days to keep it active.`,
      data: {
        ad_id: row.ad_id,
        device_id: row.device_id,
        deletion_at: deletionDate.toISOString(),
      },
    });
  }
}

async function deleteExpiredPastGrace() {
  const eligibleRes = await db.query(
    `SELECT ad.ad_id, ad.device_id, ad.end_date, a.user_id, a.title, a.filename
     FROM ad_devices ad
     JOIN ads a ON a.id = ad.ad_id
     WHERE ad.end_date < (NOW() - INTERVAL '2 days')`
  );

  if (eligibleRes.rows.length === 0) return;

  for (const row of eligibleRes.rows) {
    await notifyOnce({
      userId: row.user_id,
      adId: row.ad_id,
      deviceId: row.device_id,
      eventType: "expired_deleted",
      title: "Expired ad deleted permanently",
      body: `${row.title || "An ad"} passed grace period and was deleted permanently.`,
      data: { ad_id: row.ad_id, device_id: row.device_id },
    });
  }

  const adIds = [...new Set(eligibleRes.rows.map((r) => r.ad_id))];
  await db.query(
    `DELETE FROM ad_devices WHERE end_date < (NOW() - INTERVAL '2 days')`
  );

  for (const adId of adIds) {
    const hasMappings = await db.query(
      `SELECT 1 FROM ad_devices WHERE ad_id = $1 LIMIT 1`,
      [adId]
    );
    if (hasMappings.rows.length > 0) continue;

    const adRes = await db.query(
      `SELECT id, filename FROM ads WHERE id = $1 LIMIT 1`,
      [adId]
    );
    if (adRes.rows.length === 0) continue;

    if (hasAdStatisticsTable) {
      await db.query(`DELETE FROM ad_statistics WHERE ad_id = $1`, [adId]);
    }
    await db.query(`DELETE FROM ads WHERE id = $1`, [adId]);

    const filename = adRes.rows[0].filename;
    if (filename) {
      try {
        await deleteFileFromS3(filename);
      } catch (err) {
        console.error("Failed deleting S3 file during lifecycle cleanup:", filename, err.message);
      }
    }
  }
}

async function processAdLifecycle() {
  await ensureLifecycleState();
  await markExpiredAndNotify();
  await deleteExpiredPastGrace();
}

module.exports = {
  processAdLifecycle,
};
