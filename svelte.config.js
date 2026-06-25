import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const isDev = process.argv.includes('dev');
const isTauri = !!process.env.TAURI_ENV_PLATFORM;
const isDesktop = isTauri || process.env.BUILD_TARGET === 'electron';

/** GitHub Pages project-site base (e.g. /potatoetomatoe3). Override with PUBLIC_PAGES_BASE in CI. */
const pagesBase =
	process.env.PUBLIC_PAGES_BASE ||
	(process.env.GITHUB_REPOSITORY
		? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}`
		: '/potatoetomatoe3');

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
		prerender: {
			handleUnseenRoutes: 'ignore'
		},
		paths: {
			base: isDev || isDesktop ? '' : pagesBase
		}
	}
};

export default config;
