import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const build = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const index = join(build, 'index.html');
if (!existsSync(index)) {
	console.error('Missing build/index.html');
	process.exit(1);
}
copyFileSync(index, join(build, '404.html'));
