<script lang="ts">
	import { resolve } from '$app/paths';
	import { cancelJob, forceJob, print } from '#lib/api/jobs.remote.js';
	import type { PrinterSnapshot } from '#lib/api/printers.remote.js';
	import type { Editor } from '#lib/client/editor.svelte.js';
	import { tapeLabel } from '#lib/colors.js';
	import { defaultHalfCut, tapeMismatch, wantedTape } from '#lib/printers/match.js';
	import NumberField from './NumberField.svelte';

	let { editor, snapshot }: { editor: Editor; snapshot: PrinterSnapshot | undefined } = $props();

	let jobId = $state<string | null>(null);
	let error = $state<string | null>(null);

	const printer = $derived(snapshot?.printers[0]);
	const loaded = $derived(printer?.status.media ?? null);
	const mismatch = $derived(tapeMismatch(editor.doc.media, loaded));
	const job = $derived(
		jobId
			? (snapshot?.queue.find((j) => j.id === jobId) ??
					snapshot?.recent.find((j) => j.id === jobId))
			: undefined
	);
	const othersQueued = $derived((snapshot?.queue ?? []).filter((j) => j.id !== jobId).length);

	interface Outcome {
		action: 'none' | 'queue' | 'print';
		hint?: string;
		/** The tape only differs in colour, so the label can be printed on it anyway. */
		force?: boolean;
	}

	/** What pressing Print will do with the printer and tape as they are now. */
	const outcome = $derived.by((): Outcome => {
		if (!printer) return { action: 'none', hint: 'No printer configured.' };
		if (!printer.status.online) {
			return { action: 'queue', hint: 'Printer offline. The job waits until it is back.' };
		}
		if (printer.status.errors.length) {
			return { action: 'queue', hint: `Printer: ${printer.status.errors.join(', ')}.` };
		}
		if (!loaded) return { action: 'queue', hint: 'No tape loaded. The job waits for one.' };
		if (mismatch) {
			return {
				action: 'queue',
				force: mismatch === 'colour',
				hint: `Waits for ${wantedTape(editor.doc.media, mismatch)}. Loaded: ${loaded.name}, ${tapeLabel(loaded)}.`
			};
		}
		return { action: 'print' };
	});

	/** Forgets the last job, e.g. when starting a new label. */
	export function reset() {
		jobId = null;
		error = null;
	}

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

	function onkeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			void submit();
		}
	}
</script>

<svelte:window {onkeydown} />

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
					checked={editor.halfCut ?? defaultHalfCut(loaded)}
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
		{#if outcome.force}
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
				{#if mismatch === 'colour'}
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
	{:else if outcome.hint}
		<div class="warn">{outcome.hint}</div>
	{/if}
	{#if othersQueued}
		<a class="muted small" href={resolve('/queue')}>
			{othersQueued}
			{othersQueued === 1 ? 'other job' : 'other jobs'} in the queue
		</a>
	{/if}
</div>

<style>
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
	.print {
		padding: 7px 18px;
	}
</style>
