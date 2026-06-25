/** HTTP client for puller browser-data API (local dev / Tauri). */

import { getPullerBaseUrl, isPullerAvailable } from './offline-downloader-puller';
import { shouldProbePullerBackend } from './offline-deployment';
import type { GameBrowserProfile } from './game-browser-profile';
import { isGameBrowserProfile } from './game-browser-profile';

export async function isPullerBrowserDataAvailable(force = false): Promise<boolean> {
	if (!shouldProbePullerBackend()) return false;
	return await isPullerAvailable(force);
}

export async function loadPullerBrowserProfile(gameId: string): Promise<GameBrowserProfile | null> {
	if (!(await isPullerBrowserDataAvailable())) return null;
	try {
		const res = await fetch(`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`);
		if (res.status === 404) return null;
		if (!res.ok) return null;
		const data = (await res.json()) as unknown;
		return isGameBrowserProfile(data) ? data : null;
	} catch {
		return null;
	}
}

export async function savePullerBrowserProfile(
	gameId: string,
	profile: GameBrowserProfile
): Promise<boolean> {
	if (!(await isPullerBrowserDataAvailable())) return false;
	try {
		const res = await fetch(`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(profile)
		});
		return res.ok;
	} catch {
		return false;
	}
}

export async function deletePullerBrowserProfile(gameId: string): Promise<boolean> {
	if (!(await isPullerBrowserDataAvailable())) return false;
	try {
		const res = await fetch(`${getPullerBaseUrl()}/api/browser-data/${encodeURIComponent(gameId)}`, {
			method: 'DELETE'
		});
		return res.ok;
	} catch {
		return false;
	}
}
