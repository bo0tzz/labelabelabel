import { createBitmap, type Bitmap } from '#lib/bitmap.js';

/**
 * Turns an image file into dots `height` pixels tall, keeping its aspect. `k` is pixels along
 * the tape per pixel across it. Dithering suits photos; thresholding suits line art and logos.
 */
export async function imageToBitmap(
	file: File,
	height: number,
	k: number,
	dither: boolean
): Promise<Bitmap> {
	const source = await createImageBitmap(file);
	// The head can't print lone half-dot columns, so dither patterns are made on whole dots.
	const step = dither ? k : 1;
	const square = toDots(source, height, k / step, dither);
	if (step === 1) return square;
	const stretched = createBitmap(square.width * step, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < stretched.width; x++) {
			stretched.data[y * stretched.width + x] =
				square.data[y * square.width + Math.floor(x / step)];
		}
	}
	return stretched;
}

function toDots(source: ImageBitmap, height: number, k: number, dither: boolean): Bitmap {
	const width = Math.max(1, Math.round((source.width / source.height) * height * k));
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(source, 0, 0, width, height);
	const { data } = ctx.getImageData(0, 0, width, height);

	const gray = new Float32Array(width * height);
	for (let i = 0; i < gray.length; i++) {
		const alpha = data[i * 4 + 3] / 255;
		const luma = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
		gray[i] = 255 - alpha * (255 - luma);
	}

	const bitmap = createBitmap(width, height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = y * width + x;
			const ink = gray[i] < 128;
			bitmap.data[i] = ink ? 1 : 0;
			if (!dither) continue;
			// Floyd–Steinberg: push the rounding error to unvisited neighbours.
			const error = gray[i] - (ink ? 0 : 255);
			if (x + 1 < width) gray[i + 1] += (error * 7) / 16;
			if (y + 1 < height) {
				if (x > 0) gray[i + width - 1] += (error * 3) / 16;
				gray[i + width] += (error * 5) / 16;
				if (x + 1 < width) gray[i + width + 1] += error / 16;
			}
		}
	}
	return bitmap;
}
