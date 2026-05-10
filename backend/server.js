// server.js - MonashVote Backend
require('dotenv').config({ quiet: true, path: __dirname + '/.env' });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Serve the frontend folder (all your HTML files live here)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/elections', require('./routes/elections'));
app.use('/api/traits',    require('./routes/traits'));
app.use('/api/admin',     require('./routes/admin'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Fallback: serve index.html for any non-API route ─────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const { connect } = require('./db');
connect().then(() => {
  app.listen(PORT, () => {
    console.log(`🗳️  MonashVote backend running at http://localhost:${PORT}`);
    console.log(`📋  Open http://localhost:${PORT} in your browser`);
  });
}).catch(err => {
  console.error('[server] Failed to start:', err.message);
  process.exit(1);
});
