<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { settingsState, setPalette, setTheme } from '#lib/settings-store.svelte.js';
	import { readPalette, readTheme, type Palette, type ThemeMode } from '#lib/theme.js';

	let mode = $state<ThemeMode>('system');
	let palette = $state<Palette>('ink');

	$effect(() => {
		mode = settingsState.current?.theme ?? readTheme();
		palette = settingsState.current?.palette ?? readPalette();
	});

	function choose(next: ThemeMode) {
		mode = next;
		void setTheme(next);
	}

	function choosePalette(next: Palette) {
		palette = next;
		void setPalette(next);
	}

	const label = $derived(mode === 'day' ? 'Day' : mode === 'night' ? 'Night' : 'System');
</script>

<header class="border-border bg-card/80 sticky top-0 z-20 border-b backdrop-blur">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
		<a href="/" class="text-lg font-semibold tracking-tight">Open Book Reader</a>
		<nav class="ml-auto flex items-center gap-1">
			<Button href="/settings" variant={page.url.pathname === '/settings' ? 'secondary' : 'ghost'} size="sm">
				Settings
			</Button>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger class="hover:bg-muted inline-flex h-7 items-center rounded-md px-2.5 text-sm">
					{label}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end">
					<DropdownMenu.Label>Appearance</DropdownMenu.Label>
					<DropdownMenu.Item onclick={() => choose('day')}>Day</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => choose('night')}>Night</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => choose('system')}>System</DropdownMenu.Item>
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => choosePalette('ink')}>Ink {palette === 'ink' ? '· on' : ''}</DropdownMenu.Item>
					<DropdownMenu.Item onclick={() => choosePalette('lamp')}>Lamp {palette === 'lamp' ? '· on' : ''}</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</nav>
	</div>
</header>
