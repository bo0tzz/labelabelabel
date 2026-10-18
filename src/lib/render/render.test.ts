import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBitmap } from '#lib/bitmap.js';
import type { Label } from '#lib/label/types.js';
import { getMedia } from '#lib/media.js';
import { fillContours } from './fill.js';
import { FontRegistry } from './fonts.js';
import { decodeBitmapData, encodeBitmapData, renderLabel } from './render.js';

const fonts = new FontRegistry();
fonts.add('sans', readFileSync('fonts/atkinson-hyperlegible-next/AtkinsonHyperlegibleNext.ttf'));
fonts.add('pixel', readFileSync('fonts/departure-mono/DepartureMono-Regular.otf'));

const media12 = getMedia('tze-12')!;
const label = (blocks: Label['blocks'], extra: Partial<Label> = {}): Label => ({
	v: 1,
	media: { id: 'tze-12' },
	blocks,
	...extra
});

function ink(bitmap: { data: Uint8Array }) {
	return bitmap.data.reduce((a, b) => a + b, 0);
}

describe('fillContours', () => {
	it('fills exactly the pixels inside an axis-aligned square', () => {
		const bitmap = createBitmap(10, 10);
		fillContours(bitmap, [[2, 2, 7, 2, 7, 7, 2, 7]]);
		expect(ink(bitmap)).toBe(25);
		expect(bitmap.data[2 * 10 + 2]).toBe(1);
		expect(bitmap.data[7 * 10 + 7]).toBe(0);
	});

	it('leaves holes with opposite winding empty', () => {
		const bitmap = createBitmap(10, 10);
		fillContours(bitmap, [
			[0, 0, 10, 0, 10, 10, 0, 10],
			[3, 3, 3, 7, 7, 7, 7, 3]
		]);
		expect(ink(bitmap)).toBe(100 - 16);
	});
});

describe('renderLabel', () => {
	it('renders text to the printable height of the tape', () => {
		const result = renderLabel(
			label([{ id: 't', type: 'text', text: 'Hello', font: 'sans' }]),
			media12,
			{
				fonts
			}
		);
		expect(result.bitmap.height).toBe(70);
		expect(ink(result.bitmap)).toBeGreaterThan(200);
		expect(result.issues).toEqual([]);
	});

	it('pads short labels to the shortest piece the printer can cut', () => {
		const result = renderLabel(
			label([{ id: 't', type: 'text', text: 'i', font: 'sans' }]),
			media12,
			{
				fonts
			}
		);
		expect(result.tapeMm).toBe(24.5);
	});

	it('honours a fixed length including the feed', () => {
		const result = renderLabel(
			label([{ id: 't', type: 'text', text: 'Hi', font: 'sans' }], { length: 50 }),
			media12,
			{ fonts }
		);
		expect(result.tapeMm).toBeCloseTo(50, 0);
	});

	it('sizes QR modules to whole dots', () => {
		const result = renderLabel(label([{ id: 'q', type: 'qr', data: 'hello', quiet: 0 }]), media12, {
			fonts
		});
		// 21 modules fit 3 dots each in 70 dots.
		expect(result.blocks[0].width).toBe(63);
	});

	it('stretches QR codes over the whole height when asked', () => {
		const data = 'https://example.com/42';
		const plain = renderLabel(label([{ id: 'q', type: 'qr', data, quiet: 0 }]), media12, { fonts });
		expect(plain.issues.find((i) => i.info)?.message).toBe(
			'25 modules, 2 dots each: 50 of 70 dots'
		);

		const stretched = renderLabel(
			label([{ id: 'q', type: 'qr', data, quiet: 0, stretch: true }]),
			media12,
			{ fonts }
		);
		const { bitmap } = stretched;
		const rowHasInk = (y: number) =>
			bitmap.data.slice(y * bitmap.width, (y + 1) * bitmap.width).includes(1);
		// Finder patterns sit in the corners, so the first and last rows of the tape get ink.
		expect(rowHasInk(0)).toBe(true);
		expect(rowHasInk(69)).toBe(true);
		expect(stretched.blocks[0].width).toBe(70);
	});

	it('stretches QR codes over the whole height when asked', () => {
		const data = 'https://example.com/42';
		const plain = renderLabel(label([{ id: 'q', type: 'qr', data, quiet: 0 }]), media12, { fonts });
		expect(plain.issues.find((i) => i.info)?.message).toBe(
			'25 modules, 2 dots each: 50 of 70 dots'
		);

		const stretched = renderLabel(
			label([{ id: 'q', type: 'qr', data, quiet: 0, stretch: true }]),
			media12,
			{ fonts }
		);
		const { bitmap } = stretched;
		const rowHasInk = (y: number) =>
			bitmap.data.slice(y * bitmap.width, (y + 1) * bitmap.width).includes(1);
		// Finder patterns sit in the corners, so the first and last rows of the tape get ink.
		expect(rowHasInk(0)).toBe(true);
		expect(rowHasInk(69)).toBe(true);
		expect(stretched.blocks[0].width).toBe(70);
	});

	it('doubles widths along the tape in high resolution', () => {
		const normal = renderLabel(label([{ id: 'q', type: 'qr', data: 'hello', quiet: 0 }]), media12, {
			fonts
		});
		const high = renderLabel(
			label([{ id: 'q', type: 'qr', data: 'hello', quiet: 0 }], { highRes: true }),
			media12,
			{ fonts }
		);
		expect(high.dpi.along).toBe(360);
		expect(high.blocks[0].width).toBe(normal.blocks[0].width * 2);
	});

	it('renders pixel fonts at whole multiples of their grid', () => {
		const result = renderLabel(
			label([{ id: 't', type: 'text', text: 'H', font: 'pixel' }]),
			getMedia('tze-6')!,
			{ fonts }
		);
		const { bitmap } = result;
		// Every ink run along a row has a length that is a multiple of the pixel scale.
		const runs = new Set<number>();
		for (let y = 0; y < bitmap.height; y++) {
			let run = 0;
			for (let x = 0; x <= bitmap.width; x++) {
				const on = x < bitmap.width && bitmap.data[y * bitmap.width + x];
				if (on) run++;
				else if (run) {
					runs.add(run);
					run = 0;
				}
			}
		}
		const scale = Math.min(...runs);
		for (const r of runs) expect(r % scale).toBe(0);
	});

	it('fills in template variables', () => {
		const doc = label([{ id: 't', type: 'text', text: '{{name}}', font: 'sans' }]);
		const empty = renderLabel(doc, media12, { fonts, vars: { name: '' } });
		const filled = renderLabel(doc, media12, { fonts, vars: { name: 'Box' } });
		expect(ink(empty.bitmap)).toBe(0);
		expect(ink(filled.bitmap)).toBeGreaterThan(0);
	});

	it('runs rotated text across the tape', () => {
		const flat = renderLabel(
			label([{ id: 't', type: 'text', text: 'ABCDEF', font: 'sans' }]),
			media12,
			{
				fonts
			}
		);
		const turned = renderLabel(
			label([{ id: 't', type: 'text', text: 'ABCDEF', font: 'sans', rotate: 90 }]),
			media12,
			{ fonts }
		);
		expect(turned.issues).toEqual([]);
		// The line now has to fit across the 70 dot tape, so the block gets much narrower.
		expect(turned.blocks[0].width).toBeLessThan(flat.blocks[0].width / 2);
		expect(ink(turned.bitmap)).toBeGreaterThan(50);
	});

	it('turns text upside down at 180 degrees', () => {
		const render = (rotate?: 180) =>
			renderLabel(label([{ id: 't', type: 'text', text: 'L', font: 'sans', rotate }]), media12, {
				fonts
			}).bitmap;
		const up = render();
		const down = render(180);
		const rowInk = (b: typeof up, y: number) =>
			b.data.slice(y * b.width, (y + 1) * b.width).reduce((a, v) => a + v, 0);
		// The foot of the L is at the bottom normally and at the top when turned.
		const bottomHeavy = (b: typeof up) =>
			Math.max(...Array.from({ length: 35 }, (_, y) => rowInk(b, 35 + y))) >
			Math.max(...Array.from({ length: 35 }, (_, y) => rowInk(b, y)));
		expect(bottomHeavy(up)).toBe(true);
		expect(bottomHeavy(down)).toBe(false);
	});

	it('turns unstacked text across the tape in portrait', () => {
		const block = { id: 't', type: 'text', text: 'ABCDEF', font: 'sans' } as const;
		const portrait = renderLabel(
			{ ...label([{ ...block, stack: false }]), orientation: 'portrait' },
			media12,
			{ fonts }
		);
		const turned = renderLabel(label([{ ...block, rotate: 270 }]), media12, { fonts });
		expect(portrait.bitmap.data).toEqual(turned.bitmap.data);
	});

	it('stacks letters down the tape in portrait', () => {
		const doc = label([{ id: 't', type: 'text', text: 'hello', font: 'sans' }]);
		const flat = renderLabel(doc, media12, { fonts });
		const stacked = renderLabel({ ...doc, orientation: 'portrait' }, media12, { fonts });
		expect(stacked.issues).toEqual([]);
		// Five letters one after another, each about as tall as the tape is wide.
		expect(stacked.blocks[0].width).toBeGreaterThan(flat.blocks[0].width * 1.5);
	});

	it('warns when lines get too small to read', () => {
		const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
		const result = renderLabel(label([{ id: 't', type: 'text', text, font: 'sans' }]), media12, {
			fonts
		});
		expect(result.issues.map((i) => i.message)).toContain('text is too small to print legibly');
	});

	it('round-trips bitmap block data', () => {
		const bitmap = createBitmap(11, 3);
		bitmap.data[0] = 1;
		bitmap.data[10] = 1;
		bitmap.data[32] = 1;
		expect(decodeBitmapData(encodeBitmapData(bitmap), 11, 3).data).toEqual(bitmap.data);
	});
});
