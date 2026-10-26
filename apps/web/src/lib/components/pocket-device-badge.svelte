<script lang="ts">
	import { describePocketRun } from '#lib/pocket-onnx/providers.js';
	import { pocketRun } from '#lib/pocket-run.svelte.js';

	const webnn = typeof navigator !== 'undefined' && 'ml' in navigator;
	const view = $derived(describePocketRun(pocketRun.device, webnn));
</script>

<p class="text-muted-foreground text-xs" data-pocket-device={view.kind}>{view.text}</p>
