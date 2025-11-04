const client = require("../db");
// const roleCheck = require("../middleware/checkClientStatus");
const checkValidClient = async (request, response, next) => {
  var auth = request.header("clientAuthorisationKey");
  if (!auth) {
    return response.status(401).json({ error: "invalid client id" });
  }
  
  const query = `select id from clients where id = $1`;
  const result = await client.query(query, [auth]); 
  if (result.rowCount > 0) {
    request.client_id = result.rows[0]["id"];
    next();
  } else {
    response.status(400).send({ message: "invalid client id" });
  }
};
module.exports = checkValidClient;
