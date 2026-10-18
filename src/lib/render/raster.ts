import { initWasm, Resvg, type InitInput } from '@resvg/resvg-wasm';
import { createBitmap, type Bitmap } from '#lib/bitmap.js';

// resvg can only be initialised once per page or process, so the state outlives module reloads.
const state = globalThis as { resvgLoading?: Promise<void>; resvgReady?: boolean };

/** Loads resvg's WebAssembly; the browser and the server each call this once. */
export function initRaster(source: InitInput | Promise<InitInput>): Promise<void> {
	state.resvgLoading ??= initWasm(source).then(() => {
		state.resvgReady = true;
	});
	return state.resvgLoading;
}

export function rasterReady() {
	return !!state.resvgReady;
}

/** Renders SVG to a bitmap; a pixel gets ink once `threshold` of it is covered. */
export function rasterize(svg: string, threshold = 0.5): Bitmap {
	const resvg = new Resvg(svg, { shapeRendering: 2 });
	const image = resvg.render();
	try {
		const bitmap = createBitmap(image.width, image.height);
		const pixels = image.pixels;
		const min = Math.max(1, Math.round(threshold * 255));
		for (let i = 0; i < bitmap.data.length; i++) {
			if (pixels[i * 4 + 3] >= min) bitmap.data[i] = 1;
		}
		return bitmap;
	} finally {
		image.free();
		resvg.free();
	}
}
