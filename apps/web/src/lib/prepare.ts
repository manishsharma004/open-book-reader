import { readPage } from '#lib/ocr.js';
import { logPipeline } from '#lib/pipeline.svelte.js';
import { canonEmotion, PROSODY } from '#lib/speech.js';
import {
	emotionEndpoint,
	hostOf,
	voiceSample,
	type AppSettings,
	type EmotionName
} from '#lib/settings.js';
import { complete, parseEmotionJson, speak, type TimedWord } from '#lib/vendor.js';
import type { PageWord } from '#lib/pdf.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type Clause = {
	text: string;
	emotion: EmotionName;
	wordStart: number;
	wordEnd: number;
};

export type WordTiming = { wordIndex: number; start: number; end: number };

export type PreparedPage = {
	pageIndex: number;
	source: 'text' | 'ocr';
	words: PageWord[];
	text: string;
	clauses: Clause[];
	audioUrl: string | null;
	timings: WordTiming[] | null;
	confidence: number | null;
	note: string | null;
};

type Job = {
	index: number;
	settings: AppSettings;
	key: string;
	promise: Promise<PreparedPage>;
	resolve: (page: PreparedPage) => void;
	reject: (error: unknown) => void;
};

const cache = new Map<string, PreparedPage>();
let jobs: Job[] = [];
let activeKey: string | null = null;
let activePromise: Promise<PreparedPage> | null = null;
let pumping = false;
let pdf: PDFDocumentProxy | null = null;
const listeners = new Set<() => void>();

let emitQueued = false;

function emit() {
	if (emitQueued) return;
	emitQueued = true;
	queueMicrotask(() => {
		emitQueued = false;
		for (const listener of [...listeners]) listener();
	});
}

export function onBuffer(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function cacheKey(index: number, settings: AppSettings) {
	const emotionHost = emotionEndpoint(settings);
	return JSON.stringify({
		index,
		ocr: settings.ocrLanguage,
		emotion: settings.emotion,
		emotionHost: emotionHost ? { base: emotionHost.baseUrl, model: emotionHost.model, key: emotionHost.apiKey.length } : null,
		tts: settings.tts.vendor === 'browser' ? 'browser' : {
			vendor: settings.tts.vendor,
			base: settings.tts.baseUrl,
			model: settings.tts.model,
			voice: settings.tts.voice,
			key: settings.tts.apiKey.length,
			sample: settings.tts.vendor === 'pocket' || settings.sendSample ? settings.cloneBlobId : null
		}
	});
}

export function attachDocument(next: PDFDocumentProxy | null) {
	pdf = next;
	for (const job of jobs) job.reject(new DOMException('Skipped', 'AbortError'));
	jobs = [];
	for (const page of cache.values()) {
		if (page.audioUrl) URL.revokeObjectURL(page.audioUrl);
	}
	cache.clear();
	emit();
}

function remember(key: string, page: PreparedPage) {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, page);
	while (cache.size > 8) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const dropped = cache.get(oldest);
		if (dropped?.audioUrl) URL.revokeObjectURL(dropped.audioUrl);
		cache.delete(oldest);
	}
}

function enqueue(index: number, settings: AppSettings, front: boolean): Promise<PreparedPage> {
	const key = cacheKey(index, settings);
	const hit = cache.get(key);
	if (hit) return Promise.resolve(hit);
	const queued = jobs.find((job) => job.key === key);
	if (queued) {
		if (front) jobs = [queued, ...jobs.filter((job) => job !== queued)];
		return queued.promise;
	}
	if (activeKey === key && activePromise) return activePromise;
	let resolve: (page: PreparedPage) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<PreparedPage>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	promise.catch(() => {});
	const job: Job = { index, settings, key, promise, resolve, reject };
	if (front) jobs.unshift(job);
	else jobs.push(job);
	emit();
	schedulePump();
	return promise;
}

let pumpQueued = false;

function schedulePump() {
	if (pumpQueued) return;
	pumpQueued = true;
	queueMicrotask(() => {
		pumpQueued = false;
		void pump();
	});
}

async function pump() {
	if (pumping) return;
	pumping = true;
	try {
		while (jobs.length) {
			const job = jobs.shift()!;
			const hit = cache.get(job.key);
			if (hit) {
				job.resolve(hit);
				emit();
				continue;
			}
			activeKey = job.key;
			activePromise = job.promise;
			emit();
			try {
				const page = await doPrepare(job.index, job.settings);
				remember(job.key, page);
				job.resolve(page);
			} catch (error) {
				job.reject(error);
			} finally {
				activeKey = null;
				activePromise = null;
				emit();
			}
		}
	} finally {
		pumping = false;
		if (jobs.length) schedulePump();
	}
}

export function warm(current: number, pageCount: number, settings: AppSettings) {
	const wanted: number[] = [];
	for (let offset = 0; offset <= settings.lookahead; offset += 1) {
		const index = current + offset;
		if (index < pageCount) wanted.push(index);
	}
	const keep = new Set(wanted.map((index) => cacheKey(index, settings)));
	const kept: Job[] = [];
	for (const job of jobs) {
		if (keep.has(job.key)) kept.push(job);
		else job.reject(new DOMException('Skipped', 'AbortError'));
	}
	jobs = kept;
	for (const index of wanted) enqueue(index, settings, false);
	const currentKey = cacheKey(current, settings);
	const currentJob = jobs.findIndex((job) => job.key === currentKey);
	if (currentJob > 0) {
		const [job] = jobs.splice(currentJob, 1);
		jobs.unshift(job);
	}
	emit();
	schedulePump();
}

export function ensurePage(index: number, settings: AppSettings) {
	return enqueue(index, settings, true);
}

export type BufferPage = { index: number; state: 'ready' | 'working' | 'queued' };

export function bufferSnapshot(current: number, pageCount: number, settings: AppSettings): BufferPage[] {
	const pages: BufferPage[] = [];
	for (let offset = 0; offset <= settings.lookahead; offset += 1) {
		const index = current + offset;
		if (index >= pageCount) break;
		const key = cacheKey(index, settings);
		const state = cache.has(key) ? 'ready' : activeKey === key ? 'working' : 'queued';
		pages.push({ index, state });
	}
	return pages;
}

function oneClause(words: PageWord[], text: string, emotion: EmotionName): Clause[] {
	return [{ text, emotion, wordStart: 0, wordEnd: words.length }];
}

function alignClauses(words: PageWord[], raw: { text: string; emotion: EmotionName }[]): Clause[] | null {
	const norm = (value: string) => value.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
	let cursor = 0;
	const clauses: Clause[] = [];
	for (const clause of raw) {
		const parts = clause.text.split(/\s+/).filter(Boolean);
		if (parts.length === 0) continue;
		const start = cursor;
		for (const part of parts) {
			if (cursor >= words.length || norm(words[cursor].text) !== norm(part)) return null;
			cursor += 1;
		}
		clauses.push({
			text: words.slice(start, cursor).map((word) => word.text).join(' '),
			emotion: clause.emotion,
			wordStart: start,
			wordEnd: cursor
		});
	}
	if (cursor !== words.length || clauses.length === 0) return null;
	return clauses;
}

function alignTimings(words: PageWord[], timed: TimedWord[]): WordTiming[] {
	const count = Math.min(words.length, timed.length);
	return Array.from({ length: count }, (_, index) => ({
		wordIndex: index,
		start: timed[index].start,
		end: timed[index].end
	}));
}

async function blobToBase64(blob: Blob) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function doPrepare(index: number, settings: AppSettings): Promise<PreparedPage> {
	if (!pdf) throw new Error('The book is not open.');
	const pageNumber = index + 1;
	const started = performance.now();
	logPipeline({ page: pageNumber, stage: 'text', status: 'start', ms: null, detail: 'Reading the page' });
	const page = await pdf.getPage(pageNumber);
	let extracted;
	try {
		extracted = await readPage(page, settings.ocrLanguage || 'eng', pageNumber);
	} catch (error) {
		const detail = error instanceof Error ? error.message : `OCR failed: ${String(error)}`;
		logPipeline({ page: pageNumber, stage: 'ocr', status: 'error', ms: Math.round(performance.now() - started), detail });
		return {
			pageIndex: index,
			source: 'ocr',
			words: [],
			text: '',
			clauses: [],
			audioUrl: null,
			timings: null,
			confidence: null,
			note: detail
		};
	}
	if (extracted.source === 'text') {
		logPipeline({
			page: pageNumber,
			stage: 'text',
			status: 'ok',
			ms: Math.round(performance.now() - started),
			detail: `${extracted.words.length} words from the PDF text layer. ${extracted.text.slice(0, 700)}`
		});
	} else {
		logPipeline({
			page: pageNumber,
			stage: 'ocr',
			status: extracted.words.length ? 'ok' : 'error',
			ms: Math.round(performance.now() - started),
			detail: extracted.words.length
				? `${extracted.words.length} words, mean confidence ${extracted.confidence}. ${extracted.text.slice(0, 700)}`
				: 'OCR found no words on this page.'
		});
	}

	let clauses = oneClause(extracted.words, extracted.text, settings.emotion === 'auto' ? 'neutral' : canonEmotion(settings.emotion));
	const endpoint = settings.emotion === 'auto' ? emotionEndpoint(settings) : null;
	if (settings.emotion !== 'auto') {
		logPipeline({
			page: pageNumber,
			stage: 'emotion',
			status: 'skip',
			ms: 0,
			detail: `Emotion is set to ${settings.emotion}. No model call. ${PROSODY[canonEmotion(settings.emotion)].instruction}`
		});
	} else if (!endpoint) {
		logPipeline({
			page: pageNumber,
			stage: 'emotion',
			status: 'skip',
			ms: 0,
			detail: 'Emotion analysis and VLLM are off. The page stays neutral until you pick an emotion or enable a model in Settings.'
		});
	} else if (!extracted.text) {
		logPipeline({ page: pageNumber, stage: 'emotion', status: 'skip', ms: 0, detail: 'No words to mark.' });
	} else {
		const emotionStarted = performance.now();
		logPipeline({
			page: pageNumber,
			stage: 'emotion',
			status: 'start',
			ms: null,
			detail: `POST /v1/complete → ${hostOf(endpoint.baseUrl)} model ${endpoint.model || '(empty)'}`
		});
		try {
			const content = await complete(
				endpoint,
				'You mark emotions for a text-to-speech reader. Reply with JSON only: {"clauses":[{"text":"...","emotion":"neutral"}]} . Emotions: neutral, calm, warm, tense, somber, excited, whispered, angry. Keep every word in order. Do not add, drop, or replace words. Split at sentence boundaries.',
				extracted.text.slice(0, 12000)
			);
			const parsed = parseEmotionJson(content);
			const aligned = parsed ? alignClauses(extracted.words, parsed) : null;
			if (!aligned) {
				logPipeline({
					page: pageNumber,
					stage: 'emotion',
					status: 'error',
					ms: Math.round(performance.now() - emotionStarted),
					detail: `The model JSON did not match the page words. Speaking the page as neutral. ${content.slice(0, 700)}`
				});
			} else {
				clauses = aligned;
				logPipeline({
					page: pageNumber,
					stage: 'emotion',
					status: 'ok',
					ms: Math.round(performance.now() - emotionStarted),
					detail: aligned.map((clause) => `${clause.emotion}: ${clause.text}`).join(' | ').slice(0, 1200)
				});
			}
		} catch (error) {
			logPipeline({
				page: pageNumber,
				stage: 'emotion',
				status: 'error',
				ms: Math.round(performance.now() - emotionStarted),
				detail: error instanceof Error ? error.message : 'Emotion request failed'
			});
		}
	}

	let audioUrl: string | null = null;
	let timings: WordTiming[] | null = null;
	let note: string | null = null;
	if (settings.tts.vendor === 'browser') {
		logPipeline({
			page: pageNumber,
			stage: 'tts',
			status: 'skip',
			ms: 0,
			detail: 'Browser voice speaks when you press Play. Emotion changes pitch, rate, and volume. A vendor voice is required for real expression and for voice cloning.'
		});
	} else if (!extracted.text) {
		logPipeline({ page: pageNumber, stage: 'tts', status: 'skip', ms: 0, detail: 'No words to speak.' });
	} else {
		const speechStarted = performance.now();
		logPipeline({
			page: pageNumber,
			stage: 'tts',
			status: 'start',
			ms: null,
			detail: `POST /v1/speak → ${settings.tts.vendor} ${hostOf(settings.tts.baseUrl)} model ${settings.tts.model || '(default)'} voice ${settings.tts.voice || '(default)'}`
		});
		try {
			const useSample = settings.tts.vendor === 'pocket' || settings.sendSample;
			const sample = useSample ? await voiceSample(settings) : undefined;
			const sampleBase64 = sample ? await blobToBase64(sample) : null;
			const dominant = clauses[0]?.emotion ?? 'neutral';
			const spoken = clauses.map((clause) => clause.text).join(' ');
			const instructions = clauses
				.map((clause) => `${PROSODY[clause.emotion].instruction} Say: ${clause.text}`)
				.join('\n');
			const result = await speak(
				settings.tts,
				spoken,
				dominant,
				instructions,
				sampleBase64,
				Boolean(sample),
				sample?.type || null
			);
			audioUrl = URL.createObjectURL(result.blob);
			timings = result.words ? alignTimings(extracted.words, result.words) : null;
			logPipeline({
				page: pageNumber,
				stage: 'tts',
				status: 'ok',
				ms: Math.round(performance.now() - speechStarted),
				detail: `${result.delivery} Audio ${result.blob.size} bytes, ${result.mime}. ${timings ? `${timings.length} word times.` : 'No word times, so the whole page highlights together.'}`
			});
		} catch (error) {
			note = error instanceof Error ? error.message : 'Speech failed';
			logPipeline({
				page: pageNumber,
				stage: 'tts',
				status: 'error',
				ms: Math.round(performance.now() - speechStarted),
				detail: `${note} Playback will use the browser voice for this page.`
			});
		}
	}

	const readyCount = bufferReadyCount(index, settings);
	logPipeline({
		page: pageNumber,
		stage: 'buffer',
		status: 'ok',
		ms: null,
			detail: `Page ${pageNumber} is ready. Lookahead is ${settings.lookahead} pages. ${readyCount}`
	});

	return {
		pageIndex: index,
		source: extracted.source,
		words: extracted.words,
		text: extracted.text,
		clauses,
		audioUrl,
		timings,
		confidence: extracted.confidence,
		note
	};
}

function bufferReadyCount(index: number, settings: AppSettings) {
	const key = cacheKey(index, settings);
	return cache.has(key) ? 'Cached.' : 'Fresh.';
}
