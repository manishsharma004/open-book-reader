<script lang="ts">
	import { goto } from '$app/navigation';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import AppHeader from '#lib/components/app-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { deleteBook, findBookByHash, getBlob, listBooks, saveBook, sha256, type Book } from '#lib/db.js';
	import { randomId } from '#lib/hash.js';
	import { coverBlob, isPasswordError, openPdf } from '#lib/pdf.js';

	let books = $state<Book[]>([]);
	let covers = $state<Record<string, string>>({});
	let storage = $state<{ used: number; quota: number } | null>(null);
	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	let password = $state('');
	let pendingFile = $state<File | null>(null);
	let needsPassword = $state(false);
	let dragging = $state(false);
	let picked = $state<{ name: string; size: number } | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	async function refresh() {
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
			const hash = await sha256(file);
			const existing = await findBookByHash(hash);
			if (existing) {
				open = false;
				await goto(`/read/${existing.id}`);
				return;
			}
			const pdf = await openPdf(await file.arrayBuffer(), pdfPassword);
			const first = await pdf.getPage(1);
			const cover = await coverBlob(first);
			const meta = await pdf.getMetadata().catch(() => null);
			const info = meta?.info as { Title?: string } | undefined;
			const title = info?.Title?.trim() || file.name.replace(/\.pdf$/i, '');
			const book: Book = {
				id: randomId(),
				title,
				sourceHash: hash,
				pageCount: pdf.numPages,
				addedAt: Date.now(),
				blobId: randomId(),
				coverId: randomId()
			};
			await saveBook(book, file, cover);
			await pdf.cleanup();
			open = false;
			pendingFile = null;
			password = '';
			needsPassword = false;
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

	function takeFile(file: File | null | undefined) {
		if (!file || busy) return;
		if (fileInput) fileInput.value = '';
		if (!isPdf(file)) {
			picked = null;
			pendingFile = null;
			needsPassword = false;
			error = 'Choose a PDF file.';
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
</script>

<AppHeader />

<main class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Library</h1>
			<p class="text-muted-foreground mt-1 max-w-xl text-sm">
				Add a PDF you own. It stays in this browser. Sparse pages are read with OCR, and speech can use the browser voice or a model from Settings.
			</p>
		</div>
		<Button onclick={() => (open = true)}>Add book</Button>
	</div>

	{#if books.length === 0}
		<Card.Root class="border-dashed">
			<Card.Header>
				<Card.Title>No books yet</Card.Title>
				<Card.Description>Drop in a text-layer PDF to open it and hear the page.</Card.Description>
			</Card.Header>
			<Card.Footer>
				<Button variant="secondary" onclick={() => (open = true)}>Add book</Button>
			</Card.Footer>
		</Card.Root>
	{:else}
		<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each books as book (book.id)}
				<li>
					<Card.Root class="overflow-hidden">
						<a href="/read/{book.id}" class="bg-muted block h-64 overflow-hidden">
							{#if covers[book.id]}
								<img src={covers[book.id]} alt="" class="h-full w-full object-cover object-top" />
							{/if}
						</a>
						<Card.Header>
							<Card.Title class="line-clamp-2 text-base">{book.title}</Card.Title>
							<Card.Description>{book.pageCount} pages</Card.Description>
						</Card.Header>
						<Card.Footer class="gap-2">
							<Badge>Ready to read</Badge>
							<Button class="ml-auto" variant="ghost" size="sm" onclick={() => remove(book)}>Remove</Button>
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
			<Dialog.Description>PDF files stay in this browser. Pages with little or no text layer are read with OCR.</Dialog.Description>
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
					<span class="text-sm font-medium">{busy ? 'Adding the PDF…' : dragging ? 'Drop the PDF' : 'Drop a PDF here'}</span>
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
					accept="application/pdf,.pdf"
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
			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
