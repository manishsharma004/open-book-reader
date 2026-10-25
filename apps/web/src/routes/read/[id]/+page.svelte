<script lang="ts">
	import { page } from '$app/state';
	import PipelinePanel from '#lib/components/pipeline-panel.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Slider } from '#lib/components/ui/slider/index.js';
	import { getBlob, getBook, type Book } from '#lib/db.js';
	import { openPdf, type PageWord } from '#lib/pdf.js';
	import { logPipeline, pipeline } from '#lib/pipeline.svelte.js';
	import {
		attachDocument,
		bufferSnapshot,
		ensurePage,
		onBuffer,
		warm,
		type PreparedPage
	} from '#lib/prepare.js';
	import { commitSettings, setPalette, setTheme, settingsState } from '#lib/settings-store.svelte.js';
	import { EMOTIONS, type EmotionChoice } from '#lib/settings.js';
	import { browserDelivery, listVoices, voiceByName } from '#lib/speech.js';
	import type { Palette } from '#lib/theme.js';
	import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
	import { onDestroy } from 'svelte';

	let book = $state<Book | null>(null);
	let error = $state('');
	let pageIndex = $state(0);
	let scrub = $state<number | null>(null);
	let words = $state<PageWord[]>([]);
	let prepared = $state<PreparedPage | null>(null);
	let activeWord = $state(-1);
	let playing = $state(false);
	let rate = $state(1);
	let buffering = $state(false);
	let viewport = $state<PageViewport | null>(null);
	let pdfToken = $state(0);
	let bufferTick = $state(0);
	let voices = $state<SpeechSynthesisVoice[]>([]);
	let paintedSize = '';

	let stage = $state<HTMLDivElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let audio = $state<HTMLAudioElement | null>(null);
	let pdf: PDFDocumentProxy | null = null;
	let viewGen = 0;
	let paintGen = 0;
	let playToken = 0;

	const id = $derived(page.params.id ?? '');
	const settings = $derived(settingsState.current);
	const shownPage = $derived(scrub ?? pageIndex);
	const field = 'border-input bg-background h-8 rounded-lg border px-2 text-sm';

	const bufferLabel = $derived.by(() => {
		bufferTick;
		if (!settings || !book) return '';
		const pages = bufferSnapshot(pageIndex, book.pageCount, settings);
		const ready = pages.filter((item) => item.state === 'ready').length;
		const working = pages.find((item) => item.state === 'working');
		const workingLabel = working ? `, reading ${working.index + 1}` : '';
		return `Buffer ${ready}/${pages.length}${workingLabel}`;
	});

	function halt() {
		playToken += 1;
		speechSynthesis.cancel();
		if (audio) {
			audio.pause();
		}
		playing = false;
	}

	onDestroy(() => {
		halt();
		attachDocument(null);
		void pdf?.cleanup();
	});

	$effect(() => {
		return onBuffer(() => {
			bufferTick += 1;
		});
	});

	$effect(() => {
		const node = stage;
		if (!node) return;
		const observer = new ResizeObserver(() => {
			void paint();
		});
		observer.observe(node);
		void paint();
		return () => observer.disconnect();
	});

	$effect(() => {
		const sync = () => {
			voices = listVoices();
		};
		sync();
		speechSynthesis.addEventListener('voiceschanged', sync);
		return () => speechSynthesis.removeEventListener('voiceschanged', sync);
	});

	$effect(() => {
		const bookId = id;
		let cancelled = false;
		halt();
		(async () => {
			const found = await getBook(bookId);
			if (cancelled) return;
			if (!found) {
				error = 'That book is not in this browser.';
				return;
			}
			book = found;
			const blob = await getBlob(found.blobId);
			if (!blob || cancelled) return;
			void pdf?.cleanup();
			pdf = await openPdf(await blob.arrayBuffer());
			if (cancelled) return;
			attachDocument(pdf);
			pageIndex = 0;
			pdfToken += 1;
		})().catch((caught) => {
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

	async function paint() {
		const gen = ++paintGen;
		if (!pdf || !canvas || !stage || !prepared) return;
		const width = stage.clientWidth;
		const height = stage.clientHeight;
		if (width < 40 || height < 40) return;
		const sizeKey = `${prepared.pageIndex}:${Math.round(width)}x${Math.round(height)}`;
		if (sizeKey === paintedSize) return;
		const pdfPage = await pdf.getPage(prepared.pageIndex + 1);
		if (gen !== paintGen) return;
		const base = pdfPage.getViewport({ scale: 1 });
		const scale = Math.min((width - 24) / base.width, (height - 24) / base.height);
		if (!Number.isFinite(scale) || scale <= 0) return;
		const next = pdfPage.getViewport({ scale });
		const outputScale = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.floor(next.width * outputScale);
		canvas.height = Math.floor(next.height * outputScale);
		canvas.style.width = `${next.width}px`;
		canvas.style.height = `${next.height}px`;
		const canvasContext = canvas.getContext('2d');
		if (!canvasContext) return;
		canvasContext.setTransform(outputScale, 0, 0, outputScale, 0, 0);
		await pdfPage.render({ canvas, canvasContext, viewport: next }).promise;
		if (gen !== paintGen) return;
		paintedSize = sizeKey;
		viewport = next;
	}

	function jump(next: number) {
		if (!book) return;
		scrub = null;
		pageIndex = Math.min(book.pageCount - 1, Math.max(0, next));
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

	function playBrowser(fromWord: number) {
		if (!prepared || !settings) return;
		const token = ++playToken;
		const clauses = prepared.clauses.filter((clause) => clause.wordEnd > fromWord);
		let cursor = 0;
		const speakNext = () => {
			if (token !== playToken) return;
			if (cursor >= clauses.length) {
				playing = false;
				activeWord = -1;
				return;
			}
			const clause = clauses[cursor];
			cursor += 1;
			const start = Math.max(fromWord, clause.wordStart);
			const slice = words.slice(start, clause.wordEnd);
			const spoken = slice.map((word) => word.text).join(' ');
			if (!spoken) {
				speakNext();
				return;
			}
			const delivery = browserDelivery(clause.emotion, rate);
			const utterance = new SpeechSynthesisUtterance(spoken);
			utterance.rate = delivery.rate;
			utterance.pitch = delivery.pitch;
			utterance.volume = delivery.volume;
			const voice = voiceByName(settings.voiceName);
			if (voice) utterance.voice = voice;
			logPipeline({
				page: pageIndex + 1,
				stage: 'play',
				status: 'ok',
				ms: null,
				detail: `${delivery.detail} Voice ${voice?.name ?? 'browser default'}.`
			});
			utterance.onboundary = (event) => {
				if (token !== playToken || event.name !== 'word') return;
				const local = wordAtChar(slice, event.charIndex);
				activeWord = local === -1 ? -1 : start + local;
			};
			utterance.onend = () => speakNext();
			playing = true;
			speechSynthesis.speak(utterance);
		};
		speechSynthesis.cancel();
		speakNext();
	}

	async function playFrom(fromWord: number) {
		if (!prepared || buffering) return;
		halt();
		if (prepared.audioUrl && audio) {
			const token = ++playToken;
			audio.src = prepared.audioUrl;
			audio.playbackRate = rate;
			const timing = prepared.timings?.find((item) => item.wordIndex >= fromWord);
			audio.currentTime = timing?.start ?? 0;
			audio.onended = () => {
				if (token !== playToken) return;
				playing = false;
				activeWord = -1;
			};
			audio.ontimeupdate = () => {
				if (token !== playToken || !prepared?.timings) return;
				const hit = prepared.timings.find((timing) => audio && audio.currentTime >= timing.start && audio.currentTime < timing.end);
				if (hit) activeWord = hit.wordIndex;
			};
			if (!prepared.timings) activeWord = -2;
			playing = true;
			logPipeline({
				page: pageIndex + 1,
				stage: 'play',
				status: 'ok',
				ms: null,
				detail: prepared.timings
					? `Playing stored audio at ${rate.toFixed(1)}× with word times.`
					: `Playing stored audio at ${rate.toFixed(1)}×. No word times, so the page stays highlighted.`
			});
			await audio.play();
			return;
		}
		playBrowser(fromWord);
	}

	function toggle() {
		if (playing) {
			halt();
			activeWord = -1;
			return;
		}
		void playFrom(0);
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

<div class="flex h-dvh min-h-0 flex-col overflow-hidden">
	<header class="border-border flex h-14 shrink-0 items-center gap-2 border-b px-3">
		<Button href="/" variant="ghost" size="sm">Library</Button>
		<p class="min-w-0 flex-1 truncate text-sm font-medium">{book?.title ?? 'Opening…'}</p>
		<span class="text-muted-foreground text-sm tabular-nums">
			{book ? `${shownPage + 1} / ${book.pageCount}` : ''}
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
			<div class="relative min-h-0 min-w-0 flex-1">
				<div class="absolute inset-0 overflow-hidden" bind:this={stage} aria-busy={buffering}>
					<div class="flex h-full w-full items-center justify-center">
						<div class="relative">
							<canvas bind:this={canvas} class="bg-white shadow-sm"></canvas>
							{#if viewport}
								<div class="pointer-events-none absolute inset-0">
									{#each words as word, index (word.charStart)}
										{@const box = wordBox(word)}
										<button
											type="button"
											class="pointer-events-auto absolute rounded-sm"
											style="left:{box.left}px;top:{box.top}px;width:{box.width}px;height:{box.height}px;background:{index ===
												activeWord || activeWord === -2
												? 'var(--highlight)'
												: 'transparent'};box-shadow:{index === activeWord || activeWord === -2
												? 'inset 0 -2px 0 var(--highlight-line)'
												: 'none'}"
											aria-label={word.text}
											onclick={() => playFrom(index)}
										></button>
									{/each}
								</div>
							{/if}
						</div>
					</div>
					{#if buffering}
						<div class="bg-background/80 absolute inset-0 z-10 flex items-center justify-center">
							<div class="bg-card border-border flex w-72 flex-col items-center gap-3 rounded-xl border px-6 py-5 shadow-sm">
								<div class="border-muted border-t-primary size-10 animate-spin rounded-full border-2"></div>
								<p class="text-sm font-medium">Buffering page {pageIndex + 1}</p>
								<p class="text-muted-foreground text-center text-xs">{pipeline.live || bufferLabel}</p>
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
			<Button variant="outline" size="sm" onclick={() => jump(pageIndex - 1)} disabled={pageIndex === 0}>Previous</Button>
			<Button onclick={toggle} disabled={buffering || words.length === 0}>{playing ? 'Pause' : 'Play'}</Button>
			<Button variant="outline" size="sm" onclick={() => jump(pageIndex + 1)} disabled={!book || pageIndex >= book.pageCount - 1}>
				Next
			</Button>
			{#if book && book.pageCount > 1}
				<input
					class="accent-primary w-40"
					type="range"
					min="0"
					max={book.pageCount - 1}
					value={shownPage}
					aria-label="Page"
					oninput={(event) => (scrub = Number((event.currentTarget as HTMLInputElement).value))}
					onchange={(event) => jump(Number((event.currentTarget as HTMLInputElement).value))}
				/>
			{/if}
			<div class="flex min-w-36 flex-1 items-center gap-2">
				<span class="text-muted-foreground text-xs tabular-nums">{rate.toFixed(1)}×</span>
				<Slider type="single" bind:value={rate} min={0.5} max={2} step={0.1} />
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
						{#each voices as voice (voice.voiceURI)}
							<option value={voice.voiceURI}>{voice.name}</option>
						{/each}
					</select>
				{:else}
					<input class="{field} w-36" value={settings.tts.voice} aria-label="Voice id" onchange={onVendorVoice} />
				{/if}
			{/if}
			<p class="text-muted-foreground text-xs">
				{bufferLabel}
				{#if prepared}
					· {prepared.source === 'ocr' ? `OCR ${prepared.confidence ?? 0}` : 'Text layer'}
				{/if}
				{#if settings?.tts.vendor === 'browser'}
					· pitch and rate stand in for emotion
				{/if}
			</p>
			{#if prepared?.note}
				<p class="text-destructive w-full text-xs">{prepared.note}</p>
			{/if}
		</div>
	</footer>
	<audio bind:this={audio} class="hidden"></audio>
</div>
