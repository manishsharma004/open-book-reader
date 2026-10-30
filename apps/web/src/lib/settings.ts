import { deleteBlob, getBlob, putBlob, readAppRecord, writeAppRecord } from '#lib/db.js';
import { openBooksBase } from '#lib/open-books-api.js';
import { SPEECH_CHUNK_WORDS, speechPace } from '#lib/speech-clips.js';
import { randomId } from '#lib/hash.js';
import { applyPalette, applyTheme, isPalette, readPalette, readTheme, type Palette, type ThemeMode } from '#lib/theme.js';

export const EMOTIONS = [
	'neutral',
	'calm',
	'warm',
	'tense',
	'somber',
	'excited',
	'whispered',
	'angry'
] as const;

export type EmotionName = (typeof EMOTIONS)[number];
export type EmotionChoice = EmotionName | 'auto';
export type TtsVendor = 'browser' | 'openai' | 'kokoro' | 'elevenlabs' | 'pocket' | 'pocket-device' | 'lfm';

export const POCKET_MODEL = 'english_18m_refl_2026-10';
export const POCKET_DEVICE_MODEL = 'english_2026-04';
export const POCKET_ONNX_BASE = 'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx';
export const POCKET_VOICE = 'alba';
export const POCKET_PORT = '7508';
export const LFM_PORT = '7510';
export const LFM_LANG = 'en';
export const LFM_VOICE = 'female';
export const LFM_LANGS = [
	'ar',
	'da',
	'de',
	'el',
	'en',
	'en-gb',
	'es',
	'fi',
	'fr',
	'he',
	'it',
	'ja',
	'ko',
	'nl',
	'pl',
	'pt',
	'sv',
	'tr',
	'zh'
] as const;
function isHttpHost(url: URL | null): url is URL {
	return !!url && url.protocol === 'http:' && url.hostname.length > 0;
}

export type Endpoint = {
	enabled: boolean;
	baseUrl: string;
	model: string;
	apiKey: string;
};

export type TtsSettings = {
	vendor: TtsVendor;
	baseUrl: string;
	model: string;
	apiKey: string;
	voice: string;
};

export type AppSettings = {
	theme: ThemeMode;
	palette: Palette;
	lookahead: 2 | 3;
	speechPace: number;
	ocrLanguage: string;
	voiceName: string;
	emotion: EmotionChoice;
	sendSample: boolean;
	cloneBlobId: string | null;
	cloneFileName: string;
	vllm: Endpoint;
	emotionModel: Endpoint;
	tts: TtsSettings;
	openBooksUrl: string;
};

export function defaultSettings(): AppSettings {
	return {
		theme: readTheme(),
		palette: readPalette(),
		lookahead: 2,
		speechPace: SPEECH_CHUNK_WORDS,
		ocrLanguage: 'eng',
		voiceName: '',
		emotion: 'auto',
		sendSample: false,
		cloneBlobId: null,
		cloneFileName: '',
		vllm: {
			enabled: false,
			baseUrl: 'http://127.0.0.1:11434/v1',
			model: 'llama3.2',
			apiKey: ''
		},
		emotionModel: {
			enabled: false,
			baseUrl: 'http://127.0.0.1:11434/v1',
			model: 'llama3.2',
			apiKey: ''
		},
		tts: {
			vendor: 'browser',
			baseUrl: 'http://127.0.0.1:8880/v1',
			model: 'kokoro',
			apiKey: '',
			voice: 'af_heart'
		},
		openBooksUrl: ''
	};
}

function endpoint(value: unknown, fallback: Endpoint): Endpoint {
	const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
	return {
		enabled: record.enabled === true,
		baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : fallback.baseUrl,
		model: typeof record.model === 'string' ? record.model : fallback.model,
		apiKey: typeof record.apiKey === 'string' ? record.apiKey : ''
	};
}

export function mergeSettings(raw: Record<string, unknown> | undefined): AppSettings {
	const base = defaultSettings();
	if (!raw) return base;
	const theme = raw.theme;
	const palette = raw.palette;
	const emotion = raw.emotion;
	const vendor = raw.tts && typeof raw.tts === 'object' ? (raw.tts as Record<string, unknown>).vendor : undefined;
	const lookahead = raw.lookahead === 3 ? 3 : 2;
	const ttsRaw = raw.tts && typeof raw.tts === 'object' ? (raw.tts as Record<string, unknown>) : {};
	const vendorName =
		vendor === 'openai' ||
		vendor === 'kokoro' ||
		vendor === 'elevenlabs' ||
		vendor === 'pocket' ||
		vendor === 'pocket-device' ||
		vendor === 'lfm' ||
		vendor === 'browser'
			? vendor
			: 'browser';
	let baseUrl = typeof ttsRaw.baseUrl === 'string' ? ttsRaw.baseUrl : base.tts.baseUrl;
	if (vendorName === 'pocket') {
		try {
			const current = new URL(baseUrl);
			if (current.port === '8000' && isHttpHost(current)) {
				current.port = POCKET_PORT;
				current.pathname = '';
				current.search = '';
				current.hash = '';
				baseUrl = current.origin;
			}
		} catch {
			baseUrl = `http://127.0.0.1:${POCKET_PORT}`;
		}
	}
	return {
		theme: theme === 'day' || theme === 'night' || theme === 'system' ? theme : base.theme,
		palette: isPalette(palette) ? palette : base.palette,
		lookahead,
		speechPace: speechPace(raw.speechPace),
		ocrLanguage: typeof raw.ocrLanguage === 'string' && raw.ocrLanguage ? raw.ocrLanguage : 'eng',
		voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : '',
		emotion: emotion === 'auto' || (EMOTIONS as readonly string[]).includes(String(emotion)) ? (emotion as EmotionChoice) : 'auto',
		sendSample: raw.sendSample === true,
		cloneBlobId: typeof raw.cloneBlobId === 'string' ? raw.cloneBlobId : null,
		cloneFileName: typeof raw.cloneFileName === 'string' ? raw.cloneFileName : '',
		vllm: endpoint(raw.vllm, base.vllm),
		emotionModel: endpoint(raw.emotionModel, base.emotionModel),
		tts: {
			vendor: vendorName,
			baseUrl,
			model: typeof ttsRaw.model === 'string' ? ttsRaw.model : base.tts.model,
			apiKey: typeof ttsRaw.apiKey === 'string' ? ttsRaw.apiKey : '',
			voice:
				vendorName === 'pocket-device'
					? voiceName(ttsRaw.voice, POCKET_VOICE)
					: typeof ttsRaw.voice === 'string'
						? ttsRaw.voice
						: base.tts.voice
		},
		openBooksUrl: openBooksBase(typeof raw.openBooksUrl === 'string' ? raw.openBooksUrl : '')
	};
}

function voiceName(value: unknown, fallback: string) {
	if (typeof value !== 'string') return fallback;
	const cleaned = value.trim();
	return /^[A-Za-z0-9_.-]{1,80}$/.test(cleaned) ? cleaned : fallback;
}

function looksLikeOnDeviceBundle(url: string) {
	return url.includes('huggingface.co') || url.includes('/onnx') || url.endsWith('bundle.json');
}

function speechUrl(value: string) {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

export function applyTtsVendorDefaults(tts: TtsSettings, previous: TtsVendor) {
	if (tts.vendor === 'pocket' && previous !== 'pocket') {
		const current = speechUrl(tts.baseUrl);
		if (isHttpHost(current) && (current.port === '8880' || current.port === '8000')) {
			current.port = POCKET_PORT;
			current.pathname = '';
			current.search = '';
			current.hash = '';
			tts.baseUrl = current.origin;
		} else if (!isHttpHost(current) || current.port !== POCKET_PORT) {
			tts.baseUrl = `http://127.0.0.1:${POCKET_PORT}`;
		}
		if (!tts.model || tts.model === 'kokoro' || (LFM_LANGS as readonly string[]).includes(tts.model) || tts.model.startsWith('gpt-') || tts.model.startsWith('eleven')) {
			tts.model = POCKET_MODEL;
		}
		if (!tts.voice || tts.voice === 'af_heart' || tts.voice === 'alloy' || tts.voice === 'female' || tts.voice === 'male') tts.voice = POCKET_VOICE;
	}
	if (tts.vendor === 'pocket-device' && previous !== 'pocket-device') {
		if (!tts.model || tts.model === 'kokoro' || tts.model === POCKET_MODEL || (LFM_LANGS as readonly string[]).includes(tts.model) || tts.model.startsWith('gpt-') || tts.model.startsWith('eleven')) {
			tts.model = POCKET_DEVICE_MODEL;
		}
		if (!tts.voice || tts.voice === 'af_heart' || tts.voice === 'alloy' || tts.voice === 'female' || tts.voice === 'male') tts.voice = POCKET_VOICE;
		if (!looksLikeOnDeviceBundle(tts.baseUrl)) tts.baseUrl = POCKET_ONNX_BASE;
	}
	if (tts.vendor === 'pocket' && previous === 'pocket-device') {
		if (tts.baseUrl.includes('pocket-tts-onnx')) tts.baseUrl = `http://127.0.0.1:${POCKET_PORT}`;
		if (tts.model === POCKET_DEVICE_MODEL) tts.model = POCKET_MODEL;
	}
	if (tts.vendor === 'lfm' && previous !== 'lfm') {
		const current = speechUrl(tts.baseUrl);
		if (isHttpHost(current) && (current.port === '8880' || current.port === POCKET_PORT || current.port === '8000')) {
			current.port = LFM_PORT;
			current.pathname = '';
			current.search = '';
			current.hash = '';
			tts.baseUrl = current.origin;
		} else if (!isHttpHost(current) || current.port !== LFM_PORT) {
			tts.baseUrl = `http://127.0.0.1:${LFM_PORT}`;
		}
		if (!(LFM_LANGS as readonly string[]).includes(tts.model)) tts.model = LFM_LANG;
		if (tts.voice !== 'female' && tts.voice !== 'male') tts.voice = LFM_VOICE;
	}
	if (tts.vendor === 'kokoro' && (previous === 'pocket' || previous === 'pocket-device' || previous === 'lfm')) {
		const current = speechUrl(tts.baseUrl);
		if (isHttpHost(current) && (current.port === POCKET_PORT || current.port === LFM_PORT)) {
			current.port = '8880';
			current.pathname = '/v1';
			tts.baseUrl = `${current.origin}/v1`;
		}
		if (tts.baseUrl.includes('pocket-tts-onnx')) tts.baseUrl = 'http://127.0.0.1:8880/v1';
		if (tts.model === POCKET_MODEL || tts.model === POCKET_DEVICE_MODEL || (LFM_LANGS as readonly string[]).includes(tts.model)) {
			tts.model = 'kokoro';
		}
		if (tts.voice === POCKET_VOICE || tts.voice === 'female' || tts.voice === 'male') tts.voice = 'af_heart';
	}
}

export function emotionEndpoint(settings: AppSettings): Endpoint | null {
	if (settings.emotionModel.enabled) return settings.emotionModel;
	if (settings.vllm.enabled) return settings.vllm;
	return null;
}

export function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url || 'missing host';
	}
}

export async function loadStoredSettings(): Promise<AppSettings> {
	const record = await readAppRecord();
	const settings = mergeSettings(record);
	applyTheme(settings.theme);
	applyPalette(settings.palette);
	return settings;
}

export async function storeSettings(settings: AppSettings) {
	settings.openBooksUrl = openBooksBase(settings.openBooksUrl);
	const plain = JSON.parse(JSON.stringify(settings)) as AppSettings;
	plain.lookahead = Number(plain.lookahead) === 3 ? 3 : 2;
	plain.speechPace = speechPace(plain.speechPace);
	applyTheme(plain.theme);
	applyPalette(plain.palette);
	await writeAppRecord({ id: 'app', ...plain });
}

export async function saveVoiceSample(settings: AppSettings, file: Blob, fileName: string) {
	const id = settings.cloneBlobId ?? randomId();
	await putBlob(id, 'sample', file);
	settings.cloneBlobId = id;
	settings.cloneFileName = fileName;
	await storeSettings(settings);
}

export async function voiceSample(settings: AppSettings): Promise<Blob | undefined> {
	if (!settings.cloneBlobId) return undefined;
	return getBlob(settings.cloneBlobId);
}

export async function clearVoiceSample(settings: AppSettings) {
	if (settings.cloneBlobId) await deleteBlob(settings.cloneBlobId);
	settings.cloneBlobId = null;
	settings.cloneFileName = '';
	await storeSettings(settings);
}
