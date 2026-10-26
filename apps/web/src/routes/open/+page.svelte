<script lang="ts">
	import { goto } from '$app/navigation';
	import AppHeader from '#lib/components/app-header.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { savePdfFile, saveTextFile } from '#lib/library.js';
	import {
		coverPath,
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

	const provider = $derived(providers.find((item) => item.id === providerId) ?? null);

	async function loadProviders() {
		try {
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

	async function runSearch(page: string | null) {
		if (!provider) return;
		busy = 'search';
		error = '';
		try {
			const found = await searchOpenBooks(provider.id, provider.search ? query.trim() : '', language, page);
			books = page ? [...books, ...found.books] : found.books;
			nextPage = found.page;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Open books need the network. The books already in this browser are still here.';
		} finally {
			busy = '';
		}
	}

	function chooseProvider(id: string) {
		providerId = id;
		const next = providers.find((item) => item.id === id);
		if (next && !next.languages.includes(language)) language = next.languages[0] ?? language;
		books = [];
		nextPage = null;
		void runSearch(null);
	}

	async function add(book: OpenBook, format: OpenFormat) {
		if (!format.addable) return;
		busy = book.id;
		error = '';
		try {
			const file = await downloadOpenBook(book.provider, book.id, format.mediaType, book.title);
			const saved =
				format.mediaType === 'application/pdf' ? await savePdfFile(file) : await saveTextFile(file, book.title);
			await goto(`/read/${saved.book.id}`);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not keep that file.';
			busy = '';
		}
	}
</script>

<AppHeader />

<main class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8" data-open-books>
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">Open books</h1>
			<p class="text-muted-foreground mt-1 max-w-xl text-sm">
				The search is sent to that provider through the app server and is not kept. A file you add stays in this browser.
			</p>
		</div>
		<Button href="/" variant="ghost">Library</Button>
	</div>

	{#if !loaded}
		<p class="text-muted-foreground text-sm">Loading providers…</p>
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
				disabled={!provider?.search || busy === 'search'}
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
			<Button type="submit" disabled={busy === 'search'}>Search</Button>
		</form>

		{#if error}
			<p class="text-destructive text-sm">{error}</p>
		{/if}

		<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each books as book (`${book.provider}:${book.id}`)}
				<li>
					<Card.Root>
						<div class="bg-muted h-40 overflow-hidden">
							<img
								src={coverPath(book.provider, book.id)}
								alt=""
								class="h-full w-full object-cover object-top"
								onerror={(event) => ((event.currentTarget as HTMLImageElement).style.display = 'none')}
							/>
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
									title={format.addable ? '' : 'EPUB is not paginated yet.'}
									onclick={() => add(book, format)}
								>
									{format.addable ? `Add ${format.label.toLowerCase()}` : format.label}
								</Button>
							{/each}
						</Card.Footer>
					</Card.Root>
				</li>
			{/each}
		</ul>

		{#if nextPage}
			<Button variant="secondary" disabled={busy === 'search'} onclick={() => runSearch(nextPage)}>Next page</Button>
		{/if}
	{/if}
</main>
