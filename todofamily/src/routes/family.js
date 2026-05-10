const express = require('express');
const db = require('../db');
const { authRequired, roleRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/family/members
router.get('/members', authRequired, (req, res) => {
  const members = db.prepare(`
    SELECT id, username, display_name, role, email, created_at
    FROM users WHERE family_id=? ORDER BY role, display_name
  `).all(req.user.family_id);
  res.json({ members });
});

// DELETE /api/family/members/:id - retirer un membre (adulte uniquement, pas soi-même)
router.delete('/members/:id', authRequired, roleRequired('adult'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  const target = db.prepare('SELECT * FROM users WHERE id=? AND family_id=?').get(id, req.user.family_id);
  if (!target) return res.status(404).json({ error: 'Membre introuvable' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ ok: true });
});

// GET /api/family/info
router.get('/info', authRequired, (req, res) => {
  const fam = db.prepare('SELECT id, name, invite_code FROM families WHERE id=?').get(req.user.family_id);
  res.json({ family: fam });
});

module.exports = router;
