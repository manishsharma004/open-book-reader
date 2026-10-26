import assert from 'node:assert/strict';
import test from 'node:test';
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
