import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '$app/env/private';
import { openDb } from './open.js';

mkdirSync(DATA_DIR, { recursive: true });

export const db = openDb(join(DATA_DIR, 'db.sqlite'));

export * from './schema.js';
