<script lang="ts">
	import { goto } from '$app/navigation';
	import AppHeader from '#lib/components/app-header.svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { deleteBook, getBlob, listBooks, type Book } from '#lib/db.js';
	import { savePdfFile } from '#lib/library.js';
	import { isPasswordError } from '#lib/pdf.js';

	let books = $state<Book[]>([]);
	let covers = $state<Record<string, string>>({});
	let storage = $state<{ used: number; quota: number } | null>(null);
	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	let password = $state('');
	let pendingFile = $state<File | null>(null);
	let needsPassword = $state(false);

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
			const saved = await savePdfFile(file, pdfPassword);
			open = false;
			pendingFile = null;
			password = '';
			needsPassword = false;
			if (saved.existing) {
				await goto(`/read/${saved.book.id}`);
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

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		needsPassword = false;
		password = '';
		await storeFile(file);
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
				Add a PDF you own, or browse books that are free to keep. Either way it stays in this browser.
			</p>
		</div>
		<div class="flex gap-2">
			<Button href="/open" variant="secondary">Browse open books</Button>
			<Button onclick={() => (open = true)}>Add book</Button>
		</div>
	</div>

	{#if books.length === 0}
		<Card.Root class="border-dashed">
			<Card.Header>
				<Card.Title>No books yet</Card.Title>
				<Card.Description>Add a PDF you own, or browse books that are free to keep. Either way it stays in this browser.</Card.Description>
			</Card.Header>
			<Card.Footer class="gap-2">
				<Button href="/open" variant="secondary">Browse open books</Button>
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
							<Card.Description>
								{book.pageCount} pages{book.chapters && book.chapters.length > 1 ? ` · ${book.chapters.length} chapters` : ''}
							</Card.Description>
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

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Add a book</Dialog.Title>
			<Dialog.Description>PDF files stay in this browser. Pages with little or no text layer are read with OCR.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3">
			<Label for="book-file">PDF</Label>
			<Input id="book-file" type="file" accept="application/pdf,.pdf" onchange={onFile} disabled={busy} />
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
