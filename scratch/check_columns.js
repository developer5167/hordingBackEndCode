const client = require("../db");
client.query("SELECT * FROM pricing_rules LIMIT 10")
  .then(res => {
    console.log("Rows:", res.rows);
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
