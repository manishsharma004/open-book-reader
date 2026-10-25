import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelSpeech, createUtterance, listVoices, speak, watchVoices } from '../src/lib/speech.ts';

test('a missing speech engine lets the reader open', () => {
	assert.deepEqual(listVoices(), []);
	assert.doesNotThrow(() => cancelSpeech());
	let calls = 0;
	const stop = watchVoices(() => {
		calls += 1;
	});
	assert.equal(calls, 1);
	assert.doesNotThrow(() => stop());
	assert.throws(() => createUtterance('hello'), /no browser voice/);
	assert.throws(() => speak({} as SpeechSynthesisUtterance), /no browser voice/);
});

test('cancel survives an engine that throws, and speak uses the engine', () => {
	const calls: string[] = [];
	const fake = {
		cancel() {
			calls.push('cancel');
			throw new Error('stub');
		},
		speak(utterance: { text: string }) {
			calls.push(`speak:${utterance.text}`);
		},
		getVoices() {
			return [{ name: 'Ada', voiceURI: 'ada', lang: 'en', localService: true, default: true }];
		},
		addEventListener() {
			calls.push('listen');
		},
		removeEventListener() {
			calls.push('unlisten');
		}
	};
	const previousEngine = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis');
	const previousUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
	Object.defineProperty(globalThis, 'speechSynthesis', { value: fake, configurable: true });
	Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
		value: class {
			text: string;
			constructor(text: string) {
				this.text = text;
			}
		},
		configurable: true
	});
	try {
		assert.doesNotThrow(() => cancelSpeech());
		assert.equal(listVoices()[0]?.name, 'Ada');
		const utterance = createUtterance('noon');
		speak(utterance);
		const stop = watchVoices(() => {});
		stop();
		assert.deepEqual(calls, ['cancel', 'speak:noon', 'listen', 'unlisten']);
	} finally {
		if (previousEngine) Object.defineProperty(globalThis, 'speechSynthesis', previousEngine);
		else delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
		if (previousUtterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', previousUtterance);
		else delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
	}
});

test('a voice listener that throws does not escape', () => {
	const fake = {
		cancel() {},
		speak() {},
		getVoices() {
			throw new Error('voices');
		},
		addEventListener() {
			throw new Error('listen');
		},
		removeEventListener() {}
	};
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis');
	Object.defineProperty(globalThis, 'speechSynthesis', { value: fake, configurable: true });
	try {
		assert.deepEqual(listVoices(), []);
		const stop = watchVoices(() => {});
		assert.doesNotThrow(() => stop());
	} finally {
		if (previous) Object.defineProperty(globalThis, 'speechSynthesis', previous);
		else delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
	}
});
