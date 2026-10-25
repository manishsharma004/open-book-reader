import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomId, sha256, sha256Bytes } from '../src/lib/hash.ts';

function text(value: string) {
	return new TextEncoder().encode(value);
}

test('sha256 matches the empty and abc vectors', () => {
	assert.equal(
		Buffer.from(sha256Bytes(text(''))).toString('hex'),
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
	);
	assert.equal(
		Buffer.from(sha256Bytes(text('abc'))).toString('hex'),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
	);
});

test('sha256 matches a multi-block message', () => {
	const message = text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
	assert.equal(
		Buffer.from(sha256Bytes(message)).toString('hex'),
		'248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
	);
});

test('sha256 uses the local implementation when subtle is missing', async () => {
	const file = new Blob([text('abc')]);
	const subtle = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle');
	Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
	try {
		assert.equal(await sha256(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	} finally {
		if (subtle) Object.defineProperty(globalThis.crypto, 'subtle', subtle);
	}
});

test('randomId still returns an id when randomUUID throws', () => {
	const original = crypto.randomUUID;
	crypto.randomUUID = () => {
		throw new Error('insecure');
	};
	try {
		assert.match(randomId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	} finally {
		crypto.randomUUID = original;
	}
});
