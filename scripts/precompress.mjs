/**
 * Pre-compress the production build so nginx can serve the smallest possible
 * bytes with zero per-request CPU via `brotli_static` / `gzip_static`.
 *
 * For every compressible asset we emit a sibling `.br` (Brotli quality 11) and
 * `.gz` (gzip level 9) — both stronger than nginx's on-the-fly gzip level 6,
 * and computed once at build time instead of on every request. nginx serves
 * `foo.js.br`/`foo.js.gz` transparently when the client's Accept-Encoding
 * allows it, falling back to the raw file otherwise.
 *
 * Uses only Node's built-in `node:zlib` — no extra dependency.
 *
 * Usage: node scripts/precompress.mjs <dir>   (defaults to the prod build dir)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

// Match the asset types nginx already lists in gzip_types. Skip formats that
// are already compressed (woff2, png, images) and source maps (dev-only, big).
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.ico', '.txt', '.xml', '.webmanifest']);

// Mirror nginx `gzip_min_length 1024` — tiny files don't benefit and the
// compressed copy can be larger than the original.
const MIN_BYTES = 1024;

const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve('dist/minecraft-server-dashboard/browser');

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function compressFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!COMPRESSIBLE.has(ext)) return null;

  const raw = await fs.readFile(file);
  if (raw.length < MIN_BYTES) return null;

  const [br, gz] = await Promise.all([
    brotli(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY, // 11
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    gzip(raw, { level: 9 }),
  ]);

  // Only keep a variant when it actually shrinks the payload.
  const written = [];
  if (br.length < raw.length) {
    await fs.writeFile(`${file}.br`, br);
    written.push({ enc: 'br', size: br.length });
  }
  if (gz.length < raw.length) {
    await fs.writeFile(`${file}.gz`, gz);
    written.push({ enc: 'gz', size: gz.length });
  }
  return { file, raw: raw.length, written };
}

async function main() {
  try {
    await fs.access(targetDir);
  } catch {
    console.error(`[precompress] target dir not found: ${targetDir}`);
    process.exit(1);
  }

  const files = [];
  for await (const f of walk(targetDir)) files.push(f);

  const results = (await Promise.all(files.map(compressFile))).filter(Boolean).filter((r) => r.written.length);

  let rawTotal = 0;
  let brTotal = 0;
  let gzTotal = 0;
  for (const r of results) {
    rawTotal += r.raw;
    for (const w of r.written) {
      if (w.enc === 'br') brTotal += w.size;
      if (w.enc === 'gz') gzTotal += w.size;
    }
  }

  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`[precompress] ${results.length} files compressed under ${path.relative(process.cwd(), targetDir) || targetDir}`);
  console.log(`[precompress] raw ${kb(rawTotal)}  ->  br ${kb(brTotal)}  |  gz ${kb(gzTotal)}`);
}

main().catch((err) => {
  console.error('[precompress] failed:', err);
  process.exit(1);
});
