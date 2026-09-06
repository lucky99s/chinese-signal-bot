# v6 Update — Country pricing, licence popup removal, push notification repair

All changes are additive. No existing feature, route, model or admin tool was removed.

## 1. Country detection & country-based pricing
- New `countries.js` — single shared country list (Pakistan, India, Bangladesh, Nepal, China, Nigeria first, then A–Z).
- `GET /api/countries` — country list for the website and admin panel.
- `GET /api/geo` — server-side detection via hosting headers, then IP lookup (3 providers, 6h cache). Never blocks the visitor.
- `GET /api/payment-settings` now returns a **country view** for visitors (admins still get the raw document):
  - only packages marked visible and allowed for that country,
  - Pakistan → PKR pricing with Easypaisa/JazzCash,
  - other countries → USD pricing, Easypaisa/JazzCash hidden, Binance/USDT shown.
  - Unknown country → the existing Pakistan behaviour (backward compatible).
- Website shows the detected country with a "Change" button; if detection fails, a searchable country picker appears.
- Admin package editor gained: allowed countries, display order, visible on/off (all optional; empty = available everywhere).

## 2. Licence popup
- The forced "Do You Have a License Key?" popup no longer appears on page load.
- `showLicenseGate()` and the overlay are kept so existing buttons keep working.

## 3. Push notifications
- VAPID keys are now stored in MongoDB (env → DB → file), so Render restarts no longer invalidate subscribers.
- Subscriptions store country, user agent, active flag and failure info; expired endpoints are deactivated automatically.
- Sending is batched (25) and isolated per device — one bad endpoint can no longer abort a broadcast.
- Broadcasts can be targeted by country; results report sent / failed / expired-removed.
- Only the standard notification permission is requested — camera, microphone, location, wake lock and the fake "Tap to Continue" step were removed. Users are never asked twice.
- Service worker: no cached HTML, and notification clicks reuse an open tab instead of opening duplicates.

## 4. Notes
- Your existing database, Telegram and admin settings are unchanged — the project runs exactly as before, no configuration needed.
- Optional: you can override anything with environment variables on your host.

## Optional environment variables
```
MONGODB_URI=...            # optional, overrides the built-in connection
VAPID_PUBLIC_KEY=...       # optional; otherwise generated once and stored in your database
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```
No database migration is needed — new fields default safely on existing records.
