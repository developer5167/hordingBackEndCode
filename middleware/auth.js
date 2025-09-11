const {
  express,
  upload,       // multer memory-storage ready
  uuidv4,
  jwt,
  bcrypt,
  nodemailer,
  path,
  crypto,
  consoleLog,
  http,
  cors,
  db,
  admin,
} = require("../deps");
const auth = async (req, res, next) => {
  const {client_id} = req.body
  var auth = req.header("Authorization");
  if (!auth) {
    res.status(400).send({ message: "unauthorised access"});
    return;
  } else {
    auth = auth.replace("Bearer ", "");
  }
  try {
    const decode = jwt.verify(auth, "THISISTESTAPPFORHORDING");
    var sql = "SELECT tokens,id FROM users WHERE email=$1 and client_id = $2";
    const { rows } = await db.query(sql, [decode["email"],req.client_id]);
    if (rows.length != 0) {
      if (rows[0].tokens.includes(auth)) {
        req.user_id = rows[0].id
        next();
      } else {
        res.status(200).json({ message: "Invalid credentials","status":false });
      }
    } else {
      res.status(200).send({ message: "Invalid credentials","status":false  });
    }
  } catch (e) {
    res.status(500).json({ message: "Invalid credentials","status":false });
  }
};
module.exports = auth;
