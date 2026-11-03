import { env } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { closeSqlite, connectSqlite } from '../db/sqlite.js';

function main() {
  const db = connectSqlite(env.dataDir);
  runMigrations(db);
  console.log('Migrations done. Data dir:', env.dataDir);
  closeSqlite();
}

main();
