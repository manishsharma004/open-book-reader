import assert from 'node:assert/strict';
import test from 'node:test';
import { pageScale, reflowBudgetFor } from '../src/lib/stage-fit.ts';

test('a page drawn wider than the stage scales down to fit', () => {
	assert.equal(pageScale(800, 900, 1200, 900), 800 / 1200);
	assert.equal(pageScale(1000, 500, 800, 900), 500 / 900);
	assert.equal(pageScale(1000, 900, 800, 700), 1);
	assert.equal(pageScale(0, 900, 800, 700), 1);
});

test('a new stage size may lay the book out again', () => {
	assert.equal(reflowBudgetFor(2, 1400, 800, 1400, 800), 2);
	assert.equal(reflowBudgetFor(2, 1400, 800, 900, 800), 0);
	assert.equal(reflowBudgetFor(1, 900, 800, 910, 800), 1);
});
