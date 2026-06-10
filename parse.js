const fs = require('fs');
const path = require('path');

const csvPath = 'C:\\Users\\compj\\.openclaw\\media\\inbound\\assets_export---f337e2b9-b336-4391-adb0-30711d8d02bc.csv';
const outDir = 'C:\\Users\\compj\\.openclaw\\workspace\\assets-viewer';

// Parse European-style numbers: "1.234.567,89" -> 1234567.89
function parseNum(s) {
  if (!s || s === 'None' || s === '') return 0;
  // Remove dots used as thousand separators, replace comma decimal with period
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
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ';' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split(/\r?\n/);
const header = parseCsvLine(lines[0]);

const idx = {};
header.forEach((h, i) => {
  idx[h] = i;
});

// Verify key indices
const colName = idx['Name'];
const colGroup = idx['Group'];
const colCategory = idx['Category'];
const colLocation = idx['Location'];
const colSecurity = idx['Security'];
const colSystem = idx['System'];
const colConstellation = idx['Constellation'];
const colRegion = idx['Region'];
const colContainer = idx['Container'];
const colCount = idx['Count'];
const colValue = idx['Value'];

console.log('Columns:', { colName, colGroup, colCategory, colLocation, colSecurity, colSystem, colConstellation, colRegion, colContainer, colCount, colValue });

const locations = {}; // keyed by Location string
const systems = {};   // keyed by System name (for grouping on map)
let totalIsk = 0;
let totalItems = 0;
let totalLocations = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseCsvLine(line);
  if (cols.length < 30) continue;

  const name = cols[colName] || '';
  const group = cols[colGroup] || '';
  const category = cols[colCategory] || '';
  const location = cols[colLocation] || '';
  const securityStr = cols[colSecurity] || '0,00';
  const system = cols[colSystem] || '';
  const constellation = cols[colConstellation] || '';
  const region = cols[colRegion] || '';
  const container = cols[colContainer] || '';
  const count = parseNum(cols[colCount]);
  const unitValue = parseNum(cols[colValue]);
  const itemValue = unitValue * count;

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
    name,
    group,
    category,
    count,
    value: unitValue,
    totalValue: itemValue,
    container: container || ''
  });

  locations[location].totalValue += itemValue;
  locations[location].totalCount += count;
  totalIsk += itemValue;
  totalItems += count;

  // Also aggregate by system for map grouping
  if (!systems[system]) {
    systems[system] = {
      name: system,
      region: region,
      security: parseNum(securityStr),
      locations: [],
      totalValue: 0,
      totalCount: 0
    };
  }
  if (!systems[system].locations.includes(location)) {
    systems[system].locations.push(location);
  }
  systems[system].totalValue += itemValue;
  systems[system].totalCount += count;
}

totalLocations = Object.keys(locations).length;

// Sort locations by total value descending
const sortedLocations = Object.values(locations).sort((a, b) => b.totalValue - a.totalValue);

// Also sort systems
const sortedSystems = Object.values(systems).sort((a, b) => b.totalValue - a.totalValue);

// Security coloring helper
function securityColor(sec) {
  if (sec >= 0.5) return 'green';
  if (sec >= 0.1) return 'yellow';
  if (sec > 0) return 'red';
  return 'orange'; // 0.0 or null/Pochven
}

function securityHex(sec) {
  if (sec >= 0.5) return '#2ecc71';
  if (sec >= 0.1) return '#f1c40f';
  if (sec > 0) return '#e74c3c';
  return '#e67e22';
}

// Build data object
const data = {
  summary: {
    totalLocations,
    totalSystems: Object.keys(systems).length,
    totalIsk,
    totalItems
  },
  locations: sortedLocations.map(loc => ({
    name: loc.name,
    system: loc.system,
    constellation: loc.constellation,
    region: loc.region,
    security: loc.security,
    securityColor: securityColor(loc.security),
    securityHex: securityHex(loc.security),
    totalValue: loc.totalValue,
    totalCount: loc.totalCount,
    itemCount: loc.items.length,
    items: loc.items.sort((a, b) => b.totalValue - a.totalValue)
  })),
  systems: sortedSystems.map(sys => ({
    name: sys.name,
    region: sys.region,
    security: sys.security,
    securityColor: securityColor(sys.security),
    securityHex: securityHex(sys.security),
    locationCount: sys.locations.length,
    totalValue: sys.totalValue,
    totalCount: sys.totalCount
  }))
};

fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data, null, 2));
console.log(`Wrote data.json with ${data.locations.length} locations, ${data.systems.length} systems`);
console.log(`Total ISK: ${totalIsk.toLocaleString('en-US', {maximumFractionDigits: 2})}`);
console.log(`Total items: ${totalItems.toLocaleString('en-US')}`);
console.log(`Total locations: ${totalLocations}`);
