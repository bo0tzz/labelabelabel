<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { listFonts } from '#lib/api/fonts.remote.js';
	import { cancelJob, forceJob, getJob, print } from '#lib/api/jobs.remote.js';
	import { getLabel, saveLabel } from '#lib/api/labels.remote.js';
	import { printerState } from '#lib/api/printers.remote.js';
	import { listTapes } from '#lib/api/tapes.remote.js';
	import { Editor } from '#lib/client/editor.svelte.js';
	import { ensureFont, fontRegistry, fontState } from '#lib/client/fonts.svelte.js';
	import { tapeLabel } from '#lib/colors.js';
	import BlockFields from '#lib/components/BlockFields.svelte';
	import NumberField from '#lib/components/NumberField.svelte';
	import Preview from '#lib/components/Preview.svelte';
	import TapePicker, { type TapeOption } from '#lib/components/TapePicker.svelte';
	import type { Block, BlockType } from '#lib/label/types.js';
	import { getMedia, MEDIA } from '#lib/media.js';
	import { renderLabel } from '#lib/render/render.js';

	const editor = new Editor();
	const live = printerState();
	const fonts = listFonts();
	const tapes = listTapes();

	let ready = $state(false);
	let jobId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let saving = $state(false);

	const printer = $derived(live.current?.printers[0]);
	const loaded = $derived(printer?.status.media ?? null);
	const media = $derived(getMedia(editor.doc.media.id) ?? getMedia('tze-12')!);
	const job = $derived(
		jobId
			? (live.current?.queue.find((j) => j.id === jobId) ??
					live.current?.recent.find((j) => j.id === jobId))
			: undefined
	);

	const othersQueued = $derived((live.current?.queue ?? []).filter((j) => j.id !== jobId).length);

	const rendered = $derived.by(() => {
		void fontState.version;
		return renderLabel($state.snapshot(editor.doc), media, {
			fonts: fontRegistry,
			vars: $state.snapshot(editor.vars)
		});
	});
	const blockIssues = (id: string) => rendered.issues.filter((i) => i.blockId === id);
	const problemIds = $derived([
		...new Set(rendered.issues.flatMap((i) => (i.blockId ? [i.blockId] : [])))
	]);
	const lengthIssue = $derived(rendered.issues.find((i) => !i.blockId && i.field === 'length'));
	const otherIssues = $derived(rendered.issues.filter((i) => !i.blockId && i.field !== 'length'));

	const TYPE_NAMES: Record<BlockType, string> = {
		text: 'Text',
		qr: 'QR',
		line: 'Line',
		space: 'Space',
		bitmap: 'Drawing'
	};

	function summary(block: Block) {
		switch (block.type) {
			case 'text':
				return block.text.split('\n')[0] || '(empty)';
			case 'qr':
				return block.data || '(empty)';
			case 'line':
				return `${block.thickness} dots, ${block.direction ?? 'across'}`;
			case 'space':
				return `${block.width ?? 0} mm`;
			case 'bitmap':
				return `${block.w}×${block.h}`;
		}
	}

	const mediaKey = (m: { id: string; tape?: string | null; text?: string | null }) =>
		`${m.id}|${m.tape ?? ''}|${m.text ?? ''}`;

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

	/** What pressing Print will do with the printer and tape as they are now. */
	const outcome = $derived.by(() => {
		if (!printer) return { action: 'none', hint: 'No printer configured.' } as const;
		if (!printer.status.online) {
			return { action: 'queue', hint: 'Printer offline. The job waits until it is back.' } as const;
		}
		if (printer.status.errors.length) {
			return { action: 'queue', hint: `Printer: ${printer.status.errors.join(', ')}.` } as const;
		}
		if (!loaded)
			return { action: 'queue', hint: 'No tape loaded. The job waits for one.' } as const;
		const want = editor.doc.media;
		const colours = want.tape || want.text ? `, ${tapeLabel(want)}` : '';
		const loadedText = `Loaded: ${loaded.name}, ${tapeLabel(loaded)}.`;
		if (loaded.id !== want.id) {
			return { action: 'queue', hint: `Waits for ${media.name}${colours}. ${loadedText}` } as const;
		}
		const wrongColour =
			(want.tape && want.tape !== loaded.tape) || (want.text && want.text !== loaded.text);
		if (wrongColour) {
			return {
				action: 'queue',
				force: true,
				hint: `Waits for ${tapeLabel(want)}. ${loadedText}`
			} as const;
		}
		return { action: 'print', hint: null } as const;
	});
	const hint = $derived(outcome.hint);

	$effect(() => {
		for (const block of editor.doc.blocks) {
			if (block.type === 'text') ensureFont(block.font).catch(() => {});
		}
	});

	$effect(() => {
		if (!ready || !editor.pristineMedia || !loaded) return;
		const next = { id: loaded.id, tape: loaded.tape, text: loaded.text };
		untrack(() => {
			if (mediaKey(editor.doc.media) !== mediaKey(next)) editor.doc.media = next;
		});
	});

	$effect(() => {
		if (!ready) return;
		void JSON.stringify(editor.doc);
		const timer = setTimeout(() => editor.record(), 400);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!ready) return;
		void JSON.stringify(editor.doc);
		void JSON.stringify(editor.vars);
		void editor.name;
		void editor.saved;
		const timer = setTimeout(() => editor.saveDraft(), 300);
		return () => clearTimeout(timer);
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
			if (labelId || fromJob) history.replaceState(history.state, '', '/');
			ready = true;
		}
	});

	async function submit(force = false) {
		error = null;
		try {
			jobId = await print({
				doc: $state.snapshot(editor.doc),
				name: editor.displayName,
				vars: $state.snapshot(editor.vars),
				copies: editor.copies,
				options: { halfCut: editor.halfCut, chain: editor.chain, force },
				labelId: editor.labelId
			});
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function save(copy = false) {
		error = null;
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
			error = (e as Error).message;
		} finally {
			saving = false;
		}
	}

	function clear() {
		const hasContent = editor.doc.blocks.some((b) => b.type !== 'text' || b.text.trim());
		if (editor.dirty && hasContent && !confirm('Discard this label?')) return;
		editor.clear();
		jobId = null;
	}

	function toggleFixedLength(fixed: boolean) {
		editor.doc.length = fixed ? Math.ceil(rendered.tapeMm) : undefined;
	}

	function onkeydown(event: KeyboardEvent) {
		const mod = event.ctrlKey || event.metaKey;
		if (mod && event.key === 'Enter') {
			event.preventDefault();
			void submit();
			return;
		}
		// Text fields keep their own undo.
		const target = event.target as HTMLElement | null;
		if (target?.closest('input, textarea, select')) return;
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
	{#if editor.labelId}
		<span class="muted small">{editor.dirty ? 'unsaved changes' : 'saved'}</span>
	{/if}
</div>

<section class="preview">
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
	<section class="blocks">
		{#each editor.doc.blocks as block, i (block.id)}
			{@const issues = blockIssues(block.id)}
			<div class="block" class:selected={block.id === editor.selectedId}>
				<div class="head">
					<button
						class="summary"
						onclick={() => (editor.selectedId = block.id === editor.selectedId ? null : block.id)}
					>
						<span class="type">{TYPE_NAMES[block.type]}</span>
						<span class="text">{summary(block)}</span>
						{#if issues.length}<span class="warn" title={issues[0].message}>!</span>{/if}
					</button>
					{#if !editor.free}
						<button title="Move left" disabled={i === 0} onclick={() => editor.move(block.id, -1)}
							>←</button
						>
						<button
							title="Move right"
							disabled={i === editor.doc.blocks.length - 1}
							onclick={() => editor.move(block.id, 1)}>→</button
						>
					{/if}
					<button title="Remove" onclick={() => editor.remove(block.id)}>×</button>
				</div>
				{#if block.id === editor.selectedId}
					<BlockFields
						bind:block={editor.doc.blocks[i]}
						fonts={fonts.current ?? []}
						{issues}
						free={editor.free}
					/>
				{/if}
			</div>
		{/each}
		<div class="row add">
			<span class="muted">Add</span>
			<button onclick={() => editor.add('text')}>Text</button>
			<button onclick={() => editor.add('qr')}>QR</button>
			<button onclick={() => editor.add('line')}>Line</button>
			{#if !editor.free}
				<button onclick={() => editor.add('space')}>Space</button>
			{/if}
		</div>
	</section>

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
				<input type="checkbox" bind:checked={editor.doc.highRes} />
				High resolution
			</label>
		{/if}
	</section>
</div>

<div class="printbar">
	{#if editor.variables.length}
		<div class="vars">
			{#each editor.variables as name (name)}
				<label>
					{name}
					<input type="text" bind:value={editor.vars[name]} />
				</label>
			{/each}
		</div>
	{/if}
	<div class="row">
		<NumberField label="Copies" bind:value={editor.copies} min={1} max={99} integer required />
		{#if printer?.capabilities.halfCut}
			<label
				class="check"
				title="Cut through the label but not the backing, so the blank lead stays attached instead of falling out as a scrap."
			>
				<input
					type="checkbox"
					checked={editor.halfCut ?? loaded?.kind === 'laminated'}
					onchange={(e) => (editor.halfCut = e.currentTarget.checked)}
				/>
				Half cut
			</label>
		{/if}
		{#if printer?.capabilities.chain}
			<label
				class="check"
				title="Skip the blank offcut. The label comes out when the next one is printed, or with Feed & cut."
			>
				<input type="checkbox" bind:checked={editor.chain} /> Chain
			</label>
		{/if}
		<span class="spacer"></span>
		{#if 'force' in outcome}
			<button onclick={() => submit(true)}>Print on loaded tape</button>
		{/if}
		<button class="primary print" onclick={() => submit()} disabled={outcome.action === 'none'}>
			{outcome.action === 'queue' ? 'Queue' : 'Print'}
		</button>
	</div>
	{#if error}
		<div class="bad">{error}</div>
	{:else if job}
		<div class="row">
			{#if job.status === 'waiting'}
				<span class="warn">Waiting: {job.error}</span>
				{#if job.error?.startsWith('needs') && loaded?.id === editor.doc.media.id}
					<button onclick={() => forceJob(job.id)}>Print anyway</button>
				{/if}
				<button onclick={() => cancelJob(job.id)}>Cancel</button>
			{:else if job.status === 'queued' || job.status === 'printing'}
				<span>{job.status === 'printing' ? 'Printing…' : 'Queued'}</span>
				<button onclick={() => cancelJob(job.id)}>Cancel</button>
			{:else if job.status === 'done'}
				<span class="muted">Printed.</span>
			{:else if job.status === 'failed'}
				<span class="bad">Failed: {job.error}</span>
			{:else}
				<span class="muted">Canceled.</span>
			{/if}
		</div>
	{:else if hint}
		<div class="warn">{hint}</div>
	{/if}
	{#if othersQueued}
		<a class="muted small" href={resolve('/queue')}>
			{othersQueued}
			{othersQueued === 1 ? 'other job' : 'other jobs'} in the queue
		</a>
	{/if}
</div>

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
	.small {
		font-size: 0.85rem;
	}
	.info {
		font-size: 0.85rem;
		margin-top: 4px;
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
	.columns section {
		margin: 0;
	}
	.block {
		border: 1px solid var(--border);
		border-radius: 4px;
		margin-bottom: 6px;
	}
	.block.selected {
		border-color: var(--accent);
	}
	.block :global(.fields) {
		padding: 8px;
		border-top: 1px solid var(--border);
	}
	.head {
		display: flex;
		gap: 4px;
		padding: 4px;
	}
	.head button:not(.summary) {
		padding: 2px 8px;
	}
	.summary {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 8px;
		border: none;
		background: none;
		text-align: left;
	}
	.summary .type {
		color: var(--muted);
		width: 3.5em;
		flex-shrink: 0;
	}
	.summary .text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.summary .warn {
		font-weight: bold;
	}
	.add {
		margin-top: 8px;
	}
	.settings {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.printbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 8px max(16px, calc((100vw - 1100px) / 2 + 16px));
		background: var(--panel);
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.vars {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 6px 12px;
	}
	.printbar :global(.field) {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.printbar :global(.field input) {
		width: 3.5em;
	}
	.spacer {
		flex: 1;
	}
	.print {
		padding: 7px 18px;
	}
</style>
