<script lang="ts">
	import { chaptersFromToc, openEpub, pageFrame, sectionDocument, type ParsedEpub } from '#lib/epub.js';
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
		if (!flow) return [];
		const origin = flow.getBoundingClientRect().left;
		const inView = (left: number) => {
			const delta = left - origin;
			return delta >= -4 && delta < widthPx - 4;
		};
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
		sheet.textContent = `.ob-w{border-radius:2px}.ob-ready{background:${READY_TINT}}.ob-heading{background:${HEADING_TINT}}.ob-sentence{box-shadow:inset 0 -2px 0 ${line}}.ob-active{background:${fill};box-shadow:inset 0 -2px 0 ${line}}`;
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
				range.surroundContents(span);
			}
		}
		const flow = doc.getElementById('ob-flow');
		if (!flow) return;
		flow.onclick = (event) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
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
		const key = `${shown}:${words.map((word) => word.text).join('\u0001')}`;
		const existing = doc.querySelectorAll('span.ob-w');
		if (key === markedKey && existing.length > 0) {
			for (const span of existing) {
				if (!(span instanceof HTMLElement)) continue;
				span.className = markClass(Number(span.dataset.obWord));
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

	function columnWidth(box: number) {
		if (!spread) return box;
		return Math.max(40, Math.floor((box - 16) / 2));
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

	$effect(() => {
		const bytes = data;
		const boxWidth = width;
		const boxHeight = height;
		const frame = probe;
		const wide = spread;
		if (!bytes || !frame || boxWidth < 40 || boxHeight < 40) return;
		let cancelled = false;
		const widthPx = columnWidth(boxWidth);
		const limit = pageFrame(widthPx, boxHeight, wide).innerHeight;
		sections = [];
		shown = '';
		void (async () => {
			let book: ParsedEpub;
			try {
				book = openEpub(bytes);
			} catch (caught) {
				if (!cancelled) onfail(caught instanceof Error ? caught.message : 'Could not open that EPUB.');
				return;
			}
			const pages: string[] = [];
			const built: { href: string; html: string; start: number; count: number }[] = [];
			const starts = new Map<string, number>();
			const anchors = new Map<string, Map<string, number>>();
			for (const item of book.spine) {
				if (cancelled) return;
				const html = sectionDocument(book, item.href, widthPx, boxHeight, wide);
				let laid = { texts: [''], anchors: new Map<string, number>() };
				try {
					const doc = await load(frame, html);
					if (cancelled) return;
					await settle(doc, limit);
					if (cancelled) return;
					laid = readColumns(doc, widthPx);
				} catch (caught) {
					if (!cancelled) onfail(caught instanceof Error ? caught.message : 'Could not lay out that EPUB.');
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
			if (!cancelled) onlayout(pages.slice(), chaptersFromToc(book.toc, book.spine, starts, anchors), true);
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const frame = view;
		desired = page;
		const section = sections.find((item) => desired >= item.start && desired < item.start + item.count) ?? sections[sections.length - 1];
		if (!frame || !section || width < 40) return;
		const widthPx = columnWidth(width);
		const limit = pageFrame(widthPx, height, spread).innerHeight;
		const apply = (doc: Document) => {
			const flow = doc.getElementById('ob-flow');
			const current = sections.find((item) => item.href === section.href) ?? section;
			const at = Math.min(current.start + current.count - 1, Math.max(current.start, desired));
			if (flow) flow.style.transform = `translateX(${-(at - current.start) * widthPx}px)`;
			markedKey = '';
			remark();
			doc.onpointerdown = (event) => {
				const startX = event.clientX;
				const startY = event.clientY;
				const move = (next: PointerEvent) => {
					if (Math.abs(next.clientY - startY) > Math.abs(next.clientX - startX)) doc.onpointerup = null;
				};
				doc.onpointerup = (next) => {
					doc.onpointerup = null;
					doc.onpointermove = null;
					const dx = next.clientX - startX;
					if (Math.abs(dx) < 70) return;
					onflick(dx < 0 ? 1 : -1);
				};
				doc.onpointermove = move;
			};
		};
		const key = `${section.href}:${widthPx}`;
		if (shown === key && frame.contentDocument?.getElementById('ob-flow')) {
			apply(frame.contentDocument);
			return;
		}
		shown = key;
		frame.onload = () => {
			const doc = frame.contentDocument;
			if (!doc) return;
			void settle(doc, limit).then(() => {
				if (frame.contentDocument === doc) apply(doc);
			});
		};
		frame.srcdoc = section.html;
	});

	$effect(() => {
		words;
		activeWord;
		sentenceStart;
		sentenceEnd;
		ready;
		remark();
	});
</script>

<div class="relative h-full w-full" bind:this={host} data-epub-stage data-epub-spread={spread ? 'on' : 'off'}>
	<iframe title="Book page" class="h-full w-full border-0 bg-white" bind:this={view} sandbox="allow-same-origin" scrolling="no"></iframe>
	<iframe title="" class="pointer-events-none absolute inset-0 -z-10 opacity-0" bind:this={probe} sandbox="allow-same-origin" tabindex="-1"></iframe>
</div>
