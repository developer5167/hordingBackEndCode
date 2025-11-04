const { Client } = require("pg");
// const client = new Client({
//   name:"CONNECTION_NAME",
//   host: "pg-fbcf2b8-kapilit-d70e.d.aivencloud.com",
//   port: 22347,
//   user: "avnadmin", // replace with your PostgreSQL username
//   password: "AVNS_fIA1V5imhTZt-vb_VrN", // replace with your PostgreSQL password
//   database: "defaultdb", // replace with your PostgreSQL database name
//   ssl: {
//     rejectUnauthorized: false // needed for self-signed certs on free tiers
//   }
// });
const client = new Client({
  host: "localhost",
  port: 5432,
  user: "kcs", // replace with your PostgreSQL username
  password: "", // replace with your PostgreSQL password
  database: "hording_tenant_based", // replace with your PostgreSQL database name
  // ssl: {
  //   rejectUnauthorized: false // needed for self-signed certs on free tiers
  // }
});
client
  .connect()
  .then(() => console.log("Connected to PostgreSQL"))
  .catch((err) => console.error("Connection error", err.stack));

module.exports = client;
