<script lang="ts">
	import { settingsState, setPalette, setTheme } from '#lib/settings-store.svelte.js';
	import { PALETTES, readPalette, readTheme, type Palette, type ThemeMode } from '#lib/theme.js';

	let mode = $state<ThemeMode>('system');
	let palette = $state<Palette>('ink');

	$effect(() => {
		mode = settingsState.current?.theme ?? readTheme();
		palette = settingsState.current?.palette ?? readPalette();
	});

	const swatch: Record<Palette, string> = {
		ink: 'oklch(0.42 0.09 255)',
		lamp: 'oklch(0.55 0.08 70)',
		moss: 'oklch(0.48 0.09 150)',
		tide: 'oklch(0.48 0.08 220)',
		dusk: 'oklch(0.5 0.12 310)'
	};

	function chooseMode(next: ThemeMode) {
		mode = next;
		void setTheme(next);
	}

	function choosePalette(next: Palette) {
		palette = next;
		void setPalette(next);
	}
</script>

<div class="grid gap-3" data-theme-collection>
	<div class="bg-muted grid grid-cols-3 gap-1 rounded-lg p-1" role="group" aria-label="Day and night">
		{#each [{ id: 'day', label: 'Day' }, { id: 'night', label: 'Night' }, { id: 'system', label: 'System' }] as item (item.id)}
			<button
				type="button"
				class="h-9 rounded-md text-sm {mode === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'}"
				aria-pressed={mode === item.id}
				onclick={() => chooseMode(item.id as ThemeMode)}
			>
				{item.label}
			</button>
		{/each}
	</div>
	<div class="grid grid-cols-2 gap-2" aria-label="Palettes">
		{#each PALETTES as item (item.id)}
			<button
				type="button"
				class="border-border hover:bg-accent flex h-11 items-center gap-2 rounded-lg border px-2 text-left text-sm {palette === item.id ? 'border-primary ring-ring/40 ring-2' : ''}"
				aria-pressed={palette === item.id}
				data-palette-choice={item.id}
				onclick={() => choosePalette(item.id)}
			>
				<span class="size-4 shrink-0 rounded-full border" style="background: {swatch[item.id]}"></span>
				<span class="min-w-0">
					<span class="block leading-none font-medium">{item.label}</span>
					<span class="text-muted-foreground text-xs">{item.hint}</span>
				</span>
			</button>
		{/each}
	</div>
</div>
