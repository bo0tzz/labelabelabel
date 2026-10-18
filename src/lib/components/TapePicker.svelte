<script lang="ts">
	import type { Label, MediaRef } from '#lib/label/types.js';
	import LabelThumb from './LabelThumb.svelte';
	import TapeSwatch from './TapeSwatch.svelte';

	export interface TapeOption {
		key: string;
		media: MediaRef;
		title: string;
		detail?: string;
		loaded?: boolean;
	}

	interface Props {
		options: TapeOption[];
		current: string;
		doc: Label;
		vars?: Record<string, string>;
		onpick: (option: TapeOption) => void;
	}

	let { options, current, doc, vars, onpick }: Props = $props();
	let open = $state(false);

	const selected = $derived(options.find((o) => o.key === current));

	function pick(option: TapeOption) {
		onpick(option);
		open = false;
	}
</script>

<div class="picker">
	<button class="current" aria-expanded={open} onclick={() => (open = !open)}>
		<TapeSwatch tape={selected?.media.tape} text={selected?.media.text} />
		<span class="title">{selected?.title ?? 'Choose tape'}</span>
		<span class="muted">{open ? '▴' : '▾'}</span>
	</button>
	{#if open}
		<div class="list">
			{#each options as option (option.key)}
				<button class="option" class:selected={option.key === current} onclick={() => pick(option)}>
					<span class="meta">
						<span>{option.title}</span>
						{#if option.detail}<span class="muted">{option.detail}</span>{/if}
						{#if option.loaded}<span class="loaded">loaded</span>{/if}
					</span>
					<span class="thumb">
						<LabelThumb doc={{ ...doc, media: option.media }} {vars} scale={0.5} />
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
	}
	.current .title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.list {
		max-height: 60vh;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 4px;
	}
	.option {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		width: 100%;
		text-align: left;
		border: 1px solid transparent;
		background: none;
		padding: 4px;
	}
	.option:hover {
		border-color: var(--border);
	}
	.option.selected {
		border-color: var(--accent);
	}
	.meta {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		font-size: 0.9rem;
	}
	.loaded {
		color: var(--ok);
	}
	.thumb {
		overflow: hidden;
		pointer-events: none;
	}
	.thumb :global(.preview) {
		padding: 2px 0;
	}
</style>
