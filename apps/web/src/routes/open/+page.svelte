<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { appServer } from '#lib/app-server.js';
	import AppHeader from '#lib/components/app-header.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { saveEpubFile, savePdfFile, saveTextFile } from '#lib/library.js';
	import {
		coverPath,
		downloadCover,
		downloadOpenBook,
		listProviders,
		searchOpenBooks,
		type OpenBook,
		type OpenFormat,
		type OpenProvider
	} from '#lib/open-books.js';

	let providers = $state<OpenProvider[]>([]);
	let providerId = $state('');
	let query = $state('');
	let language = $state('');
	let books = $state<OpenBook[]>([]);
	let nextPage = $state<string | null>(null);
	let busy = $state('');
	let error = $state('');
	let loaded = $state(false);
	let browserCatalog = $state(false);
	let searchGen = 0;

	const provider = $derived(providers.find((item) => item.id === providerId) ?? null);
	const saving = $derived(books.find((book) => book.id === busy) ?? null);

	async function loadProviders() {
		try {
			browserCatalog = !(await appServer()).present;
			providers = await listProviders();
			providerId = providers[0]?.id ?? '';
			const browser = navigator.language?.slice(0, 2).toLowerCase() ?? 'en';
			language = providers[0]?.languages.includes(browser) ? browser : (providers[0]?.languages[0] ?? 'en');
			loaded = true;
			if (providerId) await runSearch(null);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Open books need the network. The books already in this browser are still here.';
			loaded = true;
		}
	}

	$effect(() => {
		if (loaded || providers.length) return;
		void loadProviders();
	});

	async function runSearch(page: string | null, id = providerId) {
		const current = providers.find((item) => item.id === id);
		if (!current) return;
		const gen = ++searchGen;
		const fresh = page == null;
		busy = fresh ? 'search' : 'more';
		error = '';
		if (fresh) books = [];
		try {
			const found = await searchOpenBooks(current.id, current.search ? query.trim() : '', language, page);
			if (gen !== searchGen) return;
			books = page ? [...books, ...found.books] : found.books;
			nextPage = found.page;
		} catch (caught) {
			if (gen !== searchGen) return;
			error = caught instanceof Error ? caught.message : 'Open books need the network. The books already in this browser are still here.';
		} finally {
			if (gen === searchGen && (busy === 'search' || busy === 'more')) busy = '';
		}
	}

	function chooseProvider(id: string) {
		providerId = id;
		const next = providers.find((item) => item.id === id);
		if (next && !next.languages.includes(language)) language = next.languages[0] ?? language;
		books = [];
		nextPage = null;
		void runSearch(null, id);
	}

	async function add(book: OpenBook, format: OpenFormat) {
		if (!format.addable) return;
		busy = book.id;
		error = '';
		try {
			const [file, cover] = await Promise.all([
				downloadOpenBook(book.provider, book.id, format.mediaType, book.title),
				downloadCover(book.provider, book.id)
			]);
			const saved =
				format.mediaType === 'application/pdf'
					? await savePdfFile(file, undefined, cover)
					: format.mediaType === 'application/epub+zip'
						? await saveEpubFile(file, book.title, cover)
						: await saveTextFile(file, book.title, cover);
			await goto(resolve('/read/[id]', { id: saved.book.id }));
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not keep that file.';
			if (busy === book.id) busy = '';
		}
	}
</script>

<AppHeader />

<main class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8" data-open-books aria-busy={busy === 'search' || !loaded}>
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Open books</h1>
			<p class="text-muted-foreground mt-1 max-w-xl text-sm">
				{#if browserCatalog}
					Project Gutenberg text and PDF load in this browser. EPUB and the other catalogs need the Open Book Reader server. A file you add stays in this browser.
				{:else}
					The search is sent to that provider through the app server and is not kept. A file you add stays in this browser.
				{/if}
			</p>
		</div>
		<Button href={resolve('/')} variant="ghost">Library</Button>
	</div>

	{#if !loaded}
		<div class="bg-card border-border flex w-72 flex-col items-center gap-3 rounded-xl border px-6 py-5 shadow-sm" data-catalog-loader>
			<div class="border-muted border-t-primary size-10 animate-spin rounded-full border-2"></div>
			<p class="text-sm font-medium">Loading catalogs…</p>
		</div>
	{:else if providers.length === 0}
		<p class="text-sm">Open books need the network. The books already in this browser are still here.</p>
	{:else}
		<div class="flex flex-wrap gap-2" data-providers>
			{#each providers as item (item.id)}
				<Button
					variant={item.id === providerId ? 'default' : 'outline'}
					size="sm"
					onclick={() => chooseProvider(item.id)}
				>
					{item.name}
				</Button>
			{/each}
		</div>

		{#if provider && !provider.search}
			<p class="text-muted-foreground text-sm">{provider.note || 'This catalog has a fixed list.'}</p>
		{/if}

		<form
			class="flex flex-wrap items-center gap-2"
			onsubmit={(event) => {
				event.preventDefault();
				void runSearch(null);
			}}
		>
			<Input
				class="max-w-sm"
				placeholder={provider?.search ? 'Search' : provider?.note || 'Fixed list'}
				bind:value={query}
				disabled={!provider?.search || busy === 'search' || busy === 'more'}
				aria-label="Search"
			/>
			<select
				class="border-input bg-background h-8 rounded-lg border px-2 text-sm"
				bind:value={language}
				aria-label="Language"
				onchange={() => runSearch(null)}
			>
				{#each provider?.languages ?? [] as code (code)}
					<option value={code}>{code}</option>
				{/each}
			</select>
			<Button type="submit" disabled={busy === 'search' || busy === 'more'}>Search</Button>
		</form>

		{#if error}
			<p class="text-destructive text-sm">{error}</p>
		{/if}

		{#if busy === 'search'}
			<div class="bg-card border-border flex w-72 flex-col items-center gap-3 rounded-xl border px-6 py-5 shadow-sm" data-books-loader>
				<div class="border-muted border-t-primary size-10 animate-spin rounded-full border-2"></div>
				<p class="text-sm font-medium">Loading books…</p>
			</div>
		{:else if saving}
			<div class="bg-card border-border flex w-80 items-center gap-3 rounded-xl border px-5 py-4 shadow-sm" data-save-loader>
				<div class="border-muted border-t-primary size-8 shrink-0 animate-spin rounded-full border-2"></div>
				<p class="text-sm font-medium">Saving {saving.title} in this browser…</p>
			</div>
		{:else if books.length === 0 && !error}
			<p class="text-muted-foreground text-sm">No books matched that search.</p>
		{/if}

		<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each books as book (`${book.provider}:${book.id}`)}
				{@const cover = coverPath(book.provider, book.id)}
				<li>
					<Card.Root>
						<div class="bg-muted flex items-center justify-center">
							{#if cover}
								<img
									src={cover}
									alt=""
									class="max-h-80 w-auto max-w-full object-contain"
									onerror={(event) => ((event.currentTarget as HTMLImageElement).style.display = 'none')}
								/>
							{/if}
						</div>
						<Card.Header>
							<Card.Title class="line-clamp-2 text-base">{book.title}</Card.Title>
							<Card.Description>
								{book.authors.join(', ') || 'Author unknown'}
								{#if book.languages.length}
									· {book.languages.join(', ')}
								{/if}
							</Card.Description>
						</Card.Header>
						<Card.Content class="text-muted-foreground text-sm">{book.licenseNote}</Card.Content>
						<Card.Footer class="flex-wrap gap-2">
							{#each book.formats as format (`${book.id}:${format.mediaType}`)}
								<Button
									size="sm"
									variant={format.addable ? 'default' : 'outline'}
									disabled={!format.addable || busy === book.id}
									title={format.addable ? '' : 'This catalog does not offer that format yet.'}
									onclick={() => add(book, format)}
								>
									{busy === book.id ? 'Adding…' : format.addable ? `Add ${format.label.toLowerCase()}` : format.label}
								</Button>
							{/each}
						</Card.Footer>
					</Card.Root>
				</li>
			{/each}
		</ul>

		{#if nextPage}
			<Button variant="secondary" disabled={busy === 'search' || busy === 'more'} onclick={() => runSearch(nextPage)}>
				{busy === 'more' ? 'Loading…' : 'Next page'}
			</Button>
		{/if}
	{/if}
</main>
