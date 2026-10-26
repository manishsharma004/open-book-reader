/**
 * Speech hears the punctuation that was printed on the page.
 *
 * A full stop, comma, or other mark stays on the word it belongs to, so the
 * voice can pause there. Opening quotes stay with the word they introduce.
 */

const OPENER = /["'“‘«(\[{]/u;

const LIGATURES: Record<string, string> = {
	'\uFB00': 'ff',
	'\uFB01': 'fi',
	'\uFB02': 'fl',
	'\uFB03': 'ffi',
	'\uFB04': 'ffl',
	'\uFB05': 'st',
	'\uFB06': 'st',
	'\u0152': 'OE',
	'\u0153': 'oe',
	'\u00C6': 'AE',
	'\u00E6': 'ae'
};

/** A printed ligature is letters. Speech was sounding the character itself. */
export function expandLigatures(text: string): string {
	return text.replace(/[\uFB00-\uFB06\u0152\u0153\u00C6\u00E6]/g, (char) => LIGATURES[char] ?? char);
}

export type SpokenPiece = { segment: string; isWordLike?: boolean };

export type SpokenWordSpan = { text: string; pieceIndex: number };

function marksIn(segment: string): string[] {
	return [...segment].filter((char) => /\p{P}/u.test(char));
}

function wordFollows(parts: SpokenPiece[], index: number): boolean {
	for (let cursor = index + 1; cursor < parts.length; cursor += 1) {
		if (parts[cursor].isWordLike) return true;
		if (marksIn(parts[cursor].segment).length > 0) return false;
	}
	return false;
}

export function spokenWordSpans(parts: SpokenPiece[]): SpokenWordSpan[] {
	const spans: SpokenWordSpan[] = [];
	let pending = '';
	let closed = false;
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (part.isWordLike) {
			spans.push({ text: pending + part.segment, pieceIndex: index });
			pending = '';
			closed = false;
			continue;
		}
		for (const mark of marksIn(part.segment)) {
			const opens = OPENER.test(mark) && !closed && wordFollows(parts, index);
			if (opens) pending += mark;
			else if (spans.length > 0) spans[spans.length - 1].text += mark;
			else pending += mark;
			if (/[.,;:!?…]/.test(mark)) closed = true;
		}
	}
	if (pending) {
		if (spans.length > 0) spans[spans.length - 1].text += pending;
		else spans.push({ text: pending, pieceIndex: Math.max(0, parts.length - 1) });
	}
	return spans.filter((span) => span.text.length > 0);
}

export function segmentSpokenWords(source: string): string[] {
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
	return spokenWordSpans(
		[...segmenter.segment(expandLigatures(source))].map((part) => ({ segment: part.segment, isWordLike: part.isWordLike }))
	).map((span) => span.text);
}

export type ReadingRun = { text: string; block: boolean };

/** Inline pieces stay one word. A block starts a paragraph. */
export function joinReadingRuns(runs: ReadingRun[]): string {
	let out = '';
	for (const run of runs) {
		if (run.block && out.length > 0 && !out.endsWith('\n')) out += '\n';
		out += run.text;
	}
	return expandLigatures(out)
		.replace(/[^\S\n]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
