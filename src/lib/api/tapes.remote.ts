import { asc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { command, query } from '$app/server';
import { db, tapes } from '#lib/server/db/index.js';

export const listTapes = query(() =>
	db.select().from(tapes).orderBy(asc(tapes.mediaId), asc(tapes.tape), asc(tapes.text)).all()
);

export const updateTape = command(
	v.object({
		id: v.number(),
		status: v.optional(v.picklist(['owned', 'low', 'empty'])),
		partNumber: v.optional(v.pipe(v.string(), v.maxLength(50))),
		note: v.optional(v.pipe(v.string(), v.maxLength(500))),
		lengthMm: v.optional(v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(100_000)))),
		resetUsage: v.optional(v.boolean())
	}),
	({ id, resetUsage, ...fields }) => {
		db.update(tapes)
			.set({ ...fields, ...(resetUsage ? { usedMm: 0 } : {}) })
			.where(eq(tapes.id, id))
			.run();
		void listTapes().refresh();
	}
);

export const deleteTape = command(v.number(), (id) => {
	db.delete(tapes).where(eq(tapes.id, id)).run();
	void listTapes().refresh();
});
