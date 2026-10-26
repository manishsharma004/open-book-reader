import { sha256Bytes } from './sha256.js';

export type SpeechIdentity = {
	text: string;
	emotion: string;
	vendor: string;
	baseUrl: string;
	model: string;
	voice: string;
	sampleId: string | null;
};

/** What makes one spoken clip different from another. Playback speed is not part of it. */
export function speechMaterial(identity: SpeechIdentity): string {
	return JSON.stringify({
		text: identity.text,
		emotion: identity.emotion,
		vendor: identity.vendor,
		base: identity.baseUrl,
		model: identity.model,
		voice: identity.voice,
		sample: identity.sampleId
	});
}

function hex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A page opened at http://192.168… has no Web Crypto, so the hash cannot use subtle. */
export async function speechCacheId(bookId: string, identity: SpeechIdentity): Promise<string> {
	const bytes = new TextEncoder().encode(`${bookId}\n${speechMaterial(identity)}`);
	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		try {
			return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
		} catch {
			// The method exists only to refuse an insecure page.
		}
	}
	return hex(sha256Bytes(bytes));
}
