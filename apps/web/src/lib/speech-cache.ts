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

export async function speechCacheId(bookId: string, identity: SpeechIdentity): Promise<string> {
	const bytes = new TextEncoder().encode(`${bookId}\n${speechMaterial(identity)}`);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
