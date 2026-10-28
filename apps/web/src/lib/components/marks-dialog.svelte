<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import type { Book } from '#lib/db.js';
	import { bookmarkForPage, defaultBookmarkLabel, noteHighlight, removeBookmark, removeHighlight, renameBookmark, upsertBookmark } from '#lib/marks.js';

	type Props = {
		open: boolean;
		books: Book[];
		focusId?: string;
		pageIndex?: number;
		chapterTitle?: string;
		selectionText?: string;
		onOpenChange: (open: boolean) => void;
		onBook: (book: Book) => void;
		onVisit: (bookId: string, pageIndex: number, wordIndex: number) => void;
		onHighlightSelection?: () => void;
	};

	let {
		open,
		books,
		focusId = '',
		pageIndex = 0,
		chapterTitle = '',
		selectionText = '',
		onOpenChange,
		onBook,
		onVisit,
		onHighlightSelection
	}: Props = $props();

	const focused = $derived(books.find((item) => item.id === focusId) ?? null);
	const shown = $derived(focused ? [focused] : books.filter((item) => (item.bookmarks?.length ?? 0) + (item.highlights?.length ?? 0) > 0));
	const currentBookmark = $derived(focused ? bookmarkForPage(focused.bookmarks, pageIndex) : undefined);
	let draft = $state('');
	let draftedFor = '';

	$effect(() => {
		const key = `${focused?.id ?? ''}:${pageIndex}:${currentBookmark?.label ?? ''}:${open}`;
		if (!open || key === draftedFor) return;
		draftedFor = key;
		draft = currentBookmark?.label ?? defaultBookmarkLabel(chapterTitle, pageIndex + 1);
	});

	function saveBookmark() {
		if (!focused) return;
		const label = draft.trim() || defaultBookmarkLabel(chapterTitle, pageIndex + 1);
		onBook({ ...focused, bookmarks: upsertBookmark(focused.bookmarks, { id: crypto.randomUUID(), pageIndex, label, createdAt: Date.now() }) });
	}

	const field = 'border-input bg-background h-8 w-full rounded-lg border px-2 text-sm';
</script>

<Dialog.Root {open} onOpenChange={onOpenChange}>
	<Dialog.Content class="max-h-[min(40rem,80vh)] overflow-y-auto sm:max-w-lg" data-marks-dialog>
		<Dialog.Header class="pr-8">
			<Dialog.Title>Marks</Dialog.Title>
			<Dialog.Description>Bookmarks and highlighted passages stay in this browser.</Dialog.Description>
		</Dialog.Header>
		{#if focused}
			<form
				class="grid gap-2"
				onsubmit={(event) => {
					event.preventDefault();
					saveBookmark();
				}}
			>
				<label class="grid gap-1 text-sm" for="bookmark-draft">Bookmark for page {pageIndex + 1}</label>
				<input id="bookmark-draft" class={field} bind:value={draft} data-bookmark-draft />
				<div class="flex gap-2">
					<Button type="submit" size="sm" data-save-bookmark>{currentBookmark ? 'Update bookmark' : 'Save bookmark'}</Button>
					{#if currentBookmark}
						<Button
							type="button"
							size="sm"
							variant="ghost"
							data-remove-current-bookmark
							onclick={() => focused && onBook({ ...focused, bookmarks: removeBookmark(focused.bookmarks, currentBookmark.id) })}
						>
							Remove
						</Button>
					{/if}
				</div>
			</form>
			{#if selectionText}
				<div class="bg-muted/50 grid gap-2 rounded-lg p-3" data-highlight-offer>
					<p class="line-clamp-3 text-sm">{selectionText}</p>
					<Button type="button" size="sm" data-save-highlight onclick={() => onHighlightSelection?.()}>Highlight selection</Button>
				</div>
			{/if}
		{/if}
		{#if shown.length === 0}
			<p class="text-muted-foreground text-sm" data-marks-empty>No bookmarks or highlights yet.</p>
		{/if}
		{#each shown as book (book.id)}
			<section class="grid gap-3" data-marks-book={book.id}>
				{#if !focused}
					<h3 class="text-sm font-medium">{book.title}</h3>
				{/if}
				<div class="grid gap-2">
					<h4 class="text-muted-foreground text-xs tracking-wide uppercase">Bookmarks</h4>
					{#if (book.bookmarks?.length ?? 0) === 0}
						<p class="text-muted-foreground text-sm">None yet.</p>
					{/if}
					{#each book.bookmarks ?? [] as item (item.id)}
						<div class="grid gap-1" data-bookmark={item.id} data-bookmark-page={item.pageIndex + 1}>
							<div class="flex items-center gap-2">
								<input
									class={field}
									value={item.label}
									aria-label={`Label for page ${item.pageIndex + 1}`}
									data-bookmark-label={item.id}
									onchange={(event) => onBook({ ...book, bookmarks: renameBookmark(book.bookmarks, item.id, event.currentTarget.value) })}
								/>
								<Button type="button" size="sm" variant="secondary" data-open-bookmark={item.id} onclick={() => onVisit(book.id, item.pageIndex, 0)}>
									Page {item.pageIndex + 1}
								</Button>
								<Button type="button" size="sm" variant="ghost" data-remove-bookmark={item.id} onclick={() => onBook({ ...book, bookmarks: removeBookmark(book.bookmarks, item.id) })}>
									Remove
								</Button>
							</div>
						</div>
					{/each}
				</div>
				<div class="grid gap-2">
					<h4 class="text-muted-foreground text-xs tracking-wide uppercase">Highlights</h4>
					{#if (book.highlights?.length ?? 0) === 0}
						<p class="text-muted-foreground text-sm">None yet.</p>
					{/if}
					{#each book.highlights ?? [] as item (item.id)}
						<div class="grid gap-1 rounded-lg border p-2" data-highlight={item.id} data-highlight-page={item.pageIndex + 1}>
							<p class="text-sm">{item.text}</p>
							<input
								class={field}
								value={item.note}
								placeholder="Note"
								aria-label="Note for this highlight"
								data-highlight-note={item.id}
								onchange={(event) => onBook({ ...book, highlights: noteHighlight(book.highlights, item.id, event.currentTarget.value) })}
							/>
							<div class="flex gap-2">
								<Button type="button" size="sm" variant="secondary" data-open-highlight={item.id} onclick={() => onVisit(book.id, item.pageIndex, item.wordStart)}>
									Page {item.pageIndex + 1}
								</Button>
								<Button type="button" size="sm" variant="ghost" data-remove-highlight={item.id} onclick={() => onBook({ ...book, highlights: removeHighlight(book.highlights, item.id) })}>
									Remove
								</Button>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</Dialog.Content>
</Dialog.Root>
