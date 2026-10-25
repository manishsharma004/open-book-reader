import { spokenWordSpans, type SpokenPiece } from '#lib/spoken-text.js';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;

export type PageWord = {
	text: string;
	x: number;
	y: number;
	w: number;
	h: number;
	charStart: number;
	charEnd: number;
};

export type PageText = {
	words: PageWord[];
	text: string;
};

const standardFontDataUrl = `${import.meta.env.BASE_URL}standard_fonts/`;

export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
	return getDocument({ data, password, standardFontDataUrl }).promise;
}

export async function pageWords(page: PDFPageProxy): Promise<PageText> {
	const content = await page.getTextContent();
	const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
	const pieces: Array<SpokenPiece & Pick<PageWord, 'x' | 'y' | 'w' | 'h'>> = [];

	for (const item of content.items) {
		if (!('str' in item) || !item.str) continue;
		const width = item.width;
		const height = Math.hypot(item.transform[2], item.transform[3]) || item.height || 12;
		const x0 = item.transform[4];
		const y0 = item.transform[5];
		const length = item.str.length || 1;
		for (const part of segmenter.segment(item.str)) {
			pieces.push({
				segment: part.segment,
				isWordLike: part.isWordLike,
				x: x0 + width * (part.index / length),
				y: y0,
				w: width * (Math.max(part.segment.trim().length, 1) / length),
				h: height
			});
		}
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
			charEnd: text.length
		});
	}

	return { words, text };
}

export async function coverBlob(page: PDFPageProxy): Promise<Blob> {
	const viewport = page.getViewport({ scale: 0.4 });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	const canvasContext = canvas.getContext('2d');
	if (!canvasContext) throw new Error('Could not draw the cover.');
	await page.render({ canvas, canvasContext, viewport }).promise;
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
	if (!blob) throw new Error('Could not store the cover.');
	return blob;
}

export function isPasswordError(error: unknown): boolean {
	return error instanceof Error && error.name === 'PasswordException';
}
