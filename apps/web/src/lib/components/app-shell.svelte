<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import LibraryIcon from '@lucide/svelte/icons/library';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import PaletteSwatches from '#lib/components/palette-swatches.svelte';

	let { children }: { children: Snippet } = $props();
	let open = $state(false);

	const links = $derived([
		{ href: resolve('/'), label: 'Library', icon: LibraryIcon },
		{ href: resolve('/open'), label: 'Open books', icon: BookOpenIcon },
		{ href: resolve('/settings'), label: 'Settings', icon: SettingsIcon }
	]);

	function current(href: string) {
		const path = page.url.pathname;
		if (href === resolve('/')) return path === href;
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<div class="bg-background min-h-dvh md:pl-64">
	<aside
		class="border-border bg-card fixed inset-y-0 left-0 z-40 w-72 flex-col gap-6 border-r px-4 py-5 md:flex md:w-64 {open ? 'flex' : 'max-md:hidden'}"
		data-sidebar
		data-sidebar-open={open ? 'true' : 'false'}
	>
		<a href={resolve('/')} class="px-2 text-lg font-semibold tracking-tight" onclick={() => (open = false)}>Open Book Reader</a>
		<nav class="grid gap-1" aria-label="Pages" data-app-nav>
			{#each links as link (link.href)}
				{@const Icon = link.icon}
				<a
					href={link.href}
					class="flex h-11 items-center gap-2 rounded-lg px-3 text-sm {current(link.href) ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}"
					aria-current={current(link.href) ? 'page' : undefined}
					onclick={() => (open = false)}
				>
					<Icon class="size-4" />
					{link.label}
				</a>
			{/each}
		</nav>
		<div class="mt-auto grid gap-2">
			<p class="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">Theme</p>
			<PaletteSwatches />
		</div>
	</aside>
	{#if open}
		<button type="button" class="fixed inset-0 z-30 bg-black/40 md:hidden" aria-label="Close menu" onclick={() => (open = false)}></button>
	{/if}
	<div class="border-border bg-card/90 sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:hidden">
		<button type="button" class="hover:bg-accent inline-flex size-11 items-center justify-center rounded-lg" aria-label="Open menu" aria-expanded={open} data-menu onclick={() => (open = !open)}>
			<MenuIcon class="size-5" />
		</button>
		<a href={resolve('/')} class="font-semibold tracking-tight">Open Book Reader</a>
	</div>
	{@render children()}
</div>
