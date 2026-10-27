<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import AppShell from '#lib/components/app-shell.svelte';
	import { loadSettings } from '#lib/settings-store.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	const reading = $derived(page.url.pathname.includes('/read/'));

	$effect(() => {
		void loadSettings();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Open Book Reader</title>
</svelte:head>

<div class="bg-background text-foreground min-h-screen">
	{#if reading}
		{@render children()}
	{:else}
		<AppShell>
			{@render children()}
		</AppShell>
	{/if}
</div>
