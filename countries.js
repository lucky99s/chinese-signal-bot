// ═══════════════════════════════════════════════════════════════════════════
// countries.js — SINGLE SOURCE OF TRUTH for the supported country list.
// Used by server.js (API + validation) and served to the browser via
// GET /api/countries so no country list is hard-coded in any frontend file.
// ═══════════════════════════════════════════════════════════════════════════

// Countries shown first, in this exact order.
const POPULAR = ['PK', 'IN', 'BD', 'NP', 'CN', 'NG'];

// Primary market — keeps the existing Pakistan experience untouched.
const DEFAULT_COUNTRY = 'PK';

// code, name, dial code, flag emoji, default display currency
const COUNTRIES = [
    { code: 'PK', name: 'Pakistan',            dial: '+92',  flag: '🇵🇰', currency: 'PKR' },
    { code: 'IN', name: 'India',               dial: '+91',  flag: '🇮🇳', currency: 'USD' },
    { code: 'BD', name: 'Bangladesh',          dial: '+880', flag: '🇧🇩', currency: 'USD' },
    { code: 'NP', name: 'Nepal',               dial: '+977', flag: '🇳🇵', currency: 'USD' },
    { code: 'CN', name: 'China',               dial: '+86',  flag: '🇨🇳', currency: 'USD' },
    { code: 'NG', name: 'Nigeria',             dial: '+234', flag: '🇳🇬', currency: 'USD' },
    { code: 'AE', name: 'United Arab Emirates',dial: '+971', flag: '🇦🇪', currency: 'USD' },
    { code: 'AF', name: 'Afghanistan',         dial: '+93',  flag: '🇦🇫', currency: 'USD' },
    { code: 'AU', name: 'Australia',           dial: '+61',  flag: '🇦🇺', currency: 'USD' },
    { code: 'BR', name: 'Brazil',              dial: '+55',  flag: '🇧🇷', currency: 'USD' },
    { code: 'CA', name: 'Canada',              dial: '+1',   flag: '🇨🇦', currency: 'USD' },
    { code: 'DE', name: 'Germany',             dial: '+49',  flag: '🇩🇪', currency: 'USD' },
    { code: 'EG', name: 'Egypt',               dial: '+20',  flag: '🇪🇬', currency: 'USD' },
    { code: 'ES', name: 'Spain',               dial: '+34',  flag: '🇪🇸', currency: 'USD' },
    { code: 'FR', name: 'France',              dial: '+33',  flag: '🇫🇷', currency: 'USD' },
    { code: 'GB', name: 'United Kingdom',      dial: '+44',  flag: '🇬🇧', currency: 'USD' },
    { code: 'GH', name: 'Ghana',               dial: '+233', flag: '🇬🇭', currency: 'USD' },
    { code: 'ID', name: 'Indonesia',           dial: '+62',  flag: '🇮🇩', currency: 'USD' },
    { code: 'IQ', name: 'Iraq',                dial: '+964', flag: '🇮🇶', currency: 'USD' },
    { code: 'IR', name: 'Iran',                dial: '+98',  flag: '🇮🇷', currency: 'USD' },
    { code: 'IT', name: 'Italy',               dial: '+39',  flag: '🇮🇹', currency: 'USD' },
    { code: 'JP', name: 'Japan',               dial: '+81',  flag: '🇯🇵', currency: 'USD' },
    { code: 'KE', name: 'Kenya',               dial: '+254', flag: '🇰🇪', currency: 'USD' },
    { code: 'KW', name: 'Kuwait',              dial: '+965', flag: '🇰🇼', currency: 'USD' },
    { code: 'LK', name: 'Sri Lanka',           dial: '+94',  flag: '🇱🇰', currency: 'USD' },
    { code: 'MA', name: 'Morocco',             dial: '+212', flag: '🇲🇦', currency: 'USD' },
    { code: 'MM', name: 'Myanmar',             dial: '+95',  flag: '🇲🇲', currency: 'USD' },
    { code: 'MV', name: 'Maldives',            dial: '+960', flag: '🇲🇻', currency: 'USD' },
    { code: 'MY', name: 'Malaysia',            dial: '+60',  flag: '🇲🇾', currency: 'USD' },
    { code: 'NL', name: 'Netherlands',         dial: '+31',  flag: '🇳🇱', currency: 'USD' },
    { code: 'OM', name: 'Oman',                dial: '+968', flag: '🇴🇲', currency: 'USD' },
    { code: 'PH', name: 'Philippines',         dial: '+63',  flag: '🇵🇭', currency: 'USD' },
    { code: 'QA', name: 'Qatar',               dial: '+974', flag: '🇶🇦', currency: 'USD' },
    { code: 'RU', name: 'Russia',              dial: '+7',   flag: '🇷🇺', currency: 'USD' },
    { code: 'SA', name: 'Saudi Arabia',        dial: '+966', flag: '🇸🇦', currency: 'USD' },
    { code: 'SG', name: 'Singapore',           dial: '+65',  flag: '🇸🇬', currency: 'USD' },
    { code: 'TH', name: 'Thailand',            dial: '+66',  flag: '🇹🇭', currency: 'USD' },
    { code: 'TR', name: 'Turkey',              dial: '+90',  flag: '🇹🇷', currency: 'USD' },
    { code: 'TZ', name: 'Tanzania',            dial: '+255', flag: '🇹🇿', currency: 'USD' },
    { code: 'UG', name: 'Uganda',              dial: '+256', flag: '🇺🇬', currency: 'USD' },
    { code: 'US', name: 'United States',       dial: '+1',   flag: '🇺🇸', currency: 'USD' },
    { code: 'UZ', name: 'Uzbekistan',          dial: '+998', flag: '🇺🇿', currency: 'USD' },
    { code: 'VN', name: 'Vietnam',             dial: '+84',  flag: '🇻🇳', currency: 'USD' },
    { code: 'ZA', name: 'South Africa',        dial: '+27',  flag: '🇿🇦', currency: 'USD' },
];

const BY_CODE = COUNTRIES.reduce((m, c) => { m[c.code] = c; return m; }, {});

function isValidCountry(code) {
    return !!(code && BY_CODE[String(code).toUpperCase()]);
}
function normalizeCountry(code) {
    const up = String(code || '').toUpperCase().trim();
    return BY_CODE[up] ? up : '';
}
function getCountry(code) {
    return BY_CODE[normalizeCountry(code)] || null;
}
// Popular first (fixed order), then everything else A→Z.
function grouped() {
    const popular = POPULAR.map(c => BY_CODE[c]).filter(Boolean);
    const rest = COUNTRIES
        .filter(c => !POPULAR.includes(c.code))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { popular, rest, all: COUNTRIES, defaultCountry: DEFAULT_COUNTRY };
}

module.exports = { COUNTRIES, POPULAR, DEFAULT_COUNTRY, BY_CODE, isValidCountry, normalizeCountry, getCountry, grouped };
