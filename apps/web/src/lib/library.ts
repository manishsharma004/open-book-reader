import { chaptersFromDocument, chaptersFromText, type Chapter } from '#lib/chapters.js';
import { findBookByHash, saveBook, sha256, storeCover, type Book } from '#lib/db.js';
import { openEpub, spineIndex, type EpubToc } from '#lib/epub.js';
import { randomId } from '#lib/hash.js';
import { coverBlob, openPdf } from '#lib/pdf.js';
import { paginateText } from '#lib/text-book.js';

async function keepCover(existing: Book, cover: Blob | null): Promise<Book> {
	if (!cover || existing.coverId) return existing;
	const next = { ...existing, coverId: randomId() };
	await storeCover(next, cover);
	return next;
}

export async function savePdfFile(file: File, password?: string, cover: Blob | null = null): Promise<{ book: Book; existing: boolean }> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing) return { book: await keepCover(existing, cover), existing: true };
	const pdf = await openPdf(await file.arrayBuffer(), password);
	const first = await pdf.getPage(1);
	const pageCover = cover ?? (await coverBlob(first));
	const meta = await pdf.getMetadata().catch(() => null);
	const info = meta?.info as { Title?: string } | undefined;
	const chapters = await chaptersFromDocument(pdf).catch(() => []);
	const book: Book = {
		id: randomId(),
		title: info?.Title?.trim() || file.name.replace(/\.pdf$/i, ''),
		sourceHash: hash,
		pageCount: pdf.numPages,
		addedAt: Date.now(),
		blobId: randomId(),
		coverId: randomId(),
		kind: 'pdf',
		chapters
	};
	await saveBook(book, file, pageCover);
	await pdf.cleanup();
	return { book, existing: false };
}

export async function saveTextFile(file: File, title: string, cover: Blob | null = null): Promise<{ book: Book; existing: boolean }> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing) return { book: await keepCover(existing, cover), existing: true };
	const pages = paginateText(await file.text());
	const book: Book = {
		id: randomId(),
		title: title.trim() || file.name.replace(/\.txt$/i, ''),
		sourceHash: hash,
		pageCount: pages.length,
		addedAt: Date.now(),
		blobId: randomId(),
		coverId: cover ? randomId() : null,
		kind: 'text',
		chapters: chaptersFromText(pages)
	};
	await saveBook(book, file, cover);
	return { book, existing: false };
}

function tocChapters(toc: EpubToc[], spine: { href: string }[]): Chapter[] {
	return toc.flatMap((item) => {
		const pageIndex = spineIndex(spine, item.href);
		if (pageIndex < 0) return [];
		const chapter: Chapter = { title: item.title, pageIndex };
		const children = tocChapters(item.children, spine);
		if (children.length) chapter.children = children;
		return [chapter];
	});
}

export async function saveEpubFile(file: File, title = '', cover: Blob | null = null): Promise<{ book: Book; existing: boolean }> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing) return { book: await keepCover(existing, cover), existing: true };
	const parsed = openEpub(await file.arrayBuffer());
	const embedded = parsed.cover ? new Blob([parsed.cover], { type: parsed.coverType || 'image/jpeg' }) : null;
	const chosen = cover ?? embedded;
	const book: Book = {
		id: randomId(),
		title: title.trim() || parsed.title || file.name.replace(/\.epub$/i, ''),
		sourceHash: hash,
		pageCount: parsed.spine.length,
		addedAt: Date.now(),
		blobId: randomId(),
		coverId: chosen ? randomId() : null,
		kind: 'epub',
		chapters: tocChapters(parsed.toc, parsed.spine)
	};
	await saveBook(book, file, chosen);
	return { book, existing: false };
}

/** Keep the same library card, with the EPUB in place of a plain-text transcription. */
export async function replaceWithEpub(book: Book, file: File, cover: Blob | null): Promise<Book> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing && existing.id !== book.id) return existing;
	const parsed = openEpub(await file.arrayBuffer());
	const embedded = parsed.cover ? new Blob([parsed.cover], { type: parsed.coverType || 'image/jpeg' }) : null;
	const chosen = cover ?? embedded;
	const next: Book = {
		...book,
		title: book.title.trim() || parsed.title || book.title,
		sourceHash: hash,
		pageCount: Math.max(parsed.spine.length, 1),
		kind: 'epub',
		chapters: tocChapters(parsed.toc, parsed.spine),
		coverId: chosen ? (book.coverId ?? randomId()) : book.coverId
	};
	await saveBook(next, file, chosen);
	return next;
}
