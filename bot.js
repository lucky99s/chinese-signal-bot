const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";

// ── ADDITIVE (v8): shared config for the new admin helper commands ────────────
const API_BASE  = process.env.API_BASE  || "https://chinese-signal-bot.onrender.com";
const ADMIN_KEY = process.env.ADMIN_KEY || "CSAI-NEWX-ADMI-N999";

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
        const url = `${API_BASE}/api/trigger-connected?userName=${encodeURIComponent(userName)}`;

        await axios.get(url);

        bot.sendMessage(chatId, `✅ Trigger sent successfully!\n\n👤 User: **${userName}**\nThey should now see the popup.`, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Failed to trigger. Check if server is running.");
        console.error(error);
    }
});

// Start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        "Welcome!\n\n" +
        "Use these commands:\n" +
        "/trigger Name — show the connected popup\n\n" +
        "🛒 Orders\n" +
        "/orders — pending orders\n" +
        "/order <id> — order details + 1-click contact\n" +
        "/sendstatus — ready-made status messages\n\n" +
        "🎁 Promo codes\n" +
        "/promos — active promo codes\n" +
        "/promo <code> — check one code"
    );
});

// ═════════════════════════════════════════════════════════════════════════════
// ADDITIVE (v8) — ORDER HELPERS
// Everything below is new. The /trigger and /start commands above are untouched.
// ═════════════════════════════════════════════════════════════════════════════

function esc(t) {
    return String(t == null ? '' : t)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function fetchOrders() {
    const r = await axios.get(`${API_BASE}/api/orders?adminKey=${encodeURIComponent(ADMIN_KEY)}`, { timeout: 15000 });
    return Array.isArray(r.data) ? r.data : [];
}

function priceOf(o) {
    const pkr = o.finalPricePKR || o.planPricePKR;
    const usd = o.finalPriceUSD || o.planPriceUSD;
    return [pkr ? pkr + ' PKR' : '', usd ? '$' + usd : ''].filter(Boolean).join(' / ') || '—';
}

// ── Pre-built status templates ({name} {key} {plan} {price} {orderid}) ────────
const STATUS_TEMPLATES = {
    received: {
        label: '📥 Order Received',
        text:  'Hello {name} 👋\n\n📥 Your order *{orderid}* has been received.\n📦 Plan: {plan}\n💰 Amount: {price}\n\nOur team is checking your payment now. You will get your license key very soon. Thank you for your patience! 🙏',
    },
    verifying: {
        label: '🔎 Verifying Payment',
        text:  'Hello {name} 👋\n\n🔎 We are verifying the payment for order *{orderid}*.\n📦 Plan: {plan}\n\nThis usually takes only a few minutes. We will message you the moment it is approved. ⏳',
    },
    approved: {
        label: '✅ Approved & Key Delivered',
        text:  'Hello {name} 🎉\n\n✅ Your payment is approved and your license is active!\n\n🔑 License Key: `{key}`\n📦 Plan: {plan}\n💰 Paid: {price}\n🆔 Order: {orderid}\n\nOpen the bot, enter this key and start receiving signals. Welcome aboard! 🚀',
    },
    rejected: {
        label: '❌ Payment Proof Issue',
        text:  'Hello {name} 👋\n\n❌ We could not verify the payment proof for order *{orderid}*.\n\nPlease send a clear screenshot showing the transaction ID, amount and date — or send the correct transaction ID so we can re-check.\n\nWe are here to help you get activated. 🙏',
    },
};

function fillTemplate(tpl, o) {
    return String(tpl)
        .replace(/{name}/g,    o.fullName   || 'Customer')
        .replace(/{key}/g,     o.licenseKey || '—')
        .replace(/{plan}/g,    o.planLabel  || o.planKey || '—')
        .replace(/{price}/g,   priceOf(o))
        .replace(/{orderid}/g, o.id || '—');
}

// ── /orders — list pending orders ─────────────────────────────────────────────
bot.onText(/^\/orders\b/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const all = await fetchOrders();
        const pending = all.filter(o => !['Confirmed', 'Completed', 'Rejected', 'Refunded'].includes(o.status));
        if (!pending.length) return bot.sendMessage(chatId, '✅ No pending orders right now.');

        const list = pending.slice(0, 12);
        const text = '🛒 <b>Pending Orders</b> (' + pending.length + ')\n━━━━━━━━━━━━━━━━━━\n' +
            list.map((o, i) =>
                `${i + 1}. <code>${esc(o.id)}</code>\n` +
                `   👤 ${esc(o.fullName)} • ${esc(o.planLabel || o.planKey)}\n` +
                `   💰 ${esc(priceOf(o))} • 🔁 ${esc(o.status || 'Pending')}\n` +
                `   ${o.whatsapp ? '📱 ' + esc(o.whatsapp) : ''}${o.telegram ? ' ✈️ ' + esc(o.telegram) : ''}`
            ).join('\n\n') +
            '\n\n👉 Use /order ' + esc(list[0].id) + ' for full details.';

        bot.sendMessage(chatId, text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: list.slice(0, 6).map(o => ([{ text: '👁 ' + o.id, callback_data: 'v8order|' + o.id }])) },
        });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Could not load orders: ' + (e.message || 'server error'));
    }
});

// ── /order <id> — details + 1-click customer contact ─────────────────────────
async function sendOrderDetails(chatId, id) {
    const all = await fetchOrders();
    const o = all.find(x => String(x.id).toUpperCase() === String(id).toUpperCase());
    if (!o) return bot.sendMessage(chatId, '❌ Order not found: ' + id);

    const text =
        `📦 <b>Order ${esc(o.id)}</b>\n━━━━━━━━━━━━━━━━━━\n` +
        `👤 Name: <b>${esc(o.fullName)}</b>\n` +
        `📱 WhatsApp: <code>${esc(o.whatsapp || '—')}</code>\n` +
        `✈️ Telegram: <code>${esc(o.telegram || '—')}</code>\n` +
        `🌍 Country: ${esc(o.country || '—')}\n` +
        `📦 Plan: <b>${esc(o.planLabel || o.planKey)}</b>\n` +
        `💰 Price: <b>${esc(priceOf(o))}</b>\n` +
        (o.promoCode ? `🎁 Promo: <b>${esc(o.promoCode)}</b> (−${esc(o.discountPKR || 0)} PKR)\n` : '') +
        `💳 Payment: ${esc(o.paymentMethod || '—')}\n` +
        `🔖 TX ID: <code>${esc(o.txId || '—')}</code>\n` +
        `🔑 Key: <code>${esc(o.licenseKey || 'not assigned')}</code>\n` +
        `🔁 Status: <b>${esc(o.status || 'Pending')}</b>`;

    const contactRow = [];
    if (o.whatsapp) contactRow.push({ text: '💬 WhatsApp', url: 'https://wa.me/' + String(o.whatsapp).replace(/\D/g, '') });
    if (o.telegram) contactRow.push({ text: '✈️ Telegram', url: 'https://t.me/' + String(o.telegram).replace(/^@/, '') });

    bot.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                ...(contactRow.length ? [contactRow] : []),
                [{ text: '📨 Send a status message', callback_data: 'v8status|' + o.id }],
            ],
        },
    });
}

bot.onText(/^\/order\s+(\S+)/, async (msg, match) => {
    try { await sendOrderDetails(msg.chat.id, match[1].trim()); }
    catch (e) { bot.sendMessage(msg.chat.id, '❌ ' + (e.message || 'server error')); }
});

// ── /sendstatus [orderId] — pick a ready-made status message ──────────────────
function statusKeyboard(orderId) {
    return {
        inline_keyboard: Object.keys(STATUS_TEMPLATES).map(k => ([
            { text: STATUS_TEMPLATES[k].label, callback_data: 'v8tpl|' + k + '|' + (orderId || '-') },
        ])),
    };
}

bot.onText(/^\/sendstatus(?:\s+(\S+))?/, async (msg, match) => {
    const chatId  = msg.chat.id;
    const orderId = (match[1] || '').trim();
    if (!orderId) {
        return bot.sendMessage(chatId,
            '📨 <b>Status messages</b>\n\nUse <code>/sendstatus ORDER-ID</code> to get the ready-to-send text for a specific order,\nor tap a template below to see it with placeholders.',
            { parse_mode: 'HTML', reply_markup: statusKeyboard('') });
    }
    bot.sendMessage(chatId, '📨 Choose the status message for <code>' + esc(orderId) + '</code>:',
        { parse_mode: 'HTML', reply_markup: statusKeyboard(orderId) });
});

// ═════════════════════════════════════════════════════════════════════════════
// ADDITIVE (v8) — PROMO CODE COMMANDS
// ═════════════════════════════════════════════════════════════════════════════
bot.onText(/^\/promos\b/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const r = await axios.get(`${API_BASE}/api/promo-codes?adminKey=${encodeURIComponent(ADMIN_KEY)}`, { timeout: 15000 });
        const list = (Array.isArray(r.data) ? r.data : []).filter(p => p.active !== false);
        if (!list.length) return bot.sendMessage(chatId, 'ℹ️ No active promo codes.');
        const text = '🎁 <b>Active Promo Codes</b>\n━━━━━━━━━━━━━━━━━━\n' + list.map(p =>
            `<code>${esc(p.code)}</code> — ${esc(p.label || '')}\n` +
            `   ${p.type === 'fixed' ? 'Fixed price' : 'Discount'}: ${esc(p.amountPKR)} PKR / $${esc(p.amountUSD)}` +
            (p.planKey ? ` • plan: ${esc(p.planKey)}` : ' • all plans') +
            ` • used ${esc(p.uses || 0)}×`
        ).join('\n\n');
        bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Could not load promo codes: ' + (e.message || 'server error'));
    }
});

bot.onText(/^\/promo\s+(\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code   = match[1].trim().toUpperCase();
    try {
        const r = await axios.post(`${API_BASE}/api/promo-codes/validate`, { code }, { timeout: 15000 });
        const d = r.data || {};
        if (!d.valid) return bot.sendMessage(chatId, `❌ <code>${esc(code)}</code> — ${esc(d.error || 'invalid')}`, { parse_mode: 'HTML' });
        bot.sendMessage(chatId,
            `✅ <code>${esc(code)}</code> is valid\n` +
            (d.label ? `📝 ${esc(d.label)}\n` : '') +
            `💸 ${d.type === 'fixed' ? 'Sets the price to' : 'Takes off'}: ${esc(d.discountPKR || d.finalPKR)} PKR`,
            { parse_mode: 'HTML' });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Could not check the code: ' + (e.message || 'server error'));
    }
});

// ── Inline button handler for the new v8 buttons only ────────────────────────
bot.on('callback_query', async (q) => {
    const data   = q.data || '';
    const chatId = q.message?.chat?.id;
    if (!chatId || !data.startsWith('v8')) return;   // never touch other handlers

    try {
        if (data.startsWith('v8order|')) {
            await bot.answerCallbackQuery(q.id).catch(() => {});
            return sendOrderDetails(chatId, data.split('|')[1]);
        }
        if (data.startsWith('v8status|')) {
            await bot.answerCallbackQuery(q.id).catch(() => {});
            const orderId = data.split('|')[1];
            return bot.sendMessage(chatId, '📨 Choose the status message for <code>' + esc(orderId) + '</code>:',
                { parse_mode: 'HTML', reply_markup: statusKeyboard(orderId) });
        }
        if (data.startsWith('v8tpl|')) {
            await bot.answerCallbackQuery(q.id).catch(() => {});
            const [, key, orderId] = data.split('|');
            const tpl = STATUS_TEMPLATES[key];
            if (!tpl) return;
            let body = tpl.text, o = null;
            if (orderId && orderId !== '-') {
                const all = await fetchOrders();
                o = all.find(x => String(x.id).toUpperCase() === orderId.toUpperCase());
                if (o) body = fillTemplate(tpl.text, o);
            }
            const rows = [];
            if (o?.whatsapp) rows.push([{ text: '💬 Send on WhatsApp', url: 'https://wa.me/' + String(o.whatsapp).replace(/\D/g, '') + '?text=' + encodeURIComponent(body) }]);
            if (o?.telegram) rows.push([{ text: '✈️ Open Telegram chat', url: 'https://t.me/' + String(o.telegram).replace(/^@/, '') }]);
            return bot.sendMessage(chatId,
                '📋 <b>' + esc(tpl.label) + '</b>\n\n<pre>' + esc(body) + '</pre>\n\n(Long-press the text to copy, or tap a button.)',
                { parse_mode: 'HTML', reply_markup: rows.length ? { inline_keyboard: rows } : undefined });
        }
    } catch (e) {
        bot.sendMessage(chatId, '❌ ' + (e.message || 'server error')).catch(() => {});
    }
});

console.log("✅ Ready! /trigger Name • /orders • /order <id> • /sendstatus • /promos • /promo <code>");
