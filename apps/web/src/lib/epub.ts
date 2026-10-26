import { unzipSync } from 'fflate';
import type { Chapter } from '#lib/chapters.js';

export type EpubToc = {
	title: string;
	href: string;
	children: EpubToc[];
};

export type EpubSection = {
	href: string;
};

export type ParsedEpub = {
	title: string;
	spine: EpubSection[];
	toc: EpubToc[];
	cover: Uint8Array | null;
	coverType: string;
	files: Map<string, Uint8Array>;
	mime: Map<string, string>;
};

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	css: 'text/css',
	html: 'application/xhtml+xml',
	xhtml: 'application/xhtml+xml',
	htm: 'application/xhtml+xml'
};

function decode(bytes: Uint8Array | undefined): string {
	if (!bytes) return '';
	return new TextDecoder('utf-8').decode(bytes);
}

function tidy(value: string): string {
	return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function joinPath(baseFile: string, relative: string): string {
	const clean = relative.split('#')[0].split('?')[0].trim();
	if (!clean || clean.startsWith('data:') || /^[a-z]+:/i.test(clean)) return '';
	const base = baseFile.split('/').slice(0, -1);
	const parts = clean.startsWith('/') ? clean.slice(1).split('/') : [...base, ...clean.split('/')];
	const out: string[] = [];
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') out.pop();
		else out.push(decodeURIComponent(part));
	}
	return out.join('/');
}

function attr(tag: string, name: string): string {
	const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
	return (match?.[1] ?? match?.[2] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function tagBlocks(xml: string, name: string): string[] {
	const found: string[] = [];
	const pattern = new RegExp(`<${name}\\b[^>]*(?:/>|>[\\s\\S]*?</${name}>)`, 'gi');
	for (const match of xml.matchAll(pattern)) found.push(match[0]);
	return found;
}

function fileMap(bytes: Uint8Array): Map<string, Uint8Array> {
	const files = new Map<string, Uint8Array>();
	for (const [path, data] of Object.entries(unzipSync(bytes))) {
		const key = path.replace(/\\/g, '/').replace(/^\/+/, '');
		if (!key || key.endsWith('/')) continue;
		files.set(key, data);
	}
	return files;
}

function rootfile(files: Map<string, Uint8Array>): string {
	const container = decode(files.get('META-INF/container.xml'));
	const tag = container.match(/<rootfile\b[^>]*>/i)?.[0] ?? '';
	const path = attr(tag, 'full-path');
	if (!path || path.includes('..')) throw new Error('This EPUB has no package.');
	return path;
}

function tocFromNcx(xml: string): EpubToc[] {
	const root: EpubToc[] = [];
	const stack: EpubToc[][] = [root];
	const pattern = /<navPoint\b[^>]*>|<\/navPoint>|<text>([\s\S]*?)<\/text>|<content\b[^>]*>/gi;
	let current: EpubToc | null = null;
	for (const match of xml.matchAll(pattern)) {
		const token = match[0];
		if (token.startsWith('<navPoint')) {
			current = { title: '', href: '', children: [] };
			stack[stack.length - 1].push(current);
			stack.push(current.children);
		} else if (token.startsWith('</navPoint')) {
			stack.pop();
			current = null;
		} else if (token.startsWith('<text') && current && !current.title) {
			current.title = tidy(match[1] ?? '').slice(0, 120);
		} else if (token.startsWith('<content') && current && !current.href) {
			current.href = attr(token, 'src');
		}
	}
	return root.filter((item) => item.title && item.href);
}

function tocFromNav(html: string): EpubToc[] {
	const nav = html.match(/<nav\b[^>]*epub:type="toc"[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i)?.[0];
	if (!nav) return [];
	const root: EpubToc[] = [];
	const stack: { list: EpubToc[]; item: EpubToc | null }[] = [{ list: root, item: null }];
	const pattern = /<ol\b[^>]*>|<\/ol>|<li\b[^>]*>|<a\b[^>]*>[\s\S]*?<\/a>/gi;
	for (const match of nav.matchAll(pattern)) {
		const token = match[0];
		const frame = stack[stack.length - 1];
		if (token.startsWith('<ol')) stack.push({ list: frame.item ? frame.item.children : frame.list, item: null });
		else if (token.startsWith('</ol') && stack.length > 1) stack.pop();
		else if (token.startsWith('<li')) frame.item = null;
		else if (token.startsWith('<a')) {
			const href = attr(token, 'href');
			const title = tidy(token).slice(0, 120);
			if (!title || !href || frame.item) continue;
			frame.item = { title, href, children: [] };
			frame.list.push(frame.item);
		}
	}
	return root;
}

export function spineIndex(spine: EpubSection[], href: string): number {
	const file = href.split('#')[0];
	if (!file) return -1;
	const name = file.split('/').pop() ?? file;
	return spine.findIndex((item) => item.href === file || item.href.endsWith(`/${name}`) || item.href === name);
}

export function openEpub(bytes: Uint8Array | ArrayBuffer): ParsedEpub {
	const files = fileMap(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
	const opfPath = rootfile(files);
	const opf = decode(files.get(opfPath));
	if (!opf) throw new Error('This EPUB has no package.');
	const opfDir = opfPath.split('/').slice(0, -1).join('/');
	const title = tidy(opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? '') || 'Untitled';
	const mime = new Map<string, string>();
	const manifest = new Map<string, string>();
	for (const item of tagBlocks(opf, 'item')) {
		const href = joinPath(opfPath, attr(item, 'href'));
		const id = attr(item, 'id');
		const type = attr(item, 'media-type');
		if (href) {
			manifest.set(id, href);
			if (type) mime.set(href, type);
		}
	}
	const spine: EpubSection[] = [];
	for (const item of tagBlocks(opf, 'itemref')) {
		if (attr(item, 'linear').toLowerCase() === 'no') continue;
		const href = manifest.get(attr(item, 'idref'));
		if (href) spine.push({ href });
	}
	if (!spine.length) throw new Error('This EPUB has no pages.');
	let toc: EpubToc[] = [];
	const navHref = [...manifest.entries()].find(([id, href]) => {
		const item = tagBlocks(opf, 'item').find((tag) => attr(tag, 'id') === id);
		return item ? /\bnav\b/i.test(attr(item, 'properties')) : href.endsWith('nav.xhtml');
	})?.[1];
	if (navHref) toc = tocFromNav(decode(files.get(navHref)));
	if (!toc.length) {
		const ncxId = attr(opf.match(/<spine\b[^>]*>/i)?.[0] ?? '', 'toc');
		const ncxHref = manifest.get(ncxId) ?? [...files.keys()].find((key) => key.endsWith('.ncx'));
		if (ncxHref) toc = tocFromNcx(decode(files.get(ncxHref)));
	}
	const coverId = attr(opf.match(/<meta\b[^>]*name="cover"[^>]*>/i)?.[0] ?? '', 'content');
	const coverHref = manifest.get(coverId) ?? '';
	const cover = coverHref ? (files.get(coverHref) ?? null) : null;
	return {
		title,
		spine,
		toc,
		cover,
		coverType: mime.get(coverHref) || 'image/jpeg',
		files,
		mime
	};
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (let index = 0; index < bytes.length; index += 8192) {
		binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 8192, bytes.length)));
	}
	return btoa(binary);
}

function mediaType(book: ParsedEpub, href: string): string {
	const known = book.mime.get(href);
	if (known) return known;
	const extension = href.split('.').pop()?.toLowerCase() ?? '';
	return MIME[extension] ?? 'application/octet-stream';
}

function asData(book: ParsedEpub, href: string): string {
	const bytes = book.files.get(href);
	if (!bytes) return '';
	return `data:${mediaType(book, href)};base64,${base64(bytes)}`;
}

function rewriteUrls(css: string, cssFile: string, book: ParsedEpub): string {
	return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _quote, raw: string) => {
		const target = joinPath(cssFile, raw.trim());
		const data = target ? asData(book, target) : '';
		return data ? `url("${data}")` : full;
	});
}

export type PageFrame = {
	pageWidth: number;
	pageHeight: number;
	frameWidth: number;
	padX: number;
	padY: number;
	innerWidth: number;
	innerHeight: number;
};

/** One reading page, or two when a spread is open. The column pitch is the page width. */
export function pageFrame(pageWidth: number, pageHeight: number, spread = false): PageFrame {
	const padX = Math.round(pageWidth * 0.06);
	const padY = Math.round(pageHeight * 0.05);
	return {
		pageWidth,
		pageHeight,
		frameWidth: pageWidth * (spread ? 2 : 1),
		padX,
		padY,
		innerWidth: Math.max(1, pageWidth - padX * 2),
		innerHeight: Math.max(1, pageHeight - padY * 2)
	};
}

/** The section as one HTML document, with the book's CSS and pictures inlined. */
export function sectionDocument(book: ParsedEpub, href: string, columnWidth: number, columnHeight: number, spread = false): string {
	let html = decode(book.files.get(href));
	if (!html) {
		html = '<html><body><p>This section is missing from the book.</p></body></html>';
	}
	html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
	html = html.replace(/<link\b[^>]*>/gi, (tag) => {
		const rel = attr(tag, 'rel');
		const type = attr(tag, 'type');
		const target = joinPath(href, attr(tag, 'href'));
		if (!target || !(/stylesheet/i.test(rel) || /css/i.test(type) || target.endsWith('.css'))) return '';
		const css = rewriteUrls(decode(book.files.get(target)), target, book).replace(/<\/style/gi, '<\\/style');
		return `<style>${css}</style>`;
	});
	html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css: string) => {
		if (css.includes('data:')) return full;
		return `<style>${rewriteUrls(css, href, book)}</style>`;
	});
	html = html.replace(/\b(src|poster)\s*=\s*(['"])(.*?)\2/gi, (full, name: string, quote: string, raw: string) => {
		const target = joinPath(href, raw);
		const data = target ? asData(book, target) : '';
		return data ? `${name}=${quote}${data}${quote}` : full;
	});
	html = html.replace(/\bsrcset\s*=\s*(['"])[\s\S]*?\1/gi, '');
	const frame = pageFrame(columnWidth, columnHeight, spread);
	// The book's own margins would shrink the page after the column width is chosen, so every
	// column would stack into one clipped page. The inset here is the page margin instead.
	const style = `<style id="ob-page">
		html, body { margin: 0 !important; padding: 0 !important; width: ${frame.frameWidth}px !important; height: ${frame.pageHeight}px !important; overflow: hidden !important; background: #fff; }
		#ob-flow { box-sizing: content-box; margin: ${frame.padY}px 0 0 ${frame.padX}px !important; width: ${frame.innerWidth}px; height: ${frame.innerHeight}px !important; column-width: ${frame.innerWidth}px !important; column-gap: ${frame.padX * 2}px !important; column-fill: auto !important; }
		#ob-flow > :first-child { break-before: auto !important; }
		img, svg, video { max-width: 100% !important; height: auto; }
		h1 i, h1 em { break-inside: avoid !important; page-break-inside: avoid !important; }
		.figcenter img, .figleft img, img.x-ebookmaker-cover { max-height: ${frame.innerHeight}px !important; width: auto !important; }
		table { max-width: 100%; }
	</style>`;
	if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${style}`);
	else html = style + html;
	if (/<body\b[^>]*>/i.test(html)) {
		html = html.replace(/<body\b([^>]*)>/i, '<body$1><div id="ob-flow">');
		html = html.replace(/<\/body>/i, '</div></body>');
	} else {
		html = `<body><div id="ob-flow">${html}</div></body>`;
	}
	return html;
}

export function chaptersFromToc(toc: EpubToc[], spine: EpubSection[], starts: Map<string, number>, columns: Map<string, Map<string, number>>): Chapter[] {
	function fileOf(href: string): string {
		const relative = href.split('#')[0];
		const index = spineIndex(spine, relative);
		return index >= 0 ? spine[index].href : relative;
	}
	function walk(nodes: EpubToc[]): Chapter[] {
		const chapters: Chapter[] = [];
		for (const node of nodes) {
			const file = fileOf(node.href);
			const start = starts.get(file);
			if (start == null) continue;
			const fragment = decodeURIComponent(node.href.split('#')[1] ?? '');
			const column = fragment ? (columns.get(file)?.get(fragment) ?? 0) : 0;
			const chapter: Chapter = { title: node.title, pageIndex: start + column };
			const children = walk(node.children);
			if (children.length) chapter.children = children;
			chapters.push(chapter);
		}
		return chapters;
	}
	return walk(toc);
}
