import { apiUrl } from '#lib/api-url.js';
import { appServer } from '#lib/app-server.js';
import { openBooksBase, openBooksUrl } from '#lib/open-books-api.js';
import { loadSettings, settingsState } from '#lib/settings-store.svelte.js';

export type OpenProvider = {
	id: string;
	name: string;
	search: boolean;
	languages: string[];
	note: string;
};

export type OpenFormat = {
	mediaType: string;
	label: string;
	addable: boolean;
};

export type OpenBook = {
	provider: string;
	id: string;
	title: string;
	authors: string[];
	languages: string[];
	year: string | null;
	license: 'public-domain' | 'open-license';
	licenseNote: string;
	formats: OpenFormat[];
};

export type CatalogKind = 'server' | 'remote' | 'off';

export const OPEN_BOOKS_OFF =
	'Catalogs need an Open books API address. Set one in Settings, or add a PDF or EPUB you already have.';

/** Empty string means this site. Null means catalogs are off. */
let remoteBase: string | null = null;

function bookPath(id: string) {
	return id.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function readError(response: Response) {
	const text = (await response.text()).trim();
	if (!text) return `The catalog returned ${response.status}.`;
	try {
		const body = JSON.parse(text) as { detail?: string };
		if (typeof body.detail === 'string' && body.detail) return body.detail;
	} catch {
		// The proxy sometimes returns plain text.
	}
	return text.slice(0, 300);
}

async function resolveRoot(): Promise<string | null> {
	await loadSettings();
	const configured = openBooksBase(settingsState.current?.openBooksUrl ?? '');
	if (configured) {
		remoteBase = configured;
		return configured;
	}
	if ((await appServer()).present) {
		remoteBase = '';
		return '';
	}
	remoteBase = null;
	return null;
}

function urlFor(path: string, root: string) {
	return root ? openBooksUrl(root, path) : apiUrl(path);
}

export function catalogKind(): CatalogKind {
	if (remoteBase === null) return 'off';
	return remoteBase ? 'remote' : 'server';
}

export async function listProviders(): Promise<OpenProvider[]> {
	const root = await resolveRoot();
	if (root === null) return [];
	const response = await fetch(urlFor('/v1/open-books/providers', root));
	if (!response.ok) throw new Error(await readError(response));
	const body = (await response.json()) as { providers: OpenProvider[] };
	return body.providers;
}

export async function searchOpenBooks(provider: string, q: string, language: string, page: string | null) {
	const root = await resolveRoot();
	if (root === null) throw new Error(OPEN_BOOKS_OFF);
	const params = new URLSearchParams();
	if (q) params.set('q', q);
	if (language) params.set('language', language);
	if (page) params.set('page', page);
	const response = await fetch(urlFor(`/v1/open-books/${encodeURIComponent(provider)}?${params}`, root));
	if (!response.ok) throw new Error(await readError(response));
	return (await response.json()) as { books: OpenBook[]; page: string | null };
}

function filenameOf(header: string | null, fallback: string) {
	const match = header?.match(/filename\*=UTF-8''([^;]+)/i);
	if (!match) return fallback;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return fallback;
	}
}

export async function downloadOpenBook(provider: string, id: string, mediaType: string, title: string) {
	const root = await resolveRoot();
	if (root === null) throw new Error(OPEN_BOOKS_OFF);
	const response = await fetch(urlFor(`/v1/open-books/${encodeURIComponent(provider)}/${bookPath(id)}`, root), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ mediaType })
	});
	if (!response.ok) throw new Error(await readError(response));
	const bytes = await response.blob();
	const suffix = mediaType === 'application/pdf' ? 'pdf' : mediaType === 'application/epub+zip' ? 'epub' : 'txt';
	const name = filenameOf(response.headers.get('content-disposition'), `${title}.${suffix}`);
	return new File([bytes], name, { type: mediaType });
}

export function coverPath(provider: string, id: string) {
	if (remoteBase === null) return '';
	const path = `/v1/open-books/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/cover`;
	return remoteBase ? openBooksUrl(remoteBase, path) : apiUrl(path);
}

/** The picture on the catalog card. A missing cover does not block saving the book. */
export async function downloadCover(provider: string, id: string): Promise<Blob | null> {
	try {
		const path = coverPath(provider, id);
		if (!path) return null;
		const response = await fetch(path);
		if (!response.ok) return null;
		const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (!type.startsWith('image/')) return null;
		const blob = await response.blob();
		return blob.size ? blob : null;
	} catch {
		return null;
	}
}
