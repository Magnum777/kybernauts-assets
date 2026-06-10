const fs = require('fs');
const crypto = require('crypto');

const dataPath = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\data.json';
const passphrase = '0lMH7!GgwW&_2hqHVLBXlV3pj+ON^SRt0lCj6dkAu2X=3GBD=UH^XIY';

async function encryptData() {
  const plaintext = fs.readFileSync(dataPath);
  
  // Generate random salt and nonce
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12); // AES-GCM standard nonce size
  
  // Derive key using PBKDF2
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  
  // Encrypt using AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  
  // Combine: salt(16) + nonce(12) + ciphertext(N) + tag(16)
  const combined = Buffer.concat([salt, nonce, ciphertext, tag]);
  
  // Base64 encode for embedding in JS
  const b64 = combined.toString('base64');
  
  console.log('Encrypted data length:', b64.length);
  
  fs.writeFileSync(
    'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\encrypted-data.js',
    `window.ENCRYPTED_DATA = '${b64}';`
  );
  
  console.log('Written encrypted-data.js');
  console.log('Passphrase:', passphrase);
  console.log('Salt length:', salt.length);
  console.log('Nonce length:', nonce.length);
  console.log('Ciphertext length:', ciphertext.length);
  console.log('Tag length:', tag.length);
}

encryptData().catch(console.error);
