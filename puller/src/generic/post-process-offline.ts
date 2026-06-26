import fs from 'node:fs/promises';
import path from 'node:path';
import {
	buildPokiOfflineStubScript,
	indexHtmlReferencesPokiSdk,
	patchPokiSdkScriptTags
} from './poki-offline-stub.js';

const SITE_ROOT_SCRIPT = /\bsrc=["'](?:\.\.\/)+([^"']+)["']/gi;

/** abinbins cloak.js is often empty upstream — provide a harmless local stub. */
const PORTAL_SCRIPT_STUBS: Record<string, string> = {
	'cloak.js': '// offline noop\n',
	'poki-sdk.js': '' // filled via buildPokiOfflineStubScript when referenced
};

/**
 * Rewrite ../../portal.js style tags to sit beside index.html and ensure local stubs exist.
 */
async function patchSiteRootScriptTags(outDir: string, html: string): Promise<string> {
	const needed = new Set<string>();
	let out = html;

	out = out.replace(SITE_ROOT_SCRIPT, (tag, fileName: string) => {
		if (typeof fileName !== 'string' || !fileName.trim()) return tag;
		needed.add(fileName);
		return tag.replace(/(?:\.\.\/)+[^"']+/, fileName);
	});

	for (const fileName of needed) {
		const dest = path.join(outDir, fileName);
		if (fileName === 'poki-sdk.js') continue;
		try {
			const stat = await fs.stat(dest);
			if (stat.isFile() && stat.size > 0) continue;
		} catch {
			// missing or empty — write stub below
		}
		const stub = PORTAL_SCRIPT_STUBS[fileName] ?? '// offline noop\n';
		await fs.writeFile(dest, stub, 'utf-8');
	}

	return out;
}

/**
 * Post-process a generic offline mirror: offline Poki stub, rewrite portal script tags.
 */
export async function postProcessGenericOfflineMirror(
	outDir: string,
	entryRel = 'index.html'
): Promise<void> {
	const entryPath = path.join(outDir, entryRel);
	let html = await fs.readFile(entryPath, 'utf-8');

	html = await patchSiteRootScriptTags(outDir, html);

	if (indexHtmlReferencesPokiSdk(html)) {
		await fs.writeFile(path.join(outDir, 'poki-sdk.js'), buildPokiOfflineStubScript(), 'utf-8');
		html = patchPokiSdkScriptTags(html);
	}

	await fs.writeFile(entryPath, html, 'utf-8');
}
