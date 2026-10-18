import { describe, expect, it } from 'vitest';
import { createBitmap, setPixel } from '#lib/bitmap.js';
import { findMedia } from '#lib/printers/brother-pt/media.js';
import { encodeJob, encodeLine } from './raster.js';

const media12 = findMedia(0x01, 12)!;
const media24 = findMedia(0x01, 24)!;

describe('encodeLine', () => {
	it('places the top row after the margin pins, MSB first', () => {
		const bitmap = createBitmap(1, media12.printPins);
		setPixel(bitmap, 0, 0);
		setPixel(bitmap, 0, media12.printPins - 1);
		const line = encodeLine(bitmap, 0, media12);
		expect(line.length).toBe(16);
		// pin 29 -> byte 3, bit 5; pin 98 -> byte 12, bit 2
		expect(line[3]).toBe(0x04);
		expect(line[12]).toBe(0x20);
		expect(line.reduce((a, b) => a + b, 0)).toBe(0x24);
	});

	it('uses all 128 pins on 24 mm tape', () => {
		const bitmap = createBitmap(1, 128);
		for (let y = 0; y < 128; y++) setPixel(bitmap, 0, y);
		expect([...encodeLine(bitmap, 0, media24)]).toEqual(new Array(16).fill(0xff));
	});
});

describe('encodeJob', () => {
	it('builds a single-page job', () => {
		const page = createBitmap(3, media12.printPins);
		setPixel(page, 1, 0);
		const job = encodeJob([page], { media: media12 });

		expect([...job.subarray(0, 100)]).toEqual(new Array(100).fill(0));
		const rest = [...job.subarray(100)];
		expect(rest).toEqual([
			0x1b, 0x40,
			0x1b, 0x69, 0x61, 0x01,
			0x1b, 0x69, 0x7a, 0x86, 0x01, 0x0c, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x1b, 0x69, 0x4d, 0x40,
			0x1b, 0x69, 0x41, 0x01,
			0x1b, 0x69, 0x4b, 0x08,
			0x1b, 0x69, 0x64, 0x0e, 0x00,
			0x4d, 0x02,
			0x5a,
			0x47, 0x06, 0x00, 0xfe, 0x00, 0x00, 0x04, 0xf5, 0x00,
			0x5a,
			0x1a
		]); // prettier-ignore
	});

	it('sets high resolution, half cut and chain flags', () => {
		const page = createBitmap(1, media12.printPins);
		const job = encodeJob([page, page], {
			media: media12,
			highRes: true,
			halfCut: true,
			chain: true
		});
		const bytes = [...job];
		const advanced = bytes.findIndex(
			(b, i) => b === 0x1b && bytes[i + 1] === 0x69 && bytes[i + 2] === 0x4b
		);
		expect(bytes[advanced + 3]).toBe(0x44);
		const margin = bytes.findIndex(
			(b, i) => b === 0x1b && bytes[i + 1] === 0x69 && bytes[i + 2] === 0x64
		);
		expect(bytes[margin + 3]).toBe(28);
		const pageStarts = bytes.flatMap((b, i) =>
			b === 0x1b && bytes[i + 1] === 0x69 && bytes[i + 2] === 0x61 ? [i] : []
		);
		expect(pageStarts.length).toBe(2);
		expect(bytes[pageStarts[1] - 1]).toBe(0x0c);
		expect(bytes[pageStarts[0] + 4 + 11]).toBe(0x00);
		expect(bytes[pageStarts[1] + 4 + 11]).toBe(0x01);
		expect(bytes.at(-1)).toBe(0x1a);
	});

	it('rejects pages that do not match the media', () => {
		expect(() => encodeJob([createBitmap(10, 64)], { media: media12 })).toThrow();
	});
});
