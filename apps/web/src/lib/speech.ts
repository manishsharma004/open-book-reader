import { EMOTIONS, type EmotionName } from '#lib/settings.js';

export const PROSODY: Record<EmotionName, { pitch: number; rate: number; volume: number; instruction: string }> = {
	neutral: { pitch: 1, rate: 1, volume: 1, instruction: 'Speak in a neutral narrative voice.' },
	calm: { pitch: 0.92, rate: 0.9, volume: 0.95, instruction: 'Speak calmly and a little slower.' },
	warm: { pitch: 1.04, rate: 0.95, volume: 1, instruction: 'Speak warmly.' },
	tense: { pitch: 1.06, rate: 1.08, volume: 1, instruction: 'Speak with tension, a little faster.' },
	somber: { pitch: 0.86, rate: 0.88, volume: 0.9, instruction: 'Speak in a somber, low voice.' },
	excited: { pitch: 1.22, rate: 1.14, volume: 1, instruction: 'Speak with excitement.' },
	whispered: { pitch: 1.18, rate: 0.84, volume: 0.58, instruction: 'Speak as a quiet whisper.' },
	angry: { pitch: 0.8, rate: 1.12, volume: 1, instruction: 'Speak with restrained anger.' }
};

export function canonEmotion(value: string): EmotionName {
	return (EMOTIONS as readonly string[]).includes(value) ? (value as EmotionName) : 'neutral';
}

export function speechEngine(): SpeechSynthesis | null {
	try {
		const engine = globalThis.speechSynthesis;
		if (!engine || typeof engine.cancel !== 'function' || typeof engine.speak !== 'function') return null;
		return engine;
	} catch {
		return null;
	}
}

export function listVoices(): SpeechSynthesisVoice[] {
	const engine = speechEngine();
	if (!engine) return [];
	try {
		return engine.getVoices();
	} catch {
		return [];
	}
}

export function cancelSpeech() {
	const engine = speechEngine();
	if (!engine) return;
	try {
		engine.cancel();
	} catch {
		// A stub engine on an insecure page can throw. Opening the book must not.
	}
}

const NO_BROWSER_VOICE =
	'This page has no browser voice. Open it on localhost or HTTPS, or choose a speech model in Settings.';

export function createUtterance(text: string): SpeechSynthesisUtterance {
	if (typeof SpeechSynthesisUtterance !== 'function') throw new Error(NO_BROWSER_VOICE);
	try {
		return new SpeechSynthesisUtterance(text);
	} catch {
		throw new Error(NO_BROWSER_VOICE);
	}
}

export function speak(utterance: SpeechSynthesisUtterance) {
	const engine = speechEngine();
	if (!engine) throw new Error(NO_BROWSER_VOICE);
	engine.speak(utterance);
}

export function watchVoices(sync: () => void): () => void {
	sync();
	const engine = speechEngine();
	if (!engine || typeof engine.addEventListener !== 'function') return () => {};
	const onChange = () => sync();
	try {
		engine.addEventListener('voiceschanged', onChange);
	} catch {
		return () => {};
	}
	return () => {
		try {
			engine.removeEventListener('voiceschanged', onChange);
		} catch {
			// The engine can disappear between listen and cleanup.
		}
	};
}

export function voiceByName(name: string): SpeechSynthesisVoice | null {
	if (!name) return null;
	return listVoices().find((voice) => voice.voiceURI === name || voice.name === name) ?? null;
}

export function browserDelivery(emotion: EmotionName, speed: number) {
	const prosody = PROSODY[emotion];
	const rate = Math.min(2, Math.max(0.5, speed * prosody.rate));
	return {
		pitch: prosody.pitch,
		rate,
		volume: prosody.volume,
		detail: `Browser voice uses pitch ${prosody.pitch}, rate ${rate.toFixed(2)}, volume ${prosody.volume} for ${emotion}. This is not model expression.`
	};
}
