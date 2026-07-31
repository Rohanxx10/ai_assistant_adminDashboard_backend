const { verifyAdminToken } = require('../utils/jwt');

// Protects every endpoint used by the ADMIN DASHBOARD.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing admin auth token' });
  }

  try {
    const decoded = verifyAdminToken(token);
    req.adminId = decoded.adminId;
    req.adminUsername = decoded.username;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

module.exports = { requireAdmin };
