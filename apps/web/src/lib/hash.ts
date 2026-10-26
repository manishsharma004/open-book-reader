/** SHA-256 and ids that work on a phone opened over plain http://192.168… */

import { sha256Bytes } from './sha256.js';

export { sha256Bytes };

function hex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(file: Blob): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		const digest = await subtle.digest('SHA-256', bytes);
		return hex(new Uint8Array(digest));
	}
	return hex(sha256Bytes(bytes));
}

export function randomId(): string {
	const cryptoRef = globalThis.crypto;
	if (typeof cryptoRef?.randomUUID === 'function') {
		try {
			return cryptoRef.randomUUID();
		} catch {
			// Some browsers expose randomUUID only to refuse it outside a secure page.
		}
	}
	const bytes = new Uint8Array(16);
	cryptoRef.getRandomValues(bytes);
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const id = hex(bytes);
	return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
