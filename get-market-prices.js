const fs = require('fs');
const csvPath = 'C:\\Users\\compj\\.openclaw\\media\\inbound\\assets_export---f337e2b9-b336-4391-adb0-30711d8d02bc.csv';

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
const uniqueTypes = new Set();
let totalRows = 0;

for (let i = 1; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const cols = parseCsvLine(lines[i]);
  if (cols.length < 30) continue;
  if (!allowedOwners.includes(cols[idx['Owner']])) continue;
  const typeId = cols[idx['Type ID']];
  if (typeId && typeId !== '0') uniqueTypes.add(typeId);
  totalRows++;
}

console.log('Unique Type IDs for filtered owners:', uniqueTypes.size);
console.log('Total rows filtered:', totalRows);
fs.writeFileSync('assets-viewer/type-ids.json', JSON.stringify([...uniqueTypes]));
