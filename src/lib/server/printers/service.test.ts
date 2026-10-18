import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Label } from '#lib/label/types.js';
import type { LoadedMedia, PrinterStatus } from '#lib/printers/types.js';
import { FontRegistry } from '#lib/render/fonts.js';
import { openDb } from '../db/open.js';
import { jobs, tapes } from '../db/schema.js';
import type { PrinterDriver, PrintJobOptions } from './driver.js';
import { PrinterService } from './service.js';

function cassette(width: 12 | 24, tape = 'white', text = 'black'): LoadedMedia {
	return {
		id: `tze-${width}`,
		name: `${width} mm`,
		key: `test:${width}:${tape}:${text}`,
		kind: 'laminated',
		tape,
		text
	};
}

class FakeDriver implements PrinterDriver {
	readonly model = 'Fake';
	readonly capabilities = { highRes: true, halfCut: true, chain: true, mirror: true, feed: true };
	state: PrinterStatus = { online: true, busy: false, errors: [], media: cassette(12) };
	printed: { name: string; options: PrintJobOptions }[] = [];

	async status() {
		return structuredClone(this.state);
	}

	async print(_pages: unknown[], options: PrintJobOptions) {
		this.printed.push({ name: options.name, options });
		return { done: Promise.resolve(), cancel: async () => {} };
	}

	close() {}
}

function qr(mediaId: string, colours: Partial<Label['media']> = {}): Label {
	return { v: 1, media: { id: mediaId, ...colours }, blocks: [{ id: 'q', type: 'qr', data: 'x' }] };
}

async function setup() {
	const db = openDb(':memory:');
	const service = new PrinterService(db, new FontRegistry());
	const driver = new FakeDriver();
	service.add('p', 'Test', driver, { poll: false });
	await service.poll('p');
	const job = (id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;
	const settle = (id: string, status: string) =>
		vi.waitFor(() => expect(job(id).status).toBe(status));
	const change = async (state: Partial<PrinterStatus>) => {
		driver.state = { ...driver.state, ...state };
		await service.poll('p');
	};
	return { db, service, driver, job, settle, change };
}

describe('PrinterService', () => {
	it('prints a job for the loaded tape', async () => {
		const { service, driver, settle } = await setup();
		const id = service.submit({ doc: qr('tze-12'), name: 'a' });
		await settle(id, 'done');
		expect(driver.printed.map((p) => p.name)).toEqual(['a']);
	});

	it('does not hold up jobs behind one that needs another tape', async () => {
		const { service, driver, job, settle, change } = await setup();
		const wide = service.submit({ doc: qr('tze-24'), name: 'wide' });
		const narrow = service.submit({ doc: qr('tze-12'), name: 'narrow' });
		await settle(narrow, 'done');
		expect(job(wide)).toMatchObject({ status: 'waiting', error: 'needs 24 mm' });

		await change({ media: cassette(24) });
		await settle(wide, 'done');
		expect(driver.printed.map((p) => p.name)).toEqual(['narrow', 'wide']);
	});

	it('waits for the right colours unless forced', async () => {
		const { service, job, settle } = await setup();
		const id = service.submit({ doc: qr('tze-12', { tape: 'yellow' }), name: 'y' });
		await settle(id, 'waiting');
		expect(job(id).error).toBe('needs any on yellow');
		service.force(id);
		await settle(id, 'done');
	});

	it('holds everything while the printer is offline', async () => {
		const { service, settle, change } = await setup();
		await change({ online: false, errors: ['offline'], media: null });
		const id = service.submit({ doc: qr('tze-12'), name: 'a' });
		await settle(id, 'waiting');
		await change({ online: true, errors: [], media: cassette(12) });
		await settle(id, 'done');
	});

	it('cancels waiting jobs', async () => {
		const { service, driver, settle } = await setup();
		const id = service.submit({ doc: qr('tze-24'), name: 'wide' });
		await settle(id, 'waiting');
		await service.cancel(id);
		await settle(id, 'canceled');
		expect(driver.printed).toEqual([]);
	});

	it('refuses labels with nothing to print', async () => {
		const { service } = await setup();
		const doc: Label = {
			v: 1,
			media: { id: 'tze-12' },
			blocks: [{ id: 'q', type: 'qr', data: '' }]
		};
		expect(() => service.submit({ doc, name: 'blank' })).toThrow('nothing to print');
	});

	it('half cuts laminated tape unless told otherwise', async () => {
		const { service, driver, settle } = await setup();
		await settle(service.submit({ doc: qr('tze-12'), name: 'a' }), 'done');
		await settle(
			service.submit({ doc: qr('tze-12'), name: 'b', options: { halfCut: false } }),
			'done'
		);
		expect(driver.printed.map((p) => p.options.halfCut)).toEqual([true, false]);
	});

	it('records each cassette once and counts the lead unless chained', async () => {
		const { db, service, settle, change } = await setup();
		await change({ media: cassette(24) });
		await change({ media: cassette(12) });
		expect(db.select().from(tapes).all()).toHaveLength(2);

		const first = service.submit({ doc: qr('tze-12'), name: 'a', options: { chain: true } });
		await settle(first, 'done');
		const second = service.submit({ doc: qr('tze-12'), name: 'b' });
		await settle(second, 'done');
		const tape = db.select().from(tapes).where(eq(tapes.mediaId, 'tze-12')).get()!;
		const labels = db
			.select()
			.from(jobs)
			.all()
			.reduce((sum, j) => sum + (j.tapeMm ?? 0), 0);
		// Only the first job pays for the lead; the second continues the chained strip.
		expect(tape.usedMm).toBeCloseTo(labels + 24.5);
	});
});
