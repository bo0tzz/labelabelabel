<script lang="ts">
	import { printerState } from '#lib/api/printers.remote.js';
	import { deleteTape, listTapes, updateTape } from '#lib/api/tapes.remote.js';
	import { tapeLabel } from '#lib/colors.js';
	import TapeSwatch from '#lib/components/TapeSwatch.svelte';
	import { getMedia } from '#lib/media.js';
	import { kindName, nominalLengthMm, tapeLengthMm } from '#lib/tapes.js';

	const tapes = listTapes();
	const live = printerState();
	const loadedIds = $derived(new Set(live.current?.printers.map((p) => p.tapeId)));
	let editing = $state<number | null>(null);

	const metres = (mm: number) => `${(mm / 1000).toFixed(1).replace(/\.0$/, '')} m`;

	async function remove(id: number) {
		if (!confirm('Remove this tape from the list? It comes back when inserted again.')) return;
		await deleteTape(id);
	}

	async function newCassette(id: number) {
		await updateTape({ id, resetUsage: true });
	}
</script>

<h1>Tapes</h1>
<p class="muted">Tapes are added when they are inserted in the printer.</p>

<section class="scroll">
	<table>
		<thead>
			<tr>
				<th>Tape</th>
				<th>Left</th>
				<th>Status</th>
				<th>Last seen</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each tapes.current ?? [] as tape (tape.id)}
				{@const length = tapeLengthMm(tape)}
				{@const left = Math.max(0, length - tape.usedMm)}
				<tr>
					<td class="name">
						<TapeSwatch tape={tape.tape} text={tape.text} />
						{getMedia(tape.mediaId)?.name ?? tape.mediaId}, {tapeLabel(tape)}
						<div class="muted small">
							{[tape.partNumber, kindName(tape.kind)].filter(Boolean).join(' · ')}
							{#if loadedIds.has(tape.id)}· <strong>loaded</strong>{/if}
						</div>
					</td>
					<td
						class="nowrap left"
						title="Estimate: {metres(tape.usedMm)} printed since the cassette was marked new"
					>
						<meter min="0" max={length} low={length * 0.15} optimum={length} value={left}></meter>
						{metres(left)} of {metres(length)}
					</td>
					<td class="status">
						<select
							value={tape.status}
							onchange={(e) =>
								updateTape({
									id: tape.id,
									status: e.currentTarget.value as 'owned' | 'low' | 'empty'
								})}
						>
							<option value="owned">have</option>
							<option value="low">low</option>
							<option value="empty">used up</option>
						</select>
					</td>
					<td class="nowrap seen">{tape.lastSeen?.toLocaleDateString() ?? ''}</td>
					<td class="nowrap actions">
						<button onclick={() => (editing = editing === tape.id ? null : tape.id)}>
							{editing === tape.id ? 'Done' : 'Edit'}
						</button>
						<button title="Remove" onclick={() => remove(tape.id)}>×</button>
					</td>
				</tr>
				{#if editing === tape.id}
					<tr class="details">
						<td colspan="5">
							<div class="row">
								<label>
									Part number
									<input
										type="text"
										value={tape.partNumber ?? ''}
										onchange={(e) => updateTape({ id: tape.id, partNumber: e.currentTarget.value })}
									/>
								</label>
								<label>
									Length (m)
									<input
										type="number"
										min="0"
										step="0.5"
										placeholder={String(nominalLengthMm(tape) / 1000)}
										value={tape.lengthMm ? tape.lengthMm / 1000 : ''}
										onchange={(e) => {
											const m = parseFloat(e.currentTarget.value);
											updateTape({
												id: tape.id,
												lengthMm: Number.isFinite(m) && m > 0 ? m * 1000 : null
											});
										}}
									/>
								</label>
								<label class="note">
									Note
									<input
										type="text"
										value={tape.note ?? ''}
										onchange={(e) => updateTape({ id: tape.id, note: e.currentTarget.value })}
									/>
								</label>
								<button
									title="Start counting from a full cassette again"
									onclick={() => newCassette(tape.id)}>New cassette</button
								>
							</div>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</section>

<style>
	.scroll {
		overflow-x: auto;
	}
	@media (max-width: 600px) {
		thead,
		.seen {
			display: none;
		}
		tr:not(.details) {
			display: grid;
			grid-template-areas: 'name actions' 'left status';
			grid-template-columns: 1fr auto;
			align-items: center;
			border-bottom: 1px solid var(--border);
		}
		tr:not(.details) td {
			border: none;
		}
		.name {
			grid-area: name;
			min-width: 0;
		}
		.actions {
			grid-area: actions;
		}
		.left {
			grid-area: left;
		}
		.status {
			grid-area: status;
		}
		.status select {
			width: auto;
		}
	}
	.name {
		min-width: 14em;
	}
	.nowrap {
		white-space: nowrap;
	}
	.actions {
		text-align: right;
	}
	meter {
		width: 4em;
		vertical-align: middle;
		margin-right: 4px;
	}
	.details td {
		background: var(--bg);
	}
	.details .row {
		align-items: end;
	}
	.details label {
		width: 9em;
	}
	.details label.note {
		flex: 1;
		min-width: 12em;
	}
</style>
