import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDirectory } from './storage-config';
import { FLOW_SECONDS, SESSION_SECONDS } from './auth-config';

export interface SignedInUser {
  tenantId: string;
  objectId: string;
  name: string;
  username: string;
}

export interface LoginFlow {
  state: string;
  nonce: string;
  verifier: string;
  policy: string;
  redirectUri: string;
}

const processAuth = globalThis as typeof globalThis & { cmAuthStore?: { directory: string; database: DatabaseSync } };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const validToken = (token: string) => /^[a-zA-Z0-9_-]{43}$/.test(token);

function database() {
  const directory = dataDirectory();
  if (processAuth.cmAuthStore?.directory !== directory) {
    closeAuthStore();
    mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(path.join(directory, 'auth.sqlite'));
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, policy TEXT NOT NULL, user_json TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS login_flows (
        token_hash TEXT PRIMARY KEY, state_hash TEXT NOT NULL, flow_json TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS login_flows_expiry ON login_flows(expires_at);
    `);
    processAuth.cmAuthStore = { directory, database: db };
  }
  return processAuth.cmAuthStore.database;
}

function removeExpired() {
  const db = database();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
  db.prepare('DELETE FROM login_flows WHERE expires_at <= ?').run(now());
}

export function saveLoginFlow(flow: LoginFlow) {
  removeExpired();
  const token = randomBytes(32).toString('base64url');
  database().prepare('INSERT INTO login_flows VALUES (?, ?, ?, ?)').run(hash(token), hash(flow.state), JSON.stringify(flow), now() + FLOW_SECONDS);
  return token;
}

export function consumeLoginFlow(token: string, state: string): LoginFlow | null {
  if (!validToken(token) || !validToken(state)) return null;
  // DELETE RETURNING consumes the browser-bound transaction atomically, including across Node workers.
  const row = database().prepare('DELETE FROM login_flows WHERE token_hash = ? AND state_hash = ? AND expires_at > ? RETURNING flow_json')
    .get(hash(token), hash(state), now()) as { flow_json: string } | undefined;
  return row ? JSON.parse(row.flow_json) as LoginFlow : null;
}

export function deleteLoginFlow(token: string) {
  if (validToken(token)) database().prepare('DELETE FROM login_flows WHERE token_hash = ?').run(hash(token));
}

export function createSession(user: SignedInUser, policy: string) {
  removeExpired();
  const token = randomBytes(32).toString('base64url');
  database().prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run(hash(token), policy, JSON.stringify(user), now() + SESSION_SECONDS);
  return token;
}

export function readSession(token: string, policy: string): SignedInUser | null {
  if (!validToken(token)) return null;
  const row = database().prepare('SELECT user_json FROM sessions WHERE token_hash = ? AND policy = ? AND expires_at > ?')
    .get(hash(token), policy, now()) as { user_json: string } | undefined;
  return row ? JSON.parse(row.user_json) as SignedInUser : null;
}

export function deleteSession(token: string) {
  if (validToken(token)) database().prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(token));
}

export function closeAuthStore() {
  processAuth.cmAuthStore?.database.close();
  delete processAuth.cmAuthStore;
}
