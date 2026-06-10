const fs = require('fs');
const crypto = require('crypto');

const passphrase = 'u^w%dEUq!$_&E5l++oGjXT%5UYqlSWZEiASjtTdd_Cbn&ob5w6e9Y8v';
const dataPath = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\data.enc';

console.log('Testing passphrase length:', passphrase.length);
console.log('Passphrase:', passphrase);

const data = fs.readFileSync(dataPath);

// Layout: salt(16) + nonce(12) + ciphertext(N) + tag(16)
const salt = data.slice(0, 16);
const nonce = data.slice(16, 28);
const ciphertext = data.slice(28, data.length - 16);
const tag = data.slice(data.length - 16);

// Web Crypto order: nonce + ciphertext + tag (as single authenticated buffer)
const combined = Buffer.concat([nonce, ciphertext, tag]);

const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');

// Node.js createDecipheriv with AES-GCM
const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
decipher.setAuthTag(tag);

try {
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const json = JSON.parse(decrypted.toString('utf-8'));
  console.log('SUCCESS! Decrypted ' + decrypted.length + ' bytes');
  console.log('Locations:', json.summary.totalLocations);
  console.log('Systems:', json.summary.totalSystems);
  console.log('Total ISK:', json.summary.totalIsk.toLocaleString());
} catch (e) {
  console.log('FAILED:', e.message);
  console.log('Salt:', salt.toString('hex'));
  console.log('Nonce:', nonce.toString('hex'));
  console.log('Tag:', tag.toString('hex'));
  console.log('Ciphertext length:', ciphertext.length);
  console.log('Combined length:', combined.length);
}
