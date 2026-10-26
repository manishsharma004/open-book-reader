/** Prefix an app path with the Pages base. An empty base keeps the local server at `/`. */
export function normalizeBase(raw: string | undefined | null): string {
	if (!raw || raw === '/') return '';
	const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
	return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
}

export function joinApi(base: string, path: string): string {
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${normalizeBase(base)}${suffix}`;
}

export function apiUrl(path: string): string {
	const raw = import.meta.env?.BASE_URL;
	return joinApi(typeof raw === 'string' ? raw : '', path);
}
