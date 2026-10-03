/** HTTP client for puller browser-data API (local dev / Tauri). */

import { getPullerBaseUrl, isPullerAvailable } from './offline-downloader-puller';
import { shouldProbePullerBackend } from './offline-deployment';
import type { GameBrowserProfile } from './game-browser-profile';
import { isGameBrowserProfile } from './game-browser-profile';

export async function isPullerBrowserDataAvailable(force = false): Promise<boolean> {
	if (!shouldProbePullerBackend()) return false;
	return await isPullerAvailable(force);
}

/**
 * The game's saves on the puller's disk, or `null` when it has none (a 404).
 *
 * @throws when the puller could not say: it is gone, it answered with an error, or what it
 *   sent is not a profile. Callers must not read that as "no saves".
 */
export async function loadPullerBrowserProfile(gameId: string): Promise<GameBrowserProfile | null> {
	if (!(await isPullerBrowserDataAvailable())) {
		throw new Error('the puller is not reachable');
	}
	const res = await fetch(`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`the puller answered ${res.status}`);
	const data = (await res.json()) as unknown;
	if (!isGameBrowserProfile(data))
		throw new Error('the puller sent something that is not a profile');
	return data;
}

export async function savePullerBrowserProfile(
	gameId: string,
	profile: GameBrowserProfile
): Promise<boolean> {
	if (!(await isPullerBrowserDataAvailable())) return false;
	try {
		const res = await fetch(
			`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(profile)
			}
		);
		return res.ok;
	} catch {
		return false;
	}
}

export async function deletePullerBrowserProfile(gameId: string): Promise<boolean> {
	if (!(await isPullerBrowserDataAvailable())) return false;
	try {
		const res = await fetch(
			`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`,
			{
				method: 'DELETE'
			}
		);
		return res.ok;
	} catch {
		return false;
	}
}
