# TodoFamily

To-do list familiale fiable, optimisée iPhone (PWA), avec :
- 3 rôles : adulte, enfant, encadrant
- 4 types de tâches : quotidienne (chaque jour/sem./mois/jours custom), obligatoire, optionnelle, fréquentielle
- Pièces jointes (audio, vidéo, photo, PDF, Word…) — preuve obligatoire optionnelle
- Suivi : ouverture, lecture, géolocalisation au moment de la complétion
- Notifications Web Push (création de tâche, complétion, rappels périodiques)

## 1) Prérequis

- Node.js ≥ 18
- npm

## 2) Installation locale

```bash
npm install
cp .env.example .env
npm run gen-vapid    # génère VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY → à coller dans .env
# Éditer .env : choisir un JWT_SECRET fort (long, aléatoire) et coller les clés VAPID
npm start
```

Visitez `http://localhost:3000`.

> ⚠️ Les notifications Web Push exigent **HTTPS en production**. En local, le test de notification ne fonctionnera que si l'URL est `localhost` ou `127.0.0.1`.

## 3) Variables .env

| Clé                | Rôle                                                    |
|--------------------|---------------------------------------------------------|
| `PORT`             | Port d'écoute (défaut 3000)                             |
| `JWT_SECRET`       | Secret JWT pour les sessions (à changer impérativement) |
| `NODE_ENV`         | `production` active les cookies sécurisés (HTTPS)        |
| `VAPID_PUBLIC_KEY` | Clé publique Web Push (générée par `npm run gen-vapid`)  |
| `VAPID_PRIVATE_KEY`| Clé privée Web Push                                     |
| `VAPID_SUBJECT`    | `mailto:votre@email.com` (requis par la spec Web Push)  |

## 4) Déploiement en production (recette simple : VPS Ubuntu)

```bash
# Sur le serveur
sudo apt update && sudo apt install -y nodejs npm nginx
git clone <votre-repo> /var/www/todofamily && cd /var/www/todofamily
npm install --omit=dev
cp .env.example .env && npm run gen-vapid
nano .env   # collez les clés et un JWT_SECRET aléatoire fort

# Démarrage permanent avec systemd
sudo tee /etc/systemd/system/todofamily.service > /dev/null <<EOF
[Unit]
Description=TodoFamily
After=network.target
[Service]
WorkingDirectory=/var/www/todofamily
ExecStart=/usr/bin/node src/server.js
Restart=always
EnvironmentFile=/var/www/todofamily/.env
User=www-data
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now todofamily
```

Puis Nginx + HTTPS (Let's Encrypt) :

```nginx
server {
  listen 443 ssl http2;
  server_name todofamily.example.com;
  ssl_certificate     /etc/letsencrypt/live/todofamily.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/todofamily.example.com/privkey.pem;
  client_max_body_size 60M;
  location / { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
}
```

```bash
sudo certbot --nginx -d todofamily.example.com
```

## 5) Sur iPhone

1. Ouvrir le site dans **Safari** (Chrome iOS ne suffit pas).
2. Bouton **Partager** → **Sur l'écran d'accueil**.
3. Lancer l'app depuis l'icône (mode standalone).
4. Aller dans **Profil → Activer les notifications**.

> Les notifications Web Push iOS exigent iOS **16.4+** *et* l'installation sur l'écran d'accueil. C'est une contrainte d'Apple, pas du code. L'app détecte le contexte et affiche les bons messages.

## 6) Données

- Base SQLite : `data/app.db` (créée automatiquement)
- Fichiers uploadés : `public/uploads/` (servis via `/files/<nom>`, route protégée par auth)
- Sauvegarde recommandée : `data/` + `public/uploads/`

## 7) Limites connues / honnêteté technique

- Pas de chiffrement at-rest des fichiers : ils vivent en clair dans `public/uploads/`. Pour un usage strict (données mineures), restreindre l'accès au serveur et utiliser un disque chiffré.
- Le rappel automatique tourne toutes les 30 min en interne (`setInterval`). Si vous arrêtez le process, plus de rappels — `systemd` règle ça.
- Pas de pagination des tâches : pour une famille typique (< 200 tâches actives), ça passe largement. Pour usage extensif, indexer/paginer.
- Auth par cookie httpOnly + JWT : OK pour un usage familial. En multi-tenant ou public large, ajouter rate limiting (express-rate-limit) et CSRF token sur les mutations.
- Pas d'invitation par email : l'invitation se fait par code (8 caractères) à transmettre.

## 8) Structure

```
todofamily/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── data/                    # SQLite
├── public/                  # frontend statique
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── sw.js                # service worker (PWA + push)
│   ├── manifest.webmanifest
│   ├── icons/
│   └── uploads/             # fichiers utilisateurs
└── src/
    ├── server.js            # entrée Express
    ├── db.js                # schéma + connexion SQLite
    ├── push.js              # Web Push (web-push)
    ├── occurrence.js        # calcul des clés d'occurrence
    ├── genVapid.js          # script clés VAPID
    ├── middleware/auth.js
    └── routes/
        ├── auth.js          # register / join / login / me
        ├── family.js        # membres + code invite
        ├── tasks.js         # CRUD tâches + complétions + uploads
        └── push.js          # subscribe / unsubscribe / rappels
```
