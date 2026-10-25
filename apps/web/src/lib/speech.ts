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

export function listVoices(): SpeechSynthesisVoice[] {
	if (typeof speechSynthesis === 'undefined') return [];
	return speechSynthesis.getVoices();
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
