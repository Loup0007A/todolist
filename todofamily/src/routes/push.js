const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { sendToUser } = require('../push');
const { occurrenceKey } = require('../occurrence');

const router = express.Router();

// GET /api/push/public-key
router.get('/public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe
router.post('/subscribe', authRequired, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Souscription invalide' });
  }
  try {
    db.prepare(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id`).run(
      req.user.id, endpoint, keys.p256dh, keys.auth
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', authRequired, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(endpoint);
  res.json({ ok: true });
});

// POST /api/push/test - envoyer une notif de test à soi-même
router.post('/test', authRequired, async (req, res) => {
  await sendToUser(req.user.id, {
    title: 'Test de notification',
    body: 'Si vous voyez ceci, les notifications fonctionnent !',
    url: '/'
  });
  res.json({ ok: true });
});

// POST /api/push/check-pending - rappel des tâches non faites (appelé par cron interne)
// Renvoie aussi le nb de notifs envoyées pour debug
router.post('/check-pending', authRequired, async (req, res) => {
  const sent = await checkAndNotifyPending(req.user.family_id);
  res.json({ ok: true, sent });
});

async function checkAndNotifyPending(familyIdFilter) {
  const now = new Date();
  const hour = now.getHours();
  // On ne rappelle qu'entre 8h et 21h pour ne pas réveiller la nuit
  if (hour < 8 || hour >= 21) return 0;

  let tasks;
  if (familyIdFilter) {
    tasks = db.prepare('SELECT * FROM tasks WHERE family_id=? AND active=1').all(familyIdFilter);
  } else {
    tasks = db.prepare('SELECT * FROM tasks WHERE active=1').all();
  }
  let sent = 0;
  for (const t of tasks) {
    const key = occurrenceKey(t, now);
    if (!key) continue;
    if (t.type === 'frequency') {
      const done = db.prepare(`SELECT COUNT(*) as c FROM task_completions
        WHERE task_id=? AND user_id=? AND occurrence_key LIKE ? AND completed_at IS NOT NULL`)
        .get(t.id, t.assigned_to, `${key}%`).c;
      if (done >= (t.freq_count || 1)) continue;
    } else {
      const comp = db.prepare(`SELECT * FROM task_completions
        WHERE task_id=? AND user_id=? AND occurrence_key=?`).get(t.id, t.assigned_to, key);
      if (comp?.completed_at) continue;
    }
    if (t.type === 'optional') continue; // pas de rappel pour l'optionnel
    await sendToUser(t.assigned_to, {
      title: 'Rappel : tâche à faire',
      body: t.title,
      url: `/?task=${t.id}`
    });
    sent++;
  }
  return sent;
}

module.exports = router;
module.exports.checkAndNotifyPending = checkAndNotifyPending;
