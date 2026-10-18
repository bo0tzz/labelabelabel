<script lang="ts">
	import { fontSymbols } from '#lib/api/fonts.remote.js';
	import { cssFamily } from '#lib/client/fonts.svelte.js';
	import { ICON_FONT_SYMBOLS, type FontSymbol } from '#lib/fonts.js';

	let { font, oninsert }: { font: string; oninsert: (text: string) => void } = $props();

	const LIMIT = 240;
	const query = $derived(fontSymbols(font));
	let search = $state('');

	const all = $derived(query.current ?? []);
	const icons = $derived(all.length > ICON_FONT_SYMBOLS);
	/** Lower is better: exact name, then a name starting with it, then a word in a name. */
	function rank(symbol: FontSymbol, q: string) {
		let best = Infinity;
		for (const name of symbol.names) {
			const n = name.toLowerCase();
			const score =
				n === q ? 0 : n.startsWith(q) ? 1 : n.includes(`_${q}`) ? 2 : n.includes(q) ? 3 : Infinity;
			best = Math.min(best, score * 1000 + n.length);
		}
		return best;
	}

	const matches = $derived.by(() => {
		const q = search.trim().toLowerCase().replace(/\s+/g, '_');
		if (!q) return all;
		return all
			.map((symbol) => ({ symbol, score: rank(symbol, q) }))
			.filter((m) => m.score < Infinity)
			.sort((a, b) => a.score - b.score)
			.map((m) => m.symbol);
	});
	const shown = $derived(matches.slice(0, LIMIT));

	// Short codes go in as text so the label stays editable; icon fonts insert the icon itself.
	const textFor = (s: FontSymbol) => (!icons && s.names[0]) || s.char;
	const titleFor = (s: FontSymbol) =>
		s.names.at(-1) ?? `U+${s.char.codePointAt(0)!.toString(16).toUpperCase()}`;
</script>

<div class="picker">
	{#if all.length > 40}
		<input type="search" placeholder="Search {all.length} symbols" bind:value={search} />
	{/if}
	<div class="symbols" style:font-family={cssFamily(font)}>
		{#each shown as symbol (symbol.char)}
			<button type="button" title={titleFor(symbol)} onclick={() => oninsert(textFor(symbol))}>
				{symbol.char}
				{#if !icons && symbol.names[0]}<small>{symbol.names[0]}</small>{/if}
			</button>
		{/each}
	</div>
	{#if query.loading && !all.length}
		<p class="muted small">Loading…</p>
	{:else if matches.length > shown.length}
		<p class="muted small">{matches.length - shown.length} more, refine the search</p>
	{:else if !matches.length}
		<p class="muted small">No matches.</p>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.symbols {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		max-height: 14em;
		overflow-y: auto;
	}
	.symbols button {
		font-family: inherit;
		font-size: 1.4rem;
		line-height: 1;
		min-width: 2.2em;
		padding: 4px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}
	small {
		font-family: system-ui, sans-serif;
		font-size: 0.6rem;
		color: var(--muted);
	}
	p {
		margin: 0;
	}
	.small {
		font-size: 0.8rem;
	}
</style>
