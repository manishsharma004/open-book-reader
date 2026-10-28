import type { PageBookmark, SavedHighlight } from '#lib/db.js';

export const MARK_TINT = 'rgba(250, 204, 21, 0.55)';

export function defaultBookmarkLabel(chapter: string | undefined, pageNumber: number): string {
	const title = chapter?.replace(/\s+/g, ' ').trim();
	const page = `Page ${pageNumber}`;
	if (!title) return page;
	return `${title}, ${page}`;
}

export function bookmarkForPage(list: PageBookmark[] | undefined, pageIndex: number): PageBookmark | undefined {
	return list?.find((item) => item.pageIndex === pageIndex);
}

/** One bookmark per page. Saving again keeps the same mark and replaces the label. */
export function upsertBookmark(list: PageBookmark[] | undefined, bookmark: PageBookmark): PageBookmark[] {
	const kept = (list ?? []).filter((item) => item.pageIndex !== bookmark.pageIndex);
	const previous = (list ?? []).find((item) => item.pageIndex === bookmark.pageIndex);
	const next = previous ? { ...previous, label: bookmark.label } : bookmark;
	return [...kept, next].sort((left, right) => left.pageIndex - right.pageIndex || left.createdAt - right.createdAt);
}

export function renameBookmark(list: PageBookmark[] | undefined, id: string, label: string): PageBookmark[] {
	const next = label.replace(/\s+/g, ' ').trim();
	return (list ?? []).map((item) => (item.id === id && next ? { ...item, label: next } : item));
}

export function removeBookmark(list: PageBookmark[] | undefined, id: string): PageBookmark[] {
	return (list ?? []).filter((item) => item.id !== id);
}

export function highlightExcerpt(words: string[], wordStart: number, wordEnd: number): string {
	const start = Math.max(0, Math.min(wordStart, words.length));
	const end = Math.max(start, Math.min(wordEnd, words.length));
	return words.slice(start, end).join(' ').replace(/\s+/g, ' ').trim();
}

/** The same passage updates its text and keeps the note. */
export function upsertHighlight(list: SavedHighlight[] | undefined, highlight: SavedHighlight): SavedHighlight[] {
	const previous = (list ?? []).find(
		(item) => item.pageIndex === highlight.pageIndex && item.wordStart === highlight.wordStart && item.wordEnd === highlight.wordEnd
	);
	const next = previous ? { ...previous, text: highlight.text } : highlight;
	const kept = (list ?? []).filter((item) => item !== previous);
	return [...kept, next].sort((left, right) => left.pageIndex - right.pageIndex || left.wordStart - right.wordStart);
}

export function noteHighlight(list: SavedHighlight[] | undefined, id: string, note: string): SavedHighlight[] {
	return (list ?? []).map((item) => (item.id === id ? { ...item, note: note.replace(/\s+/g, ' ').trim() } : item));
}

export function removeHighlight(list: SavedHighlight[] | undefined, id: string): SavedHighlight[] {
	return (list ?? []).filter((item) => item.id !== id);
}

export function highlightedWords(list: SavedHighlight[] | undefined, pageIndex: number): boolean[] {
	const flags: boolean[] = [];
	for (const item of list ?? []) {
		if (item.pageIndex !== pageIndex) continue;
		for (let index = item.wordStart; index < item.wordEnd; index += 1) flags[index] = true;
	}
	return flags;
}

/** Word indexes covered by the current selection, inclusive start and exclusive end. */
export function selectionWords(root: ParentNode, selection: Selection | null): { start: number; end: number } | null {
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
	const range = selection.getRangeAt(0);
	const indexes: number[] = [];
	for (const node of root.querySelectorAll('[data-ob-word], [data-word]')) {
		if (!(node instanceof Node) || !range.intersectsNode(node)) continue;
		const raw = node instanceof Element ? (node.getAttribute('data-ob-word') ?? node.getAttribute('data-word')) : null;
		const index = Number(raw);
		if (Number.isInteger(index)) indexes.push(index);
	}
	if (indexes.length === 0) return null;
	return { start: Math.min(...indexes), end: Math.max(...indexes) + 1 };
}
