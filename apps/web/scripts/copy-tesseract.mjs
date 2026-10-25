import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { get } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'static/tesseract');
const langFile = resolve(out, 'lang/eng.traineddata.gz');
const langUrl = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz';

const copies = [
	['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
	[
		'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
		'tesseract-core-simd-lstm.wasm.js'
	],
	['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm']
];

await mkdir(resolve(out, 'lang'), { recursive: true });
for (const [from, to] of copies) {
	await copyFile(resolve(root, from), resolve(out, to));
}

let haveLang = false;
try {
	haveLang = (await stat(langFile)).size > 1_000_000;
} catch {
	haveLang = false;
}
if (!haveLang) {
	await download(langUrl, langFile);
}

function download(url, destination) {
	return new Promise((resolvePromise, reject) => {
		const file = createWriteStream(destination);
		const request = get(url, (response) => {
			if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
				file.close();
				download(response.headers.location, destination).then(resolvePromise, reject);
				return;
			}
			if (response.statusCode !== 200) {
				reject(new Error(`Language data download failed (${response.statusCode}).`));
				return;
			}
			response.pipe(file);
			file.on('finish', () => file.close(() => resolvePromise()));
		});
		request.on('error', reject);
	});
}
