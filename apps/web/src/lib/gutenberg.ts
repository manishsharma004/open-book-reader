/** The Project Gutenberg ebook number printed at the start of a plain-text transcription. */
export function gutenbergEbookId(text: string): string | null {
	const head = text.slice(0, 8000);
	const named = head.match(/project gutenberg ebook(?:\s+#|\s+)(\d{2,6})\b/i);
	if (named) return named[1];
	const bracket = head.match(/\[ebook\s+#(\d{2,6})\]/i);
	return bracket?.[1] ?? null;
}
