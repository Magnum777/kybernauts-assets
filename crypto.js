(async function() {
  const encoder = new TextEncoder();
  
  async function deriveKey(passphrase, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
  }
  
  async function decryptAssets(passphrase) {
    const resp = await fetch('data.enc?t=' + Date.now());
    if (!resp.ok) throw new Error('Cannot fetch data');
    const data = new Uint8Array(await resp.arrayBuffer());
    
    // Layout from Node.js crypto: salt(16) + nonce(12) + ciphertext(N) + tag(16)
    const salt = data.slice(0, 16);
    const nonce = data.slice(16, 28);
    const ciphertext = data.slice(28, data.length - 16);
    const tag = data.slice(data.length - 16);
    
    // Web Crypto AES-GCM expects ciphertext + tag appended (NOT including nonce)
    // The nonce goes in the iv field, not the ciphertext buffer
    const ciphertextWithTag = new Uint8Array(ciphertext.length + tag.length);
    ciphertextWithTag.set(ciphertext, 0);
    ciphertextWithTag.set(tag, ciphertext.length);
    
    const key = await deriveKey(passphrase, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      key,
      ciphertextWithTag
    );
    return JSON.parse(new TextDecoder('utf-8').decode(decrypted));
  }
  
  window.decryptAssets = decryptAssets;
  
  function buildGate() {
    if (document.getElementById('passgate-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'passgate-overlay';
    overlay.innerHTML = `
      <style>
        #passgate-overlay {
          position: fixed; inset: 0; z-index: 999999;
          background: radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0a 100%);
          display: flex; align-items: center; justify-content: center;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        #passgate-overlay .gate-box {
          background: #111; border: 2px solid #e67e22;
          border-radius: 12px; padding: 40px; max-width: 500px; width: 90%;
          text-align: center; box-shadow: 0 0 40px rgba(230,126,34,0.3);
        }
        #passgate-overlay .gate-icon { font-size: 48px; margin-bottom: 15px; }
        #passgate-overlay h2 { color: #f39c12; margin-bottom: 10px; font-size: 22px; }
        #passgate-overlay p { color: #888; margin-bottom: 25px; font-size: 14px; }
        #passgate-overlay input {
          width: 100%; padding: 12px 15px; font-size: 16px;
          background: #1a1a1a; border: 2px solid #333; color: #ddd;
          border-radius: 6px; margin-bottom: 15px; text-align: center;
          letter-spacing: 1px; font-family: monospace;
        }
        #passgate-overlay input:focus { outline: none; border-color: #e67e22; }
        #passgate-overlay input.error { border-color: #e74c3c; animation: shake 0.3s; }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        #passgate-overlay button {
          background: #e67e22; border: none; color: #fff;
          padding: 12px 30px; border-radius: 6px; cursor: pointer;
          font-size: 16px; font-weight: bold; width: 100%;
        }
        #passgate-overlay button:hover { background: #d35400; }
        #passgate-overlay .gate-status { color: #e74c3c; margin-top: 12px; font-size: 13px; min-height: 18px; }
        #passgate-overlay .gate-spinner {
          border: 3px solid #333; border-top: 3px solid #e67e22;
          border-radius: 50%; width: 24px; height: 24px;
          animation: spin 1s linear infinite; margin: 0 auto 10px; display: none;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
      <div class="gate-box">
        <div class="gate-icon">🔒</div>
        <h2>EVE Assets Viewer</h2>
        <p>Enter the 55-character passphrase to decrypt and view asset data.</p>
        <div class="gate-spinner" id="gate-spinner"></div>
        <input type="password" id="gate-passphrase" placeholder="Enter passphrase..." autocomplete="off" maxlength="100">
        <button id="gate-unlock">Unlock Vault</button>
        <div class="gate-status" id="gate-status"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const btn = document.getElementById('gate-unlock');
    const input = document.getElementById('gate-passphrase');
    const status = document.getElementById('gate-status');
    const spinner = document.getElementById('gate-spinner');
    
    async function doUnlock() {
      const phrase = input.value.trim();
      if (!phrase) return;
      spinner.style.display = 'block';
      status.textContent = '';
      input.classList.remove('error');
      btn.disabled = true;
      
      try {
        const decrypted = await window.decryptAssets(phrase);
        window.appData = decrypted;
        overlay.remove();
        if (window.logVaultAccess) window.logVaultAccess();
        if (window.onVaultUnlocked) window.onVaultUnlocked(decrypted);
      } catch (e) {
        spinner.style.display = 'none';
        input.classList.add('error');
        status.textContent = 'Wrong passphrase — decryption failed.';
        btn.disabled = false;
        input.select();
      }
    }
    
    btn.addEventListener('click', doUnlock);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
    input.focus();
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildGate);
  } else {
    buildGate();
  }
})();
