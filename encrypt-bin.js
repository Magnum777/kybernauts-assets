const fs = require('fs');
const crypto = require('crypto');

const dataPath = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\data.json';
const passphrase = '0lMH7!GgwW&_2hqHVLBXlV3pj+ON^SRt0lCj6dkAu2X=3GBD=UH^XIY';
const outDir = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer';

async function encryptData() {
  const plaintext = fs.readFileSync(dataPath);
  
  // Generate random salt and nonce
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  
  // Derive key using PBKDF2
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  
  // Encrypt using AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  // Write binary: salt(16) + nonce(12) + ciphertext(N) + tag(16)
  const combined = Buffer.concat([salt, nonce, ciphertext, tag]);
  
  fs.writeFileSync(`${outDir}/data.enc`, combined);
  
  console.log('Written data.enc:', combined.length, 'bytes');
  console.log('Salt:', salt.toString('hex'));
  console.log('Nonce:', nonce.toString('hex'));
}

encryptData().catch(console.error);
