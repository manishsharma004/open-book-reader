/**
 * A chapter the reader can jump to: a title and the page it starts on.
 * The PDF outline is preferred. Headings in the text are the fallback.
 * This is not the span-range model in the design target.
 */

export type Chapter = {
	title: string;
	pageIndex: number;
	children?: Chapter[];
};

const LABEL =
	/^(chapter|chap\.?|part|book|volume|stave|act|scene|canto|letter|chapitre|partie|kapitel|cap[ií]tulo|capitolo|hoofdstuk|rozdzia[łl])\s+([0-9]+|[ivxlcdm]+)\b[\s.:—–-]*(.*)$/iu;
const MATTER =
	/^(prologue|epilogue|preface|foreword|introduction|afterword|appendix|interlude|contents|table of contents)\b/iu;
const ROMAN_ONLY = /^(?:[ivxlcdm]{1,8})\.?$/iu;

export type OutlineNode = {
	title: string;
	dest: string | unknown[] | null;
	items?: OutlineNode[];
};

type TextPiece = {
	str?: string;
	transform?: number[];
	width?: number;
	hasEOL?: boolean;
};

export type ChapterDocument = {
	numPages: number;
	getOutline(): Promise<OutlineNode[] | null>;
	getDestination(name: string): Promise<unknown[] | null>;
	getPageIndex(ref: unknown): Promise<number>;
	getPage(number: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
};

function tidy(line: string): string {
	return line.replace(/\s+/g, ' ').trim();
}

function wordCount(line: string): number {
	return tidy(line).split(' ').filter(Boolean).length;
}

function tocLine(line: string): boolean {
	if (/[.]{2,}|…+/u.test(line)) return true;
	const match = tidy(line).match(LABEL);
	if (!match) return false;
	const rest = match[3]?.trim() ?? '';
	return wordCount(line) > 3 && /\s\d{1,4}$/.test(rest);
}

function subtitle(line: string | undefined): string | null {
	if (!line) return null;
	const raw = tidy(line);
	if (/[.!?…]["')\]]*$/u.test(raw)) return null;
	const text = raw.replace(/[.:—–-]+$/u, '').trim();
	if (!text || text.length > 70 || wordCount(text) > 10) return null;
	if (LABEL.test(text) || MATTER.test(text) || ROMAN_ONLY.test(text) || tocLine(text)) return null;
	return text;
}

function capsTitle(line: string): boolean {
	if (/[.!?…]["')\]]*$/u.test(line)) return false;
	const bare = line.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
	const count = wordCount(bare);
	if (count < 2 || count > 8 || !/\p{L}/u.test(bare)) return false;
	return bare === bare.toUpperCase();
}

function labelTitle(line: string, next: string | undefined): string {
	const match = tidy(line).match(LABEL);
	const rest = match?.[3]?.replace(/^[\s.:—–-]+/u, '').replace(/[.:—–-]+$/u, '').trim() ?? '';
	let title = tidy(line).replace(/[.:—–-]+$/u, '').trim();
	const extra = subtitle(next);
	if (!rest && extra) title = `${title}. ${extra}`;
	return title.slice(0, 120);
}

type Hit = { title: string; pageIndex: number; kind: 'named' | 'roman' | 'caps' };

function keyOf(title: string): string {
	return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function settleChapters(chapters: Chapter[], pageCount?: number): Chapter[] {
	const sorted = chapters
		.filter((chapter) => chapter.title.trim() && Number.isInteger(chapter.pageIndex) && chapter.pageIndex >= 0)
		.filter((chapter) => pageCount == null || chapter.pageIndex < pageCount)
		.sort((left, right) => left.pageIndex - right.pageIndex || left.title.localeCompare(right.title));
	const kept: Chapter[] = [];
	for (const chapter of sorted) {
		const title = tidy(chapter.title).slice(0, 120);
		const previous = kept[kept.length - 1];
		if (!title) continue;
		if (previous && keyOf(previous.title) === keyOf(title)) continue;
		kept.push({ title, pageIndex: chapter.pageIndex });
	}
	if (kept.length === 0) return [];
	if (kept[0].pageIndex > 0) kept.unshift({ title: 'Start', pageIndex: 0 });
	return kept.length >= 2 ? kept : [];
}

/** Headings in already paginated plain text. Page indexes match the reader. */
export function chaptersFromText(pages: string[]): Chapter[] {
	const hits: Hit[] = [];
	pages.forEach((page, pageIndex) => {
		const lines = page
			.split(/\n+/)
			.map((line) => tidy(line))
			.filter(Boolean);
		const named: number[] = [];
		const other: Array<{ index: number; kind: 'roman' | 'caps' }> = [];
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (tocLine(line)) continue;
			if (LABEL.test(line) && line.length <= 100 && wordCount(line) <= 16) named.push(index);
			else if (MATTER.test(line) && wordCount(line) <= 8 && line.length <= 80) named.push(index);
			else if (ROMAN_ONLY.test(line)) other.push({ index, kind: 'roman' });
			else if (capsTitle(line)) other.push({ index, kind: 'caps' });
		}
		if (named.length >= 4) return;
		for (const index of named) {
			const line = lines[index];
			const title = LABEL.test(line) ? labelTitle(line, lines[index + 1]) : tidy(line).replace(/[.:]+$/u, '');
			hits.push({ title, pageIndex, kind: 'named' });
		}
		for (const item of other) {
			const line = lines[item.index];
			if (item.kind === 'roman') {
				const numeral = line.replace(/\.$/u, '').toUpperCase();
				const extra = subtitle(lines[item.index + 1]);
				hits.push({
					title: extra ? `Chapter ${numeral}. ${extra}` : `Chapter ${numeral}`,
					pageIndex,
					kind: 'roman'
				});
			} else hits.push({ title: line, pageIndex, kind: 'caps' });
		}
	});

	const named = hits.filter((hit) => hit.kind === 'named');
	let chosen: Hit[] = [];
	if (named.length > 0) chosen = named;
	else {
		const romans = hits.filter((hit) => hit.kind === 'roman');
		const romanPages = new Set(romans.map((hit) => hit.pageIndex));
		if (romans.length >= 2 && romanPages.size >= 2) chosen = romans;
		else {
			const caps = hits.filter((hit) => hit.kind === 'caps');
			const capsPages = new Set(caps.map((hit) => hit.pageIndex));
			if (caps.length >= 2 && capsPages.size >= 2) chosen = caps;
		}
	}
	return settleChapters(chosen.map(({ title, pageIndex }) => ({ title, pageIndex })));
}

export function chapterForPage(chapters: Chapter[], pageIndex: number): number {
	let found = 0;
	for (let index = 0; index < chapters.length; index += 1) {
		if (chapters[index].pageIndex <= pageIndex) found = index;
		else break;
	}
	return found;
}

/** The outline path that covers this page. The last entry is the deepest match. */
export function activeTrail(chapters: Chapter[], pageIndex: number): Chapter[] {
	let best: Chapter[] = [];
	function walk(nodes: Chapter[], trail: Chapter[]) {
		for (const node of nodes) {
			if (node.pageIndex > pageIndex) continue;
			const next = [...trail, node];
			const bestPage = best[best.length - 1]?.pageIndex ?? -1;
			if (node.pageIndex >= bestPage) best = next;
			if (node.children?.length) walk(node.children, next);
		}
	}
	walk(chapters, []);
	return best;
}

async function pageOf(document: ChapterDocument, dest: OutlineNode['dest']): Promise<number | null> {
	try {
		let explicit: unknown = dest;
		if (typeof dest === 'string') explicit = await document.getDestination(dest);
		if (!Array.isArray(explicit) || explicit.length === 0 || explicit[0] == null) return null;
		const index = await document.getPageIndex(explicit[0]);
		if (!Number.isInteger(index) || index < 0 || index >= document.numPages) return null;
		return index;
	} catch {
		return null;
	}
}

async function outlineTree(nodes: OutlineNode[], document: ChapterDocument): Promise<Chapter[]> {
	const chapters: Chapter[] = [];
	for (const node of nodes) {
		const title = tidy(node.title ?? '').slice(0, 120);
		const pageIndex = await pageOf(document, node.dest);
		const children = node.items?.length ? await outlineTree(node.items, document) : [];
		if (pageIndex == null) {
			chapters.push(...children);
			continue;
		}
		if (!title) continue;
		const chapter: Chapter = { title, pageIndex };
		if (children.length) chapter.children = children;
		chapters.push(chapter);
	}
	return chapters;
}

/** The PDF outline as a tree. Null when the file has no outline entries that name a page. */
export async function chaptersFromOutline(document: ChapterDocument): Promise<Chapter[] | null> {
	const outline = await document.getOutline().catch(() => null);
	if (!outline?.length) return null;
	const tree = await outlineTree(outline, document);
	return tree.length ? tree : null;
}

function linesFromItems(items: unknown[]): string {
	type Row = { y: number; parts: Array<{ x: number; str: string; width: number; eol: boolean }> };
	const rows: Row[] = [];
	for (const raw of items) {
		const item = raw as TextPiece;
		if (!item?.str || !item.transform) continue;
		const x = item.transform[4] ?? 0;
		const y = item.transform[5] ?? 0;
		const part = { x, str: item.str, width: item.width ?? item.str.length * 4, eol: Boolean(item.hasEOL) };
		const row = rows.find((candidate) => Math.abs(candidate.y - y) <= 3);
		if (row) row.parts.push(part);
		else rows.push({ y, parts: [part] });
	}
	rows.sort((left, right) => right.y - left.y);
	return rows
		.map((row) => {
			const parts = row.parts.sort((left, right) => left.x - right.x);
			let text = '';
			let cursor = Number.NEGATIVE_INFINITY;
			for (const part of parts) {
				if (text && part.x - cursor > 2 && !text.endsWith(' ') && !part.str.startsWith(' ')) text += ' ';
				text += part.str;
				cursor = part.x + part.width;
				if (part.eol) cursor = Number.POSITIVE_INFINITY;
			}
			return tidy(text);
		})
		.filter(Boolean)
		.join('\n');
}

/** Outline tree when the PDF has one. Otherwise the same heading scan as plain text. */
export async function chaptersFromDocument(document: ChapterDocument): Promise<Chapter[]> {
	const fromOutline = await chaptersFromOutline(document);
	if (fromOutline) return fromOutline;
	const pages: string[] = [];
	for (let number = 1; number <= document.numPages; number += 1) {
		const page = await document.getPage(number);
		const content = await page.getTextContent();
		pages.push(linesFromItems(content.items));
	}
	return chaptersFromText(pages);
}
