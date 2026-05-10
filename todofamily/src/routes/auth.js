const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24 * 30
};

function makeToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, family_id: user.family_id, name: user.display_name },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// POST /api/auth/register - crée une famille + premier compte adulte
router.post('/register', (req, res) => {
  const { family_name, username, email, password, display_name } = req.body || {};
  if (!family_name || !username || !password || !display_name) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });

  try {
    const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const fam = db.prepare('INSERT INTO families (name, invite_code) VALUES (?, ?)')
      .run(family_name, inviteCode);
    const hash = bcrypt.hashSync(password, 10);
    const u = db.prepare(`INSERT INTO users (family_id, email, username, password_hash, role, display_name)
      VALUES (?,?,?,?,?,?)`).run(fam.lastInsertRowid, email || null, username, hash, 'adult', display_name);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(u.lastInsertRowid);
    const token = makeToken(user);
    res.cookie('token', token, COOKIE_OPTS).json({
      user: { id: user.id, role: user.role, name: user.display_name, family_id: user.family_id },
      invite_code: inviteCode
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Identifiant ou email déjà pris' });
    }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/join - rejoindre une famille existante via invite_code
router.post('/join', (req, res) => {
  const { invite_code, username, email, password, display_name, role } = req.body || {};
  if (!invite_code || !username || !password || !display_name || !role) {
    return res.status(400).json({ error: 'Champs manquants' });
  }
  if (!['adult', 'child', 'manager'].includes(role)) {
    return res.status(400).json({ error: 'Rôle invalide' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court' });

  const fam = db.prepare('SELECT * FROM families WHERE invite_code=?').get(invite_code.toUpperCase());
  if (!fam) return res.status(404).json({ error: 'Code famille inconnu' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const u = db.prepare(`INSERT INTO users (family_id, email, username, password_hash, role, display_name)
      VALUES (?,?,?,?,?,?)`).run(fam.id, email || null, username, hash, role, display_name);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(u.lastInsertRowid);
    const token = makeToken(user);
    res.cookie('token', token, COOKIE_OPTS).json({
      user: { id: user.id, role: user.role, name: user.display_name, family_id: user.family_id }
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Identifiant ou email déjà pris' });
    }
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Champs manquants' });
  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(username, username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  const token = makeToken(user);
  res.cookie('token', token, COOKIE_OPTS).json({
    user: { id: user.id, role: user.role, name: user.display_name, family_id: user.family_id }
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token').json({ ok: true });
});

// GET /api/auth/me
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, username, email, display_name, role, family_id FROM users WHERE id=?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const fam = db.prepare('SELECT id, name, invite_code FROM families WHERE id=?').get(user.family_id);
  res.json({ user, family: fam });
});

module.exports = router;
