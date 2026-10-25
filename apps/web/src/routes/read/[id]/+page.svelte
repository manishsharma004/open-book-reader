<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { getBlob, getBook, type Book } from '#lib/db.js';
	import { applyTheme, readTheme, type ThemeMode } from '#lib/theme.js';
	import { openPdf, pageWords, type PageWord } from '#lib/pdf.js';
	import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
	import { onDestroy } from 'svelte';

	let book = $state<Book | null>(null);
	let error = $state('');
	let pageIndex = $state(0);
	let words = $state<PageWord[]>([]);
	let pageText = $state('');
	let activeWord = $state(-1);
	let playing = $state(false);
	let rate = $state(1);
	let theme = $state<ThemeMode>('system');
	let viewport = $state<PageViewport | null>(null);

	let stage = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let pdf: PDFDocumentProxy | null = null;
	let currentPage: PDFPageProxy | null = null;
	let utterance: SpeechSynthesisUtterance | null = null;

	const id = $derived(page.params.id ?? '');

	function stop() {
		speechSynthesis.cancel();
		playing = false;
		utterance = null;
	}

	onDestroy(() => {
		stop();
		void pdf?.cleanup();
	});

	function wordBox(word: PageWord) {
		if (!viewport) return { left: 0, top: 0, width: 0, height: 0 };
		const [x, y] = viewport.convertToViewportPoint(word.x, word.y);
		const height = word.h * viewport.scale;
		return { left: x, top: y - height, width: word.w * viewport.scale, height };
	}

	async function draw() {
		if (!pdf || !canvas || !stage) return;
		currentPage = await pdf.getPage(pageIndex + 1);
		const base = currentPage.getViewport({ scale: 1 });
		const scale = Math.min((stage.clientWidth || 720) / base.width, 1.6);
		const next = currentPage.getViewport({ scale });
		viewport = next;
		const outputScale = window.devicePixelRatio || 1;
		canvas.width = Math.floor(next.width * outputScale);
		canvas.height = Math.floor(next.height * outputScale);
		canvas.style.width = `${next.width}px`;
		canvas.style.height = `${next.height}px`;
		const canvasContext = canvas.getContext('2d');
		if (!canvasContext) return;
		canvasContext.setTransform(outputScale, 0, 0, outputScale, 0, 0);
		await currentPage.render({ canvas, canvasContext, viewport: next }).promise;
		const extracted = await pageWords(currentPage);
		words = extracted.words;
		pageText = extracted.text;
		activeWord = -1;
	}

	$effect(() => {
		const bookId = id;
		let cancelled = false;
		stop();
		(async () => {
			const found = await getBook(bookId);
			if (cancelled) return;
			if (!found) {
				error = 'That book is not in this browser.';
				return;
			}
			book = found;
			theme = readTheme();
			const blob = await getBlob(found.blobId);
			if (!blob || cancelled) return;
			void pdf?.cleanup();
			pdf = await openPdf(await blob.arrayBuffer());
			pageIndex = 0;
			await draw();
		})().catch((caught) => {
			error = caught instanceof Error ? caught.message : 'Could not open the book.';
		});
		return () => {
			cancelled = true;
		};
	});

	async function go(next: number) {
		if (!book) return;
		stop();
		pageIndex = Math.min(book.pageCount - 1, Math.max(0, next));
		await draw();
	}

	function speak(fromWord = 0) {
		if (!pageText) return;
		stop();
		const slice = words.slice(fromWord);
		const spoken = slice.map((word) => word.text).join(' ');
		if (!spoken) return;
		const next = new SpeechSynthesisUtterance(spoken);
		next.rate = rate;
		next.onboundary = (event) => {
			if (event.name !== 'word') return;
			const local = wordAtChar(slice, event.charIndex);
			activeWord = local === -1 ? -1 : fromWord + local;
		};
		next.onend = () => {
			playing = false;
			activeWord = -1;
		};
		utterance = next;
		playing = true;
		speechSynthesis.speak(next);
	}

	function wordAtChar(list: PageWord[], charIndex: number) {
		let cursor = 0;
		for (let index = 0; index < list.length; index += 1) {
			const end = cursor + list[index].text.length;
			if (charIndex >= cursor && charIndex < end) return index;
			cursor = end + 1;
		}
		return -1;
	}

	function toggle() {
		if (playing) {
			stop();
			return;
		}
		speak(0);
	}
</script>

<svelte:head>
	<title>{book?.title ?? 'Reader'}</title>
</svelte:head>

<div class="flex min-h-screen flex-col">
	<header class="border-border flex h-14 items-center gap-2 border-b px-3">
		<Button href="/" variant="ghost" size="sm">Library</Button>
		<p class="min-w-0 flex-1 truncate text-sm font-medium">{book?.title ?? 'Opening…'}</p>
		<span class="text-muted-foreground text-sm">
			{book ? `${pageIndex + 1} / ${book.pageCount}` : ''}
		</span>
		<Button
			variant="outline"
			size="sm"
			onclick={() => {
				const next = document.documentElement.classList.contains('dark') ? 'day' : 'night';
				theme = next;
				applyTheme(next);
			}}
		>
			{theme === 'night' ? 'Day' : 'Night'}
		</Button>
	</header>

	{#if error}
		<p class="text-destructive p-6 text-sm">{error}</p>
	{:else}
		<div class="reading mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-4 px-4 py-6">
			<div class="relative" bind:this={stage}>
				<canvas bind:this={canvas} class="bg-white shadow-sm"></canvas>
				{#if viewport}
					<div class="pointer-events-none absolute inset-0">
						{#each words as word, index (word.charStart)}
							{@const box = wordBox(word)}
							<button
								type="button"
								class="pointer-events-auto absolute rounded-sm"
								style="left:{box.left}px;top:{box.top}px;width:{box.width}px;height:{box.height}px;background:{index ===
								activeWord
									? 'var(--highlight)'
									: 'transparent'};box-shadow:{index === activeWord
									? 'inset 0 -2px 0 var(--highlight-line)'
									: 'none'}"
								aria-label={word.text}
								onclick={() => speak(index)}
							></button>
						{/each}
					</div>
				{/if}
			</div>
			{#if words.length === 0 && book}
				<p class="text-sm">This page has no text layer. OCR is not in this version yet.</p>
			{/if}
		</div>
	{/if}

	<footer class="border-border bg-card sticky bottom-0 border-t px-4 py-3">
		<div class="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
			<Button variant="outline" size="sm" onclick={() => go(pageIndex - 1)} disabled={pageIndex === 0}>
				Previous
			</Button>
			<Button onclick={toggle} disabled={words.length === 0}>{playing ? 'Pause' : 'Play'}</Button>
			<Button
				variant="outline"
				size="sm"
				onclick={() => go(pageIndex + 1)}
				disabled={!book || pageIndex >= book.pageCount - 1}
			>
				Next
			</Button>
			<div class="flex min-w-40 flex-1 items-center gap-2">
				<span class="text-muted-foreground text-xs">{rate.toFixed(1)}×</span>
				<Slider type="single" bind:value={rate} min={0.5} max={2} step={0.1} />
			</div>
			<p class="text-muted-foreground text-xs">Preview voice · word highlight</p>
		</div>
	</footer>
</div>
