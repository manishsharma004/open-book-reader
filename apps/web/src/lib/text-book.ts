import type { PageText, PageWord } from '#lib/pdf.js';
import { expandLigatures, spokenWordSpans, type SpokenPiece } from '#lib/spoken-text.js';

export const PAGE_CHARS = 1800;

/** Pages of about 1,800 characters, broken on paragraphs. */
export function paginateText(source: string): string[] {
	const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
	if (!text) return [''];
	const paragraphs = text
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	const pages: string[] = [];
	let current = '';

	function push(chunk: string) {
		const trimmed = chunk.trim();
		if (trimmed) pages.push(trimmed);
	}

	for (const paragraph of paragraphs) {
		if (paragraph.length > PAGE_CHARS) {
			if (current) {
				push(current);
				current = '';
			}
			let rest = paragraph;
			while (rest.length > PAGE_CHARS) {
				let cut = rest.lastIndexOf(' ', PAGE_CHARS);
				if (cut < PAGE_CHARS / 2) cut = PAGE_CHARS;
				push(rest.slice(0, cut));
				rest = rest.slice(cut).trim();
			}
			current = rest;
			continue;
		}
		const next = current ? `${current}\n\n${paragraph}` : paragraph;
		if (current && next.length > PAGE_CHARS) {
			push(current);
			current = paragraph;
		} else {
			current = next;
		}
	}
	if (current) push(current);
	return pages.length ? pages : [''];
}

export function wordsForPage(pageText: string): PageText {
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
	const pieces: Array<SpokenPiece & Pick<PageWord, 'x' | 'y' | 'w' | 'h' | 'role'>> = [];
	let y = 720;
	for (const paragraph of pageText.split(/\n{2,}/)) {
		const parts = [...segmenter.segment(expandLigatures(paragraph))];
		const wordCount = parts.filter((part) => part.isWordLike).length;
		const title = paragraph.trim();
		const illustration = /^\[illustration\b/i.test(title);
		// A closing quote does not make a sentence into a chapter title.
		const heading = !illustration && wordCount > 0 && wordCount <= 12 && title.length < 80 && !/[.!?…]["'”’)\]]*$/u.test(title);
		const height = heading ? 22 : 16;
		let x = 48;
		for (const part of parts) {
			const width = Math.max([...part.segment].length, 1) * 7;
			pieces.push({
				segment: part.segment,
				isWordLike: part.isWordLike,
				x,
				y,
				w: width,
				h: height,
				role: heading ? 'heading' : 'body'
			});
			x += width + 4;
			if (x > 520) {
				x = 48;
				y -= height + 6;
			}
		}
		y -= height + 16;
	}

	const words: PageWord[] = [];
	let text = '';
	for (const span of spokenWordSpans(pieces)) {
		if (text.length > 0) text += ' ';
		const charStart = text.length;
		text += span.text;
		const piece = pieces[span.pieceIndex];
		words.push({
			text: span.text,
			x: piece.x,
			y: piece.y,
			w: piece.w,
			h: piece.h,
			charStart,
			charEnd: text.length,
			role: piece.role
		});
	}
	return { words, text };
}
