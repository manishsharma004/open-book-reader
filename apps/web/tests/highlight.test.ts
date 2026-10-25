import assert from 'node:assert/strict';
import { test } from 'node:test';
import { elapsedBefore, indexAt, indexForTimings, timeForWord, wordDurations } from '../src/lib/highlight.ts';

test('the highlight stays on a word until its time is over', () => {
	const durations = wordDurations(['Mara', 'waited.'], 1);
	assert.equal(indexAt(durations, 0), 0);
	assert.equal(indexAt(durations, durations[0] - 1), 0);
	assert.equal(indexAt(durations, durations[0] + 1), 1);
});

test('a sentence-ending word lasts longer than the same letters', () => {
	const [plain, ended] = wordDurations(['waited', 'waited.'], 1);
	assert.ok(ended > plain);
});

test('a faster rate shortens every word', () => {
	const slow = wordDurations(['station'], 1)[0];
	const fast = wordDurations(['station'], 2)[0];
	assert.ok(fast < slow);
});

test('elapsed time before a word matches the earlier durations', () => {
	const durations = wordDurations(['Mara', 'waited', 'there'], 1);
	assert.equal(elapsedBefore(durations, 0), 0);
	assert.equal(elapsedBefore(durations, 2), durations[0] + durations[1]);
});

test('audio timings choose the word sounding at that second', () => {
	const timings = [
		{ wordIndex: 0, start: 0, end: 0.4 },
		{ wordIndex: 1, start: 0.4, end: 0.9 }
	];
	assert.equal(indexForTimings(timings, 0.1), 0);
	assert.equal(indexForTimings(timings, 0.5), 1);
	assert.equal(indexForTimings(timings, 0.95), 1);
});

test('seeking a later word is further into the clip', () => {
	const texts = ['Mara', 'waited', 'there'];
	assert.equal(timeForWord(texts, 0, 9, 1), 0);
	assert.ok(timeForWord(texts, 2, 9, 1) > timeForWord(texts, 1, 9, 1));
});
