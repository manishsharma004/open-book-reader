import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wordDurations } from '../src/lib/highlight.ts';
import { joinReadingRuns, segmentSpokenWords } from '../src/lib/spoken-text.ts';
import { splitSpeechWords } from '../src/lib/speech-clips.ts';

test('a comma and a full stop stay on the words around them', () => {
	assert.deepEqual(segmentSpokenWords('Hello, world.'), ['Hello,', 'world.']);
	const [comma, plain] = wordDurations(['Hello,', 'Hello'], 1);
	const [stop, bare] = wordDurations(['world.', 'world'], 1);
	assert.ok(comma > plain);
	assert.ok(stop > bare);
});

test('quotes stay with the words they mark', () => {
	assert.deepEqual(segmentSpokenWords('"Hello," she said.'), ['"Hello,"', 'she', 'said.']);
	assert.deepEqual(segmentSpokenWords('She said "hello."'), ['She', 'said', '"hello."']);
});

test('a question mark and an exclamation stay on the last word', () => {
	assert.deepEqual(segmentSpokenWords('Is it ready? Yes!'), ['Is', 'it', 'ready?', 'Yes!']);
});

test('a double-f ligature is spoken as the letters ff', () => {
	assert.deepEqual(segmentSpokenWords('The di\uFB00erent e\uFB03cient effects.'), ['The', 'different', 'efficient', 'effects.']);
	assert.equal(
		joinReadingRuns([
			{ text: 'not for', block: false },
			{ text: 'gotten', block: false }
		]),
		'not forgotten'
	);
	assert.equal(
		joinReadingRuns([
			{ text: 'Darc', block: false },
			{ text: 'y stood.', block: false }
		]),
		'Darcy stood.'
	);
});

test('a full stop in the transcript is where a clip may end', () => {
	const words = segmentSpokenWords('Mara waited. The station clock had stopped.');
	const spans = splitSpeechWords(words, 24);
	assert.equal(spans.length, 1);
	assert.equal(words.at(-1), 'stopped.');
});
