const jwt = require('jsonwebtoken');

function signUserToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
}

function verifyUserToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function signAdminToken(payload) {
  return jwt.sign(payload, process.env.ADMIN_JWT_SECRET, {
    expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '7d',
  });
}

function verifyAdminToken(token) {
  return jwt.verify(token, process.env.ADMIN_JWT_SECRET);
}

module.exports = { signUserToken, verifyUserToken, signAdminToken, verifyAdminToken };
