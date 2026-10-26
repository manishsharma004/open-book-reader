<script lang="ts">
	import AppHeader from '#lib/components/app-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { EMOTIONS, applyTtsVendorDefaults, saveVoiceSample, voiceSample, type TtsVendor } from '#lib/settings.js';
	import { commitSettings, removeVoiceSample, setPalette, setTheme, settingsState } from '#lib/settings-store.svelte.js';
	import type { Palette } from '#lib/theme.js';
	import { cloneVoice, complete, speak } from '#lib/vendor.js';
	import VoiceIdInfo from '#lib/components/voice-id-info.svelte';

	type Health = { version: string; ffmpeg: boolean; maxBodyBytes: number };

	let health = $state<Health | null>(null);
	let healthError = $state('');
	let saved = $state('');
	let vllmResult = $state('');
	let emotionResult = $state('');
	let speechResult = $state('');
	let cloneResult = $state('');
	let sampleInput = $state<HTMLInputElement | null>(null);

	const field = 'border-input bg-background h-8 w-full rounded-lg border px-2.5 text-sm';
	const settings = $derived(settingsState.current);

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

	async function save() {
		await commitSettings();
		saved = 'Saved in this browser.';
	}

	function toBase64(bytes: Uint8Array) {
		let binary = '';
		const chunk = 0x8000;
		for (let index = 0; index < bytes.length; index += chunk) {
			binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
		}
		return btoa(binary);
	}

	async function testText(kind: 'vllm' | 'emotion') {
		if (!settings) return;
		const endpoint = kind === 'vllm' ? settings.vllm : settings.emotionModel;
		const target = kind === 'vllm' ? (vllmResult = 'Calling…') : (emotionResult = 'Calling…');
		void target;
		try {
			const content = await complete(
				{ ...endpoint, enabled: true },
				'Reply with JSON only.',
				'Return {"ok":true,"kind":"' + kind + '"}'
			);
			if (kind === 'vllm') vllmResult = content.slice(0, 500);
			else emotionResult = content.slice(0, 500);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Request failed';
			if (kind === 'vllm') vllmResult = message;
			else emotionResult = message;
		}
	}

	async function testSpeech() {
		if (!settings || settings.tts.vendor === 'browser') {
			speechResult = 'Choose Kokoro, Pocket, On-device Pocket, OpenAI, or ElevenLabs to test a voice.';
			return;
		}
		speechResult = settings.tts.vendor === 'pocket-device' ? 'Loading the on-device model…' : 'Calling…';
		try {
			const useSample = settings.tts.vendor === 'pocket' || settings.tts.vendor === 'pocket-device' || settings.sendSample;
			const sample = useSample ? await voiceSample(settings) : undefined;
			const sampleBase64 = sample ? toBase64(new Uint8Array(await sample.arrayBuffer())) : null;
			const result = await speak(
				settings.tts,
				'Hello from Open Book Reader.',
				'calm',
				'Speak calmly.',
				sampleBase64,
				Boolean(sample),
				sample?.type || null
			);
			speechResult = `${result.delivery} ${result.blob.size} bytes.`;
			const audio = new Audio(URL.createObjectURL(result.blob));
			await audio.play();
		} catch (error) {
			speechResult = error instanceof Error ? error.message : 'Speech failed';
		}
	}

	async function onSample(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file || !settings) return;
		await saveVoiceSample(settings, file, file.name);
		await commitSettings();
		cloneResult = `Saved ${file.name} in this browser.`;
	}

	async function removeSample() {
		await removeVoiceSample();
		if (sampleInput) sampleInput.value = '';
		cloneResult = 'Sample removed. Later speech uses the voice id.';
	}

	async function createClone() {
		if (!settings) return;
		const sample = await voiceSample(settings);
		if (!sample) {
			cloneResult = 'Choose a sample audio file first.';
			return;
		}
		cloneResult = 'Creating a voice…';
		try {
			const voiceId = await cloneVoice(
				settings.tts,
				settings.cloneFileName || 'Open Book Reader',
				toBase64(new Uint8Array(await sample.arrayBuffer())),
				sample.type || 'audio/mpeg'
			);
			settings.tts.voice = voiceId;
			await commitSettings();
			cloneResult = `Created voice ${voiceId} and selected it.`;
		} catch (error) {
			cloneResult = error instanceof Error ? error.message : 'Could not create a voice.';
		}
	}
</script>

<AppHeader />

<main class="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
	<div class="flex flex-wrap items-center gap-3">
		<h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
		<Button onclick={save}>Save</Button>
		{#if saved}<span class="text-muted-foreground text-sm">{saved}</span>{/if}
	</div>
	<p class="text-muted-foreground text-sm">
		These stay in this browser and are sent with each proxy call. The server does not store them.
	</p>

	{#if settings}
		<Card.Root>
			<Card.Header>
				<Card.Title>Reading</Card.Title>
				<Card.Description>Ink is the default palette. Lamp is the warm paper palette.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4 sm:grid-cols-2">
				<div class="grid gap-1.5">
					<Label>Palette</Label>
					<select class={field} bind:value={settings.palette} onchange={() => setPalette(settings.palette as Palette)}>
						<option value="ink">Ink</option>
						<option value="lamp">Lamp</option>
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label>Day and night</Label>
					<select class={field} bind:value={settings.theme} onchange={() => setTheme(settings.theme)}>
						<option value="system">System</option>
						<option value="day">Day</option>
						<option value="night">Night</option>
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="speech-pace">Pace</Label>
					<select id="speech-pace" class={field} bind:value={settings.speechPace}>
						{#each [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48] as pace (pace)}
							<option value={pace}>{pace} words</option>
						{/each}
					</select>
					<p class="text-muted-foreground text-xs">Clips end on a full stop and pack up to this many words. A longer sentence stays one clip. The player has the same control.</p>
				</div>
				<div class="grid gap-1.5">
					<Label for="lookahead">Pages prepared ahead</Label>
					<select id="lookahead" class={field} bind:value={settings.lookahead}>
						<option value={2}>2 pages ahead</option>
						<option value={3}>3 pages ahead</option>
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="ocr-lang">OCR language</Label>
					<Input id="ocr-lang" bind:value={settings.ocrLanguage} maxlength={7} />
					<p class="text-muted-foreground text-xs">English (eng) is included. A page with fewer than 8 text-layer words is OCR'd.</p>
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>VLLM</Card.Title>
				<Card.Description>
					Ollama on this machine at port 11434, or an LLM at port 5173 on 127.0.0.1, localhost, or 127.0.0.1. Any other completion address is refused unless that host is listed in OLLAMA_ALLOW. Used for emotion when emotion analysis is off and this one is on.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={settings.vllm.enabled} />
					Enabled
				</label>
				<div class="grid gap-1.5">
					<Label for="vllm-url">Base URL</Label>
					<Input id="vllm-url" bind:value={settings.vllm.baseUrl} placeholder="http://127.0.0.1:11434/v1" />
				</div>
				<div class="grid gap-1.5">
					<Label for="vllm-model">Model</Label>
					<Input id="vllm-model" bind:value={settings.vllm.model} />
				</div>
				<div class="grid gap-1.5">
					<Label for="vllm-key">API key</Label>
					<Input id="vllm-key" type="password" bind:value={settings.vllm.apiKey} autocomplete="off" />
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" onclick={() => testText('vllm')}>Test</Button>
				</div>
				{#if vllmResult}<pre class="bg-muted overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">{vllmResult}</pre>{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Emotion analysis</Card.Title>
				<Card.Description>
					A separate Ollama model that returns clause emotions. It uses the same forwarding rule as VLLM. Leave it off to use the VLLM host, or pick an emotion in the reader.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3">
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={settings.emotionModel.enabled} />
					Enabled
				</label>
				<div class="grid gap-1.5">
					<Label for="emotion-url">Base URL</Label>
					<Input id="emotion-url" bind:value={settings.emotionModel.baseUrl} />
				</div>
				<div class="grid gap-1.5">
					<Label for="emotion-model">Model</Label>
					<Input id="emotion-model" bind:value={settings.emotionModel.model} />
				</div>
				<div class="grid gap-1.5">
					<Label for="emotion-key">API key</Label>
					<Input id="emotion-key" type="password" bind:value={settings.emotionModel.apiKey} autocomplete="off" />
				</div>
				<Button variant="outline" size="sm" class="w-fit" onclick={() => testText('emotion')}>Test</Button>
				{#if emotionResult}<pre class="bg-muted overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">{emotionResult}</pre>{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>TTS</Card.Title>
				<Card.Description>
					Browser voice changes pitch and rate for emotion. Kokoro on port 8880 speaks a preset voice and does not clone. Pocket on port 7508 clones from the sample below and runs on the CPU, so an 8GB GPU can stay with the text model. On-device Pocket TTS runs the published English ONNX bundle in this browser: WebNN uses the phone NPU when the page is a secure context and the browser exposes it, and otherwise the same graph runs in WebAssembly. The first clip downloads about 125 MB and keeps it here. The text is not sent to a server. Choosing Pocket points this form at port 7508. The server also accepts OpenAI and ElevenLabs, and ElevenLabs is not the cloning path for this machine.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3">
				<div class="grid gap-1.5">
					<Label for="tts-vendor">Vendor</Label>
					<select
						id="tts-vendor"
						class={field}
						value={settings.tts.vendor}
						onchange={(event) => {
							if (!settings) return;
							const next = event.currentTarget.value as TtsVendor;
							const previous = settings.tts.vendor;
							settings.tts.vendor = next;
							applyTtsVendorDefaults(settings.tts, previous);
						}}
					>
						<option value="browser">Browser voice</option>
						<option value="kokoro">Kokoro</option>
						<option value="pocket">Pocket TTS</option>
						<option value="pocket-device">On-device Pocket TTS</option>
						<option value="openai">OpenAI-compatible</option>
						<option value="elevenlabs">ElevenLabs</option>
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="tts-url">Base URL</Label>
					<Input id="tts-url" bind:value={settings.tts.baseUrl} placeholder="http://127.0.0.1:7508" />
				</div>
				<div class="grid gap-1.5 sm:grid-cols-2">
					<div class="grid gap-1.5">
						<Label for="tts-model">Model</Label>
						<Input id="tts-model" bind:value={settings.tts.model} />
					</div>
					<div class="grid gap-1.5">
						<div class="flex items-center gap-1">
							<Label for="tts-voice">Voice id</Label>
							<VoiceIdInfo
								vendor={settings.tts.vendor}
								onpick={(id) => {
									if (settings.tts.vendor === 'browser') settings.voiceName = id;
									else settings.tts.voice = id;
								}}
							/>
						</div>
						<Input id="tts-voice" bind:value={settings.tts.voice} />
					</div>
				</div>
				<div class="grid gap-1.5">
					<Label for="tts-key">API key</Label>
					<Input id="tts-key" type="password" bind:value={settings.tts.apiKey} autocomplete="off" />
				</div>
				<Button variant="outline" size="sm" class="w-fit" onclick={testSpeech}>Test speech</Button>
				{#if speechResult}<pre class="bg-muted overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">{speechResult}</pre>{/if}

				<div class="border-border grid gap-3 border-t pt-3">
					<h3 class="text-sm font-medium">Voice sample</h3>
					<p class="text-muted-foreground text-xs">
						The sample stays in this browser. Pocket TTS, including the on-device model, uses it as the reference clip. Use a clean few seconds of a voice you have permission to clone. Kokoro does not use it.
					</p>
					<Input type="file" accept="audio/*" bind:ref={sampleInput} onchange={onSample} />
					{#if settings.cloneBlobId || settings.cloneFileName}
						<div class="flex flex-wrap items-center gap-2" data-voice-sample>
							<p class="text-sm">Saved sample: {settings.cloneFileName || 'audio in this browser'}</p>
							<Button id="remove-sample" variant="destructive" size="sm" onclick={removeSample}>Remove sample</Button>
						</div>
					{/if}
					<label class="flex items-center gap-2 text-sm">
						<input type="checkbox" bind:checked={settings.sendSample} />
						Send the sample as reference audio when the host accepts it. Pocket sends a saved sample either way.
					</label>
					<Button variant="outline" size="sm" class="w-fit" onclick={createClone} disabled={settings.tts.vendor !== 'elevenlabs'}>
						Create ElevenLabs voice
					</Button>
					{#if cloneResult}<p class="text-sm whitespace-pre-wrap">{cloneResult}</p>{/if}
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		<p class="text-muted-foreground text-sm">Loading settings…</p>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>App server</Card.Title>
			<Card.Description>The browser calls this origin only. Vendor calls go through /v1.</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-wrap items-center gap-2 text-sm">
			{#if health}
				<Badge>Reachable</Badge>
				<span>Version {health.version}</span>
				<span class="text-muted-foreground">Audio conversion {health.ffmpeg ? 'available' : 'not installed'}</span>
			{:else if healthError}
				<Badge variant="destructive">{healthError}</Badge>
			{:else}
				<span class="text-muted-foreground">Checking…</span>
			{/if}
		</Card.Content>
	</Card.Root>

	<p class="text-muted-foreground text-xs">
		Emotions the reader can mark: {EMOTIONS.join(', ')}.
	</p>
</main>
