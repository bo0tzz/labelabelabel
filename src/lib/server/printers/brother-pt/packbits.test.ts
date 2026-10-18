import { describe, expect, it } from 'vitest';
import { packbits } from './packbits.js';

function unpack(input: Uint8Array): Uint8Array {
	const out: number[] = [];
	let i = 0;
	while (i < input.length) {
		const n = (input[i++] << 24) >> 24;
		if (n >= 0) {
			out.push(...input.subarray(i, i + n + 1));
			i += n + 1;
		} else {
			out.push(...new Array(1 - n).fill(input[i++]));
		}
	}
	return Uint8Array.from(out);
}

describe('packbits', () => {
	it('matches the example from the Brother raster reference', () => {
		const input = Uint8Array.from([
			...new Array(20).fill(0x00),
			0x22,
			0x22,
			0x23,
			0xba,
			0xbf,
			0xa2,
			0x22,
			0x2b
		]);
		expect([...packbits(input)]).toEqual([
			0xed, 0x00, 0xff, 0x22, 0x05, 0x23, 0xba, 0xbf, 0xa2, 0x22, 0x2b
		]);
	});

	it('round-trips random lines', () => {
		for (let n = 0; n < 500; n++) {
			const line = Uint8Array.from({ length: 16 }, () =>
				Math.random() < 0.5 ? 0 : Math.floor(Math.random() * 4)
			);
			expect(unpack(packbits(line))).toEqual(line);
		}
	});

	it('splits runs and literals longer than 128 bytes', () => {
		const input = Uint8Array.from([
			...new Array(300).fill(7),
			...Array.from({ length: 300 }, (_, i) => i & 0xff)
		]);
		expect(unpack(packbits(input))).toEqual(input);
	});
});
