import fs from 'node:fs';
import path from 'node:path';

const mode = (process.argv[2] || '').toLowerCase();
const inputPath = process.argv[3] || path.join('dist', 'minecraft-server-dashboard', 'stats.json');

if (!['initial', 'lazy'].includes(mode)) {
  console.error('Usage: node ./scripts/bundle-filter.mjs <initial|lazy> [statsPath]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Stats file not found: ${inputPath}`);
  process.exit(1);
}

const stats = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const chunks = stats.chunks || [];
const keepInitial = mode === 'initial';
const selectedChunks = chunks.filter((c) => (c.initial === true) === keepInitial);

const selectedAssetNames = new Set();
for (const chunk of selectedChunks) {
  for (const file of chunk.files || []) {
    selectedAssetNames.add(file);
  }
}

const selectedAssets = (stats.assets || []).filter((a) => selectedAssetNames.has(a.name));

const filtered = {
  ...stats,
  chunks: selectedChunks,
  assets: selectedAssets,
};

const outPath = inputPath.replace(/\.json$/i, `.${mode}.json`);
fs.writeFileSync(outPath, JSON.stringify(filtered));

console.log(`Wrote ${mode} stats to ${outPath}`);
