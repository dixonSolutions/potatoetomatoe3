/**
 * Development harness access control.
 * Routes under `/dev/*` must remain unavailable in production builds.
 */

export type DevHarnessMode = 'console-test' | 'puller-test';

const HARNESS_MODES = new Set<DevHarnessMode>(['console-test', 'puller-test']);

export function isDevBuild(): boolean {
	return Boolean(import.meta.env.DEV);
}

export function parseHarnessMode(value: unknown): DevHarnessMode | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim() as DevHarnessMode;
	return HARNESS_MODES.has(trimmed) ? trimmed : null;
}

/** Env var set by `scripts/tauri-dev-harness.mjs` (Vite inlines import.meta.env). */
export function getHarnessModeFromEnv(): DevHarnessMode | null {
	const fromPotato = parseHarnessMode(
		(import.meta.env as Record<string, unknown>).POTATO_TOMATO_DEV_HARNESS
	);
	if (fromPotato) return fromPotato;
	/* Vite only exposes VITE_* / PUBLIC_* by default; launcher also sets process env for Tauri. */
	return null;
}

export async function getHarnessModeFromTauri(): Promise<DevHarnessMode | null> {
	if (!isDevBuild()) return null;
	try {
		const { invoke } = await import('@tauri-apps/api/core');
		const mode = await invoke<string>('get_dev_harness_mode');
		return parseHarnessMode(mode);
	} catch {
		return null;
	}
}

/**
 * True when this is a Vite/Tauri debug session. Route loaders use this to 404 production.
 * Harness pages additionally prefer a specific mode when launched via pnpm scripts.
 */
export function assertDevHarnessAccess(): void {
	if (!isDevBuild()) {
		throw new Error('Dev harnesses are unavailable outside development builds');
	}
}

export function isDevHarnessRouteAllowed(): boolean {
	return isDevBuild();
}
