/** Minimal IPP/1.1 client: enough to submit documents and follow jobs. */

const TAG = {
	operation: 0x01,
	job: 0x02,
	end: 0x03,
	printer: 0x04,
	unsupported: 0x05,
	integer: 0x21,
	boolean: 0x22,
	enum: 0x23,
	begCollection: 0x34,
	endCollection: 0x37,
	memberName: 0x4a,
	text: 0x41,
	name: 0x42,
	keyword: 0x44,
	uri: 0x45,
	charset: 0x47,
	language: 0x48,
	mimeType: 0x49
} as const;

export const OP = {
	printJob: 0x0002,
	cancelJob: 0x0008,
	getJobAttributes: 0x0009,
	getPrinterAttributes: 0x000b
} as const;

export const JOB_STATE: Record<number, string> = {
	3: 'pending',
	4: 'pending-held',
	5: 'processing',
	6: 'processing-stopped',
	7: 'canceled',
	8: 'aborted',
	9: 'completed'
};

export type IppValue = string | number | boolean | Uint8Array;
export type IppAttributes = Record<string, IppValue[]>;

export interface IppResponse {
	status: number;
	groups: { tag: number; attributes: IppAttributes }[];
}

type Attr = [tag: number, name: string, value: string | number];

class Writer {
	#chunks: number[] = [];

	u8(v: number) {
		this.#chunks.push(v & 0xff);
	}
	u16(v: number) {
		this.#chunks.push((v >> 8) & 0xff, v & 0xff);
	}
	u32(v: number) {
		this.#chunks.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
	}
	bytes(b: Uint8Array) {
		this.u16(b.length);
		for (const x of b) this.#chunks.push(x);
	}
	attr([tag, name, value]: Attr) {
		this.u8(tag);
		this.bytes(new TextEncoder().encode(name));
		if (typeof value === 'number') {
			this.u16(4);
			this.u32(value);
		} else {
			this.bytes(new TextEncoder().encode(value));
		}
	}
	done(): Uint8Array<ArrayBuffer> {
		return Uint8Array.from(this.#chunks);
	}
}

let requestId = 1;

export function encodeRequest(operation: number, attributes: Attr[]): Uint8Array<ArrayBuffer> {
	const w = new Writer();
	w.u16(0x0101);
	w.u16(operation);
	w.u32(requestId++);
	w.u8(TAG.operation);
	for (const a of attributes) w.attr(a);
	w.u8(TAG.end);
	return w.done();
}

export function decodeResponse(data: Uint8Array): IppResponse {
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const decoder = new TextDecoder();
	let i = 8;
	const status = view.getUint16(2);
	const groups: IppResponse['groups'] = [];
	let current: IppAttributes | null = null;
	let lastName = '';
	let depth = 0;

	while (i < data.length) {
		const tag = data[i++];
		if (tag === TAG.end) break;
		if (tag < 0x10) {
			current = {};
			groups.push({ tag, attributes: current });
			continue;
		}
		const nameLength = view.getUint16(i);
		i += 2;
		const name = decoder.decode(data.subarray(i, i + nameLength));
		i += nameLength;
		const valueLength = view.getUint16(i);
		i += 2;
		const raw = data.subarray(i, i + valueLength);
		i += valueLength;

		// Collections are skipped; nothing we read needs them.
		if (tag === TAG.begCollection) {
			if (depth === 0 && name) lastName = name;
			depth++;
			continue;
		}
		if (tag === TAG.endCollection) {
			depth--;
			continue;
		}
		if (depth > 0 || !current) continue;

		if (name) lastName = name;
		let value: IppValue;
		if (tag === TAG.integer || tag === TAG.enum) value = view.getInt32(i - valueLength);
		else if (tag === TAG.boolean) value = raw[0] === 1;
		else if (tag >= 0x40 && tag <= 0x4f) value = decoder.decode(raw);
		else if (tag >= 0x10 && tag < 0x20) continue;
		else value = raw.slice();
		(current[lastName] ??= []).push(value);
	}
	return { status, groups };
}

export class IppClient {
	constructor(
		readonly uri: string,
		private timeoutMs = 10_000
	) {}

	get #httpUrl() {
		return this.uri.replace(/^ipp:/, 'http:').replace(/^ipps:/, 'https:');
	}

	#base(): Attr[] {
		return [
			[TAG.charset, 'attributes-charset', 'utf-8'],
			[TAG.language, 'attributes-natural-language', 'en'],
			[TAG.uri, 'printer-uri', this.uri],
			[TAG.name, 'requesting-user-name', 'labelabelabel']
		];
	}

	async request(operation: number, attributes: Attr[], document?: Uint8Array) {
		let body = encodeRequest(operation, [...this.#base(), ...attributes]);
		if (document) {
			const joined = new Uint8Array(body.length + document.length);
			joined.set(body);
			joined.set(document, body.length);
			body = joined;
		}
		const res = await fetch(this.#httpUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/ipp' },
			body,
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!res.ok) throw new Error(`IPP HTTP ${res.status}`);
		const response = decodeResponse(new Uint8Array(await res.arrayBuffer()));
		if (response.status >= 0x0100) {
			throw new Error(`IPP status 0x${response.status.toString(16).padStart(4, '0')}`);
		}
		return response;
	}

	async printJob(document: Uint8Array, jobName: string, format = 'application/octet-stream') {
		const res = await this.request(
			OP.printJob,
			[
				[TAG.name, 'job-name', jobName],
				[TAG.mimeType, 'document-format', format]
			],
			document
		);
		const job = res.groups.find((g) => g.tag === TAG.job)?.attributes;
		const id = job?.['job-id']?.[0];
		if (typeof id !== 'number') throw new Error('printer did not return a job id');
		return id;
	}

	async jobState(jobId: number) {
		const res = await this.request(OP.getJobAttributes, [[TAG.integer, 'job-id', jobId]]);
		const job = res.groups.find((g) => g.tag === TAG.job)?.attributes ?? {};
		const state = job['job-state']?.[0];
		return {
			state: typeof state === 'number' ? (JOB_STATE[state] ?? 'unknown') : 'unknown',
			reasons: (job['job-state-reasons'] ?? []).map(String)
		};
	}

	async printerAttributes(): Promise<IppAttributes> {
		const res = await this.request(OP.getPrinterAttributes, []);
		return res.groups.find((g) => g.tag === TAG.printer)?.attributes ?? {};
	}

	async cancelJob(jobId: number) {
		await this.request(OP.cancelJob, [[TAG.integer, 'job-id', jobId]]);
	}
}
