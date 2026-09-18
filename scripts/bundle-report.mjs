import fs from 'node:fs';
import path from 'node:path';

// The Angular `application` (esbuild) builder emits an esbuild METAFILE
// (`{ inputs, outputs }`) as stats.json — not the old webpack `{ chunks, assets }`
// shape. This report walks the metafile: it marks the initial set by following
// only eager (import-statement) edges from the entry, then attributes bytes to
// source packages so you can see what actually ships on first load.
//
// Usage: node scripts/bundle-report.mjs [path/to/stats.json]
// (Produce stats.json with:  npx ng build --stats-json --configuration production)

const DEFAULT_STATS_PATH = path.join('dist', 'minecraft-server-dashboard', 'stats.json');
const statsPath = process.argv[2] ?? DEFAULT_STATS_PATH;

if (!fs.existsSync(statsPath)) {
  console.error(`Stats file not found: ${statsPath}`);
  console.error('Run:  npx ng build --stats-json --configuration production');
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
if (!meta.outputs) {
  console.error('Unexpected stats format: no "outputs" key (expected an esbuild metafile).');
  process.exit(1);
}

const outputs = meta.outputs;
const base = (p) => p.split('/').pop();
const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;
const byBase = new Map(Object.keys(outputs).map((k) => [base(k), k]));

// Entry = the browser main bundle.
const entryKey =
  Object.keys(outputs).find((k) => outputs[k].entryPoint === 'src/main.ts') ??
  Object.keys(outputs).find((k) => outputs[k].entryPoint);

// Initial set = BFS from the entry over eager (import-statement) edges only.
const initial = new Set();
const stack = [entryKey];
while (stack.length) {
  const cur = stack.pop();
  if (!cur || initial.has(cur)) continue;
  initial.add(cur);
  for (const imp of outputs[cur].imports || []) {
    if (imp.kind === 'import-statement') {
      const target = outputs[imp.path] ? imp.path : byBase.get(base(imp.path));
      if (target) stack.push(target);
    }
  }
}

function bucket(inputPath) {
  if (inputPath.includes('node_modules/')) {
    const m = inputPath.split('node_modules/').pop();
    const scoped = m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0];
    if (/^(@firebase\/auth|firebase\/auth)/.test(m)) return 'firebase/auth';
    if (/^(@firebase\/firestore|firebase\/firestore)/.test(m)) return 'firebase/firestore';
    if (/^(@firebase\/app|firebase\/app)/.test(m)) return 'firebase/app';
    if (/^(@firebase|firebase)/.test(m)) return 'firebase/other';
    return scoped;
  }
  if (inputPath.startsWith('src/')) return 'app-src';
  return 'other';
}

function jsOutputs(keys) {
  return [...keys].filter((k) => k.endsWith('.js')).sort((a, b) => outputs[b].bytes - outputs[a].bytes);
}

const initialJs = jsOutputs(initial);
const lazyJs = jsOutputs(Object.keys(outputs).filter((k) => !initial.has(k)));

const sumBytes = (keys) => keys.reduce((acc, k) => acc + outputs[k].bytes, 0);
const packageTotals = (keys) => {
  const totals = {};
  for (const k of keys) {
    for (const [ip, info] of Object.entries(outputs[k].inputs)) {
      const b = bucket(ip);
      totals[b] = (totals[b] || 0) + info.bytesInOutput;
    }
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
};

console.log(`Stats: ${statsPath}`);
console.log(`Entry: ${base(entryKey)}  (${outputs[entryKey].entryPoint})`);
console.log(`\nNote: sizes are RAW (uncompressed) bytes; gzip transfer is typically ~4x smaller.`);

console.log('\n=== INITIAL LOAD (eager from entry) ===');
for (const k of initialJs) {
  console.log(`  ${base(k).padEnd(24)} ${kib(outputs[k].bytes)}`);
}
console.log(`  ${'TOTAL'.padEnd(24)} ${kib(sumBytes(initialJs))}`);

console.log('\n=== INITIAL LOAD BY PACKAGE ===');
for (const [name, bytes] of packageTotals(initialJs)) {
  if (bytes < 1024) continue;
  console.log(`  ${kib(bytes).padStart(11)}  ${name}`);
}

console.log('\n=== TOP LAZY CHUNKS ===');
for (const k of lazyJs.slice(0, 12)) {
  const top = packageTotals([k]).filter(([, b]) => b > 1024).slice(0, 2).map(([n, b]) => `${n} ${kib(b)}`).join(', ');
  console.log(`  ${base(k).padEnd(24)} ${kib(outputs[k].bytes).padStart(11)}   ${top}`);
}
console.log(`\nLazy total: ${kib(sumBytes(lazyJs))}`);
