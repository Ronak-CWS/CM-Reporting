import { mkdirSync } from 'node:fs';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dataDirectory } from './storage-config';
import { privatePhotoPath } from './photo-path';
export { privatePhotoPath } from './photo-path';

export interface StorageStatement {
  bind(...values: SQLInputValue[]): StorageStatement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

export interface StorageDatabase {
  prepare(sql: string): StorageStatement;
  batch<T = Record<string, unknown>>(statements: StorageStatement[]): Promise<Array<{ results: T[] }>>;
}

export interface PhotoStorage {
  put(key: string, bytes: ArrayBuffer, options?: { httpMetadata: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: Uint8Array<ArrayBuffer> } | null>;
  delete(keys: string[]): Promise<unknown>;
}

class LocalStatement implements StorageStatement {
  constructor(readonly owner: DatabaseSync, readonly sql: string, readonly values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new LocalStatement(this.owner, this.sql, values); }
  async run() { return this.owner.prepare(this.sql).run(...this.values); }
  async all<T>() { return { results: this.owner.prepare(this.sql).all(...this.values) as T[] }; }
  async first<T>() { return (this.owner.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
}

export function createLocalStorage(directory: string) {
  mkdirSync(directory, { recursive: true });
  const sqlite = new DatabaseSync(path.join(directory, 'reports.sqlite'));
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
  const database: StorageDatabase = {
    prepare: (sql) => new LocalStatement(sqlite, sql),
    async batch<T>(statements: StorageStatement[]) {
      // Execute synchronously within one transaction, including all photo metadata.
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof LocalStatement) || statement.owner !== sqlite) throw new Error('Invalid database statement.');
          return { results: sqlite.prepare(statement.sql).all(...statement.values) as T[] };
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const photos: PhotoStorage = {
    async put(key, bytes) {
      const target = privatePhotoPath(directory, key);
      await mkdir(path.dirname(target), { recursive: true });
      const file = await open(target, 'wx');
      try { await file.writeFile(new Uint8Array(bytes)); await file.sync(); }
      finally { await file.close(); }
    },
    async get(key) {
      try { return { body: Uint8Array.from(await readFile(privatePhotoPath(directory, key))) }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    },
    async delete(keys) {
      await Promise.all(keys.map(async (key) => {
        try { await unlink(privatePhotoPath(directory, key)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }));
    },
  };
  return { database, photos, sqlite, directory, close: () => sqlite.close() };
}

const processStorage = globalThis as typeof globalThis & { cmReportingStorage?: ReturnType<typeof createLocalStorage> };

export function getLocalStorage() {
  const directory = dataDirectory();
  if (processStorage.cmReportingStorage?.directory !== directory) {
    processStorage.cmReportingStorage?.close();
    processStorage.cmReportingStorage = createLocalStorage(directory);
  }
  return processStorage.cmReportingStorage;
}

export function getDatabase() { return getLocalStorage().database; }
export function getPhotoStorage() { return getLocalStorage().photos; }
