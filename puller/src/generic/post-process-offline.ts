import fs from 'node:fs/promises';
import path from 'node:path';
import { applyOfflineAdStripping } from '../ads/apply.js';

/**
 * Post-process a generic offline mirror: ad stubs, portal script tags, strip ad iframes.
 */
export async function postProcessGenericOfflineMirror(
	outDir: string,
	entryRel = 'index.html'
): Promise<void> {
	await applyOfflineAdStripping({ outDir, entryRel });

	// Ensure entry exists after ads pass
	const entryPath = path.join(outDir, entryRel);
	await fs.access(entryPath);
}
