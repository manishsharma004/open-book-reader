import assert from 'node:assert/strict';
import test from 'node:test';
import { pageFlick } from '../src/lib/page-flick.ts';

test('a quick horizontal flick turns the page', () => {
	assert.equal(pageFlick(-120, 10, 180, false), 1);
	assert.equal(pageFlick(120, 8, 200, false), -1);
});

test('a slow drag and a text selection do not turn the page', () => {
	assert.equal(pageFlick(-180, 4, 700, false), 0);
	assert.equal(pageFlick(-180, 4, 120, true), 0);
	assert.equal(pageFlick(-40, 0, 100, false), 0);
	assert.equal(pageFlick(-90, 120, 150, false), 0);
});
