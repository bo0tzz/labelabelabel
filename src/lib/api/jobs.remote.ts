import { desc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { command, getRequestEvent, query } from '$app/server';
import { labelSchema, varsSchema } from '#lib/label/schema.js';
import { db, jobs } from '#lib/server/db/index.js';
import { printers } from '#lib/server/printers/service.js';

export const print = command(
	v.object({
		doc: labelSchema,
		name: v.pipe(v.string(), v.maxLength(200)),
		vars: v.optional(varsSchema),
		copies: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99))),
		options: v.optional(
			v.object({
				halfCut: v.optional(v.boolean()),
				chain: v.optional(v.boolean()),
				mirror: v.optional(v.boolean()),
				force: v.optional(v.boolean())
			})
		),
		labelId: v.optional(v.string())
	}),
	(job) => printers.submit({ ...job, user: getRequestEvent().locals.user })
);

export const cancelJob = command(v.string(), (id) => printers.cancel(id));

export const forceJob = command(v.string(), (id) => printers.force(id));

export const history = query(() =>
	db
		.select({
			id: jobs.id,
			name: jobs.name,
			status: jobs.status,
			error: jobs.error,
			copies: jobs.copies,
			tapeMm: jobs.tapeMm,
			user: jobs.user,
			doc: jobs.doc,
			vars: jobs.vars,
			createdAt: jobs.createdAt,
			finishedAt: jobs.finishedAt
		})
		.from(jobs)
		.orderBy(desc(jobs.createdAt))
		.limit(200)
		.all()
);

export const getJob = query(v.string(), (id) =>
	db.select().from(jobs).where(eq(jobs.id, id)).get()
);
