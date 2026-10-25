import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	clipIndexForWord,
	HEADING_TINT,
	READY_TINT,
	SPEECH_CHUNK_WORDS,
	speechPace,
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

test('sentences pack together until the pace', () => {
	const words = 'Mara waited. The station clock had stopped. Noon passed. Then the train left the empty platform at last.'.split(
		' '
	);
	const spans = splitSpeechWords(words);
	assert.equal(spans.length, 1);
	assert.equal(spans[0].wordEnd, words.length);
	const brief = splitSpeechWords(words, 12);
	assert.deepEqual(
		brief.map((span) => span.wordEnd - span.wordStart),
		[9, 9]
	);
});

test('a long sentence stays whole past the pace and ignores commas', () => {
	const words = Array.from({ length: 36 }, (_, index) => (index === 9 ? 'clause,' : index === 35 ? 'end.' : `word${index}`));
	const spans = splitSpeechWords(words);
	assert.deepEqual(spans, [{ wordStart: 0, wordEnd: 36 }]);
});

test('a sentence longer than twice the pace is cut at the pace', () => {
	const words = Array.from({ length: 70 }, (_, index) => (index === 69 ? 'end.' : `word${index}`));
	const spans = splitSpeechWords(words, 24);
	assert.ok(spans[0].wordEnd - spans[0].wordStart === SPEECH_CHUNK_WORDS);
	assert.equal(spans.at(-1)?.wordEnd, 70);
	assert.ok(spans.every((span) => span.wordEnd > span.wordStart));
});

test('pace snaps to a word step between 8 and 48', () => {
	assert.equal(speechPace(undefined), 24);
	assert.equal(speechPace(3), 8);
	assert.equal(speechPace(25), 24);
	assert.equal(speechPace(90), 48);
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
	assert.equal(wordBackdrop(false, false, 'heading'), HEADING_TINT);
	assert.equal(wordBackdrop(false, true, 'heading'), READY_TINT);
	assert.equal(wordBackdrop(false, true, 'header'), 'transparent');
});

test('a chapter title stays its own clip and a header is skipped', () => {
	const words = ['12', 'Chapter', '1', 'Mara', 'waited.', 'Noon', 'passed.'];
	const roles = ['header', 'heading', 'heading', 'body', 'body', 'body', 'body'] as const;
	const spans = splitSpeechWords(words, 24, [...roles]);
	assert.deepEqual(spans, [
		{ wordStart: 1, wordEnd: 3 },
		{ wordStart: 3, wordEnd: 7 }
	]);
	assert.equal(clipIndexForWord(spans, 0), 0);
	assert.equal(clipIndexForWord(spans, 3), 1);
	assert.equal(clipIndexForWord(spans, 7), -1);
});
