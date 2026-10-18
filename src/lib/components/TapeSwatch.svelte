<script lang="ts">
	import { tapeColor, textColor } from '#lib/colors.js';

	let {
		tape,
		text,
		large = false
	}: { tape?: string | null; text?: string | null; large?: boolean } = $props();

	const known = $derived(!!(tape || text));
</script>

<span
	class="swatch"
	class:large
	style:background={tape ? tapeColor(tape) : 'transparent'}
	style:color={textColor(text ?? undefined)}
	title={known ? `${text ?? 'any'} on ${tape ?? 'any'}` : 'any colour'}
>
	{known ? (large ? 'Abc' : 'A') : '?'}
</span>

<style>
	.large {
		width: auto;
		height: auto;
		padding: 2px 8px;
		font-size: 1rem;
		line-height: 1.3;
		border-radius: 3px;
	}
</style>
