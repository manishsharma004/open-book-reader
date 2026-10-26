import assert from 'node:assert/strict';
import test from 'node:test';
import { companionPage, spreadActive, turnTarget } from '../src/lib/spread.ts';

test('a spread needs the toggle, two pages, and a wide stage', () => {
	assert.equal(spreadActive(true, 1100, 700, 12), true);
	assert.equal(spreadActive(false, 1100, 700, 12), false);
	assert.equal(spreadActive(true, 1100, 700, 1), false);
	assert.equal(spreadActive(true, 719, 400, 12), false);
	assert.equal(spreadActive(true, 800, 900, 12), false);
	assert.equal(spreadActive(true, 720, 600, 2), true);
});

test('the right page is the next page, and the last page stands alone', () => {
	assert.equal(companionPage(0, 5, true), 1);
	assert.equal(companionPage(4, 5, true), -1);
	assert.equal(companionPage(0, 5, false), -1);
});

test('a manual turn steps by two while the spread is open', () => {
	assert.equal(turnTarget(0, 5, 1, true), 2);
	assert.equal(turnTarget(2, 5, -1, true), 0);
	assert.equal(turnTarget(4, 5, 1, true), 4);
	assert.equal(turnTarget(4, 5, -1, true), 2);
	assert.equal(turnTarget(3, 5, 1, true), 4);
	assert.equal(turnTarget(1, 5, 1, false), 2);
	assert.equal(turnTarget(0, 5, -1, false), 0);
});
