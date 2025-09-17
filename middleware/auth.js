const db = require("../db");                 // Postgres client instance
const jsonwebtoken = require("jsonwebtoken");
const auth = async (req, res, next) => {
  var auth = req.header("Authorization");
  if (!auth) {
    res.status(400).send({ message: "unauthorised access"});
    return;
  } else {
    auth = auth.replace("Bearer ", "");
  }
  
  try {
    const decode = jsonwebtoken.verify(auth, "THISISTESTAPPFORHORDING");
    var sql = "SELECT tokens,id FROM users WHERE id=$1 and client_id = $2";
    const { rows } = await db.query(sql, [decode["userId"],req.client_id]);
    if (rows.length != 0) {
      if (rows[0].tokens.includes(auth)) {
        req.user_id = rows[0].id
        req.token = auth
        next();
      } else {
        res.status(200).json({ message: "Invalid credentials","status":false });
      }
    } else {
      res.status(200).send({ message: "Invalid credentials","status":false  });
    }
  } catch (e) {
    console.log(e);
    
    res.status(500).json({ message: "Invalid credentials","status":false });
  }
};
module.exports = auth;
