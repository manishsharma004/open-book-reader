<script lang="ts">
	import { pipeline, type PipelineEvent } from '#lib/pipeline.svelte.js';

	const events = $derived(pipeline.events);

	function clock(event: PipelineEvent) {
		return new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Processing pipeline">
	<header class="border-border shrink-0 border-b px-3 py-2">
		<h2 class="text-sm font-semibold">Pipeline</h2>
		<p class="text-muted-foreground text-xs">OCR, emotion, and speech. API keys are not written here.</p>
	</header>
	{#if pipeline.live}
		<p class="bg-accent text-accent-foreground px-3 py-2 text-xs">{pipeline.live}</p>
	{/if}
	<ol class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
		{#if events.length === 0}
			<li class="text-muted-foreground text-xs">Nothing has run yet. Open a page to read its text layer or OCR it.</li>
		{/if}
		{#each events as event (event.id)}
			<li class="border-border rounded-md border px-2 py-1.5 text-xs">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
					<span class="text-muted-foreground tabular-nums">{clock(event)}</span>
					<span class="font-medium">p.{event.page}</span>
					<span class="uppercase">{event.stage}</span>
					<span
						class={event.status === 'error'
							? 'text-destructive'
							: event.status === 'ok'
								? 'text-primary'
								: 'text-muted-foreground'}
					>
						{event.status}
					</span>
					{#if event.ms != null}
						<span class="text-muted-foreground tabular-nums">{event.ms} ms</span>
					{/if}
				</div>
				<p class="mt-1 break-words whitespace-pre-wrap">{event.detail}</p>
			</li>
		{/each}
	</ol>
</section>
