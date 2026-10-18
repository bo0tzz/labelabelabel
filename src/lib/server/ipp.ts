import ipp from 'ipp-encoder';

const C = ipp.CONSTANTS;

export const JOB_STATE: Record<number, string> = {
	[C.JOB_PENDING]: 'pending',
	[C.JOB_PENDING_HELD]: 'pending-held',
	[C.JOB_PROCESSING]: 'processing',
	[C.JOB_PROCESSING_STOPPED]: 'processing-stopped',
	[C.JOB_CANCELED]: 'canceled',
	[C.JOB_ABORTED]: 'aborted',
	[C.JOB_COMPLETED]: 'completed'
};

export class IppError extends Error {
	constructor(readonly status: number) {
		super(`IPP status 0x${status.toString(16).padStart(4, '0')}`);
	}

	/** The job no longer exists. Brother answers "not possible" once finished jobs are purged. */
	get jobGone() {
		return [C.CLIENT_ERROR_NOT_POSSIBLE, C.CLIENT_ERROR_NOT_FOUND, C.CLIENT_ERROR_GONE].includes(
			this.status
		);
	}
}

type Attributes = Record<string, unknown[]>;

let requestId = 1;

/** Minimal IPP client: enough to submit documents and follow jobs. */
export class IppClient {
	constructor(
		readonly uri: string,
		private timeoutMs = 10_000
	) {}

	async #request(
		operationId: number,
		attributes: { tag: number; name: string; value: unknown }[],
		data?: Uint8Array
	) {
		const body = ipp.request.encode({
			version: { major: 1, minor: 1 },
			operationId,
			requestId: requestId++,
			groups: [
				{
					tag: C.OPERATION_ATTRIBUTES_TAG,
					attributes: [
						{ tag: C.CHARSET, name: 'attributes-charset', value: 'utf-8' },
						{ tag: C.NATURAL_LANG, name: 'attributes-natural-language', value: 'en' },
						{ tag: C.URI, name: 'printer-uri', value: this.uri },
						{ tag: C.NAME_WITHOUT_LANG, name: 'requesting-user-name', value: 'labelabelabel' },
						...attributes
					]
				}
			],
			data: data && Buffer.from(data)
		});
		const res = await fetch(this.uri.replace(/^ipp:/, 'http:').replace(/^ipps:/, 'https:'), {
			method: 'POST',
			headers: { 'content-type': 'application/ipp' },
			body: new Uint8Array(body),
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		if (!res.ok) throw new Error(`IPP HTTP ${res.status}`);
		const response = ipp.response.decode(Buffer.from(await res.arrayBuffer()));
		if (response.statusCode >= 0x0100) throw new IppError(response.statusCode);
		return (tag: number): Attributes =>
			Object.fromEntries(
				response.groups
					.filter((g) => g.tag === tag)
					.flatMap((g) => g.attributes.map((a) => [a.name, [a.value].flat()]))
			);
	}

	async printJob(document: Uint8Array, jobName: string, format = 'application/octet-stream') {
		const group = await this.#request(
			C.PRINT_JOB,
			[
				{ tag: C.NAME_WITHOUT_LANG, name: 'job-name', value: jobName },
				{ tag: C.MIME_MEDIA_TYPE, name: 'document-format', value: format }
			],
			document
		);
		const id = group(C.JOB_ATTRIBUTES_TAG)['job-id']?.[0];
		if (typeof id !== 'number') throw new Error('printer did not return a job id');
		return id;
	}

	async jobState(jobId: number) {
		const group = await this.#request(C.GET_JOB_ATTRIBUTES, [
			{ tag: C.INTEGER, name: 'job-id', value: jobId }
		]);
		const job = group(C.JOB_ATTRIBUTES_TAG);
		const state = job['job-state']?.[0];
		return {
			state: typeof state === 'number' ? (JOB_STATE[state] ?? 'unknown') : 'unknown',
			reasons: (job['job-state-reasons'] ?? []).map(String)
		};
	}

	async printerAttributes(): Promise<Attributes> {
		return (await this.#request(C.GET_PRINTER_ATTRIBUTES, []))(C.PRINTER_ATTRIBUTES_TAG);
	}

	async cancelJob(jobId: number) {
		await this.#request(C.CANCEL_JOB, [{ tag: C.INTEGER, name: 'job-id', value: jobId }]);
	}
}
