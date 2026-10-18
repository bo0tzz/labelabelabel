import { blit, createBitmap } from '#lib/bitmap.js';
import { decodeBitmapData, encodeBitmapData, resample } from '#lib/render/render.js';
import type { BitmapBlock } from './types.js';

export function emptyDrawing(w: number, h: number): string {
	return encodeBitmapData(createBitmap(w, h));
}

/** Changes the canvas size, keeping the drawing in place; `dx`/`dy` shift it within. */
export function resizeDrawing(block: BitmapBlock, w: number, h: number, dx = 0, dy = 0) {
	w = Math.max(1, Math.round(w));
	h = Math.max(1, Math.round(h));
	if (w === block.w && h === block.h && !dx && !dy) return;
	const next = createBitmap(w, h);
	blit(next, decodeBitmapData(block.data, block.w, block.h), dx, dy);
	block.w = w;
	block.h = h;
	block.data = encodeBitmapData(next);
}

/** Converts a drawing to another resolution so it can be drawn on dot for dot. */
export function convertDrawing(block: BitmapBlock, dpi: [number, number]) {
	if (block.dpi[0] === dpi[0] && block.dpi[1] === dpi[1]) return;
	const image = resample(
		decodeBitmapData(block.data, block.w, block.h),
		dpi[0] / block.dpi[0],
		dpi[1] / block.dpi[1]
	);
	block.w = image.width;
	block.h = image.height;
	block.dpi = dpi;
	block.data = encodeBitmapData(image);
}

export function invertDrawing(block: BitmapBlock) {
	const image = decodeBitmapData(block.data, block.w, block.h);
	for (let i = 0; i < image.data.length; i++) image.data[i] ^= 1;
	block.data = encodeBitmapData(image);
}
