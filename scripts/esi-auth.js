#!/usr/bin/env node
/**
 * EVE SSO Auth Capture for Kybernauts Assets
 * 
 * Run once per Director alt to capture refresh tokens.
 * 
 * Usage:
 *   ESI_CLIENT_ID=xxx ESI_CLIENT_SECRET=yyy node esi-auth.js
 *   OR set in scripts/.env file
 * 
 * Each Director alt logs in via browser. Tokens are stored encrypted
 * in scripts/tokens.json for later use by the NAS sync job.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

// Load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  });
}

const CONFIG = {
  PORT: 3000,
  CALLBACK_PATH: '/callback',
  ESI_AUTH_URL: 'https://login.eveonline.com/v2/oauth/authorize',
  ESI_TOKEN_URL: 'https://login.eveonline.com/v2/oauth/token',
  SCOPES: [
    'esi-assets.read_corporation_assets.v1',
    'esi-wallet.read_corporation_wallets.v1',
    'esi-universe.read_structures.v1',
    'esi-corporations.read_divisions.v1',
    'esi-corporations.read_structures.v1',
    'esi-characters.read_corporation_roles.v1'
  ].join(' '),
  TOKEN_FILE: path.join(__dirname, 'tokens.json'),
  ENCRYPTION_KEY_FILE: path.join(__dirname, '.token-key')
};

// Load credentials from environment
const CLIENT_ID = process.env.ESI_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ESI_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('ERROR: Set ESI_CLIENT_ID and ESI_CLIENT_SECRET environment variables');
  console.error('Example: ESI_CLIENT_ID=xxx ESI_CLIENT_SECRET=yyy node esi-auth.js');
  process.exit(1);
}

// Encryption helpers for storing tokens
function getOrCreateKey() {
  if (fs.existsSync(CONFIG.ENCRYPTION_KEY_FILE)) {
    return fs.readFileSync(CONFIG.ENCRYPTION_KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(CONFIG.ENCRYPTION_KEY_FILE, key, { mode: 0o600 });
  console.log('Generated new encryption key: ' + CONFIG.ENCRYPTION_KEY_FILE);
  return key;
}

function encrypt(data, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(data, key) {
  const [ivHex, encryptedHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function loadTokens() {
  const key = getOrCreateKey();
  if (!fs.existsSync(CONFIG.TOKEN_FILE)) return {};
  try {
    const encrypted = fs.readFileSync(CONFIG.TOKEN_FILE, 'utf8');
    return JSON.parse(decrypt(encrypted, key));
  } catch (e) {
    console.warn('Could not decrypt tokens, starting fresh:', e.message);
    return {};
  }
}

function saveTokens(tokens) {
  const key = getOrCreateKey();
  const encrypted = encrypt(JSON.stringify(tokens, null, 2), key);
  fs.writeFileSync(CONFIG.TOKEN_FILE, encrypted, { mode: 0o600 });
}

// PKCE helpers
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ESI token exchange
function exchangeCode(code, verifier) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: CLIENT_ID,
      code_verifier: verifier
    }).toString();

    const req = https.request(CONFIG.ESI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('=== TOKEN RESPONSE DEBUG ===');
        console.log('Status:', res.statusCode, res.statusMessage);
        console.log('Headers:', JSON.stringify(res.headers, null, 2));
        console.log('Body (first 1000 chars):', data.substring(0, 1000));
        console.log('Body length:', data.length);
        console.log('===========================');
        try {
          const json = JSON.parse(data);
          if (json.error) reject(new Error(json.error_description || json.error));
          else resolve(json);
        } catch (e) {
          reject(new Error('Invalid token response (not JSON): ' + data.substring(0, 300)));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ESI character info
function getCharacterInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://esi.evetech.net/latest/verify/', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ESI corp roles check
function getCorpRoles(characterId, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `https://esi.evetech.net/latest/characters/${characterId}/roles/`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Build auth URL
const pkce = generatePKCE();
const state = crypto.randomBytes(16).toString('hex');

const authUrl = new URL(CONFIG.ESI_AUTH_URL);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', `http://localhost:${CONFIG.PORT}${CONFIG.CALLBACK_PATH}`);
authUrl.searchParams.set('scope', CONFIG.SCOPES);
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('code_challenge', pkce.challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');

// HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${CONFIG.PORT}`);

  if (url.pathname === CONFIG.CALLBACK_PATH) {
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>Auth Error: ${error}</h1><p>${url.searchParams.get('error_description') || ''}</p>`);
      return;
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Missing authorization code</h1>');
      return;
    }

    if (returnedState !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Invalid state parameter (CSRF protection)</h1>');
      return;
    }

    try {
      console.log('Exchanging authorization code for tokens...');
      const tokenResponse = await exchangeCode(code, pkce.verifier);
      
      console.log('Getting character info...');
      const charInfo = await getCharacterInfo(tokenResponse.access_token);
      
      console.log('Checking corp roles...');
      const roles = await getCorpRoles(charInfo.CharacterID, tokenResponse.access_token);
      
      const hasDirector = roles.roles && roles.roles.includes('Director');
      
      const tokens = loadTokens();
      tokens[charInfo.CharacterID] = {
        characterName: charInfo.CharacterName,
        characterId: charInfo.CharacterID,
        corporationId: charInfo.CorporationID || (roles && roles.corporation_id) || null,
        hasDirector: hasDirector,
        refreshToken: tokenResponse.refresh_token,
        scopes: tokenResponse.scope || CONFIG.SCOPES,
        expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
        addedAt: new Date().toISOString()
      };
      saveTokens(tokens);

      const corpName = tokens[charInfo.CharacterID].corporationId ? `Corp ID: ${tokens[charInfo.CharacterID].corporationId}` : 'Unknown corp';

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html><head><title>Auth Success</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#ddd;">
          <h1 style="color:#2ecc71;">✅ Auth Successful</h1>
          <p><strong>Character:</strong> ${charInfo.CharacterName}</p>
          <p><strong>${corpName}</strong></p>
          <p><strong>Director:</strong> ${hasDirector ? 'YES ✅' : 'NO ❌'}</p>
          <p style="color:#888;">Refresh token saved securely.</p>
          <p><a href="/" style="color:#e67e22;">Add another character</a></p>
          <p><a href="/list" style="color:#3498db;">View saved tokens</a></p>
        </body></html>
      `);

      console.log('\n=== AUTH SUCCESS ===');
      console.log('Character:', charInfo.CharacterName);
      console.log('Corp ID:', tokens[charInfo.CharacterID].corporationId);
      console.log('Director:', hasDirector);
      console.log('Token saved to:', CONFIG.TOKEN_FILE);
      console.log('====================\n');

    } catch (e) {
      console.error('Token exchange failed:', e.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<h1>Error</h1><pre>${e.message}</pre>`);
    }
    return;
  }

  if (url.pathname === '/list') {
    const tokens = loadTokens();
    const list = Object.values(tokens).map(t => 
      `<tr><td>${t.characterName}</td><td>${t.corporationId}</td><td>${t.hasDirector ? '✅' : '❌'}</td><td>${new Date(t.addedAt).toLocaleString()}</td></tr>`
    ).join('');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html><head><title>Saved Tokens</title></head>
      <body style="font-family:sans-serif;padding:20px;background:#0a0a0a;color:#ddd;">
        <h1 style="color:#f39c12;">Saved Tokens</h1>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="background:#1a1a2e;"><th>Character</th><th>Corp ID</th><th>Director</th><th>Added</th></tr>
          ${list || '<tr><td colspan="4" style="text-align:center;color:#888;">No tokens saved yet</td></tr>'}
        </table>
        <p><a href="/" style="color:#e67e22;">Add another</a></p>
      </body></html>
    `);
    return;
  }

  // Default: redirect to EVE SSO
  res.writeHead(302, { 'Location': authUrl.toString() });
  res.end();
});

server.listen(CONFIG.PORT, () => {
  console.log('\n=== Kybernauts ESI Auth Server ===');
  console.log('Open this URL in your browser:');
  console.log(`  http://localhost:${CONFIG.PORT}/`);
  console.log('\nOr click here to start:');
  console.log(`  ${authUrl.toString()}`);
  console.log('\nThis will redirect you to EVE SSO. Log in with a Director alt.');
  console.log('Press Ctrl+C when done.\n');
  
  // Auto-open browser on Windows
  exec(`start "" "http://localhost:${CONFIG.PORT}/"`, (err) => {
    if (err) console.log('(Could not auto-open browser, please open manually)');
  });
});
