import assert from 'node:assert/strict';
import test from 'node:test';
import { joinApi, normalizeBase } from '../src/lib/api-url.ts';
import {
	gutenbergMirrorUrl,
	gutenbergSearchUrl,
	parseGutenbergOpds,
	pickGutenbergRepo,
	resetGutenbergBrowser,
	browserCover
} from '../src/lib/gutenberg-browser.ts';

const FEED = `<?xml version="1.0"?>
<feed>
<title>Books</title>
<link rel="self" href="/ebooks/search.opds/?query=pride"/>
<link rel="next" title="Next Page" href="/ebooks/search.opds/?query=pride+l.en&amp;start_index=26"/>
<entry>
<id>https://www.gutenberg.org/ebooks/1342.opds</id>
<title>Pride &amp; Prejudice</title>
<content type="text">Jane Austen</content>
<link rel="http://opds-spec.org/image/thumbnail" href="data:image/png;base64,aaaa"/>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/84.opds</id>
<title>Frankenstein</title>
<author><name>Shelley, Mary</name></author>
<dcterms:language>en</dcterms:language>
<dcterms:issued>1993-01-01</dcterms:issued>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/999.opds</id>
<title>A Dictionary</title>
<content type="text">79054 downloads</content>
</entry>
</feed>`;

test('the Pages base is a path prefix and the local app stays at the root', () => {
	assert.equal(normalizeBase(''), '');
	assert.equal(normalizeBase('/'), '');
	assert.equal(normalizeBase('/open-book-reader/'), '/open-book-reader');
	assert.equal(joinApi('/open-book-reader/', '/v1/health'), '/open-book-reader/v1/health');
	assert.equal(joinApi('', '/v1/open-books/providers'), '/v1/open-books/providers');
});

test('Gutenberg search stays on the public OPDS feed', () => {
	assert.equal(
		gutenbergSearchUrl('pride', 'en', null),
		'https://www.gutenberg.org/ebooks/search.opds/?query=pride%20l.en'
	);
	assert.equal(
		gutenbergSearchUrl('', 'en', '26'),
		'https://www.gutenberg.org/ebooks/search.opds/?query=l.en&start_index=26'
	);
});

test('an OPDS page becomes catalog cards and keeps the thumbnail', () => {
	resetGutenbergBrowser();
	const page = parseGutenbergOpds(FEED, 'en');
	assert.equal(page.page, '26');
	assert.equal(page.books.length, 3);
	assert.equal(page.books[0].id, '1342');
	assert.equal(page.books[0].title, 'Pride & Prejudice');
	assert.deepEqual(page.books[0].authors, ['Jane Austen']);
	assert.equal(page.books[0].formats.find((format) => format.mediaType === 'application/epub+zip')?.addable, false);
	assert.equal(page.books[0].formats.find((format) => format.mediaType === 'text/plain')?.addable, true);
	assert.equal(browserCover('1342'), 'data:image/png;base64,aaaa');
	assert.equal(page.books[1].year, '1993');
	assert.deepEqual(page.books[1].authors, ['Shelley, Mary']);
	assert.deepEqual(page.books[2].authors, []);
});

test('a Gutenberg id matches the repo that ends with that id', () => {
	const names = ['GITenberg/Honoring-Parents_13424', 'GITenberg/Pride-and-Prejudice_1342'];
	assert.equal(pickGutenbergRepo(names, '1342'), 'GITenberg/Pride-and-Prejudice_1342');
	assert.equal(pickGutenbergRepo(names, '13424'), 'GITenberg/Honoring-Parents_13424');
	assert.equal(pickGutenbergRepo(['not a repo'], '1342'), null);
	assert.equal(
		gutenbergMirrorUrl('GITenberg/Pride-and-Prejudice_1342', '1342-0.txt'),
		'https://cdn.jsdelivr.net/gh/GITenberg/Pride-and-Prejudice_1342@master/1342-0.txt'
	);
});
