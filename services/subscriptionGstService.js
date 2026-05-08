const {
  computeGstBreakdown,
  stateCodeFromGstin,
  getSupplierTaxNote,
} = require("./taxService");

const MS_PER_DAY = 1000 * 60 * 60 * 24;

async function loadPlatformBillingConfig(db) {
  const cfgRes = await db.query(
    `SELECT * FROM platform_billing_config ORDER BY updated_at DESC LIMIT 1`
  );
  return cfgRes.rows[0] || null;
}

async function loadClientPlaceForSubscription(db, client_id) {
  const r = await db.query(
    `SELECT place_of_supply_state_code, state_code, gstin FROM clients WHERE id = $1 LIMIT 1`,
    [client_id]
  );
  return r.rows[0] || null;
}

/**
 * GST on subscription fee: platform is supplier; taxable base is ex-GST plan/credit delta.
 */
function subscriptionGstOnTaxableBase(taxableBaseRupees, platformCfg, clientRow) {
  const cfg = platformCfg || {};
  const supplierState =
    (cfg.supplier_state_code && String(cfg.supplier_state_code).trim()) ||
    stateCodeFromGstin(cfg.supplier_gstin);
  const pos =
    (clientRow && clientRow.place_of_supply_state_code) || null;
  const breakdown = computeGstBreakdown({
    amount: Number(taxableBaseRupees),
    gstRate: Number(cfg.default_gst_rate ?? 18),
    supplierStateCode: supplierState || null,
    placeOfSupplyStateCode: pos || null,
    gstRegistered: Boolean(cfg.supplier_gst_registered),
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

  const creditBlock = await computeSubscriptionCredit(db, client_id);
  const serverTaxable = Number(
    Math.max(0, newPlanPrice - creditBlock.credit).toFixed(2)
  );

  let taxableBase = serverTaxable;

  if (amount_override != null && amount_override !== "") {
    const ov = Number(amount_override);
    if (!Number.isNaN(ov) && ov >= 0) {
      if (ov > serverTaxable + 0.05) {
        return { error: "amount_override_exceeds_taxable", serverTaxable };
      }
      taxableBase = Number(ov.toFixed(2));
    }
  } else if (coupon_discount_pct != null && coupon_discount_pct !== "") {
    const p = Number(coupon_discount_pct);
    if (!Number.isNaN(p) && p > 0 && p <= 100) {
      taxableBase = Number((serverTaxable * (1 - p / 100)).toFixed(2));
    }
  }

  const platformCfg = await loadPlatformBillingConfig(db);
  const clientRow = await loadClientPlaceForSubscription(db, client_id);
  const { breakdown, supplier_legal_name, tax_note } = subscriptionGstOnTaxableBase(
    taxableBase,
    platformCfg,
    clientRow
  );

  const totalDue = Number(breakdown.total_amount.toFixed(2));

  return {
    plan,
    newPlanPrice,
    ...creditBlock,
    server_taxable_base: serverTaxable,
    taxable_base: taxableBase,
    breakdown,
    total_due: totalDue,
    platformCfg,
    clientRow,
    supplier_legal_name,
    tax_note,
    gst_rate_source: "platform_subscription",
  };
}

module.exports = {
  loadPlatformBillingConfig,
  loadClientPlaceForSubscription,
  subscriptionGstOnTaxableBase,
  computeSubscriptionCredit,
  computeSubscriptionTotalsForPlanId,
};
