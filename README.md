[README.md](https://github.com/user-attachments/files/28906986/README.md)
# Chinese Signal Bot v5

AI Auto Chinese Signal Bot — Full-stack Express + MongoDB + HTML admin/bot frontend.

## Quick Start

```bash
npm install
npm start
```

Server runs on port **3000** by default.

## Environment Variables

Copy `.env.example` → `.env` and fill in your values:

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | Recommended | MongoDB Atlas connection string. Falls back to `./data/` file storage if not set. |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token for admin alerts |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat ID for admin alerts |
| `PORT` | Optional | HTTP port (default: 3000) |

## Files

| File | Description |
|---|---|
| `server.js` | Express + MongoDB backend (all API routes) |
| `admin_panel.html` | Admin control panel (open in browser) |
| `main-bot.html` | User-facing bot frontend (open in browser) |
| `package.json` | Node.js dependencies |
| `.env.example` | Environment variable template |

## v5 Features

1. **Smart Notification Popups** — Show ONCE per event, ≤2s alarm, auto-dismiss after 5s, no stale popups on admin login
2. **Notifications Admin Tab** — Full history with timestamps, Mute/Stop Sound/Clear/Delete buttons, persisted in MongoDB
3. **Spam Login Protection** — Server + client-side rate limiting (blocks after 3-4 attempts), "Wait some time and try again later" popup with countdown
4. **Live Activity Feed Deduplication** — Repeated events consolidated with count (×N), no flooding
5. **User Records** — No duplicate records, Delete User button per row with confirmation dialog
6. **Msg Injector** — Send to single/multiple/all users, search bar, multi-select checkboxes, message preview before send
7. **Demo Trades History** — After Account Setup, shows dynamic trade history based on balance/profit target; profits first then losses; progressive reveal animation; Trade ID, Pair, Entry/Exit Price, P/L, Time, Status columns; Total Loss shown at bottom

## Deploy to Render / Railway / VPS

1. Push files to a GitHub repo
2. Connect to Render (or Railway)
3. Set `MONGODB_URI`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` as environment variables
4. Deploy — server auto-starts with `npm start`
5. Update `API_BASE` in `admin_panel.html` and `main-bot.html` to your deployed URL

## Admin Credentials

```
Username: Lucky8i
Password: Jana8i
2FA Code: 22045
Admin Key: CSAI-NEWX-ADMI-N999
```

**Change these before going live.**
