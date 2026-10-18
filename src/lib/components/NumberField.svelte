<script lang="ts">
	import { untrack } from 'svelte';

	interface Props {
		label: string;
		value: number | undefined;
		min?: number;
		max?: number;
		step?: number;
		integer?: boolean;
		/** Shown when empty. An empty field means "not set" unless `required`. */
		placeholder?: string;
		required?: boolean;
		/** Problem reported from elsewhere, e.g. the renderer. */
		error?: string;
		/** Factor between the stored value and what is shown, e.g. 100 for a fraction shown as percent. */
		scale?: number;
	}

	let {
		label,
		value = $bindable(),
		min,
		max,
		step = 1,
		integer = false,
		placeholder,
		required = false,
		error,
		scale = 1
	}: Props = $props();

	function format(v: number | undefined | null) {
		return v === undefined || v === null ? '' : String(Math.round(v * scale * 100) / 100);
	}

	let text = $state(untrack(() => format(value)));

	$effect(() => {
		const v = value;
		untrack(() => {
			if (Number(text) / scale !== v) text = format(v);
		});
	});

	const problem = $derived.by(() => {
		const t = text.trim();
		if (!t) return required ? 'required' : undefined;
		const n = Number(t);
		if (!Number.isFinite(n)) return 'not a number';
		if (integer && !Number.isInteger(n)) return 'whole numbers only';
		if (min !== undefined && n < min) return `at least ${min}`;
		if (max !== undefined && n > max) return `at most ${max}`;
		return undefined;
	});

	const message = $derived(problem ?? error);

	function oninput(event: Event & { currentTarget: HTMLInputElement }) {
		text = event.currentTarget.value;
		if (problem) return;
		value = text.trim() ? Number(text) / scale : undefined;
	}
</script>

<label class="field" class:invalid={!!message}>
	{label}
	<input
		type="number"
		inputmode="decimal"
		{min}
		{max}
		{step}
		{placeholder}
		value={text}
		{oninput}
		aria-invalid={!!message}
	/>
	{#if message}<span class="error">{message}</span>{/if}
</label>
