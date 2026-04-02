const db = require('../db');

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function getOrCreateCode(userId) {
  const result = await db.query('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (result.rows[0]?.referral_code) return result.rows[0].referral_code;
  const code = generateCode();
  await db.query('UPDATE users SET referral_code = $1 WHERE id = $2', [code, userId]);
  return code;
}

async function applyReferral(userId, code) {
  const referrer = await db.query('SELECT id FROM users WHERE referral_code = $1', [code]);
  if (!referrer.rows.length) return { success: false, error: 'Invalid referral code' };
  const alreadyUsed = await db.query('SELECT referred_by FROM users WHERE id = $1', [userId]);
  if (alreadyUsed.rows[0]?.referred_by) return { success: false, error: 'You have already used a referral code' };
  await db.query('UPDATE users SET bonus_scans = bonus_scans + 10, referred_by = $1 WHERE id = $2', [code, userId]);
  await db.query('UPDATE users SET bonus_scans = bonus_scans + 10 WHERE id = $1', [referrer.rows[0].id]);
  return { success: true, message: 'Both you and your friend got 10 bonus scans!' };
}

async function getReferralStats(userId) {
  const referred = await db.query('SELECT COUNT(*) FROM users WHERE referred_by = (SELECT referral_code FROM users WHERE id = $1)', [userId]);
  const user = await db.query('SELECT referral_code, bonus_scans FROM users WHERE id = $1', [userId]);
  return { code: user.rows[0]?.referral_code, referredCount: referred.rows[0]?.count || 0, bonusScans: user.rows[0]?.bonus_scans || 0 };
}

module.exports = { generateCode, getOrCreateCode, applyReferral, getReferralStats };
