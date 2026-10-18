<script lang="ts">
	import { listTapes } from '#lib/api/tapes.remote.js';
	import type { Editor } from '#lib/client/editor.svelte.js';
	import { tapeLabel } from '#lib/colors.js';
	import { getMedia, MEDIA, mediaKey, type MediaGeometry } from '#lib/media.js';
	import type { LoadedMedia } from '#lib/printers/types.js';
	import type { RenderedLabel } from '#lib/render/render.js';
	import NumberField from './NumberField.svelte';
	import TapePicker, { type TapeOption } from './TapePicker.svelte';

	interface Props {
		editor: Editor;
		rendered: RenderedLabel;
		media: MediaGeometry;
		loaded: LoadedMedia | null;
	}

	let { editor, rendered, media, loaded }: Props = $props();

	const tapes = listTapes();

	const lengthIssue = $derived(
		rendered.issues.find((i) => !i.info && !i.blockId && i.field === 'length')
	);

	const tapeOptions = $derived.by((): TapeOption[] => {
		const loadedKey = loaded ? mediaKey(loaded) : undefined;
		const options: TapeOption[] = (tapes.current ?? [])
			.filter((t) => t.status !== 'empty')
			.map((t) => {
				const key = mediaKey({ ...t, id: t.mediaId });
				return {
					key,
					media: { id: t.mediaId, tape: t.tape ?? undefined, text: t.text ?? undefined },
					title: `${getMedia(t.mediaId)?.name ?? t.mediaId}, ${tapeLabel(t)}`,
					detail: [t.partNumber, t.status === 'low' ? 'low' : ''].filter(Boolean).join(' · '),
					loaded: key === loadedKey
				};
			});
		// Nothing has been inserted yet, so there is nothing else to offer.
		if (!options.length) {
			for (const m of MEDIA) options.push({ key: mediaKey(m), media: { id: m.id }, title: m.name });
		}
		const current = mediaKey(editor.doc.media);
		if (!options.some((o) => o.key === current)) {
			options.unshift({
				key: current,
				media: editor.doc.media,
				title: `${media.name}, ${tapeLabel(editor.doc.media)}`,
				detail: 'not in your tapes'
			});
		}
		return options;
	});

	function toggleFixedLength(fixed: boolean) {
		editor.doc.length = fixed ? Math.ceil(rendered.tapeMm) : undefined;
	}
</script>

<section class="settings">
	<div class="field">
		<span class="muted small">Tape</span>
		<TapePicker
			options={tapeOptions}
			current={mediaKey(editor.doc.media)}
			doc={editor.doc}
			vars={editor.vars}
			onpick={(option) => editor.setMedia(option.media)}
		/>
	</div>
	<label>
		Orientation
		<select
			value={editor.doc.orientation ?? 'landscape'}
			onchange={(e) =>
				(editor.doc.orientation = e.currentTarget.value === 'portrait' ? 'portrait' : undefined)}
		>
			<option value="landscape">landscape</option>
			<option value="portrait">portrait</option>
		</select>
	</label>
	<label>
		Layout
		<select
			value={editor.doc.layout ?? 'row'}
			onchange={(e) => editor.setLayout(e.currentTarget.value as 'row' | 'free', rendered, media)}
		>
			<option value="row">in a row</option>
			<option value="free">free</option>
		</select>
	</label>
	<label class="check">
		<input
			type="checkbox"
			checked={editor.doc.length !== undefined}
			onchange={(e) => toggleFixedLength(e.currentTarget.checked)}
		/>
		Fixed length
	</label>
	{#if editor.doc.length !== undefined}
		<div class="pair">
			<NumberField
				label="Length (mm)"
				bind:value={editor.doc.length}
				min={0}
				max={1000}
				required
				error={lengthIssue?.message}
			/>
			{#if !editor.free}
				<label>
					Position
					<select bind:value={editor.doc.justify}>
						<option value="start">start</option>
						<option value={undefined}>center</option>
						<option value="end">end</option>
					</select>
				</label>
			{/if}
		</div>
	{:else if lengthIssue}
		<span class="error">{lengthIssue.message}</span>
	{/if}
	<div class="pair">
		{#if !editor.free}
			<NumberField
				label="Gap (mm)"
				bind:value={editor.doc.gap}
				min={0}
				max={100}
				step={0.5}
				placeholder="2"
			/>
		{/if}
		<NumberField
			label="Padding (mm)"
			bind:value={editor.doc.padding}
			min={0}
			max={100}
			step={0.5}
			placeholder="0"
		/>
	</div>
	{#if media.highRes}
		<label class="check">
			<input
				type="checkbox"
				checked={!!editor.doc.highRes}
				onchange={(e) => (editor.doc.highRes = e.currentTarget.checked || undefined)}
			/>
			High resolution
		</label>
	{/if}
</section>

<style>
	.settings {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
</style>
