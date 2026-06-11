const fs = require('fs');
const crypto = require('crypto');

const passphrase = 'u^w%dEUq!$_\u0026E5l++oGjXT%5UYqlSWZEiASjtTdd_Cbn\u0026ob5w6e9Y8v';
const data = fs.readFileSync('data-gh.enc');

console.log('File size:', data.length);
console.log('Passphrase length:', passphrase.length);

const salt = data.slice(0, 16);
const nonce = data.slice(16, 28);
const ciphertext = data.slice(28, data.length - 16);
const tag = data.slice(data.length - 16);

console.log('Salt (hex):', salt.toString('hex'));
console.log('Nonce (hex):', nonce.toString('hex'));
console.log('Tag (hex):', tag.toString('hex'));

const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
console.log('Key (hex):', key.toString('hex'));

const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAuthTag(tag);

let decrypted = decipher.update(ciphertext);
decrypted = Buffer.concat([decrypted, decipher.final()]);

console.log('Decrypted length:', decrypted.length);
const json = JSON.parse(decrypted.toString('utf8'));
console.log('Total regions:', [...new Set(json.locations.map(l => l.region))].length);
console.log('Unknown count:', json.locations.filter(l => l.region === 'Unknown' || !l.region).length);
