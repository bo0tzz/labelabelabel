<script lang="ts">
	import { cancelJob } from '#lib/api/jobs.remote.js';
	import { feedAndCut, type PrinterSnapshot } from '#lib/api/printers.remote.js';
	import { tapeLabel } from '#lib/colors.js';
	import { tapeLengthMm } from '#lib/tapes.js';
	import TapeSwatch from './TapeSwatch.svelte';

	let { snapshot }: { snapshot: PrinterSnapshot | undefined } = $props();

	const printer = $derived(snapshot?.printers[0]);
	const queue = $derived(snapshot?.queue ?? []);
	const media = $derived(printer?.status.media);
	let feedError = $state<string | null>(null);

	const KIND: Record<string, string> = {
		laminated: 'laminated',
		'non-laminated': 'non-laminated',
		hs21: 'heat shrink 2:1',
		hs31: 'heat shrink 3:1'
	};

	const stateText = $derived.by(() => {
		if (!printer) return 'not configured';
		if (!printer.status.online) return 'offline';
		if (printer.status.errors.length) return printer.status.errors.join(', ');
		return printer.busy ? 'printing' : 'ready';
	});

	async function feed() {
		feedError = null;
		try {
			await feedAndCut();
		} catch (e) {
			feedError = (e as Error).message;
		}
	}
</script>

<button class="status" popovertarget="printer-panel">
	{#if !printer}
		<span class="muted">no printer</span>
	{:else if !printer.status.online}
		<span class="dot bad"></span> offline
	{:else}
		<span class="dot" class:busy={printer.busy} class:bad={printer.status.errors.length > 0}></span>
		{#if printer.status.errors.length}
			<span class="bad">{printer.status.errors.join(', ')}</span>
		{:else if media}
			<TapeSwatch tape={media.tape} text={media.text} />
			{media.name}
		{:else}
			no tape
		{/if}
	{/if}
	{#if queue.length}
		<span class="muted">· {queue.length} queued</span>
	{/if}
</button>

<div id="printer-panel" popover>
	{#if printer}
		<p>
			<strong>{printer.name}</strong>
			<span class="muted">{printer.model}</span>
		</p>
		<p class:bad={!printer.status.online || printer.status.errors.length > 0}>{stateText}</p>
		{#if media}
			<p class="tape">
				<TapeSwatch tape={media.tape} text={media.text} large />
				<span>
					{media.name}, {tapeLabel(media)}
					<br />
					<span class="muted">
						{KIND[media.kind] ?? media.kind}
						{#if printer.tape?.partNumber ?? media.partNumber}
							· {printer.tape?.partNumber ?? media.partNumber}{/if}
						{#if printer.tape}· ~{(
								Math.max(0, tapeLengthMm({ ...media, ...printer.tape }) - printer.tape.usedMm) /
								1000
							).toFixed(1)} m left{/if}
					</span>
				</span>
			</p>
		{:else if printer.status.online}
			<p class="muted">No tape.</p>
		{/if}

		{#if queue.length}
			<h2>Queue</h2>
			<ul>
				{#each queue as job (job.id)}
					<li class="row">
						<span class="name">{job.name}</span>
						<span class:warn={job.status === 'waiting'} class="muted">
							{job.status === 'waiting' ? job.error : job.status}
						</span>
						<button onclick={() => cancelJob(job.id)}>Cancel</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if printer.capabilities.feed}
			<div class="row">
				<button onclick={feed} disabled={!printer.status.online || printer.busy || !media}>
					Feed & cut
				</button>
				{#if printer.labelInPrinter}
					<span class="muted">The last label is still in the printer.</span>
				{/if}
			</div>
			{#if feedError}<p class="bad">{feedError}</p>{/if}
		{/if}
		<p class="muted small">Updated {new Date(printer.updatedAt).toLocaleTimeString()}</p>
	{:else}
		<p class="muted">No printer configured. Set PRINTER_HOST.</p>
	{/if}
</div>

<style>
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.9rem;
		border: none;
		background: none;
		padding: 2px 4px;
	}
	.status:hover {
		background: var(--bg);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--ok);
	}
	.dot.busy {
		background: var(--warn);
	}
	.dot.bad {
		background: var(--bad);
	}
	[popover] {
		inset: 44px 16px auto auto;
		margin: 0;
		width: min(360px, calc(100vw - 32px));
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
	}
	p {
		margin: 0 0 8px;
	}
	.tape {
		display: flex;
		gap: 10px;
		align-items: center;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0 0 8px;
	}
	li {
		flex-wrap: nowrap;
		padding: 2px 0;
	}
	li .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.small {
		margin: 8px 0 0;
	}
</style>
