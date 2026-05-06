const client = require("../db");
client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")
  .then(res => {
    console.log("Columns:", res.rows.map(r => r.column_name));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
