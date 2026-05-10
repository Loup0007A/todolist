const webpush = require('web-push');
const db = require('./db');

let configured = false;
function configure() {
  if (configured) return;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    configured = true;
  }
}

async function sendToUser(userId, payload) {
  configure();
  if (!configured) return;
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id=?').all(userId);
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
    } catch (e) {
      // 410 = abonnement expiré -> on supprime
      if (e.statusCode === 410 || e.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(s.id);
      }
    }
  }
}

module.exports = { sendToUser, configure };
