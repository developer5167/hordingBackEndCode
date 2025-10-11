const { Client } = require("pg");
const client = new Client({
  host: "localhost",
  port: 5432,
  user: "postgres", // replace with your PostgreSQL username
  password: "admin", // replace with your PostgreSQL password
  database: "hording_tenant_based", // replace with your PostgreSQL database name
});
client
  .connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch((err) => console.error("Connection error", err.stack));

module.exports = client;
