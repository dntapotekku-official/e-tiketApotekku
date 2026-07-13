/* ============================================================
   Cloud Functions - E-Tiket ApotekKU (v2, Web Push standar)
   - Tiket baru: push ke admin/PIC, bukan ke pengaju.
   - Status/progress berubah: push ke pengaju tiket.
   ============================================================ */
const { onValueCreated, onValueUpdated } = require('firebase-functions/v2/database');
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

const STATUS_LABEL = {
  waiting: 'Menunggu',
  in_progress: 'Diproses',
  on_hold: 'Ditunda',
  done: 'Selesai',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
};

function setupWebPush() {
  webpush.setVapidDetails(
    'mailto:it@apotekku.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

function getAdminTargetUsernames(users, ticket, excludeUserId) {
  const targetUsernames = new Set();
  const picUser = ticket.assigned_to && users[ticket.assigned_to] ? users[ticket.assigned_to] : null;

  if (picUser && picUser.username && ticket.assigned_to !== excludeUserId) {
    targetUsernames.add(picUser.username);
  }

  for (const uid of Object.keys(users)) {
    if (uid === excludeUserId) continue;

    const u = users[uid] || {};
    if (u.role !== 'admin' || !u.username) continue;
    if (u.superadmin || !picUser) {
      targetUsernames.add(u.username);
    }
  }

  return targetUsernames;
}

function getRequesterTargetUsernames(users, ticket) {
  const targetUsernames = new Set();
  const requesterUser = ticket.division_id && users[ticket.division_id] ? users[ticket.division_id] : null;

  if (requesterUser && requesterUser.username) {
    targetUsernames.add(requesterUser.username);
  }

  return targetUsernames;
}

function getTargets(subsRoot, targetUsernames) {
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

  return targets;
}

async function sendNotifications(db, ticketId, ticketNumber, targets, payload, logData, emptyMessage) {
  if (!targets.length) {
    console.log(emptyMessage);
    return;
  }

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
    ticket_number: ticketNumber || '',
    method: 'web_push',
    sent_to: sentTo,
    success_count: success,
    failure_count: failure,
    disabled_tokens: disable.length,
    created_at: Date.now(),
    ...logData,
  });

  console.log(
    `Tiket ${ticketNumber}: terkirim ${success}, gagal ${failure}, dinonaktifkan ${disable.length}`
  );
}

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

    setupWebPush();

    const db = admin.database();
    const users = (await db.ref('users').get()).val() || {};
    const requesterId = t.created_by || t.division_id || null;
    const targetUsernames = getAdminTargetUsernames(users, t, requesterId);
    if (!targetUsernames.size) return;

    const subsRoot = (await db.ref('notification_subscriptions').get()).val() || {};
    const targets = getTargets(subsRoot, targetUsernames);

    const prio = PRIORITY_LABEL[t.priority] || t.priority || 'Normal';
    const targetUrl = `https://eticket.apotekku.com/?ticket_id=${encodeURIComponent(ticketId)}`;

    const payload = JSON.stringify({
      title: `Tiket Baru: ${String(t.request_text || '').slice(0, 60) || t.ticket_number}`,
      body: `${prio} - ${t.system_name || '-'} - dari ${t.division_name || '-'}`,
      ticket_id: String(ticketId),
      ticket_number: String(t.ticket_number || ''),
      priority: String(t.priority || ''),
      category: String(t.system_name || ''),
      created_by: String(t.division_name || ''),
      assigned_pic: String(t.assigned_name || ''),
      target_url: targetUrl,
      event_type: 'ticket_created',
    });

    await sendNotifications(
      db,
      ticketId,
      t.ticket_number,
      targets,
      payload,
      { event_type: 'ticket_created' },
      `Tiket ${t.ticket_number}: tidak ada device aktif utk ${JSON.stringify([...targetUsernames])}`
    );
  }
);

exports.notifyTicketStatusChanged = onValueUpdated(
  {
    ref: '/tickets/{ticketId}',
    instance: 'e-tiket-apotekku-default-rtdb',
    region: 'asia-southeast1',
    memory: '256MiB',
    maxInstances: 3,
  },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    const ticketId = event.params.ticketId;

    if (!before || !after || !after.ticket_number) return;

    const statusChanged = before.status !== after.status;
    const progressChanged = before.current_progress !== after.current_progress;
    if (!statusChanged && !progressChanged) return;

    setupWebPush();

    const db = admin.database();
    const users = (await db.ref('users').get()).val() || {};
    const targetUsernames = getRequesterTargetUsernames(users, after);
    if (!targetUsernames.size) return;

    const subsRoot = (await db.ref('notification_subscriptions').get()).val() || {};
    const targets = getTargets(subsRoot, targetUsernames);
    const targetUrl = `https://eticket.apotekku.com/?ticket_id=${encodeURIComponent(ticketId)}`;

    let title = `Update Tiket ${after.ticket_number}`;
    let body = `${after.system_name || '-'} - ${after.division_name || '-'}`;
    let eventType = 'ticket_updated';

    if (statusChanged) {
      const oldStatus = STATUS_LABEL[before.status] || before.status || 'Tidak diketahui';
      const newStatus = STATUS_LABEL[after.status] || after.status || 'Tidak diketahui';
      title = `Status Tiket ${after.ticket_number} Berubah`;
      body = `${oldStatus} -> ${newStatus} - ${after.system_name || '-'} - ${after.division_name || '-'}`;
      eventType = 'ticket_status_changed';
    } else if (progressChanged) {
      const oldProgress = before.current_progress || 'Belum dimulai';
      const newProgress = after.current_progress || 'Belum dimulai';
      title = `Progress Tiket ${after.ticket_number} Berubah`;
      body = `${oldProgress} -> ${newProgress} - ${after.system_name || '-'} - ${after.division_name || '-'}`;
      eventType = 'ticket_progress_changed';
    }

    const payload = JSON.stringify({
      title,
      body,
      ticket_id: String(ticketId),
      ticket_number: String(after.ticket_number || ''),
      status_before: String(before.status || ''),
      status_after: String(after.status || ''),
      progress_before: String(before.current_progress || ''),
      progress_after: String(after.current_progress || ''),
      priority: String(after.priority || ''),
      category: String(after.system_name || ''),
      created_by: String(after.division_name || ''),
      assigned_pic: String(after.assigned_name || ''),
      target_url: targetUrl,
      event_type: eventType,
    });

    await sendNotifications(
      db,
      ticketId,
      after.ticket_number,
      targets,
      payload,
      {
        event_type: eventType,
        status_before: before.status || '',
        status_after: after.status || '',
        progress_before: before.current_progress || '',
        progress_after: after.current_progress || '',
      },
      `Update tiket ${after.ticket_number}: tidak ada device aktif utk ${JSON.stringify([...targetUsernames])}`
    );
  }
);
