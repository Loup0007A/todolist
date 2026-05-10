// Schéma SQLite - exécuté au démarrage du serveur
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    email TEXT UNIQUE,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('adult','child','manager')),
    display_name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(family_id) REFERENCES families(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL,
    assigned_to INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK(type IN ('daily','mandatory','optional','frequency')),
    -- Pour daily : 'every_day' | 'weekly' | 'monthly' | 'custom_days'
    schedule_kind TEXT,
    -- Pour custom_days : JSON array de jours [0..6] (0=dimanche)
    schedule_days TEXT,
    -- Pour frequency : nombre de fois requis dans l'intervalle
    freq_count INTEGER,
    -- Pour frequency : 'day' | 'week' | 'month'
    freq_period TEXT,
    -- Date d'échéance (pour mandatory/optional)
    due_at TEXT,
    proof_required INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(family_id) REFERENCES families(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Pour les tâches récurrentes : un enregistrement par occurrence (jour ou période)
  CREATE TABLE IF NOT EXISTS task_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    -- Clé d'occurrence : ex. "2025-01-15" pour daily, "2025-W03" pour weekly, etc.
    occurrence_key TEXT NOT NULL,
    completed_at TEXT,
    opened_at TEXT,
    read_at TEXT,
    location_lat REAL,
    location_lng REAL,
    location_label TEXT,
    UNIQUE(task_id, occurrence_key, user_id),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    completion_id INTEGER,
    uploader_id INTEGER NOT NULL,
    -- 'instruction' (pièce jointe à la tâche) ou 'proof' (preuve fournie par l'enfant)
    kind TEXT NOT NULL CHECK(kind IN ('instruction','proof')),
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(completion_id) REFERENCES task_completions(id) ON DELETE CASCADE,
    FOREIGN KEY(uploader_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_family ON tasks(family_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_completions_task ON task_completions(task_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_completion ON attachments(completion_id);
`);

console.log('Base de données initialisée.');
module.exports = db;
