[SETUP.md](https://github.com/user-attachments/files/28907913/SETUP.md)
# Chinese Signal Bot v4 — MongoDB Setup Guide

## What Changed
- Replaced PostgreSQL (`pg`) with MongoDB (`mongoose`)
- Data now stored permanently in MongoDB Atlas (free forever)
- Same API, same admin panel, same bot page — nothing else changes

---

## Step 1 — Create Free MongoDB Atlas Database (5 minutes)

1. Go to https://www.mongodb.com/atlas and sign up (free, no credit card)
2. Click **"Build a Database"** → Choose **FREE** tier (M0)
3. Pick any cloud provider (AWS is fine) and region closest to you
4. Click **"Create"**
5. On the "Security" screen:
   - Set a username and password → **Save these somewhere**
   - Click **"Create User"**
6. On "Where would you like to connect from?":
   - Choose **"My Local Environment"**
   - In the IP field, type `0.0.0.0/0` → click **Add Entry** (allows all IPs including Render)
   - Click **"Finish and Close"**
7. Click **"Connect"** → **"Drivers"** → Copy the connection string

   It looks like:
   ```
   mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

8. Add your database name to the URL (before the `?`):
   ```
   mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/csbot?retryWrites=true&w=majority
   ```

---

## Step 2 — Update Your GitHub Repo

Replace these two files in your GitHub repo:
- `server.js` → use the new `server.js` from this package
- `package.json` → use the new `package.json` from this package

---

## Step 3 — Set Environment Variable on Render

1. Go to your Render dashboard → your web service
2. Click **"Environment"** tab
3. Add a new variable:
   - **Key:** `MONGODB_URI`
   - **Value:** your connection string from Step 1
4. Click **"Save Changes"**
5. Render will automatically redeploy

---

## Step 4 — Verify It's Working

Visit your Render URL — you should see:
```
✅ Chinese Signal Bot Server v3 Running — Storage: MongoDB Atlas (PERMANENT)
```

---

## Why Data Was Disappearing Before

Render's free tier "sleeps" your server after inactivity and restarts it.
When restarting, any files stored on disk (`data/users.json`) are wiped.
MongoDB Atlas stores data in the cloud separately from your server,
so it survives every restart, sleep, and redeploy — permanently.

---

## Admin Login (unchanged)
- Username: `Lucky8i`
- Password: `Jana8i`
- 2FA Code: `22045`
- Admin Key: `CSAI-NEWX-ADMI-N999`
