import assert from 'node:assert/strict';
import test from 'node:test';
import { clampProgress, sameProgress, storedProgress } from '../src/lib/reading-progress.ts';

test('a saved page stays inside the book', () => {
	assert.deepEqual(clampProgress(469, 24, 8), { pageIndex: 24, wordIndex: 8 });
	assert.deepEqual(clampProgress(10, 40, -3), { pageIndex: 9, wordIndex: 0 });
	assert.deepEqual(clampProgress(0, 4, 2), { pageIndex: 0, wordIndex: 2 });
	assert.deepEqual(storedProgress(undefined), { pageIndex: 0, wordIndex: 0 });
	assert.deepEqual(storedProgress({ pageCount: 12, progress: { pageIndex: 3, wordIndex: 5 } }), { pageIndex: 3, wordIndex: 5 });
	assert.equal(sameProgress({ pageIndex: 3, wordIndex: 5 }, { pageIndex: 3, wordIndex: 5 }), true);
	assert.equal(sameProgress({ pageIndex: 3, wordIndex: 5 }, { pageIndex: 4, wordIndex: 5 }), false);
});
