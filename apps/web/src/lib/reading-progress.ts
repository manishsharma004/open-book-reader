export type ReadingProgress = {
	pageIndex: number;
	wordIndex: number;
};

/** Keep a saved page inside the book and a word at or after the first word. */
export function clampProgress(pageCount: number, pageIndex: number, wordIndex: number): ReadingProgress {
	const pages = Number.isFinite(pageCount) && pageCount > 0 ? Math.floor(pageCount) : 1;
	const page = Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0;
	const word = Number.isFinite(wordIndex) ? Math.floor(wordIndex) : 0;
	return {
		pageIndex: Math.min(pages - 1, Math.max(0, page)),
		wordIndex: Math.max(0, word)
	};
}

export function storedProgress(book: { pageCount?: number; progress?: Partial<ReadingProgress> | null } | null | undefined): ReadingProgress {
	const progress = book?.progress;
	if (!progress) return { pageIndex: 0, wordIndex: 0 };
	return clampProgress(book?.pageCount ?? 1, Number(progress.pageIndex), Number(progress.wordIndex));
}

export function sameProgress(saved: Partial<ReadingProgress> | null | undefined, next: ReadingProgress) {
	return saved?.pageIndex === next.pageIndex && saved?.wordIndex === next.wordIndex;
}
