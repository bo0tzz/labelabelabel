import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initRaster } from '#lib/render/raster.js';

export function initServerRaster() {
	const wasm = createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
	return initRaster(readFileSync(wasm));
}
