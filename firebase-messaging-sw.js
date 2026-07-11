/* ============================================================
   Service Worker — E-Tiket ApotekKU (v3, Web Push standar)
   Tanpa SDK Firebase: menerima protokol Web Push langsung.
   ============================================================ */

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Tiket Baru', body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Tiket Baru';
  const body = d.body || '';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: 'etiket-' + (d.ticket_id || Date.now()),
      data: d,
      vibrate: [180, 80, 180]
    });
    /* Halaman yang sedang terbuka: bunyikan bel + toast */
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'PUSH_RECEIVED', title, body, ticket_id: d.ticket_id || '' }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const ticketId = d.ticket_id || '';
  const targetUrl = d.target_url || (self.registration.scope + '?ticket_id=' + encodeURIComponent(ticketId));
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'OPEN_TICKET', ticket_id: ticketId });
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
