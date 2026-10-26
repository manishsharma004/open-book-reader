import { apiUrl } from '#lib/api-url.js';

export type AppServerState = {
	present: boolean;
	version: string;
	ffmpeg: boolean;
};

const absent: AppServerState = { present: false, version: '', ffmpeg: false };
let pending: Promise<AppServerState> | null = null;

export function resetAppServer() {
	pending = null;
}

/** One probe of `/v1/health`. A static copy, including GitHub Pages, answers with the shell or a 404. */
export function appServer(): Promise<AppServerState> {
	pending ??= probe();
	return pending;
}

async function probe(): Promise<AppServerState> {
	try {
		const response = await fetch(apiUrl('/v1/health'), { cache: 'no-store' });
		if (!response.ok) return absent;
		const body = (await response.json()) as { version?: unknown; ffmpeg?: unknown };
		if (typeof body.version !== 'string' || !body.version) return absent;
		return { present: true, version: body.version, ffmpeg: body.ffmpeg === true };
	} catch {
		return absent;
	}
}
