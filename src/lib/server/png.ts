import { encode } from 'fast-png';
import type { Bitmap } from '#lib/bitmap.js';

/** Encodes a bitmap as a grayscale PNG, ink black on white, scaled per axis. */
export function bitmapToPng(bitmap: Bitmap, scaleX = 1, scaleY = scaleX): Uint8Array {
	const width = bitmap.width * scaleX;
	const height = bitmap.height * scaleY;
	const data = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		const row = Math.floor(y / scaleY) * bitmap.width;
		for (let x = 0; x < width; x++) {
			data[y * width + x] = bitmap.data[row + Math.floor(x / scaleX)] ? 0 : 255;
		}
	}
	return encode({ width, height, data, channels: 1, depth: 8 });
}
