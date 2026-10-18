<script lang="ts">
	import { resolve } from '$app/paths';
	import { cancelJob, forceJob, history, print } from '#lib/api/jobs.remote.js';
	import { printerState } from '#lib/api/printers.remote.js';
	import LabelThumb from '#lib/components/LabelThumb.svelte';

	const jobs = history();
	const live = printerState();
	const loaded = $derived(live.current?.printers[0]?.status.media);

	type Job = NonNullable<typeof jobs.current>[number];

	const ACTIVE: Job['status'][] = ['queued', 'waiting', 'printing'];
	const active = $derived(
		(jobs.current ?? []).filter((j) => ACTIVE.includes(j.status)).toReversed()
	);
	const finished = $derived((jobs.current ?? []).filter((j) => !ACTIVE.includes(j.status)));

	// The live status changes whenever a job is added, moves or finishes.
	let lastKey = '';
	$effect(() => {
		const key = JSON.stringify([
			live.current?.queue.map((j) => [j.id, j.status, j.error]),
			live.current?.recent.map((j) => [j.id, j.status])
		]);
		if (lastKey && key !== lastKey) void jobs.refresh();
		lastKey = key;
	});

	async function reprint(job: Job) {
		await print({
			doc: job.doc,
			name: job.name,
			vars: job.vars ?? undefined,
			copies: job.copies
		});
	}

	const STATUS: Record<Job['status'], string> = {
		queued: 'queued',
		waiting: 'waiting',
		printing: 'printing',
		done: 'printed',
		failed: 'failed',
		canceled: 'canceled'
	};

	/** Only a colour mismatch can be overridden; the printer refuses the wrong width. */
	const forceable = (job: Job) =>
		job.status === 'waiting' && job.error?.startsWith('needs') && loaded?.id === job.doc.media.id;
</script>

{#snippet header(job: Job)}
	<strong>{job.name}</strong>
	{#if job.copies > 1}<span class="muted">×{job.copies}</span>{/if}
	<span
		class:bad={job.status === 'failed'}
		class:warn={job.status === 'waiting'}
		class:muted={job.status !== 'failed' && job.status !== 'waiting'}
	>
		{STATUS[job.status]}{job.error ? `: ${job.error}` : ''}
	</span>
	<span class="spacer"></span>
	<span class="muted small">
		{job.createdAt.toLocaleString()}
		{#if job.tapeMm}· {job.tapeMm.toFixed(0)} mm{/if}
		{#if job.user}· {job.user}{/if}
	</span>
{/snippet}

<h1>Queue</h1>
{#if active.length === 0}
	<p class="muted">Nothing queued.</p>
{/if}
{#each active as job (job.id)}
	<section class="job">
		<div class="row">
			{@render header(job)}
			{#if forceable(job)}
				<button onclick={() => forceJob(job.id)}>Print anyway</button>
			{/if}
			<button onclick={() => cancelJob(job.id)}>Cancel</button>
		</div>
		<LabelThumb doc={job.doc} vars={job.vars} />
	</section>
{/each}

<h1 class="history">History</h1>
{#if finished.length === 0}
	<p class="muted">Nothing printed yet.</p>
{/if}
{#each finished as job (job.id)}
	<section class="job">
		<div class="row">
			{@render header(job)}
			<button onclick={() => reprint(job)}>Reprint</button>
			<a class="button" href="{resolve('/')}?job={job.id}">Edit</a>
		</div>
		<LabelThumb doc={job.doc} vars={job.vars} />
	</section>
{/each}

<style>
	.job {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.history {
		margin-top: 24px;
	}
	.spacer {
		flex: 1;
	}
	.small {
		font-size: 0.8rem;
	}
</style>
