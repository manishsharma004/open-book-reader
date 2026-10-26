import assert from 'node:assert/strict';
import test from 'node:test';
import { pcmToWav, RECORD_SECONDS } from '../src/lib/wav-pcm.ts';

test('a microphone buffer becomes a 16-bit mono wav', async () => {
	const samples = new Float32Array([0, 0.5, -1, 1.4]);
	const blob = pcmToWav(samples, 16000);
	assert.equal(blob.type, 'audio/wav');
	const bytes = new Uint8Array(await blob.arrayBuffer());
	assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
	assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
	const view = new DataView(bytes.buffer);
	assert.equal(view.getUint32(24, true), 16000);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint16(34, true), 16);
	assert.equal(view.getUint32(40, true), 8);
	assert.equal(view.getInt16(44, true), 0);
	assert.equal(view.getInt16(46, true), 16384);
	assert.equal(view.getInt16(48, true), -32768);
	assert.equal(view.getInt16(50, true), 32767);
	assert.equal(RECORD_SECONDS, 12);
});
