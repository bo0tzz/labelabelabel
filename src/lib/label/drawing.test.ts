import { describe, expect, it } from 'vitest';
import { createBitmap, setPixel } from '#lib/bitmap.js';
import { decodeBitmapData, encodeBitmapData } from '#lib/render/render.js';
import { convertDrawing, emptyDrawing, invertDrawing, resizeDrawing } from './drawing.js';
import type { BitmapBlock } from './types.js';

function drawing(w: number, h: number, dots: [number, number][]): BitmapBlock {
	const image = createBitmap(w, h);
	for (const [x, y] of dots) setPixel(image, x, y);
	return { id: 'd', type: 'bitmap', w, h, dpi: [180, 180], data: encodeBitmapData(image) };
}

const dots = (block: BitmapBlock) => {
	const image = decodeBitmapData(block.data, block.w, block.h);
	const out: [number, number][] = [];
	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) if (image.data[y * image.width + x]) out.push([x, y]);
	}
	return out;
};

describe('drawings', () => {
	it('starts empty', () => {
		const block = { ...drawing(10, 4, []), data: emptyDrawing(10, 4) };
		expect(dots(block)).toEqual([]);
	});

	it('keeps the drawing when the canvas grows or shrinks', () => {
		const block = drawing(10, 4, [
			[1, 1],
			[8, 2]
		]);
		resizeDrawing(block, 20, 4);
		expect(dots(block)).toEqual([
			[1, 1],
			[8, 2]
		]);
		resizeDrawing(block, 5, 4);
		expect(dots(block)).toEqual([[1, 1]]);
	});

	it('shifts the drawing when the canvas grows at the start', () => {
		const block = drawing(10, 4, [[1, 1]]);
		resizeDrawing(block, 13, 4, 3, 0);
		expect(dots(block)).toEqual([[4, 1]]);
	});

	it('doubles along the tape when converted to high resolution', () => {
		const block = drawing(4, 2, [[1, 0]]);
		convertDrawing(block, [360, 180]);
		expect(block.w).toBe(8);
		expect(dots(block)).toEqual([
			[2, 0],
			[3, 0]
		]);
	});

	it('inverts', () => {
		const block = drawing(2, 1, [[0, 0]]);
		invertDrawing(block);
		expect(dots(block)).toEqual([[1, 0]]);
	});
});
