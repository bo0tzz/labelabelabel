import { setTimeout as sleep } from 'node:timers/promises';
import { createBitmap, type Bitmap } from '#lib/bitmap.js';
import { ptMediaId, type MediaGeometry } from '#lib/media.js';
import { guessPartNumber, PT_MEDIA, type PtMedia } from '#lib/printers/brother-pt/media.js';
import type { LoadedMedia, PrinterStatus } from '#lib/printers/types.js';
import { IppClient, IppError } from '#lib/server/ipp.js';
import type { PrintJobOptions, PrinterDriver, SubmittedJob } from '../driver.js';
import { encodeJob } from './raster.js';
import { PtSnmp } from './snmp.js';
import type { PtStatus } from './status.js';
import { sendRaw } from './transport.js';

export interface BrotherPtConfig {
	host: string;
	/** IPP gives job tracking; raw port 9100 is fire-and-forget. */
	transport?: 'ipp' | 'raw';
	community?: string;
}

function loadedMedia(status: PtStatus): LoadedMedia | null {
	const media = status.media;
	if (!media) return null;
	return {
		id: ptMediaId(media),
		name: media.name,
		key: `brother-pt:${status.mediaType}:${status.mediaWidth}:${status.tapeColor}:${status.textColor}`,
		kind: media.kind,
		tape: status.tapeColorName,
		text: status.textColorName,
		partNumber: guessPartNumber(media, status.tapeColor, status.textColor)
	};
}

export class BrotherPtDriver implements PrinterDriver {
	readonly model = 'Brother PT-P750W';
	readonly capabilities = { highRes: true, halfCut: true, chain: true, mirror: true, feed: true };
	#snmp: PtSnmp;
	#ipp: IppClient;
	#lastStatus: PtStatus | undefined;

	constructor(private config: BrotherPtConfig) {
		this.#snmp = new PtSnmp(config.host, { community: config.community });
		this.#ipp = new IppClient(`ipp://${config.host}/ipp/print`);
	}

	async status(): Promise<PrinterStatus> {
		let reading;
		try {
			reading = await this.#snmp.read();
		} catch {
			return { online: false, busy: false, errors: ['offline'], media: null };
		}
		this.#lastStatus = reading.status;
		return {
			online: true,
			busy: reading.hrStatus === 'printing' || reading.status.phaseType !== 0,
			errors: reading.status.errors.flatMap((e) => (e === 'high-voltage-adapter' ? [] : [e])),
			media: loadedMedia(reading.status)
		};
	}

	#ptMedia(options: PrintJobOptions): PtMedia {
		const loaded = this.#lastStatus?.media;
		if (loaded && ptMediaId(loaded) === options.media.id) return loaded;
		const media = PT_MEDIA.find((m) => ptMediaId(m) === options.media.id);
		if (!media) throw new Error(`${this.model} does not support ${options.media.name}`);
		return media;
	}

	async print(pages: Bitmap[], options: PrintJobOptions): Promise<SubmittedJob> {
		const job = encodeJob(pages, {
			media: this.#ptMedia(options),
			highRes: options.highRes,
			halfCut: options.halfCut,
			chain: options.chain,
			mirror: options.mirror
		});

		if (this.config.transport === 'raw') {
			await sendRaw(this.config.host, job);
			return { done: this.#waitIdle(), cancel: async () => {} };
		}

		const jobId = await this.#ipp.printJob(job, options.name);
		return { done: this.#waitJob(jobId), cancel: () => this.#ipp.cancelJob(jobId) };
	}

	feed(media: MediaGeometry): Promise<SubmittedJob> {
		return this.print([createBitmap(0, this.#ptMedia({ name: '', media }).printPins)], {
			name: 'Feed & cut',
			media
		});
	}

	async #waitJob(jobId: number) {
		const deadline = Date.now() + 5 * 60_000;
		while (Date.now() < deadline) {
			await sleep(500);
			let state: string;
			try {
				({ state } = await this.#ipp.jobState(jobId));
			} catch (e) {
				if (e instanceof IppError && e.jobGone) return this.#waitIdle();
				continue;
			}
			if (state === 'completed') return;
			if (state === 'canceled') throw new Error('canceled');
			if (state === 'aborted') {
				const status = await this.status();
				throw new Error(
					status.errors.length ? status.errors.join(', ') : 'printer aborted the job'
				);
			}
		}
		throw new Error('timed out waiting for the printer');
	}

	async #waitIdle() {
		const deadline = Date.now() + 5 * 60_000;
		let idleCount = 0;
		while (Date.now() < deadline) {
			await sleep(500);
			const status = await this.status();
			if (!status.online) continue;
			if (status.errors.length) throw new Error(status.errors.join(', '));
			idleCount = status.busy ? 0 : idleCount + 1;
			if (idleCount >= 3) return;
		}
		throw new Error('timed out waiting for the printer');
	}

	close() {
		this.#snmp.close();
	}
}
