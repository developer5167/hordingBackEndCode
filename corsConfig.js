/**
 * Browser origins allowed to call this API (CORS).
 * Local dev + production frontends. Socket.IO stays permissive for mobile/TV clients.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://digitalhording.admin.sotersystems.in",
  "https://digitalhording.super.sotersystems.in",
  "https://digitalhording.sotersystems.in",
];

function buildAllowedOriginSet() {
  const set = new Set(DEFAULT_ALLOWED_ORIGINS);
  const extra = process.env.CORS_EXTRA_ORIGINS;
  if (extra && String(extra).trim()) {
    String(extra)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((o) => set.add(o));
  }
  return set;
}

function corsOriginCallback(allowedSet) {
  return function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    if (allowedSet.has(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  };
}

module.exports = { buildAllowedOriginSet, corsOriginCallback };
