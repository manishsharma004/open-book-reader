<script lang="ts">
	import Info from '@lucide/svelte/icons/info';
	import { listVoices, watchVoices } from '#lib/speech.js';
	import { voiceCatalog, type VoiceIdChoice } from '#lib/voice-ids.js';
	import type { TtsVendor } from '#lib/settings.js';

	let {
		vendor,
		side = 'down',
		onpick
	}: {
		vendor: TtsVendor;
		side?: 'up' | 'down';
		onpick?: (id: string) => void;
	} = $props();

	let open = $state(false);
	let pinned = $state(false);
	let hideTimer = 0;
	let anchor = $state<HTMLButtonElement | null>(null);
	let tip = $state<HTMLDivElement | null>(null);
	let spot = $state<{ left: number; top: number; bottom: number } | null>(null);

	function remember() {
		const box = anchor?.getBoundingClientRect();
		if (!box) return;
		spot = { left: box.left, top: box.top, bottom: box.bottom };
	}

	$effect(() => {
		if (!open || !tip || !spot) return;
		const width = Math.min(256, window.innerWidth - 16);
		const left = Math.min(Math.max(8, spot.left), window.innerWidth - width - 8);
		tip.style.position = 'fixed';
		tip.style.left = `${left}px`;
		tip.style.width = `${width}px`;
		if (side === 'up') {
			tip.style.top = 'auto';
			tip.style.bottom = `${window.innerHeight - spot.top + 8}px`;
		} else {
			tip.style.bottom = 'auto';
			tip.style.top = `${spot.bottom + 8}px`;
		}
	});
	let browserVoices = $state<{ name: string; voiceURI: string }[]>([]);

	const catalog = $derived(voiceCatalog(vendor, browserVoices));

	$effect(() => {
		if (vendor !== 'browser') return;
		return watchVoices(() => {
			browserVoices = listVoices().map((voice) => ({ name: voice.name, voiceURI: voice.voiceURI }));
		});
	});

	function show() {
		if (!open) remember();
		window.clearTimeout(hideTimer);
		open = true;
	}

	function hide() {
		if (pinned) return;
		window.clearTimeout(hideTimer);
		hideTimer = window.setTimeout(() => {
			if (!pinned) open = false;
		}, 200);
	}

	function toggle() {
		if (!open) remember();
		if (pinned) {
			pinned = false;
			open = false;
			return;
		}
		pinned = true;
		open = true;
	}

	function pick(item: VoiceIdChoice) {
		onpick?.(item.id);
		pinned = false;
		open = false;
	}

	function onKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			pinned = false;
			open = false;
		}
	}

</script>

<div class="relative" data-voice-ids={vendor} onpointerenter={show} onpointerleave={hide}>
	<button
		type="button"
		class="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
		aria-label="Available voice ids"
		aria-expanded={open}
		bind:this={anchor}
		onclick={toggle}
		onkeydown={onKey}
	>
		<Info class="size-3.5" />
	</button>
	{#if open}
		<div
			role="tooltip"
			class="border-border bg-popover text-popover-foreground fixed z-40 max-h-52 rounded-md border p-2 shadow-md"
			data-voice-id-list
			bind:this={tip}
			onpointerenter={show}
		>
			<p class="text-muted-foreground mb-1.5 text-xs">{catalog.note}</p>
			{#if catalog.items.length}
				<ul class="flex max-h-40 flex-col gap-0.5 overflow-auto">
					{#each catalog.items as item (item.id + item.label)}
						<li>
							<button
								type="button"
								class="hover:bg-muted w-full rounded px-1.5 py-0.5 text-left text-xs"
								data-voice-id={item.id}
								onclick={() => pick(item)}
							>
								{item.label}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
