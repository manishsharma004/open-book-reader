<script lang="ts">
	import { page } from '$app/state';
	import ChapterNav from '#lib/components/chapter-nav.svelte';
	import PipelinePanel from '#lib/components/pipeline-panel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { activeTrail, chaptersFromDocument, chaptersFromOutline, chaptersFromText } from '#lib/chapters.js';
	import { getBlob, getBook, updateBook, type Book } from '#lib/db.js';
	import { openPdf, type PageWord } from '#lib/pdf.js';
	import { paginateText } from '#lib/text-book.js';
	import { logPipeline, pipeline } from '#lib/pipeline.svelte.js';
	import {
		attachDocument,
		attachText,
		bufferSnapshot,
		bufferSpeech,
		cachedPage,
		ensurePage,
		onBuffer,
		warm,
		type PreparedPage,
		type SpeechClip
	} from '#lib/prepare.js';
	import { commitSettings, removeVoiceSample, setPalette, setTheme, settingsState } from '#lib/settings-store.svelte.js';
	import { EMOTIONS, type EmotionChoice } from '#lib/settings.js';
	import { elapsedBefore, indexAt, indexForTimings, timeForWord, wordDurations } from '#lib/highlight.js';
	import { companionPage, spreadActive, turnTarget } from '#lib/spread.js';
	import { clipIndexForWord, speechPace, wordBackdrop } from '#lib/speech-clips.js';
	import { browserDelivery, cancelSpeech, createUtterance, listVoices, speak, voiceByName, watchVoices } from '#lib/speech.js';
	import type { Palette } from '#lib/theme.js';
	import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
	import { onDestroy } from 'svelte';

	let book = $state<Book | null>(null);
	let error = $state('');
	let voiceNote = $state('');
	let sampleNote = $state('');
	let pageIndex = $state(0);
	let scrub = $state<number | null>(null);
	let pageDraft = $state('1');
	let editingPage = $state(false);
	let words = $state<PageWord[]>([]);
	// The buffer fills clip audio on this same object after it is stored. A deep
	// $state proxy would keep the empty URLs from the moment the page was assigned.
	let prepared = $state.raw<PreparedPage | null>(null);
	let activeWord = $state(-1);
	let playing = $state(false);
	let carryPage = -1;
	let rate = $state(1);
	let buffering = $state(false);
	let viewport = $state<PageViewport | null>(null);
	let pdfToken = $state(0);
	let bufferTick = $state(0);
	let voices = $state<SpeechSynthesisVoice[]>([]);
	let paintedSize = '';

	let stage = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let canvasRight = $state<HTMLCanvasElement | null>(null);
	let facingWanted = $state(false);
	let stageWidth = $state(0);
	let stageHeight = $state(0);
	let companionWords = $state<PageWord[]>([]);
	let pageSheet = $state<HTMLDivElement | null>(null);
	let pageField = $state<HTMLInputElement | null>(null);
	let dragX = $state(0);
	let dragAnimate = $state(false);
	let pageOpacity = $state(1);
	let deckA = $state<HTMLAudioElement | null>(null);
	let deckB = $state<HTMLAudioElement | null>(null);
	let audio = $state<HTMLAudioElement | null>(null);
	let waitingClip = $state(-1);
	let playingClip = -1;
	let heldClip = -1;
	let pdf: PDFDocumentProxy | null = null;
	let viewGen = 0;
	let paintGen = 0;
	let paintTail: Promise<unknown> = Promise.resolve();
	let playToken = 0;
	let resumeWord = 0;
	let heldAudioTime: number | null = null;
	let clockFrame = 0;
	let clockRunning = false;
	let turnLock = false;
	let turnToken = 0;
	let turnTimer = 0;
	let swallowUntil = 0;
	let gesture: { id: number; x: number; y: number; moved: boolean } | null = null;
	let clockOrigin = 0;
	let clockBase = 0;
	let clockDurations: number[] = [];
	let clockStart = 0;

	const id = $derived(page.params.id ?? '');
	const settings = $derived(settingsState.current);
	const shownPage = $derived(scrub ?? pageIndex);
	const chapters = $derived(book?.chapters ?? []);
	const chapterTrail = $derived(activeTrail(chapters, shownPage));
	const spreadOn = $derived(spreadActive(facingWanted, stageWidth, stageHeight, book?.pageCount ?? 0));
	const companionIndex = $derived(companionPage(pageIndex, book?.pageCount ?? 0, spreadOn));
	const facingMode = $derived(spreadOn ? 'on' : facingWanted ? 'waiting' : 'off');
	let outlineOpen = $state(true);
	const field = 'border-input bg-background h-8 rounded-lg border px-2 text-sm';

	$effect(() => {
		const display = String(shownPage + 1);
		if (!editingPage) pageDraft = display;
	});

	const speechLoading = $derived.by(() => {
		bufferTick;
		if (!prepared || !settings || settings.tts.vendor === 'browser') return false;
		return prepared.clips.some((clip) => !clip.audioUrl && clip.state !== 'error');
	});

	const speechReadyLabel = $derived.by(() => {
		bufferTick;
		if (!prepared?.clips.length) return '';
		const ready = prepared.clips.filter((clip) => clip.audioUrl).length;
		return `${ready} of ${prepared.clips.length} lines ready`;
	});

	const readyWords = $derived.by(() => {
		bufferTick;
		const flags: boolean[] = [];
		for (const clip of prepared?.clips ?? []) {
			if (!clip.audioUrl) continue;
			for (let index = clip.wordStart; index < clip.wordEnd; index += 1) flags[index] = true;
		}
		return flags;
	});

	const bufferLabel = $derived.by(() => {
		bufferTick;
		if (!settings || !book) return '';
		const pages = bufferSnapshot(pageIndex, book.pageCount, settings);
		const ready = pages.filter((item) => item.state === 'ready').length;
		const working = pages.find((item) => item.state === 'working');
		const workingLabel = working ? `, reading ${working.index + 1}` : '';
		return `Buffer ${ready}/${pages.length}${workingLabel}`;
	});

	function stopClock() {
		clockRunning = false;
		cancelAnimationFrame(clockFrame);
	}

	function clockWord(now = performance.now()) {
		const elapsed = clockBase + (clockRunning ? now - clockOrigin : 0);
		const local = indexAt(clockDurations, elapsed);
		return clockStart + (local < 0 ? 0 : local);
	}

	function tickClock() {
		if (!clockRunning) return;
		const word = clockWord();
		activeWord = word;
		resumeWord = word;
		clockFrame = requestAnimationFrame(tickClock);
	}

	function startClock(durations: number[], wordStart: number) {
		stopClock();
		clockDurations = durations;
		clockStart = wordStart;
		clockBase = 0;
		clockOrigin = performance.now();
		clockRunning = true;
		activeWord = wordStart;
		resumeWord = wordStart;
		tickClock();
	}

	function pauseClock() {
		if (!clockRunning) return;
		clockBase += performance.now() - clockOrigin;
		clockRunning = false;
		cancelAnimationFrame(clockFrame);
		const word = clockWord();
		activeWord = word;
		resumeWord = word;
	}

	function decks() {
		return [deckA, deckB].filter((node): node is HTMLAudioElement => node != null);
	}

	function arm(node: HTMLAudioElement | null, url: string | null | undefined) {
		if (!node || !url || node.dataset.armed === url) return;
		node.dataset.armed = url;
		node.preload = 'auto';
		node.src = url;
		node.load();
	}

	function takePlayer(url: string) {
		if (audio?.dataset.armed === url) return audio;
		const idle = decks().filter((node) => node !== audio);
		const ready = idle.find((node) => node.dataset.armed === url && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
		if (ready) return ready;
		const loading = idle.find((node) => node.dataset.armed === url);
		if (loading) return loading;
		const fresh = idle[0] ?? audio;
		arm(fresh, url);
		return fresh;
	}

	function halt() {
		playToken += 1;
		stopClock();
		cancelSpeech();
		for (const node of decks()) node.pause();
		heldAudioTime = null;
		heldClip = -1;
		playingClip = -1;
		waitingClip = -1;
		resumeWord = 0;
		activeWord = -1;
		playing = false;
		voiceNote = '';
	}

	onDestroy(() => {
		halt();
		window.clearTimeout(turnTimer);
		attachDocument(null);
		void pdf?.cleanup();
	});

	$effect(() => {
		return onBuffer(() => {
			bufferTick += 1;
		});
	});

	$effect(() => {
		const speed = rate;
		if (audio) audio.playbackRate = speed;
	});

	function upcomingUrl(index: number) {
		const page = prepared;
		const same = index >= 0 ? page?.clips[index + 1]?.audioUrl : null;
		if (same) return same;
		if (!page || !settings || !book || index < 0 || index !== page.clips.length - 1) return null;
		if (pageIndex >= book.pageCount - 1) return null;
		const next = cachedPage(pageIndex + 1, settings);
		return next?.clips.find((clip) => clip.audioUrl)?.audioUrl ?? null;
	}

	$effect(() => {
		bufferTick;
		const index = playingClip;
		const url = upcomingUrl(index);
		if (!url) return;
		arm(decks().find((node) => node !== audio) ?? null, url);
	});

	$effect(() => {
		bufferTick;
		const index = waitingClip;
		const page = prepared;
		const clip = index >= 0 ? page?.clips[index] : undefined;
		if (!clip || !playing) return;
		if (clip.state === 'error') {
			waitingClip = -1;
			playing = false;
			voiceNote = clip.error || 'Speech failed for that line.';
			return;
		}
		if (!clip.audioUrl) return;
		const token = playToken;
		playClip(index, clip.wordStart, token, null);
	});

	let restoredFacing = false;
	$effect(() => {
		if (restoredFacing || typeof sessionStorage === 'undefined') return;
		restoredFacing = true;
		if (sessionStorage.getItem('open-book-facing') === '1') facingWanted = true;
	});

	$effect(() => {
		const index = companionIndex;
		const kind = book?.kind;
		const current = settings;
		if (index < 0 || kind !== 'text' || !current) {
			companionWords = [];
			return;
		}
		let cancelled = false;
		void ensurePage(index, current).then((page) => {
			if (!cancelled && page.pageIndex === index) companionWords = page.words;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const node = stage;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			stageWidth = node.clientWidth;
			stageHeight = node.clientHeight;
			void paint();
		});
		observer.observe(node);
		stageWidth = node.clientWidth;
		stageHeight = node.clientHeight;
		void paint();
		return () => observer.disconnect();
	});

	$effect(() => {
		canvasRight;
		companionIndex;
		if (book?.kind === 'text') return;
		void paint();
	});

	$effect(() => {
		return watchVoices(() => {
			voices = listVoices();
		});
	});

	$effect(() => {
		const bookId = id;
		let cancelled = false;
		halt();
		buffering = true;
		(async () => {
			const found = await getBook(bookId);
			if (cancelled) return;
			if (!found) {
				buffering = false;
				error = 'That book is not in this browser.';
				return;
			}
			book = found;
			const blob = await getBlob(found.blobId);
			if (cancelled) return;
			if (!blob) {
				buffering = false;
				error = 'That book is not in this browser.';
				return;
			}
			void pdf?.cleanup();
			pdf = null;
			if (found.kind === 'text') {
				const pages = paginateText(await blob.text());
				attachText(pages);
				if (found.chapters == null) void rememberChapters(found, chaptersFromText(pages));
			} else {
				pdf = await openPdf(await blob.arrayBuffer());
				if (cancelled) return;
				attachDocument(pdf);
				const document = pdf;
				const tree = await chaptersFromOutline(document).catch(() => null);
				if (cancelled) return;
				if (tree) await rememberChapters(found, tree);
				else if (found.chapters == null) {
					const list = await chaptersFromDocument(document).catch(() => []);
					if (!cancelled) await rememberChapters(found, list);
				}
			}
			pageIndex = 0;
			pdfToken += 1;
		})().catch((caught) => {
			buffering = false;
			error = caught instanceof Error ? caught.message : 'Could not open the book.';
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const token = pdfToken;
		const index = pageIndex;
		const revision = settingsState.revision;
		const currentSettings = settingsState.current;
		const pageCount = book?.pageCount ?? 0;
		if (!token || !currentSettings || !pageCount) return;
		const gen = ++viewGen;
		let cancelled = false;
		const resumeHere = carryPage === index;
		if (!resumeHere) carryPage = -1;
		halt();
		activeWord = -1;
		const timer = setTimeout(() => {
			if (!cancelled && gen === viewGen) buffering = true;
		}, 120);
		warm(index, pageCount, currentSettings);
		void ensurePage(index, currentSettings)
			.then(async (page) => {
				clearTimeout(timer);
				if (cancelled || gen !== viewGen) return;
				prepared = page;
				words = page.words;
				buffering = false;
				bufferTick += 1;
				await paint();
				if (cancelled || gen !== viewGen) return;
				const speakable = page.clips.length > 0 || page.words.some((word) => word.role !== 'header');
				if (resumeHere && !speakable && index < pageCount - 1) {
					carryPage = index + 1;
					jump(index + 1);
					return;
				}
				if (resumeHere || (currentSettings.tts.vendor !== 'browser' && page.clips.length > 0)) playFrom(0);
			})
			.catch((caught) => {
				if (caught instanceof DOMException && caught.name === 'AbortError') return;
				if (cancelled || gen !== viewGen) return;
				buffering = false;
				error = caught instanceof Error ? caught.message : 'Could not prepare this page.';
			});
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

	function wordBox(word: PageWord) {
		if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
		const [x, y] = viewport.convertToViewportPoint(word.x, word.y);
		const height = word.h * viewport.scale;
		return { left: x, top: y - height, width: word.w * viewport.scale, height };
	}

	async function drawPdfPage(target: HTMLCanvasElement, pageNumber: number, slotWidth: number, slotHeight: number) {
		if (!pdf) return null;
		const pdfPage = await pdf.getPage(pageNumber);
		const base = pdfPage.getViewport({ scale: 1 });
		const scale = Math.min(slotWidth / base.width, slotHeight / base.height);
		if (!Number.isFinite(scale) || scale <= 0) return null;
		const next = pdfPage.getViewport({ scale });
		const outputScale = Math.min(window.devicePixelRatio || 1, 2);
		target.width = Math.floor(next.width * outputScale);
		target.height = Math.floor(next.height * outputScale);
		target.style.width = `${next.width}px`;
		target.style.height = `${next.height}px`;
		const canvasContext = target.getContext('2d');
		if (!canvasContext) return null;
		canvasContext.setTransform(outputScale, 0, 0, outputScale, 0, 0);
		await pdfPage.render({ canvas: target, canvasContext, viewport: next }).promise;
		return next;
	}

	function paint() {
		const run = paintTail.then(() => drawSpread());
		paintTail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async function drawSpread() {
		const gen = ++paintGen;
		if (book?.kind === 'text') return;
		if (!pdf || !canvas || !stage || !prepared) return;
		const width = stage.clientWidth;
		const height = stage.clientHeight;
		if (width < 40 || height < 40) return;
		const rightIndex = companionIndex;
		if (rightIndex >= 0 && !canvasRight) return;
		const sizeKey = `${prepared.pageIndex}:${rightIndex}:${Math.round(width)}x${Math.round(height)}`;
		if (sizeKey === paintedSize) return;
		const gap = rightIndex >= 0 ? 16 : 0;
		const slotWidth = rightIndex >= 0 ? (width - 24 - gap) / 2 : width - 24;
		const slotHeight = height - 24;
		if (slotWidth < 40) return;
		const next = await drawPdfPage(canvas, prepared.pageIndex + 1, slotWidth, slotHeight);
		if (gen !== paintGen || !next) return;
		if (rightIndex >= 0 && canvasRight) {
			const drawn = await drawPdfPage(canvasRight, rightIndex + 1, slotWidth, slotHeight);
			if (gen !== paintGen || !drawn) return;
		}
		paintedSize = sizeKey;
		viewport = next;
	}

	function setFacing(next: boolean) {
		facingWanted = next;
		paintedSize = '';
		if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('open-book-facing', next ? '1' : '0');
		void paint();
	}

	function leafTarget(direction: 1 | -1) {
		if (!book) return pageIndex;
		return turnTarget(pageIndex, book.pageCount, direction, spreadOn);
	}

	async function rememberChapters(source: Book, list: Book['chapters']) {
		const next = { ...source, chapters: list ?? [] };
		await updateBook(next);
		if (book?.id === next.id) book = { ...book, chapters: next.chapters };
	}

	function jump(next: number) {
		if (!book) return;
		scrub = null;
		pageIndex = Math.min(book.pageCount - 1, Math.max(0, next));
	}

	function goToPage(event?: Event) {
		event?.preventDefault();
		if (!book) return;
		const parsed = Number.parseInt(String(pageDraft ?? '').trim(), 10);
		editingPage = false;
		if (!Number.isInteger(parsed)) {
			pageDraft = String(pageIndex + 1);
			return;
		}
		const target = Math.min(book.pageCount, Math.max(1, parsed));
		pageDraft = String(target);
		jump(target - 1);
	}

	function motionReduced() {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	function settleSheet() {
		dragAnimate = true;
		dragX = 0;
		pageOpacity = 1;
	}

	function playTurn(direction: 1 | -1) {
		if (!book || !stage) return;
		const target = leafTarget(direction);
		if (target === pageIndex) return;
		if (motionReduced()) {
			dragAnimate = false;
			dragX = 0;
			pageOpacity = 1;
			turnLock = false;
			jump(target);
			return;
		}
		const width = Math.max(stage.clientWidth, 1);
		const token = ++turnToken;
		let finished = false;
		turnLock = true;
		dragAnimate = true;
		pageOpacity = 1;
		dragX = direction > 0 ? -width : width;
		const finish = () => {
			if (finished || token !== turnToken) return;
			finished = true;
			pageSheet?.removeEventListener('transitionend', onEnd);
			window.clearTimeout(turnTimer);
			dragAnimate = false;
			pageOpacity = 0;
			const enter = Math.min(width * 0.22, 120);
			dragX = direction > 0 ? enter : -enter;
			jump(target);
			turnLock = false;
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					if (token !== turnToken) return;
					dragAnimate = true;
					pageOpacity = 1;
					dragX = 0;
				});
			});
		};
		const onEnd = (event: TransitionEvent) => {
			if (event.propertyName !== 'transform') return;
			finish();
		};
		pageSheet?.addEventListener('transitionend', onEnd);
		turnTimer = window.setTimeout(finish, 420);
	}

	function onPagePointerDown(event: PointerEvent) {
		if (turnLock || event.button !== 0 || !book) return;
		gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
	}

	function onPagePointerMove(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.id || !book || !stage) return;
		const dx = event.clientX - gesture.x;
		const dy = event.clientY - gesture.y;
		if (!gesture.moved) {
			if (Math.hypot(dx, dy) < 12) return;
			if (Math.abs(dy) > Math.abs(dx)) {
				gesture = null;
				return;
			}
			gesture.moved = true;
			dragAnimate = false;
			pageOpacity = 1;
			try {
				stage.setPointerCapture(event.pointerId);
			} catch {
				// The pointer can already be gone. The move still updates the page.
			}
		}
		event.preventDefault();
		const atStart = leafTarget(-1) === pageIndex && dx > 0;
		const atEnd = leafTarget(1) === pageIndex && dx < 0;
		dragX = atStart || atEnd ? dx * 0.2 : dx;
	}

	function onPagePointerUp(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.id || !book || !stage) return;
		const dx = event.clientX - gesture.x;
		const moved = gesture.moved;
		gesture = null;
		if (moved) swallowUntil = performance.now() + 250;
		if (!moved) return;
		const passed = Math.abs(dx) > Math.min(88, stage.clientWidth * 0.2);
		if (passed && dx < 0 && leafTarget(1) !== pageIndex) playTurn(1);
		else if (passed && dx > 0 && leafTarget(-1) !== pageIndex) playTurn(-1);
		else settleSheet();
	}

	function onPagePointerCancel(event: PointerEvent) {
		if (!gesture || event.pointerId !== gesture.id) return;
		gesture = null;
		settleSheet();
	}

	function onPageClickCapture(event: MouseEvent) {
		if (performance.now() > swallowUntil) return;
		swallowUntil = 0;
		event.preventDefault();
		event.stopPropagation();
	}

	function onReaderKey(event: KeyboardEvent) {
		if (event.key !== 'g' && event.key !== 'G') return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const target = event.target;
		if (target instanceof HTMLElement) {
			const tag = target.tagName;
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
		}
		event.preventDefault();
		editingPage = true;
		pageField?.focus();
		pageField?.select();
	}

	function wordAtChar(list: PageWord[], charIndex: number) {
		let cursor = 0;
		for (let index = 0; index < list.length; index += 1) {
			const end = cursor + list[index].text.length;
			if (charIndex >= cursor && charIndex <= end) return index;
			cursor = end + 1;
		}
		return list.length > 0 ? list.length - 1 : -1;
	}

	function finishPlayback() {
		stopClock();
		playing = false;
		activeWord = -1;
		resumeWord = 0;
		heldAudioTime = null;
		heldClip = -1;
	}

	function finishPage(token: number) {
		if (token !== playToken) return;
		if (book && pageIndex < book.pageCount - 1) {
			carryPage = pageIndex + 1;
			jump(pageIndex + 1);
			return;
		}
		finishPlayback();
	}

	function playBrowser(fromWord: number, token: number) {
		if (!prepared || !settings) return;
		const clips = prepared.clips.filter((clip) => clip.wordEnd > fromWord);
		let cursor = 0;
		const speakNext = () => {
			if (token !== playToken) return;
			if (cursor >= clips.length) {
				finishPage(token);
				return;
			}
			const clip = clips[cursor];
			cursor += 1;
			const start = Math.max(fromWord, clip.wordStart);
			const slice = words.slice(start, clip.wordEnd);
			const spoken = start === clip.wordStart ? clip.text : slice.map((word) => word.text).join(' ');
			if (!spoken) {
				speakNext();
				return;
			}
			const delivery = browserDelivery(clip.emotion, rate);
			let utterance: SpeechSynthesisUtterance;
			try {
				utterance = createUtterance(spoken);
			} catch (caught) {
				playing = false;
				activeWord = -1;
				voiceNote = caught instanceof Error ? caught.message : 'Could not start the browser voice.';
				return;
			}
			utterance.rate = delivery.rate;
			utterance.pitch = delivery.pitch;
			utterance.volume = delivery.volume;
			const voice = voiceByName(settings.voiceName);
			if (voice) utterance.voice = voice;
			const durations = wordDurations(slice.map((word) => word.text), delivery.rate);
			let started = false;
			const begin = () => {
				if (started || token !== playToken) return;
				started = true;
				startClock(durations, start);
			};
			utterance.onstart = begin;
			utterance.onboundary = (event) => {
				if (token !== playToken || (event.name && event.name !== 'word')) return;
				const local = wordAtChar(slice, event.charIndex);
				if (local < 0) return;
				begin();
				clockBase = elapsedBefore(durations, local);
				clockOrigin = performance.now();
				activeWord = start + local;
				resumeWord = activeWord;
			};
			utterance.onend = () => {
				if (token !== playToken) return;
				stopClock();
				speakNext();
			};
			utterance.onerror = (event) => {
				if (token !== playToken) return;
				if (event.error === 'interrupted' || event.error === 'canceled') return;
				stopClock();
				playing = false;
				error = `Voice stopped: ${event.error}`;
			};
			activeWord = start;
			resumeWord = start;
			playing = true;
			if (cursor === 1) {
				logPipeline({
					page: pageIndex + 1,
					stage: 'play',
					status: 'ok',
					ms: null,
					detail: `${delivery.detail} Voice ${voice?.name ?? 'browser default'}. From word ${start + 1}.`
				});
			}
			window.setTimeout(() => {
				if (token !== playToken) return;
				try {
					speak(utterance);
				} catch (caught) {
					if (token !== playToken) return;
					stopClock();
					playing = false;
					activeWord = -1;
					voiceNote = caught instanceof Error ? caught.message : 'Could not start the browser voice.';
					return;
				}
				window.setTimeout(begin, 250);
			}, 40);
		};
		speakNext();
	}

	function placeInClip(clip: SpeechClip, fromWord: number, continueTime: number | null) {
		if (!audio) return;
		if (continueTime != null) {
			audio.currentTime = continueTime;
			return;
		}
		const local = fromWord - clip.wordStart;
		if (local <= 0) {
			if (audio.currentTime > 0) audio.currentTime = 0;
			return;
		}
		const timing = clip.timings?.find((item) => item.wordIndex >= fromWord);
		if (timing) {
			audio.currentTime = timing.start;
			return;
		}
		if (Number.isFinite(audio.duration) && audio.duration > 0) {
			const texts = words.slice(clip.wordStart, clip.wordEnd).map((word) => word.text);
			audio.currentTime = timeForWord(texts, local, audio.duration, audio.playbackRate || rate);
		}
	}

	function followClip(token: number, clip: SpeechClip) {
		const step = () => {
			if (token !== playToken || !audio || !prepared) return;
			if (clip.timings?.length) {
				const hit = indexForTimings(clip.timings, audio.currentTime);
				if (hit >= 0) {
					activeWord = hit;
					resumeWord = hit;
				}
			} else if (Number.isFinite(audio.duration) && audio.duration > 0) {
				const texts = words.slice(clip.wordStart, clip.wordEnd).map((word) => word.text);
				const durations = wordDurations(texts, audio.playbackRate || rate);
				const total = durations.reduce((sum, item) => sum + item, 0) || 1;
				const elapsed = (audio.currentTime / audio.duration) * total;
				const local = indexAt(durations, elapsed);
				if (local >= 0) {
					activeWord = clip.wordStart + local;
					resumeWord = activeWord;
				}
			}
			if (!audio.paused && !audio.ended) clockFrame = requestAnimationFrame(step);
		};
		clockRunning = true;
		clockFrame = requestAnimationFrame(step);
	}

	function playClip(index: number, fromWord: number, token: number, continueTime: number | null) {
		if (!prepared || !settings || decks().length === 0) return;
		const clip = prepared.clips[index];
		if (!clip) {
			finishPlayback();
			return;
		}
		if (clip.state === 'error' || (!clip.audioUrl && clip.state !== 'pending' && clip.state !== 'working')) {
			waitingClip = -1;
			playing = false;
			voiceNote = clip.error || prepared.note || 'Speech failed for that line.';
			return;
		}
		if (!clip.audioUrl) {
			waitingClip = index;
			playingClip = index;
			activeWord = Math.max(fromWord, clip.wordStart);
			resumeWord = activeWord;
			playing = true;
			bufferSpeech(prepared, settings, clip.wordStart, true);
			return;
		}
		waitingClip = -1;
		playingClip = index;
		bufferSpeech(prepared, settings, clip.wordStart, true);
		const player = takePlayer(clip.audioUrl);
		if (!player) return;
		if (audio && audio !== player) audio.pause();
		audio = player;
		arm(decks().find((node) => node !== player) ?? null, upcomingUrl(index));
		player.playbackRate = rate;
		const apply = () => {
			if (token !== playToken) return;
			placeInClip(clip, fromWord, continueTime);
		};
		if (player.readyState >= 1) apply();
		else player.onloadedmetadata = apply;
		player.onended = () => {
			if (token !== playToken) return;
			stopClock();
			const following = index + 1;
			if (!prepared || following >= prepared.clips.length) {
				finishPage(token);
				return;
			}
			playClip(following, prepared.clips[following].wordStart, token, null);
		};
		playing = true;
		logPipeline({
			page: pageIndex + 1,
			stage: 'play',
			status: 'ok',
			ms: null,
			detail: `Playing line ${index + 1} of ${prepared.clips.length} at ${rate.toFixed(1)}×. From word ${fromWord + 1}.`
		});
		void player.play().then(() => {
			if (token !== playToken) return;
			followClip(token, clip);
		}).catch((caught) => {
			if (token !== playToken) return;
			playing = false;
			const blocked = caught instanceof DOMException && caught.name === 'NotAllowedError';
			if (blocked) {
				voiceNote = 'Press Play to start.';
				return;
			}
			voiceNote = caught instanceof Error ? caught.message : 'Could not play the audio.';
		});
	}

	async function playFrom(fromWord: number, options?: { seek?: boolean }) {
		if (!prepared || buffering || !settings) return;
		const seek = options?.seek === true;
		const clipIndex = clipIndexForWord(prepared.clips, fromWord);
		const continueTime = !seek && heldClip === clipIndex && heldAudioTime != null ? heldAudioTime : null;
		heldAudioTime = null;
		heldClip = -1;
		resumeWord = fromWord;
		voiceNote = '';
		const token = ++playToken;
		stopClock();
		cancelSpeech();
		activeWord = fromWord;
		const clip = clipIndex >= 0 ? prepared.clips[clipIndex] : undefined;
		if (settings.tts.vendor !== 'browser' && clip && (clip.audioUrl || clip.state !== 'error')) {
			playClip(clipIndex, fromWord, token, continueTime);
			return;
		}
		for (const node of decks()) node.pause();
		playBrowser(fromWord, token);
	}

	function pausePlayback() {
		if (playingClip >= 0 && audio && !audio.paused) {
			heldAudioTime = audio.currentTime;
			heldClip = playingClip;
			if (activeWord >= 0) resumeWord = activeWord;
			audio.pause();
		} else if (clockRunning) {
			pauseClock();
		} else if (activeWord >= 0) {
			resumeWord = activeWord;
		}
		playToken += 1;
		waitingClip = -1;
		stopClock();
		cancelSpeech();
		playing = false;
	}

	function toggle() {
		if (playing) {
			pausePlayback();
			return;
		}
		void playFrom(resumeWord);
	}

	async function removeSample() {
		await removeVoiceSample();
		voiceNote = '';
		sampleNote = 'Sample removed. Later speech uses the voice id.';
	}

	async function onPace(event: Event) {
		if (!settings) return;
		settings.speechPace = speechPace((event.currentTarget as HTMLInputElement).value);
		await commitSettings();
	}

	async function onEmotion(event: Event) {
		if (!settings) return;
		settings.emotion = (event.currentTarget as HTMLSelectElement).value as EmotionChoice;
		await commitSettings();
	}

	async function onVoice(event: Event) {
		if (!settings) return;
		settings.voiceName = (event.currentTarget as HTMLSelectElement).value;
		await commitSettings();
	}

	async function onVendorVoice(event: Event) {
		if (!settings) return;
		settings.tts.voice = (event.currentTarget as HTMLInputElement).value;
		await commitSettings();
	}
</script>

<svelte:head>
	<title>{book?.title ?? 'Reader'}</title>
</svelte:head>

<svelte:window onkeydown={onReaderKey} />

<div class="flex h-dvh min-h-0 flex-col overflow-hidden">
	<header class="border-border flex h-14 shrink-0 items-center gap-2 border-b px-3">
		<Button href="/" variant="ghost" size="sm">Library</Button>
		{#if chapters.length > 0}
			<Button variant={outlineOpen ? 'secondary' : 'outline'} size="sm" aria-pressed={outlineOpen} onclick={() => (outlineOpen = !outlineOpen)}>
				Chapters
			</Button>
		{/if}
		<p class="min-w-0 flex-1 truncate text-sm font-medium">{book?.title ?? 'Opening…'}</p>
		{#if chapterTrail.length}
			<span class="text-muted-foreground hidden max-w-48 truncate text-xs sm:inline" data-chapter={chapterTrail[chapterTrail.length - 1]?.title ?? ''}>
				{chapterTrail[chapterTrail.length - 1]?.title}
			</span>
		{/if}
		<span
			class="text-muted-foreground text-sm tabular-nums"
			data-current-page={book ? shownPage + 1 : ''}
			data-companion-page={companionIndex >= 0 ? companionIndex + 1 : ''}
		>
			{book ? (companionIndex >= 0 ? `${shownPage + 1}–${companionIndex + 1} / ${book.pageCount}` : `${shownPage + 1} / ${book.pageCount}`) : ''}
		</span>
		<select
			class={field}
			value={settings?.palette ?? 'ink'}
			onchange={(event) => setPalette((event.currentTarget as HTMLSelectElement).value as Palette)}
		>
			<option value="ink">Ink</option>
			<option value="lamp">Lamp</option>
		</select>
		<Button
			variant="outline"
			size="sm"
			onclick={() => setTheme(document.documentElement.classList.contains('dark') ? 'day' : 'night')}
		>
			{document.documentElement.classList.contains('dark') ? 'Day' : 'Night'}
		</Button>
		<Button href="/settings" variant="ghost" size="sm">Settings</Button>
	</header>

	{#if error}
		<p class="text-destructive p-6 text-sm">{error}</p>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col lg:flex-row">
			{#if outlineOpen && chapters.length > 0}
				<aside
					class="border-border bg-card max-h-72 shrink-0 overflow-y-auto border-b lg:max-h-none lg:w-72 lg:border-r lg:border-b-0"
					data-chapter-nav
				>
					<ChapterNav {chapters} pageIndex={shownPage} onjump={jump} />
				</aside>
			{/if}
			<div class="relative min-h-0 min-w-0 flex-1">
				<div
					class="absolute inset-0 touch-none overflow-hidden"
					bind:this={stage}
					role="group"
					aria-label="Book page"
					aria-busy={buffering}
					onpointerdown={onPagePointerDown}
					onpointermove={onPagePointerMove}
					onpointerup={onPagePointerUp}
					onpointercancel={onPagePointerCancel}
					onclickcapture={onPageClickCapture}
				>
					<div class="flex h-full w-full items-center justify-center" data-facing={facingMode}>
						<div class="relative">
							<div
								bind:this={pageSheet}
								class="relative flex items-stretch justify-center gap-4"
								class:shadow-xl={dragX !== 0}
								data-page-sheet
								data-drag={Math.round(dragX)}
								style:transform={`translateX(${dragX}px)`}
								style:opacity={pageOpacity}
								style:transition={dragAnimate ? 'transform 300ms ease, opacity 220ms ease' : 'none'}
							>
							<div class="relative bg-white shadow-sm" data-spread-page="left">
							<canvas bind:this={canvas} class="bg-white" class:hidden={book?.kind === 'text'}></canvas>
							{#if book?.kind === 'text'}
								<div
									class="{companionIndex >= 0 ? 'w-[min(36rem,42vw)]' : 'w-[min(42rem,86vw)]'} max-h-[78vh] overflow-auto bg-white px-8 py-10 leading-8 text-neutral-900"
									data-text-page
								>
									{#each words as word, index (`text:${index}:${word.charStart}`)}
										<button
											type="button"
											class="rounded-sm"
											class:mt-4={word.role === 'heading'}
											class:block={word.role === 'heading'}
											class:text-xl={word.role === 'heading'}
											style:background={wordBackdrop(
												index === activeWord || activeWord === -2,
												readyWords[index] === true,
												word.role
											)}
											style:box-shadow={index === activeWord || activeWord === -2
												? 'inset 0 -2px 0 var(--highlight-line)'
												: word.role === 'heading'
													? 'inset 0 -2px 0 rgba(180, 83, 9, 0.75)'
													: 'none'}
											aria-label={word.text}
											aria-current={index === activeWord ? 'true' : undefined}
											data-word={index}
											data-role={word.role}
											data-speech-ready={readyWords[index] ? 'true' : 'false'}
											onclick={() => playFrom(index, { seek: true })}
										>{word.text}</button>{' '}
									{/each}
								</div>
							{:else if viewport}
								<div class="pointer-events-none absolute inset-0">
									{#each words as word, index (`${index}:${word.charStart}`)}
										{@const box = wordBox(word)}
										<button
											type="button"
											class="pointer-events-auto absolute rounded-sm"
											style="left:{box.left}px;top:{box.top}px;width:{box.width}px;height:{box.height}px;background:{wordBackdrop(
												index === activeWord || activeWord === -2,
												readyWords[index] === true,
												word.role
											)};box-shadow:{index === activeWord || activeWord === -2
												? 'inset 0 -2px 0 var(--highlight-line)'
												: word.role === 'heading'
													? 'inset 0 -2px 0 rgba(180, 83, 9, 0.75)'
													: 'none'}"
											aria-label={word.text}
											aria-current={index === activeWord ? 'true' : undefined}
											data-word={index}
											data-role={word.role}
											data-speech-ready={readyWords[index] ? 'true' : 'false'}
											onclick={() => playFrom(index, { seek: true })}
										></button>
									{/each}
								</div>
							{/if}
							</div>
							{#if companionIndex >= 0}
								<button
									type="button"
									class="relative bg-white text-left shadow-sm"
									data-spread-page="right"
									aria-label={`Page ${companionIndex + 1}`}
									onclick={() => jump(companionIndex)}
								>
									<canvas bind:this={canvasRight} class="bg-white" class:hidden={book?.kind === 'text'}></canvas>
									{#if book?.kind === 'text'}
										<div class="w-[min(36rem,42vw)] max-h-[78vh] overflow-auto bg-white px-8 py-10 leading-8 text-neutral-900" data-text-page="right">
											{#each companionWords as word, index (`right:${index}:${word.charStart}`)}
												<span class:mt-4={word.role === 'heading'} class:block={word.role === 'heading'} class:text-xl={word.role === 'heading'}>{word.text}</span>{' '}
											{/each}
										</div>
									{/if}
								</button>
							{/if}
							</div>
						</div>
					</div>
					{#if buffering}
						<div class="bg-background/80 absolute inset-0 z-10 flex items-center justify-center">
							<div class="bg-card border-border flex w-72 flex-col items-center gap-3 rounded-xl border px-6 py-5 shadow-sm">
								<div class="border-muted border-t-primary size-10 animate-spin rounded-full border-2"></div>
								<p class="text-sm font-medium">{prepared ? `Buffering page ${pageIndex + 1}` : 'Opening the book…'}</p>
								<p class="text-muted-foreground text-center text-xs">{pipeline.live || bufferLabel}</p>
							</div>
						</div>
					{:else if speechLoading}
						<div class="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center" data-speech-loader>
							<div class="bg-card/95 border-border flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm">
								<div class="border-muted border-t-primary size-5 animate-spin rounded-full border-2"></div>
								<div>
									<p class="text-sm font-medium">Buffering the next lines</p>
									<p class="text-muted-foreground text-xs">{speechReadyLabel}</p>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
			<div class="border-border h-44 shrink-0 overflow-hidden border-t lg:h-auto lg:w-80 lg:border-t-0 lg:border-l">
				<PipelinePanel />
			</div>
		</div>
	{/if}

	<footer class="border-border bg-card shrink-0 border-t px-4 py-3">
		<div class="flex flex-wrap items-center gap-3">
			<Button variant="outline" size="sm" onclick={() => jump(leafTarget(-1))} disabled={!book || leafTarget(-1) === pageIndex}>Previous</Button>
			<Button onclick={toggle} disabled={buffering || words.length === 0}>{playing ? 'Pause' : 'Play'}</Button>
			<Button variant="outline" size="sm" onclick={() => jump(leafTarget(1))} disabled={!book || leafTarget(1) === pageIndex}>
				Next
			</Button>
			<Button
				variant={facingWanted ? 'secondary' : 'outline'}
				size="sm"
				aria-pressed={facingWanted}
				data-facing-toggle
				data-facing={facingMode}
				title={facingMode === 'waiting' ? 'Widen the window to show two pages' : 'Show two pages side by side'}
				onclick={() => setFacing(!facingWanted)}
			>
				Two pages
			</Button>
			<form class="flex items-center gap-2" onsubmit={goToPage}>
				<label class="text-muted-foreground text-xs" for="go-to-page">Go to page</label>
				<input
					id="go-to-page"
					bind:this={pageField}
					class="{field} w-20 tabular-nums"
					type="number"
					inputmode="numeric"
					min="1"
					max={book?.pageCount ?? 1}
					bind:value={pageDraft}
					disabled={!book}
					onfocus={() => {
						editingPage = true;
						pageField?.select();
					}}
					oninput={() => (editingPage = true)}
					onblur={() => goToPage()}
				/>
				<Button type="submit" variant="outline" size="sm" disabled={!book}>Go</Button>
			</form>
			{#if book && book.pageCount > 1}
				<div class="flex items-center gap-2" data-page-slider>
					<span class="text-muted-foreground w-10 text-right text-xs tabular-nums" data-slider-current>{shownPage + 1}</span>
					<input
						class="accent-primary w-36"
						type="range"
						min="0"
						max={book.pageCount - 1}
						value={shownPage}
						aria-label={`Page ${shownPage + 1} of ${book.pageCount}`}
						aria-valuetext={`${shownPage + 1} of ${book.pageCount}`}
						oninput={(event) => (scrub = Number((event.currentTarget as HTMLInputElement).value))}
						onchange={(event) => jump(Number((event.currentTarget as HTMLInputElement).value))}
					/>
					<span class="text-muted-foreground w-10 text-xs tabular-nums" data-slider-total>{book.pageCount}</span>
				</div>
			{/if}
			<div class="flex min-w-36 flex-1 items-center gap-2">
				<span class="text-muted-foreground text-xs tabular-nums">{rate.toFixed(1)}×</span>
				<Slider type="single" bind:value={rate} min={0.5} max={2} step={0.1} />
			</div>
			<div class="flex min-w-36 items-center gap-2" data-pace>
				<label class="text-muted-foreground text-xs tabular-nums" for="speech-pace">Pace {settings?.speechPace ?? 24}</label>
				<input
					id="speech-pace"
					class="accent-primary w-28"
					type="range"
					min="8"
					max="48"
					step="4"
					value={settings?.speechPace ?? 24}
					aria-label="Pace in words"
					disabled={!settings}
					onchange={onPace}
				/>
			</div>
			{#if settings}
				<select class={field} value={settings.emotion} onchange={onEmotion} aria-label="Emotion">
					<option value="auto">Emotion: auto</option>
					{#each EMOTIONS as emotion (emotion)}
						<option value={emotion}>{emotion}</option>
					{/each}
				</select>
				{#if settings.tts.vendor === 'browser'}
					<select class={field} value={settings.voiceName} onchange={onVoice} aria-label="Voice">
						<option value="">Browser default voice</option>
						{#each voices as voice, index (`${index}:${voice.voiceURI}`)}
							<option value={voice.voiceURI || voice.name}>{voice.name || voice.voiceURI || `Voice ${index + 1}`}</option>
						{/each}
					</select>
				{:else}
					<input class="{field} w-36" value={settings.tts.voice} aria-label="Voice id" onchange={onVendorVoice} />
				{/if}
				{#if settings.cloneBlobId || settings.cloneFileName}
					<span class="text-muted-foreground max-w-40 truncate text-xs" data-voice-sample>
						Sample {settings.cloneFileName || 'saved'}
					</span>
					<Button id="remove-sample" variant="destructive" size="sm" onclick={removeSample}>Remove sample</Button>
				{/if}
			{/if}
			<p class="text-muted-foreground text-xs">
				{bufferLabel}
				{#if speechReadyLabel}
					· {speechReadyLabel}
				{/if}
				{#if prepared}
					· {prepared.source === 'ocr' ? `OCR ${prepared.confidence ?? 0}` : 'Text layer'}
				{/if}
				{#if settings?.tts.vendor === 'browser'}
					· pitch and rate stand in for emotion
				{/if}
			</p>
			{#if sampleNote}
				<p class="text-muted-foreground w-full text-xs">{sampleNote}</p>
			{:else if voiceNote}
				<p class="text-destructive w-full text-xs">{voiceNote}</p>
			{:else if prepared?.note}
				<p class="text-destructive w-full text-xs">{prepared.note}</p>
			{/if}
		</div>
	</footer>
	<audio bind:this={deckA} data-audio-deck="a" class="hidden" preload="auto"></audio>
	<audio bind:this={deckB} data-audio-deck="b" class="hidden" preload="auto"></audio>
</div>
