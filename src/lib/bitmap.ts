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

/** Columns `left` to `right` of an image. */
export function crop(image: Bitmap, left: number, right: number): Bitmap {
	const out = createBitmap(right - left, image.height);
	for (let y = 0; y < image.height; y++) {
		out.data.set(
			image.data.subarray(y * image.width + left, y * image.width + right),
			y * out.width
		);
	}
	return out;
}

/** Scales by nearest neighbour; when shrinking, a target pixel gets ink if any source pixel had it. */
export function resample(source: Bitmap, fx: number, fy: number): Bitmap {
	const w = Math.max(1, Math.round(source.width * fx));
	const h = Math.max(1, Math.round(source.height * fy));
	const out = createBitmap(w, h);
	for (let y = 0; y < h; y++) {
		const sy0 = Math.floor(y / fy);
		const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) / fy));
		for (let x = 0; x < w; x++) {
			const sx0 = Math.floor(x / fx);
			const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) / fx));
			let on = 0;
			for (let sy = sy0; sy < sy1 && !on; sy++) {
				for (let sx = sx0; sx < sx1 && !on; sx++) on = source.data[sy * source.width + sx];
			}
			out.data[y * w + x] = on;
		}
	}
	return out;
}
