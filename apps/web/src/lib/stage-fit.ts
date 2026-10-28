/** Scale a laid page down so the whole page stays inside the stage. Never scale it up. */
export function pageScale(stageW: number, stageH: number, pageW: number, pageH: number): number {
	if (stageW < 1 || stageH < 1 || pageW < 1 || pageH < 1) return 1;
	return Math.min(1, stageW / pageW, stageH / pageH);
}

/**
 * Automatic reflows stop after two tries at the same stage size.
 * A sidebar or a resize moves that size, and the count starts again.
 */
export function reflowBudgetFor(budget: number, spentW: number, spentH: number, width: number, height: number): number {
	if (Math.abs(width - spentW) >= 32 || Math.abs(height - spentH) >= 64) return 0;
	return budget;
}
