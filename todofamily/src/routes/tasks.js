const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');
const { occurrenceKey } = require('../occurrence');
const { sendToUser } = require('../push');

const router = express.Router();

// Stockage local des fichiers
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    const id = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${id}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB
});

// --- Création de tâche (adulte ou manager) ---
router.post('/', authRequired, roleRequired('adult', 'manager'), upload.array('files', 10), (req, res) => {
  const {
    assigned_to, title, description, type,
    schedule_kind, schedule_days, freq_count, freq_period,
    due_at, proof_required
  } = req.body;

  if (!assigned_to || !title || !type) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (!['daily', 'mandatory', 'optional', 'frequency'].includes(type)) {
    return res.status(400).json({ error: 'Type invalide' });
  }
  // Vérifier que l'enfant est bien dans la famille
  const child = db.prepare('SELECT * FROM users WHERE id=? AND family_id=?')
    .get(assigned_to, req.user.family_id);
  if (!child) return res.status(400).json({ error: 'Membre cible introuvable' });

  // Validation par type
  let scheduleKindValue = null, scheduleDaysValue = null, freqCountValue = null, freqPeriodValue = null;
  if (type === 'daily') {
    if (!['every_day', 'weekly', 'monthly', 'custom_days'].includes(schedule_kind)) {
      return res.status(400).json({ error: 'schedule_kind invalide' });
    }
    scheduleKindValue = schedule_kind;
    if (schedule_kind === 'custom_days') {
      let days = [];
      try { days = JSON.parse(schedule_days || '[]'); } catch {}
      if (!Array.isArray(days) || days.length === 0) {
        return res.status(400).json({ error: 'Jours personnalisés manquants' });
      }
      scheduleDaysValue = JSON.stringify(days);
    }
  } else if (type === 'frequency') {
    if (!freq_count || !freq_period) {
      return res.status(400).json({ error: 'freq_count et freq_period requis' });
    }
    if (!['day', 'week', 'month'].includes(freq_period)) {
      return res.status(400).json({ error: 'freq_period invalide' });
    }
    freqCountValue = Number(freq_count);
    freqPeriodValue = freq_period;
  }

  const result = db.prepare(`
    INSERT INTO tasks (family_id, assigned_to, created_by, title, description, type,
      schedule_kind, schedule_days, freq_count, freq_period, due_at, proof_required)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.family_id, assigned_to, req.user.id, title, description || null, type,
    scheduleKindValue, scheduleDaysValue, freqCountValue, freqPeriodValue,
    due_at || null, proof_required ? 1 : 0
  );

  const taskId = result.lastInsertRowid;

  // Pièces jointes (instructions)
  for (const f of (req.files || [])) {
    db.prepare(`INSERT INTO attachments (task_id, uploader_id, kind, filename, original_name, mime_type, size)
      VALUES (?,?,?,?,?,?,?)`).run(
      taskId, req.user.id, 'instruction', f.filename, f.originalname, f.mimetype, f.size
    );
  }

  // Notification push à l'enfant
  sendToUser(assigned_to, {
    title: 'Nouvelle tâche',
    body: title,
    url: '/'
  }).catch(() => {});

  res.json({ id: taskId });
});

// --- Liste des tâches visibles par l'utilisateur ---
router.get('/', authRequired, (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const familyId = req.user.family_id;

  let tasks;
  if (role === 'child') {
    tasks = db.prepare('SELECT * FROM tasks WHERE family_id=? AND assigned_to=? AND active=1 ORDER BY created_at DESC')
      .all(familyId, userId);
  } else {
    tasks = db.prepare('SELECT * FROM tasks WHERE family_id=? AND active=1 ORDER BY created_at DESC')
      .all(familyId);
  }

  // Enrichir avec : nom de l'assigné, nb pièces jointes, statut occurrence courante
  const enriched = tasks.map(t => {
    const assignee = db.prepare('SELECT id, display_name FROM users WHERE id=?').get(t.assigned_to);
    const attachCount = db.prepare('SELECT COUNT(*) as c FROM attachments WHERE task_id=? AND kind=?')
      .get(t.id, 'instruction').c;
    const key = occurrenceKey(t, new Date());
    let currentCompletion = null;
    if (key) {
      currentCompletion = db.prepare(`
        SELECT * FROM task_completions WHERE task_id=? AND user_id=? AND occurrence_key=?
      `).get(t.id, t.assigned_to, key);
    }
    // Pour frequency: compter le nombre de complétions sur la période courante
    let freqDone = null;
    if (t.type === 'frequency' && key) {
      freqDone = db.prepare(`
        SELECT COUNT(*) as c FROM task_completions
        WHERE task_id=? AND user_id=? AND occurrence_key=? AND completed_at IS NOT NULL
      `).get(t.id, t.assigned_to, key).c;
    }
    return {
      ...t,
      assignee_name: assignee?.display_name,
      attachment_count: attachCount,
      current_occurrence_key: key,
      current_completion: currentCompletion,
      frequency_done: freqDone
    };
  });

  res.json({ tasks: enriched });
});

// --- Détail d'une tâche ---
router.get('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=? AND family_id=?').get(req.params.id, req.user.family_id);
  if (!t) return res.status(404).json({ error: 'Introuvable' });
  if (req.user.role === 'child' && t.assigned_to !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const attachments = db.prepare('SELECT * FROM attachments WHERE task_id=? AND kind=?')
    .all(t.id, 'instruction');
  const completions = db.prepare(`
    SELECT * FROM task_completions WHERE task_id=? ORDER BY occurrence_key DESC, completed_at DESC LIMIT 50
  `).all(t.id);
  // Pour chaque complétion : pièces jointes (preuves)
  const completionsEnriched = completions.map(c => {
    const proofs = db.prepare('SELECT * FROM attachments WHERE completion_id=? AND kind=?').all(c.id, 'proof');
    return { ...c, proofs };
  });
  const assignee = db.prepare('SELECT id, display_name FROM users WHERE id=?').get(t.assigned_to);
  res.json({ task: t, assignee, attachments, completions: completionsEnriched });
});

// --- Marquer une tâche ouverte/lue par l'enfant ---
router.post('/:id/open', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=? AND family_id=?').get(req.params.id, req.user.family_id);
  if (!t) return res.status(404).json({ error: 'Introuvable' });
  if (t.assigned_to !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

  const key = occurrenceKey(t, new Date()) || 'single';
  const now = new Date().toISOString();
  // Upsert
  let comp = db.prepare('SELECT * FROM task_completions WHERE task_id=? AND user_id=? AND occurrence_key=?')
    .get(t.id, req.user.id, key);
  if (!comp) {
    db.prepare(`INSERT INTO task_completions (task_id, user_id, occurrence_key, opened_at, read_at)
      VALUES (?,?,?,?,?)`).run(t.id, req.user.id, key, now, now);
  } else {
    db.prepare(`UPDATE task_completions SET opened_at=COALESCE(opened_at, ?), read_at=? WHERE id=?`)
      .run(now, now, comp.id);
  }
  res.json({ ok: true });
});

// --- Marquer une tâche faite (avec preuve éventuelle) ---
router.post('/:id/complete', authRequired, upload.array('proofs', 10), (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=? AND family_id=?').get(req.params.id, req.user.family_id);
  if (!t) return res.status(404).json({ error: 'Introuvable' });
  if (t.assigned_to !== req.user.id && req.user.role === 'child') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  // Pour frequency : permettre plusieurs complétions dans la même période -> créer une nouvelle ligne avec un suffixe
  let key = occurrenceKey(t, new Date()) || 'single';
  if (t.type === 'frequency') {
    // suffixer par timestamp pour que chaque complétion soit unique
    key = `${key}#${Date.now()}`;
  }

  if (t.proof_required && (!req.files || req.files.length === 0)) {
    return res.status(400).json({ error: 'Une preuve est requise pour cette tâche' });
  }

  const { lat, lng, location_label } = req.body;
  const now = new Date().toISOString();

  let comp = db.prepare('SELECT * FROM task_completions WHERE task_id=? AND user_id=? AND occurrence_key=?')
    .get(t.id, req.user.id, key);
  if (!comp) {
    const r = db.prepare(`INSERT INTO task_completions
      (task_id, user_id, occurrence_key, completed_at, opened_at, location_lat, location_lng, location_label)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      t.id, req.user.id, key, now, now,
      lat ? Number(lat) : null, lng ? Number(lng) : null, location_label || null
    );
    comp = { id: r.lastInsertRowid };
  } else {
    db.prepare(`UPDATE task_completions
      SET completed_at=?, location_lat=?, location_lng=?, location_label=?
      WHERE id=?`).run(
      now, lat ? Number(lat) : null, lng ? Number(lng) : null, location_label || null, comp.id
    );
  }

  for (const f of (req.files || [])) {
    db.prepare(`INSERT INTO attachments (task_id, completion_id, uploader_id, kind, filename, original_name, mime_type, size)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      t.id, comp.id, req.user.id, 'proof', f.filename, f.originalname, f.mimetype, f.size
    );
  }

  // Notifier l'auteur de la tâche + tous les adultes/managers de la famille
  const recipients = db.prepare(`
    SELECT id FROM users WHERE family_id=? AND role IN ('adult','manager') AND id != ?
  `).all(req.user.family_id, req.user.id);
  for (const r of recipients) {
    sendToUser(r.id, {
      title: 'Tâche complétée',
      body: `${req.user.name} a terminé : ${t.title}`,
      url: `/?task=${t.id}`
    }).catch(() => {});
  }

  res.json({ ok: true, completion_id: comp.id });
});

// --- Suppression d'une tâche (auteur ou adulte) ---
router.delete('/:id', authRequired, (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id=? AND family_id=?').get(req.params.id, req.user.family_id);
  if (!t) return res.status(404).json({ error: 'Introuvable' });
  if (req.user.role !== 'adult' && t.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
  res.json({ ok: true });
});

module.exports = router;
