<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { untrack } from 'svelte';
	import { activeTrail, type Chapter } from '#lib/chapters.js';

	let {
		chapters,
		pageIndex,
		onjump
	}: {
		chapters: Chapter[];
		pageIndex: number;
		onjump: (pageIndex: number) => void;
	} = $props();

	let open = $state<Record<string, boolean>>({});
	let nav = $state<HTMLElement | null>(null);

	const trail = $derived(activeTrail(chapters, pageIndex));
	const active = $derived(trail[trail.length - 1] ?? null);

	$effect(() => {
		const path = trail;
		untrack(() => {
			for (let depth = 1; depth < path.length; depth += 1) {
				const key = path.slice(0, depth).map((chapter) => `${chapter.pageIndex}:${chapter.title}`).join('/');
				if (open[key] !== true) open[key] = true;
			}
		});
		queueMicrotask(() => nav?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }));
	});

	function pathKey(path: Chapter[]) {
		return path.map((chapter) => `${chapter.pageIndex}:${chapter.title}`).join('/');
	}
</script>

{#snippet branch(nodes: Chapter[], parents: Chapter[])}
	<ul class={parents.length === 0 ? 'py-2' : ''}>
		{#each nodes as chapter (chapter.pageIndex + ':' + chapter.title)}
			{@const path = [...parents, chapter]}
			{@const key = pathKey(path)}
			{@const nested = chapter.children ?? []}
			{@const expanded = open[key] === true}
			<li>
				<div class="flex items-start" style:padding-left={`${parents.length * 0.75}rem`}>
					{#if nested.length}
						<button
							type="button"
							class="text-muted-foreground hover:bg-muted mt-0.5 grid size-6 shrink-0 place-items-center rounded-md"
							aria-expanded={expanded}
							aria-label={expanded ? `Collapse ${chapter.title}` : `Expand ${chapter.title}`}
							onclick={() => (open[key] = !expanded)}
						>
							<ChevronRight class="size-3.5 transition-transform {expanded ? 'rotate-90' : ''}" />
						</button>
					{:else}
						<span class="size-6 shrink-0"></span>
					{/if}
					<button
						type="button"
						class="hover:bg-muted min-w-0 flex-1 rounded-md px-1.5 py-1 text-left text-sm"
						class:bg-muted={active === chapter}
						class:font-medium={active === chapter}
						aria-current={active === chapter ? 'location' : undefined}
						data-active={active === chapter ? 'true' : 'false'}
						data-chapter={chapter.title}
						onclick={() => {
							if (nested.length) open[key] = true;
							onjump(chapter.pageIndex);
						}}
					>
						{chapter.title}
					</button>
				</div>
				{#if nested.length && expanded}
					{@render branch(nested, path)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<nav bind:this={nav} aria-label="Chapters" class="px-2">
	{@render branch(chapters, [])}
</nav>
