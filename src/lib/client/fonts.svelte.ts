import { FontRegistry } from '#lib/render/fonts.js';

export const fontRegistry = new FontRegistry();

/** Bumped whenever a font finishes loading so previews re-render. */
export const fontState = $state({ version: 0 });

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a load cache, not UI state
const pending = new Map<string, Promise<void>>();

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- registration cache, not UI state
const cssFamilies = new Set<string>();

/** Registers the font with the browser so it can be used in CSS, and returns the family name. */
export function cssFamily(id: string): string {
	const family = `label-${id}`;
	if (!cssFamilies.has(id)) {
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
