export const GUTENBERG_BROWSER_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'fi', 'nl', 'zh'];

type BrowserFormat = { mediaType: string; label: string; addable: boolean };

type BrowserBook = {
	provider: 'gutenberg';
	id: string;
	title: string;
	authors: string[];
	languages: string[];
	year: string | null;
	license: 'public-domain';
	licenseNote: string;
	formats: BrowserFormat[];
};

export const GUTENBERG_BROWSER_FORMATS: BrowserFormat[] = [
	{ mediaType: 'text/plain', label: 'Text', addable: true },
	{ mediaType: 'application/pdf', label: 'PDF', addable: true },
	{ mediaType: 'application/epub+zip', label: 'EPUB', addable: false }
];

export const EPUB_NEEDS_SERVER =
	'EPUB from Project Gutenberg needs the Open Book Reader server. This browser copy can add the text or the PDF.';

const repos = new Map<string, string>();
const covers = new Map<string, string>();

export function resetGutenbergBrowser() {
	repos.clear();
	covers.clear();
}

export function browserCover(id: string) {
	return covers.get(id) ?? '';
}

export function gutenbergSearchUrl(q: string, language: string, page: string | null) {
	const lang = GUTENBERG_BROWSER_LANGUAGES.includes(language) ? language : 'en';
	const query = q.trim() ? `${q.trim()} l.${lang}` : `l.${lang}`;
	let url = `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(query)}`;
	const start = page && /^\d+$/.test(page) ? Number(page) : 1;
	if (start > 1) url += `&start_index=${start}`;
	return url;
}

export function pickGutenbergRepo(fullNames: string[], id: string): string | null {
	if (!/^\d{1,8}$/.test(id)) return null;
	const suffix = `_${id}`;
	for (const name of fullNames) {
		if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(name)) continue;
		const repo = name.slice(name.lastIndexOf('/') + 1);
		if (repo.endsWith(suffix)) return name;
	}
	return null;
}

export function gutenbergMirrorUrl(fullName: string, file: string) {
	return `https://cdn.jsdelivr.net/gh/${fullName}@master/${file}`;
}

function decodeXml(value: string) {
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

function tagAttrs(tag: string) {
	const attrs: Record<string, string> = {};
	for (const match of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
		attrs[match[1]] = decodeXml(match[3] ?? match[4] ?? '');
	}
	return attrs;
}

function elementText(entry: string, tag: string) {
	const match = entry.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
	if (!match) return '';
	return decodeXml(match[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function nextStart(preamble: string) {
	for (const match of preamble.matchAll(/<link\b[^>]*>/gi)) {
		const attrs = tagAttrs(match[0]);
		if (attrs.rel !== 'next' || !attrs.href) continue;
		const found = attrs.href.match(/start_index=(\d+)/);
		if (found) return found[1];
	}
	return null;
}

/** Gutenberg's OPDS search. File hosts omit CORS, so the file step uses the GITenberg mirror. */
export function parseGutenbergOpds(xml: string, language: string): { books: BrowserBook[]; page: string | null } {
	const lang = GUTENBERG_BROWSER_LANGUAGES.includes(language) ? language : 'en';
	const parts = xml.split(/<entry\b/i);
	const books: OpenBook[] = [];
	for (const part of parts.slice(1)) {
		const entry = part.split(/<\/entry>/i)[0] ?? '';
		const id = entry.match(/<id>\s*[^<]*?\/ebooks\/(\d+)/i)?.[1];
		if (!id) continue;
		const names = [...entry.matchAll(/<name>([^<]*)<\/name>/gi)]
			.map((match) => decodeXml(match[1]).replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.slice(0, 4);
		const content = elementText(entry, 'content');
		const contentAuthor = content && content.length <= 180 && !/\bdownloads\b/i.test(content) ? content : '';
		const authors = names.length ? names : contentAuthor ? [contentAuthor] : [];
		const languages = [...entry.matchAll(/<dcterms:language>([^<]+)<\/dcterms:language>/gi)]
			.map((match) => match[1].trim())
			.filter(Boolean)
			.slice(0, 3);
		const year = elementText(entry, 'dcterms:issued').match(/\d{4}/)?.[0] ?? null;
		let cover = '';
		for (const match of entry.matchAll(/<link\b[^>]*>/gi)) {
			const attrs = tagAttrs(match[0]);
			if ((attrs.rel ?? '').includes('image/thumbnail') && (attrs.href ?? '').startsWith('data:image/')) {
				cover = attrs.href;
				break;
			}
		}
		if (cover) covers.set(id, cover);
		books.push({
			provider: 'gutenberg',
			id,
			title: elementText(entry, 'title') || `Gutenberg ${id}`,
			authors,
			languages: languages.length ? languages : [lang],
			year,
			license: 'public-domain',
			licenseNote: 'Public domain in the USA.',
			formats: GUTENBERG_BROWSER_FORMATS
		});
	}
	return { books, page: nextStart(parts[0] ?? '') };
}

async function mirrorRepo(id: string) {
	const cached = repos.get(id);
	if (cached) return cached;
	const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${id} org:GITenberg`)}&per_page=10`;
	const response = await fetch(url);
	if (response.status === 403 || response.status === 429) {
		throw new Error('GitHub search is rate-limited. Wait a minute and try that book again.');
	}
	if (!response.ok) throw new Error('The GITenberg mirror did not answer.');
	const body = (await response.json()) as { items?: { full_name?: string }[] };
	const name = pickGutenbergRepo(
		(body.items ?? []).map((item) => (typeof item.full_name === 'string' ? item.full_name : '')),
		id
	);
	if (!name) {
		throw new Error('That book is not in the GITenberg mirror. The Open Book Reader server can still fetch it.');
	}
	repos.set(id, name);
	return name;
}

async function mirrorBytes(fullName: string, file: string) {
	const response = await fetch(gutenbergMirrorUrl(fullName, file));
	if (response.status === 404) return null;
	if (!response.ok) throw new Error('The GITenberg mirror did not return that file.');
	return new Uint8Array(await response.arrayBuffer());
}

function looksLikeText(bytes: Uint8Array) {
	const head = new TextDecoder().decode(bytes.subarray(0, 80)).trimStart().toLowerCase();
	return bytes.length > 32 && !head.startsWith('<!doctype') && !head.startsWith('<html') && !head.startsWith('pk');
}

export async function downloadGutenbergBrowser(id: string, mediaType: string, title: string) {
	if (!/^\d{1,8}$/.test(id)) throw new Error('That book is not in this catalog.');
	if (mediaType === 'application/epub+zip') throw new Error(EPUB_NEEDS_SERVER);
	const repo = await mirrorRepo(id);
	if (mediaType === 'application/pdf') {
		const bytes = await mirrorBytes(repo, `${id}-pdf.pdf`);
		if (!bytes || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
			throw new Error('That PDF is not in the GITenberg mirror. Add the text, or use the Open Book Reader server for the EPUB.');
		}
		return new File([bytes], `${title || id}.pdf`, { type: 'application/pdf' });
	}
	if (mediaType !== 'text/plain') throw new Error('That format is not available in this browser.');
	for (const file of [`${id}-0.txt`, `${id}.txt`]) {
		const bytes = await mirrorBytes(repo, file);
		if (bytes && looksLikeText(bytes)) return new File([bytes], `${title || id}.txt`, { type: 'text/plain' });
	}
	throw new Error('That text is not in the GITenberg mirror. The Open Book Reader server can still fetch it.');
}

export async function downloadGutenbergCover(id: string): Promise<Blob | null> {
	const inline = covers.get(id);
	if (inline) {
		try {
			const response = await fetch(inline);
			if (!response.ok) return null;
			const blob = await response.blob();
			return blob.size ? blob : null;
		} catch {
			return null;
		}
	}
	return null;
}
