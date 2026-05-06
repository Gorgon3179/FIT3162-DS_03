// middleware/auth.js
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  // In dev mode any user whose email starts with 'admin' is treated as admin
  const isAdmin = req.user?.email?.startsWith('admin') || req.user?.isAdmin;
  if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = { authenticate, requireAdmin };
