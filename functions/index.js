/* ============================================================
   Cloud Functions - E-Tiket ApotekKU (v2, Web Push standar)
   Kirim push saat tiket baru dibuat, via protokol Web Push.
   Deploy: buat functions/.env dulu (lihat .env.example),
   lalu: firebase deploy --only functions
   ============================================================ */
const { onValueCreated } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');
const webpush = require('web-push');

admin.initializeApp({
  databaseURL:
    process.env.DATABASE_URL ||
    'https://e-tiket-apotekku-default-rtdb.asia-southeast1.firebasedatabase.app',
});

const PRIORITY_LABEL = {
  urgent: 'Urgent',
  high: 'Tinggi',
  normal: 'Normal',
  low: 'Rendah',
};

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
    if (!t || !t.ticket_number) return;

    webpush.setVapidDetails(
      'mailto:it@apotekku.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const db = admin.database();

    const users = (await db.ref('users').get()).val() || {};
    const targetUsernames = new Set();
    const picUser = t.assigned_to && users[t.assigned_to] ? users[t.assigned_to] : null;

    if (picUser && picUser.username) {
      targetUsernames.add(picUser.username);
    }

    for (const uid of Object.keys(users)) {
      const u = users[uid] || {};
      if (u.role !== 'admin' || !u.username) continue;
      if (u.superadmin || !picUser) {
        targetUsernames.add(u.username);
      }
    }

    if (!targetUsernames.size) return;

    const subsRoot = (await db.ref('notification_subscriptions').get()).val() || {};
    const targets = [];

    for (const username of Object.keys(subsRoot)) {
      if (!targetUsernames.has(username)) continue;

      const devices = subsRoot[username] || {};
      for (const deviceId of Object.keys(devices)) {
        const s = devices[deviceId] || {};
        if (s.active === true && s.subscription && s.subscription.endpoint) {
          targets.push({
            username,
            deviceId,
            subscription: s.subscription,
          });
        }
      }
    }

    if (!targets.length) {
      console.log(`Tiket ${t.ticket_number}: tidak ada device aktif utk`, [...targetUsernames]);
      return;
    }

    const prio = PRIORITY_LABEL[t.priority] || t.priority || 'Normal';
    const targetUrl = `https://eticket.apotekku.com/?ticket_id=${encodeURIComponent(ticketId)}`;

    const payload = JSON.stringify({
      title: `Tiket Baru: ${String(t.request_text || '').slice(0, 60) || t.ticket_number}`,
      body: `${prio} • ${t.system_name || '-'} • dari ${t.division_name || '-'}`,
      ticket_id: String(ticketId),
      ticket_number: String(t.ticket_number || ''),
      priority: String(t.priority || ''),
      category: String(t.system_name || ''),
      created_by: String(t.division_name || ''),
      assigned_pic: String(t.assigned_name || ''),
      target_url: targetUrl,
    });

    let success = 0;
    let failure = 0;
    const sentTo = [];
    const disable = [];

    await Promise.all(
      targets.map(async (tg) => {
        try {
          await webpush.sendNotification(tg.subscription, payload, {
            TTL: 86400,
            urgency: 'high',
          });
          success++;
          sentTo.push(`${tg.username}/${tg.deviceId}`);
        } catch (err) {
          failure++;
          const code = err && err.statusCode;
          console.warn(
            'Gagal kirim ke',
            tg.username,
            code,
            err && err.body && String(err.body).slice(0, 120)
          );
          if (code === 404 || code === 410 || code === 403) {
            disable.push(tg);
          }
        }
      })
    );

    await Promise.all(
      disable.map((tg) =>
        db.ref(`notification_subscriptions/${tg.username}/${tg.deviceId}`).update({
          active: false,
          updated_at: Date.now(),
        })
      )
    );

    await db.ref('notification_logs').push({
      ticket_id: ticketId,
      ticket_number: t.ticket_number || '',
      method: 'web_push',
      sent_to: sentTo,
      success_count: success,
      failure_count: failure,
      disabled_tokens: disable.length,
      created_at: Date.now(),
    });

    console.log(
      `Tiket ${t.ticket_number}: terkirim ${success}, gagal ${failure}, dinonaktifkan ${disable.length}`
    );
  }
);
