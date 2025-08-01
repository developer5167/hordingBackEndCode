const client = require("../db");
const jwtToken = require("jsonwebtoken");
const { route } = require("../router");
const router = require("../router");
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
    const decode = jwtToken.verify(auth, "THISISTESTAPPFORHORDING");
    var sql = "SELECT tokens FROM users WHERE email=$1 and client_id = $2";
    const { rows } = await client.query(sql, [decode["email"],req.client_id]);
    if (rows.length != 0) {
      if (rows[0].tokens.includes(auth)) {
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
