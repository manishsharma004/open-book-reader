import assert from 'node:assert/strict';
import test from 'node:test';
import { describePocketRun, pocketDeviceLabel, pocketDeviceProviders, pocketDeviceTitle } from '../src/lib/pocket-onnx/providers.js';

test('a page with WebNN asks for the NPU before the GPU and WASM', () => {
	const providers = pocketDeviceProviders(true);
	assert.deepEqual(
		providers.map((provider) => pocketDeviceLabel(provider)),
		['webnn-npu', 'webnn-gpu', 'wasm']
	);
});

test('a page without WebNN stays on WASM', () => {
	assert.deepEqual(pocketDeviceProviders(false), ['wasm']);
});

test('a running session is named NPU, GPU, or CPU', () => {
	assert.equal(pocketDeviceTitle('webnn-npu'), 'NPU');
	assert.equal(pocketDeviceTitle('webnn-gpu'), 'GPU');
	assert.equal(pocketDeviceTitle('wasm'), 'CPU');
	assert.deepEqual(describePocketRun('webnn-npu', true), { kind: 'npu', text: 'Running on the NPU.' });
	assert.deepEqual(describePocketRun('wasm', false), { kind: 'cpu', text: 'Running on the CPU.' });
	assert.equal(describePocketRun('', false).kind, 'cpu');
	assert.equal(describePocketRun('', true).kind, 'pending');
	assert.match(describePocketRun('', true).text, /NPU/);
});
