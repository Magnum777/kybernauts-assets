const fs = require('fs');
const https = require('https');

const typeIds = JSON.parse(fs.readFileSync('assets-viewer/type-ids.json', 'utf-8'));
const outFile = 'assets-viewer/market-prices.json';

// Helper: fetch JSON via HTTPS
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('JSON parse fail: ' + e.message)); }
      });
    }).on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function main() {
  const prices = {};

  // Strategy 1: Try Fuzzwork station aggregate for Jita CNAP
  console.log('Fetching Fuzzwork Jita CNAP market data...');
  try {
    const fuzzUrl = 'https://market.fuzzwork.co.uk/aggregates/?station=60003760';
    const fuzzData = await fetchJson(fuzzUrl);
    // fuzzData is {typeID: {sell: {...}, buy: {...}, ...}, ...}
    let matched = 0;
    for (const tid of typeIds) {
      const t = fuzzData[tid];
      if (t && t.sell && t.sell.min) {
        prices[tid] = {
          sell: parseFloat(t.sell.min),
          buy: t.buy && t.buy.max ? parseFloat(t.buy.max) : 0,
          mid: t.sell.min && t.buy.max ? (parseFloat(t.sell.min) + parseFloat(t.buy.max)) / 2 : parseFloat(t.sell.min),
          volume: t.sell.volume || 0
        };
        matched++;
      }
    }
    console.log(`Fuzzwork matched ${matched}/${typeIds.length} types`);
  } catch (e) {
    console.log('Fuzzwork failed:', e.message);
  }

  // Strategy 2: Fill gaps with ESI markets/prices (universe-wide averages)
  const missing = typeIds.filter(tid => !prices[tid]);
  if (missing.length > 0) {
    console.log(`Filling ${missing.length} missing prices from ESI averages...`);
    try {
      // ESI markets/prices is paginated, but we can fetch all pages
      let page = 1;
      let esiPrices = [];
      while (true) {
        const url = `https://esi.evetech.net/latest/markets/prices/?datasource=tranquility&page=${page}`;
        const batch = await fetchJson(url);
        if (!batch.length) break;
        esiPrices = esiPrices.concat(batch);
        if (batch.length < 1000) break;
        page++;
        if (page > 20) break; // safety
      }
      console.log(`Fetched ${esiPrices.length} ESI price entries`);
      const esiMap = {};
      esiPrices.forEach(p => { esiMap[p.type_id] = p.average_price || p.adjusted_price || 0; });
      for (const tid of missing) {
        if (esiMap[tid]) {
          prices[tid] = { sell: esiMap[tid], buy: esiMap[tid] * 0.8, mid: esiMap[tid], volume: 0 };
        } else {
          prices[tid] = { sell: 0, buy: 0, mid: 0, volume: 0 };
        }
      }
    } catch (e) {
      console.log('ESI fallback failed:', e.message);
      for (const tid of missing) prices[tid] = { sell: 0, buy: 0, mid: 0, volume: 0 };
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(prices, null, 2));
  console.log(`Wrote ${Object.keys(prices).length} market prices to ${outFile}`);
}

main().catch(console.error);
