<script lang="ts">
	import { cssFamily } from '#lib/client/fonts.svelte.js';
	import type { FontEntry } from '#lib/fonts.js';
	import type { Block } from '#lib/label/types.js';
	import { imageToBitmap } from '#lib/client/image.js';
	import {
		emptyDrawing,
		encodeBitmapData,
		invertDrawing,
		resizeDrawing
	} from '#lib/label/drawing.js';
	import type { RenderIssue } from '#lib/render/render.js';
	import NumberField from './NumberField.svelte';
	import SymbolPicker from './SymbolPicker.svelte';

	interface Props {
		block: Block;
		fonts: FontEntry[];
		issues: RenderIssue[];
		free: boolean;
		/** Values are stored along/across the tape; in portrait those show as height/width. */
		portrait?: boolean;
	}

	let { block = $bindable(), fonts, issues, free, portrait = false }: Props = $props();

	const alongLabel = $derived(portrait ? 'Height (mm)' : 'Width (mm)');
	const acrossLabel = $derived(portrait ? 'Width (mm)' : 'Height (mm)');

	let textarea: HTMLTextAreaElement | undefined = $state();
	let picker = $state(false);

	const font = $derived(block.type === 'text' ? fonts.find((f) => f.id === block.font) : undefined);
	const hasSymbols = $derived(!!font?.symbols);
	const FIELDS = ['text', 'font', 'size', 'width', 'height', 'data', 'module'];
	const problems = $derived(issues.filter((i) => !i.info));
	const notes = $derived(issues.filter((i) => i.info).map((i) => i.message));
	const issueFor = (field: string) => problems.find((i) => i.field === field)?.message;
	const general = $derived(
		problems.filter((i) => !i.field || !FIELDS.includes(i.field)).map((i) => i.message)
	);

	let dither = $state(false);

	const drawingWidthMm = () =>
		block.type === 'bitmap' ? Math.round((block.w / block.dpi[0]) * 25.4 * 10) / 10 : undefined;

	function setDrawingWidth(mm: number | undefined) {
		if (block.type !== 'bitmap' || mm === undefined) return;
		resizeDrawing(block, (mm / 25.4) * block.dpi[0], block.h);
	}

	async function importImage(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file || block.type !== 'bitmap') return;
		const image = await imageToBitmap(file, block.h, block.dpi[0] / block.dpi[1], dither);
		block.w = image.width;
		block.data = encodeBitmapData(image);
	}

	function insert(symbol: string) {
		if (block.type !== 'text') return;
		const start = textarea?.selectionStart ?? block.text.length;
		const end = textarea?.selectionEnd ?? start;
		block.text = block.text.slice(0, start) + symbol + block.text.slice(end);
		requestAnimationFrame(() => {
			textarea?.focus();
			textarea?.setSelectionRange(start + symbol.length, start + symbol.length);
		});
	}
</script>

<div class="fields">
	{#each general as message (message)}
		<p class="error wide">{message}</p>
	{/each}

	{#if block.type === 'text'}
		<div class="wide text">
			<label class:invalid={!!issueFor('text')}>
				Text
				<textarea
					rows="2"
					bind:this={textarea}
					bind:value={block.text}
					style:font-family={hasSymbols ? `system-ui, ${cssFamily(block.font)}` : undefined}
				></textarea>
				{#if issueFor('text')}<span class="error">{issueFor('text')}</span>{/if}
			</label>
			{#if hasSymbols}
				<button type="button" class="symbols-toggle" onclick={() => (picker = !picker)}>
					Symbols
				</button>
			{/if}
		</div>
		{#if picker && hasSymbols}
			<div class="wide">
				<SymbolPicker font={block.font} oninsert={insert} />
			</div>
		{/if}
		<label class:invalid={!!issueFor('font')}>
			Font
			<select
				value={font?.pair?.filled ?? block.font}
				onchange={(e) => block.type === 'text' && (block.font = e.currentTarget.value)}
			>
				{#each fonts.filter((f) => !f.hidden && !f.fallback) as f (f.id)}
					<option value={f.id}>{f.name}</option>
				{/each}
				{#if !font}
					<option value={block.font}>{block.font} (missing)</option>
				{/if}
			</select>
			{#if issueFor('font')}<span class="error">{issueFor('font')}</span>{/if}
		</label>
		<NumberField
			label="Size (pt)"
			bind:value={block.size}
			min={1}
			max={500}
			placeholder="fit"
			error={issueFor('size')}
		/>
		{#if font?.weights}
			<label>
				Weight
				<input
					type="range"
					min={font.weights[0]}
					max={font.weights[1]}
					step="50"
					value={block.weight ?? 400}
					oninput={(e) => (block.weight = parseInt(e.currentTarget.value))}
				/>
			</label>
		{:else if font && !font.pixelEm}
			<!-- Fonts without a weight axis get heavier or lighter by how much of a dot must be inked. -->
			<label>
				Weight
				<input
					type="range"
					min="0.2"
					max="0.8"
					step="0.05"
					value={1 - (block.ink ?? 0.5)}
					oninput={(e) => (block.ink = 1 - parseFloat(e.currentTarget.value))}
				/>
			</label>
		{/if}
		<label>
			Rotation
			<select bind:value={block.rotate}>
				<option value={undefined}>none</option>
				<option value={90}>90°</option>
				<option value={180}>180°</option>
				<option value={270}>270°</option>
			</select>
		</label>
		<label>
			Align
			<select bind:value={block.textAlign}>
				<option value={undefined}>left</option>
				<option value="center">center</option>
				<option value="end">right</option>
			</select>
		</label>
		{#if font?.fill || font?.pair}
			<label class="check">
				<input
					type="checkbox"
					checked={font.pair ? block.font === font.pair.filled : !!block.filled}
					onchange={(e) => {
						if (block.type !== 'text') return;
						if (font?.pair)
							block.font = e.currentTarget.checked ? font.pair.filled : font.pair.outline;
						else block.filled = e.currentTarget.checked;
					}}
				/>
				Filled icons
			</label>
		{/if}
		<label class="check" title="Letters upright, one under the other.">
			<input
				type="checkbox"
				checked={block.stack ?? portrait}
				onchange={(e) => block.type === 'text' && (block.stack = e.currentTarget.checked)}
			/>
			Stack letters
		</label>
		<label
			class="check"
			title="Size the text by its letters, without the room fonts keep for accents and descenders."
		>
			<input
				type="checkbox"
				checked={!!block.tight}
				onchange={(e) => (block.tight = e.currentTarget.checked || undefined)}
			/>
			Fill height
		</label>
	{:else if block.type === 'qr'}
		<label class="wide" class:invalid={!!issueFor('data')}>
			Content
			<input type="text" bind:value={block.data} />
			{#if issueFor('data')}<span class="error">{issueFor('data')}</span>{/if}
		</label>
		<label>
			Error correction
			<select bind:value={block.ecc}>
				<option value="L">low</option>
				<option value={undefined}>medium</option>
				<option value="Q">quartile</option>
				<option value="H">high</option>
			</select>
		</label>
		{#if !block.stretch}
			<NumberField
				label="Module (dots)"
				bind:value={block.module}
				min={1}
				max={64}
				integer
				placeholder="fit"
				error={issueFor('module')}
			/>
		{/if}
		<label
			class="check"
			title="Use all the room with modules of uneven size (e.g. 2 and 3 dots). Most scanners cope, but test it."
		>
			<input
				type="checkbox"
				checked={!!block.stretch}
				onchange={(e) => (block.stretch = e.currentTarget.checked || undefined)}
			/>
			Stretch to fill
		</label>
		{#each notes as note (note)}
			<p class="muted wide note">{note}</p>
		{/each}
	{:else if block.type === 'bitmap'}
		<div class="wide row">
			<span class="muted">{block.w} × {block.h} dots</span>
			<button
				type="button"
				onclick={() => block.type === 'bitmap' && (block.data = emptyDrawing(block.w, block.h))}
				>Clear</button
			>
			<button type="button" onclick={() => block.type === 'bitmap' && invertDrawing(block)}
				>Invert</button
			>
			<label class="button">
				Import image
				<input type="file" accept="image/*" hidden onchange={importImage} />
			</label>
			<label class="check"><input type="checkbox" bind:checked={dither} /> Dither</label>
		</div>
		<NumberField
			label={alongLabel}
			bind:value={drawingWidthMm, setDrawingWidth}
			min={0.5}
			max={1000}
			step={0.5}
			required
		/>
	{:else if block.type === 'line'}
		<label>
			Direction
			<select bind:value={block.direction}>
				<option value={undefined}>across</option>
				<option value="along">along</option>
			</select>
		</label>
		<NumberField
			label="Thickness (dots)"
			bind:value={block.thickness}
			min={1}
			max={128}
			integer
			required
		/>
		{#if !free && block.direction !== 'along'}
			<NumberField
				label={portrait ? 'Width (%)' : 'Height (%)'}
				bind:value={block.extent}
				min={0}
				max={100}
				scale={100}
				placeholder="100"
			/>
		{/if}
	{/if}

	{#if free && block.type !== 'space'}
		<NumberField
			label={portrait ? 'From top (mm)' : 'X (mm)'}
			bind:value={block.x}
			step={0.5}
			min={-1000}
			max={1000}
			placeholder="0"
		/>
		<NumberField
			label={portrait ? 'From right (mm)' : 'Y (mm)'}
			bind:value={block.y}
			step={0.5}
			min={-1000}
			max={1000}
			placeholder="0"
		/>
	{/if}
	{#if block.type !== 'bitmap'}
		<NumberField
			label={alongLabel}
			bind:value={block.width}
			min={0}
			max={1000}
			step={0.5}
			placeholder="auto"
			error={issueFor('width')}
		/>
	{/if}
	{#if free && block.type !== 'space' && block.type !== 'bitmap'}
		<NumberField
			label={acrossLabel}
			bind:value={block.height}
			min={0}
			max={1000}
			step={0.5}
			placeholder="tape"
			error={issueFor('height')}
		/>
	{/if}
	{#if block.type !== 'space'}
		<label>
			{portrait ? 'Horizontal' : 'Vertical'}
			<select bind:value={block.align}>
				<option value="start">{portrait ? 'right' : 'top'}</option>
				<option value={undefined}>middle</option>
				<option value="end">{portrait ? 'left' : 'bottom'}</option>
			</select>
		</label>
	{/if}
</div>

<style>
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px 12px;
	}
	.wide {
		grid-column: 1 / -1;
	}
	p.error,
	p.note {
		margin: 0;
	}
	p.note {
		font-size: 0.8rem;
	}
	.text {
		display: flex;
		gap: 8px;
		align-items: end;
	}
	.text label {
		flex: 1;
	}
</style>
