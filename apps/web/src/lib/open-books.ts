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

export async function listProviders(): Promise<OpenProvider[]> {
	const response = await fetch('/v1/open-books/providers');
	if (!response.ok) throw new Error(await readError(response));
	const body = (await response.json()) as { providers: OpenProvider[] };
	return body.providers;
}

export async function searchOpenBooks(provider: string, q: string, language: string, page: string | null) {
	const params = new URLSearchParams();
	if (q) params.set('q', q);
	if (language) params.set('language', language);
	if (page) params.set('page', page);
	const response = await fetch(`/v1/open-books/${encodeURIComponent(provider)}?${params}`);
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
	const response = await fetch(`/v1/open-books/${encodeURIComponent(provider)}/${bookPath(id)}`, {
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
	return `/v1/open-books/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/cover`;
}

/** The picture on the catalog card. A missing cover does not block saving the book. */
export async function downloadCover(provider: string, id: string): Promise<Blob | null> {
	try {
		const response = await fetch(coverPath(provider, id));
		if (!response.ok) return null;
		const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
		if (!type.startsWith('image/')) return null;
		const blob = await response.blob();
		return blob.size ? blob : null;
	} catch {
		return null;
	}
}
