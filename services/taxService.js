const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

function normalizeValue(value) {
  return value == null ? "" : String(value).trim().toUpperCase();
}

function isValidGstin(gstin) {
  const v = normalizeValue(gstin);
  if (!v) return true;
  return GSTIN_REGEX.test(v);
}

function isValidPan(pan) {
  const v = normalizeValue(pan);
  if (!v) return true;
  return PAN_REGEX.test(v);
}

function stateCodeFromGstin(gstin) {
  const v = normalizeValue(gstin);
  if (!v || v.length < 2) return null;
  return v.slice(0, 2);
}

/**
 * Client place of supply for GST — same fallbacks as typical B2B invoicing:
 * explicit POS → state_code → first two digits of GSTIN.
 */
function resolvePlaceOfSupplyStateCode(row) {
  if (!row) return null;
  const pos = row.place_of_supply_state_code;
  if (pos != null && String(pos).trim() !== "") {
    return String(pos).trim();
  }
  const sc = row.state_code;
  if (sc != null && String(sc).trim() !== "") {
    return String(sc).trim();
  }
  if (row.gstin) {
    return stateCodeFromGstin(row.gstin);
  }
  return null;
}

function computeGstBreakdown({
  amount = 0,
  gstRate = 18,
  supplierStateCode = null,
  placeOfSupplyStateCode = null,
  gstRegistered = false,
}) {
  const taxableAmount = Number(amount || 0);
  if (!gstRegistered || taxableAmount <= 0 || !placeOfSupplyStateCode) {
    return {
      taxable_amount: taxableAmount,
      gst_rate: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total_amount: taxableAmount,
      tax_mode: "no_gst",
    };
  }

  const rate = Number(gstRate || 0);
  const totalTax = Number(((taxableAmount * rate) / 100).toFixed(2));
  const sameState =
    String(supplierStateCode || "") === String(placeOfSupplyStateCode || "");

  if (sameState) {
    const half = Number((totalTax / 2).toFixed(2));
    return {
      taxable_amount: taxableAmount,
      gst_rate: rate,
      cgst: half,
      sgst: Number((totalTax - half).toFixed(2)),
      igst: 0,
      total_amount: Number((taxableAmount + totalTax).toFixed(2)),
      tax_mode: "cgst_sgst",
    };
  }

  return {
    taxable_amount: taxableAmount,
    gst_rate: rate,
    cgst: 0,
    sgst: 0,
    igst: totalTax,
    total_amount: Number((taxableAmount + totalTax).toFixed(2)),
    tax_mode: "igst",
  };
}

function getSupplierTaxNote({
  supplierGstRegistered = false,
  supplierLegalName = "SOTER SYSTEMS",
}) {
  if (!supplierGstRegistered) {
    return `${supplierLegalName} is not registered under GST. GST is not charged in this preview.`;
  }
  return `GST applies as shown below for ${supplierLegalName} based on place of supply.`;
}

module.exports = {
  isValidGstin,
  isValidPan,
  stateCodeFromGstin,
  resolvePlaceOfSupplyStateCode,
  computeGstBreakdown,
  getSupplierTaxNote,
};
