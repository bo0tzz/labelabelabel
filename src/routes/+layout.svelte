<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { printerState } from '#lib/api/printers.remote.js';
	import PrinterPanel from '#lib/components/PrinterPanel.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const live = printerState();

	const links = [
		[resolve('/'), 'Edit'],
		[resolve('/labels'), 'Saved'],
		[resolve('/tapes'), 'Tapes'],
		[resolve('/queue'), 'Queue'],
		[resolve('/fonts'), 'Fonts']
	] as const;
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>labelabelabel</title>
</svelte:head>

<header>
	<nav>
		{#each links as [href, text] (href)}
			<a {href} aria-current={page.url.pathname === href ? 'page' : undefined}>{text}</a>
		{/each}
	</nav>
	<PrinterPanel snapshot={live.current} />
</header>

<main>
	{@render children()}
</main>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 16px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
	}
	nav {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
	}
	nav a {
		text-decoration: none;
		color: var(--muted);
	}
	nav a[aria-current='page'] {
		color: var(--text);
		font-weight: 600;
	}
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 12px 16px 96px;
	}
</style>
