const express = require('express');
const router = express.Router();
const { trackPageView, trackAction, updateTimeSpent } = require('../services/analyticsService');

router.post('/pageview', async (req, res) => {
  const { page } = req.body;
  const userId = req.session?.user?.id || null;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  await trackPageView(userId, page, ip);
  res.json({ ok: true });
});

router.post('/action', async (req, res) => {
  const { action, metadata } = req.body;
  const userId = req.session?.user?.id || null;
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  await trackAction(userId, action, metadata, ip);
  res.json({ ok: true });
});

router.post('/time', async (req, res) => {
  const { seconds } = req.body;
  const userId = req.session?.user?.id;
  if (userId && seconds > 0) await updateTimeSpent(userId, seconds);
  res.json({ ok: true });
});

module.exports = router;
