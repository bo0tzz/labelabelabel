import snmp from 'net-snmp';
import { parseStatus, type PtStatus } from './status.js';

const STATUS_OID = '1.3.6.1.4.1.2435.3.3.9.1.6.1.0';
const HR_PRINTER_STATUS_OID = '1.3.6.1.2.1.25.3.5.1.1.1';

/** HOST-RESOURCES-MIB hrPrinterStatus */
export type HrPrinterStatus = 'other' | 'unknown' | 'idle' | 'printing' | 'warmup';

const HR_STATUS: Record<number, HrPrinterStatus> = {
	1: 'other',
	2: 'unknown',
	3: 'idle',
	4: 'printing',
	5: 'warmup'
};

export interface PtSnmpReading {
	raw: Uint8Array;
	status: PtStatus;
	hrStatus: HrPrinterStatus;
}

export class PtSnmp {
	#session: snmp.Session;

	constructor(host: string, options: { community?: string; timeoutMs?: number } = {}) {
		this.#session = snmp.createSession(host, options.community ?? 'public', {
			version: snmp.Version1,
			timeout: options.timeoutMs ?? 2000,
			retries: 1
		});
	}

	read(): Promise<PtSnmpReading> {
		return new Promise((resolve, reject) => {
			this.#session.get([STATUS_OID, HR_PRINTER_STATUS_OID], (error, varbinds) => {
				if (error) return reject(error);
				if (!varbinds || varbinds.length !== 2)
					return reject(new Error('unexpected SNMP response'));
				for (const vb of varbinds) {
					if (snmp.isVarbindError(vb)) return reject(new Error(snmp.varbindError(vb)));
				}
				const raw = new Uint8Array(varbinds[0].value as Buffer);
				resolve({
					raw,
					status: parseStatus(raw),
					hrStatus: HR_STATUS[varbinds[1].value as number] ?? 'unknown'
				});
			});
		});
	}

	close() {
		this.#session.close();
	}
}
