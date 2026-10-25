/**
 * Vendor speech is stored as clips that end on a full stop.
 *
 * Short sentences pack up to the pace chosen in the player. A sentence longer
 * than that pace stays one clip until it reaches twice the pace, so an
 * unusually long sentence is not cut at 24 words. A run with no full stop is
 * still cut at the pace: Pocket will not finish a page that has no end mark.
 * A chapter title is its own clip. A running header is left out.
 * The reader still fills the whole page buffer, one clip at a time.
 */

import type { WordRole } from '#lib/page-roles.js';

export const SPEECH_CHUNK_WORDS = 24;
export const SPEECH_PACE_MIN = 8;
export const SPEECH_PACE_MAX = 48;

export const READY_TINT = 'rgba(74, 222, 128, 0.32)';
export const HEADING_TINT = 'rgba(251, 191, 36, 0.34)';

const SENTENCE = /[.!?…]["')\]]*$/u;

export type SpeechSpan = { wordStart: number; wordEnd: number };

export function speechPace(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return SPEECH_CHUNK_WORDS;
	const stepped = Math.round(parsed / 4) * 4;
	return Math.min(SPEECH_PACE_MAX, Math.max(SPEECH_PACE_MIN, stepped));
}

function sentenceLimit(pace: number) {
	return Math.min(64, pace * 2);
}

function splitRun(words: string[], pace: number): SpeechSpan[] {
	if (words.length === 0) return [];
	const budget = speechPace(pace);
	const cap = sentenceLimit(budget);
	const pieces: SpeechSpan[] = [];
	let start = 0;
	for (let index = 0; index < words.length; index += 1) {
		const length = index - start + 1;
		if (SENTENCE.test(words[index]) && length <= cap) {
			pieces.push({ wordStart: start, wordEnd: index + 1 });
			start = index + 1;
			continue;
		}
		if (length >= cap) {
			const end = Math.min(start + budget, words.length);
			pieces.push({ wordStart: start, wordEnd: end });
			index = end - 1;
			start = end;
		}
	}
	while (start < words.length) {
		const remaining = words.length - start;
		const closed = SENTENCE.test(words[words.length - 1]) && remaining <= cap;
		const end = closed ? words.length : Math.min(start + budget, words.length);
		pieces.push({ wordStart: start, wordEnd: end });
		start = end;
	}

	const spans: SpeechSpan[] = [];
	let packStart = -1;
	let packCount = 0;
	for (const piece of pieces) {
		const count = piece.wordEnd - piece.wordStart;
		if (packCount > 0 && packCount + count > budget) {
			spans.push({ wordStart: packStart, wordEnd: piece.wordStart });
			packStart = -1;
			packCount = 0;
		}
		if (packStart < 0) packStart = piece.wordStart;
		packCount += count;
		if (packCount >= budget) {
			spans.push({ wordStart: packStart, wordEnd: piece.wordEnd });
			packStart = -1;
			packCount = 0;
		}
	}
	if (packCount > 0 && packStart >= 0) spans.push({ wordStart: packStart, wordEnd: words.length });
	return spans;
}

export function splitSpeechWords(words: string[], pace = SPEECH_CHUNK_WORDS, roles?: WordRole[]): SpeechSpan[] {
	const budget = speechPace(pace);
	if (!roles) return splitRun(words, budget);
	const spans: SpeechSpan[] = [];
	let index = 0;
	while (index < words.length) {
		const role = roles[index] ?? 'body';
		if (role === 'header') {
			index += 1;
			continue;
		}
		let end = index + 1;
		while (end < words.length && (roles[end] ?? 'body') === role) end += 1;
		if (role === 'heading') spans.push({ wordStart: index, wordEnd: end });
		else {
			const slice = words.slice(index, end);
			for (const piece of splitRun(slice, budget)) {
				spans.push({ wordStart: index + piece.wordStart, wordEnd: index + piece.wordEnd });
			}
		}
		index = end;
	}
	return spans;
}

export function clipIndexForWord(clips: SpeechSpan[], word: number): number {
	if (clips.length === 0 || word < 0) return -1;
	const found = clips.findIndex((clip) => word >= clip.wordStart && word < clip.wordEnd);
	if (found >= 0) return found;
	if (word < clips[0].wordStart) return 0;
	const next = clips.findIndex((clip) => clip.wordStart > word);
	if (next >= 0) return next;
	return -1;
}

export function wordBackdrop(active: boolean, ready: boolean, role: WordRole = 'body'): string {
	if (active) return 'var(--highlight)';
	if (role === 'header') return 'transparent';
	if (role === 'heading' && !ready) return HEADING_TINT;
	if (ready) return READY_TINT;
	return 'transparent';
}
