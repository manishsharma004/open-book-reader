import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignWordRoles, spokenClipText, type RoleWord } from '../src/lib/page-roles.ts';

function word(text: string, x: number, y: number, h: number): RoleWord {
	return { text, x, y, h };
}

test('a larger chapter line is a title and a margin number is a header', () => {
	const body = ['Mara', 'waited', 'at', 'the', 'empty', 'station', 'today', 'again.'].map((text, index) =>
		word(text, 72 + index * 40, 600, 12)
	);
	const words = [word('12', 300, 760, 9), word('Chapter', 72, 640, 22), word('1', 150, 640, 22), ...body, word('4', 300, 24, 9)];
	const roles = assignWordRoles(words, 792);
	assert.equal(roles[0], 'header');
	assert.equal(roles[1], 'heading');
	assert.equal(roles[2], 'heading');
	assert.ok(roles.slice(3, 11).every((role) => role === 'body'));
	assert.equal(roles.at(-1), 'header');
});

test('a body-sized chapter label is a title and a sentence that starts with Chapter is prose', () => {
	const prose = ['houses', 'were', 'built', 'along', 'the', 'road', 'today.'].map((text, index) =>
		word(text, 110 + index * 36, 500, 12)
	);
	const words = [
		word('Chapter', 72, 640, 12),
		word('4', 140, 640, 12),
		...['Mara', 'waited', 'at', 'the', 'empty', 'station', 'today', 'again.'].map((text, index) =>
			word(text, 72 + index * 36, 580, 12)
		),
		word('Chapter', 72, 500, 12),
		...prose
	];
	const roles = assignWordRoles(words, 792);
	assert.equal(roles[0], 'heading');
	assert.equal(roles[1], 'heading');
	assert.ok(roles.slice(2, 10).every((role) => role === 'body'));
	assert.ok(roles.slice(10).every((role) => role === 'body'));
});

test('a short line in capitals is a title', () => {
	const words = [
		word('THE', 72, 640, 12),
		word('GATE', 120, 640, 12),
		...['Mara', 'waited', 'at', 'the', 'empty', 'station', 'today', 'again.'].map((text, index) =>
			word(text, 72 + index * 36, 580, 12)
		)
	];
	const roles = assignWordRoles(words, 792);
	assert.deepEqual(roles.slice(0, 2), ['heading', 'heading']);
	assert.ok(roles.slice(2).every((role) => role === 'body'));
});

test('a two-line title is spoken with a pause and a closing stop', () => {
	const spoken = spokenClipText([
		{ text: 'Chapter', x: 72, y: 640, h: 22, role: 'heading' },
		{ text: '1', x: 160, y: 640, h: 22, role: 'heading' },
		{ text: 'The', x: 72, y: 600, h: 18, role: 'heading' },
		{ text: 'Station', x: 120, y: 600, h: 18, role: 'heading' }
	]);
	assert.equal(spoken, 'Chapter 1. The Station.');
});
