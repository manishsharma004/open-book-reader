import assert from 'node:assert/strict';
import test from 'node:test';
import { wordHits, type MarkPiece } from '../src/lib/spoken-marks.ts';

function covered(pieces: MarkPiece[], hits: { piece: number; start: number; end: number }[][]) {
	return hits.map((slices) => slices.map((slice) => pieces[slice.piece].text.slice(slice.start, slice.end)).join(''));
}

test('spoken words land on the column pieces, including a ligature and a split word', () => {
	const pieces: MarkPiece[] = [
		{ text: 'Chapter I.', block: true },
		{ text: 'It is a truth ', block: true },
		{ text: 'universally acknowledged.', block: false },
		{ text: 'A di', block: true },
		{ text: '\uFB00', block: false },
		{ text: 'erent day.', block: false }
	];
	const words = ['Chapter', 'I.', 'It', 'is', 'a', 'truth', 'universally', 'acknowledged.', 'A', 'different', 'day.'];
	const hits = wordHits(pieces, words);
	assert.deepEqual(covered(pieces, hits).slice(0, 8), words.slice(0, 8));
	assert.equal(covered(pieces, hits)[9], 'di\uFB00erent');
	assert.equal(hits[9].length, 3);
});
