import { loadStoredSettings, storeSettings, type AppSettings } from '#lib/settings.js';
import { applyPalette, applyTheme, type Palette, type ThemeMode } from '#lib/theme.js';

export const settingsState = $state({
	ready: false,
	revision: 0,
	current: null as AppSettings | null
});

let loading: Promise<void> | null = null;

export function loadSettings() {
	loading ??= (async () => {
		settingsState.current = await loadStoredSettings();
		settingsState.ready = true;
		settingsState.revision += 1;
	})();
	return loading;
}

export async function commitSettings() {
	await loadSettings();
	if (!settingsState.current) return;
	await storeSettings(settingsState.current);
	settingsState.revision += 1;
}

export async function setTheme(mode: ThemeMode) {
	await loadSettings();
	if (!settingsState.current) return;
	settingsState.current.theme = mode;
	applyTheme(mode);
	await storeSettings(settingsState.current);
}

export async function setPalette(palette: Palette) {
	await loadSettings();
	if (!settingsState.current) return;
	settingsState.current.palette = palette;
	applyPalette(palette);
	await storeSettings(settingsState.current);
}
