<script lang="ts">
	import { resolve } from '$app/paths';
	import { print } from '#lib/api/jobs.remote.js';
	import { deleteLabel, listLabels } from '#lib/api/labels.remote.js';
	import LabelThumb from '#lib/components/LabelThumb.svelte';
	import { templateVariables } from '#lib/label/template.js';
	import { getMedia } from '#lib/media.js';

	const labels = listLabels();
	let message = $state('');

	async function quickPrint(label: NonNullable<typeof labels.current>[number]) {
		await print({ doc: label.doc, name: label.name, labelId: label.id });
		message = `Sent ${label.name}.`;
	}

	async function remove(id: string, name: string) {
		if (!confirm(`Delete ${name}?`)) return;
		await deleteLabel(id);
	}
</script>

<h1>Saved</h1>
{#if message}<p class="muted">{message}</p>{/if}

{#if labels.current?.length === 0}
	<p class="muted">Nothing saved yet.</p>
{/if}

{#each labels.current ?? [] as label (label.id)}
	<section class="label">
		<div class="row">
			<a href="{resolve('/')}?label={label.id}"><strong>{label.name}</strong></a>
			<span class="muted">{getMedia(label.doc.media.id)?.name ?? label.doc.media.id}</span>
			<span class="spacer"></span>
			{#if templateVariables(label.doc).length === 0}
				<button onclick={() => quickPrint(label)}>Print</button>
			{/if}
			<a class="button" href="{resolve('/')}?label={label.id}">Edit</a>
			<button onclick={() => remove(label.id, label.name)}>Delete</button>
		</div>
		<LabelThumb doc={label.doc} />
	</section>
{/each}

<style>
	.label {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
