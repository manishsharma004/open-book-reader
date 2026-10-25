/**
 * A chapter title is spoken apart from the prose. A running header is not spoken.
 *
 * Titles are short lines in a larger size, or lines that name a chapter.
 * Headers and footers sit in the page margin at body size or smaller.
 */

export type WordRole = 'heading' | 'body' | 'header';

const NUMBERED = /^(chapter|chap\.?|part|book|volume)\s+(\d+|[ivxlcdm]+)\b/iu;
const MATTER = /^(prologue|epilogue|preface|foreword|introduction|afterword|appendix|interlude|contents)\b/iu;
const SENTENCE_END = /[.!?…]["')\]]*$/u;

export type RoleWord = { text: string; x: number; y: number; h: number };

type Line = { indexes: number[]; y: number; h: number };

function linesOf(words: RoleWord[]): Line[] {
	const lines: Line[] = [];
	for (let index = 0; index < words.length; index += 1) {
		const word = words[index];
		const line = lines[lines.length - 1];
		const limit = Math.max(word.h, line?.h ?? word.h, 1) * 0.45;
		if (!line || Math.abs(word.y - line.y) > limit) lines.push({ indexes: [index], y: word.y, h: word.h });
		else {
			line.indexes.push(index);
			const height = line.indexes.reduce((sum, item) => sum + words[item].h, 0) / line.indexes.length;
			line.h = height;
		}
	}
	return lines;
}

function bodySize(lines: Line[], words: RoleWord[]): number {
	const buckets = new Map<number, number>();
	for (const line of lines) {
		const key = Math.round(line.h * 2) / 2;
		buckets.set(key, (buckets.get(key) ?? 0) + line.indexes.length);
	}
	let best = 0;
	let count = 0;
	for (const [key, size] of buckets) {
		if (size > count) {
			best = key;
			count = size;
		}
	}
	if (best > 0) return best;
	const heights = words.map((word) => word.h).sort((left, right) => left - right);
	return heights[Math.floor(heights.length / 2)] || 12;
}

function lineText(words: RoleWord[], line: Line): string {
	return line.indexes
		.map((index) => words[index].text)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function assignWordRoles(words: RoleWord[], pageHeight: number): WordRole[] {
	const roles: WordRole[] = words.map(() => 'body');
	if (words.length === 0) return roles;
	const lines = linesOf(words);
	const body = bodySize(lines, words);
	const height = pageHeight > 0 ? pageHeight : Math.max(...words.map((word) => word.y + word.h), 1);
	const margin = height * 0.08;
	for (const line of lines) {
		const text = lineText(words, line);
		const bare = text.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
		const count = line.indexes.length;
		const fromTop = height - (line.y + line.h);
		const inMargin = fromTop < margin || line.y < margin;
		const small = line.h <= body * 1.08;
		const pageNumber = /^(\d+|[ivxlcdm]+)$/iu.test(bare);
		if (inMargin && count <= 12 && (small || pageNumber)) {
			for (const index of line.indexes) roles[index] = 'header';
			continue;
		}
		const taller = line.h >= body * 1.18 && count <= 14 && (count >= 2 || bare.length >= 3);
		const named =
			((NUMBERED.test(bare) && count <= 14) || (MATTER.test(bare) && count <= 8)) && line.h >= body * 0.85;
		const caps =
			!SENTENCE_END.test(text) &&
			count >= 2 &&
			count <= 8 &&
			bare.length > 0 &&
			bare === bare.toUpperCase() &&
			/\p{L}/u.test(bare) &&
			line.h >= body * 0.9;
		if (taller || named || caps) {
			for (const index of line.indexes) roles[index] = 'heading';
		}
	}
	return roles;
}

export function spokenClipText(words: Array<RoleWord & { role?: WordRole }>): string {
	const heading = words.length > 0 && words.every((word) => word.role === 'heading');
	let text = '';
	for (let index = 0; index < words.length; index += 1) {
		if (index > 0) {
			const previous = words[index - 1];
			const gap = Math.abs(words[index].y - previous.y);
			const lineBreak = gap > Math.max(words[index].h, previous.h, 1) * 0.45;
			text += heading && lineBreak && !SENTENCE_END.test(previous.text) ? '. ' : ' ';
		}
		text += words[index].text;
	}
	if (heading && text && !SENTENCE_END.test(text)) text += '.';
	return text;
}
