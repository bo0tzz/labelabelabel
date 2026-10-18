import { base64ToUint8Array, uint8ArrayToBase64 } from 'uint8array-extras';
import { blit, createBitmap, resample, type Bitmap } from '#lib/bitmap.js';
import type { BitmapBlock } from './types.js';

export function decodeBitmapData(data: string, w: number, h: number): Bitmap {
	const bytes = base64ToUint8Array(data);
	const stride = Math.ceil(w / 8);
	const bitmap = createBitmap(w, h);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (bytes[y * stride + (x >> 3)] & (0x80 >> (x & 7))) bitmap.data[y * w + x] = 1;
		}
	}
	return bitmap;
}

export function encodeBitmapData(bitmap: Bitmap): string {
	const stride = Math.ceil(bitmap.width / 8);
	const bytes = new Uint8Array(stride * bitmap.height);
	for (let y = 0; y < bitmap.height; y++) {
		for (let x = 0; x < bitmap.width; x++) {
			if (bitmap.data[y * bitmap.width + x]) bytes[y * stride + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	return uint8ArrayToBase64(bytes);
}

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
