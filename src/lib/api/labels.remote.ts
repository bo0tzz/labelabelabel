import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { command, query } from '$app/server';
import { labelSchema } from '#lib/label/schema.js';
import { db, labels } from '#lib/server/db/index.js';

export const listLabels = query(() =>
	db.select().from(labels).orderBy(desc(labels.updatedAt)).all()
);

export const getLabel = query(v.string(), (id) =>
	db.select().from(labels).where(eq(labels.id, id)).get()
);

export const saveLabel = command(
	v.object({
		id: v.optional(v.string()),
		name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
		doc: labelSchema
	}),
	({ id, name, doc }) => {
		const now = new Date();
		const row = id
			? db
					.update(labels)
					.set({ name, doc, updatedAt: now })
					.where(eq(labels.id, id))
					.returning()
					.get()
			: db.insert(labels).values({ id: randomUUID(), name, doc }).returning().get();
		if (!row) throw new Error('label not found');
		void listLabels().refresh();
		return row.id;
	}
);

export const deleteLabel = command(v.string(), (id) => {
	db.delete(labels).where(eq(labels.id, id)).run();
	void listLabels().refresh();
});
