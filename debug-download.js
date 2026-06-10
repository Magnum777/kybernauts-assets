const https = require('https');
const fs = require('fs');

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Accept': '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  const url = 'https://magnum777.github.io/kybernauts-assets/data.enc';
  const localPath = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\data.enc';
  
  const remote = await download(url);
  const local = fs.readFileSync(localPath);
  
  console.log('Remote bytes:', remote.length);
  console.log('Local bytes:', local.length);
  console.log('Match:', remote.length === local.length);
  console.log('Headers:', remote.slice(0, 10).toString('hex'));
  console.log('Local  :', local.slice(0, 10).toString('hex'));
  
  if (remote.length !== local.length) {
    console.log('LENGTH MISMATCH!');
    fs.writeFileSync('C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer\\remote-download.enc', remote);
    console.log('Saved remote-download.enc for inspection');
  }
  
  // Also check first few bytes
  for (let i = 0; i < Math.min(remote.length, local.length, 20); i++) {
    if (remote[i] !== local[i]) {
      console.log(`Byte ${i}: remote=${remote[i]}, local=${local[i]}`);
      break;
    }
  }
  console.log('First 20 bytes match!');
}

main().catch(console.error);
