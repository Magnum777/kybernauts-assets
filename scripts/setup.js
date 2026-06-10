#!/usr/bin/env node
/**
 * Quick setup script for Kybernauts ESI assets sync
 * 
 * Usage:
 *   node setup.js
 * 
 * This will:
 *   1. Check prerequisites (Node.js version)
 *   2. Create .env template
 *   3. Guide you through ESI auth for each Director alt
 *   4. Test the sync
 *   5. Set up cron job
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function log(msg, color = '') {
  console.log(color + msg + RESET);
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0]);
  if (major < 18) {
    log(`Node.js ${version} detected. Need v18+ for native fetch support.`, RED);
    process.exit(1);
  }
  log(`✅ Node.js ${version}`, GREEN);
}

function createEnvTemplate() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    log('✅ .env already exists', GREEN);
    return;
  }
  
  const template = `# Kybernauts ESI Assets Sync
# Fill these in with your values from https://developers.eveonline.com/

# ESI Application Credentials
ESI_CLIENT_ID=eat_your_client_id_here
ESI_CLIENT_SECRET=eat_your_client_secret_here

# GitHub Personal Access Token (repo scope)
GITHUB_TOKEN=ghp_your_github_token_here

# GitHub repo to push to
REPO=Magnum777/kybernauts-assets

# Passphrase for encrypting data.enc (same as your vault passphrase)
ENCRYPT_PASSPHRASE=your_55_char_passphrase_here
`;
  
  fs.writeFileSync(envPath, template);
  log('✅ Created .env template — edit it with your credentials', YELLOW);
}

function checkEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    log('❌ .env not found. Run setup first.', RED);
    return false;
  }
  
  const env = fs.readFileSync(envPath, 'utf8');
  const required = ['ESI_CLIENT_ID', 'ESI_CLIENT_SECRET', 'GITHUB_TOKEN', 'ENCRYPT_PASSPHRASE'];
  const missing = required.filter(k => !env.includes(k + '=') || env.includes(k + '=_here') || env.includes(k + '=eat_') || env.includes(k + '=ghp_') || env.includes(k + '=your_'));
  
  if (missing.length > 0) {
    log(`❌ Missing values in .env: ${missing.join(', ')}`, RED);
    return false;
  }
  
  log('✅ .env configured', GREEN);
  return true;
}

function main() {
  console.log('\n' + '='.repeat(60));
  log('  Kybernauts ESI Assets Sync — Setup', GREEN);
  console.log('='.repeat(60) + '\n');
  
  checkNodeVersion();
  createEnvTemplate();
  
  if (!checkEnv()) {
    console.log('\n' + '-'.repeat(60));
    log('Next steps:', YELLOW);
    log('1. Edit .env with your ESI credentials, GitHub token, and passphrase', YELLOW);
    log('2. Run: node setup.js', YELLOW);
    log('3. Then run: node esi-auth.js to capture Director tokens', YELLOW);
    console.log('-'.repeat(60) + '\n');
    process.exit(0);
  }
  
  console.log('\n' + '-'.repeat(60));
  log('All checks passed!', GREEN);
  console.log('-'.repeat(60));
  log('\nNext:', YELLOW);
  log('  node esi-auth.js    → Log in each Director alt via EVE SSO', YELLOW);
  log('  node esi-sync.js    → Test pulling live data from ESI', YELLOW);
  console.log('\n');
}

main();
