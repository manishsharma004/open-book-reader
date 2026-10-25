/** Word timing used to follow speech when the engine does not report boundaries. */

export type WordTiming = { wordIndex: number; start: number; end: number };

export function wordDurations(texts: string[], rate: number): number[] {
	const speed = Math.min(2, Math.max(0.5, rate || 1));
	return texts.map((text) => {
		const trimmed = text.trim();
		const body = Math.max(1, trimmed.length);
		let ms = (body * 70 + 80) / speed;
		if (/[.!?…]$/.test(trimmed)) ms += 220 / speed;
		else if (/[,;:]$/.test(trimmed)) ms += 110 / speed;
		return ms;
	});
}

export function indexAt(durations: number[], elapsedMs: number): number {
	if (durations.length === 0) return -1;
	let covered = 0;
	for (let index = 0; index < durations.length; index += 1) {
		covered += durations[index];
		if (elapsedMs < covered) return index;
	}
	return durations.length - 1;
}

export function elapsedBefore(durations: number[], index: number): number {
	let covered = 0;
	const end = Math.max(0, Math.min(index, durations.length));
	for (let cursor = 0; cursor < end; cursor += 1) covered += durations[cursor];
	return covered;
}

export function indexForTimings(timings: WordTiming[], time: number): number {
	let hit = -1;
	for (const timing of timings) {
		if (time >= timing.start) hit = timing.wordIndex;
		if (time >= timing.start && time < timing.end) return timing.wordIndex;
	}
	return hit;
}

export function timeForWord(texts: string[], wordIndex: number, duration: number, rate: number): number {
	if (wordIndex <= 0 || duration <= 0) return 0;
	const durations = wordDurations(texts, rate);
	const total = durations.reduce((sum, item) => sum + item, 0) || 1;
	const ratio = elapsedBefore(durations, wordIndex) / total;
	return Math.min(duration, Math.max(0, ratio * duration));
}
