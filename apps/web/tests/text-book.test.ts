import assert from 'node:assert/strict';
import test from 'node:test';
import { splitSpeechWords } from '../src/lib/speech-clips.ts';
import { paginateText, wordsForPage } from '../src/lib/text-book.ts';

test('plain text breaks into paragraph pages near 1800 characters', () => {
	const paragraph = 'word '.repeat(200).trim();
	const pages = paginateText(`${paragraph}\n\n${paragraph}\n\n${paragraph}`);
	assert.ok(pages.length >= 2);
	for (const page of pages) assert.ok(page.length <= 1800 + 20);
	assert.equal(pages.join('\n\n').includes('word'), true);
});

test('a text page keeps the printed punctuation on the spoken word', () => {
	const page = wordsForPage('Hello, world.');
	assert.deepEqual(
		page.words.map((word) => word.text),
		['Hello,', 'world.']
	);
});

test('a short title is a heading and a quoted question stays prose', () => {
	const title = wordsForPage('The Enchanted Types');
	assert.ok(title.words.length > 0);
	assert.ok(title.words.every((word) => word.role === 'heading'));
	const question = wordsForPage('“What is it? Oh! what is it?”');
	assert.ok(question.words.length >= 5);
	assert.ok(question.words.every((word) => word.role === 'body'));
});

test('reflowed lines past the page box are still spoken', () => {
	const lines = Array.from({ length: 36 }, (_, index) => `Line ${index} stays in the story and is not a running header.`);
	lines.push('Listen, the poor milliner\'s business will be ruined if the birds stay free.');
	const page = wordsForPage(lines.join('\n\n'));
	assert.equal(page.words.some((word) => word.role === 'header'), false);
	assert.ok(page.words.some((word) => word.y < 0));
	const clips = splitSpeechWords(
		page.words.map((word) => word.text),
		24,
		page.words.map((word) => word.role)
	);
	const covered = new Set<number>();
	for (const clip of clips) {
		for (let index = clip.wordStart; index < clip.wordEnd; index += 1) covered.add(index);
	}
	assert.equal(covered.size, page.words.length);
	const spoken = clips
		.map((clip) => page.words.slice(clip.wordStart, clip.wordEnd).map((word) => word.text).join(' '))
		.join(' ');
	assert.match(spoken, /poor milliner's business will be ruined/);
	assert.match(spoken, /Line 35 stays/);
});
