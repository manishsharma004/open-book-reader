import { findBookByHash, saveBook, sha256, type Book } from '#lib/db.js';
import { randomId } from '#lib/hash.js';
import { coverBlob, openPdf } from '#lib/pdf.js';
import { paginateText } from '#lib/text-book.js';

export async function savePdfFile(file: File, password?: string): Promise<{ book: Book; existing: boolean }> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing) return { book: existing, existing: true };
	const pdf = await openPdf(await file.arrayBuffer(), password);
	const first = await pdf.getPage(1);
	const cover = await coverBlob(first);
	const meta = await pdf.getMetadata().catch(() => null);
	const info = meta?.info as { Title?: string } | undefined;
	const book: Book = {
		id: randomId(),
		title: info?.Title?.trim() || file.name.replace(/\.pdf$/i, ''),
		sourceHash: hash,
		pageCount: pdf.numPages,
		addedAt: Date.now(),
		blobId: randomId(),
		coverId: randomId(),
		kind: 'pdf'
	};
	await saveBook(book, file, cover);
	await pdf.cleanup();
	return { book, existing: false };
}

export async function saveTextFile(file: File, title: string): Promise<{ book: Book; existing: boolean }> {
	const hash = await sha256(file);
	const existing = await findBookByHash(hash);
	if (existing) return { book: existing, existing: true };
	const pages = paginateText(await file.text());
	const book: Book = {
		id: randomId(),
		title: title.trim() || file.name.replace(/\.txt$/i, ''),
		sourceHash: hash,
		pageCount: pages.length,
		addedAt: Date.now(),
		blobId: randomId(),
		coverId: null,
		kind: 'text'
	};
	await saveBook(book, file, null);
	return { book, existing: false };
}
