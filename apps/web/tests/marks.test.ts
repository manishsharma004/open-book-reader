import assert from 'node:assert/strict';
import test from 'node:test';
import type { PageBookmark, SavedHighlight } from '../src/lib/db.ts';
import {
	bookmarkForPage,
	defaultBookmarkLabel,
	highlightExcerpt,
	highlightedWords,
	noteHighlight,
	removeBookmark,
	removeHighlight,
	renameBookmark,
	upsertBookmark,
	upsertHighlight
} from '../src/lib/marks.ts';

test('a page bookmark uses the chapter and page, and one page keeps one label', () => {
	assert.equal(defaultBookmarkLabel('The Enchanted Types', 29), 'The Enchanted Types, Page 29');
	assert.equal(defaultBookmarkLabel('  ', 4), 'Page 4');
	const first: PageBookmark = { id: 'a', pageIndex: 28, label: 'Cellar', createdAt: 1 };
	const saved = upsertBookmark([], first);
	const renamed = upsertBookmark(saved, { id: 'b', pageIndex: 28, label: 'Mice in the cellar', createdAt: 2 });
	assert.equal(renamed.length, 1);
	assert.equal(renamed[0]?.id, 'a');
	assert.equal(renamed[0]?.label, 'Mice in the cellar');
	assert.equal(bookmarkForPage(renamed, 28)?.label, 'Mice in the cellar');
	assert.deepEqual(removeBookmark(renamed, 'a'), []);
	assert.equal(renameBookmark(saved, 'a', '  Hats  ')[0]?.label, 'Hats');
});

test('a highlighted passage is saved once and can be noted or removed', () => {
	const words = ['he', 'came', 'upon', 'a', 'nearby', 'cellar'];
	assert.equal(highlightExcerpt(words, 1, 5), 'came upon a nearby');
	const mark: SavedHighlight = {
		id: 'h',
		pageIndex: 28,
		wordStart: 1,
		wordEnd: 5,
		text: 'came upon a nearby',
		note: '',
		createdAt: 1
	};
	const again: SavedHighlight = { ...mark, id: 'other', text: 'came upon a nearby', note: 'lost' };
	const saved = upsertHighlight(upsertHighlight([], mark), again);
	assert.equal(saved.length, 1);
	assert.equal(saved[0]?.id, 'h');
	assert.equal(saved[0]?.note, '');
	const noted = noteHighlight(saved, 'h', '  the mice  ');
	assert.equal(noted[0]?.note, 'the mice');
	const flags = highlightedWords(noted, 28);
	assert.equal(flags[1], true);
	assert.equal(flags[4], true);
	assert.equal(flags[5], undefined);
	assert.deepEqual(removeHighlight(noted, 'h'), []);
});
