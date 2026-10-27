<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { microphoneBlock } from '#lib/microphone.js';
	import { pcmToWav, RECORD_SECONDS } from '#lib/wav-pcm.js';

	let { onsave }: { onsave: (blob: Blob, name: string) => void | Promise<void> } = $props();

	let recording = $state(false);
	let phase = $state<'idle' | 'opening' | 'live' | 'saving'>('idle');
	let seconds = $state(0);
	let message = $state('');
	let level = $state(0);
	let fileInput = $state<HTMLInputElement | null>(null);

	let context: AudioContext | null = null;
	let stream: MediaStream | null = null;
	let processor: ScriptProcessorNode | null = null;
	let analyser: AnalyserNode | null = null;
	let chunks: Float32Array[] = [];
	let timer = 0;
	let startedAt = 0;

	const blocked = $derived(
		microphoneBlock(
			typeof window !== 'undefined' && window.isSecureContext,
			typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
			typeof window !== 'undefined' ? window.location.origin : 'this page'
		)
	);

	function release() {
		window.clearInterval(timer);
		timer = 0;
		processor?.disconnect();
		processor = null;
		analyser?.disconnect();
		analyser = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		const closing = context;
		context = null;
		void closing?.close();
		level = 0;
	}

	async function stop() {
		if (!recording && phase !== 'live') return;
		recording = false;
		phase = 'saving';
		const rate = context?.sampleRate || 48000;
		const taken = chunks;
		chunks = [];
		release();
		const length = taken.reduce((sum, chunk) => sum + chunk.length, 0);
		if (length < rate * 0.4) {
			phase = 'idle';
			message = 'That take is too short. Speak for about a second, then stop.';
			return;
		}
		const pcm = new Float32Array(length);
		let offset = 0;
		for (const chunk of taken) {
			pcm.set(chunk, offset);
			offset += chunk.length;
		}
		message = 'Saving the recording…';
		await onsave(pcmToWav(pcm, rate), 'Recorded sample.wav');
		phase = 'idle';
		message = 'Saved Recorded sample.wav.';
	}

	function meter() {
		if (!analyser || !recording) return;
		const samples = new Uint8Array(analyser.fftSize);
		analyser.getByteTimeDomainData(samples);
		let peak = 0;
		for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
		level = Math.min(100, Math.round((peak / 128) * 100));
	}

	async function start() {
		message = '';
		chunks = [];
		phase = 'opening';
		seconds = 0;
		level = 0;
		if (blocked) {
			phase = 'idle';
			message = blocked;
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
			});
		} catch {
			phase = 'idle';
			message = 'The microphone did not open. Allow it for this site in the browser settings, or choose an audio file.';
			return;
		}
		context = new AudioContext();
		await context.resume();
		const source = context.createMediaStreamSource(stream);
		analyser = context.createAnalyser();
		analyser.fftSize = 1024;
		processor = context.createScriptProcessor(4096, 1, 1);
		const mute = context.createGain();
		mute.gain.value = 0;
		processor.onaudioprocess = (event) => {
			if (!recording) return;
			chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
		};
		source.connect(analyser);
		analyser.connect(processor);
		processor.connect(mute);
		mute.connect(context.destination);
		recording = true;
		phase = 'live';
		startedAt = performance.now();
		timer = window.setInterval(() => {
			meter();
			seconds = Math.min(RECORD_SECONDS, Math.floor((performance.now() - startedAt) / 1000));
			if (performance.now() - startedAt >= RECORD_SECONDS * 1000) void stop();
		}, 200);
	}

	async function onFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		message = 'Saving the file…';
		await onsave(file, file.name);
		message = `Saved ${file.name}.`;
		if (fileInput) fileInput.value = '';
	}

	$effect(() => () => release());
</script>

<div class="grid w-full gap-2" data-voice-recorder data-mic={blocked ? 'blocked' : 'ready'}>
	{#if blocked}
		<p class="text-muted-foreground text-sm" data-mic-note>{blocked}</p>
	{/if}
	<div class="flex flex-wrap items-center gap-2">
		{#if phase === 'live'}
			<Button type="button" variant="destructive" size="sm" data-record-sample data-recording="live" onclick={stop}>
				Stop {seconds}s
			</Button>
		{:else}
			<Button type="button" variant="outline" size="sm" data-record-sample data-recording="off" disabled={phase === 'opening' || phase === 'saving'} onclick={start}>
				{phase === 'opening' ? 'Opening microphone…' : 'Record sample'}
			</Button>
		{/if}
		<Button type="button" variant="outline" size="sm" onclick={() => fileInput?.click()}>Choose audio file</Button>
		<input bind:this={fileInput} class="sr-only" type="file" accept="audio/*" onchange={onFile} />
	</div>
	{#if phase === 'opening' || phase === 'live'}
		<div class="border-border bg-card grid gap-2 rounded-lg border p-3" data-record-panel role="status">
			<p class="text-sm font-medium">{phase === 'opening' ? 'Opening the microphone…' : `Recording ${seconds}s of ${RECORD_SECONDS}s`}</p>
			<div class="bg-muted h-2 overflow-hidden rounded-full" aria-hidden="true">
				<div class="bg-primary h-full transition-[width]" style="width: {level}%"></div>
			</div>
			<p class="text-muted-foreground text-xs">Speak a short clean phrase, then stop. The sample stays in this browser.</p>
		</div>
	{/if}
	{#if message}<p class="text-muted-foreground text-sm">{message}</p>{/if}
</div>
