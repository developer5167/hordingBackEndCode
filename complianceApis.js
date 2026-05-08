const { express, db } = require("./deps");
const {
  isValidGstin,
  isValidPan,
  stateCodeFromGstin,
  computeGstBreakdown,
  getSupplierTaxNote,
} = require("./services/taxService");

const router = express.Router();

async function ensureComplianceTables() {
  await db.query(`
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS legal_business_name TEXT,
      ADD COLUMN IF NOT EXISTS gstin TEXT,
      ADD COLUMN IF NOT EXISTS pan TEXT,
      ADD COLUMN IF NOT EXISTS registered_address TEXT,
      ADD COLUMN IF NOT EXISTS state_code TEXT,
      ADD COLUMN IF NOT EXISTS place_of_supply_state_code TEXT,
      ADD COLUMN IF NOT EXISTS gst_registered BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS ad_billing_gst_rate NUMERIC NOT NULL DEFAULT 18
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS platform_billing_config (
      id BIGSERIAL PRIMARY KEY,
      supplier_legal_name TEXT NOT NULL DEFAULT 'SOTER SYSTEMS',
      supplier_gst_registered BOOLEAN NOT NULL DEFAULT FALSE,
      supplier_gstin TEXT,
      supplier_pan TEXT,
      supplier_state_code TEXT,
      default_gst_rate NUMERIC NOT NULL DEFAULT 18,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    INSERT INTO platform_billing_config (supplier_legal_name, supplier_gst_registered, default_gst_rate)
    SELECT 'SOTER SYSTEMS', FALSE, 18
    WHERE NOT EXISTS (SELECT 1 FROM platform_billing_config)
  `);
}

router.use(async (_req, _res, next) => {
  try {
    await ensureComplianceTables();
    next();
  } catch (err) {
    next(err);
  }
});

router.get("/platform-billing-config", async (_req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM platform_billing_config ORDER BY updated_at DESC LIMIT 1`
  );
  return res.json({ success: true, data: rows[0] || null });
});

router.put("/platform-billing-config", async (req, res) => {
  const {
    supplier_legal_name,
    supplier_gst_registered,
    supplier_gstin,
    supplier_pan,
    supplier_state_code,
    default_gst_rate,
  } = req.body || {};

  if (supplier_gstin && !isValidGstin(supplier_gstin)) {
    return res.status(400).json({ success: false, error: "invalid_gstin" });
  }
  if (supplier_pan && !isValidPan(supplier_pan)) {
    return res.status(400).json({ success: false, error: "invalid_pan" });
  }

  const q = `
    UPDATE platform_billing_config
    SET supplier_legal_name = COALESCE($1, supplier_legal_name),
        supplier_gst_registered = COALESCE($2, supplier_gst_registered),
        supplier_gstin = COALESCE($3, supplier_gstin),
        supplier_pan = COALESCE($4, supplier_pan),
        supplier_state_code = COALESCE($5, supplier_state_code),
        default_gst_rate = COALESCE($6, default_gst_rate),
        updated_at = NOW()
    WHERE id = (SELECT id FROM platform_billing_config ORDER BY updated_at DESC LIMIT 1)
    RETURNING *
  `;
  const { rows } = await db.query(q, [
    supplier_legal_name || null,
    typeof supplier_gst_registered === "boolean"
      ? supplier_gst_registered
      : null,
    supplier_gstin ? String(supplier_gstin).toUpperCase() : null,
    supplier_pan ? String(supplier_pan).toUpperCase() : null,
    supplier_state_code || null,
    default_gst_rate != null ? Number(default_gst_rate) : null,
  ]);

  return res.json({ success: true, data: rows[0] });
});

router.get("/clients/:clientId/tax-profile", async (req, res) => {
  const { clientId } = req.params;
  const { rows } = await db.query(
    `SELECT id, name, legal_business_name, gstin, pan, registered_address, state_code, place_of_supply_state_code, gst_registered, ad_billing_gst_rate
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: "client_not_found" });
  }
  return res.json({ success: true, data: rows[0] });
});

router.put("/clients/:clientId/tax-profile", async (req, res) => {
  const { clientId } = req.params;
  const {
    legal_business_name,
    gstin,
    pan,
    registered_address,
    state_code,
    place_of_supply_state_code,
    gst_registered,
    ad_billing_gst_rate,
  } = req.body || {};

  if (gstin && !isValidGstin(gstin)) {
    return res.status(400).json({ success: false, error: "invalid_gstin" });
  }
  if (pan && !isValidPan(pan)) {
    return res.status(400).json({ success: false, error: "invalid_pan" });
  }

  const gstinUpper = gstin ? String(gstin).toUpperCase() : null;
  const autoStateCode = gstinUpper ? stateCodeFromGstin(gstinUpper) : null;

  let adRate = null;
  if (ad_billing_gst_rate != null && ad_billing_gst_rate !== "") {
    const n = Number(ad_billing_gst_rate);
    if (Number.isNaN(n) || n < 0 || n > 40) {
      return res.status(400).json({ success: false, error: "invalid_ad_billing_gst_rate" });
    }
    adRate = n;
  }

  const { rows } = await db.query(
    `UPDATE clients
     SET legal_business_name = COALESCE($1, legal_business_name),
         gstin = COALESCE($2, gstin),
         pan = COALESCE($3, pan),
         registered_address = COALESCE($4, registered_address),
         state_code = COALESCE($5, state_code),
         place_of_supply_state_code = COALESCE($6, place_of_supply_state_code),
         gst_registered = COALESCE($7, gst_registered),
         ad_billing_gst_rate = COALESCE($8, ad_billing_gst_rate)
     WHERE id = $9
     RETURNING id, name, legal_business_name, gstin, pan, registered_address, state_code, place_of_supply_state_code, gst_registered, ad_billing_gst_rate`,
    [
      legal_business_name || null,
      gstinUpper,
      pan ? String(pan).toUpperCase() : null,
      registered_address || null,
      state_code || autoStateCode || null,
      place_of_supply_state_code || null,
      typeof gst_registered === "boolean" ? gst_registered : null,
      adRate,
      clientId,
    ]
  );

  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: "client_not_found" });
  }

  return res.json({ success: true, data: rows[0] });
});

router.post("/tax-preview", async (req, res) => {
  const {
    amount,
    place_of_supply_state_code,
    client_id: bodyClientId,
    /**
     * platform_subscription — client pays SOTER; uses platform % + platform GST mode + client's place of supply.
     * client_ad_billing — default when logged-in client omitted (advertiser pays client); uses ad_billing_gst_rate.
     */
    tax_preview_scope,
    // Optional: match unsaved admin form so preview updates before Save
    override_gst_registered,
    override_state_code,
    override_legal_name,
    override_ad_billing_gst_rate,
  } = req.body || {};
  if (amount == null || !place_of_supply_state_code) {
    return res
      .status(400)
      .json({ success: false, error: "amount_and_place_of_supply_required" });
  }

  const cfgRes = await db.query(
    `SELECT * FROM platform_billing_config ORDER BY updated_at DESC LIMIT 1`
  );
  const cfg = cfgRes.rows[0];

  const headerClientId = getClientIdFromHeaders(req);
  const resolvedClientId = headerClientId || bodyClientId || null;

  const scope =
    tax_preview_scope === "platform_subscription"
      ? "platform_subscription"
      : "client_ad_billing";

  /*
   * Two GST tracks:
   * - Platform (superadmin): subscription — platform supplier, platform rate & GST toggle.
   * - Client ↔ advertiser: client supplier — ad_billing_gst_rate (never the platform %).
   */
  let gstRate;
  let gstRateSource;
  let supplierGstRegistered;
  let supplierLegalName;
  let supplierStateCode;

  if (resolvedClientId && scope === "client_ad_billing") {
    gstRateSource = "client_ad_billing";

    const cRes = await db.query(
      `SELECT legal_business_name, name, gst_registered, state_code, gstin, place_of_supply_state_code, ad_billing_gst_rate
       FROM clients WHERE id = $1 LIMIT 1`,
      [resolvedClientId]
    );
    const cl = cRes.rows[0];
    if (cl) {
      gstRate = Number(cl.ad_billing_gst_rate ?? 18);
      supplierGstRegistered = Boolean(cl.gst_registered);
      supplierLegalName =
        (cl.legal_business_name && String(cl.legal_business_name).trim()) ||
        (cl.name && String(cl.name).trim()) ||
        cfg?.supplier_legal_name;
      supplierStateCode =
        cl.state_code ||
        (cl.gstin ? stateCodeFromGstin(cl.gstin) : null) ||
        cfg?.supplier_state_code;
    } else {
      gstRate = Number(cfg?.default_gst_rate ?? 18);
      supplierGstRegistered = Boolean(cfg?.supplier_gst_registered);
      supplierLegalName = cfg?.supplier_legal_name;
      supplierStateCode =
        cfg?.supplier_state_code ||
        (cfg?.supplier_gstin ? stateCodeFromGstin(cfg.supplier_gstin) : null);
    }
  } else {
    gstRateSource = "platform_subscription";
    gstRate = Number(cfg?.default_gst_rate ?? 18);
    supplierGstRegistered = Boolean(cfg?.supplier_gst_registered);
    supplierLegalName = cfg?.supplier_legal_name;
    supplierStateCode =
      cfg?.supplier_state_code ||
      (cfg?.supplier_gstin ? stateCodeFromGstin(cfg.supplier_gstin) : null);
  }

  if (typeof override_gst_registered === "boolean") {
    supplierGstRegistered = override_gst_registered;
  }
  if (override_state_code != null && String(override_state_code).trim() !== "") {
    supplierStateCode = String(override_state_code).trim();
  }
  if (override_legal_name != null && String(override_legal_name).trim() !== "") {
    supplierLegalName = String(override_legal_name).trim();
  }
  if (
    override_ad_billing_gst_rate != null &&
    override_ad_billing_gst_rate !== "" &&
    resolvedClientId &&
    scope === "client_ad_billing"
  ) {
    const n = Number(override_ad_billing_gst_rate);
    if (!Number.isNaN(n) && n >= 0 && n <= 40) {
      gstRate = n;
    }
  }

  let effectivePos = place_of_supply_state_code;
  if (!effectivePos && resolvedClientId) {
    const c = await db.query(
      `SELECT place_of_supply_state_code FROM clients WHERE id = $1 LIMIT 1`,
      [resolvedClientId]
    );
    effectivePos = c.rows[0]?.place_of_supply_state_code || null;
  }

  const breakdown = computeGstBreakdown({
    amount: Number(amount),
    gstRate,
    supplierStateCode,
    placeOfSupplyStateCode: effectivePos,
    gstRegistered: supplierGstRegistered,
  });

  return res.json({
    success: true,
    data: {
      ...breakdown,
      gst_rate_applied: gstRate,
      gst_rate_source: gstRateSource,
      tax_note: getSupplierTaxNote({
        supplierGstRegistered,
        supplierLegalName,
      }),
    },
  });
});

function getClientIdFromHeaders(req) {
  return (
    req.headers["clientauthorisationkey"] ||
    req.headers["clientauthorisationKey"] ||
    req.headers["x-client-id"] ||
    null
  );
}

router.get("/my-tax-profile", async (req, res) => {
  const clientId = getClientIdFromHeaders(req);
  if (!clientId) {
    return res.status(400).json({ success: false, error: "client_id_required" });
  }
  const { rows } = await db.query(
    `SELECT id, name, legal_business_name, gstin, pan, registered_address, state_code, place_of_supply_state_code, gst_registered, ad_billing_gst_rate
     FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: "client_not_found" });
  }
  return res.json({ success: true, data: rows[0] });
});

router.put("/my-tax-profile", async (req, res) => {
  const clientId = getClientIdFromHeaders(req);
  if (!clientId) {
    return res.status(400).json({ success: false, error: "client_id_required" });
  }
  const {
    legal_business_name,
    gstin,
    pan,
    registered_address,
    state_code,
    place_of_supply_state_code,
    gst_registered,
    ad_billing_gst_rate,
  } = req.body || {};

  if (gstin && !isValidGstin(gstin)) {
    return res.status(400).json({ success: false, error: "invalid_gstin" });
  }
  if (pan && !isValidPan(pan)) {
    return res.status(400).json({ success: false, error: "invalid_pan" });
  }

  const gstinUpper = gstin ? String(gstin).toUpperCase() : null;
  const autoStateCode = gstinUpper ? stateCodeFromGstin(gstinUpper) : null;

  let adRate = null;
  if (ad_billing_gst_rate != null && ad_billing_gst_rate !== "") {
    const n = Number(ad_billing_gst_rate);
    if (Number.isNaN(n) || n < 0 || n > 40) {
      return res.status(400).json({ success: false, error: "invalid_ad_billing_gst_rate" });
    }
    adRate = n;
  }

  const { rows } = await db.query(
    `UPDATE clients
     SET legal_business_name = COALESCE($1, legal_business_name),
         gstin = COALESCE($2, gstin),
         pan = COALESCE($3, pan),
         registered_address = COALESCE($4, registered_address),
         state_code = COALESCE($5, state_code),
         place_of_supply_state_code = COALESCE($6, place_of_supply_state_code),
         gst_registered = COALESCE($7, gst_registered),
         ad_billing_gst_rate = COALESCE($8, ad_billing_gst_rate)
     WHERE id = $9
     RETURNING id, name, legal_business_name, gstin, pan, registered_address, state_code, place_of_supply_state_code, gst_registered, ad_billing_gst_rate`,
    [
      legal_business_name || null,
      gstinUpper,
      pan ? String(pan).toUpperCase() : null,
      registered_address || null,
      state_code || autoStateCode || null,
      place_of_supply_state_code || null,
      typeof gst_registered === "boolean" ? gst_registered : null,
      adRate,
      clientId,
    ]
  );
  return res.json({ success: true, data: rows[0] });
});

module.exports = router;
