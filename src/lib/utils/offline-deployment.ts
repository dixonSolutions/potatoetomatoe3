/**
 * Detect whether the app runs as a hosted public site (GitHub Pages) or a local app
 * (pnpm dev / Tauri) so offline downloads use the right storage backend.
 */

export type AppDeployment = 'public-site' | 'local-app';

export function isTauriApp(): boolean {
	if (typeof window === 'undefined') return false;
	return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

function deploymentOverride(): AppDeployment | null {
	const raw = import.meta.env.PUBLIC_OFFLINE_DEPLOYMENT;
	if (raw === 'public-site' || raw === 'public') return 'public-site';
	if (raw === 'local-app' || raw === 'local') return 'local-app';
	return null;
}

/** True when the page is served from localhost (dev server on this machine). */
export function isLocalAppHost(hostname = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Hosted static site (e.g. GitHub Pages) vs local desktop/dev build.
 * Public site → browser IndexedDB. Local app → puller file downloads when available.
 */
export function getAppDeployment(): AppDeployment {
	const override = deploymentOverride();
	if (override) return override;

	if (typeof window !== 'undefined') {
		if (isTauriApp()) return 'local-app';
		if (import.meta.env.DEV) return 'local-app';
		if (isLocalAppHost()) return 'local-app';
		return 'public-site';
	}

	if (import.meta.env.DEV) return 'local-app';
	if (typeof process !== 'undefined' && process.env.TAURI_ENV_PLATFORM) return 'local-app';
	return 'public-site';
}

export function isPublicSiteDeployment(): boolean {
	return getAppDeployment() === 'public-site';
}

export function isLocalAppDeployment(): boolean {
	return getAppDeployment() === 'local-app';
}

/** Local/Tauri builds should prefer the puller sidecar; public sites must not probe it. */
export function shouldProbePullerBackend(): boolean {
	return isLocalAppDeployment();
}
