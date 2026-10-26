import assert from 'node:assert/strict';
import test from 'node:test';
import { openBooksBase, openBooksUrl } from '../src/lib/open-books-api.ts';

test('an Open books API address is an http origin', () => {
	assert.equal(openBooksBase(''), '');
	assert.equal(openBooksBase('   '), '');
	assert.equal(openBooksBase('not a url'), '');
	assert.equal(openBooksBase('javascript:alert(1)'), '');
	assert.equal(openBooksBase('https://reader.example.com/'), 'https://reader.example.com');
	assert.equal(openBooksBase('https://reader.example.com/v1'), 'https://reader.example.com');
	assert.equal(openBooksBase('https://reader.example.com/app/v1/'), 'https://reader.example.com/app');
	assert.equal(
		openBooksUrl('https://reader.example.com', '/v1/open-books/providers'),
		'https://reader.example.com/v1/open-books/providers'
	);
});
