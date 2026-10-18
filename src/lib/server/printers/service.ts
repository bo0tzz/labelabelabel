import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Label } from '#lib/label/types.js';
import { getMedia } from '#lib/media.js';
import type { LoadedMedia, PrinterInfo, PrinterStatus } from '#lib/printers/types.js';
import { renderLabel } from '#lib/render/render.js';
import type { FontRegistry } from '#lib/render/fonts.js';
import type { Db } from '../db/open.js';
import { jobs, tapes } from '../db/schema.js';
import type { PrinterDriver, SubmittedJob } from './driver.js';

export interface PrinterView extends PrinterInfo {
	status: PrinterStatus;
	updatedAt: number;
	/** Library entry of the loaded tape. */
	tapeId: number | null;
	/** The last job was chained, so its label is still inside the printer. */
	labelInPrinter: boolean;
	busy: boolean;
}

export interface JobOptions {
	halfCut?: boolean;
	chain?: boolean;
	mirror?: boolean;
	/** Print even if the loaded tape colours differ from the label's. */
	force?: boolean;
}

export interface NewJob {
	doc: Label;
	name: string;
	printerId?: string;
	vars?: Record<string, string>;
	copies?: number;
	options?: JobOptions;
	labelId?: string;
	user?: string;
}

interface Printer {
	info: PrinterInfo;
	driver: PrinterDriver;
	status: PrinterStatus;
	updatedAt: number;
	tapeId: number | null;
	mediaKey: string | null;
	current: { jobId: string; submitted?: SubmittedJob } | null;
	labelInPrinter: boolean;
	feeding: boolean;
}

const POLL_MS = 2000;
const OFFLINE: PrinterStatus = { online: false, busy: false, errors: ['offline'], media: null };

export class PrinterService {
	#printers = new Map<string, Printer>();
	#listeners = new Set<() => void>();
	#started = false;

	constructor(
		private db: Db,
		private fonts: FontRegistry
	) {}

	/** Jobs that were printing when the server stopped can't be followed anymore. */
	start() {
		if (this.#started) return;
		this.#started = true;
		this.db
			.update(jobs)
			.set({ status: 'failed', error: 'interrupted' })
			.where(eq(jobs.status, 'printing'))
			.run();
	}

	/** `poll: false` leaves status updates to explicit `poll()` calls. */
	add(id: string, name: string, driver: PrinterDriver, { poll = true } = {}) {
		const printer: Printer = {
			info: { id, name, model: driver.model, capabilities: driver.capabilities },
			driver,
			status: OFFLINE,
			updatedAt: 0,
			tapeId: null,
			mediaKey: null,
			current: null,
			labelInPrinter: false,
			feeding: false
		};
		this.#printers.set(id, printer);
		if (poll) void this.#pollLoop(printer);
	}

	list(): PrinterView[] {
		return [...this.#printers.values()].map((p) => ({
			...p.info,
			status: p.status,
			updatedAt: p.updatedAt,
			tapeId: p.tapeId,
			labelInPrinter: p.labelInPrinter,
			busy: !!p.current || p.feeding || p.status.busy
		}));
	}

	subscribe(listener: () => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#emit() {
		for (const listener of this.#listeners) listener();
	}

	async #pollLoop(printer: Printer) {
		while (this.#printers.get(printer.info.id) === printer) {
			try {
				await this.poll(printer.info.id);
			} catch (e) {
				console.error(`printer ${printer.info.id}:`, e);
			}
			await sleep(POLL_MS);
		}
	}

	/** Reads the printer's status once and acts on any change. */
	async poll(printerId: string) {
		const printer = this.#printers.get(printerId);
		if (!printer) return;
		const status = await printer.driver.status().catch(() => OFFLINE);
		printer.updatedAt = Date.now();
		if (JSON.stringify(status) === JSON.stringify(printer.status)) return;
		printer.status = status;
		this.#recordTape(printer, status.media);
		this.#emit();
		this.#process(printer).catch((e) => console.error(`printer ${printer.info.id}:`, e));
	}

	/** Adds a newly seen cassette to the library, or marks a known one as seen. */
	#recordTape(printer: Printer, media: LoadedMedia | null) {
		const key = media?.key ?? null;
		if (key === printer.mediaKey) return;
		printer.mediaKey = key;
		if (!media) {
			printer.tapeId = null;
			return;
		}
		const row = this.db
			.insert(tapes)
			.values({
				key: media.key,
				mediaId: media.id,
				kind: media.kind,
				tape: media.tape,
				text: media.text,
				partNumber: media.partNumber,
				lastSeen: new Date()
			})
			.onConflictDoUpdate({ target: tapes.key, set: { lastSeen: new Date() } })
			.returning({ id: tapes.id })
			.get();
		printer.tapeId = row.id;
	}

	submit(job: NewJob): string {
		const printerId = job.printerId ?? this.#printers.keys().next().value;
		const printer = printerId && this.#printers.get(printerId);
		if (!printer) throw new Error('no printer configured');
		if (!getMedia(job.doc.media.id)) throw new Error(`unknown media ${job.doc.media.id}`);
		const id = randomUUID();
		this.db
			.insert(jobs)
			.values({
				id,
				printerId: printer.info.id,
				labelId: job.labelId,
				name: job.name,
				doc: job.doc,
				vars: job.vars,
				copies: Math.max(1, Math.min(99, job.copies ?? 1)),
				options: job.options,
				status: 'queued',
				user: job.user
			})
			.run();
		this.#emit();
		void this.#process(printer);
		return id;
	}

	async cancel(jobId: string) {
		const job = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
		if (!job) return;
		const printer = this.#printers.get(job.printerId);
		if (job.status === 'printing' && printer?.current?.jobId === jobId) {
			await printer.current.submitted?.cancel();
			return;
		}
		if (job.status === 'queued' || job.status === 'waiting') {
			this.db
				.update(jobs)
				.set({ status: 'canceled', finishedAt: new Date() })
				.where(eq(jobs.id, jobId))
				.run();
			this.#emit();
			if (printer) void this.#process(printer);
		}
	}

	/** Feeds out and cuts the tape between print head and cutter, e.g. a chained label. */
	async feed(printerId?: string) {
		const printer = this.#printers.get(printerId ?? this.#printers.keys().next().value ?? '');
		if (!printer?.driver.feed) throw new Error('printer cannot feed');
		const media = printer.status.media && getMedia(printer.status.media.id);
		if (!printer.status.online || !media) throw new Error('printer not ready');
		if (printer.current || printer.feeding || printer.status.busy) throw new Error('printer busy');
		printer.feeding = true;
		this.#emit();
		try {
			await (
				await printer.driver.feed(media)
			).done;
			printer.labelInPrinter = false;
		} finally {
			printer.feeding = false;
			this.#emit();
			void this.#process(printer);
		}
	}

	/** Lets a waiting job print on the loaded tape despite different colours. */
	force(jobId: string) {
		const job = this.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
		if (!job || job.status !== 'waiting') return;
		this.db
			.update(jobs)
			.set({ options: { ...job.options, force: true } })
			.where(eq(jobs.id, jobId))
			.run();
		const printer = this.#printers.get(job.printerId);
		if (printer) void this.#process(printer);
	}

	/** Why nothing can print right now, regardless of the job. */
	#printerBlocker(printer: Printer): string | null {
		const s = printer.status;
		if (!s.online) return 'offline';
		if (s.errors.length) return s.errors.join(', ');
		if (s.busy) return 'busy';
		if (!s.media) return 'no tape';
		return null;
	}

	/** Why this job can't print on the loaded tape. */
	#tapeBlocker(printer: Printer, doc: Label, options: JobOptions | null): string | null {
		const loaded = printer.status.media;
		const want = doc.media;
		if (!loaded) return 'no tape';
		if (loaded.id !== want.id) return `needs ${getMedia(want.id)?.name ?? want.id}`;
		const colourMismatch =
			(want.tape && want.tape !== loaded.tape) || (want.text && want.text !== loaded.text);
		if (colourMismatch && !options?.force) {
			return `needs ${want.text ?? 'any'} on ${want.tape ?? 'any'}`;
		}
		return null;
	}

	/**
	 * Prints the oldest job that fits the loaded tape. Jobs waiting for another tape don't hold
	 * up the ones behind them.
	 */
	async #process(printer: Printer) {
		if (printer.current || printer.feeding) return;
		const pending = this.db
			.select()
			.from(jobs)
			.where(and(eq(jobs.printerId, printer.info.id), inArray(jobs.status, ['queued', 'waiting'])))
			.orderBy(asc(jobs.createdAt))
			.all();
		if (!pending.length) return;

		const printerBlocker = this.#printerBlocker(printer);
		let job: (typeof pending)[number] | undefined;
		let changed = false;
		for (const candidate of pending) {
			const blocker =
				printerBlocker ?? this.#tapeBlocker(printer, candidate.doc, candidate.options);
			if (!blocker && !job) {
				job = candidate;
				continue;
			}
			const status = blocker ? 'waiting' : 'queued';
			if (candidate.status !== status || candidate.error !== blocker) {
				this.db.update(jobs).set({ status, error: blocker }).where(eq(jobs.id, candidate.id)).run();
				changed = true;
			}
		}
		if (!job) {
			if (changed) this.#emit();
			return;
		}

		printer.current = { jobId: job.id };
		this.db.update(jobs).set({ status: 'printing', error: null }).where(eq(jobs.id, job.id)).run();
		this.#emit();

		try {
			const media = getMedia(job.doc.media.id)!;
			const rendered = renderLabel(job.doc, media, {
				fonts: this.fonts,
				vars: job.vars ?? undefined
			});
			// A half cut keeps the blank lead attached instead of cutting it off as a scrap.
			const halfCut = job.options?.halfCut ?? printer.status.media?.kind === 'laminated';
			// Unless the previous label was chained, the tape between head and cutter is used up too.
			const leadMm = printer.labelInPrinter ? 0 : media.minTapeMm;
			const submitted = await printer.driver.print(
				Array.from({ length: job.copies }, () => rendered.bitmap),
				{ name: job.name, media, highRes: job.doc.highRes, ...job.options, halfCut }
			);
			printer.current.submitted = submitted;
			await submitted.done;
			printer.labelInPrinter = !!job.options?.chain;
			const tapeMm = rendered.tapeMm * job.copies;
			this.db
				.update(jobs)
				.set({ status: 'done', finishedAt: new Date(), tapeId: printer.tapeId, tapeMm })
				.where(eq(jobs.id, job.id))
				.run();
			if (printer.tapeId) {
				this.db
					.update(tapes)
					.set({ usedMm: sql`${tapes.usedMm} + ${tapeMm + leadMm}` })
					.where(eq(tapes.id, printer.tapeId))
					.run();
			}
		} catch (e) {
			const message = (e as Error).message;
			this.db
				.update(jobs)
				.set({
					status: message === 'canceled' ? 'canceled' : 'failed',
					error: message === 'canceled' ? null : message,
					finishedAt: new Date()
				})
				.where(eq(jobs.id, job.id))
				.run();
		} finally {
			printer.current = null;
			this.#emit();
			void this.#process(printer);
		}
	}
}
