/** Origin of a configured Open books API. An empty or unsafe value means "not set". */
export function openBooksBase(value: string | null | undefined): string {
	const trimmed = (value ?? '').trim();
	if (!trimmed) return '';
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return '';
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
	let path = url.pathname.replace(/\/+$/, '');
	if (path.endsWith('/v1')) path = path.slice(0, -3);
	return `${url.origin}${path}`;
}

export function openBooksUrl(base: string, path: string): string {
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}
