const {
  computeGstBreakdown,
  stateCodeFromGstin,
  resolvePlaceOfSupplyStateCode,
} = require("./taxService");

async function computeAdSubtotalForAdId(db, clientId, adId) {
  const adRes = await db.query(
    `SELECT id, client_id, media_type FROM ads WHERE id = $1 AND client_id = $2 LIMIT 1`,
    [adId, clientId]
  );
  if (!adRes.rows.length) return { error: "ad_not_found" };
  const ad = adRes.rows[0];
  const devRes = await db.query(
    `SELECT device_id, start_date, end_date FROM ad_devices WHERE ad_id = $1 AND client_id = $2`,
    [adId, clientId]
  );
  if (!devRes.rows.length) return { error: "no_devices" };
  const rows = devRes.rows;
  const firstStart = new Date(rows[0].start_date);
  const firstEnd = new Date(rows[0].end_date);
  const days = Math.max(1, Math.ceil((firstEnd - firstStart) / (86400000)));
  const deviceIds = [...new Set(rows.map((r) => r.device_id))];
  const result = await db.query(
    `SELECT d.id as device_id, p.price_per_day, p.location_factor
     FROM devices d
     JOIN pricing_rules p ON p.device_id = d.id AND p.media_type = $1
     WHERE d.id = ANY($2) AND d.client_id = $3`,
    [(ad.media_type || "").toLowerCase(), deviceIds, clientId]
  );
  let subtotal = 0;
  const priced = new Set(result.rows.map((r) => r.device_id));
  for (const id of deviceIds) {
    if (!priced.has(id)) {
      return { error: "pricing_not_found_for_device", device_id: id };
    }
  }
  for (const r of result.rows) {
    const daily = Number(r.price_per_day) * Number(r.location_factor || 1);
    subtotal += daily * days;
  }
  return {
    subtotal: Number(subtotal.toFixed(2)),
    days,
    media_type: ad.media_type,
    device_count: deviceIds.length,
  };
}

async function loadClientAdBilling(db, clientId) {
  await db.query(`
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS ad_billing_gst_rate NUMERIC NOT NULL DEFAULT 18
  `);
  const r = await db.query(
    `SELECT gst_registered, state_code, gstin, place_of_supply_state_code,
            COALESCE(ad_billing_gst_rate, 18) AS ad_billing_gst_rate
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  return r.rows[0] || null;
}

function adTotalsFromSubtotal(subtotal, clientRow) {
  const supplierState =
    (clientRow?.state_code && String(clientRow.state_code).trim()) ||
    stateCodeFromGstin(clientRow?.gstin);
  const pos = resolvePlaceOfSupplyStateCode(clientRow);
  const bd = computeGstBreakdown({
    amount: subtotal,
    gstRate: Number(clientRow?.ad_billing_gst_rate ?? 18),
    supplierStateCode: supplierState || null,
    placeOfSupplyStateCode: pos || null,
    gstRegistered: Boolean(clientRow?.gst_registered),
  });
  const tax = bd.cgst + bd.sgst + bd.igst;
  const grandTotal = Number(bd.total_amount.toFixed(2));
  return {
    subtotal: Number(Number(subtotal).toFixed(2)),
    gst_breakdown: bd,
    gst_amount: Number(tax.toFixed(2)),
    handling: 0,
    grand_total: grandTotal,
    ad_billing_gst_rate: Number(clientRow?.ad_billing_gst_rate ?? 18),
  };
}

async function computeExpectedAdPaymentRupees(db, clientId, adId) {
  const sub = await computeAdSubtotalForAdId(db, clientId, adId);
  if (sub.error) return sub;
  const clientRow = await loadClientAdBilling(db, clientId);
  const totals = adTotalsFromSubtotal(sub.subtotal, clientRow);
  return { ...sub, ...totals, clientRow };
}

module.exports = {
  computeAdSubtotalForAdId,
  loadClientAdBilling,
  adTotalsFromSubtotal,
  computeExpectedAdPaymentRupees,
};
