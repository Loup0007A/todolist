// Calcul de la "clé d'occurrence" pour une tâche récurrente à une date donnée.
// Permet de savoir si une occurrence donnée est complétée.

function pad(n) { return String(n).padStart(2, '0'); }

function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoWeek(d) {
  // ISO week number
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(weekNo)}`;
}

function monthKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * Renvoie la clé d'occurrence pour une tâche à une date donnée,
 * ou null si la tâche n'est pas active à cette date.
 */
function occurrenceKey(task, date) {
  const d = date || new Date();
  if (task.type === 'daily') {
    if (task.schedule_kind === 'every_day') return isoDate(d);
    if (task.schedule_kind === 'weekly') return isoWeek(d);
    if (task.schedule_kind === 'monthly') return monthKey(d);
    if (task.schedule_kind === 'custom_days') {
      const days = JSON.parse(task.schedule_days || '[]');
      if (!days.includes(d.getDay())) return null;
      return isoDate(d);
    }
  }
  if (task.type === 'frequency') {
    if (task.freq_period === 'day') return isoDate(d);
    if (task.freq_period === 'week') return isoWeek(d);
    if (task.freq_period === 'month') return monthKey(d);
  }
  if (task.type === 'mandatory' || task.type === 'optional') {
    // Une seule occurrence "fixe"
    return 'single';
  }
  return null;
}

module.exports = { occurrenceKey, isoDate, isoWeek, monthKey };
