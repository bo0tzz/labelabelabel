import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import * as schema from './schema.js';

mkdirSync(DATA_DIR, { recursive: true });
const sqlite = new Database(join(DATA_DIR, 'db.sqlite'));
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema, casing: 'snake_case' });
migrate(db, { migrationsFolder: 'drizzle' });

export * from './schema.js';
