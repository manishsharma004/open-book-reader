export type ThemeMode = 'day' | 'night' | 'system';

export const PALETTES = [
	{ id: 'ink', label: 'Ink', hint: 'Cool paper' },
	{ id: 'lamp', label: 'Lamp', hint: 'Warm paper' },
	{ id: 'moss', label: 'Moss', hint: 'Green paper' },
	{ id: 'tide', label: 'Tide', hint: 'Sea paper' },
	{ id: 'dusk', label: 'Dusk', hint: 'Violet paper' }
] as const;

export type Palette = (typeof PALETTES)[number]['id'];

export function isPalette(value: unknown): value is Palette {
	return PALETTES.some((item) => item.id === value);
}

const THEME_KEY = 'obr-theme';
const PALETTE_KEY = 'obr-palette';

export function readTheme(): ThemeMode {
	if (typeof localStorage === 'undefined') return 'system';
	const value = localStorage.getItem(THEME_KEY);
	if (value === 'day' || value === 'night' || value === 'system') return value;
	return 'system';
}

export function readPalette(): Palette {
	if (typeof localStorage === 'undefined') return 'ink';
	const value = localStorage.getItem(PALETTE_KEY);
	return isPalette(value) ? value : 'ink';
}

export function applyTheme(mode: ThemeMode) {
	localStorage.setItem(THEME_KEY, mode);
	const dark =
		mode === 'night' ||
		(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
}

export function applyPalette(palette: Palette) {
	localStorage.setItem(PALETTE_KEY, palette);
	document.documentElement.setAttribute('data-palette', palette);
}
