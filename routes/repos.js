const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/auth');

router.get('/', authMiddleware, async (req, res) => {
  try {
    const response = await axios.get('https://api.github.com/user/repos?per_page=100&sort=updated', {
      headers: { Authorization: `Bearer ${req.session.user.accessToken}` }
    });
    const repos = response.data.map(r => ({
      id: r.id, name: r.name, fullName: r.full_name,
      private: r.private, language: r.language,
      updatedAt: r.updated_at, url: r.html_url,
      stars: r.stargazers_count
    }));
    res.json({ repos });
  } catch (err) {
    console.error('Repos error:', err.message);
    res.status(500).json({ error: 'Failed to fetch repos' });
  }
});

// ADD THIS ROUTE to routes/repos.js — paste before module.exports = router;

router.get('/:owner/:repo/branch', async (req, res) => {
  const { owner, repo } = req.params;
  const accessToken = req.session.user?.accessToken;
  if (!accessToken) return res.json({ branch: 'main' });
  try {
    const axios = require('axios');
    const r = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    res.json({ branch: r.data.default_branch || 'main' });
  } catch(e) {
    res.json({ branch: 'main' });
  }
});
module.exports = router;
