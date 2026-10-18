<script lang="ts">
	import { ensureFontsFor, fontRegistry, fontState } from '#lib/client/fonts.svelte.js';
	import type { Label } from '#lib/label/types.js';
	import { getMedia } from '#lib/media.js';
	import { renderLabel } from '#lib/render/render.js';
	import Preview from './Preview.svelte';

	let {
		doc,
		vars,
		scale = 0.5
	}: { doc: Label; vars?: Record<string, string> | null; scale?: number } = $props();

	const media = $derived(getMedia(doc.media.id) ?? getMedia('tze-12')!);

	$effect(() => ensureFontsFor(doc));

	const rendered = $derived.by(() => {
		void fontState.version;
		return renderLabel(doc, media, { fonts: fontRegistry, vars: vars ?? undefined });
	});
</script>

<Preview
	{rendered}
	{media}
	tape={doc.media.tape}
	text={doc.media.text}
	fixedScale={scale}
	portrait={doc.orientation === 'portrait'}
/>
