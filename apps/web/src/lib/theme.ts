export type ThemeMode = 'day' | 'night' | 'system';
export type Palette = 'ink' | 'lamp';

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
	return localStorage.getItem(PALETTE_KEY) === 'lamp' ? 'lamp' : 'ink';
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
