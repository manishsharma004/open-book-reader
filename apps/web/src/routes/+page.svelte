<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import MarksDialog from '#lib/components/marks-dialog.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { clearBookSpeech, deleteBook, getBlob, listBooks, updateBook, type Book } from '#lib/db.js';
	import { saveEpubFile, savePdfFile } from '#lib/library.js';
	import { isPasswordError } from '#lib/pdf.js';

	let books = $state<Book[]>([]);
	let loaded = $state(false);
	let covers = $state<Record<string, string>>({});
	let storage = $state<{ used: number; quota: number } | null>(null);
	let open = $state(false);
	let marksOpen = $state(false);
	let busy = $state(false);
	let cleared = $state('');
	let error = $state('');
	let password = $state('');
	let pendingFile = $state<File | null>(null);
	let needsPassword = $state(false);
	let dragging = $state(false);
	let picked = $state<{ name: string; size: number } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function refresh() {
		try {
			books = await listBooks();
			for (const url of Object.values(covers)) URL.revokeObjectURL(url);
			const next: Record<string, string> = {};
			for (const book of books) {
				if (!book.coverId) continue;
				const blob = await getBlob(book.coverId);
				if (blob) next[book.id] = URL.createObjectURL(blob);
			}
			covers = next;
			if (navigator.storage?.estimate) {
				const estimate = await navigator.storage.estimate();
				storage = { used: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
			}
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		refresh();
	});

	function formatBytes(bytes: number) {
		if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function storeFile(file: File, pdfPassword?: string) {
		busy = true;
		error = '';
		try {
			const saved = await savePdfFile(file, pdfPassword);
			open = false;
			pendingFile = null;
			password = '';
			needsPassword = false;
			if (saved.existing) {
				await goto(resolve('/read/[id]', { id: saved.book.id }));
				return;
			}
			await refresh();
		} catch (caught) {
			if (isPasswordError(caught)) {
				needsPassword = true;
				pendingFile = file;
				error = 'This PDF is password protected.';
			} else {
				error = caught instanceof Error ? caught.message : 'Could not open that PDF.';
			}
		} finally {
			busy = false;
		}
	}

	function isPdf(file: File) {
		return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
	}

	function isEpub(file: File) {
		return file.type === 'application/epub+zip' || file.name.toLowerCase().endsWith('.epub');
	}

	function takeFile(file: File | null | undefined) {
		if (!file || busy) return;
		if (fileInput) fileInput.value = '';
		if (!isPdf(file) && !isEpub(file)) {
			picked = null;
			pendingFile = null;
			needsPassword = false;
			error = 'Choose a PDF or EPUB file.';
			return;
		}
		if (isEpub(file)) {
			picked = { name: file.name, size: file.size };
			needsPassword = false;
			password = '';
			error = '';
			busy = true;
			void saveEpubFile(file)
				.then(async (saved) => {
					open = false;
					if (saved.existing) await goto(resolve('/read/[id]', { id: saved.book.id }));
					else await refresh();
				})
				.catch((caught) => {
					error = caught instanceof Error ? caught.message : 'Could not open that EPUB.';
				})
				.finally(() => {
					busy = false;
				});
			return;
		}
		picked = { name: file.name, size: file.size };
		needsPassword = false;
		password = '';
		error = '';
		void storeFile(file);
	}

	function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		takeFile(input.files?.[0]);
	}

	function onDragOver(event: DragEvent) {
		event.preventDefault();
		if (busy) return;
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		dragging = true;
	}

	function onDragLeave(event: DragEvent) {
		const next = event.relatedTarget;
		if (next instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
		dragging = false;
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		takeFile(event.dataTransfer?.files?.[0]);
	}

	async function remove(book: Book) {
		await deleteBook(book);
		await refresh();
	}

	async function clearAudio(book: Book) {
		await clearBookSpeech(book.id);
		cleared = book.id;
	}
</script>

<main class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Library</h1>
			<p class="text-muted-foreground mt-1 max-w-xl text-sm">
				Add a PDF or EPUB you own, or browse books that are free to keep. Either way it stays in this browser.
			</p>
		</div>
		<div class="flex gap-2">
			<Button href={resolve('/open')} variant="secondary">Browse open books</Button>
			<Button variant="outline" data-library-marks onclick={() => (marksOpen = true)}>Marks</Button>
			<Button onclick={() => (open = true)}>Add book</Button>
		</div>
	</div>

	{#if !loaded}
		<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-library-loader aria-busy="true">
			{#each [0, 1, 2] as item (item)}
				<li class="bg-card border-border overflow-hidden rounded-xl border">
					<div class="bg-muted h-64 animate-pulse"></div>
					<div class="grid gap-2 p-4">
						<div class="bg-muted h-4 w-2/3 animate-pulse rounded"></div>
						<div class="bg-muted h-3 w-1/3 animate-pulse rounded"></div>
					</div>
				</li>
			{/each}
		</ul>
	{:else if books.length === 0}
		<Card.Root class="border-dashed">
			<Card.Header>
				<Card.Title>No books yet</Card.Title>
				<Card.Description>Add a PDF or EPUB you own, or browse books that are free to keep. Either way it stays in this browser.</Card.Description>
			</Card.Header>
			<Card.Footer class="gap-2">
				<Button href={resolve('/open')} variant="secondary">Browse open books</Button>
				<Button variant="secondary" onclick={() => (open = true)}>Add book</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each books as book (book.id)}
				<li>
					<Card.Root class="overflow-hidden">
						<a href={resolve('/read/[id]', { id: book.id })} class="bg-muted flex h-64 w-full shrink-0 items-center justify-center">
							{#if covers[book.id]}
								<img src={covers[book.id]} alt="" class="max-h-full max-w-full object-contain" />
							{/if}
						</a>
						<Card.Header>
							<Card.Title class="line-clamp-2 min-h-11 text-base">{book.title}</Card.Title>
							<Card.Description data-progress-page={book.progress?.pageIndex ?? 0}>
								{book.pageCount} pages{book.chapters && book.chapters.length > 1 ? ` · ${book.chapters.length} chapters` : ''}{book.progress && book.progress.pageIndex > 0 ? ` · page ${book.progress.pageIndex + 1}` : ''}
							</Card.Description>
						</Card.Header>
						<Card.Footer class="gap-2">
							<Badge>Ready to read</Badge>
							<Button class="ml-auto" variant="ghost" size="sm" data-clear-audio={book.id} onclick={() => clearAudio(book)}>
								{cleared === book.id ? 'Audio cleared' : 'Clear audio'}
							</Button>
							<Button variant="ghost" size="sm" onclick={() => remove(book)}>Remove</Button>
						</Card.Footer>
					</Card.Root>
				</li>
			{/each}
		</ul>
	{/if}

	{#if storage && storage.quota > 0}
		<div class="text-muted-foreground space-y-2 text-sm">
			<div class="flex justify-between">
				<span>Storage</span>
				<span>{formatBytes(storage.used)} of {formatBytes(storage.quota)}</span>
			</div>
			<Progress value={(storage.used / storage.quota) * 100} />
		</div>
	{/if}
</main>

<MarksDialog
	open={marksOpen}
	{books}
	onOpenChange={(next) => (marksOpen = next)}
	onBook={(next) => {
		books = books.map((item) => (item.id === next.id ? next : item));
		void updateBook(next);
	}}
	onVisit={(bookId, pageIndex, wordIndex) => {
		marksOpen = false;
		void goto(`${resolve('/read/[id]', { id: bookId })}?page=${pageIndex + 1}&word=${wordIndex}`);
	}}
/>

<Dialog.Root
	bind:open
	onOpenChange={(next) => {
		if (next) return;
		dragging = false;
		error = '';
		password = '';
		needsPassword = false;
		pendingFile = null;
		picked = null;
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header class="pr-8">
			<Dialog.Title>Add a book</Dialog.Title>
			<Dialog.Description>PDF and EPUB files stay in this browser. PDF pages with little or no text are read with OCR. An EPUB keeps its pictures and styling.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3">
			<label
				class="border-border bg-muted/30 hover:bg-muted/60 focus-within:border-ring focus-within:ring-ring/40 flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus-within:ring-3 {dragging
					? 'border-primary bg-accent'
					: ''} {busy ? 'pointer-events-none opacity-70' : ''}"
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				ondrop={onDrop}
				data-book-drop
				data-dragging={dragging ? 'true' : 'false'}
				aria-busy={busy}
			>
				<span class="bg-background text-primary flex size-11 items-center justify-center rounded-full border shadow-sm">
					<UploadIcon class="size-6" />
				</span>
				<span class="grid gap-1">
					<span class="text-sm font-medium">{busy ? 'Adding the book…' : dragging ? 'Drop the book' : 'Drop a PDF or EPUB here'}</span>
					<span class="text-muted-foreground text-xs">
						{#if picked}
							{picked.name} · {formatBytes(picked.size)}
						{:else}
							or click to choose a file
						{/if}
					</span>
				</span>
				<input
					bind:this={fileInput}
					id="book-file"
					class="sr-only"
					type="file"
					accept="application/pdf,.pdf,application/epub+zip,.epub"
					onchange={onFile}
					disabled={busy}
				/>
			</label>
			{#if needsPassword}
				<Label for="pdf-password">Password</Label>
				<Input id="pdf-password" type="password" bind:value={password} />
				<Button
					disabled={busy || !pendingFile || password.length === 0}
					onclick={() => pendingFile && storeFile(pendingFile, password)}
				>
					Unlock and add
				</Button>
			{/if}
			{#if busy}
				<div class="flex items-center gap-3" data-add-loader>
					<div class="border-muted border-t-primary size-8 animate-spin rounded-full border-2"></div>
					<p class="text-sm font-medium">Reading the book…</p>
				</div>
			{/if}
			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
