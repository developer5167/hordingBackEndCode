const {
  computeGstBreakdown,
  stateCodeFromGstin,
  getSupplierTaxNote,
  resolvePlaceOfSupplyStateCode,
} = require("./taxService");

const MS_PER_DAY = 1000 * 60 * 60 * 24;

async function ensureSubscriptionBillingColumns(db) {
  await db.query(`
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS app_fee_paid BOOLEAN DEFAULT FALSE
  `);
}

async function loadPlatformBillingConfig(db) {
  const cfgRes = await db.query(
    `SELECT * FROM platform_billing_config ORDER BY updated_at DESC LIMIT 1`
  );
  const row = cfgRes.rows[0] || null;
  if (!row) return null;
  const v = row.supplier_gst_registered;
  const supplier_gst_registered =
    v === true ||
    v === "t" ||
    v === "true" ||
    v === 1 ||
    v === "1";
  return { ...row, supplier_gst_registered };
}

async function loadClientPlaceForSubscription(db, client_id) {
  await ensureSubscriptionBillingColumns(db);
  const r = await db.query(
    `SELECT place_of_supply_state_code, state_code, gstin,
            COALESCE(app_fee_paid, FALSE) AS app_fee_paid
     FROM clients WHERE id = $1 LIMIT 1`,
    [client_id]
  );
  return r.rows[0] || null;
}

/**
 * GST on subscription fee: platform is supplier; taxable base is ex-GST plan/credit delta.
 */
function subscriptionGstOnTaxableBase(taxableBaseRupees, platformCfg, clientRow) {
  const cfg = platformCfg || {};
  const supplierRegistered = Boolean(cfg.supplier_gst_registered);
  const supplierState =
    (cfg.supplier_state_code && String(cfg.supplier_state_code).trim()) ||
    stateCodeFromGstin(cfg.supplier_gstin);
  let pos = resolvePlaceOfSupplyStateCode(clientRow);
  if (!pos && supplierRegistered && supplierState) {
    const ss = String(supplierState).trim();
    if (ss) pos = ss;
  }
  // Same rule as client ↔ advertiser: no GST unless supplier is registered in config.
  const breakdown = computeGstBreakdown({
    amount: Number(taxableBaseRupees),
    gstRate: supplierRegistered ? Number(cfg.default_gst_rate ?? 18) : 0,
    supplierStateCode: supplierState || null,
    placeOfSupplyStateCode: pos || null,
    gstRegistered: supplierRegistered,
  });
  const supplierLegal = cfg.supplier_legal_name || "SOTER SYSTEMS";
  const tax_note = getSupplierTaxNote({
    supplierGstRegistered: Boolean(cfg.supplier_gst_registered),
    supplierLegalName: supplierLegal,
  });
  return { breakdown, supplier_legal_name: supplierLegal, tax_note };
}

async function computeSubscriptionCredit(db, client_id) {
  const activeSubRes = await db.query(
    `SELECT cs.*, sp.amount AS old_plan_amount, sp.period AS old_plan_period, sp.name AS old_plan_name
     FROM client_subscriptions cs
     LEFT JOIN subscription_plans sp ON sp.id = cs.plan_id
     WHERE cs.client_id=$1 AND cs.status='active'
     ORDER BY cs.current_period_end DESC
     LIMIT 1`,
    [client_id]
  );
  const existingSub = activeSubRes.rows[0] || null;
  const now = new Date();
  let credit = 0;
  let days_remaining = 0;
  let old_plan_amount = 0;
  let old_plan_name = null;

  if (
    existingSub &&
    existingSub.current_period_end &&
    new Date(existingSub.current_period_end) > now
  ) {
    const endDate = new Date(existingSub.current_period_end);
    const startDate = existingSub.current_period_start
      ? new Date(existingSub.current_period_start)
      : null;

    let totalPeriodDays;
    if ((existingSub.old_plan_period || "").toLowerCase().startsWith("month")) {
      totalPeriodDays = 28;
    } else {
      totalPeriodDays =
        Math.ceil((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) || 1;
    }

    const remainingMs = endDate.getTime() - now.getTime();
    days_remaining =
      remainingMs > 0 ? Math.ceil(remainingMs / MS_PER_DAY) : 0;

    old_plan_amount = Number(existingSub.old_plan_amount || 0);
    old_plan_name = existingSub.old_plan_name;

    const dailyRate = old_plan_amount / totalPeriodDays;
    const rawCredit = dailyRate * days_remaining;
    credit = Number(Math.min(rawCredit, old_plan_amount).toFixed(2));
  }

  return {
    existingSub,
    credit,
    days_remaining,
    old_plan_amount,
    old_plan_name,
  };
}

async function computeSubscriptionTotalsForPlanId(db, client_id, plan_id, opts = {}) {
  const { amount_override, coupon_discount_pct } = opts;
  const planRes = await db.query(`SELECT * FROM subscription_plans WHERE id=$1`, [
    plan_id,
  ]);
  if (!planRes.rows.length) {
    return { error: "plan_not_found" };
  }
  const plan = planRes.rows[0];
  const newPlanPrice = Number(plan.amount || 0);
  const appFeeList = Number(plan.app_fee || 0);

  const creditBlock = await computeSubscriptionCredit(db, client_id);
  const clientRow = await loadClientPlaceForSubscription(db, client_id);
  const platformCfg = await loadPlatformBillingConfig(db);

  const appFeePaid = Boolean(clientRow && clientRow.app_fee_paid);
  const appFeeDue = appFeeList > 0 && !appFeePaid;
  const appFeeComponent = appFeeDue ? appFeeList : 0;

  const subNet = Number(Math.max(0, newPlanPrice - creditBlock.credit).toFixed(2));
  const serverTaxableSubscription = subNet;
  const serverCombinedNoDiscount = Number(
    (serverTaxableSubscription + appFeeComponent).toFixed(2)
  );

  let couponPct = null;
  if (coupon_discount_pct != null && coupon_discount_pct !== "") {
    const p = Number(coupon_discount_pct);
    if (!Number.isNaN(p) && p > 0 && p <= 100) couponPct = p;
  }

  let taxableBase = serverCombinedNoDiscount;

  if (amount_override != null && amount_override !== "") {
    const ov = Number(amount_override);
    if (!Number.isNaN(ov) && ov >= 0) {
      let maxAllowed = serverCombinedNoDiscount;
      if (couponPct != null) {
        maxAllowed = Number(
          (
            serverTaxableSubscription * (1 - couponPct / 100) +
            appFeeComponent
          ).toFixed(2)
        );
      }
      if (ov > maxAllowed + 0.05) {
        return { error: "amount_override_exceeds_taxable", serverTaxable: maxAllowed };
      }
      taxableBase = Number(ov.toFixed(2));
    }
  } else if (couponPct != null) {
    taxableBase = Number(
      (serverTaxableSubscription * (1 - couponPct / 100) + appFeeComponent).toFixed(
        2
      )
    );
  }

  const subscription_component_rupees = Number(
    Math.max(0, taxableBase - appFeeComponent).toFixed(2)
  );

  const { breakdown, supplier_legal_name, tax_note } = subscriptionGstOnTaxableBase(
    taxableBase,
    platformCfg,
    clientRow
  );

  const totalDue = Number(breakdown.total_amount.toFixed(2));

  const escalationPct = Number(
    platformCfg?.app_fee_yearly_escalation_pct ?? 10
  );

  return {
    plan,
    newPlanPrice,
    app_fee_list_price: appFeeList,
    app_fee_component_rupees: appFeeComponent,
    app_fee_paid_already: appFeePaid,
    app_fee_charged: appFeeComponent,
    subscription_component_rupees,
    ...creditBlock,
    server_taxable_base: serverCombinedNoDiscount,
    taxable_base: taxableBase,
    breakdown,
    total_due: totalDue,
    platformCfg,
    clientRow,
    supplier_legal_name,
    tax_note,
    gst_rate_source: "platform_subscription",
    app_fee_yearly_escalation_pct: escalationPct,
  };
}

module.exports = {
  loadPlatformBillingConfig,
  loadClientPlaceForSubscription,
  subscriptionGstOnTaxableBase,
  computeSubscriptionCredit,
  computeSubscriptionTotalsForPlanId,
};
