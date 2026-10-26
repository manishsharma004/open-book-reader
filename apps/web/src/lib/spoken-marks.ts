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

/** Same map as spoken-text.ts. A printed ligature is the letters it stands for. */
function expandLigatures(text: string): string {
	return text.replace(/[\uFB00-\uFB06\u0152\u0153\u00C6\u00E6]/g, (char) => LIGATURES[char] ?? char);
}

export type MarkPiece = { text: string; block: boolean };

export type WordSlice = { piece: number; start: number; end: number };

type Atom = { piece: number; offset: number } | null;

/** Where each spoken word sits in the column's text pieces. */
export function wordHits(pieces: MarkPiece[], words: string[]): WordSlice[][] {
	const { text, map } = normalize(pieces);
	const hits: WordSlice[][] = [];
	let cursor = 0;
	for (const word of words) {
		const target = expandLigatures(word);
		while (cursor < text.length && /\s/u.test(text[cursor] ?? '')) cursor += 1;
		const at = target ? text.indexOf(target, cursor) : -1;
		const gap = at < 0 ? '' : text.slice(cursor, at);
		if (at < 0 || gap.trim().length > 0) {
			hits.push([]);
			continue;
		}
		const end = at + target.length;
		hits.push(slices(map, at, end));
		cursor = end;
	}
	return hits;
}

function normalize(pieces: MarkPiece[]): { text: string; map: Atom[] } {
	const chars: string[] = [];
	const map: Atom[] = [];
	const push = (char: string, loc: Atom) => {
		for (const next of expandLigatures(char)) {
			chars.push(next);
			map.push(loc);
		}
	};
	for (let index = 0; index < pieces.length; index += 1) {
		const piece = pieces[index];
		if (piece.block && chars.length > 0 && chars[chars.length - 1] !== '\n') {
			chars.push('\n');
			map.push(null);
		}
		for (let offset = 0; offset < piece.text.length; offset += 1) {
			push(piece.text[offset] ?? '', { piece: index, offset });
		}
	}
	return collapse(chars, map);
}

function collapse(chars: string[], map: Atom[]): { text: string; map: Atom[] } {
	let text = chars.join('');
	let placed = map;
	const fold = (pattern: RegExp, replacement: (match: string) => string) => {
		const nextChars: string[] = [];
		const nextMap: Atom[] = [];
		let cursor = 0;
		for (const match of text.matchAll(pattern)) {
			const start = match.index ?? 0;
			nextChars.push(text.slice(cursor, start));
			nextMap.push(...placed.slice(cursor, start));
			const value = replacement(match[0]);
			nextChars.push(value);
			for (let index = 0; index < value.length; index += 1) nextMap.push(placed[start] ?? null);
			cursor = start + match[0].length;
		}
		nextChars.push(text.slice(cursor));
		nextMap.push(...placed.slice(cursor));
		text = nextChars.join('');
		placed = nextMap;
	};
	fold(/[^\S\n]+/g, () => ' ');
	fold(/ *\n */g, () => '\n');
	fold(/\n{3,}/g, () => '\n\n');
	const leading = text.match(/^\s+/)?.[0].length ?? 0;
	const trailing = text.match(/\s+$/)?.[0].length ?? 0;
	const end = text.length - trailing;
	return { text: text.slice(leading, end), map: placed.slice(leading, end) };
}

function slices(map: Atom[], start: number, end: number): WordSlice[] {
	const out: WordSlice[] = [];
	for (let index = start; index < end; index += 1) {
		const loc = map[index];
		if (!loc) continue;
		const last = out[out.length - 1];
		if (last && last.piece === loc.piece && last.end === loc.offset + 1) continue;
		if (last && last.piece === loc.piece && last.end === loc.offset) {
			last.end = loc.offset + 1;
			continue;
		}
		out.push({ piece: loc.piece, start: loc.offset, end: loc.offset + 1 });
	}
	return out;
}
