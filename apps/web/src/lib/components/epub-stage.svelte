<script lang="ts">
	import { untrack } from 'svelte';
	import { chaptersFromToc, openEpub, pageFrame, sectionDocument, type ParsedEpub } from '#lib/epub.js';
	import { pageFlick } from '#lib/page-flick.js';
	import { HEADING_TINT, READY_TINT } from '#lib/speech-clips.js';
	import { wordHits, type MarkPiece } from '#lib/spoken-marks.js';
	import { joinReadingRuns, type ReadingRun } from '#lib/spoken-text.js';
	import type { Chapter } from '#lib/chapters.js';
	import type { WordRole } from '#lib/page-roles.js';

	type SpokenWord = { text: string; role?: WordRole };

	type Props = {
		data: ArrayBuffer;
		page: number;
		spread: boolean;
		words?: SpokenWord[];
		activeWord?: number;
		sentenceStart?: number;
		sentenceEnd?: number;
		ready?: boolean[];
		onword?: (index: number) => void;
		onlayout: (pages: string[], chapters: Chapter[], done: boolean) => void;
		onflick: (direction: 1 | -1) => void;
		onfail: (message: string) => void;
	};

	let {
		data,
		page,
		spread,
		words = [],
		activeWord = -1,
		sentenceStart = -1,
		sentenceEnd = -1,
		ready = [],
		onword,
		onlayout,
		onflick,
		onfail
	}: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let view = $state<HTMLIFrameElement | null>(null);
	let probe = $state<HTMLIFrameElement | null>(null);
	let width = $state(0);
	let height = $state(0);
	let sections = $state.raw<{ href: string; html: string; start: number; count: number }[]>([]);
	let shown = '';
	let desired = 0;
	let markedKey = '';
	let columnShift = $state(0);
	let stageReady = $state(false);
	let reflowTick = $state(0);
	let laying = false;
	let laidWidth = 0;
	let laidHeight = 0;
	let laidSpread = false;
	let seenBytes = 0;
	let reflowBudget = 0;
	let reflowQueued = false;
	let layoutGeneration = 0;

	const blocks = new Set(['ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DIV', 'DD', 'DT', 'FIGCAPTION', 'FIGURE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE', 'SECTION', 'TR']);

	type DomPiece = MarkPiece & { node: Text | null };

	function clearMarks(doc: Document) {
		for (const span of [...doc.querySelectorAll('span.ob-w')]) {
			const parent = span.parentNode;
			if (!parent) continue;
			while (span.firstChild) parent.insertBefore(span.firstChild, span);
			span.remove();
		}
		doc.getElementById('ob-flow')?.normalize();
	}

	function piecesInView(doc: Document, widthPx: number): DomPiece[] {
		const flow = doc.getElementById('ob-flow');
		if (!flow || widthPx < 1) return [];
		// The open page is a later column slid into the iframe. Its text stays a column-width
		// away from the flow box, so measuring from the flow's left edge only saw column 1.
		const origin = flow.getBoundingClientRect().left;
		const visible = Math.max(0, Math.round(-columnShift / widthPx));
		const inView = (left: number) => Math.floor((left - origin) / widthPx + 0.02) === visible;
		const pieces: DomPiece[] = [];
		const walk = (node: Node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const value = node.textContent ?? '';
				if (!value) return;
				const range = doc.createRange();
				range.selectNodeContents(node);
				const rect = [...range.getClientRects()].find((box) => box.width > 0);
				if (!rect || !inView(rect.left)) return;
				pieces.push({ text: value, block: false, node: node as Text });
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			const element = node as HTMLElement;
			if (element.classList.contains('x-ebookmaker-pageno') || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
			if (element.tagName === 'BR') {
				const box = element.getBoundingClientRect();
				if (box.width > 0 && !inView(box.left)) return;
				pieces.push({ text: '\n', block: false, node: null });
				return;
			}
			const box = element.getBoundingClientRect();
			const block = blocks.has(element.tagName);
			const visible = box.width > 0 && inView(box.left);
			if (block && visible) pieces.push({ text: '', block: true, node: null });
			for (const child of element.childNodes) walk(child);
			if (block && visible) pieces.push({ text: '', block: true, node: null });
		};
		walk(flow);
		return pieces;
	}

	function markClass(index: number) {
		const names = ['ob-w'];
		const role = words[index]?.role;
		if (ready[index]) names.push('ob-ready');
		else if (role === 'heading') names.push('ob-heading');
		if (index >= sentenceStart && index < sentenceEnd) names.push('ob-sentence');
		if (index === activeWord) names.push('ob-active');
		return names.join(' ');
	}

	function paintMarks(doc: Document, pieces: DomPiece[], hits: ReturnType<typeof wordHits>) {
		const style = getComputedStyle(document.documentElement);
		const fill = style.getPropertyValue('--highlight').trim() || 'rgba(250, 204, 21, 0.45)';
		const line = style.getPropertyValue('--highlight-line').trim() || '#9a3412';
		let sheet = doc.getElementById('ob-mark');
		if (!sheet) {
			sheet = doc.createElement('style');
			sheet.id = 'ob-mark';
			doc.head.appendChild(sheet);
		}
		sheet.textContent = `.ob-w{border-radius:1px}.ob-ready{background:${READY_TINT}}.ob-heading{background:${HEADING_TINT}}.ob-sentence{box-shadow:inset 0 -2px 0 ${line}}.ob-active{background:${fill};box-shadow:inset 0 -2px 0 ${line}}`;
		const byPiece = new Map<number, { start: number; end: number; word: number }[]>();
		hits.forEach((slices, word) => {
			for (const slice of slices) {
				const list = byPiece.get(slice.piece) ?? [];
				list.push({ start: slice.start, end: slice.end, word });
				byPiece.set(slice.piece, list);
			}
		});
		for (const [pieceIndex, slices] of byPiece) {
			const node = pieces[pieceIndex]?.node;
			if (!node) continue;
			for (const slice of slices.sort((left, right) => right.start - left.start)) {
				const end = Math.min(slice.end, node.length);
				const start = Math.min(slice.start, end);
				if (start >= end || !node.parentNode) continue;
				const range = doc.createRange();
				range.setStart(node, start);
				range.setEnd(node, end);
				const span = doc.createElement('span');
				span.className = markClass(slice.word);
				span.dataset.obWord = String(slice.word);
				span.dataset.obRole = words[slice.word]?.role ?? 'body';
				range.surroundContents(span);
			}
		}
		const flow = doc.getElementById('ob-flow');
		if (!flow) return;
		const ViewElement = doc.defaultView?.Element;
		flow.onclick = (event) => {
			const target = event.target;
			// The page lives in the iframe's document, so the parent's Element is a different class.
			if (!ViewElement || !(target instanceof ViewElement)) return;
			const chosen = doc.getSelection();
			if (chosen && !chosen.isCollapsed) return;
			const span = target.closest('[data-ob-word]');
			if (!span) return;
			event.preventDefault();
			event.stopPropagation();
			onword?.(Number(span.getAttribute('data-ob-word')));
		};
	}

	function remark() {
		const doc = view?.contentDocument;
		if (!doc?.getElementById('ob-flow') || width < 40) return;
		const widthPx = columnWidth(width);
		const key = `${shown}:${Math.round(-columnShift)}:${words.map((word) => word.text).join('\u0001')}`;
		const existing = doc.querySelectorAll('span.ob-w');
		if (key === markedKey && existing.length > 0) {
			for (const span of existing) {
				const word = Number(span.getAttribute('data-ob-word'));
				if (!Number.isInteger(word)) continue;
				(span as HTMLElement).className = markClass(word);
			}
			return;
		}
		clearMarks(doc);
		const pieces = piecesInView(doc, widthPx);
		if (words.length === 0 || pieces.length === 0) {
			markedKey = '';
			return;
		}
		paintMarks(doc, pieces, wordHits(pieces, words.map((word) => word.text)));
		markedKey = key;
	}

	$effect(() => {
		const node = host;
		if (!node) return;
		const apply = () => {
			const nextWidth = node.clientWidth;
			const nextHeight = node.clientHeight;
			if (width > 0 && Math.abs(nextWidth - width) < 24 && Math.abs(nextHeight - height) < 24) return;
			width = nextWidth;
			height = nextHeight;
		};
		const observer = new ResizeObserver(apply);
		observer.observe(node);
		apply();
		return () => observer.disconnect();
	});

	function columnWidth(box: number, wide = spread) {
		if (!wide) return box;
		return Math.max(40, Math.floor((box - 16) / 2));
	}

	function sizeDrift(from: { w: number; h: number; spread: boolean }, to: { w: number; h: number; spread: boolean }) {
		return to.spread !== from.spread || Math.abs(to.w - from.w) >= 80 || Math.abs(to.h - from.h) >= 160;
	}

	function load(frame: HTMLIFrameElement, html: string) {
		return new Promise<Document>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error('This section took too long to lay out.')), 20000);
			frame.onload = () => {
				window.clearTimeout(timer);
				const doc = frame.contentDocument;
				if (!doc) reject(new Error('This section could not be shown.'));
				else resolve(doc);
			};
			frame.srcdoc = html;
		});
	}

	async function settle(doc: Document, limit: number) {
		await Promise.all([...doc.images].map((img) => (img.decode ? img.decode() : Promise.resolve()).catch(() => undefined)));
		// A picture taller than the page is monolithic in columns, so the title that follows it
		// would jump past the picture. A sized box slices, and the title continues on the next page.
		for (const img of [...doc.images]) {
			if (!img.naturalWidth || !img.naturalHeight) continue;
			if (img.closest('table, .figcenter, .figleft') || img.classList.contains('x-ebookmaker-cover')) continue;
			let width = img.clientWidth || img.naturalWidth;
			let height = img.naturalHeight * (width / img.naturalWidth);
			if (height <= limit + 8) continue;
			const remainder = height % limit;
			if (remainder > limit * 0.42) {
				const target = Math.floor(height / limit) * limit + limit * 0.28;
				width = Math.round(width * (target / height));
				height = Math.round(target);
			}
			const slice = doc.createElement('div');
			slice.setAttribute('role', 'img');
			if (img.alt) slice.setAttribute('aria-label', img.alt);
			slice.style.cssText = `display:block;width:${width}px;height:${height}px;margin-left:auto;margin-right:auto;background:url("${img.src}") 0 0 / 100% 100% no-repeat;box-decoration-break:slice;-webkit-box-decoration-break:slice;`;
			img.replaceWith(slice);
		}
	}

	function readColumns(doc: Document, widthPx: number) {
		const flow = doc.getElementById('ob-flow');
		if (!flow) return { texts: [''], anchors: new Map<string, number>() };
		const total = Math.max(1, Math.round(flow.scrollWidth / Math.max(widthPx, 1)));
		const anchors = new Map<string, number>();
		const origin = flow.getBoundingClientRect().left;
		const columnAtBox = (left: number) => Math.min(total - 1, Math.max(0, Math.floor((left - origin) / widthPx)));
		const columnAt = (element: Element) => {
			const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let text = walker.nextNode();
			while (text) {
				const value = (text.textContent ?? '').replace(/\s+/g, ' ').trim();
				if (value) {
					const range = doc.createRange();
					range.selectNodeContents(text);
					const rect = range.getClientRects()[0];
					if (rect && rect.width > 0) return columnAtBox(rect.left);
				}
				text = walker.nextNode();
			}
			return null;
		};
		const runs: ReadingRun[][] = Array.from({ length: total }, () => []);
		const place = (column: number, run: ReadingRun) => {
			if (column < 0) return;
			runs[Math.min(total - 1, column)].push(run);
		};
		const walk = (node: Node, hint: number) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const value = node.textContent ?? '';
				if (!value) return;
				const range = doc.createRange();
				range.selectNodeContents(node);
				const rect = [...range.getClientRects()].find((box) => box.width > 0);
				place(rect ? columnAtBox(rect.left) : hint, { text: value, block: false });
				return;
			}
			if (node.nodeType !== Node.ELEMENT_NODE) return;
			const element = node as HTMLElement;
			if (element.classList.contains('x-ebookmaker-pageno') || element.tagName === 'SCRIPT' || element.tagName === 'STYLE') return;
			if (element.tagName === 'BR') {
				place(hint, { text: '\n', block: false });
				return;
			}
			const box = element.getBoundingClientRect();
			const column = box.width > 0 ? columnAtBox(box.left) : hint;
			const block = blocks.has(element.tagName);
			if (block) place(column, { text: '', block: true });
			for (const child of element.childNodes) walk(child, column);
			if (block) place(column, { text: '', block: true });
		};
		walk(flow, 0);
		for (const element of flow.querySelectorAll('[id]')) {
			const placed = columnAt(element);
			anchors.set(element.id, placed ?? columnAtBox(element.getBoundingClientRect().left));
		}
		return { texts: runs.map((column) => joinReadingRuns(column)), anchors };
	}

	async function measureBook(
		bytes: ArrayBuffer,
		frame: HTMLIFrameElement,
		box: { w: number; h: number; spread: boolean },
		cancelled: () => boolean
	) {
		let book: ParsedEpub;
		try {
			book = openEpub(bytes);
		} catch (caught) {
			if (!cancelled()) onfail(caught instanceof Error ? caught.message : 'Could not open that EPUB.');
			return;
		}
		const widthPx = columnWidth(box.w, box.spread);
		const limit = pageFrame(widthPx, box.h, box.spread).innerHeight;
		const pages: string[] = [];
		const built: { href: string; html: string; start: number; count: number }[] = [];
		const starts = new Map<string, number>();
		const anchors = new Map<string, Map<string, number>>();
		let stopped = false;
		for (const item of book.spine) {
			if (cancelled()) {
				stopped = true;
				break;
			}
			const html = sectionDocument(book, item.href, widthPx, box.h, box.spread);
			let laid = { texts: [''], anchors: new Map<string, number>() };
			try {
				const doc = await load(frame, html);
				if (cancelled()) {
					stopped = true;
					break;
				}
				await settle(doc, limit);
				if (cancelled()) {
					stopped = true;
					break;
				}
				laid = readColumns(doc, widthPx);
			} catch (caught) {
				if (!cancelled()) onfail(caught instanceof Error ? caught.message : 'Could not lay out that EPUB.');
				return;
			}
			starts.set(item.href, pages.length);
			anchors.set(item.href, laid.anchors);
			const count = Math.max(laid.texts.length, 1);
			built.push({ href: item.href, html, start: pages.length, count });
			pages.push(...(laid.texts.length ? laid.texts : ['']));
			sections = built.slice();
			onlayout(pages.slice(), chaptersFromToc(book.toc, book.spine, starts, anchors), false);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		if (!stopped && !cancelled()) onlayout(pages.slice(), chaptersFromToc(book.toc, book.spine, starts, anchors), true);
	}

	$effect(() => {
		if (!stageReady && width >= 40 && height >= 40) stageReady = true;
	});

	// Spread turns on once the first section reports a second page. That used to change the
	// layout key and cancel the spine loop, so the chapter list never left chapter 1.
	$effect(() => {
		const bytes = data;
		const frame = probe;
		const ready = stageReady;
		reflowTick;
		if (!bytes || !frame || !ready) return;
		const generation = ++layoutGeneration;
		if (bytes.byteLength !== seenBytes) {
			seenBytes = bytes.byteLength;
			reflowBudget = 0;
		}
		laying = true;
		reflowQueued = false;
		let cancelled = false;
		const liveBox = () => untrack(() => ({ w: width, h: height, spread }));
		void (async () => {
			try {
				let box = liveBox();
				if (box.w < 40 || box.h < 40) return;
				const stale = () => cancelled || generation !== layoutGeneration;
				await measureBook(bytes, frame, box, stale);
				if (stale()) return;
				const drifted = liveBox();
				if (sizeDrift(box, drifted)) {
					box = drifted;
					await measureBook(bytes, frame, box, stale);
				}
				if (stale()) return;
				laidWidth = box.w;
				laidHeight = box.h;
				laidSpread = box.spread;
				const now = liveBox();
				if (sizeDrift(box, now) && reflowBudget < 2) {
					reflowBudget += 1;
					reflowQueued = true;
					reflowTick += 1;
				}
			} finally {
				if (generation === layoutGeneration) laying = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const w = width;
		const h = height;
		const wide = spread;
		const ready = stageReady;
		if (!ready || !data || w < 40 || h < 40 || laying || laidWidth === 0 || reflowQueued || reflowBudget >= 2) return;
		if (!sizeDrift({ w: laidWidth, h: laidHeight, spread: laidSpread }, { w, h, spread: wide })) return;
		reflowQueued = true;
		reflowBudget += 1;
		reflowTick += 1;
	});

	function place(doc: Document, section: { href: string; start: number; count: number }, widthPx: number) {
		const flow = doc.getElementById('ob-flow');
		const at = Math.min(section.start + section.count - 1, Math.max(section.start, desired));
		const shift = -(at - section.start) * widthPx;
		if (flow) flow.style.transform = `translateX(${shift}px)`;
		if (columnShift !== shift) columnShift = shift;
		doc.onpointerdown = (event) => {
			if (event.button !== 0) return;
			const startX = event.clientX;
			const startY = event.clientY;
			const started = performance.now();
			let choosing = false;
			const move = () => {
				const chosen = doc.getSelection();
				if (chosen && !chosen.isCollapsed) choosing = true;
			};
			doc.onpointerup = (next) => {
				doc.onpointerup = null;
				doc.onpointermove = null;
				const chosen = doc.getSelection();
				const direction = pageFlick(
					next.clientX - startX,
					next.clientY - startY,
					performance.now() - started,
					choosing || Boolean(chosen && !chosen.isCollapsed)
				);
				if (direction) onflick(direction);
			};
			doc.onpointermove = move;
		};
	}

	$effect(() => {
		const frame = view;
		desired = page;
		const widthPx = columnWidth(width);
		const limit = pageFrame(widthPx, height, spread).innerHeight;
		// Keep the open section on screen until the page being turned to has been measured.
		// Falling through to the latest section reloaded a different chapter on every spine item.
		const section = sections.find((item) => desired >= item.start && desired < item.start + item.count);
		if (!frame || !section || width < 40) return;
		const key = `${section.href}:${widthPx}:${section.start}`;
		const doc = frame.contentDocument;
		if (shown === key) {
			if (doc?.getElementById('ob-flow')) place(doc, section, widthPx);
			return;
		}
		shown = key;
		markedKey = '';
		frame.onload = () => {
			const loaded = frame.contentDocument;
			if (!loaded) return;
			void settle(loaded, limit).then(() => {
				if (frame.contentDocument !== loaded) return;
				place(loaded, section, widthPx);
				untrack(() => remark());
			});
		};
		frame.srcdoc = section.html;
	});

	$effect(() => {
		columnShift;
		words;
		activeWord;
		sentenceStart;
		sentenceEnd;
		ready;
		untrack(() => remark());
	});
</script>

<div class="relative h-full w-full" bind:this={host} data-epub-stage data-epub-spread={spread ? 'on' : 'off'}>
	<iframe title="Book page" class="h-full w-full border-0 bg-white" bind:this={view} sandbox="allow-same-origin" scrolling="no"></iframe>
	<iframe title="" class="pointer-events-none absolute inset-0 -z-10 opacity-0" bind:this={probe} sandbox="allow-same-origin" tabindex="-1"></iframe>
</div>
