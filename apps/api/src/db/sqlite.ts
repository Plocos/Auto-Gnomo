import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from '../config.js';

export type AppDb = DatabaseSync;

let db: AppDb | null = null;
let dataDir: string | null = null;

const BUSY_TIMEOUT_MS = 5_000;

export function getDataDir(): string {
  if (!dataDir) throw new Error('SQLite not connected');
  return dataDir;
}

export function connectSqlite(dir: string = env.dataDir): AppDb {
  if (db && dataDir === dir) return db;
  if (db) {
    checkpointAndClose();
  }

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'documents'), { recursive: true });

  const dbPath = join(dir, 'autonomous.db');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  db.exec('PRAGMA foreign_keys = ON');
  dataDir = dir;
  return db;
}

export function getDb(): AppDb {
  if (!db) throw new Error('SQLite not connected');
  return db;
}

function checkpointAndClose(): void {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('wal_checkpoint failed:', e);
  }
  try {
    db.close();
  } catch (e) {
    console.warn('sqlite close failed:', e);
  }
  db = null;
  dataDir = null;
}

export function closeSqlite(): void {
  checkpointAndClose();
}

/** Reopen against a new data folder (desktop: change folder). */
export function reopenSqlite(dir: string): AppDb {
  closeSqlite();
  return connectSqlite(dir);
}
