// middleware/ratelimit.js
// Simple in-memory rate limiter for brute-force protection

const rateLimitMap = new Map();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 300000);

function rateLimit(options = {}) {
  const {
    windowMs = 60000,   // time window in ms (default: 1 minute)
    max = 5,             // max attempts per window
    message = 'Too many attempts. Please try again later.'
  } = options;

  return (req, res, next) => {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      rateLimitMap.set(key, entry);
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      res.status(429).json({
        error: message,
        retryAfter: Math.ceil((entry.resetAt - now) / 1000)
      });
      return;
    }

    next();
  };
}

// Separate limiter with shorter window for verification code attempts
function verifyRateLimit() {
  return rateLimit({
    windowMs: 300000,  // 5 minutes
    max: 10,            // 10 attempts per 5 min
    message: 'Too many verification attempts. Please log in again.'
  });
}

function loginRateLimit() {
  return rateLimit({
    windowMs: 60000,   // 1 minute
    max: 5,            // 5 login attempts per minute
    message: 'Too many login attempts. Please wait before trying again.'
  });
}

module.exports = { rateLimit, loginRateLimit, verifyRateLimit };
