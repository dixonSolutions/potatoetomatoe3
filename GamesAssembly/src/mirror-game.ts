import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { captureGameOfflineWithCdp } from './capture/generic-cdp-capture.js';
import { isPokiGamesHost, isY8PlayableHost, y8GameReferer } from './lib/hosts.js';
import { rewriteOfflineMirrorAssetUrls } from './lib/offline-asset-url-rewrite.js';
import { readIframeSrcFromOnline } from './lib/read-iframe-src.js';
import { runDownloadOfflineScript } from './lib/run-download-offline.js';
import { GAMES_ROOT } from './paths.js';

function finalizeOfflineMirror(gameId: string, code: number): number {
	if (code !== 0) return code;
	const dir = join(GAMES_ROOT, gameId, 'offline');
	if (!existsSync(dir)) return code;
	const r = rewriteOfflineMirrorAssetUrls(dir);
	if (r.filesModified > 0) {
		console.log(
			`   Offline asset URL rewrite: ${r.filesModified} file(s) (strip cache-bust ?query / fix %3F-in-path where file exists on disk)`
		);
	}
	return code;
}

/**
 * @returns 0 success, 1 failure
 */
export async function mirrorGameOffline(
	gameId: string,
	options: { force?: boolean } = {}
): Promise<number> {
	const { force = false } = options;

	const iframeSrc = readIframeSrcFromOnline(gameId);
	if (!iframeSrc?.startsWith('http')) {
		console.error(`No http(s) iframe src in online/index.html for ${gameId}`);
		return 1;
	}

	const u = new URL(iframeSrc);
	const targetDir = join(GAMES_ROOT, gameId, 'offline');

	if (existsSync(targetDir) && force) {
		console.log(`Removing existing offline/ (--force)`);
		rmSync(targetDir, { recursive: true, force: true });
	}
	mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });

	if (isPokiGamesHost(u.hostname)) {
		console.log(`Poki host → scripts/download-games-offline.js`);
		const code = await runDownloadOfflineScript(force ? ['--force', gameId] : [gameId]);
		return finalizeOfflineMirror(gameId, code);
	}

	let captureOk = false;
	if (isY8PlayableHost(u.hostname)) {
		console.log(`Y8-related host → CDP capture: ${iframeSrc}`);
		const cap = await captureGameOfflineWithCdp({
			gameId,
			iframeSrc,
			targetDir,
			referer: y8GameReferer(gameId)
		});
		if (cap.ok) {
			captureOk = true;
			console.log(`CDP capture finished for ${gameId}`);
		} else {
			console.warn(`CDP capture failed: ${cap.reason}`);
		}
	} else {
		console.log(`Generic host → CDP capture: ${iframeSrc}`);
		const cap = await captureGameOfflineWithCdp({
			gameId,
			iframeSrc,
			targetDir
		});
		if (cap.ok) {
			captureOk = true;
			console.log(`CDP capture finished for ${gameId}`);
		} else {
			console.warn(`CDP capture failed: ${cap.reason}`);
		}
	}

	if (!captureOk) {
		console.log(`Falling back to wget mirror via download-games-offline.js`);
		const code = await runDownloadOfflineScript(force ? ['--force', gameId] : [gameId]);
		if (code !== 0) return code;
	}

	console.log(`Deep asset pass: download-games-offline.js --deep-only ${gameId}`);
	const deepCode = await runDownloadOfflineScript(['--deep-only', gameId]);
	return finalizeOfflineMirror(gameId, deepCode);
}
