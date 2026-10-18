import { describe, expect, it } from 'vitest';
import { parseStatus } from './status.js';

const hex = (s: string) => Uint8Array.from(s.split(/\s+/).map((b) => parseInt(b, 16)));

describe('parseStatus', () => {
	it('parses a block read from a PT-P750W with 12 mm laminated tape', () => {
		const status = parseStatus(
			hex(
				'80 20 42 30 68 30 04 00 00 00 0C 01 00 00 00 00 00 00 00 00 00 00 00 00 01 08 00 00 00 00 00 00'
			)
		);
		expect(status.modelCode).toBe(0x68);
		expect(status.errors).toEqual([]);
		expect(status.media?.name).toBe('12 mm');
		expect(status.media?.kind).toBe('laminated');
		expect(status.media?.printPins).toBe(70);
		expect(status.tapeColorName).toBe('white');
		expect(status.textColorName).toBe('black');
	});

	it('reports errors and missing media', () => {
		const status = parseStatus(
			hex(
				'80 20 42 30 68 30 00 00 01 10 00 00 00 00 00 00 00 00 02 00 00 00 00 00 00 00 00 00 00 00 00 00'
			)
		);
		expect(status.errors).toEqual(['no-media', 'cover-open']);
		expect(status.media).toBeUndefined();
		expect(status.statusType).toBe(2);
	});

	it('rejects other data', () => {
		expect(() => parseStatus(new Uint8Array(32))).toThrow();
	});
});
