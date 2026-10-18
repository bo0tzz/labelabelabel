/**
 * 1-bit image in label space: x runs along the tape in reading direction, y runs across it
 * with 0 at the top edge. One byte per pixel, 1 = ink.
 */
export interface Bitmap {
	width: number;
	height: number;
	data: Uint8Array;
}

export function createBitmap(width: number, height: number): Bitmap {
	return { width, height, data: new Uint8Array(width * height) };
}

export function getPixel(bitmap: Bitmap, x: number, y: number): number {
	if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return 0;
	return bitmap.data[y * bitmap.width + x];
}

export function setPixel(bitmap: Bitmap, x: number, y: number, value = 1): void {
	if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
	bitmap.data[y * bitmap.width + x] = value;
}

export function fillRect(bitmap: Bitmap, x: number, y: number, w: number, h: number, value = 1) {
	for (let yy = y; yy < y + h; yy++) {
		for (let xx = x; xx < x + w; xx++) setPixel(bitmap, xx, yy, value);
	}
}

export function strokeRect(bitmap: Bitmap, x: number, y: number, w: number, h: number) {
	fillRect(bitmap, x, y, w, 1);
	fillRect(bitmap, x, y + h - 1, w, 1);
	fillRect(bitmap, x, y, 1, h);
	fillRect(bitmap, x + w - 1, y, 1, h);
}

export function blit(target: Bitmap, source: Bitmap, dx: number, dy: number) {
	for (let y = 0; y < source.height; y++) {
		for (let x = 0; x < source.width; x++) {
			if (source.data[y * source.width + x]) setPixel(target, dx + x, dy + y);
		}
	}
}
