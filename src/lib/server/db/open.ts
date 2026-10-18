import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(file: string): Db {
	const sqlite = new Database(file);
	sqlite.pragma('journal_mode = WAL');
	const db = drizzle(sqlite, { schema, casing: 'snake_case' });
	migrate(db, { migrationsFolder: 'drizzle' });
	return db;
}
