import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_STATS_PATH = path.join('dist', 'minecraft-server-dashboard', 'stats.json');
const statsPath = process.argv[2] ?? DEFAULT_STATS_PATH;

function formatBytes(bytes) {
  const kb = bytes / 1024;
  return `${bytes.toLocaleString()} B (${kb.toFixed(1)} KiB)`;
}

function getChunkName(chunk) {
  if (Array.isArray(chunk.names) && chunk.names.length > 0) {
    return chunk.names.join(',');
  }
  return '(unnamed)';
}

function uniqueByFile(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.file, item);
  }
  return [...map.values()];
}

if (!fs.existsSync(statsPath)) {
  console.error(`Stats file not found: ${statsPath}`);
  console.error('Run an Angular production build that emits stats first.');
  process.exit(1);
}

const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
const assetsByName = new Map((stats.assets ?? []).map((a) => [a.name, a]));
const chunks = stats.chunks ?? [];

const initialChunks = chunks.filter((c) => c.initial === true);
const lazyChunks = chunks.filter((c) => c.initial !== true);

function collectAssetsForChunks(chunkList) {
  const rows = [];
  for (const chunk of chunkList) {
    for (const file of chunk.files ?? []) {
      const asset = assetsByName.get(file);
      if (!asset) continue;
      rows.push({
        chunk: getChunkName(chunk),
        file,
        size: asset.size ?? 0,
      });
    }
  }
  return uniqueByFile(rows).sort((a, b) => b.size - a.size);
}

const initialAssets = collectAssetsForChunks(initialChunks);
const lazyAssets = collectAssetsForChunks(lazyChunks);

const sum = (rows) => rows.reduce((acc, row) => acc + row.size, 0);
const initialTotal = sum(initialAssets);
const lazyTotal = sum(lazyAssets);
const allAssetTotal = sum(uniqueByFile([...initialAssets, ...lazyAssets]));

const topLazyChunks = lazyChunks
  .map((c) => ({
    name: getChunkName(c),
    size: c.size ?? 0,
    files: (c.files ?? []).join(','),
  }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 10);

console.log(`Stats: ${statsPath}`);
console.log('');
console.log('Initial load assets:');
for (const a of initialAssets) {
  console.log(`- ${a.file} [${a.chunk}] ${formatBytes(a.size)}`);
}

console.log('');
console.log(`Initial total: ${formatBytes(initialTotal)}`);
console.log(`Lazy total:    ${formatBytes(lazyTotal)}`);
console.log(`All assets:    ${formatBytes(allAssetTotal)}`);

console.log('');
console.log('Top lazy chunks (by webpack chunk size):');
for (const chunk of topLazyChunks) {
  console.log(`- ${chunk.name}: ${formatBytes(chunk.size)} (${chunk.files})`);
}
