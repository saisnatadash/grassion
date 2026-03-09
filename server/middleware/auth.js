'use strict';
const jwt = require('jsonwebtoken');
const db  = require('../lib/db');

module.exports = async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Unauthorized' });
  const token = header.replace('Bearer ', '').trim();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    return next();
  } catch {}
  try {
    const r = await db.query('SELECT id,plan FROM users WHERE api_token=$1', [token]);
    if (r.rows.length) { req.userId = r.rows[0].id; req.userPlan = r.rows[0].plan; return next(); }
  } catch {}
  return res.status(401).json({ error: 'Invalid token' });
};
