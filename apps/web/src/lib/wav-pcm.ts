/** Longest microphone take stored as a Pocket reference clip. */
export const RECORD_SECONDS = 12;

export function pcmToWav(samples: Float32Array, sampleRate: number): Blob {
	const bytes = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(bytes);
	const stamp = (offset: number, text: string) => {
		for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
	};
	stamp(0, 'RIFF');
	view.setUint32(4, 36 + samples.length * 2, true);
	stamp(8, 'WAVE');
	stamp(12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	stamp(36, 'data');
	view.setUint32(40, samples.length * 2, true);
	let offset = 44;
	for (let index = 0; index < samples.length; index += 1) {
		const clipped = Math.max(-1, Math.min(1, samples[index] ?? 0));
		view.setInt16(offset, clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff), true);
		offset += 2;
	}
	return new Blob([bytes], { type: 'audio/wav' });
}
