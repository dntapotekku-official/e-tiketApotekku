/* ============================================================
   Service Worker — E-Tiket ApotekKU
   Push notification background (Firebase Cloud Messaging) — v2
   ============================================================ */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAgQhV8ZgOlcA_J8jrP1kn6gLvhPM4_R4c",
  authDomain: "e-tiket-apotekku.firebaseapp.com",
  databaseURL: "https://e-tiket-apotekku-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "e-tiket-apotekku",
  storageBucket: "e-tiket-apotekku.firebasestorage.app",
  messagingSenderId: "720049923390",
  appId: "1:720049923390:web:f2ab82f2ee60b18e19f86f",
  measurementId: "G-XP2G07G6S1"
});

const messaging = firebase.messaging();

/* Notifikasi saat aplikasi di background / tab tertutup */
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const n = payload.notification || {};
  const title = n.title || d.title || 'Tiket Baru';
  self.registration.showNotification(title, {
    body: n.body || d.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/badge-72.png',
    tag: 'etiket-' + (d.ticket_id || Date.now()),
    data: d,
    vibrate: [180, 80, 180]
  });
});

/* Klik notifikasi: fokuskan tab yang ada + arahkan ke tiketnya, atau buka tab baru */
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
