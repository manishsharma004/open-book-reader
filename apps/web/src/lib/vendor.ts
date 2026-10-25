import { canonEmotion } from '#lib/speech.js';
import type { EmotionName, Endpoint, TtsSettings } from '#lib/settings.js';

export type TimedWord = { text: string; start: number; end: number };

export type SpeechResult = {
	blob: Blob;
	words: TimedWord[] | null;
	delivery: string;
	mime: string;
};

async function postJson(path: string, body: unknown) {
	const response = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const text = await response.text();
	if (!response.ok) throw new Error(text.slice(0, 700) || `Request failed (${response.status})`);
	return JSON.parse(text) as Record<string, unknown>;
}

export async function complete(endpoint: Endpoint, system: string, user: string) {
	const payload = await postJson('/v1/complete', {
		baseUrl: endpoint.baseUrl,
		model: endpoint.model,
		apiKey: endpoint.apiKey,
		system,
		user
	});
	return typeof payload.content === 'string' ? payload.content : JSON.stringify(payload.content ?? payload);
}

export async function speak(
	settings: TtsSettings,
	text: string,
	emotion: EmotionName,
	instructions: string,
	sampleBase64: string | null,
	attachSample: boolean,
	sampleMime: string | null = null
) {
	const payload = await postJson('/v1/speak', {
		vendor: settings.vendor,
		baseUrl: settings.baseUrl,
		model: settings.model,
		apiKey: settings.apiKey,
		voice: settings.voice,
		text,
		emotion,
		instructions,
		sampleBase64: attachSample ? sampleBase64 : null,
		sampleMime: attachSample ? sampleMime || '' : ''
	});
	const audioBase64 = typeof payload.audioBase64 === 'string' ? payload.audioBase64 : '';
	if (!audioBase64) throw new Error('The speech host returned no audio.');
	const mime = typeof payload.mime === 'string' ? payload.mime : 'audio/mpeg';
	const binary = atob(audioBase64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	const words = Array.isArray(payload.words)
		? payload.words.flatMap((item) => {
				if (!item || typeof item !== 'object') return [];
				const record = item as Record<string, unknown>;
				if (typeof record.start !== 'number' || typeof record.end !== 'number') return [];
				return [{ text: String(record.text ?? ''), start: record.start, end: record.end }];
			})
		: null;
	return {
		blob: new Blob([bytes], { type: mime }),
		words: words && words.length ? words : null,
		delivery: typeof payload.delivery === 'string' ? payload.delivery : '',
		mime
	} satisfies SpeechResult;
}

export async function cloneVoice(settings: TtsSettings, name: string, sampleBase64: string, mime: string) {
	const payload = await postJson('/v1/voices/clone', {
		vendor: settings.vendor,
		baseUrl: settings.baseUrl,
		apiKey: settings.apiKey,
		name,
		sampleBase64,
		mime
	});
	const voiceId = typeof payload.voiceId === 'string' ? payload.voiceId : '';
	if (!voiceId) throw new Error('The vendor did not return a voice id.');
	return voiceId;
}

export function parseEmotionJson(raw: string): { text: string; emotion: EmotionName }[] | null {
	const start = raw.indexOf('{');
	const end = raw.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const parsed = JSON.parse(raw.slice(start, end + 1)) as { clauses?: { text?: string; emotion?: string }[] };
		if (!Array.isArray(parsed.clauses) || parsed.clauses.length === 0) return null;
		return parsed.clauses.map((clause) => ({
			text: String(clause.text ?? ''),
			emotion: canonEmotion(String(clause.emotion ?? 'neutral'))
		}));
	} catch {
		return null;
	}
}
