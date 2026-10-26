import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTtsVendorDefaults, defaultSettings, mergeSettings, POCKET_DEVICE_MODEL, POCKET_MODEL, POCKET_ONNX_BASE } from '../src/lib/settings.ts';

test('a saved pocket url on port 8000 moves to 7508', () => {
	const settings = mergeSettings({
		tts: { vendor: 'pocket', baseUrl: 'http://127.0.0.1:8000', voice: 'alba' }
	});
	assert.equal(settings.tts.baseUrl, 'http://127.0.0.1:7508');
});

test('a saved pocket vendor stays pocket', () => {
	const settings = mergeSettings({
		tts: {
			vendor: 'pocket',
			baseUrl: 'http://127.0.0.1:7508',
			model: POCKET_MODEL,
			voice: 'alba'
		}
	});
	assert.equal(settings.tts.vendor, 'pocket');
	assert.equal(settings.tts.baseUrl, 'http://127.0.0.1:7508');
});

test('choosing pocket rewrites a kokoro host and keeps the machine', () => {
	const settings = defaultSettings();
	settings.tts.baseUrl = 'http://127.0.0.1:8880/v1';
	settings.tts.vendor = 'pocket';
	applyTtsVendorDefaults(settings.tts, 'kokoro');
	assert.equal(settings.tts.baseUrl, 'http://127.0.0.1:7508');
	assert.equal(settings.tts.model, POCKET_MODEL);
	assert.equal(settings.tts.voice, 'alba');
});

test('choosing on-device pocket points at the public onnx bundle', () => {
	const settings = defaultSettings();
	settings.tts.vendor = 'pocket-device';
	applyTtsVendorDefaults(settings.tts, 'browser');
	assert.equal(settings.tts.model, POCKET_DEVICE_MODEL);
	assert.equal(settings.tts.voice, 'alba');
	assert.equal(settings.tts.baseUrl, POCKET_ONNX_BASE);
	const saved = mergeSettings({ tts: { vendor: 'pocket-device', model: POCKET_DEVICE_MODEL, voice: 'alba', baseUrl: POCKET_ONNX_BASE } });
	assert.equal(saved.tts.vendor, 'pocket-device');
	const fromServer = mergeSettings({ tts: { vendor: 'pocket-device', model: POCKET_DEVICE_MODEL, voice: 'anna', baseUrl: POCKET_ONNX_BASE } });
	assert.equal(fromServer.tts.voice, 'alba');
	const kept = mergeSettings({ tts: { vendor: 'pocket-device', model: POCKET_DEVICE_MODEL, voice: 'marius', baseUrl: POCKET_ONNX_BASE } });
	assert.equal(kept.tts.voice, 'marius');
});

test('choosing kokoro again restores the preset voice host', () => {
	const settings = defaultSettings();
	settings.tts.vendor = 'pocket';
	applyTtsVendorDefaults(settings.tts, 'browser');
	settings.tts.vendor = 'kokoro';
	applyTtsVendorDefaults(settings.tts, 'pocket');
	assert.equal(settings.tts.baseUrl, 'http://127.0.0.1:8880/v1');
	assert.equal(settings.tts.model, 'kokoro');
	assert.equal(settings.tts.voice, 'af_heart');
});
