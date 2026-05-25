import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isDev = process.argv.includes('dev');
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const isDesktop = isTauri || process.env.BUILD_TARGET === 'electron';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // SPA mode
			strict: false
		}),
		paths: {
			base: isDev || isDesktop ? '' : '/potato-tomato-2'
		}
	}
};

export default config;
