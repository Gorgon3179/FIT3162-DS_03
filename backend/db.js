// db.js - PostgreSQL/Supabase connection
const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[DB] FATAL: DATABASE_URL is not set. Please configure your .env file.');
  process.exit(1);
}

// Parse BIGINT (OID 20) as number — our IDs fit in JS safe integer range
const { types } = require('pg');
types.setTypeParser(20, (val) => parseInt(val, 10));

let client = null;
let connected = false;

async function connect() {
  client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  client.on('error', (err) => {
    console.error('[DB] Client error:', err.message);
  });

  try {
    await client.connect();
    connected = true;
    console.log('[DB] Connected to PostgreSQL');
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    process.exit(1);
  }
}

async function query(sql, params = []) {
  if (!connected) {
    throw new Error('Database not connected. Call connect() first.');
  }
  const result = await client.query(sql, params);
  return result.rows;
}

function getClient() {
  return client;
}

module.exports = {
  query,
  getClient,
  connect
};
