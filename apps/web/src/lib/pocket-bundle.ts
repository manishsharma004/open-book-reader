/** Find a Pocket ONNX bundle and its voice embeddings from a repo or folder URL. */

export type HuggingFaceRef = {
	repo: string;
	rev: string;
	path: string;
};

const VOICE_FILE = /(?:^|\/)(?:embeddings|voices)\/([^/]+)\.(safetensors|npy)$/i;

export function parseHuggingFaceUrl(input: string): HuggingFaceRef | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.hostname !== 'huggingface.co' && url.hostname !== 'www.huggingface.co') return null;
	const parts = url.pathname.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	const repo = `${parts[0]}/${parts[1]}`;
	if (parts.length === 2) return { repo, rev: 'main', path: '' };
	const kind = parts[2];
	if (kind !== 'tree' && kind !== 'resolve' && kind !== 'blob') return null;
	const rev = parts[3] || 'main';
	let rest = parts.slice(4).join('/');
	if (kind === 'blob' || /\/[^/]+\.[a-z0-9]+$/i.test(rest)) rest = rest.slice(0, rest.lastIndexOf('/'));
	return { repo, rev, path: rest.replace(/\/$/, '') };
}

export function hfResolve(repo: string, rev: string, path: string): string {
	const suffix = path.replace(/^\/+|\/+$/g, '');
	return suffix
		? `https://huggingface.co/${repo}/resolve/${rev}/${suffix}`
		: `https://huggingface.co/${repo}/resolve/${rev}`;
}

function joinPath(...parts: string[]) {
	return parts
		.map((part) => part.replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/');
}

export function bundleDirectories(input: string, model: string): string[] {
	const trimmed = input.trim().replace(/\/$/, '');
	const language = model.trim();
	const found: string[] = [];
	const push = (value: string) => {
		const clean = value.replace(/\/$/, '');
		if (clean && !found.includes(clean)) found.push(clean);
	};
	const hf = parseHuggingFaceUrl(trimmed);
	if (!hf) {
		if (!trimmed) return found;
		if (language) {
			push(`${trimmed}/${language}`);
			push(`${trimmed}/onnx/${language}`);
		}
		push(trimmed);
		push(`${trimmed}/onnx`);
		return found;
	}
	const at = (path: string) => hfResolve(hf.repo, hf.rev, path);
	if (hf.path) push(at(hf.path));
	if (language) {
		push(at(joinPath(hf.path, language)));
		push(at(joinPath(hf.path, 'onnx', language)));
		if (hf.path !== 'onnx' && !hf.path.endsWith('/onnx')) push(at(joinPath('onnx', language)));
	}
	push(at(joinPath(hf.path, 'onnx')));
	push(at(hf.path));
	return found;
}

export function parentPath(file: string): string {
	const slash = file.lastIndexOf('/');
	return slash === -1 ? '' : file.slice(0, slash);
}

export function pickBundlePath(files: string[], model: string, hintedPath: string): string | null {
	const bundles = files.filter((file) => file === 'bundle.json' || file.endsWith('/bundle.json'));
	if (!bundles.length) return null;
	const hint = hintedPath.replace(/\/$/, '');
	if (hint) {
		const exact = bundles.find((file) => parentPath(file) === hint);
		if (exact) return parentPath(exact);
	}
	const language = model.trim();
	if (language) {
		const named = bundles.find((file) => {
			const folder = parentPath(file);
			return folder === language || folder.endsWith(`/${language}`);
		});
		if (named) return parentPath(named);
	}
	const quantized = bundles.find((file) => {
		const folder = parentPath(file);
		const prefix = folder ? `${folder}/` : '';
		return files.some((item) => item.startsWith(prefix) && item.endsWith('_int8.onnx'));
	});
	return parentPath(quantized ?? bundles[0]);
}

export function voiceFilesFromRepo(files: string[], bundlePath: string, repo: string, rev: string): Record<string, string> {
	const prefix = bundlePath.replace(/\/$/, '');
	const scored = new Map<string, { url: string; score: number }>();
	for (const file of files) {
		const match = file.match(VOICE_FILE);
		if (!match || match[1] === 'bos_before_voice') continue;
		const score = prefix && file.startsWith(`${prefix}/`) ? 2 : file.includes('/embeddings/') ? 1 : 0;
		const previous = scored.get(match[1]);
		if (previous && previous.score >= score) continue;
		scored.set(match[1], { url: hfResolve(repo, rev, file), score });
	}
	return Object.fromEntries([...scored].map(([name, item]) => [name, item.url]));
}

export type LocatedBundle = {
	bundleBaseUrl: string;
	voiceFiles: Record<string, string>;
};

async function repoFiles(repo: string, rev: string): Promise<string[]> {
	const response = await fetch(`https://huggingface.co/api/models/${repo}/tree/${encodeURIComponent(rev)}?recursive=1`);
	if (!response.ok) return [];
	const rows = (await response.json()) as { type?: string; path?: string }[];
	return rows.filter((row) => row.type === 'file' && row.path).map((row) => row.path as string);
}

async function hasBundle(directory: string): Promise<boolean> {
	const response = await fetch(`${directory}/bundle.json`);
	return response.ok;
}

export async function locatePocketBundle(baseUrl: string, model: string): Promise<LocatedBundle> {
	const hf = parseHuggingFaceUrl(baseUrl);
	const files = hf ? await repoFiles(hf.repo, hf.rev) : [];
	if (hf && files.length) {
		const picked = pickBundlePath(files, model, hf.path);
		if (picked !== null) {
			const bundleBaseUrl = hfResolve(hf.repo, hf.rev, picked);
			if (await hasBundle(bundleBaseUrl)) {
				return { bundleBaseUrl, voiceFiles: voiceFilesFromRepo(files, picked, hf.repo, hf.rev) };
			}
		}
	}
	for (const directory of bundleDirectories(baseUrl, model)) {
		if (await hasBundle(directory)) {
			const voiceFiles = hf ? voiceFilesFromRepo(files, new URL(directory).pathname.split('/').slice(5).join('/'), hf.repo, hf.rev) : {};
			return { bundleBaseUrl: directory, voiceFiles };
		}
	}
	throw new Error(
		'No bundle.json was found at that address. Paste a Hugging Face repo, a folder in that repo, or the folder that contains bundle.json.'
	);
}
