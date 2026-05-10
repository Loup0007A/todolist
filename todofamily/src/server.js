require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

if (!process.env.JWT_SECRET) {
  console.error('ERREUR : JWT_SECRET manquant dans .env');
  process.exit(1);
}

require('./db'); // initialise les tables
const authRoutes = require('./routes/auth');
const familyRoutes = require('./routes/family');
const taskRoutes = require('./routes/tasks');
const pushRoutes = require('./routes/push');
const { checkAndNotifyPending, configure: configurePush } = require('./push');
configurePush();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Statique : public/
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/family', familyRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/push', pushRoutes);

// Téléchargement protégé des fichiers
const { authRequired } = require('./middleware/auth');
const db = require('./db');
app.get('/files/:filename', authRequired, (req, res) => {
  const filename = path.basename(req.params.filename);
  const att = db.prepare('SELECT a.*, t.family_id FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.filename=?')
    .get(filename);
  if (!att) return res.status(404).send('Introuvable');
  if (att.family_id !== req.user.family_id) return res.status(403).send('Refusé');
  // child ne peut lire que les fichiers liés à ses tâches
  if (req.user.role === 'child') {
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(att.task_id);
    if (t.assigned_to !== req.user.id) return res.status(403).send('Refusé');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'uploads', filename));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});

// Cron interne : toutes les 30 minutes, vérifier les tâches en attente
setInterval(() => {
  checkAndNotifyPending().catch(err => console.error('Cron push:', err));
}, 30 * 60 * 1000);
