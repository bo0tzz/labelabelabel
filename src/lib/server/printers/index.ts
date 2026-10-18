import { PRINTER_HOST, PRINTER_TRANSPORT } from '$app/env/private';
import { db } from '../db/index.js';
import { registry } from '../fonts.js';
import { BrotherPtDriver } from './brother-pt/driver.js';
import { PrinterService } from './service.js';

export const printers = new PrinterService(db, registry);

export function startPrinters() {
	printers.start();
	if (PRINTER_HOST) {
		const transport = PRINTER_TRANSPORT === 'raw' ? 'raw' : 'ipp';
		printers.add('default', 'PT-P750W', new BrotherPtDriver({ host: PRINTER_HOST, transport }));
	}
}

/** Yields `read()` now and again whenever printers or jobs change, skipping repeats. */
export async function* whenPrintersChange<T>(read: () => T): AsyncGenerator<T> {
	let wake = () => {};
	const unsubscribe = printers.subscribe(() => wake());
	let last: string | undefined;
	try {
		while (true) {
			const changed = new Promise<void>((resolve) => (wake = resolve));
			const value = read();
			const json = JSON.stringify(value);
			if (json !== last) {
				last = json;
				yield value;
			}
			await changed;
		}
	} finally {
		unsubscribe();
	}
}
