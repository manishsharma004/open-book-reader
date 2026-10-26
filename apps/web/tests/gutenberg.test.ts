import assert from 'node:assert/strict';
import test from 'node:test';
import { gutenbergEbookId } from '../src/lib/gutenberg.ts';

test('a Gutenberg transcription names its ebook number', () => {
	assert.equal(gutenbergEbookId('*** START OF THE PROJECT GUTENBERG EBOOK 1342 ***\n[Illustration]'), '1342');
	assert.equal(gutenbergEbookId('The Project Gutenberg eBook of Frankenstein\n\n[eBook #84]'), '84');
	assert.equal(gutenbergEbookId('*** START OF THE PROJECT GUTENBERG EBOOK PRIDE AND PREJUDICE ***'), null);
});
