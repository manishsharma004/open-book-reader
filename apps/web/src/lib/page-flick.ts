/** A quick horizontal flick turns the page. Selecting text does not. */
export function pageFlick(dx: number, dy: number, elapsedMs: number, selecting: boolean): 1 | -1 | 0 {
	if (selecting) return 0;
	if (!Number.isFinite(elapsedMs) || elapsedMs > 400) return 0;
	if (Math.abs(dx) < 70) return 0;
	if (Math.abs(dx) <= Math.abs(dy)) return 0;
	return dx < 0 ? 1 : -1;
}
