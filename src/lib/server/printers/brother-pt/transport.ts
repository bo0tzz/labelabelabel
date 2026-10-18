import { connect } from 'node:net';

/** Streams a job to the raw port. The printer never answers on this socket. */
export function sendRaw(host: string, data: Uint8Array, port = 9100, timeoutMs = 30_000) {
	return new Promise<void>((resolve, reject) => {
		const socket = connect({ host, port });
		socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`timeout sending to ${host}`)));
		socket.once('error', reject);
		socket.once('connect', () => socket.end(data));
		socket.once('close', (hadError) => {
			if (!hadError) resolve();
		});
	});
}
