import wasm from '@resvg/resvg-wasm/index_bg.wasm?url';
import { browser } from '$app/env';
import type { Label } from '#lib/label/types.js';
import { initRaster } from '#lib/render/raster.js';
import { FontRegistry } from '#lib/render/fonts.js';

export const fontRegistry = new FontRegistry();

/** Bumped whenever a font or the rasterizer finishes loading so previews re-render. */
export const fontState = $state({ version: 0 });

if (browser) initRaster(fetch(wasm)).then(() => fontState.version++);

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a load cache, not UI state
const pending = new Map<string, Promise<void>>();

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- registration cache, not UI state
const cssFamilies = new Set<string>();

/** Registers the font with the browser so it can be used in CSS, and returns the family name. */
export function cssFamily(id: string): string {
	const family = `label-${id}`;
	if (browser && !cssFamilies.has(id)) {
		cssFamilies.add(id);
		const face = new FontFace(family, `url(/fonts/${encodeURIComponent(id)})`);
		document.fonts.add(face);
		face.load().catch(() => {});
	}
	return family;
}

export function ensureFont(id: string): Promise<void> {
	if (fontRegistry.has(id)) return Promise.resolve();
	let promise = pending.get(id);
	if (!promise) {
		promise = fetch(`/fonts/${encodeURIComponent(id)}`)
			.then((res) => {
				if (!res.ok) throw new Error(`font ${id}: HTTP ${res.status}`);
				return res.arrayBuffer();
			})
			.then((data) => {
				fontRegistry.add(id, data);
				fontState.version++;
			});
		promise.catch(() => setTimeout(() => pending.delete(id), 10_000));
		pending.set(id, promise);
	}
	return promise;
}

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Loads the fonts a label needs, including the fallback font when it has emoji. */
export function ensureFontsFor(doc: Label) {
	for (const block of doc.blocks) {
		if (block.type !== 'text') continue;
		ensureFont(block.font).catch(() => {});
		if (EMOJI.test(block.text)) {
			fontRegistry.fallbackId = 'fallback';
			ensureFont('fallback').catch(() => {});
		}
	}
}
