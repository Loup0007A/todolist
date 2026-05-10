// Génère une paire de clés VAPID pour Web Push
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('\n=== Clés VAPID générées ===\n');
console.log('Copiez ces lignes dans votre fichier .env :\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nPensez aussi à définir VAPID_SUBJECT (mailto:votre@email.com)\n');
