import assert from 'node:assert/strict';
import test from 'node:test';
import { POCKET_VOICE_IDS, voiceCatalog } from '../src/lib/voice-ids.ts';

test('pocket and the on-device model list the same built-in voice ids', () => {
	const pocket = voiceCatalog('pocket');
	const device = voiceCatalog('pocket-device');
	assert.deepEqual(
		pocket.items.map((item) => item.id),
		[...POCKET_VOICE_IDS]
	);
	assert.deepEqual(device.items, pocket.items);
	assert.ok(pocket.note.includes('alba'));
});

test('each vendor has a note, and ElevenLabs has no invented ids', () => {
	assert.ok(voiceCatalog('kokoro').items.some((item) => item.id === 'af_heart'));
	assert.ok(voiceCatalog('openai').items.some((item) => item.id === 'alloy'));
	const eleven = voiceCatalog('elevenlabs');
	assert.equal(eleven.items.length, 0);
	assert.match(eleven.note, /ElevenLabs/);
});

test('browser voices show the name and the id', () => {
	const catalog = voiceCatalog('browser', [{ name: 'Ada', voiceURI: 'com.example.ada' }]);
	assert.deepEqual(catalog.items, [{ id: 'com.example.ada', label: 'Ada · com.example.ada' }]);
	assert.equal(voiceCatalog('browser').items.length, 0);
});
