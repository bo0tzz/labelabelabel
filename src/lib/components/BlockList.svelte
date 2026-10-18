<script lang="ts">
	import type { Editor } from '#lib/client/editor.svelte.js';
	import { cssFamily } from '#lib/client/fonts.svelte.js';
	import type { FontEntry } from '#lib/fonts.js';
	import type { Block, BlockType } from '#lib/label/types.js';
	import type { MediaGeometry } from '#lib/media.js';
	import type { RenderedLabel } from '#lib/render/render.js';
	import BlockFields from './BlockFields.svelte';

	interface Props {
		editor: Editor;
		rendered: RenderedLabel;
		media: MediaGeometry;
		fonts: FontEntry[];
	}

	let { editor = $bindable(), rendered, media, fonts }: Props = $props();

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

	const blockIssues = (id: string) => rendered.issues.filter((i) => i.blockId === id);
</script>

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
					<!-- Text shows in its own font, which also turns codes like TX into their symbols. -->
					<span
						class="text"
						style:font-family={block.type === 'text'
							? `${cssFamily(block.font)}, system-ui`
							: undefined}>{summary(block)}</span
					>
					{#if issues.some((i) => !i.info)}
						<span class="warn" title={issues.find((i) => !i.info)?.message}>!</span>
					{/if}
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
					{fonts}
					{issues}
					free={editor.free}
					portrait={editor.doc.orientation === 'portrait'}
				/>
			{/if}
		</div>
	{/each}
	<div class="row add">
		<span class="muted">Add</span>
		<button onclick={() => editor.add('text')}>Text</button>
		<button onclick={() => editor.add('qr')}>QR</button>
		<button onclick={() => editor.add('line')}>Line</button>
		<button onclick={() => editor.addDrawing(media, rendered.dpi)}>Drawing</button>
		{#if !editor.free}
			<button onclick={() => editor.add('space')}>Space</button>
		{/if}
	</div>
</section>

<style>
	.blocks {
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
		width: 4.5em;
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
</style>
