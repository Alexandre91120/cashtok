// Génère un hash bcrypt pour un nouveau mot de passe admin.
// Usage : npm run hash-password -- "monNouveauMotDePasse"
const bcrypt = require('bcryptjs');

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "monMotDePasse"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('\nCopie cette ligne dans ton fichier .env :\n');
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
