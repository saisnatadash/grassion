const db = require('../db');

module.exports = async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [req.session.user.id]);
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    const user = result.rows[0];
    const totalScans = user.scans_used || 0;
    const bonusScans = user.bonus_scans || 0;
    const freeLimit = 3 + bonusScans;
    if (user.plan !== 'pro' && totalScans >= freeLimit) {
      return res.status(403).json({ error: 'Scan limit reached. Upgrade to Pro.', upgrade: true });
    }
    req.dbUser = user;
    next();
  } catch (err) {
    console.error('Plan check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
