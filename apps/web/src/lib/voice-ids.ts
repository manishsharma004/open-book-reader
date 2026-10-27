import type { TtsVendor } from '#lib/settings.js';

/** Built-in names for the Pocket server model `english_18m_refl_2026-10`. */
export const POCKET_VOICE_IDS = [
	'alba',
	'anna',
	'azelma',
	'bill_boerst',
	'caro_davy',
	'charles',
	'cosette',
	'daan',
	'eponine',
	'estelle',
	'eve',
	'fantine',
	'george',
	'giovanni',
	'jane',
	'javert',
	'jean',
	'juergen',
	'lola',
	'marius',
	'mary',
	'michael',
	'paul',
	'peter_yearsley',
	'rafael',
	'stuart_bell',
	'vera'
] as const;

/** Built-in names in every published ONNX bundle, including `english_2026-04`. */
export const POCKET_DEVICE_VOICE_IDS = [
	'alba',
	'azelma',
	'cosette',
	'eponine',
	'fantine',
	'javert',
	'jean',
	'marius'
] as const;

export function pocketDeviceVoice(voice: string): string {
	return (POCKET_DEVICE_VOICE_IDS as readonly string[]).includes(voice) ? voice : 'alba';
}

/** English presets shipped with Kokoro. Kokoro does not clone. */
export const KOKORO_VOICE_IDS = [
	'af_alloy',
	'af_aoede',
	'af_bella',
	'af_heart',
	'af_jessica',
	'af_kore',
	'af_nicole',
	'af_nova',
	'af_river',
	'af_sarah',
	'af_sky',
	'am_adam',
	'am_echo',
	'am_eric',
	'am_fenrir',
	'am_liam',
	'am_michael',
	'am_onyx',
	'am_puck',
	'bf_alice',
	'bf_emma',
	'bf_isabella',
	'bf_lily',
	'bm_daniel',
	'bm_fable',
	'bm_george',
	'bm_lewis'
] as const;

/** Voices accepted by the OpenAI speech route. */
export const OPENAI_VOICE_IDS = [
	'alloy',
	'ash',
	'ballad',
	'cedar',
	'coral',
	'echo',
	'fable',
	'marin',
	'nova',
	'onyx',
	'sage',
	'shimmer',
	'verse'
] as const;

export type VoiceIdChoice = { id: string; label: string };

export function voiceCatalog(
	vendor: TtsVendor,
	browserVoices: { name: string; voiceURI: string }[] = []
): { note: string; items: VoiceIdChoice[] } {
	if (vendor === 'browser') {
		const items = browserVoices
			.map((voice) => {
				const id = voice.voiceURI || voice.name;
				const label = voice.name && voice.voiceURI && voice.name !== voice.voiceURI ? `${voice.name} · ${voice.voiceURI}` : id;
				return { id, label };
			})
			.filter((item) => item.id);
		return {
			note: items.length
				? 'Voices in this browser. The reader stores the id after the dot.'
				: 'This browser has not listed voices yet. Open the reader on localhost or HTTPS, or choose another vendor.',
			items
		};
	}
	if (vendor === 'kokoro') {
		return {
			note: 'Kokoro preset voices. Kokoro does not clone.',
			items: KOKORO_VOICE_IDS.map((id) => ({ id, label: id }))
		};
	}
	if (vendor === 'pocket') {
		return {
			note: 'Built-in voices for the Pocket server. alba is the default. A saved sample is used instead of this id.',
			items: POCKET_VOICE_IDS.map((id) => ({ id, label: id }))
		};
	}
	if (vendor === 'pocket-device') {
		return {
			note: 'Suggestions for the published English bundle. A custom repo can add more names from its embeddings. A saved sample is used instead of this id.',
			items: POCKET_DEVICE_VOICE_IDS.map((id) => ({ id, label: id }))
		};
	}
	if (vendor === 'openai') {
		return {
			note: 'OpenAI speech voices.',
			items: OPENAI_VOICE_IDS.map((id) => ({ id, label: id }))
		};
	}
	return {
		note: 'ElevenLabs voice ids come from your account. Create ElevenLabs voice stores the new id in this field.',
		items: []
	};
}
