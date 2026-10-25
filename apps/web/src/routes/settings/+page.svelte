<script lang="ts">
	import AppHeader from '#lib/components/app-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Card from '#lib/components/ui/card/index.js';

	type Health = { version: string; ffmpeg: boolean; maxBodyBytes: number };

	let health = $state<Health | null>(null);
	let healthError = $state('');

	$effect(() => {
		fetch('/v1/health')
			.then(async (response) => {
				if (!response.ok) throw new Error(`${response.status}`);
				health = (await response.json()) as Health;
			})
			.catch(() => {
				healthError = 'The app server is not answering on this origin.';
			});
	});
</script>

<AppHeader />

<main class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
	<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
	<Card.Root>
		<Card.Header>
			<Card.Title>App server</Card.Title>
			<Card.Description>
				The browser calls this origin only. Vendor calls will go through the proxy on /v1.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex items-center gap-2 text-sm">
			{#if health}
				<Badge>Reachable</Badge>
				<span>Version {health.version}</span>
				<span class="text-muted-foreground">
					Audio conversion {health.ffmpeg ? 'available' : 'not installed'}
				</span>
			{:else if healthError}
				<Badge variant="destructive">{healthError}</Badge>
			{:else}
				<span class="text-muted-foreground">Checking…</span>
			{/if}
		</Card.Content>
	</Card.Root>
	<Card.Root>
		<Card.Header>
			<Card.Title>This version</Card.Title>
			<Card.Description>
				Books stay in IndexedDB. Playback uses the browser preview voice and highlights words from the PDF
				text layer. Chapters, model transcripts, and stored speech audio are not built yet.
			</Card.Description>
		</Card.Header>
	</Card.Root>
</main>
