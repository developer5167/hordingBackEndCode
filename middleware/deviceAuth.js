const {
  express,
  jsonwebtoken,
  db} = require("../deps")

  const  deviceAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
    req.device_id = decoded.device_id;
    req.client_id = decoded.client_id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}
module.exports = deviceAuth
