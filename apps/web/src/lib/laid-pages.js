/** True when every page already laid still has the same text and the list only grows. */
export function extendsLaidPages(previous, next) {
	if (!previous || !next || next.length < previous.length) return false;
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) return false;
	}
	return true;
}

export function chapterCount(nodes) {
	if (!nodes?.length) return 0;
	let count = 0;
	for (const node of nodes) {
		count += 1;
		if (node.children?.length) count += chapterCount(node.children);
	}
	return count;
}

/**
 * A later spine file adds chapters. A fresh pass starts again at the first file,
 * and publishing that shorter list put the reader back on chapter 1.
 */
export function publishChapters(previous, next, done) {
	const kept = previous ?? [];
	if (!next?.length) return kept;
	if (done || chapterCount(next) >= chapterCount(kept)) return next;
	return kept;
}

/** Page count grows as sections are measured, then settles when the pass finishes. */
export function publishPageCount(previous, laid, done) {
	const count = Math.max(laid, 1);
	if (done) return count;
	return Math.max(count, previous || 0, 1);
}
