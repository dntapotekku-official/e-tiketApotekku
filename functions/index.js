/* ============================================================
   Cloud Functions — E-Tiket ApotekKU
   Kirim push notification (FCM) saat tiket baru dibuat.
   Deploy: firebase deploy --only functions
   ============================================================ */
const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

const PRIORITY_LABEL = { urgent: 'Urgent', high: 'Tinggi', normal: 'Normal', low: 'Rendah' };

exports.notifyNewTicket = onValueCreated(
  {
    ref: '/tickets/{ticketId}',
    instance: 'e-tiket-apotekku-default-rtdb',
    region: 'asia-southeast1',
    memory: '256MiB',
    maxInstances: 3,
  },
  async (event) => {
    const t = event.data.val();
    const ticketId = event.params.ticketId;
    if (!t || !t.ticket_number) return; // bukan tiket valid

    const db = admin.database();

    // ---- 1. Tentukan penerima: PIC tiket + semua superadmin; tanpa PIC → semua admin ----
    const users = (await db.ref('users').get()).val() || {};
    const targetUsernames = new Set();
    const picUser = t.assigned_to && users[t.assigned_to] ? users[t.assigned_to] : null;
    if (picUser && picUser.username) targetUsernames.add(picUser.username);
    for (const uid of Object.keys(users)) {
      const u = users[uid] || {};
      if (u.role !== 'admin' || !u.username) continue;
      if (u.superadmin || !picUser) targetUsernames.add(u.username);
    }
    if (!targetUsernames.size) return;

    // ---- 2. Kumpulkan token aktif dari /notification_subscriptions/{username}/{deviceId} ----
    const subsRoot = (await db.ref('notification_subscriptions').get()).val() || {};
    const tokens = [];
    const tokenOwners = []; // { username, deviceId } sejajar dgn tokens
    for (const username of Object.keys(subsRoot)) {
      if (!targetUsernames.has(username)) continue;
      const devices = subsRoot[username] || {};
      for (const deviceId of Object.keys(devices)) {
        const sub = devices[deviceId] || {};
        if (sub.active === true && sub.token) {
          tokens.push(sub.token);
          tokenOwners.push({ username, deviceId });
        }
      }
    }
    if (!tokens.length) {
      console.log(`Tiket ${t.ticket_number}: tidak ada device aktif utk`, [...targetUsernames]);
      return;
    }

    // ---- 3. Susun payload ----
    const prio = PRIORITY_LABEL[t.priority] || t.priority || 'Normal';
    const targetUrl = `https://eticket.apotekku.com/?ticket_id=${encodeURIComponent(ticketId)}`;
    const title = `Tiket Baru: ${String(t.request_text || '').slice(0, 60) || t.ticket_number}`;
    const body = `${prio} • ${t.system_name || '-'} • dari ${t.division_name || '-'}`;
    const message = {
      notification: { title, body },
      data: {
        ticket_id: String(ticketId),
        ticket_number: String(t.ticket_number || ''),
        title,
        priority: String(t.priority || ''),
        category: String(t.system_name || ''),
        created_by: String(t.division_name || ''),
        assigned_pic: String(t.assigned_name || ''),
        target_url: targetUrl,
      },
      webpush: {
        headers: { Urgency: 'high', TTL: '86400' },
        notification: {
          title,
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          vibrate: [180, 80, 180],
          tag: 'etiket-' + ticketId,
        },
        fcmOptions: { link: targetUrl },
      },
    };

    // ---- 4. Kirim (batch maks 500) + nonaktifkan token invalid ----
    const messaging = admin.messaging();
    let success = 0, failure = 0;
    const sentTo = [];
    const disable = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const batchTokens = tokens.slice(i, i + 500);
      const res = await messaging.sendEachForMulticast({ ...message, tokens: batchTokens });
      res.responses.forEach((r, j) => {
        const owner = tokenOwners[i + j];
        if (r.success) { success++; sentTo.push(owner.username + '/' + owner.deviceId); }
        else {
          failure++;
          const code = (r.error && r.error.code) || '';
          if (code.includes('registration-token-not-registered') || code.includes('invalid-argument') || code.includes('invalid-registration-token')) {
            disable.push(owner);
          }
          console.warn('Gagal kirim ke', owner.username, code);
        }
      });
    }
    await Promise.all(disable.map((o) =>
      db.ref(`notification_subscriptions/${o.username}/${o.deviceId}`).update({ active: false, updated_at: Date.now() })
    ));

    // ---- 5. Log pengiriman ----
    await db.ref('notification_logs').push({
      ticket_id: ticketId,
      ticket_number: t.ticket_number || '',
      sent_to: sentTo,
      success_count: success,
      failure_count: failure,
      disabled_tokens: disable.length,
      created_at: Date.now(),
    });
    console.log(`Tiket ${t.ticket_number}: terkirim ${success}, gagal ${failure}, dinonaktifkan ${disable.length}`);
  }
);
