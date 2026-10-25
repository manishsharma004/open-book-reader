<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Open Book Reader</title>
</svelte:head>

<div class="bg-background text-foreground min-h-screen">
	{@render children()}
</div>
