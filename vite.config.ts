import path from 'node:path';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { pullerGamesProxyPlugin } from './vite-plugins/puller-games-proxy';
import { gamesHtmlBridgeInjectPlugin } from './vite-plugins/games-html-bridge-inject';

const pullerTarget = (process.env.PUBLIC_DOWNLOADER_URL ?? 'http://127.0.0.1:18787').replace(
	/\/$/,
	''
);

const repoRoot = path.resolve('.');

/** Skip inotify on huge trees (catalog / build outputs) — otherwise `pnpm dev` hits ENOSPC. */
function ignoreHeavyWatchPath(watchPath: string): boolean {
	const abs = path.resolve(watchPath);
	const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
	if (!rel || rel.startsWith('..')) return false;
	return /^(static\/games|build|build-flatpak|\.flatpak-builder|\.svelte-kit|src-tauri\/target|node_modules)(\/|$)/.test(
		rel
	);
}

const pullerGameProxy = {
	target: pullerTarget,
	changeOrigin: true,
	rewrite: (watchedPath: string) => watchedPath.replace(/^\/puller-games/, '/games')
};

const pullerApiProxy = {
	target: pullerTarget,
	changeOrigin: true
};

export default defineConfig({
	plugins: [
		pullerGamesProxyPlugin(pullerTarget),
		gamesHtmlBridgeInjectPlugin(),
		tailwindcss(),
		sveltekit(),
		devtoolsJson()
	],
	/** Pre-bundle UI libs so Vite does not intermittently fail dynamic imports (cascades into many “module load failed” errors). */
	optimizeDeps: {
		include: ['bits-ui', 'mode-watcher', 'svelte-sonner']
	},
	// Tauri expects a fixed port
	server: {
		port: 5173,
		strictPort: true,
		host: true, // Expose to network for container compatibility
		proxy: {
			'/puller-games': pullerGameProxy,
			'/api/unity-play': pullerApiProxy
		},
		watch: {
			ignored: [
				ignoreHeavyWatchPath,
				'**/static/games/**',
				'**/.svelte-kit/**',
				'**/.flatpak-builder/**',
				'**/build-flatpak/**',
				'**/build/**',
				'**/node_modules/**',
				'**/src-tauri/target/**'
			],
			followSymlinks: false
		}
	},
	// Clear screen can cause issues with Tauri
	clearScreen: false,
	preview: {
		proxy: {
			'/puller-games': pullerGameProxy,
			'/api/unity-play': pullerApiProxy
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
