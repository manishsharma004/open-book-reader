import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSafetensors } from '../src/lib/pocket-onnx/binary.js';
import { microphoneBlock } from '../src/lib/microphone.ts';
import {
	bundleDirectories,
	parseHuggingFaceUrl,
	pickBundlePath,
	voiceFilesFromRepo
} from '../src/lib/pocket-bundle.ts';

test('a repo, a tree folder, and a bundle file all become a folder address', () => {
	assert.deepEqual(parseHuggingFaceUrl('https://huggingface.co/lookbe/pocket-tts-onnx-v2'), {
		repo: 'lookbe/pocket-tts-onnx-v2',
		rev: 'main',
		path: ''
	});
	assert.equal(parseHuggingFaceUrl('https://huggingface.co/org/repo/tree/main/onnx')?.path, 'onnx');
	assert.equal(
		parseHuggingFaceUrl('https://huggingface.co/org/repo/blob/main/onnx/english_2026-04/bundle.json')?.path,
		'onnx/english_2026-04'
	);
	assert.equal(parseHuggingFaceUrl('http://127.0.0.1:7508'), null);
});

test('bundle search tries the language folder before the repo root', () => {
	const fromRepo = bundleDirectories('https://huggingface.co/vlapky/pocket-tts-onnx', 'english_2026-04');
	assert.equal(fromRepo[0], 'https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/english_2026-04');
	assert.ok(fromRepo.includes('https://huggingface.co/vlapky/pocket-tts-onnx/resolve/main/onnx/english_2026-04'));
	const fromFolder = bundleDirectories('https://huggingface.co/org/repo/tree/main/quant/english_q8', 'english_q8');
	assert.equal(fromFolder[0], 'https://huggingface.co/org/repo/resolve/main/quant/english_q8');
});

test('the file list prefers the hinted folder, then a quantized language folder', () => {
	const files = [
		'onnx/english_2026-04/bundle.json',
		'onnx/english_2026-04/flow_lm_main_int8.onnx',
		'legacy/bundle.json',
		'embeddings/narrator.safetensors'
	];
	assert.equal(pickBundlePath(files, 'english_2026-04', ''), 'onnx/english_2026-04');
	assert.equal(pickBundlePath(files, 'other', 'legacy'), 'legacy');
	assert.deepEqual(voiceFilesFromRepo(files, 'onnx/english_2026-04', 'org/repo', 'main'), {
		narrator: 'https://huggingface.co/org/repo/resolve/main/embeddings/narrator.safetensors'
	});
});

test('an insecure page explains why the microphone sheet cannot appear', () => {
	const blocked = microphoneBlock(false, false, 'http://127.0.0.1:7507');
	assert.match(blocked, /192\.168\.29\.45:7507/);
	assert.match(blocked, /audio file/);
	assert.equal(microphoneBlock(true, true, 'https://reader.example'), '');
	assert.match(microphoneBlock(true, false, 'https://reader.example'), /no microphone API/);
});

test('a safetensors voice state keeps its tensor key and floats', () => {
	const header = JSON.stringify({
		'flow_lm/cache': { dtype: 'F32', shape: [2], data_offsets: [0, 8] }
	});
	const headerBytes = new TextEncoder().encode(header);
	const body = new Uint8Array(8 + headerBytes.length + 8);
	const view = new DataView(body.buffer);
	view.setBigUint64(0, BigInt(headerBytes.length), true);
	body.set(headerBytes, 8);
	view.setFloat32(8 + headerBytes.length, 1.5, true);
	view.setFloat32(8 + headerBytes.length + 4, -2, true);
	const tensors = parseSafetensors(body.buffer);
	assert.deepEqual(tensors['flow_lm/cache'].shape, [2]);
	assert.equal(tensors['flow_lm/cache'].dtype, 'float32');
	assert.equal(tensors['flow_lm/cache'].data[0], 1.5);
	assert.equal(tensors['flow_lm/cache'].data[1], -2);
});
