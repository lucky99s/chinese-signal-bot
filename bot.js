const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// Replace with your token
const TELEGRAM_BOT_TOKEN = "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

console.log("🤖 Telegram Bot is running...");

// Command: /trigger Name
bot.onText(/\/trigger (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userName = match[1].trim();   // Get the name after /trigger

    if (!userName) {
        return bot.sendMessage(chatId, "❌ Please enter a name. Example: /trigger Ahmed");
    }

    try {
        const triggerUrl = `https://chinese-signal-bot.onrender.com/api/trigger-connected?userName=${encodeURIComponent(userName)}`;
        
        await axios.get(triggerUrl);

        bot.sendMessage(chatId, `✅ Trigger sent successfully!\n\nUser: **${userName}**\nThey should now see "Account is Connected Successfully" popup.`, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Failed to trigger. Make sure your server is running.");
        console.error(error);
    }
});

// Simple start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Welcome! Use /trigger Name to show popup on website.\n\nExample: /trigger Ahmed");
});

console.log("✅ Bot commands ready: /trigger Name");
