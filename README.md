[README.md](https://github.com/user-attachments/files/29049341/README.md)
# Chinese Signal Bot — Deploy Package

## Stack
- Node.js 18+ / Express 4
- MongoDB (Mongoose 8)
- Puppeteer 22 (Quotex auto-login)
- Telegram Bot API
- Two HTML frontends (no build step needed)

## Quick Start

### 1. Install dependencies
```bash
npm install
```
The `postinstall` script (`scripts/install-chrome.js`) will automatically
download a compatible Chromium binary if `puppeteer` cannot find one.

### 2. Set environment variables
Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `ADMIN_KEY` | Admin panel access key |
| `BOT_TOKEN` | Telegram bot token |
| `CHAT_ID` | Telegram chat/channel ID |
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Express session secret |

### 3. Start the server
```bash
npm start         # production
npm run dev       # development (nodemon)
```

### 4. Access frontends
- **Admin Panel:** `http://localhost:3000/admin`
- **Client Bot Page:** `http://localhost:3000/`

---

## Deploying to Render.com

1. Push this folder to a GitHub repo
2. Create a new **Web Service** on Render
3. Set **Build Command:** `npm install`
4. Set **Start Command:** `npm start`
5. Add all environment variables in the Render dashboard
6. Deploy

> **Note:** Render's free tier may kill long-running Puppeteer processes.
> Use a paid plan or set `PUPPETEER_EXECUTABLE_PATH` to a preinstalled Chrome.

---

## New Features (v2)

### Auto-Login (Broker) Section
- **Session filter tabs** — view All / Active / Need OTP / Logged In / Errors / Closed
- **Auto-refresh toggle** — polls every 10s automatically
- **Retry button** — re-launch failed/closed sessions without reloading
- **Profit shortcut** — click 💰 on a logged-in session card to log profit

### Profit Tracker Section
- Log trade profit + your commission % per client
- Running totals (count, total profit, average per trade)
- Delete individual entries
- Summary card updates live in broker section stats

---

## File Map
```
csbot-deploy/
├── server.js           Main Express server (Puppeteer fix + new APIs)
├── admin_panel.html    Admin interface (redesigned broker + profit tracker)
├── main-bot.html       Client-facing Telegram bot page
├── package.json        Dependencies + postinstall Chrome installer
├── scripts/
│   └── install-chrome.js  Auto Chromium downloader
├── .env.example        Environment variable template
└── README.md           This file
```
