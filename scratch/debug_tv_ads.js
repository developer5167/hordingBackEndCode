const { Client } = require('pg');
require('dotenv').config();

async function checkAds() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    await client.connect();
    console.log("Connected to DB");
    const r = await client.query('SELECT ad_id, status, start_date, end_date FROM ad_devices WHERE device_id = $1', ['28f6673d-deb9-4bc5-b1c4-f35f2c4a00e6']);
    console.log('Ads for device:', JSON.stringify(r.rows, null, 2));
    
    const now = new Date();
    console.log('Current server time:', now.toISOString());
    
    // Check all ads for this client too
    const clientAds = await client.query('SELECT ads.id, ads.title, ad_devices.status, ad_devices.start_date, ad_devices.end_date FROM ad_devices JOIN ads ON ads.id = ad_devices.ad_id WHERE ad_devices.device_id = $1', ['28f6673d-deb9-4bc5-b1c4-f35f2c4a00e6']);
    console.log('Detailed ads:', JSON.stringify(clientAds.rows, null, 2));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

checkAds();
