import type { HandleClientError } from '@sveltejs/kit';
import { apiUrl } from '#lib/api-url.js';

export const handleError: HandleClientError = ({ error, message, event }) => {
	const text = error instanceof Error && error.message ? error.message : message;
	const route = event.url.pathname.slice(0, 200);
	const payload = JSON.stringify({ route, message: text.slice(0, 300) });
	try {
		if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
			navigator.sendBeacon(apiUrl('/v1/log'), new Blob([payload], { type: 'application/json' }));
		} else {
			void fetch(apiUrl('/v1/log'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: payload,
				keepalive: true
			}).catch(() => {});
		}
	} catch {
		// A failed report must not replace the error the reader is already seeing.
	}
	return { message: text };
};
