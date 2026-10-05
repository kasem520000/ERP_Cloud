import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, '.generated-types.json');
const payload = {
  generatedAt: new Date().toISOString(),
  phase: 'PHASE_01',
  message: 'Type generation hook for bootstrap; no generated API types yet.',
};

fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Generated ${file}`);
