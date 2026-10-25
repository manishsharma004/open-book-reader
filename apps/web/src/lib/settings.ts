import { deleteBlob, getBlob, putBlob, readAppRecord, writeAppRecord } from '#lib/db.js';
import { randomId } from '#lib/hash.js';
import { applyPalette, applyTheme, readPalette, readTheme, type Palette, type ThemeMode } from '#lib/theme.js';

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
export type TtsVendor = 'browser' | 'openai' | 'kokoro' | 'elevenlabs';

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
	ocrLanguage: string;
	voiceName: string;
	emotion: EmotionChoice;
	sendSample: boolean;
	cloneBlobId: string | null;
	cloneFileName: string;
	vllm: Endpoint;
	emotionModel: Endpoint;
	tts: TtsSettings;
};

export function defaultSettings(): AppSettings {
	return {
		theme: readTheme(),
		palette: readPalette(),
		lookahead: 2,
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
		}
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
	return {
		theme: theme === 'day' || theme === 'night' || theme === 'system' ? theme : base.theme,
		palette: palette === 'lamp' || palette === 'ink' ? palette : base.palette,
		lookahead,
		ocrLanguage: typeof raw.ocrLanguage === 'string' && raw.ocrLanguage ? raw.ocrLanguage : 'eng',
		voiceName: typeof raw.voiceName === 'string' ? raw.voiceName : '',
		emotion: emotion === 'auto' || (EMOTIONS as readonly string[]).includes(String(emotion)) ? (emotion as EmotionChoice) : 'auto',
		sendSample: raw.sendSample === true,
		cloneBlobId: typeof raw.cloneBlobId === 'string' ? raw.cloneBlobId : null,
		cloneFileName: typeof raw.cloneFileName === 'string' ? raw.cloneFileName : '',
		vllm: endpoint(raw.vllm, base.vllm),
		emotionModel: endpoint(raw.emotionModel, base.emotionModel),
		tts: {
			vendor: vendor === 'openai' || vendor === 'kokoro' || vendor === 'elevenlabs' || vendor === 'browser' ? vendor : 'browser',
			baseUrl: typeof ttsRaw.baseUrl === 'string' ? ttsRaw.baseUrl : base.tts.baseUrl,
			model: typeof ttsRaw.model === 'string' ? ttsRaw.model : base.tts.model,
			apiKey: typeof ttsRaw.apiKey === 'string' ? ttsRaw.apiKey : '',
			voice: typeof ttsRaw.voice === 'string' ? ttsRaw.voice : base.tts.voice
		}
	};
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
	const plain = JSON.parse(JSON.stringify(settings)) as AppSettings;
	plain.lookahead = Number(plain.lookahead) === 3 ? 3 : 2;
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
