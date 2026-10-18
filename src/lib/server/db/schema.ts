import { sql } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Label } from '#lib/label/types.js';

const now = sql`(unixepoch('subsec') * 1000)`;

/** Cassettes seen in a printer or added by hand. */
export const tapes = sqliteTable('tapes', {
	id: integer().primaryKey({ autoIncrement: true }),
	/** Driver-specific identity of this kind of cassette; null for tapes added by hand. */
	key: text().unique(),
	mediaId: text().notNull(),
	kind: text().notNull(),
	tape: text(),
	text: text(),
	partNumber: text(),
	note: text(),
	status: text({ enum: ['owned', 'low', 'empty'] })
		.notNull()
		.default('owned'),
	/** Tape printed since the current cassette was put in service. */
	usedMm: real().notNull().default(0),
	/** Length of a new cassette; omitted to use the usual length for the kind. */
	lengthMm: real(),
	firstSeen: integer({ mode: 'timestamp_ms' }).notNull().default(now),
	lastSeen: integer({ mode: 'timestamp_ms' })
});

export const labels = sqliteTable('labels', {
	id: text().primaryKey(),
	name: text().notNull(),
	doc: text({ mode: 'json' }).$type<Label>().notNull(),
	createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(now),
	updatedAt: integer({ mode: 'timestamp_ms' }).notNull().default(now)
});

export const jobs = sqliteTable('jobs', {
	id: text().primaryKey(),
	printerId: text().notNull(),
	labelId: text(),
	name: text().notNull(),
	doc: text({ mode: 'json' }).$type<Label>().notNull(),
	vars: text({ mode: 'json' }).$type<Record<string, string>>(),
	copies: integer().notNull().default(1),
	options: text({ mode: 'json' }).$type<{
		halfCut?: boolean;
		chain?: boolean;
		mirror?: boolean;
		force?: boolean;
	}>(),
	status: text({ enum: ['queued', 'waiting', 'printing', 'done', 'failed', 'canceled'] }).notNull(),
	error: text(),
	tapeId: integer(),
	tapeMm: real(),
	user: text(),
	createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(now),
	finishedAt: integer({ mode: 'timestamp_ms' })
});

export const fonts = sqliteTable('fonts', {
	id: text().primaryKey(),
	name: text().notNull(),
	file: text().notNull(),
	createdAt: integer({ mode: 'timestamp_ms' }).notNull().default(now)
});

export const settings = sqliteTable('settings', {
	key: text().primaryKey(),
	value: text({ mode: 'json' }).notNull()
});
