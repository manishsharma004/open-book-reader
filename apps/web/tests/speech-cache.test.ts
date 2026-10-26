import assert from 'node:assert/strict';
import test from 'node:test';
import { speechCacheId, speechMaterial } from '../src/lib/speech-cache.ts';

const clip = {
	text: 'It is a truth.',
	emotion: 'neutral',
	vendor: 'pocket',
	baseUrl: 'http://127.0.0.1:7508',
	model: 'pocket',
	voice: 'alice',
	sampleId: null
};

test('the same words and voice share one speech cache id', async () => {
	assert.equal(speechMaterial(clip), speechMaterial({ ...clip }));
	assert.notEqual(speechMaterial(clip), speechMaterial({ ...clip, text: 'It is a truth' }));
	assert.notEqual(speechMaterial(clip), speechMaterial({ ...clip, voice: 'bob' }));
	const left = await speechCacheId('book-a', clip);
	const right = await speechCacheId('book-a', clip);
	const other = await speechCacheId('book-b', clip);
	assert.equal(left, right);
	assert.notEqual(left, other);
});
