[DEPLOY_NOTES.md](https://github.com/user-attachments/files/29049897/DEPLOY_NOTES.md)
# v5.1 — Fixes Included

## 1. Puppeteer "Could not find Chrome" — FIXED
Root cause: Render/Heroku/Railway wipe `~/.cache/puppeteer` between
deploys, so Chrome downloaded during `npm install` is gone at runtime.

Fixes applied:
- `.puppeteerrc.cjs` pins Chrome cache to `<project>/.cache/puppeteer`
  (ships with the deploy).
- `package.json` `postinstall` re-runs `npx puppeteer browsers install chrome`.
- `server.js` honors `PUPPETEER_EXECUTABLE_PATH` env var as fallback.

### On Render
- Build Command: `npm install`  (postinstall handles Chrome automatically)
- If it still fails, override Build Command to:
  `npm install && npx puppeteer browsers install chrome`
- Alternative: install system Chromium and set env
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`

## 2. Admin Panel — Auto-Login accessibility — FIXED
- Floating 🤖 button (bottom-right) is now visible on **every** screen,
  with a red badge when sessions are waiting for OTP.
- Mobile top-bar with hamburger + quick Auto-Login button.
- Sidebar slides in as a drawer on mobile (was a cramped 60px strip before).

## 3. Run locally
```
npm install
node server.js
```
