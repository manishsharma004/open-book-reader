import { assignWordRoles } from '#lib/page-roles.js';
import { pageWords, type PageText, type PageWord } from '#lib/pdf.js';
import { spokenWordSpans, type SpokenPiece } from '#lib/spoken-text.js';
import { setPipelineLive } from '#lib/pipeline.svelte.js';
import { createWorker, type Worker } from 'tesseract.js';
import type { PDFPageProxy } from 'pdfjs-dist';

const SPARSE_WORD_COUNT = 8;
let worker: Worker | null = null;
let workerLanguage = '';
let ocrEpoch = 0;

export function cancelOcr() {
	ocrEpoch += 1;
	const current = worker;
	worker = null;
	workerLanguage = '';
	if (current) void current.terminate().catch(() => {});
}

function asset(file: string) {
	const base = import.meta.env.BASE_URL || '/';
	const prefix = base.endsWith('/') ? base : `${base}/`;
	return new URL(`${prefix}${file}`, window.location.origin).href;
}

async function workerFor(language: string, pageNumber: number) {
	if (worker && workerLanguage === language) return worker;
	if (worker) await worker.terminate();
	worker = null;
	setPipelineLive(`Page ${pageNumber} · loading OCR (${language})`);
	worker = await createWorker(language, 1, {
		workerPath: asset('tesseract/worker.min.js'),
		corePath: asset('tesseract/tesseract-core-simd-lstm.wasm.js'),
		langPath: asset('tesseract/lang'),
		workerBlobURL: true,
		gzip: true,
		logger: (message) => {
			const percent = Math.round((message.progress ?? 0) * 100);
			setPipelineLive(`Page ${pageNumber} · OCR ${message.status} ${percent}%`);
		}
	});
	workerLanguage = language;
	return worker;
}

export async function readPage(
	page: PDFPageProxy,
	language: string,
	pageNumber: number
): Promise<PageText & { source: 'text' | 'ocr'; confidence: number | null }> {
	const epoch = ocrEpoch;
	const extracted = await pageWords(page);
	if (epoch !== ocrEpoch) throw new DOMException('Skipped', 'AbortError');
	if (extracted.words.length >= SPARSE_WORD_COUNT) {
		return { ...extracted, source: 'text', confidence: null };
	}
	const base = page.getViewport({ scale: 1 });
	const scale = 2;
	const viewport = page.getViewport({ scale });
	const canvas = document.createElement('canvas');
	canvas.width = Math.ceil(viewport.width);
	canvas.height = Math.ceil(viewport.height);
	const canvasContext = canvas.getContext('2d');
	if (!canvasContext) throw new Error('Could not draw the page for OCR.');
	await page.render({ canvas, canvasContext, viewport }).promise;
	if (epoch !== ocrEpoch) throw new DOMException('Skipped', 'AbortError');
	const engine = await workerFor(language, pageNumber);
	if (epoch !== ocrEpoch) throw new DOMException('Skipped', 'AbortError');
	const result = await engine.recognize(canvas, {}, { text: true, blocks: true });
	if (epoch !== ocrEpoch) throw new DOMException('Skipped', 'AbortError');
	const blocks = result.data.blocks ?? [];
	const recognized = blocks.flatMap((block) =>
		block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))
	);
	const recognizedWords = recognized.flatMap((word) => {
		const token = word.text.trim();
		if (!token) return [];
		const piece: SpokenPiece & { box: PageWord; confidence: number } = {
			segment: token,
			isWordLike: /[\p{L}\p{N}]/u.test(token),
			box: {
				text: token,
				x: word.bbox.x0 / scale,
				y: base.height - word.bbox.y1 / scale,
				w: (word.bbox.x1 - word.bbox.x0) / scale,
				h: (word.bbox.y1 - word.bbox.y0) / scale,
				charStart: 0,
				charEnd: 0,
				role: 'body'
			},
			confidence: word.confidence
		};
		return [piece];
	});
	const words: PageWord[] = [];
	let text = '';
	let confidenceTotal = 0;
	for (const span of spokenWordSpans(recognizedWords)) {
		if (text) text += ' ';
		const charStart = text.length;
		text += span.text;
		const source = recognizedWords[span.pieceIndex];
		words.push({ ...source.box, text: span.text, charStart, charEnd: text.length });
		confidenceTotal += source.confidence;
	}
	const roles = assignWordRoles(words, base.height);
	for (let index = 0; index < words.length; index += 1) words[index].role = roles[index];
	const confidence = words.length ? Math.round(confidenceTotal / words.length) : 0;
	return { words, text, source: 'ocr', confidence };
}
