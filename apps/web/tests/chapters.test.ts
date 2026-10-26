import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterForPage, chaptersFromDocument, chaptersFromText, type ChapterDocument } from '../src/lib/chapters.ts';
import { paginateText } from '../src/lib/text-book.ts';

test('numbered headings land on the page that contains them', () => {
	const body = `${'word '.repeat(400)}\n\n`;
	const source = `Chapter 1\n\nA truth.\n\n${body}Chapter 2\n\nThe second start.\n\n${body}Chapter 3. A long title`;
	const pages = paginateText(source);
	const chapters = chaptersFromText(pages);
	assert.equal(chapters[0].title, 'Chapter 1');
	assert.equal(chapters[0].pageIndex, 0);
	const second = chapters.find((chapter) => chapter.title === 'Chapter 2');
	const third = chapters.find((chapter) => chapter.title.startsWith('Chapter 3'));
	assert.ok(second && second.pageIndex > 0);
	assert.ok(third && third.pageIndex >= second.pageIndex);
	assert.equal(pages[second.pageIndex].includes('Chapter 2'), true);
});

test('a following short line becomes part of the chapter title', () => {
	const prose = chaptersFromText([
		'CHAPTER I.\n\nIt is a truth universally acknowledged in this sentence.',
		'CHAPTER II.\n\nNext.'
	]);
	assert.deepEqual(
		prose.map((chapter) => chapter.title),
		['CHAPTER I', 'CHAPTER II']
	);
	const titled = chaptersFromText(['CHAPTER I.\nOf Pride\n\nIt is a truth.', 'CHAPTER II.\nOf Manners\n\nMore.']);
	assert.deepEqual(
		titled.map((chapter) => chapter.title),
		['CHAPTER I. Of Pride', 'CHAPTER II. Of Manners']
	);
});

test('a contents page of dot leaders is not a list of chapters', () => {
	const contents = ['Chapter 1 .... 3', 'Chapter 2 .... 40', 'Chapter 3 .... 80', 'Chapter 4 .... 120'].join('\n');
	const chapters = chaptersFromText([
		contents,
		'Preface\n\nA note.',
		'Chapter 1\n\nThe story starts.',
		'Chapter 2\n\nIt continues.'
	]);
	assert.deepEqual(
		chapters.map((chapter) => chapter.title),
		['Start', 'Preface', 'Chapter 1', 'Chapter 2']
	);
	assert.deepEqual(
		chapters.map((chapter) => chapter.pageIndex),
		[0, 1, 2, 3]
	);
});

test('the same running header is one chapter', () => {
	const chapters = chaptersFromText(['Chapter 1\n\nOnce.', 'Chapter 1\n\nStill the first.', 'Chapter 2\n\nNext.']);
	assert.deepEqual(
		chapters.map((chapter) => chapter.title),
		['Chapter 1', 'Chapter 2']
	);
});

test('a sentence that mentions a chapter is not a break', () => {
	const chapters = chaptersFromText([
		'See Chapter 1 for the account of the evening, which runs for many more words than a heading.',
		'Chapter 2\n\nNow it begins.'
	]);
	assert.equal(chapters[0].title, 'Start');
	assert.equal(chapters[1].title, 'Chapter 2');
	assert.equal(chapters[1].pageIndex, 1);
});

test('roman numerals and capitals are used only when there is no chapter label', () => {
	const romans = chaptersFromText(['I\n\nOpening', 'more prose', 'II\n\nLater']);
	assert.deepEqual(
		romans.map((chapter) => chapter.title),
		['Chapter I. Opening', 'Chapter II. Later']
	);
	const caps = chaptersFromText(['THE OPENING\n\nProse here.', 'A later page of prose.', 'THE CLOSE\n\nDone.']);
	assert.deepEqual(
		caps.map((chapter) => chapter.title),
		['THE OPENING', 'THE CLOSE']
	);
	const labeled = chaptersFromText(['THE OPENING\n\nChapter 1\n\nProse.', 'Chapter 2\n\nMore.']);
	assert.deepEqual(
		labeled.map((chapter) => chapter.title),
		['Chapter 1', 'Chapter 2']
	);
});

test('chapterForPage keeps the chapter that has already started', () => {
	const chapters = [
		{ title: 'Start', pageIndex: 0 },
		{ title: 'Chapter 2', pageIndex: 4 }
	];
	assert.equal(chapterForPage(chapters, 0), 0);
	assert.equal(chapterForPage(chapters, 3), 0);
	assert.equal(chapterForPage(chapters, 4), 1);
	assert.equal(chapterForPage(chapters, 9), 1);
});

test('an outline wrapper is opened and a real outline is not scanned as text', async () => {
	let scanned = false;
	const document: ChapterDocument = {
		numPages: 3,
		async getOutline() {
			return [
				{
					title: 'Volume',
					dest: null,
					items: [
						{ title: 'Opening', dest: 'first', items: [] },
						{ title: 'Later', dest: 'third', items: [{ title: 'Skipped child', dest: 'third', items: [] }] }
					]
				}
			];
		},
		async getDestination(name) {
			return [name];
		},
		async getPageIndex(ref) {
			return ref === 'third' ? 2 : 0;
		},
		async getPage() {
			scanned = true;
			return { async getTextContent() { return { items: [] }; } };
		}
	};
	const chapters = await chaptersFromDocument(document);
	assert.equal(scanned, false);
	assert.deepEqual(
		chapters.map((chapter) => [chapter.title, chapter.pageIndex]),
		[
			['Opening', 0],
			['Later', 2]
		]
	);
});

test('a PDF with no outline uses the text layer', async () => {
	const document: ChapterDocument = {
		numPages: 2,
		async getOutline() {
			return [];
		},
		async getDestination() {
			return null;
		},
		async getPageIndex() {
			return 0;
		},
		async getPage(number) {
			const text = number === 1 ? 'Chapter 1' : 'Chapter 2';
			return {
				async getTextContent() {
					return {
						items: [
							{ str: text, transform: [1, 0, 0, 1, 72, 720], width: 80 },
							{ str: 'The prose of this page.', transform: [1, 0, 0, 1, 72, 680], width: 140 }
						]
					};
				}
			};
		}
	};
	const chapters = await chaptersFromDocument(document);
	assert.deepEqual(
		chapters.map((chapter) => chapter.title),
		['Chapter 1', 'Chapter 2']
	);
	assert.equal(chapters[1].pageIndex, 1);
});
