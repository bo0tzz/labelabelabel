import type { Bitmap } from '#lib/bitmap.js';
import { MEDIA_TYPE_CODES, type PtMedia } from '#lib/printers/brother-pt/media.js';
import { encode as packbits } from '@fiahfy/packbits';

const HEAD_PINS = 128;
const LINE_BYTES = HEAD_PINS / 8;

const PI_KIND = 0x02;
const PI_WIDTH = 0x04;
const PI_RECOVER = 0x80;

export interface PtPrintOptions {
	media: PtMedia;
	/** 180×360 dpi; page bitmaps and margin are then in 360 dpi units along the tape. */
	highRes?: boolean;
	autoCut?: boolean;
	halfCut?: boolean;
	/** Skip the feed and cut after the last page so the next job continues on the same strip. */
	chain?: boolean;
	mirror?: boolean;
	/** Feed before and after the print area, in dots along the tape. */
	marginDots?: number;
}

export function encodeLine(bitmap: Bitmap, x: number, media: PtMedia): Uint8Array {
	const line = new Uint8Array(LINE_BYTES);
	for (let y = 0; y < bitmap.height; y++) {
		if (!bitmap.data[y * bitmap.width + x]) continue;
		const pin = media.marginPins + y;
		line[pin >> 3] |= 0x80 >> (pin & 7);
	}
	return line;
}

export function encodeJob(pages: Bitmap[], options: PtPrintOptions): Uint8Array {
	const { media, highRes = false, autoCut = true, halfCut = false, chain = false } = options;
	const marginDots = options.marginDots ?? (highRes ? 28 : 14);
	const out: number[] = [];

	for (let i = 0; i < 100; i++) out.push(0x00);
	out.push(0x1b, 0x40);

	pages.forEach((page, index) => {
		if (page.height !== media.printPins) {
			throw new Error(
				`page height ${page.height} does not match ${media.name} (${media.printPins})`
			);
		}
		const lines = page.width;
		out.push(0x1b, 0x69, 0x61, 0x01);
		out.push(
			0x1b,
			0x69,
			0x7a,
			PI_KIND | PI_WIDTH | PI_RECOVER,
			MEDIA_TYPE_CODES[media.kind],
			media.widthCode,
			0x00,
			lines & 0xff,
			(lines >> 8) & 0xff,
			(lines >> 16) & 0xff,
			(lines >> 24) & 0xff,
			index === 0 ? 0x00 : 0x01,
			0x00
		);
		out.push(0x1b, 0x69, 0x4d, (autoCut ? 0x40 : 0) | (options.mirror ? 0x80 : 0));
		if (autoCut) out.push(0x1b, 0x69, 0x41, 0x01);
		out.push(0x1b, 0x69, 0x4b, (halfCut ? 0x04 : 0) | (chain ? 0 : 0x08) | (highRes ? 0x40 : 0));
		out.push(0x1b, 0x69, 0x64, marginDots & 0xff, (marginDots >> 8) & 0xff);
		out.push(0x4d, 0x02);

		for (let x = 0; x < lines; x++) {
			const line = encodeLine(page, x, media);
			if (line.every((b) => b === 0)) {
				out.push(0x5a);
				continue;
			}
			const packed = packbits(Buffer.from(line));
			// The printer accepts at most 17 bytes per line; worst-case PackBits output is longer.
			const data = packed.length > LINE_BYTES ? [LINE_BYTES - 1, ...line] : packed;
			out.push(0x47, data.length & 0xff, data.length >> 8, ...data);
		}

		out.push(index === pages.length - 1 ? 0x1a : 0x0c);
	});

	return Uint8Array.from(out);
}
