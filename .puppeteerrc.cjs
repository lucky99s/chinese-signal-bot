/**
 * Puppeteer config — store Chrome inside the project folder so it
 * survives Render/Heroku/Railway deploys (default ~/.cache/puppeteer
 * gets wiped between builds and runtime, causing:
 *   "Could not find Chrome (ver. XXX). This can occur if..."
 */
const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
