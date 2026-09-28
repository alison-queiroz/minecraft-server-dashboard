/**
 * Cross-platform launcher for the project's Python virtualenv.
 *
 * npm scripts used to hard-code `.\.venv\Scripts\python.exe`, which only
 * resolves under Windows cmd — so the husky pre-push gate (`ci:quality`)
 * broke on Linux/macOS. This resolves the interpreter for the current OS and
 * forwards every argument, stdio, signal and the exit code.
 *
 * Usage:
 *   node scripts/venv-python.mjs <python args...>   run inside .venv
 *   node scripts/venv-python.mjs --create           create .venv if missing
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venvDir = path.join(root, '.venv');
const isWindows = process.platform === 'win32';

const venvCandidates = [
  path.join(venvDir, 'Scripts', 'python.exe'),
  path.join(venvDir, 'bin', 'python'),
];

function findVenvPython() {
  return venvCandidates.find((candidate) => existsSync(candidate)) ?? null;
}

function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => child.kill(signal));
  }

  child.on('error', (err) => {
    console.error(`[venv-python] failed to start ${command}: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

const args = process.argv.slice(2);

if (args[0] === '--create') {
  if (findVenvPython()) {
    console.log(
      `[venv-python] using existing virtualenv at ${path.relative(process.cwd(), venvDir) || venvDir}`,
    );
    process.exit(0);
  }
  run(isWindows ? 'python' : 'python3', ['-m', 'venv', venvDir]);
} else {
  const python = findVenvPython();
  if (!python) {
    console.error(
      '[venv-python] no virtualenv found at .venv — run `npm run backend:setup` first.',
    );
    process.exit(1);
  }
  run(python, args);
}
