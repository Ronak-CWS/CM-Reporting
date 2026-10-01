import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basePath } from '../lib/app-path.js';

// Runs for npm start AND for NSSM's direct Node entry point. Loads the private
// environment and validates storage, the catalogue and authentication first.
await import('./check-server.mjs');
if (process.exitCode) process.exit(process.exitCode);

try {
  const build = JSON.parse(await readFile('.next/required-server-files.json', 'utf8'));
  if (build.config.basePath !== basePath()) throw new Error('NEXT_PUBLIC_BASE_PATH differs from the production build. Rebuild with the intended path.');
  const port = Number(process.env.CM_PORT || 3013);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CM_PORT must be a port from 1024 to 65535.');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => { console.error(`Server could not start: ${error.message}`); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} catch (error) {
  console.error(`Server startup failed: ${error.message}`);
  process.exitCode = 1;
}
