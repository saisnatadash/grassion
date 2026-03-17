const db = require('../db');
const axios = require('axios');

async function getLocationFromIP(ip) {
  try {
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168')) return 'Local';
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=city,regionName,country`);
    const d = res.data;
    return `${d.city}, ${d.regionName}, ${d.country}`;
  } catch { return 'Unknown'; }
}

async function trackEvent(userId, eventType, page, metadata, ip) {
  try {
    const location = await getLocationFromIP(ip);
    await db.query(
      `INSERT INTO analytics (user_id, event_type, page, metadata, ip_address, location, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || null, eventType, page, JSON.stringify(metadata || {}), ip, location]
    );
    if (userId && location && location !== 'Unknown' && location !== 'Local') {
      await db.query('UPDATE users SET location = $1 WHERE id = $2 AND location IS NULL', [location, userId]);
    }
  } catch (err) {
    console.error('Analytics error:', err.message);
  }
}

async function trackPageView(userId, page, ip) {
  await trackEvent(userId, 'page_view', page, {}, ip);
}

async function trackAction(userId, action, metadata, ip) {
  await trackEvent(userId, action, '', metadata, ip);
}

async function updateTimeSpent(userId, seconds) {
  try {
    await db.query('UPDATE users SET total_time_spent = total_time_spent + $1 WHERE id = $2', [seconds, userId]);
  } catch (err) {
    console.error('Time tracking error:', err.message);
  }
}

module.exports = { trackEvent, trackPageView, trackAction, updateTimeSpent };
