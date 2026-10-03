'use strict';
const express = require('express');
const { getSettings } = require('../db');
const { markers } = require('../services/content');

const router = express.Router();

function publicInfo(comp) {
  const s = getSettings(comp);
  return { event_name: s.event_name, tagline: s.tagline, venue: s.venue, event_start: s.event_start, event_end: s.event_end, markers: markers(comp) };
}

// Event basics for the sign-in page (countdowns, names). Nothing sensitive here.
router.get('/info', (req, res) => {
  res.json({
    competitions: { hackathon: publicInfo('hackathon'), ideathon: publicInfo('ideathon') },
    serverTime: new Date().toISOString(),
  });
});

module.exports = router;
