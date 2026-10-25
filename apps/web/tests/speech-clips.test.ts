import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clipIndexForWord,
	READY_TINT,
	SPEECH_CHUNK_WORDS,
	splitSpeechWords,
	wordBackdrop
} from '../src/lib/speech-clips.ts';

test('a page with no sentence marks is cut into 24-word clips', () => {
	const words = Array.from({ length: 60 }, (_, index) => `word${index}`);
	const spans = splitSpeechWords(words);
	assert.deepEqual(
		spans.map((span) => span.wordEnd - span.wordStart),
		[24, 24, 12]
	);
	assert.equal(spans[0].wordStart, 0);
	assert.equal(spans.at(-1)?.wordEnd, 60);
	for (const span of spans) assert.ok(span.wordEnd - span.wordStart <= SPEECH_CHUNK_WORDS);
});

test('sentences pack together until the word cap', () => {
	const words = 'Mara waited. The station clock had stopped. Noon passed. Then the train left the empty platform at last.'.split(
		' '
	);
	const spans = splitSpeechWords(words);
	assert.equal(spans.length, 1);
	assert.equal(spans[0].wordEnd, words.length);
});

test('a long sentence breaks at a comma before the word cap', () => {
	const words = Array.from({ length: 40 }, (_, index) => (index === 9 ? 'clause,' : `word${index}`));
	const spans = splitSpeechWords(words);
	assert.equal(spans[0].wordEnd, 10);
	assert.ok(spans.every((span) => span.wordEnd - span.wordStart <= SPEECH_CHUNK_WORDS));
	assert.equal(spans.at(-1)?.wordEnd, 40);
});

test('clips cover the whole page and none of them is the whole page', () => {
	const words = Array.from({ length: 100 }, (_, index) => `word${index}`);
	const clips = splitSpeechWords(words);
	assert.ok(clips.length > 1);
	assert.equal(clips[0].wordStart, 0);
	assert.equal(clips.at(-1)?.wordEnd, words.length);
	for (let index = 1; index < clips.length; index += 1) {
		assert.equal(clips[index].wordStart, clips[index - 1].wordEnd);
	}
});

test('a word maps to the clip that contains it', () => {
	const clips = splitSpeechWords(Array.from({ length: 30 }, () => 'word'));
	assert.equal(clipIndexForWord(clips, 0), 0);
	assert.equal(clipIndexForWord(clips, 24), 1);
	assert.equal(clipIndexForWord(clips, 30), -1);
});

test('a ready word is a light green tint and the active word keeps the highlight', () => {
	assert.equal(wordBackdrop(false, true), READY_TINT);
	assert.equal(wordBackdrop(true, true), 'var(--highlight)');
	assert.equal(wordBackdrop(false, false), 'transparent');
});
