/**
 * Vendor speech is stored as short clips, not one file per page.
 *
 * Pocket is trained on at most 50 tokens and does not end a clip that runs
 * past that. This book's pages measured about 1.6 tokens a word, so 24 words
 * stays under the cap even when the page has no sentence marks. The reader
 * still fills the whole page buffer, one clip at a time.
 */

export const SPEECH_CHUNK_WORDS = 24;
export const READY_TINT = 'rgba(74, 222, 128, 0.32)';

const SENTENCE = /[.!?…]["')\]]*$/u;
const CLAUSE = /[,;:]["')\]]*$/u;

export type SpeechSpan = { wordStart: number; wordEnd: number };

export function splitSpeechWords(words: string[], maxWords = SPEECH_CHUNK_WORDS): SpeechSpan[] {
	const pieces: SpeechSpan[] = [];
	let start = 0;
	let clauseAt = -1;
	for (let index = 0; index < words.length; index += 1) {
		if (CLAUSE.test(words[index])) clauseAt = index;
		const sentence = SENTENCE.test(words[index]);
		const full = index - start + 1 >= maxWords;
		if (!sentence && !full) continue;
		let end = index + 1;
		if (full && !sentence && clauseAt >= start && clauseAt < index) end = clauseAt + 1;
		pieces.push({ wordStart: start, wordEnd: end });
		index = end - 1;
		start = end;
		clauseAt = -1;
	}
	if (start < words.length) pieces.push({ wordStart: start, wordEnd: words.length });

	const spans: SpeechSpan[] = [];
	let packStart = -1;
	let packCount = 0;
	for (const piece of pieces) {
		const count = piece.wordEnd - piece.wordStart;
		if (packCount > 0 && packCount + count > maxWords) {
			spans.push({ wordStart: packStart, wordEnd: piece.wordStart });
			packStart = piece.wordStart;
			packCount = 0;
		}
		if (packStart < 0) packStart = piece.wordStart;
		packCount += count;
		if (packCount >= maxWords) {
			spans.push({ wordStart: packStart, wordEnd: piece.wordEnd });
			packStart = -1;
			packCount = 0;
		}
	}
	if (packCount > 0 && packStart >= 0) spans.push({ wordStart: packStart, wordEnd: words.length });
	return spans;
}

export function clipIndexForWord(clips: SpeechSpan[], word: number): number {
	if (clips.length === 0 || word < 0) return -1;
	const found = clips.findIndex((clip) => word >= clip.wordStart && word < clip.wordEnd);
	if (found >= 0) return found;
	if (word < clips[0].wordStart) return 0;
	return -1;
}

export function wordBackdrop(active: boolean, ready: boolean): string {
	if (active) return 'var(--highlight)';
	if (ready) return READY_TINT;
	return 'transparent';
}
