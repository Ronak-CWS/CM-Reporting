import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basePath } from '../lib/app-path.js';
import { reportEmailsEnabled } from '../lib/smtp-config.js';

// Runs for npm start AND for NSSM's direct Node entry point. Loads the private
// environment and validates storage, the catalogue and authentication first.
await import('./check-server.mjs');
if (process.exitCode) process.exit(process.exitCode);

try {
  const build = JSON.parse(await readFile('.next/required-server-files.json', 'utf8'));
  if (build.config.basePath !== basePath()) throw new Error('NEXT_PUBLIC_BASE_PATH differs from the production build. Rebuild with the intended path.');
  const port = Number(process.env.CM_PORT || 3013);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CM_PORT must be a port from 1024 to 65535.');
  const children = new Set();
  let stopping = false;
  function stop(code, signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    for (const child of children) child.kill(signal);
  }
  function launch(args, name) {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
    children.add(child);
    child.on('error', () => { console.error(`${name} could not start.`); stop(1); });
    child.on('exit', (code) => {
      children.delete(child);
      if (!stopping) { console.error(`${name} exited; stopping the service so its manager can restart it.`); stop(code || 1); }
    });
  }
  launch([fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    'start', '--hostname', '127.0.0.1', '--port', String(port)], 'Reporting server');
  if (reportEmailsEnabled()) launch(['scripts/email-worker.mjs'], 'Email worker');
  process.on('SIGINT', () => stop(0, 'SIGINT'));
  process.on('SIGTERM', () => stop(0));
} catch (error) {
  console.error(`Server startup failed: ${error.message}`);
  process.exitCode = 1;
}
