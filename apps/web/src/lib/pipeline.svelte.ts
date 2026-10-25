export type PipelineStage = 'text' | 'ocr' | 'emotion' | 'tts' | 'play' | 'buffer';
export type PipelineStatus = 'start' | 'ok' | 'skip' | 'error';

export type PipelineEvent = {
	id: number;
	at: number;
	page: number;
	stage: PipelineStage;
	status: PipelineStatus;
	ms: number | null;
	detail: string;
};

export const pipeline = $state({
	live: '',
	events: [] as PipelineEvent[]
});

let sequence = 0;

export function setPipelineLive(text: string) {
	pipeline.live = text;
}

export function logPipeline(entry: Omit<PipelineEvent, 'id' | 'at'>) {
	pipeline.events = [
		{ id: ++sequence, at: Date.now(), ...entry, detail: entry.detail.slice(0, 1500) },
		...pipeline.events
	].slice(0, 200);
	pipeline.live = '';
}

export async function timedStep<T>(
	page: number,
	stage: PipelineStage,
	run: () => Promise<{ detail: string; value: T } | { skip: string }>
): Promise<T | undefined> {
	const started = performance.now();
	logPipeline({ page, stage, status: 'start', ms: null, detail: 'Started' });
	try {
		const result = await run();
		const ms = Math.round(performance.now() - started);
		if ('skip' in result) {
			logPipeline({ page, stage, status: 'skip', ms, detail: result.skip });
			return undefined;
		}
		logPipeline({ page, stage, status: 'ok', ms, detail: result.detail });
		return result.value;
	} catch (error) {
		const ms = Math.round(performance.now() - started);
		const detail = error instanceof Error ? error.message : 'Failed';
		logPipeline({ page, stage, status: 'error', ms, detail });
		throw error;
	}
}
