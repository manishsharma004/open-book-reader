import assert from 'node:assert/strict';
import test from 'node:test';
import { pocketDeviceLabel, pocketDeviceProviders } from '../src/lib/pocket-onnx/providers.js';

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
