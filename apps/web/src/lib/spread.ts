/** Two pages sit side by side only when the reader asked and the stage is wide. */
export function spreadActive(wanted: boolean, width: number, height: number, pageCount: number): boolean {
	if (!wanted || pageCount < 2 || width < 720 || height <= 0) return false;
	return width >= height * 1.15;
}

/** The page drawn on the right, or -1 when the spread is a single page. */
export function companionPage(pageIndex: number, pageCount: number, spread: boolean): number {
	if (!spread) return -1;
	const next = pageIndex + 1;
	return next < pageCount ? next : -1;
}

/** Manual turns move one leaf: two pages while a spread is open, one page otherwise. */
export function turnTarget(pageIndex: number, pageCount: number, direction: 1 | -1, spread: boolean): number {
	if (pageCount <= 0) return 0;
	const stride = spread ? 2 : 1;
	return Math.min(pageCount - 1, Math.max(0, pageIndex + direction * stride));
}
