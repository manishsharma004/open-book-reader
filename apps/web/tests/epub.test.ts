import assert from 'node:assert/strict';
import test from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { chaptersFromToc, openEpub, pageFrame, sectionDocument, spineIndex } from '../src/lib/epub.ts';

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));

function epubBytes() {
	const text = (value: string) => strToU8(value);
	return zipSync({
		'mimetype': text('application/epub+zip'),
		'META-INF/container.xml': text(`<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
		'OEBPS/content.opf': text(`<?xml version="1.0"?>
			<package xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="http://www.idpf.org/2007/opf" version="2.0">
			<metadata><dc:title>Pride and Prejudice</dc:title><meta name="cover" content="cover"/></metadata>
			<manifest>
			<item id="cover" href="mark.png" media-type="image/png"/>
			<item id="css" href="book.css" media-type="text/css"/>
			<item id="c1" href="title.xhtml" media-type="application/xhtml+xml"/>
			<item id="c2" href="chap.xhtml" media-type="application/xhtml+xml"/>
			<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
			</manifest>
			<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2" linear="yes"/><itemref idref="ncx" linear="no"/></spine>
			</package>`),
		'OEBPS/book.css': text('h1 { font-style: italic; text-align: center; } .blk { page-break-before: always; }'),
		'OEBPS/mark.png': png,
		'OEBPS/title.xhtml': text(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="book.css"/></head><body>
			<p>*** START OF THE PROJECT GUTENBERG EBOOK 1342 ***</p>
			<div class="figcenter"><img alt="[Colophon: GEORGE ALLEN PUBLISHER]" src="mark.png"/></div>
			<div class="blk"><h1 id="title"><img alt="" src="mark.png"/> PRIDE and PREJUDICE</h1><p>by Jane Austen</p></div>
			</body></html>`),
		'OEBPS/chap.xhtml': text('<html><body><h2 id="c2">Chapter I.</h2><p>It is a truth universally acknowledged.</p></body></html>'),
		'OEBPS/toc.ncx': text(`<ncx><navMap>
			<navPoint id="n1"><navLabel><text>PRIDE. and PREJUDICE</text></navLabel><content src="title.xhtml#title"/>
			<navPoint id="n2"><navLabel><text>Chapter I.</text></navLabel><content src="chap.xhtml#c2"/></navPoint>
			</navPoint></navMap></ncx>`)
	});
}

test('an EPUB keeps its title, contents, and picture bytes', () => {
	const book = openEpub(epubBytes());
	assert.equal(book.title, 'Pride and Prejudice');
	assert.deepEqual(book.spine.map((item) => item.href), ['OEBPS/title.xhtml', 'OEBPS/chap.xhtml']);
	assert.equal(book.toc[0].title, 'PRIDE. and PREJUDICE');
	assert.equal(book.toc[0].children[0].title, 'Chapter I.');
	assert.equal(book.cover?.length, png.length);
	assert.equal(spineIndex(book.spine, 'chap.xhtml#c2'), 1);
});

test('a section is the book HTML with its stylesheet and pictures, not the picture description', () => {
	const book = openEpub(epubBytes());
	const frame = pageFrame(640, 800);
	const html = sectionDocument(book, book.spine[0].href, 640, 800);
	assert.equal(frame.innerWidth, 564);
	assert.equal(frame.innerHeight, 720);
	assert.equal(pageFrame(640, 800, true).frameWidth, 1280);
	assert.match(html, new RegExp(`column-width:\\s*${frame.innerWidth}px`));
	assert.match(html, new RegExp(`max-height:\\s*${frame.innerHeight}px`));
	assert.equal(html.includes('85vh'), false);
	assert.match(html, /font-style:\s*italic/);
	assert.match(html, /PRIDE and PREJUDICE/);
	assert.match(html, /<img\b[^>]*src="data:image\/png;base64,/);
	assert.equal(html.includes('src="mark.png"'), false);
	assert.match(html, /\[Colophon: GEORGE ALLEN PUBLISHER\]/);
	const starts = new Map([['OEBPS/title.xhtml', 0], ['OEBPS/chap.xhtml', 2]]);
	const columns = new Map([
		['OEBPS/title.xhtml', new Map([['title', 1]])],
		['OEBPS/chap.xhtml', new Map([['c2', 0]])]
	]);
	const chapters = chaptersFromToc(book.toc, book.spine, starts, columns);
	assert.equal(chapters[0].pageIndex, 1);
	assert.equal(chapters[0].children?.[0].pageIndex, 2);
});
