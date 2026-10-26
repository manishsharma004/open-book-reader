import { cancelOcr, readPage } from '#lib/ocr.js';
import { wordsForPage } from '#lib/text-book.js';
import { logPipeline } from '#lib/pipeline.svelte.js';
import { canonEmotion, PROSODY } from '#lib/speech.js';
import {
	emotionEndpoint,
	hostOf,
	voiceSample,
	type AppSettings,
	type EmotionName
} from '#lib/settings.js';
import { spokenClipText } from '#lib/page-roles.js';
import { clipIndexForWord, speechPace, splitSpeechWords } from '#lib/speech-clips.js';
import { complete, parseEmotionJson, speak } from '#lib/vendor.js';
import { getSpeech, putSpeech } from '#lib/db.js';
import { extendsLaidPages } from '#lib/laid-pages.js';
import { speechCacheId, type SpeechIdentity } from '#lib/speech-cache.js';
import type { PageText, PageWord } from '#lib/pdf.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export type Clause = {
	text: string;
	emotion: EmotionName;
	wordStart: number;
	wordEnd: number;
};

export type WordTiming = { wordIndex: number; start: number; end: number };

export type SpeechClip = {
	wordStart: number;
	wordEnd: number;
	text: string;
	emotion: EmotionName;
	audioUrl: string | null;
	timings: WordTiming[] | null;
	state: 'pending' | 'working' | 'ready' | 'error';
	error: string | null;
};

export type PreparedPage = {
	pageIndex: number;
	source: 'text' | 'ocr';
	words: PageWord[];
	text: string;
	clauses: Clause[];
	clips: SpeechClip[];
	audioUrl: string | null;
	timings: WordTiming[] | null;
	confidence: number | null;
	note: string | null;
};

type Job = {
	index: number;
	settings: AppSettings;
	key: string;
	lead: boolean;
	cancelled: boolean;
	settled: boolean;
	promise: Promise<PreparedPage>;
	resolve: (page: PreparedPage) => void;
	reject: (error: unknown) => void;
};

const cache = new Map<string, PreparedPage>();
let speechToken = 0;
let speechPumping = false;
let workAbort = new AbortController();
const droppedPages = new WeakSet<PreparedPage>();
type SpeechTask = { page: PreparedPage; clip: SpeechClip; settings: AppSettings; token: number };
let speechQueue: SpeechTask[] = [];
let jobs: Job[] = [];
let activeKey: string | null = null;
let activePromise: Promise<PreparedPage> | null = null;
let activeJob: Job | null = null;
let activeClip: SpeechClip | null = null;
let pumping = false;
let pdf: PDFDocumentProxy | null = null;
let textPages: string[] | null = null;
let bookId: string | null = null;
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

export function cachedPage(index: number, settings: AppSettings): PreparedPage | null {
	return cache.get(cacheKey(index, settings)) ?? null;
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
		},
		pace: speechPace(settings.speechPace)
	});
}

function isAbort(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError';
}

function settleReject(job: Job, error: unknown) {
	if (job.settled) return;
	job.settled = true;
	job.reject(error);
}

function settleResolve(job: Job, page: PreparedPage) {
	if (job.settled) return;
	job.settled = true;
	job.resolve(page);
}

function abortPending() {
	workAbort.abort();
	workAbort = new AbortController();
	speechToken += 1;
	cancelOcr();
	if (activeJob) activeJob.cancelled = true;
	if (activeClip && activeClip.state === 'working') {
		activeClip.state = 'pending';
		activeClip.error = null;
	}
	speechQueue = [];
}

function release(page: PreparedPage) {
	droppedPages.add(page);
	speechQueue = speechQueue.filter((task) => task.page !== page);
	const urls = new Set<string>();
	if (page.audioUrl) urls.add(page.audioUrl);
	for (const clip of page.clips) {
		if (clip.audioUrl) urls.add(clip.audioUrl);
	}
	for (const url of urls) URL.revokeObjectURL(url);
}

function resetDocument() {
	abortPending();
	for (const job of jobs) settleReject(job, new DOMException('Skipped', 'AbortError'));
	jobs = [];
	for (const page of cache.values()) release(page);
	cache.clear();
	emit();
}

export function attachBook(id: string | null) {
	bookId = id;
}

export function attachDocument(next: PDFDocumentProxy | null) {
	pdf = next;
	textPages = null;
	resetDocument();
}

export function attachText(pages: string[] | null) {
	// Measuring the next spine file appends pages. Resetting here aborted the clip
	// that had just become ready, so the loader vanished and came straight back.
	if (extendsLaidPages(textPages, pages)) {
		textPages = pages;
		pdf = null;
		return;
	}
	textPages = pages;
	pdf = null;
	resetDocument();
}

/** Words for a text page that is already in memory, without waiting for speech. */
export function laidTextPage(index: number): PageText | null {
	if (!textPages || index < 0 || index >= textPages.length) return null;
	return wordsForPage(textPages[index] ?? '');
}

function remember(key: string, page: PreparedPage) {
	if (cache.has(key)) cache.delete(key);
	cache.set(key, page);
	while (cache.size > 8) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		const dropped = cache.get(oldest);
		if (dropped) release(dropped);
		cache.delete(oldest);
	}
}

function enqueue(index: number, settings: AppSettings, front: boolean): Promise<PreparedPage> {
	const key = cacheKey(index, settings);
	const hit = cache.get(key);
	if (hit) {
		if (front) bufferSpeech(hit, settings, 0, true);
		return Promise.resolve(hit);
	}
	const queued = jobs.find((job) => job.key === key);
	if (queued) {
		if (front) {
			queued.lead = true;
			jobs = [queued, ...jobs.filter((job) => job !== queued)];
		}
		return queued.promise;
	}
	if (activeKey === key && activePromise && activeJob && !activeJob.cancelled) return activePromise;
	let resolve: (page: PreparedPage) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<PreparedPage>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	promise.catch(() => {});
	const job: Job = { index, settings, key, lead: front, cancelled: false, settled: false, promise, resolve, reject };
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
				settleResolve(job, hit);
				emit();
				continue;
			}
			activeKey = job.key;
			activePromise = job.promise;
			activeJob = job;
			const signal = workAbort.signal;
			emit();
			try {
				const page = await doPrepare(job.index, job.settings, job.lead, signal);
				if (job.cancelled || signal.aborted) settleReject(job, new DOMException('Skipped', 'AbortError'));
				else {
					remember(job.key, page);
					settleResolve(job, page);
				}
			} catch (error) {
				settleReject(job, error);
			} finally {
				if (activeJob === job) activeJob = null;
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
	abortPending();
	const keep = new Set(wanted.map((index) => cacheKey(index, settings)));
	const kept: Job[] = [];
	for (const job of jobs) {
		if (keep.has(job.key)) kept.push(job);
		else settleReject(job, new DOMException('Skipped', 'AbortError'));
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

async function blobToBase64(blob: Blob) {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function emotionAt(clauses: Clause[], wordIndex: number): EmotionName {
	return clauses.find((clause) => wordIndex >= clause.wordStart && wordIndex < clause.wordEnd)?.emotion ?? 'neutral';
}

function makeClips(words: PageWord[], clauses: Clause[], pace: number): SpeechClip[] {
	const roles = words.map((word) => word.role);
	return splitSpeechWords(
		words.map((word) => word.text),
		pace,
		roles
	).map((span) => ({
		wordStart: span.wordStart,
		wordEnd: span.wordEnd,
		text: spokenClipText(words.slice(span.wordStart, span.wordEnd)),
		emotion: emotionAt(clauses, span.wordStart),
		audioUrl: null,
		timings: null,
		state: 'pending',
		error: null
	}));
}

function clipIdentity(settings: AppSettings, clip: SpeechClip): SpeechIdentity {
	const useSample = settings.tts.vendor === 'pocket' || settings.sendSample;
	return {
		text: clip.text,
		emotion: clip.emotion,
		vendor: settings.tts.vendor,
		baseUrl: settings.tts.baseUrl,
		model: settings.tts.model,
		voice: settings.tts.voice,
		sampleId: useSample ? settings.cloneBlobId : null
	};
}

function applyClipAudio(clip: SpeechClip, blob: Blob, timings: { start: number; end: number }[] | null) {
	clip.audioUrl = URL.createObjectURL(blob);
	clip.timings = timings
		? timings.map((word, index) => ({
				wordIndex: clip.wordStart + index,
				start: word.start,
				end: word.end
			}))
		: null;
	clip.state = 'ready';
}

async function speakClip(
	settings: AppSettings,
	clip: SpeechClip,
	pageNumber: number,
	which: number,
	total: number,
	signal: AbortSignal
) {
	const started = performance.now();
	const owner = bookId;
	const identity = clipIdentity(settings, clip);
	if (owner) {
		const id = await speechCacheId(owner, identity);
		const cached = await getSpeech(id).catch(() => undefined);
		if (signal.aborted) throw new DOMException('Skipped', 'AbortError');
		if (cached && cached.blob.size > 0) {
			applyClipAudio(clip, cached.blob, cached.timings);
			logPipeline({
				page: pageNumber,
				stage: 'tts',
				status: 'ok',
				ms: Math.round(performance.now() - started),
				detail: `Cached clip ${which}/${total}, ${cached.blob.size} bytes. No speak call.`
			});
			return;
		}
	}
	logPipeline({
		page: pageNumber,
		stage: 'tts',
		status: 'start',
		ms: null,
		detail: `POST /v1/speak clip ${which}/${total} (${clip.wordEnd - clip.wordStart} words) → ${settings.tts.vendor} ${hostOf(settings.tts.baseUrl)}`
	});
	const useSample = settings.tts.vendor === 'pocket' || settings.sendSample;
	const sample = useSample ? await voiceSample(settings) : undefined;
	if (signal.aborted) throw new DOMException('Skipped', 'AbortError');
	const sampleBase64 = sample ? await blobToBase64(sample) : null;
	const result = await speak(
		settings.tts,
		clip.text,
		clip.emotion,
		`${PROSODY[clip.emotion].instruction} Say: ${clip.text}`,
		sampleBase64,
		Boolean(sample),
		sample?.type || null,
		signal
	);
	if (signal.aborted) throw new DOMException('Skipped', 'AbortError');
	const timings = result.words?.map((word) => ({ start: word.start, end: word.end })) ?? null;
	applyClipAudio(clip, result.blob, timings);
	if (owner && result.blob.size > 0) {
		const id = await speechCacheId(owner, identity);
		await putSpeech({ id, bookId: owner, blob: result.blob, timings }).catch(() => undefined);
	}
	logPipeline({
		page: pageNumber,
		stage: 'tts',
		status: 'ok',
		ms: Math.round(performance.now() - started),
		detail: `${result.delivery} Clip ${which}/${total}, ${result.blob.size} bytes. ${clip.timings ? `${clip.timings.length} word times.` : 'No word times, so this clip highlights by length.'}`
	});
}

function clipsFrom(page: PreparedPage, fromWord: number): SpeechClip[] {
	const focus = Math.max(0, clipIndexForWord(page.clips, fromWord));
	const ordered = focus > 0 ? [...page.clips.slice(focus), ...page.clips.slice(0, focus)] : page.clips;
	return ordered.filter((clip) => clip.state === 'pending');
}

export function bufferSpeech(page: PreparedPage, settings: AppSettings, fromWord = 0, front = false) {
	if (settings.tts.vendor === 'browser' || page.clips.length === 0 || droppedPages.has(page)) return;
	const token = speechToken;
	const tasks = clipsFrom(page, fromWord).map((clip) => ({ page, clip, settings, token }));
	if (tasks.length === 0) return;
	const chosen = new Set(tasks.map((task) => task.clip));
	speechQueue = speechQueue.filter((task) => !chosen.has(task.clip));
	speechQueue = front ? [...tasks, ...speechQueue] : [...speechQueue, ...tasks];
	void pumpSpeech();
}

async function pumpSpeech() {
	if (speechPumping) return;
	speechPumping = true;
	try {
		while (speechQueue.length) {
			const task = speechQueue.shift();
			if (!task || task.token !== speechToken || droppedPages.has(task.page)) continue;
			if (task.clip.state !== 'pending') continue;
			const signal = workAbort.signal;
			task.clip.state = 'working';
			activeClip = task.clip;
			emit();
			try {
				await speakClip(
					task.settings,
					task.clip,
					task.page.pageIndex + 1,
					task.page.clips.indexOf(task.clip) + 1,
					task.page.clips.length,
					signal
				);
				if (signal.aborted || task.token !== speechToken) throw new DOMException('Skipped', 'AbortError');
				if (task.clip.wordStart === 0) task.page.audioUrl = task.clip.audioUrl;
			} catch (error) {
				if (signal.aborted || isAbort(error)) {
					if (task.clip.audioUrl && task.clip.state !== 'ready') {
						URL.revokeObjectURL(task.clip.audioUrl);
						task.clip.audioUrl = null;
						task.clip.timings = null;
					}
					if (task.clip.state === 'working') {
						task.clip.state = 'pending';
						task.clip.error = null;
					}
					logPipeline({
						page: task.page.pageIndex + 1,
						stage: 'tts',
						status: 'skip',
						ms: null,
						detail: 'Left the page. This line was aborted.'
					});
				} else {
					task.clip.state = 'error';
					task.clip.error = error instanceof Error ? error.message : 'Speech failed';
					task.page.note = task.clip.error;
					logPipeline({
						page: task.page.pageIndex + 1,
						stage: 'tts',
						status: 'error',
						ms: null,
						detail: `${task.clip.error} Playback uses the browser voice if no clip is ready.`
					});
				}
			} finally {
				if (activeClip === task.clip) activeClip = null;
			}
			emit();
		}
	} finally {
		speechPumping = false;
		if (speechQueue.length) void pumpSpeech();
	}
}

async function doPrepare(index: number, settings: AppSettings, lead: boolean, signal: AbortSignal): Promise<PreparedPage> {
	if (!pdf && !textPages) throw new Error('The book is not open.');
	const pageNumber = index + 1;
	const started = performance.now();
	if (textPages) {
		const laid = wordsForPage(textPages[index] ?? '');
		logPipeline({
			page: pageNumber,
			stage: 'text',
			status: 'ok',
			ms: Math.round(performance.now() - started),
			detail: `${laid.words.length} words from the text page. ${laid.text.slice(0, 700)}`
		});
		return assemble(index, { ...laid, source: 'text', confidence: null }, settings, lead, signal);
	}
	logPipeline({ page: pageNumber, stage: 'text', status: 'start', ms: null, detail: 'Reading the page' });
	if (!pdf) throw new Error('The book is not open.');
	const pdfPage = await pdf.getPage(pageNumber);
	let extracted;
	try {
		extracted = await readPage(pdfPage, settings.ocrLanguage || 'eng', pageNumber);
	} catch (error) {
		if (signal.aborted || isAbort(error)) throw new DOMException('Skipped', 'AbortError');
		const detail = error instanceof Error ? error.message : `OCR failed: ${String(error)}`;
		logPipeline({ page: pageNumber, stage: 'ocr', status: 'error', ms: Math.round(performance.now() - started), detail });
		return {
			pageIndex: index,
			source: 'ocr',
			words: [],
			text: '',
			clauses: [],
			clips: [],
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

	return assemble(index, extracted, settings, lead, signal);
}

function assemble(
	index: number,
	extracted: { words: PageWord[]; text: string; source: 'text' | 'ocr'; confidence: number | null },
	settings: AppSettings,
	lead: boolean,
	signal: AbortSignal
): PreparedPage {
	const pageNumber = index + 1;
	const pace = speechPace(settings.speechPace);
	const clauses = oneClause(extracted.words, extracted.text, settings.emotion === 'auto' ? 'neutral' : canonEmotion(settings.emotion));
	const clips = extracted.text ? makeClips(extracted.words, clauses, pace) : [];
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
		logPipeline({
			page: pageNumber,
			stage: 'tts',
			status: 'start',
			ms: null,
			detail: `${clips.length} clips at a pace of ${pace} words, split on full stops. ${extracted.words.filter((word) => word.role === 'heading').length} chapter-title words are spoken apart from the prose. The open page is spoken first, then the rest of the page buffer.`
		});
	}

	const readyCount = bufferReadyCount(index, settings);
	logPipeline({
		page: pageNumber,
		stage: 'buffer',
		status: 'ok',
		ms: null,
			detail: `Page ${pageNumber} is ready. Lookahead is ${settings.lookahead} pages. ${readyCount}`
	});

	if (signal.aborted) throw new DOMException('Skipped', 'AbortError');
	const page: PreparedPage = {
		pageIndex: index,
		source: extracted.source,
		words: extracted.words,
		text: extracted.text,
		clauses,
		clips,
		audioUrl: null,
		timings: null,
		confidence: extracted.confidence,
		note
	};
	if (settings.tts.vendor !== 'browser') bufferSpeech(page, settings, 0, lead);
	void applyEmotion(page, settings, signal);
	return page;
}

function applyEmotion(page: PreparedPage, settings: AppSettings, signal: AbortSignal) {
	const pageNumber = page.pageIndex + 1;
	const endpoint = settings.emotion === 'auto' ? emotionEndpoint(settings) : null;
	if (settings.emotion !== 'auto') {
		logPipeline({
			page: pageNumber,
			stage: 'emotion',
			status: 'skip',
			ms: 0,
			detail: `Emotion is set to ${settings.emotion}. No model call. ${PROSODY[canonEmotion(settings.emotion)].instruction}`
		});
		return Promise.resolve();
	}
	if (!endpoint) {
		logPipeline({
			page: pageNumber,
			stage: 'emotion',
			status: 'skip',
			ms: 0,
			detail: 'Emotion analysis and VLLM are off. The page stays neutral until you pick an emotion or enable a model in Settings.'
		});
		return Promise.resolve();
	}
	if (!page.text) {
		logPipeline({ page: pageNumber, stage: 'emotion', status: 'skip', ms: 0, detail: 'No words to mark.' });
		return Promise.resolve();
	}
	if (signal.aborted || droppedPages.has(page)) return Promise.resolve();
	const emotionStarted = performance.now();
	logPipeline({
		page: pageNumber,
		stage: 'emotion',
		status: 'start',
		ms: null,
		detail: `POST /v1/complete → ${hostOf(endpoint.baseUrl)} model ${endpoint.model || '(empty)'}`
	});
	return complete(
		endpoint,
		'You mark emotions for a text-to-speech reader. Reply with JSON only: {"clauses":[{"text":"...","emotion":"neutral"}]} . Emotions: neutral, calm, warm, tense, somber, excited, whispered, angry. Keep every word in order. Do not add, drop, or replace words. Split at sentence boundaries.',
		page.text.slice(0, 12000),
		signal
	)
		.then((content) => {
			if (signal.aborted || droppedPages.has(page)) return;
			const parsed = parseEmotionJson(content);
			const aligned = parsed ? alignClauses(page.words, parsed) : null;
			if (!aligned) {
				logPipeline({
					page: pageNumber,
					stage: 'emotion',
					status: 'error',
					ms: Math.round(performance.now() - emotionStarted),
					detail: `The model JSON did not match the page words. Speaking the page as neutral. ${content.slice(0, 700)}`
				});
				return;
			}
			page.clauses = aligned;
			for (const clip of page.clips) {
				if (clip.state !== 'pending') continue;
				clip.emotion = emotionAt(page.clauses, clip.wordStart);
			}
			logPipeline({
				page: pageNumber,
				stage: 'emotion',
				status: 'ok',
				ms: Math.round(performance.now() - emotionStarted),
				detail: aligned.map((clause) => `${clause.emotion}: ${clause.text}`).join(' | ').slice(0, 1200)
			});
			emit();
		})
		.catch((error) => {
			if (signal.aborted || isAbort(error)) return;
			logPipeline({
				page: pageNumber,
				stage: 'emotion',
				status: 'error',
				ms: Math.round(performance.now() - emotionStarted),
				detail: error instanceof Error ? error.message : 'Emotion request failed'
			});
		});
}

function bufferReadyCount(index: number, settings: AppSettings) {
	const key = cacheKey(index, settings);
	return cache.has(key) ? 'Cached.' : 'Fresh.';
}
