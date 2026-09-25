'use strict';
const express = require('express');
const { q, getSettings } = require('../db');

const router = express.Router();

// Event basics for the sign-in page (countdown, name). Nothing sensitive here.
router.get('/info', (req, res) => {
  const s = getSettings();
  const markers = q.all(
    "SELECT title, starts_at FROM schedule WHERE kind IN ('round','deadline') ORDER BY starts_at"
  );
  res.json({
    event_name: s.event_name,
    tagline: s.tagline,
    venue: s.venue,
    event_start: s.event_start,
    event_end: s.event_end,
    markers,
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
