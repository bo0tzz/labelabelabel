import { applyPaletteSync, utils } from 'image-q';
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

	const palette = new utils.Palette();
	palette.add(utils.Point.createByRGBA(0, 0, 0, 255));
	palette.add(utils.Point.createByRGBA(255, 255, 255, 255));
	const dots = applyPaletteSync(utils.PointContainer.fromUint8Array(data, width, height), palette, {
		imageQuantization: dither ? 'floyd-steinberg' : 'nearest'
	}).toUint8Array();

	const bitmap = createBitmap(width, height);
	for (let i = 0; i < bitmap.data.length; i++) bitmap.data[i] = dots[i * 4] === 0 ? 1 : 0;
	return bitmap;
}
