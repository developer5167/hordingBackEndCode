const client = require("../db");
 const roleCheck = (auth) => {
  return async (req, res, next) => {
    const checkClientStatus = `select id from clients where id = $1`;
    const result = await client.query(checkClientStatus, [auth]);
    if (result.rowCount > 0) {
      const subscriptionQuery = `select subscription_status from clients where id = $1`;
      const subscriptionResult = await client.query(subscriptionQuery, [auth]);
      if (subscriptionResult.rows[0]["subscription_status"] === "blocked") {
        return res.status(500).json({ message: "client is blocked" });
      }
      console.log(subscriptionResult.rows[0]["subscription_status"]);
    }
  };
};
module.exports = roleCheck;
