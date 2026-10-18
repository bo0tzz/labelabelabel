<script lang="ts">
	import { useDebounce } from 'runed';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { listFonts } from '#lib/api/fonts.remote.js';
	import { getJob } from '#lib/api/jobs.remote.js';
	import { getLabel, saveLabel } from '#lib/api/labels.remote.js';
	import { printerState } from '#lib/api/printers.remote.js';
	import { Editor } from '#lib/client/editor.svelte.js';
	import { ensureFontsFor, fontRegistry, fontState } from '#lib/client/fonts.svelte.js';
	import BlockList from '#lib/components/BlockList.svelte';
	import LabelSettings from '#lib/components/LabelSettings.svelte';
	import Preview from '#lib/components/Preview.svelte';
	import PrintBar from '#lib/components/PrintBar.svelte';
	import { getMedia } from '#lib/media.js';
	import { renderLabel } from '#lib/render/render.js';

	let editor = $state(new Editor());
	const live = printerState();
	const fonts = listFonts();

	let ready = $state(false);
	let saveError = $state<string | null>(null);
	let saving = $state(false);
	let printBar: PrintBar | undefined = $state();

	const loaded = $derived(live.current?.printers[0]?.status.media ?? null);
	const media = $derived(getMedia(editor.doc.media.id) ?? getMedia('tze-12')!);

	const rendered = $derived.by(() => {
		void fontState.version;
		return renderLabel($state.snapshot(editor.doc), media, {
			fonts: fontRegistry,
			vars: $state.snapshot(editor.vars)
		});
	});
	const problems = $derived(rendered.issues.filter((i) => !i.info));
	const problemIds = $derived([
		...new Set(problems.flatMap((i) => (i.blockId ? [i.blockId] : [])))
	]);
	const otherIssues = $derived(problems.filter((i) => !i.blockId && i.field !== 'length'));

	/** CSS pixels per dot; null fits the preview to the page. */
	let zoom = $state<number | null>(null);
	function zoomBy(step: number) {
		const current = zoom ?? 2;
		const next = Math.min(16, Math.max(1, current + step * (current >= 4 ? 2 : 1)));
		zoom = next;
	}

	const draw = $derived.by(() => {
		const block = editor.selected;
		if (block?.type !== 'bitmap' || editor.tool === 'select') return null;
		return { block, erase: editor.tool === 'eraser', brush: editor.brush };
	});

	// Drawing happens dot for dot, so a drawing made at another resolution is converted first.
	$effect(() => {
		const block = editor.selected;
		const { along, across } = rendered.dpi;
		if (block?.type === 'bitmap' && editor.tool !== 'select') {
			if (block.dpi[0] !== along || block.dpi[1] !== across) {
				untrack(() => editor.setTool(editor.tool, rendered.dpi));
			}
		}
	});

	$effect(() => ensureFontsFor(editor.doc));

	$effect(() => {
		if (!ready || !loaded || !editor.pristineMedia) return;
		const tape = { id: loaded.id, tape: loaded.tape, text: loaded.text };
		untrack(() => editor.followLoadedTape(tape));
	});

	const saveDraft = useDebounce(() => editor.saveDraft(), 300);

	$effect(() => {
		if (!ready) return;
		void JSON.stringify(editor.doc);
		void JSON.stringify(editor.vars);
		void editor.name;
		void editor.saved;
		untrack(() => saveDraft());
	});

	onMount(async () => {
		const params = page.url.searchParams;
		const labelId = params.get('label');
		const fromJob = params.get('job');
		try {
			if (labelId) {
				const row = await getLabel(labelId);
				if (row) {
					editor.load({ doc: row.doc, name: row.name, vars: {} });
					editor.markSaved(row.id);
				}
			} else if (fromJob) {
				const row = await getJob(fromJob);
				if (row) editor.load({ doc: row.doc, name: row.name, vars: row.vars ?? {} });
			} else {
				editor.restoreDraft();
			}
		} finally {
			if (labelId || fromJob) void goto(resolve('/'), { replace: true, shallow: true, state: {} });
			ready = true;
		}
	});

	async function save(copy = false) {
		saveError = null;
		saving = true;
		try {
			if (copy) editor.name = `${editor.displayName} (copy)`;
			editor.name = editor.name.trim() || editor.displayName;
			const id = await saveLabel({
				id: copy ? undefined : editor.labelId,
				name: editor.name,
				doc: $state.snapshot(editor.doc)
			});
			editor.markSaved(id);
		} catch (e) {
			saveError = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	function clear() {
		const hasContent = editor.doc.blocks.some((b) => b.type !== 'text' || b.text.trim());
		if (editor.dirty && hasContent && !confirm('Discard this label?')) return;
		editor.clear();
		printBar?.reset();
	}

	function onkeydown(event: KeyboardEvent) {
		// Text fields keep their own undo.
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select')) return;
		const mod = event.ctrlKey || event.metaKey;
		const key = event.key.toLowerCase();
		if (mod && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) editor.redo();
			else editor.undo();
		} else if (mod && key === 'y') {
			event.preventDefault();
			editor.redo();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="toolbar">
	<input
		class="name"
		type="text"
		aria-label="Name"
		placeholder={editor.displayName}
		bind:value={editor.name}
	/>
	<button onclick={() => save()} disabled={saving}>Save</button>
	{#if editor.labelId}
		<button onclick={() => save(true)} disabled={saving}>Save copy</button>
	{/if}
	<button onclick={() => editor.undo()} disabled={!editor.canUndo} title="Undo">Undo</button>
	<button onclick={() => editor.redo()} disabled={!editor.canRedo} title="Redo">Redo</button>
	<button onclick={clear}>Clear</button>
	{#if saveError}
		<span class="bad small">{saveError}</span>
	{:else if editor.labelId}
		<span class="muted small">{editor.dirty ? 'unsaved changes' : 'saved'}</span>
	{/if}
</div>

<section class="preview">
	<div class="row tools">
		{#if editor.selected?.type === 'bitmap'}
			<div class="segmented" role="group" aria-label="Tool">
				{#each [['select', 'Select'], ['pen', 'Pen'], ['eraser', 'Eraser']] as const as [tool, name] (tool)}
					<button
						class:active={editor.tool === tool}
						aria-pressed={editor.tool === tool}
						onclick={() => editor.setTool(tool, rendered.dpi)}>{name}</button
					>
				{/each}
			</div>
			{#if editor.tool !== 'select'}
				<div class="segmented" role="group" aria-label="Size">
					{#each [1, 2, 3, 5, 8] as size (size)}
						<button
							class:active={editor.brush === size}
							aria-pressed={editor.brush === size}
							title="{size} dots"
							onclick={() => (editor.brush = size)}>{size}</button
						>
					{/each}
				</div>
			{/if}
		{/if}
		<span class="spacer"></span>
		<div class="segmented" role="group" aria-label="Zoom">
			<button title="Zoom out" disabled={zoom === null} onclick={() => zoomBy(-1)}>−</button>
			<button title="Fit" class:active={zoom === null} onclick={() => (zoom = null)}>
				{zoom === null ? 'fit' : `${zoom}×`}
			</button>
			<button title="Zoom in" onclick={() => zoomBy(1)}>+</button>
		</div>
	</div>
	<Preview
		{rendered}
		{media}
		tape={editor.doc.media.tape ?? loaded?.tape}
		text={editor.doc.media.text ?? loaded?.text}
		selectedId={editor.selectedId}
		{problemIds}
		free={editor.free}
		onselect={(id) => (editor.selectedId = id)}
		ondragstart={(id) => editor.dragStart(id)}
		ondrag={(id, box, start) => editor.drag(id, box, start, rendered.dpi)}
		onreorder={(id, index) => editor.reorder(id, index)}
		onnudge={editor.free ? (dx, dy) => editor.nudge(dx, dy, rendered.dpi) : undefined}
		fixedScale={zoom ?? undefined}
		portrait={editor.doc.orientation === 'portrait'}
		{draw}
		ondraw={(id, data) => editor.setDrawing(id, data)}
	/>
	<div class="row muted info">
		<span>{rendered.tapeMm.toFixed(1)} mm</span>
		<span>{media.name}{editor.doc.highRes ? ', high res' : ''}</span>
		{#if editor.free}<span>drag to move, corners to resize, arrow keys to nudge</span>{/if}
		{#each otherIssues as issue (issue.message)}
			<span class="warn">{issue.message}</span>
		{/each}
	</div>
</section>

<div class="columns">
	<BlockList bind:editor {rendered} {media} fonts={fonts.current ?? []} />
	<LabelSettings {editor} {rendered} {media} {loaded} />
</div>

<PrintBar bind:this={printBar} {editor} snapshot={live.current} />

<style>
	.toolbar {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.toolbar .name {
		flex: 1;
		min-width: 12em;
	}
	.info {
		font-size: 0.85rem;
		margin-top: 4px;
	}
	.tools {
		margin-bottom: 4px;
	}
	.segmented {
		display: inline-flex;
	}
	.segmented button {
		border-radius: 0;
		margin-left: -1px;
		min-width: 2.4em;
	}
	.segmented button:first-child {
		border-radius: 4px 0 0 4px;
		margin-left: 0;
	}
	.segmented button:last-child {
		border-radius: 0 4px 4px 0;
	}
	.segmented button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.columns {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		gap: 12px;
		align-items: start;
	}
	@media (max-width: 760px) {
		.columns {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
