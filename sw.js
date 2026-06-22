// ═══ Chinese Signal Bot — Service Worker (Push Notifications) ═══
// Handles push events, notification clicks, install & activate lifecycle.

const CACHE_VERSION = 'csai-sw-v1';
const OFFLINE_ASSETS = ['/'];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_VERSION).then(cache => cache.addAll(OFFLINE_ASSETS).catch(() => {}))
    );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            clients.claim(),
            caches.keys().then(keys =>
                Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
            ),
        ])
    );
});

// ── Push received ─────────────────────────────────────────────────────────────
self.addEventListener('push', event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'Chinese Signal Bot', body: event.data?.text() || '' }; }

    const title   = data.title   || '🤖 Chinese Signal Bot';
    const options = {
        body:    data.body    || 'You have a new update.',
        icon:    data.icon    || '/icon-192.png',
        badge:   '/icon-192.png',
        tag:     data.tag     || 'csai-push-' + Date.now(),
        vibrate: [200, 100, 200],
        requireInteraction: !!data.requireInteraction,
        data:    { url: data.url || '/', orderId: data.orderId || null, key: data.key || null },
        actions: data.actions || [],
    };

    // Append key directly in body if present
    if (data.key) {
        options.body += `\n\n🔑 Key: ${data.key}`;
        options.requireInteraction = true;
    }

    event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification clicked ──────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Focus existing tab if already open
            for (const client of windowClients) {
                if (new URL(client.url).pathname === new URL(targetUrl, self.location.origin).pathname) {
                    return client.focus();
                }
            }
            // Open new tab
            return clients.openWindow(targetUrl);
        })
    );
});

// ── Notification closed (dismissed) ──────────────────────────────────────────
self.addEventListener('notificationclose', event => {
    // Optional: track dismissals via beacon
});

// ── Background sync (for deferred analytics) ─────────────────────────────────
self.addEventListener('sync', event => {
    if (event.tag === 'csai-sync') {
        event.waitUntil(Promise.resolve());
    }
});
