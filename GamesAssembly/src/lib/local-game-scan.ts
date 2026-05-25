import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	listGameIdsMissingValidOfflineMirror,
	listGameIdsWithMetadata,
	offlineBundleIndexPath,
	offlineIndexLooksValid,
	splitIdsForLocalTransform
} from './catalog.js';
import { offlineDirWouldNeedUnityFix } from './fix-unity-offline-assets.js';
import { GAMES_ROOT } from '../paths.js';

/**
 * Fast, local-only snapshot for `local-transform`: download buckets, asset heuristics,
 * and fix detectors (Unity is the first registered detector).
 */
export type LocalPipelineScan = {
	catalogIds: string[];
	needFresh: string[];
	needForce: string[];
	/** Usable offline/index at scan time — eligible for parallel fix lane while others download */
	withValidOffline: string[];
	/** Heuristic: looks Unity WebGL but no `offline/Build/` (deep pass likely to pull chunks) */
	likelyIncompleteAssets: string[];
	/** Unity detector: {@link offlineDirWouldNeedUnityFix} */
	unityFixNeeded: string[];
};

function quickLikelyIncompleteUnity(gameId: string): boolean {
	const offline = join(GAMES_ROOT, gameId, 'offline');
	const idxPath = offlineBundleIndexPath(gameId);
	if (!offlineIndexLooksValid(idxPath)) return false;
	let head: string;
	try {
		head = readFileSync(idxPath, 'utf8').slice(0, 20000);
	} catch {
		return false;
	}
	if (!/UnityLoader|unityWebgl|\.unityweb|Build\/|TemplateData/i.test(head)) return false;
	const buildDir = join(offline, 'Build');
	return !existsSync(buildDir);
}

export function scanLocalPipelineState(): LocalPipelineScan {
	const catalogIds = listGameIdsWithMetadata();
	const missingBundle = listGameIdsMissingValidOfflineMirror();
	const { needFresh, needForce } = splitIdsForLocalTransform(missingBundle);
	const needDownload = new Set<string>([...needFresh, ...needForce]);

	const withValidOffline = catalogIds.filter((id) => !needDownload.has(id));

	const likelyIncompleteAssets: string[] = [];
	const unityFixNeeded: string[] = [];

	for (const id of withValidOffline) {
		if (quickLikelyIncompleteUnity(id)) likelyIncompleteAssets.push(id);
		const offlineRoot = join(GAMES_ROOT, id, 'offline');
		if (offlineDirWouldNeedUnityFix(offlineRoot)) unityFixNeeded.push(id);
	}

	return {
		catalogIds,
		needFresh,
		needForce,
		withValidOffline,
		likelyIncompleteAssets,
		unityFixNeeded
	};
}
