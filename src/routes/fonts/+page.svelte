<script lang="ts">
	import { deleteFont, listFonts, uploadFont } from '#lib/api/fonts.remote.js';
	import LabelThumb from '#lib/components/LabelThumb.svelte';
	import type { Label } from '#lib/label/types.js';

	const fonts = listFonts();
	let sample = $state('Label 123');

	function sampleLabel(font: string): Label {
		return {
			v: 1,
			media: { id: 'tze-12' },
			blocks: [{ id: 's', type: 'text', text: sample, font }]
		};
	}

	async function remove(id: string, name: string) {
		if (!confirm(`Delete ${name}?`)) return;
		await deleteFont(id);
	}
</script>

<h1>Fonts</h1>

<section>
	<form {...uploadFont} enctype="multipart/form-data" class="row">
		<input {...uploadFont.fields.file.as('file')} accept=".ttf,.otf" required />
		<button>Upload</button>
		{#each uploadFont.fields.file.issues() ?? [] as issue (issue.message)}
			<span class="bad">{issue.message}</span>
		{/each}
	</form>
</section>

<label class="sample">
	Sample text
	<input type="text" bind:value={sample} />
</label>

{#each (fonts.current ?? []).filter((f) => !f.hidden) as font (font.id)}
	<section class="font">
		<div class="row">
			<strong>{font.name}</strong>
			<span class="muted small">
				{font.id}
				{#if font.pixelEm}· pixel font, {font.pixelEm} px{/if}
				{#if font.weights}· weight {font.weights[0]}–{font.weights[1]}{/if}
				{#if font.fill || font.pair}· filled and outlined icons{/if}
				{#if font.source === 'uploaded'}· uploaded{/if}
			</span>
			<span class="spacer"></span>
			{#if font.source === 'uploaded'}
				<button onclick={() => remove(font.id, font.name)}>Delete</button>
			{/if}
		</div>
		<LabelThumb doc={sampleLabel(font.id)} scale={1} />
	</section>
{/each}

<style>
	.font {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sample {
		max-width: 320px;
		margin-bottom: 12px;
	}
	.spacer {
		flex: 1;
	}
	.small {
		font-size: 0.8rem;
	}
</style>
