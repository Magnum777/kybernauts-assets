const fs = require('fs');
const csvPath = 'C:\\Users\\compj\\.openclaw\\media\\inbound\\assets_export---f337e2b9-b336-4391-adb0-30711d8d02bc.csv';
const outDir = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer';

function parseNum(s) {
  if (!s || s === 'None' || s === '') return 0;
  const cleaned = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ';' && !inQuotes) { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split(/\r?\n/);
const header = parseCsvLine(lines[0]);
const idx = {};
header.forEach((h, i) => idx[h] = i);

const allowedOwners = ['Kybernauts', 'Ohnivak of Kybernauts'];
const locations = {};
const systems = {};
let totalIsk = 0;
let totalItems = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseCsvLine(line);
  if (cols.length < 30) continue;

  const owner = cols[idx['Owner']] || '';
  if (!allowedOwners.includes(owner)) continue;

  const name = cols[idx['Name']] || '';
  const group = cols[idx['Group']] || '';
  const category = cols[idx['Category']] || '';
  const location = cols[idx['Location']] || '';
  const securityStr = cols[idx['Security']] || '0,00';
  const system = cols[idx['System']] || '';
  const constellation = cols[idx['Constellation']] || '';
  const region = cols[idx['Region']] || '';
  const container = cols[idx['Container']] || '';
  const count = parseNum(cols[idx['Count']]);
  const unitValue = parseNum(cols[idx['Value']]);
  const itemValue = unitValue * count;
  const tech = cols[idx['Tech']] || 'Tech I';

  if (!location) continue;

  if (!locations[location]) {
    locations[location] = {
      name: location,
      system: system,
      constellation: constellation,
      region: region,
      security: parseNum(securityStr),
      items: [],
      totalValue: 0,
      totalCount: 0
    };
  }

  locations[location].items.push({
    name, group, category, count, value: unitValue, totalValue: itemValue, container: container || '', tech
  });
  locations[location].totalValue += itemValue;
  locations[location].totalCount += count;
  totalIsk += itemValue;
  totalItems += count;

  if (!systems[system]) {
    systems[system] = {
      name: system, region: region, security: parseNum(securityStr),
      locations: [], totalValue: 0, totalCount: 0
    };
  }
  if (!systems[system].locations.includes(location)) systems[system].locations.push(location);
  systems[system].totalValue += itemValue;
  systems[system].totalCount += count;
}

function securityColor(sec) {
  if (sec >= 0.5) return 'green';
  if (sec >= 0.1) return 'yellow';
  if (sec > 0) return 'red';
  return 'orange';
}
function securityHex(sec) {
  if (sec >= 0.5) return '#2ecc71';
  if (sec >= 0.1) return '#f1c40f';
  if (sec > 0) return '#e74c3c';
  return '#e67e22';
}

const sortedLocations = Object.values(locations).sort((a, b) => b.totalValue - a.totalValue);
const sortedSystems = Object.values(systems).sort((a, b) => b.totalValue - a.totalValue);

const data = {
  summary: {
    totalLocations: Object.keys(locations).length,
    totalSystems: Object.keys(systems).length,
    totalIsk,
    totalItems,
    owners: allowedOwners
  },
  locations: sortedLocations.map(loc => ({
    name: loc.name, system: loc.system, constellation: loc.constellation, region: loc.region,
    security: loc.security, securityColor: securityColor(loc.security), securityHex: securityHex(loc.security),
    totalValue: loc.totalValue, totalCount: loc.totalCount, itemCount: loc.items.length,
    items: loc.items.sort((a, b) => b.totalValue - a.totalValue)
  })),
  systems: sortedSystems.map(sys => ({
    name: sys.name, region: sys.region, security: sys.security,
    securityColor: securityColor(sys.security), securityHex: securityHex(sys.security),
    locationCount: sys.locations.length, totalValue: sys.totalValue, totalCount: sys.totalCount
  }))
};

fs.writeFileSync(`${outDir}/data.json`, JSON.stringify(data, null, 2));
console.log(`Filtered to ${allowedOwners.join(' + ')}`);
console.log(`Locations: ${data.summary.totalLocations}, Systems: ${data.summary.totalSystems}`);
console.log(`Total ISK: ${totalIsk.toLocaleString('en-US', {maximumFractionDigits: 2})}`);
console.log(`Total items: ${totalItems.toLocaleString()}`);
