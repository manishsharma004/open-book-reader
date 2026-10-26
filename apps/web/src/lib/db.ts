import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Chapter } from '#lib/chapters.js';
import { sha256 as hashBlob } from '#lib/hash.js';

export type Book = {
	id: string;
	title: string;
	sourceHash: string;
	pageCount: number;
	addedAt: number;
	blobId: string;
	coverId: string | null;
	kind?: 'pdf' | 'text' | 'epub';
	chapters?: Chapter[];
};

type BlobRecord = {
	id: string;
	kind: 'source' | 'cover' | 'sample';
	blob: Blob;
};

export type SpeechTiming = { start: number; end: number };

export type SpeechRecord = {
	id: string;
	bookId: string;
	blob: Blob;
	timings: SpeechTiming[] | null;
};

type SettingsRecord = {
	id: 'app';
	[key: string]: unknown;
};

interface Schema extends DBSchema {
	books: {
		key: string;
		value: Book;
		indexes: { 'by-hash': string };
	};
	blobs: {
		key: string;
		value: BlobRecord;
	};
	settings: {
		key: string;
		value: SettingsRecord;
	};
	speech: {
		key: string;
		value: SpeechRecord;
		indexes: { 'by-book': string };
	};
}

let database: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
	database ??= openDB<Schema>('open-book-reader', 2, {
		upgrade(database, oldVersion) {
			if (oldVersion < 1) {
				const books = database.createObjectStore('books', { keyPath: 'id' });
				books.createIndex('by-hash', 'sourceHash', { unique: true });
				database.createObjectStore('blobs', { keyPath: 'id' });
				database.createObjectStore('settings', { keyPath: 'id' });
			}
			if (oldVersion < 2) {
				const speech = database.createObjectStore('speech', { keyPath: 'id' });
				speech.createIndex('by-book', 'bookId');
			}
		}
	});
	return database;
}

export async function listBooks(): Promise<Book[]> {
	const books = await (await db()).getAll('books');
	return books.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBook(id: string): Promise<Book | undefined> {
	return (await db()).get('books', id);
}

export async function findBookByHash(hash: string): Promise<Book | undefined> {
	return (await db()).getFromIndex('books', 'by-hash', hash);
}

export async function getBlob(id: string): Promise<Blob | undefined> {
	return (await (await db()).get('blobs', id))?.blob;
}

export async function saveBook(book: Book, source: Blob, cover: Blob | null) {
	const database = await db();
	const tx = database.transaction(['books', 'blobs'], 'readwrite');
	await tx.objectStore('blobs').put({ id: book.blobId, kind: 'source', blob: source });
	if (cover && book.coverId) {
		await tx.objectStore('blobs').put({ id: book.coverId, kind: 'cover', blob: cover });
	}
	await tx.objectStore('books').put(book);
	await tx.done;
}

/** Keep a cover on a book that was saved without one. */
export async function storeCover(book: Book, cover: Blob): Promise<void> {
	if (!book.coverId) throw new Error('This book has no cover id.');
	const database = await db();
	const tx = database.transaction(['books', 'blobs'], 'readwrite');
	await tx.objectStore('blobs').put({ id: book.coverId, kind: 'cover', blob: cover });
	await tx.objectStore('books').put(book);
	await tx.done;
}

export async function updateBook(book: Book) {
	await (await db()).put('books', book);
}

export async function deleteBook(book: Book) {
	const database = await db();
	const tx = database.transaction(['books', 'blobs', 'speech'], 'readwrite');
	await tx.objectStore('books').delete(book.id);
	await tx.objectStore('blobs').delete(book.blobId);
	if (book.coverId) await tx.objectStore('blobs').delete(book.coverId);
	const cached = await tx.objectStore('speech').index('by-book').getAllKeys(book.id);
	for (const key of cached) await tx.objectStore('speech').delete(key);
	await tx.done;
}

export async function getSpeech(id: string): Promise<SpeechRecord | undefined> {
	return (await db()).get('speech', id);
}

export async function putSpeech(record: SpeechRecord) {
	await (await db()).put('speech', record);
}

/** Drop stored speech for one book. The next play asks the voice again. */
export async function clearBookSpeech(bookId: string): Promise<number> {
	const database = await db();
	const tx = database.transaction('speech', 'readwrite');
	const keys = await tx.store.index('by-book').getAllKeys(bookId);
	for (const key of keys) await tx.store.delete(key);
	await tx.done;
	return keys.length;
}

export async function readAppRecord(): Promise<SettingsRecord | undefined> {
	return (await db()).get('settings', 'app');
}

export async function writeAppRecord(value: SettingsRecord) {
	await (await db()).put('settings', value);
}

export async function putBlob(id: string, kind: BlobRecord['kind'], blob: Blob) {
	await (await db()).put('blobs', { id, kind, blob });
}

export async function deleteBlob(id: string) {
	await (await db()).delete('blobs', id);
}

export async function sha256(file: Blob): Promise<string> {
	return hashBlob(file);
}
