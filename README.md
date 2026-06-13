[README.md](https://github.com/user-attachments/files/28907915/README.md)
# Chinese Signal Bot — Deployment Guide v3.1

## What's New in This Version

- **Permanent PostgreSQL storage** — data survives ALL server restarts and sleep cycles
- **100k+ concurrent users** — connection pool of 100, proper indexes on all query fields
- **Admin key updated** — new key: `CSAI-NEWX-ADMI-N999`
- **Zero data loss** — users, licenses, OTPs, activities, messages all stored permanently
- **Smart fallback** — works without a database too (file-based storage)

---

## Files Included

| File | Description |
|------|-------------|
| `server.js` | Main backend server (PostgreSQL + file fallback) |
| `admin_panel.html` | Admin panel (serve as static file or open directly) |
| `main-bot.html` | Main bot page (serve as static file or open directly) |
| `package.json` | Dependencies including `pg` for PostgreSQL |
| `.env.example` | Environment variable template |

---

## Quick Deploy on Render.com (Recommended — Free Tier)

### Step 1 — Create a PostgreSQL database (FREE)

1. Go to [render.com](https://render.com) → **New → PostgreSQL**
2. Name it `csbot-db`, choose Free plan → **Create Database**
3. Copy the **"External Database URL"** (starts with `postgresql://`)

### Step 2 — Deploy the server

1. Push these files to a GitHub repo (or use Render's manual deploy)
2. **New → Web Service** → connect your repo
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Under **Environment Variables**, add:
   ```
   DATABASE_URL = postgresql://... (paste the URL from Step 1)
   ```
5. Click **Deploy**

### Step 3 — Verify it's working

Visit `https://your-app.onrender.com/` — you should see:
```
✅ Chinese Signal Bot Server v3 Running — Storage: PostgreSQL (Permanent)
```

---

## Deploy on Railway.app (Also Free)

1. **New Project → Deploy from GitHub**
2. Add a **PostgreSQL** plugin (click +)
3. Railway auto-sets `DATABASE_URL` — no manual config needed
4. Set start command: `node server.js`

---

## Deploy on Fly.io

```bash
fly launch
fly postgres create --name csbot-db
fly postgres attach csbot-db
fly deploy
```

---

## Free PostgreSQL Options (No Credit Card)

| Provider | Free Tier | Notes |
|----------|-----------|-------|
| [Neon.tech](https://neon.tech) | 3 GB | Serverless, auto-scales |
| [Supabase](https://supabase.com) | 500 MB | Great dashboard |
| [Railway](https://railway.app) | $5/month credit | Easy setup |
| Render PostgreSQL | 90 days free | Then $7/month |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | **Yes** (for permanent storage) | PostgreSQL connection string |
| `PORT` | No (default: 3000) | Server port |
| `DATA_DIR` | No | File storage path (file-mode only) |

---

## Admin Panel

Open `admin_panel.html` in your browser.

- **Admin Login:** `Lucky8i` / `Jana8i` / `22045`
- **Maintenance Admin Key:** `CSAI-NEWX-ADMI-N999`

---

## Important Notes

1. **The main bot URL** (`https://chinese-signal-bot.onrender.com`) is hardcoded in `main-bot.html` — update it if your server URL changes.
2. **Maintenance mode** is stored in memory (resets on restart). This is intentional — maintenance should be manually toggled.
3. **File storage fallback** — if `DATABASE_URL` is not set, data is stored in the `data/` folder. On Render free tier, this WILL be lost on restart unless you mount a persistent disk.

---

## Database Tables Created Automatically

| Table | Purpose |
|-------|---------|
| `users` | All user records (credentials, OTPs, status) |
| `licenses` | License keys and their status |
| `pending_messages` | Messages queued for users via Msg Injector |
| `activity_log` | Global activity history |

No manual migration needed — tables are created on first startup.
