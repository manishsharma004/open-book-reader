import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Project Pages is served at `/<repo>`. Leave BASE_PATH empty for the local server and for a custom domain at the site root. */
function pagesBase() {
	let value = (process.env.BASE_PATH ?? '').trim();
	if (!value || value === '/') return '';
	if (!value.startsWith('/')) value = `/${value}`;
	return value.replace(/\/$/, '');
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			paths: {
				base: pagesBase()
			},
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({
				fallback: 'index.html'
			})
		})
	]
});
