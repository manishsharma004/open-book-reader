export type ThemeMode = 'day' | 'night' | 'system';

const KEY = 'obr-theme';

export function readTheme(): ThemeMode {
	const value = localStorage.getItem(KEY);
	if (value === 'day' || value === 'night' || value === 'system') return value;
	return 'system';
}

export function applyTheme(mode: ThemeMode) {
	localStorage.setItem(KEY, mode);
	const dark =
		mode === 'night' ||
		(mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
}
