#!/usr/bin/env node
/**
 * NAS ESI Sync Script for Kybernauts Assets — Full Resolution Version
 * 
 * Resolves type names, groups, categories, locations, and market prices.
 * Run via cron every 30 minutes on the Synology NAS.
 * 
 * Usage:
 *   ESI_CLIENT_ID=xxx ESI_CLIENT_SECRET=yyy GITHUB_TOKEN=ghp_xxx node esi-sync.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  TOKEN_FILE: path.join(__dirname, 'tokens.json'),
  ENCRYPTION_KEY_FILE: path.join(__dirname, '.token-key'),
  CACHE_DIR: path.join(__dirname, '.cache'),
  ESI_BASE: 'https://esi.evetech.net/latest',
  ESI_TOKEN_URL: 'https://login.eveonline.com/v2/oauth/token',
  GITHUB_API: 'https://api.github.com',
  MAX_PAGES: 250,
  RATE_LIMIT_DELAY: 100,
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours for type cache
};

const CLIENT_ID = process.env.ESI_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ESI_CLIENT_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const REPO = process.env.REPO || 'Magnum777/kybernauts-assets';
const ENCRYPT_PASSPHRASE = process.env.ENCRYPT_PASSPHRASE || '';

if (!CLIENT_ID || !CLIENT_SECRET || !GITHUB_TOKEN || !ENCRYPT_PASSPHRASE) {
  console.error('ERROR: Set all env vars. See setup.js');
  process.exit(1);
}

// Cache helpers
function cachePath(name) { return path.join(CONFIG.CACHE_DIR, name + '.json'); }

function loadCache(name) {
  const p = cachePath(name);
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

function saveCache(name, data) {
  if (!fs.existsSync(CONFIG.CACHE_DIR)) fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(name), JSON.stringify(data, null, 2));
}

// Encryption helpers
function getTokenKey() {
  if (!fs.existsSync(CONFIG.ENCRYPTION_KEY_FILE)) {
    console.error('ERROR: No token key. Run esi-auth.js first.');
    process.exit(1);
  }
  return fs.readFileSync(CONFIG.ENCRYPTION_KEY_FILE);
}

function decryptTokenData(data, key) {
  const [ivHex, encryptedHex] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptData(data, passphrase) {
  const salt = crypto.randomBytes(16);
  const nonce = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, nonce, ciphertext, tag]);
}

// HTTP request
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : require('http');
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Refresh token
async function refreshAccessToken(refreshToken) {
  const postData = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  }).toString();
  return request(CONFIG.ESI_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: postData
  });
}

// ESI helpers
async function esiGet(endpoint, token) {
  await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
  return request(`${CONFIG.ESI_BASE}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
}

async function esiGetPages(endpoint, token) {
  const results = [];
  for (let page = 1; page <= CONFIG.MAX_PAGES; page++) {
    await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
    try {
      const data = await request(`${CONFIG.ESI_BASE}${endpoint}?page=${page}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!Array.isArray(data) || data.length === 0) break;
      results.push(...data);
      if (data.length < 1000) break;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('403')) break;
      console.warn(`  Page ${page} error:`, e.message.substring(0, 100));
      break;
    }
  }
  return results;
}

// Resolve type info (with caching)
async function resolveTypes(typeIds, token) {
  const cache = loadCache('types');
  const now = Date.now();
  const resolved = {};
  const needed = [];

  for (const id of [...new Set(typeIds)]) {
    if (cache[id] && cache[id]._cachedAt && (now - cache[id]._cachedAt) < CONFIG.CACHE_TTL) {
      resolved[id] = cache[id];
    } else {
      needed.push(id);
    }
  }

  // Resolve in batches
  for (let i = 0; i < needed.length; i++) {
    const id = needed[i];
    try {
      await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
      const typeData = await request(`${CONFIG.ESI_BASE}/universe/types/${id}/`);
      
      // Get group info
      let groupName = 'Unknown';
      let categoryName = 'Unknown';
      try {
        await new Promise(r => setTimeout(r, 50));
        const groupData = await request(`${CONFIG.ESI_BASE}/universe/groups/${typeData.group_id}/`);
        groupName = groupData.name || 'Unknown';
        
        await new Promise(r => setTimeout(r, 50));
        const catData = await request(`${CONFIG.ESI_BASE}/universe/categories/${groupData.category_id}/`);
        categoryName = catData.name || 'Unknown';
      } catch (e) {
        // Group/category resolution is best-effort
      }
      
      resolved[id] = {
        name: typeData.name || `Type ${id}`,
        group: groupName,
        category: categoryName,
        volume: typeData.volume || 0,
        tech: typeData.meta_group_id === 2 ? 'Tech II' :
              typeData.meta_group_id === 3 ? 'Faction' :
              typeData.meta_group_id === 4 ? 'Storyline' :
              typeData.meta_group_id === 5 ? 'Officer' :
              typeData.meta_group_id === 6 ? 'Deadspace' : 'Tech I',
        _cachedAt: now
      };
      cache[id] = resolved[id];
      
      if (i % 100 === 0 && i > 0) {
        console.log(`    Resolved ${i}/${needed.length} types...`);
      }
    } catch (e) {
      console.warn(`    Could not resolve type ${id}:`, e.message.substring(0, 80));
      resolved[id] = { name: `Type ${id}`, group: 'Unknown', category: 'Unknown', volume: 0, tech: 'Tech I', _cachedAt: now };
      cache[id] = resolved[id];
    }
  }
  
  saveCache('types', cache);
  return resolved;
}

// Resolve location info
async function resolveLocations(locationIds, token) {
  const cache = loadCache('locations');
  const resolved = {};
  const needed = [...new Set(locationIds)].filter(id => id && id > 0 && !cache[id]);

  for (const id of needed) {
    try {
      // Try station first
      await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
      const station = await request(`${CONFIG.ESI_BASE}/universe/stations/${id}/`);
      
      // Get system info
      let systemName = 'Unknown';
      let sec = 0;
      try {
        await new Promise(r => setTimeout(r, 50));
        const sys = await request(`${CONFIG.ESI_BASE}/universe/systems/${station.system_id}/`);
        systemName = sys.name || 'Unknown';
        sec = sys.security_status || 0;
      } catch {}
      
      resolved[id] = {
        name: station.name || `Station ${id}`,
        system: systemName,
        security: sec,
        type: 'station'
      };
      cache[id] = resolved[id];
    } catch {
      // Try structure
      try {
        await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
        const struct = await request(`${CONFIG.ESI_BASE}/universe/structures/${id}/`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        let systemName = 'Unknown';
        let sec = 0;
        try {
          await new Promise(r => setTimeout(r, 50));
          const sys = await request(`${CONFIG.ESI_BASE}/universe/systems/${struct.solar_system_id}/`);
          systemName = sys.name || 'Unknown';
          sec = sys.security_status || 0;
        } catch {}
        
        resolved[id] = {
          name: struct.name || `Structure ${id}`,
          system: systemName,
          security: sec,
          type: 'structure'
        };
        cache[id] = resolved[id];
      } catch {
        // Try system (for space items)
        try {
          await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
          const sys = await request(`${CONFIG.ESI_BASE}/universe/systems/${id}/`);
          resolved[id] = {
            name: sys.name || `System ${id}`,
            system: sys.name || 'Unknown',
            security: sys.security_status || 0,
            type: 'system'
          };
          cache[id] = resolved[id];
        } catch {
          resolved[id] = { name: `Location ${id}`, system: 'Unknown', security: 0, type: 'unknown' };
          cache[id] = resolved[id];
        }
      }
    }
  }
  
  // Fill from cache
  for (const id of [...new Set(locationIds)]) {
    if (cache[id] && !resolved[id]) resolved[id] = cache[id];
  }
  
  saveCache('locations', cache);
  return resolved;
}

// Fetch market prices
async function fetchMarketPrices(typeIds) {
  const cache = loadCache('market-prices');
  const now = Date.now();
  
  // If cache is fresh (under 1 hour), use it
  if (cache._timestamp && (now - cache._timestamp) < 60 * 60 * 1000) {
    console.log('  Using cached market prices');
    return cache;
  }
  
  console.log('  Fetching market prices from ESI...');
  const prices = {};
  try {
    let page = 1;
    while (page <= 20) {
      await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY));
      const batch = await request(`${CONFIG.ESI_BASE}/markets/prices/?page=${page}`);
      if (!batch.length) break;
      batch.forEach(p => {
        prices[p.type_id] = {
          adjusted: p.adjusted_price || 0,
          average: p.average_price || 0
        };
      });
      if (batch.length < 1000) break;
      page++;
    }
    console.log(`    Fetched ${Object.keys(prices).length} market prices`);
  } catch (e) {
    console.warn('    Market price fetch failed:', e.message);
  }
  
  prices._timestamp = now;
  saveCache('market-prices', prices);
  return prices;
}

// Load and refresh tokens
async function loadAndRefreshTokens() {
  const key = getTokenKey();
  const encrypted = fs.readFileSync(CONFIG.TOKEN_FILE, 'utf8');
  const tokens = JSON.parse(decryptTokenData(encrypted, key));
  
  const active = [];
  for (const [charId, tokenData] of Object.entries(tokens)) {
    try {
      const refreshed = await refreshAccessToken(tokenData.refreshToken);
      tokenData.refreshToken = refreshed.refresh_token || tokenData.refreshToken;
      tokenData.accessToken = refreshed.access_token;
      tokenData.expiresAt = Date.now() + (refreshed.expires_in * 1000);
      active.push(tokenData);
    } catch (e) {
      console.error(`  ❌ ${tokenData.characterName}: refresh failed - ${e.message}`);
    }
  }
  
  // Save updated
  const newIv = crypto.randomBytes(16);
  const newCipher = crypto.createCipheriv('aes-256-cbc', key, newIv);
  const newEncrypted = newIv.toString('hex') + ':' + Buffer.concat([
    newCipher.update(JSON.stringify(tokens, null, 2), 'utf8'),
    newCipher.final()
  ]).toString('hex');
  fs.writeFileSync(CONFIG.TOKEN_FILE, newEncrypted, { mode: 0o600 });
  
  return active;
}

// Pull corp data
async function pullCorpAssets(tokenData) {
  const { accessToken, characterName, corporationId } = tokenData;
  if (!corporationId) {
    console.warn(`  No corp ID for ${characterName}`);
    return { assets: [], wallets: [] };
  }
  
  console.log(`  Pulling assets for corp ${corporationId}...`);
  const assets = await esiGetPages(`/corporations/${corporationId}/assets/`, accessToken);
  console.log(`    ${assets.length} assets`);
  
  let wallets = [];
  try {
    wallets = await esiGet(`/corporations/${corporationId}/wallets/`, accessToken);
    console.log(`    ${wallets.length} wallet divisions`);
  } catch (e) {
    console.warn(`    Wallet error: ${e.message.substring(0, 80)}`);
  }
  
  return { assets, wallets, corporationId, characterName };
}

// Build aggregate with resolved names
async function buildAggregateData(allCorpData, accessToken) {
  const locations = {};
  const systems = {};
  let totalIsk = 0;
  let totalItems = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  
  // Collect IDs
  const allTypeIds = [];
  const allLocationIds = [];
  
  for (const corpData of allCorpData) {
    for (const asset of corpData.assets) {
      allTypeIds.push(asset.type_id);
      allLocationIds.push(asset.location_id);
    }
  }
  
  // Resolve names
  console.log('\n3. Resolving type names...');
  const typeInfo = await resolveTypes(allTypeIds, accessToken);
  
  console.log('4. Resolving locations...');
  const locationInfo = await resolveLocations(allLocationIds, accessToken);
  
  console.log('5. Fetching market prices...');
  const marketPrices = await fetchMarketPrices(allTypeIds);
  
  // Build locations
  console.log('6. Building aggregate...');
  for (const corpData of allCorpData) {
    for (const asset of corpData.assets) {
      const locId = asset.location_id;
      const typeId = asset.type_id;
      const t = typeInfo[typeId] || { name: `Type ${typeId}`, group: 'Unknown', category: 'Unknown', volume: 0, tech: 'Tech I' };
      const loc = locationInfo[locId] || { name: `Location ${locId}`, system: 'Unknown', security: 0 };
      
      // Use location name as key
      const locKey = loc.name;
      
      if (!locations[locKey]) {
        locations[locKey] = {
          name: loc.name,
          system: loc.system,
          constellation: 'Unknown',
          region: 'Unknown',
          security: loc.security,
          items: [],
          totalValue: 0,
          totalCount: 0
        };
      }
      
      const count = asset.quantity || 1;
      const mp = marketPrices[typeId];
      const unitValue = mp ? (mp.adjusted || mp.average || 0) : 0;
      const totalValue = unitValue * count;
      
      if (unitValue > 0) pricedCount++; else unpricedCount++;
      
      locations[locKey].items.push({
        name: t.name,
        group: t.group,
        category: t.category,
        count,
        value: unitValue,
        totalValue,
        container: asset.location_flag || '',
        tech: t.tech,
        typeId
      });
      
      locations[locKey].totalValue += totalValue;
      locations[locKey].totalCount += count;
      totalItems += count;
    }
    
    for (const wallet of corpData.wallets || []) {
      totalIsk += wallet.balance || 0;
    }
  }
  
  // Sort
  const sortedLocations = Object.values(locations).sort((a, b) => b.totalValue - a.totalValue);
  
  // Group by system for map view
  for (const loc of sortedLocations) {
    if (!systems[loc.system]) {
      systems[loc.system] = {
        name: loc.system,
        region: loc.region,
        security: loc.security,
        locations: [],
        totalValue: 0,
        totalCount: 0
      };
    }
    systems[loc.system].locations.push(loc.name);
    systems[loc.system].totalValue += loc.totalValue;
    systems[loc.system].totalCount += loc.totalCount;
  }
  
  const sortedSystems = Object.values(systems).sort((a, b) => b.totalValue - a.totalValue);
  
  // Security coloring
  for (const loc of sortedLocations) {
    const sec = loc.security;
    loc.securityColor = sec >= 0.5 ? 'green' : sec >= 0.1 ? 'yellow' : sec > 0 ? 'red' : 'orange';
    loc.securityHex = sec >= 0.5 ? '#2ecc71' : sec >= 0.1 ? '#f1c40f' : sec > 0 ? '#e74c3c' : '#e67e22';
  }
  for (const sys of sortedSystems) {
    const sec = sys.security;
    sys.securityColor = sec >= 0.5 ? 'green' : sec >= 0.1 ? 'yellow' : sec > 0 ? 'red' : 'orange';
    sys.securityHex = sec >= 0.5 ? '#2ecc71' : sec >= 0.1 ? '#f1c40f' : sec > 0 ? '#e74c3c' : '#e67e22';
  }
  
  return {
    summary: {
      totalLocations: sortedLocations.length,
      totalSystems: sortedSystems.length,
      totalIsk,
      totalItems,
      pricing: {
        source: 'ESI Live Data (Market Prices)',
        pricedItems: pricedCount,
        unpricedItems: unpricedCount,
        pricedAt: new Date().toISOString()
      }
    },
    locations: sortedLocations.map(loc => ({
      ...loc,
      itemCount: loc.items.length,
      items: loc.items.sort((a, b) => b.totalValue - a.totalValue)
    })),
    systems: sortedSystems
  };
}

// Push to GitHub
async function pushToGitHub(encryptedData) {
  const b64 = encryptedData.toString('base64');
  const currentFile = await request(
    `${CONFIG.GITHUB_API}/repos/${REPO}/contents/data.enc`,
    { headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'kybernauts-assets' } }
  ).catch(() => null);
  
  await request(
    `${CONFIG.GITHUB_API}/repos/${REPO}/contents/data.enc`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'kybernauts-assets'
      },
      body: JSON.stringify({
        message: `Sync: ESI live data ${new Date().toISOString()}`,
        content: b64,
        sha: currentFile?.sha
      })
    }
  );
  console.log('✅ Pushed to GitHub');
}

// Main
async function main() {
  console.log('=== Kybernauts ESI Sync (Full Resolution) ===');
  console.log('Time:', new Date().toISOString());
  
  console.log('\n1. Loading tokens...');
  const tokens = await loadAndRefreshTokens();
  console.log(`   Active: ${tokens.length}`);
  if (!tokens.length) { console.error('No tokens. Run esi-auth.js first.'); process.exit(1); }
  
  // Use first token for public ESI calls (type/location resolution)
  const publicToken = tokens[0].accessToken;
  
  console.log('\n2. Pulling corp data...');
  const allCorpData = [];
  for (const token of tokens) {
    try { allCorpData.push(await pullCorpAssets(token)); }
    catch (e) { console.error(`  Failed ${token.characterName}:`, e.message); }
  }
  
  // Build with resolution
  const data = await buildAggregateData(allCorpData, publicToken);
  
  console.log('\n7. Encrypting...');
  const encrypted = encryptData(JSON.stringify(data), ENCRYPT_PASSPHRASE);
  
  console.log('8. Pushing to GitHub...');
  await pushToGitHub(encrypted);
  
  console.log('\n=== Sync Complete ===');
  console.log('Locations:', data.summary.totalLocations);
  console.log('Systems:', data.summary.totalSystems);
  console.log('Total ISK:', data.summary.totalIsk.toLocaleString());
  console.log('Total Items:', data.summary.totalItems.toLocaleString());
  console.log('Priced:', data.summary.pricing.pricedItems);
  console.log('Unpriced:', data.summary.pricing.unpricedItems);
}

main().catch(e => { console.error('Sync failed:', e); process.exit(1); });
