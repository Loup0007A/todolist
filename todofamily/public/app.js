// TodoFamily - SPA vanilla JS
// =============================

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
};

const state = {
  user: null,
  family: null,
  view: 'tasks', // tasks | family | profile
  tasks: [],
  members: [],
  loading: false,
  pushKey: null,
};

// ====== API helper ======
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (!res.ok) {
    let msg = 'Erreur réseau';
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ====== Toast ======
function toast(msg) {
  $$('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// ====== Modal ======
function openModal(builder) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const modal = h('div', { class: 'modal' });
  modal.appendChild(h('div', { class: 'modal-handle' }));
  const close = () => back.remove();
  builder(modal, close);
  back.appendChild(modal);
  document.body.appendChild(back);
  return close;
}

// ====== Init ======
async function init() {
  // SW
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (e) { /* ignore */ }
  }
  // Récupérer la clé VAPID
  try {
    const r = await api('/api/push/public-key');
    state.pushKey = r.key;
  } catch {}

  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.family = me.family;
    await loadAll();
    renderApp();
  } catch {
    renderAuth();
  }
}

async function loadAll() {
  const [t, m] = await Promise.all([api('/api/tasks'), api('/api/family/members')]);
  state.tasks = t.tasks;
  state.members = m.members;
}

// ====== Auth (login / register / join) ======
function renderAuth() {
  const root = $('#app');
  root.innerHTML = '';
  const wrap = h('div', { class: 'auth-wrap' });
  wrap.appendChild(h('div', { class: 'brand' },
    h('div', { class: 'brand-mark' }, '✓'),
    h('div', { class: 'brand-name' }, 'TodoFamily')
  ));

  const tabs = h('div', { class: 'tabs' });
  const btnLogin = h('button', { class: 'active', onclick: () => switchTab('login') }, 'Connexion');
  const btnRegister = h('button', { onclick: () => switchTab('register') }, 'Créer une famille');
  const btnJoin = h('button', { onclick: () => switchTab('join') }, 'Rejoindre');
  tabs.append(btnLogin, btnRegister, btnJoin);
  wrap.appendChild(tabs);

  const formZone = h('div');
  wrap.appendChild(formZone);

  function switchTab(t) {
    [btnLogin, btnRegister, btnJoin].forEach(b => b.classList.remove('active'));
    if (t === 'login') btnLogin.classList.add('active');
    if (t === 'register') btnRegister.classList.add('active');
    if (t === 'join') btnJoin.classList.add('active');
    formZone.innerHTML = '';
    formZone.appendChild(buildAuthForm(t));
  }
  formZone.appendChild(buildAuthForm('login'));
  root.appendChild(wrap);
}

function buildAuthForm(mode) {
  const err = h('div', { class: 'error-msg' });
  const form = h('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      let resp;
      if (mode === 'login') resp = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
      else if (mode === 'register') resp = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
      else resp = await api('/api/auth/join', { method: 'POST', body: JSON.stringify(data) });
      state.user = resp.user;
      if (resp.invite_code) {
        toast('Famille créée ! Code : ' + resp.invite_code);
      }
      const me = await api('/api/auth/me');
      state.user = me.user; state.family = me.family;
      await loadAll();
      renderApp();
    } catch (e) {
      err.textContent = e.message;
    }
  });

  if (mode === 'login') {
    form.append(
      field('Identifiant ou email', h('input', { class: 'input', name: 'username', autocomplete: 'username', required: true })),
      field('Mot de passe', h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      h('button', { class: 'btn', type: 'submit' }, 'Se connecter'),
    );
  }
  if (mode === 'register') {
    form.append(
      field('Nom de la famille', h('input', { class: 'input', name: 'family_name', required: true, placeholder: 'Ex: Famille Dupont' })),
      field('Votre nom affiché', h('input', { class: 'input', name: 'display_name', required: true, placeholder: 'Maman' })),
      field('Identifiant', h('input', { class: 'input', name: 'username', required: true, autocomplete: 'username' })),
      field('Email (optionnel)', h('input', { class: 'input', name: 'email', type: 'email' })),
      field('Mot de passe (6+ car.)', h('input', { class: 'input', name: 'password', type: 'password', minlength: 6, required: true, autocomplete: 'new-password' })),
      h('button', { class: 'btn', type: 'submit' }, 'Créer la famille'),
    );
  }
  if (mode === 'join') {
    const sel = h('select', { class: 'select', name: 'role', required: true },
      h('option', { value: '' }, 'Choisir un rôle…'),
      h('option', { value: 'adult' }, 'Adulte'),
      h('option', { value: 'child' }, 'Enfant'),
      h('option', { value: 'manager' }, 'Encadrant'),
    );
    form.append(
      field('Code famille', h('input', { class: 'input', name: 'invite_code', required: true, autocapitalize: 'characters', placeholder: 'XXXXXXXX' })),
      field('Votre nom affiché', h('input', { class: 'input', name: 'display_name', required: true })),
      field('Identifiant', h('input', { class: 'input', name: 'username', required: true })),
      field('Email (optionnel)', h('input', { class: 'input', name: 'email', type: 'email' })),
      field('Mot de passe (6+ car.)', h('input', { class: 'input', name: 'password', type: 'password', minlength: 6, required: true })),
      field('Rôle', sel),
      h('button', { class: 'btn', type: 'submit' }, 'Rejoindre la famille'),
    );
  }
  form.appendChild(err);
  return form;
}

function field(label, input) {
  return h('div', { class: 'field' }, h('label', {}, label), input);
}

// ====== Application principale ======
function renderApp() {
  const root = $('#app');
  root.innerHTML = '';
  const shell = h('div', { class: 'shell' });

  // Topbar
  const top = h('div', { class: 'topbar' });
  const left = h('div');
  const titles = { tasks: 'Tâches', family: 'Famille', profile: 'Profil' };
  left.appendChild(h('h1', {}, titles[state.view]));
  left.appendChild(h('div', { class: 'sub' }, state.family?.name + ' · ' + roleLabel(state.user.role)));
  top.appendChild(left);
  if (state.view === 'tasks' && (state.user.role === 'adult' || state.user.role === 'manager')) {
    top.appendChild(h('button', { class: 'icon-btn', onclick: openTaskModal, 'aria-label': 'Nouvelle tâche' }, '+'));
  }
  shell.appendChild(top);

  // Content
  const content = h('div', { class: 'content' });
  if (state.view === 'tasks') content.appendChild(renderTasksView());
  if (state.view === 'family') content.appendChild(renderFamilyView());
  if (state.view === 'profile') content.appendChild(renderProfileView());
  shell.appendChild(content);

  // Bottom nav
  const nav = h('div', { class: 'bottom-nav' });
  const navBtn = (v, icon, label) => h('button', {
    class: state.view === v ? 'active' : '',
    onclick: () => { state.view = v; renderApp(); }
  }, h('span', { class: 'nav-icon' }, icon), h('span', {}, label));
  nav.append(
    navBtn('tasks', '✓', 'Tâches'),
    navBtn('family', '👥', 'Famille'),
    navBtn('profile', '⚙', 'Profil'),
  );
  shell.appendChild(nav);
  root.appendChild(shell);

  // Bannières contextuelles iOS
  maybeShowIosTips();
}

function roleLabel(r) {
  return { adult: 'Adulte', child: 'Enfant', manager: 'Encadrant' }[r] || r;
}

// ====== Bannières iOS ======
function maybeShowIosTips() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (state.view !== 'tasks') return;
  if (isIos && !isStandalone && !localStorage.getItem('hide_install_tip')) {
    const banner = h('div', { class: 'banner' },
      h('span', { class: 'close', onclick: e => { e.target.parentElement.remove(); localStorage.setItem('hide_install_tip', '1'); } }, '✕'),
      h('strong', {}, 'Astuce : '),
      'pour recevoir les notifications, ouvrez Safari → Partager → ',
      h('em', {}, 'Sur l\'écran d\'accueil'), '.'
    );
    $('.content').prepend(banner);
  }
  if (isStandalone && Notification.permission === 'default' && !localStorage.getItem('hide_push_tip')) {
    const banner = h('div', { class: 'banner' },
      h('span', { class: 'close', onclick: e => { e.target.parentElement.remove(); localStorage.setItem('hide_push_tip', '1'); } }, '✕'),
      'Activez les notifications pour ne rien manquer. ',
      h('button', { class: 'btn-ghost', style: 'padding:0;font-weight:600', onclick: enablePush }, 'Activer')
    );
    $('.content').prepend(banner);
  }
}

// ====== Vue Tâches ======
function renderTasksView() {
  const wrap = h('div');
  if (state.tasks.length === 0) {
    wrap.appendChild(h('div', { class: 'empty' },
      h('div', { class: 'big' }, '✨'),
      h('div', {}, 'Aucune tâche pour le moment.'),
      (state.user.role !== 'child') && h('p', { class: 'muted' }, 'Touchez le « + » en haut pour en créer une.')
    ));
    return wrap;
  }
  // Filtre
  const filter = h('div', { class: 'tabs' });
  const filters = [['all','Toutes'],['daily','Quotid.'],['mandatory','Oblig.'],['frequency','Fréq.'],['optional','Option.']];
  let current = 'all';
  filters.forEach(([k, label]) => {
    const b = h('button', { class: k === 'all' ? 'active' : '', onclick: () => {
      current = k;
      $$('.tabs button', filter).forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      list.innerHTML = '';
      renderTaskList(list, current);
    }}, label);
    filter.appendChild(b);
  });
  wrap.appendChild(filter);
  const list = h('div');
  wrap.appendChild(list);
  renderTaskList(list, current);
  return wrap;
}

function renderTaskList(container, filter) {
  const tasks = filter === 'all' ? state.tasks : state.tasks.filter(t => t.type === filter);
  if (tasks.length === 0) {
    container.appendChild(h('div', { class: 'empty muted' }, 'Rien dans cette catégorie.'));
    return;
  }
  for (const t of tasks) container.appendChild(taskCard(t));
}

function taskCard(t) {
  const completion = t.current_completion;
  const isDone = t.type === 'frequency'
    ? (t.frequency_done >= (t.freq_count || 1))
    : !!completion?.completed_at;
  const wasOpened = !!completion?.opened_at;

  const tagClass = `tag tag-${t.type}`;
  const tagLabel = {
    daily: scheduleLabel(t),
    mandatory: 'Obligatoire',
    optional: 'Optionnelle',
    frequency: `${t.frequency_done || 0}/${t.freq_count} par ${{day:'jour',week:'semaine',month:'mois'}[t.freq_period]}`
  }[t.type];

  const card = h('div', { class: 'card tappable', onclick: () => openTaskDetail(t.id) });
  card.append(
    h('div', { class: 'row between' },
      h('div', { class: 'title', style: isDone ? 'opacity:0.55;text-decoration:line-through' : '' }, t.title),
      h('span', { class: 'dot ' + (isDone ? 'done' : (wasOpened ? 'read' : 'todo')), title: isDone ? 'Fait' : (wasOpened ? 'Lu' : 'Non lu') })
    ),
    h('div', { class: 'row', style: 'margin-top:8px;flex-wrap:wrap;gap:6px' },
      h('span', { class: tagClass }, tagLabel),
      t.proof_required ? h('span', { class: 'tag tag-proof' }, 'Preuve requise') : null,
      h('span', { class: 'muted', style: 'margin-left:auto;font-size:12px' },
        state.user.role === 'child' ? '' : ('Pour ' + t.assignee_name)
      ),
    ),
    t.attachment_count > 0 ? h('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' }, '📎 ' + t.attachment_count + ' fichier(s)') : null
  );
  return card;
}

function scheduleLabel(t) {
  if (t.schedule_kind === 'every_day') return 'Chaque jour';
  if (t.schedule_kind === 'weekly') return 'Chaque semaine';
  if (t.schedule_kind === 'monthly') return 'Chaque mois';
  if (t.schedule_kind === 'custom_days') {
    const names = ['D','L','M','M','J','V','S'];
    try { return JSON.parse(t.schedule_days || '[]').map(d => names[d]).join(' '); } catch { return 'Jours choisis'; }
  }
  return 'Quotidienne';
}

// ====== Création de tâche ======
function openTaskModal() {
  openModal((modal, close) => {
    modal.appendChild(h('h2', {}, 'Nouvelle tâche'));
    const form = h('form', { enctype: 'multipart/form-data' });

    // Sélecteur d'enfant
    const sel = h('select', { class: 'select', name: 'assigned_to', required: true });
    sel.appendChild(h('option', { value: '' }, 'Pour qui ?'));
    state.members.filter(m => m.role === 'child').forEach(m => sel.appendChild(h('option', { value: m.id }, m.display_name)));
    if (state.members.filter(m => m.role === 'child').length === 0) {
      // permettre n'importe quel membre
      state.members.filter(m => m.id !== state.user.id).forEach(m => sel.appendChild(h('option', { value: m.id }, m.display_name + ' · ' + roleLabel(m.role))));
    }

    const title = h('input', { class: 'input', name: 'title', required: true, placeholder: 'Ex: Faire les devoirs' });
    const desc = h('textarea', { class: 'textarea', name: 'description', placeholder: 'Détails (optionnel)' });

    const typeSel = h('select', { class: 'select', name: 'type', required: true },
      h('option', { value: 'daily' }, 'Quotidienne / récurrente'),
      h('option', { value: 'mandatory' }, 'Obligatoire (ponctuelle)'),
      h('option', { value: 'optional' }, 'Optionnelle'),
      h('option', { value: 'frequency' }, 'Fréquentielle (X fois sur une période)'),
    );

    // Conteneurs conditionnels
    const dailyOpts = h('div');
    const freqOpts = h('div');
    const dueOpts = h('div');

    function refreshOpts() {
      dailyOpts.innerHTML = '';
      freqOpts.innerHTML = '';
      dueOpts.innerHTML = '';
      if (typeSel.value === 'daily') {
        const kind = h('select', { class: 'select', name: 'schedule_kind' },
          h('option', { value: 'every_day' }, 'Chaque jour'),
          h('option', { value: 'weekly' }, 'Chaque semaine'),
          h('option', { value: 'monthly' }, 'Chaque mois'),
          h('option', { value: 'custom_days' }, 'Jours personnalisés'),
        );
        const daysWrap = h('div', { style: 'display:none' });
        const names = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
        const selected = new Set();
        const pills = h('div', { class: 'day-pills' });
        names.forEach((n, idx) => {
          const p = h('button', { type: 'button', class: 'day-pill', onclick: () => {
            if (selected.has(idx)) { selected.delete(idx); p.classList.remove('active'); }
            else { selected.add(idx); p.classList.add('active'); }
            hidden.value = JSON.stringify(Array.from(selected).sort());
          }}, n);
          pills.appendChild(p);
        });
        const hidden = h('input', { type: 'hidden', name: 'schedule_days' });
        daysWrap.append(pills, hidden);
        kind.addEventListener('change', () => {
          daysWrap.style.display = kind.value === 'custom_days' ? 'block' : 'none';
        });
        dailyOpts.append(field('Fréquence', kind), field('Jours (si personnalisés)', daysWrap));
      }
      if (typeSel.value === 'frequency') {
        freqOpts.append(
          field('Combien de fois ?', h('input', { class: 'input', name: 'freq_count', type: 'number', min: 1, value: 1, required: true })),
          field('Sur quelle période ?', h('select', { class: 'select', name: 'freq_period', required: true },
            h('option', { value: 'day' }, 'par jour'),
            h('option', { value: 'week' }, 'par semaine'),
            h('option', { value: 'month' }, 'par mois'),
          )),
        );
      }
      if (typeSel.value === 'mandatory' || typeSel.value === 'optional') {
        dueOpts.append(field('Échéance (optionnel)', h('input', { class: 'input', name: 'due_at', type: 'datetime-local' })));
      }
    }

    const proofWrap = h('label', { class: 'checkbox-row' },
      h('input', { type: 'checkbox', name: 'proof_required', value: '1' }),
      h('span', {}, 'Preuve obligatoire (fichier requis pour valider)')
    );

    const fileLabel = h('label', { class: 'file-input-wrap' },
      '📎 Ajouter des fichiers (audio, vidéo, photo, PDF, Word…)',
      h('input', { type: 'file', name: 'files', multiple: true, accept: 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt' })
    );
    const fileList = h('div', { class: 'file-list' });
    fileLabel.querySelector('input').addEventListener('change', (e) => {
      fileList.innerHTML = '';
      Array.from(e.target.files).forEach(f => fileList.appendChild(h('div', {}, '· ' + f.name)));
    });

    typeSel.addEventListener('change', refreshOpts);

    form.append(
      field('Pour', sel),
      field('Titre', title),
      field('Description', desc),
      field('Type de tâche', typeSel),
      dailyOpts, freqOpts, dueOpts,
      h('div', { class: 'field' }, proofWrap),
      fileLabel, fileList,
    );
    refreshOpts();

    const err = h('div', { class: 'error-msg' });
    const submitBtn = h('button', { class: 'btn', type: 'submit' }, 'Créer la tâche');
    form.append(submitBtn, err);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Création…';
      try {
        const fd = new FormData(form);
        await api('/api/tasks', { method: 'POST', body: fd });
        toast('Tâche créée');
        await loadAll();
        close();
        renderApp();
      } catch (e) {
        err.textContent = e.message;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Créer la tâche';
      }
    });
    modal.appendChild(form);
  });
}

// ====== Détail d'une tâche ======
async function openTaskDetail(id) {
  let detail;
  try { detail = await api('/api/tasks/' + id); } catch (e) { toast(e.message); return; }
  // Si l'utilisateur est l'enfant assigné : marquer comme lu
  if (state.user.role === 'child' && detail.task.assigned_to === state.user.id) {
    api('/api/tasks/' + id + '/open', { method: 'POST' }).catch(() => {});
  }
  openModal((modal, close) => {
    const t = detail.task;
    modal.appendChild(h('h2', {}, t.title));
    if (t.description) modal.appendChild(h('p', { class: 'muted' }, t.description));

    modal.appendChild(h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:12px' },
      h('span', { class: 'tag tag-' + t.type },
        t.type === 'daily' ? scheduleLabel(t) :
        t.type === 'frequency' ? `${t.freq_count} × / ${{day:'jour',week:'sem.',month:'mois'}[t.freq_period]}` :
        t.type === 'mandatory' ? 'Obligatoire' : 'Optionnelle'),
      t.proof_required ? h('span', { class: 'tag tag-proof' }, 'Preuve requise') : null,
      h('span', { class: 'muted' }, 'Pour ' + (detail.assignee?.display_name || ''))
    ));

    // Pièces jointes (instructions)
    if (detail.attachments.length > 0) {
      modal.appendChild(h('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Pièces jointes'));
      const grid = h('div', { class: 'attach-grid' });
      detail.attachments.forEach(a => grid.appendChild(attachmentTile(a)));
      modal.appendChild(grid);
    }

    modal.appendChild(h('hr', { class: 'sep' }));

    // Action enfant : marquer fait
    const isAssignedChild = state.user.id === t.assigned_to;
    const currentKey = currentOccurrenceKey(t);
    const currentDone = (t.type === 'frequency')
      ? false // toujours possible
      : !!(detail.completions.find(c => c.occurrence_key === currentKey)?.completed_at);

    if (isAssignedChild && !currentDone) {
      const formC = h('form', { enctype: 'multipart/form-data' });
      const proofLabel = h('label', { class: 'file-input-wrap' },
        t.proof_required ? '📎 Joindre la preuve (obligatoire)' : '📎 Joindre une preuve (optionnel)',
        h('input', { type: 'file', name: 'proofs', multiple: true, accept: 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.txt' })
      );
      const proofList = h('div', { class: 'file-list' });
      proofLabel.querySelector('input').addEventListener('change', (e) => {
        proofList.innerHTML = '';
        Array.from(e.target.files).forEach(f => proofList.appendChild(h('div', {}, '· ' + f.name)));
      });
      const submitBtn = h('button', { class: 'btn', type: 'submit' }, '✓ Marquer comme fait');
      const err = h('div', { class: 'error-msg' });
      formC.append(proofLabel, proofList, submitBtn, err);
      formC.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Envoi…';
        try {
          const fd = new FormData(formC);
          // Géoloc (best effort)
          try {
            const pos = await new Promise((resolve, reject) => {
              if (!navigator.geolocation) return reject();
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
            });
            fd.append('lat', pos.coords.latitude);
            fd.append('lng', pos.coords.longitude);
          } catch {}
          await api('/api/tasks/' + t.id + '/complete', { method: 'POST', body: fd });
          toast('Bravo, c\'est fait !');
          await loadAll();
          close();
          renderApp();
        } catch (e) {
          err.textContent = e.message;
          submitBtn.disabled = false;
          submitBtn.textContent = '✓ Marquer comme fait';
        }
      });
      modal.appendChild(formC);
      modal.appendChild(h('hr', { class: 'sep' }));
    }

    // Historique des complétions (visible par tous, surtout les encadrants)
    modal.appendChild(h('div', { class: 'muted', style: 'margin-bottom:6px' }, 'Historique'));
    if (detail.completions.length === 0) {
      modal.appendChild(h('div', { class: 'muted', style: 'font-size:13px' }, 'Aucune action enregistrée.'));
    } else {
      detail.completions.forEach(c => modal.appendChild(completionRow(c)));
    }

    // Suppression (adulte ou auteur)
    if (state.user.role === 'adult' || t.created_by === state.user.id) {
      modal.appendChild(h('hr', { class: 'sep' }));
      modal.appendChild(h('button', { class: 'btn btn-secondary', onclick: async () => {
        if (!confirm('Supprimer cette tâche ?')) return;
        try {
          await api('/api/tasks/' + t.id, { method: 'DELETE' });
          toast('Supprimée');
          await loadAll();
          close();
          renderApp();
        } catch (e) { toast(e.message); }
      }}, '🗑 Supprimer la tâche'));
    }
  });
}

function attachmentTile(a) {
  const icon = a.mime_type.startsWith('image/') ? '🖼️' :
               a.mime_type.startsWith('video/') ? '🎬' :
               a.mime_type.startsWith('audio/') ? '🎧' :
               a.mime_type.includes('pdf') ? '📄' :
               a.mime_type.includes('word') || a.mime_type.includes('document') ? '📝' : '📎';
  return h('a', { class: 'attach-item', href: '/files/' + a.filename, target: '_blank', rel: 'noopener' },
    h('span', { class: 'ic' }, icon),
    a.original_name
  );
}

function completionRow(c) {
  const status = c.completed_at ? 'done' : (c.read_at ? 'read' : 'todo');
  const lines = [];
  if (c.completed_at) lines.push('✓ Fait le ' + formatDate(c.completed_at));
  else if (c.read_at) lines.push('👁 Lu le ' + formatDate(c.read_at));
  else lines.push('Non ouvert');
  if (c.opened_at && !c.completed_at) lines.push('Ouvert le ' + formatDate(c.opened_at));
  if (c.location_lat) lines.push(`📍 ${Number(c.location_lat).toFixed(4)}, ${Number(c.location_lng).toFixed(4)}`);

  const row = h('div', { class: 'completion-row' },
    h('span', { class: 'dot ' + status }),
    h('div', { style: 'flex:1' },
      h('div', { style: 'font-size:13px' }, lines.join(' · ')),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Occurrence : ' + c.occurrence_key.split('#')[0]),
      c.proofs && c.proofs.length > 0 ? (() => {
        const grid = h('div', { class: 'attach-grid', style: 'margin-top:6px' });
        c.proofs.forEach(p => grid.appendChild(attachmentTile(p)));
        return grid;
      })() : null
    )
  );
  return row;
}

function currentOccurrenceKey(t) {
  // Recalcul côté client ; sert seulement à afficher si l'occurrence courante est faite
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const isoDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (t.type === 'mandatory' || t.type === 'optional') return 'single';
  if (t.type === 'daily') {
    if (t.schedule_kind === 'every_day') return isoDate;
    if (t.schedule_kind === 'weekly') {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
      return `${date.getUTCFullYear()}-W${pad(weekNo)}`;
    }
    if (t.schedule_kind === 'monthly') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    if (t.schedule_kind === 'custom_days') return isoDate;
  }
  return isoDate;
}

function formatDate(s) {
  if (!s) return '';
  try {
    return new Date(s.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return s; }
}

// ====== Vue Famille ======
function renderFamilyView() {
  const wrap = h('div');
  // Code d'invitation
  wrap.appendChild(h('div', { class: 'invite-box' },
    h('div', { class: 'muted' }, 'Code de la famille'),
    h('div', { class: 'invite-code' }, state.family.invite_code),
    h('div', { class: 'muted', style: 'font-size:12px' }, 'À transmettre aux nouveaux membres pour qu\'ils rejoignent.'),
    h('button', { class: 'btn-ghost btn-sm', style: 'margin-top:6px', onclick: () => {
      navigator.clipboard?.writeText(state.family.invite_code);
      toast('Code copié');
    }}, 'Copier')
  ));

  // Liste des membres
  wrap.appendChild(h('div', { class: 'card' },
    ...state.members.map(m => h('div', { class: 'member-row' },
      h('div', { class: 'avatar' }, (m.display_name || '?').charAt(0).toUpperCase()),
      h('div', { style: 'flex:1' },
        h('div', { style: 'font-weight:600' }, m.display_name),
        h('div', { class: 'muted', style: 'font-size:12px' }, '@' + m.username)
      ),
      h('span', { class: 'role-pill ' + m.role }, roleLabel(m.role)),
      (state.user.role === 'adult' && m.id !== state.user.id)
        ? h('button', { class: 'icon-btn', onclick: async () => {
            if (!confirm('Retirer ' + m.display_name + ' de la famille ?')) return;
            try {
              await api('/api/family/members/' + m.id, { method: 'DELETE' });
              await loadAll(); renderApp();
            } catch (e) { toast(e.message); }
          }}, '✕')
        : null
    ))
  ));
  return wrap;
}

// ====== Vue Profil ======
function renderProfileView() {
  const wrap = h('div');
  wrap.appendChild(h('div', { class: 'card' },
    h('div', { style: 'font-weight:600;font-size:18px' }, state.user.name),
    h('div', { class: 'muted' }, roleLabel(state.user.role) + ' · ' + state.family.name)
  ));

  // Notifications
  const notifCard = h('div', { class: 'card' });
  notifCard.appendChild(h('div', { style: 'font-weight:600;margin-bottom:8px' }, 'Notifications'));
  const status = h('div', { class: 'muted', style: 'font-size:13px;margin-bottom:10px' });
  refreshNotifStatus(status);
  notifCard.appendChild(status);
  notifCard.appendChild(h('button', { class: 'btn btn-secondary', onclick: async () => {
    await enablePush();
    refreshNotifStatus(status);
  }}, 'Activer / réactiver les notifications'));
  notifCard.appendChild(h('button', { class: 'btn btn-ghost', style: 'margin-top:6px', onclick: async () => {
    try { await api('/api/push/test', { method: 'POST' }); toast('Notification de test envoyée'); }
    catch (e) { toast(e.message); }
  }}, 'Envoyer un test'));
  wrap.appendChild(notifCard);

  // Logout
  wrap.appendChild(h('button', { class: 'btn btn-secondary', onclick: async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null; state.family = null;
    renderAuth();
  }}, 'Se déconnecter'));

  return wrap;
}

function refreshNotifStatus(el) {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  let txt = '';
  if (!('Notification' in window)) txt = 'Notifications non supportées sur ce navigateur.';
  else if (isIos && !isStandalone) txt = '⚠️ Sur iPhone, ajoutez l\'app à l\'écran d\'accueil pour recevoir les notifications.';
  else if (Notification.permission === 'granted') txt = '✓ Notifications activées.';
  else if (Notification.permission === 'denied') txt = 'Notifications refusées (à réactiver dans Réglages iOS).';
  else txt = 'Non activées.';
  el.textContent = txt;
}

// ====== Web Push ======
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Push non supporté');
    return;
  }
  if (!state.pushKey) {
    toast('Clé VAPID non configurée côté serveur');
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permission refusée'); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.pushKey)
    });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
    toast('Notifications activées');
  } catch (e) {
    toast('Erreur: ' + e.message);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

// ====== Lancement ======
init();
