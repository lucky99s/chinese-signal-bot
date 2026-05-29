const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log("🤖 Chinese Signal Bot Trigger is Running...");

// Command: /trigger <name>
bot.onText(/\/trigger (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userName = match[1].trim();

    if (!userName) {
        return bot.sendMessage(chatId, "❌ Please enter name.\nExample: /trigger Ahmed");
    }

    try {
        const url = `https://chinese-signal-bot.onrender.com/api/trigger-connected?userName=${encodeURIComponent(userName)}`;
        
        await axios.get(url);

        bot.sendMessage(chatId, `✅ Trigger sent successfully!\n\n👤 User: **${userName}**\nThey should now see the popup.`, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Failed to trigger. Check if server is running.");
        console.error(error);
    }
});

// Start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Welcome!\n\nUse this command:\n/trigger Name\n\nExample: /trigger Ahmed");
});

console.log("✅ Ready! Use /trigger Name in your bot");
