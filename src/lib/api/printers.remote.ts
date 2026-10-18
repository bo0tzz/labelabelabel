import { asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { command, query } from '$app/server';
import { db, jobs, tapes } from '#lib/server/db/index.js';
import { printers, whenPrintersChange } from '#lib/server/printers/index.js';

const ACTIVE = ['queued', 'waiting', 'printing'] as const;

const jobFields = {
	id: jobs.id,
	printerId: jobs.printerId,
	name: jobs.name,
	status: jobs.status,
	error: jobs.error,
	copies: jobs.copies,
	createdAt: jobs.createdAt
};

function snapshot() {
	return {
		printers: printers.list().map((p) => ({
			...p,
			tape: p.tapeId
				? db
						.select({
							partNumber: tapes.partNumber,
							usedMm: tapes.usedMm,
							lengthMm: tapes.lengthMm,
							status: tapes.status
						})
						.from(tapes)
						.where(eq(tapes.id, p.tapeId))
						.get()
				: undefined
		})),
		queue: db
			.select(jobFields)
			.from(jobs)
			.where(inArray(jobs.status, [...ACTIVE]))
			.orderBy(asc(jobs.createdAt))
			.all(),
		recent: db
			.select(jobFields)
			.from(jobs)
			.where(notInArray(jobs.status, [...ACTIVE]))
			.orderBy(desc(jobs.createdAt))
			.limit(10)
			.all()
	};
}

export type PrinterSnapshot = ReturnType<typeof snapshot>;

export const printerState = query.live(() => whenPrintersChange(snapshot));

export const feedAndCut = command(() => printers.feed());
