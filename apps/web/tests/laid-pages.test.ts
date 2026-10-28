import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterCount, extendsLaidPages, pageTextStamp, publishChapters, publishPageCount } from '../src/lib/laid-pages.js';

test('a longer layout keeps the pages already measured', () => {
	assert.equal(extendsLaidPages(['Cover', 'Chapter I'], ['Cover', 'Chapter I', 'Chapter II']), true);
	assert.equal(extendsLaidPages(['Cover', 'Chapter I'], ['Cover', 'Chapter I']), true);
	assert.equal(extendsLaidPages(null, ['Cover']), false);
	assert.equal(extendsLaidPages(['Cover', 'Chapter I'], ['Title page']), false);
	assert.equal(extendsLaidPages(['Cover', 'Chapter I'], ['Cover']), false);
});

test('a partial chapter list never replaces a longer one', () => {
	const full = [
		{ title: 'Chapter I', pageIndex: 1, children: [{ title: 'I.I', pageIndex: 2 }] },
		{ title: 'Chapter II', pageIndex: 8 }
	];
	const first = [{ title: 'Chapter I', pageIndex: 1 }];
	assert.equal(chapterCount(full), 3);
	assert.equal(publishChapters(full, first, false), full);
	assert.deepEqual(publishChapters(first, full, false), full);
	assert.deepEqual(publishChapters(full, first, true), first);
	assert.deepEqual(publishChapters(full, [], false), full);
});

test('an empty laid page is not the same page after its text arrives', () => {
	assert.equal(pageTextStamp(''), pageTextStamp(''));
	assert.notEqual(pageTextStamp(''), pageTextStamp('THE ENCHANTED TYPES\n\nOne time a knook became tired'));
	assert.equal(pageTextStamp('Listen, the poor milliner\'s business will be ruined'), pageTextStamp('Listen, the poor milliner\'s business will be ruined'));
});

test('page count stays at the furthest page until the pass finishes', () => {
	assert.equal(publishPageCount(12, 4, false), 12);
	assert.equal(publishPageCount(4, 9, false), 9);
	assert.equal(publishPageCount(12, 4, true), 4);
	assert.equal(publishPageCount(0, 0, true), 1);
});
