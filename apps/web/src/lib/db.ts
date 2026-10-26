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
}

let database: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
	database ??= openDB<Schema>('open-book-reader', 1, {
		upgrade(database) {
			const books = database.createObjectStore('books', { keyPath: 'id' });
			books.createIndex('by-hash', 'sourceHash', { unique: true });
			database.createObjectStore('blobs', { keyPath: 'id' });
			database.createObjectStore('settings', { keyPath: 'id' });
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

export async function updateBook(book: Book) {
	await (await db()).put('books', book);
}

export async function deleteBook(book: Book) {
	const database = await db();
	const tx = database.transaction(['books', 'blobs'], 'readwrite');
	await tx.objectStore('books').delete(book.id);
	await tx.objectStore('blobs').delete(book.blobId);
	if (book.coverId) await tx.objectStore('blobs').delete(book.coverId);
	await tx.done;
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
