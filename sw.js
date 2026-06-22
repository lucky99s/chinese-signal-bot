const BOT_URL = '/';

self.addEventListener('push', function(event) {
    if (!event.data) return;
    let payload;
    try { payload = event.data.json(); } catch(e) { payload = { title: 'Chinese Signal Bot', body: event.data.text() }; }
    const options = {
        body: payload.body || '',
        icon: payload.icon || '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: payload.url || BOT_URL },
        vibrate: [200, 100, 200],
        requireInteraction: false,
        tag: 'csbot-' + Date.now(),
    };
    event.waitUntil(
        self.registration.showNotification(payload.title || 'Chinese Signal Bot', options)
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : BOT_URL;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
            for (const w of wins) {
                if ('focus' in w) { w.focus(); return; }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});

self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(clients.claim()); });
