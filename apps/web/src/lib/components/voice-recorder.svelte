<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import { pcmToWav, RECORD_SECONDS } from '#lib/wav-pcm.js';

	let { onsave }: { onsave: (blob: Blob, name: string) => void | Promise<void> } = $props();

	let recording = $state(false);
	let seconds = $state(0);
	let message = $state('');

	let context: AudioContext | null = null;
	let stream: MediaStream | null = null;
	let processor: ScriptProcessorNode | null = null;
	let chunks: Float32Array[] = [];
	let timer = 0;
	let startedAt = 0;

	function release() {
		window.clearInterval(timer);
		timer = 0;
		processor?.disconnect();
		processor = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		const closing = context;
		context = null;
		void closing?.close();
	}

	async function stop() {
		if (!recording) return;
		recording = false;
		const rate = context?.sampleRate || 48000;
		const taken = chunks;
		chunks = [];
		release();
		const length = taken.reduce((sum, chunk) => sum + chunk.length, 0);
		if (length < rate * 0.4) {
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
		message = 'Saved Recorded sample.wav.';
	}

	async function start() {
		message = '';
		chunks = [];
		if (!navigator.mediaDevices?.getUserMedia) {
			message = 'This browser has no microphone API. Choose an audio file instead.';
			return;
		}
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			message = 'The microphone did not open. Allow it for this page, or choose an audio file.';
			return;
		}
		context = new AudioContext();
		await context.resume();
		const source = context.createMediaStreamSource(stream);
		processor = context.createScriptProcessor(4096, 1, 1);
		const mute = context.createGain();
		mute.gain.value = 0;
		processor.onaudioprocess = (event) => {
			if (!recording) return;
			chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
		};
		source.connect(processor);
		processor.connect(mute);
		mute.connect(context.destination);
		recording = true;
		seconds = 0;
		startedAt = performance.now();
		timer = window.setInterval(() => {
			seconds = Math.min(RECORD_SECONDS, Math.floor((performance.now() - startedAt) / 1000));
			if (performance.now() - startedAt >= RECORD_SECONDS * 1000) void stop();
		}, 200);
	}

	$effect(() => () => release());
</script>

<span class="inline-flex flex-wrap items-center gap-2" data-voice-recorder>
	{#if recording}
		<Button type="button" variant="destructive" size="sm" data-record-sample data-recording="live" onclick={stop}>
			Stop {seconds}s
		</Button>
	{:else}
		<Button type="button" variant="outline" size="sm" data-record-sample data-recording="off" onclick={start}>
			Record sample
		</Button>
	{/if}
	{#if message}<span class="text-muted-foreground text-xs">{message}</span>{/if}
</span>
