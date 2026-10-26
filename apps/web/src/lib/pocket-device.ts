import { logPipeline } from '#lib/pipeline.svelte.js';
import { chunksToWavBlob, PocketTTS } from '#lib/pocket-onnx/index.js';
import { POCKET_DEVICE_MODEL, POCKET_ONNX_BASE, POCKET_VOICE, type TtsSettings } from '#lib/settings.js';
import type { SpeechResult } from '#lib/vendor.js';

type Engine = PocketTTS & { device?: string };

let engine: Engine | null = null;
let engineKey = '';
let voiceKey = '';
let voiceRef = '';
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(run: () => Promise<T>): Promise<T> {
	const next = chain.then(run, run);
	chain = next.then(
		() => undefined,
		() => undefined
	);
	return next;
}

async function monoPcm(bytes: Uint8Array): Promise<{ pcm: Float32Array; rate: number }> {
	const ctx = new AudioContext();
	try {
		const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		return { pcm: new Float32Array(decoded.getChannelData(0)), rate: decoded.sampleRate };
	} finally {
		await ctx.close();
	}
}

function noteProgress(info: { type?: string; label?: string; loaded?: number; total?: number; status?: string; device?: string; fromCache?: boolean }) {
	if (info.type === 'status') {
		const device = info.device ? ` (${info.device})` : '';
		logPipeline({
			page: 0,
			stage: 'tts',
			status: 'start',
			ms: null,
			detail: `On-device Pocket TTS: ${info.status ?? 'working'}${device}`
		});
		return;
	}
	if (info.label && info.total && info.loaded === info.total) {
		logPipeline({
			page: 0,
			stage: 'tts',
			status: 'ok',
			ms: null,
			detail: `On-device Pocket TTS loaded ${info.label}${info.fromCache ? ' from this browser' : ''}.`
		});
	}
}

async function engineFor(settings: TtsSettings, cloning: boolean): Promise<Engine> {
	const model = settings.model || POCKET_DEVICE_MODEL;
	const base = settings.baseUrl || POCKET_ONNX_BASE;
	const key = `${model}:${cloning}:${base}`;
	if (engine && engineKey === key && engine.ready) return engine;
	engine?.destroy();
	voiceKey = '';
	voiceRef = '';
	const next = new PocketTTS({
		language: model,
		quantized: true,
		voiceCloning: cloning,
		modelBaseUrl: base,
		webnn: true
	}) as Engine;
	await next.load((info) => noteProgress(info));
	engine = next;
	engineKey = key;
	return next;
}

async function voiceFor(active: Engine, settings: TtsSettings, sample: Uint8Array | null): Promise<string> {
	if (sample) {
		const key = `sample:${sample.byteLength}:${sample[0] ?? 0}:${sample[sample.byteLength - 1] ?? 0}`;
		if (voiceRef && voiceKey === key) return voiceRef;
		const decoded = await monoPcm(sample);
		voiceRef = await active.cloneVoice(decoded.pcm, { inputSampleRate: decoded.rate });
		voiceKey = key;
		return voiceRef;
	}
	const name = settings.voice || POCKET_VOICE;
	const known = active.predefinedVoices;
	if (known.length && !known.includes(name)) {
		throw new Error(`Unknown built-in voice: ${name}. This on-device bundle includes ${known.join(', ')}.`);
	}
	const key = `voice:${name}`;
	if (voiceRef && voiceKey === key) return voiceRef;
	voiceRef = await active.loadVoice(name);
	voiceKey = key;
	return voiceRef;
}

export function speakPocketDevice(
	settings: TtsSettings,
	text: string,
	sample: Uint8Array | null,
	signal?: AbortSignal
): Promise<SpeechResult> {
	return enqueue(async () => {
		if (signal?.aborted) throw new DOMException('Skipped', 'AbortError');
		const active = await engineFor(settings, Boolean(sample));
		if (signal?.aborted) throw new DOMException('Skipped', 'AbortError');
		const voice = await voiceFor(active, settings, sample);
		const chunks: Float32Array[] = [];
		const stop = () => {
			void active.stop();
		};
		signal?.addEventListener('abort', stop);
		try {
			await active.generate(text, {
				voice,
				onChunk: (audio) => {
					chunks.push(audio);
				}
			});
		} finally {
			signal?.removeEventListener('abort', stop);
		}
		if (signal?.aborted) throw new DOMException('Skipped', 'AbortError');
		const blob = chunksToWavBlob(chunks, active.sampleRate);
		const device = active.device || 'wasm';
		return {
			blob,
			words: null,
			delivery: `On-device Pocket TTS via ${device}. The text stayed in this browser. This model has no emotion channel.`,
			mime: 'audio/wav'
		};
	});
}
