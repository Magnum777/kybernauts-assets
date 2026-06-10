# Kybernauts ESI Assets Sync

Live asset tracking for the Kybernauts alliance. Pulls corporation assets and wallet balances from EVE ESI, encrypts the data, and pushes to GitHub Pages.

## Architecture

```
Director Alt (EVE SSO) → Refresh Tokens → Synology NAS Cron → ESI API → Encrypt → GitHub Pages
```

- **esi-auth.js** — One-time auth capture. Each Director alt logs in via EVE SSO. Stores encrypted refresh tokens.
- **esi-sync.js** — Runs on NAS every 30 minutes. Refreshes tokens, pulls assets + wallets from ESI, encrypts, pushes to GitHub.
- **setup.js** — Quick setup wizard. Checks prerequisites, creates .env template.

## Files

| File | Purpose |
|------|---------|
| `esi-auth.js` | Capture EVE SSO refresh tokens from Director alts |
| `esi-sync.js` | Scheduled sync job (runs on NAS) |
| `setup.js` | Setup wizard |
| `.env` | Your credentials (created by setup, NEVER commit) |
| `tokens.json` | Encrypted refresh tokens (auto-created) |
| `.token-key` | Encryption key for tokens (auto-created) |

## Quick Start

### 1. Register ESI Application

1. Go to https://developers.eveonline.com/applications/create
2. Name: `KybernautsAssetsViewer`
3. Callback URLs:
   - `http://localhost:3000/callback`
   - `http://192.168.68.51:3000/callback`
4. Scopes: `esi-assets.read_corporation_assets.v1`, `esi-wallet.read_corporation_wallets.v1`, `esi-universe.read_structures.v1`, `esi-corporations.read_divisions.v1`, `esi-corporations.read_structures.v1`, `esi-characters.read_corporation_roles.v1`
5. Save the Client ID and Client Secret

### 2. Setup

```bash
node setup.js
```

This creates `.env`. Edit it with your credentials:

```env
ESI_CLIENT_ID=eat_xxx
ESI_CLIENT_SECRET=eat_xxx
GITHUB_TOKEN=ghp_xxx
REPO=Magnum777/kybernauts-assets
ENCRYPT_PASSPHRASE=your_55_char_passphrase_here
```

### 3. Capture Director Tokens

```bash
node esi-auth.js
```

This opens a browser to EVE SSO. Log in with each Director alt. Repeat for every corp in the alliance.

### 4. Test Sync

```bash
node esi-sync.js
```

### 5. Set Up Cron on NAS

Synology DSM → Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script

- Schedule: Every 30 minutes
- Command:
```bash
cd /volume1/docker/kybernauts-assets
node esi-sync.js >> sync.log 2>&1
```

## Security

- Refresh tokens are encrypted at rest with AES-256-CBC
- `.env` and `.token-key` are never committed to git (add to `.gitignore`)
- ESI tokens never leave your NAS
- Data pushed to GitHub is encrypted with your passphrase (same as the vault)

## Troubleshooting

**Token expired?**
Run `node esi-auth.js` again to re-authenticate.

**Rate limited?**
ESI rate limit is 20 req/sec. The sync script spaces requests with 100ms delays.

**Corp not showing?**
The character must have Director role in that corporation.

**Want to add a new corp?**
Get a Director alt in that corp, run `esi-auth.js`, log in. Done.
