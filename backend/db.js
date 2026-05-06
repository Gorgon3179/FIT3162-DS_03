// db.js - Database connection
// Your friend connects this to PostgreSQL by setting DATABASE_URL in .env
// In dev mode it uses an in-memory store so you can run without a DB

const DEV_MODE = process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL;

let pool = null;

if (!DEV_MODE) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
  console.log('[DB] Connected to PostgreSQL');
} else {
  console.log('[DB] Running in-memory dev mode (no real database)');
}

// ─── In-memory store for dev/demo ───────────────────────────────────────────
const mem = {
  users: [],          // { id, email, passwordHash, verified, createdAt }
  verCodes: [],       // { email, code, expiresAt }
  elections: [        // seed data
    {
      id: 1, title: 'Club 1 President Election', description: 'Vote for the next president of Club 1',
      status: 'open', closesAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      candidates: [
        { id: 1, name: 'Candidate 1', year: 'Year 3', degree: 'Computer Science' },
        { id: 2, name: 'Candidate 2', year: 'Year 2', degree: 'Engineering' },
        { id: 3, name: 'Candidate 3', year: 'Year 4', degree: 'Business' },
        { id: 4, name: 'Candidate 4', year: 'Year 1', degree: 'Science' },
        { id: 5, name: 'Candidate 5', year: 'Year 3', degree: 'Arts' },
      ]
    },
    {
      id: 2, title: 'Club 2 President Election', description: 'Vote for the next president of Club 2',
      status: 'open', closesAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
      candidates: [
        { id: 6, name: 'Candidate A', year: 'Year 2', degree: 'Arts' },
        { id: 7, name: 'Candidate B', year: 'Year 3', degree: 'Science' },
        { id: 8, name: 'Candidate C', year: 'Year 1', degree: 'Business' },
      ]
    }
  ],
  ballots: [],        // { id, electionId, voterHash, rankings: [{candidateId, rank}], submittedAt }
  traits: [],         // { voterId, yearOfStudy, faculty, campus, countryOfOrigin, clubsJoined }
};

// ─── Query helper ────────────────────────────────────────────────────────────
// If using real DB: passes SQL to PostgreSQL
// If dev mode: routes to in-memory functions below
async function query(sql, params = []) {
  if (pool) {
    const result = await pool.query(sql, params);
    return result.rows;
  }
  throw new Error('query() called in dev mode - use db.*() functions directly');
}

module.exports = { query, mem, isDev: DEV_MODE };
