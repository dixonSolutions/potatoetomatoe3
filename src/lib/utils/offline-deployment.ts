/**
 * Detect whether the app runs as a hosted public site (GitHub Pages) or a local app
 * (pnpm dev / Tauri) so offline downloads use the right storage backend.
 */

export type AppDeployment = 'public-site' | 'local-app';

export function isTauriApp(): boolean {
	if (typeof window === 'undefined') return false;
	const g = globalThis as { isTauri?: boolean };
	return g.isTauri === true || '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

function deploymentOverride(): AppDeployment | null {
	return parseDeploymentOverride(import.meta.env.PUBLIC_OFFLINE_DEPLOYMENT);
}

export function parseDeploymentOverride(raw: unknown): AppDeployment | null {
	if (raw === 'public-site' || raw === 'public') return 'public-site';
	if (raw === 'local-app' || raw === 'local') return 'local-app';
	return null;
}

function hasTauriBuildPlatform(): boolean {
	const platform = import.meta.env.TAURI_ENV_PLATFORM;
	return typeof platform === 'string' && platform.length > 0;
}

/** True when the page is served from a local or Tauri webview host. */
export function isLocalAppHost(
	hostname = typeof window !== 'undefined' ? window.location.hostname : ''
): boolean {
	const host = hostname.trim().toLowerCase();
	return (
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host === '[::1]' ||
		host === 'tauri.localhost' ||
		host === 'asset.localhost' ||
		host.endsWith('.localhost')
	);
}

/** Pure classifier used by runtime helpers and unit tests. */
export function resolveAppDeployment(input: {
	override?: AppDeployment | null;
	isTauri?: boolean;
	isDev?: boolean;
	hasTauriPlatform?: boolean;
	hostname?: string;
	hasWindow?: boolean;
}): AppDeployment {
	if (input.override) return input.override;

	const hasWindow = input.hasWindow ?? true;
	if (hasWindow) {
		if (input.isTauri) return 'local-app';
		if (input.isDev) return 'local-app';
		if (input.hasTauriPlatform) return 'local-app';
		if (isLocalAppHost(input.hostname ?? '')) return 'local-app';
		return 'public-site';
	}

	if (input.isDev) return 'local-app';
	if (input.hasTauriPlatform) return 'local-app';
	return 'public-site';
}

/**
 * Hosted static site (e.g. GitHub Pages) vs local desktop/dev build.
 * Public site → browser IndexedDB. Local app → puller file downloads when available.
 */
export function getAppDeployment(): AppDeployment {
	return resolveAppDeployment({
		override: deploymentOverride(),
		hasWindow: typeof window !== 'undefined',
		isTauri: typeof window !== 'undefined' ? isTauriApp() : false,
		isDev: import.meta.env.DEV,
		hasTauriPlatform:
			hasTauriBuildPlatform() ||
			(typeof process !== 'undefined' && Boolean(process.env.TAURI_ENV_PLATFORM)),
		hostname: typeof window !== 'undefined' ? window.location.hostname : ''
	});
}

export function isPublicSiteDeployment(): boolean {
	return getAppDeployment() === 'public-site';
}

export function isLocalAppDeployment(): boolean {
	return getAppDeployment() === 'local-app';
}

export function isTauriMobileBuild(): boolean {
	const platform = import.meta.env.TAURI_ENV_PLATFORM;
	return platform === 'android' || platform === 'ios';
}

export function isTauriAndroidBuild(): boolean {
	return import.meta.env.TAURI_ENV_PLATFORM === 'android';
}

/** Local/Tauri builds should prefer the puller sidecar; public sites must not probe it. */
export function shouldProbePullerBackend(): boolean {
	if (!isLocalAppDeployment()) return false;
	// Mobile Tauri builds intentionally disable the puller sidecar (see src-tauri/src/lib.rs).
	if (isTauriMobileBuild()) return false;
	return true;
}
