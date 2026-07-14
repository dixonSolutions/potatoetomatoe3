import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MIRROR_MANIFEST_VERSION = 1;

export interface MirrorManifestFile {
	path: string;
	bytes: number;
	sha256: string;
}

export interface MirrorManifest {
	version: typeof MIRROR_MANIFEST_VERSION;
	gameId: string;
	entry: string;
	mirroredFrom?: string;
	capturedAt: string;
	captureMethod: 'playwright' | 'fallback';
	files: MirrorManifestFile[];
	notes: string[];
}

async function listFiles(root: string, current = root): Promise<string[]> {
	const entries = await fs.readdir(current, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const absolute = path.join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, absolute)));
		else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join('/'));
	}
	return files;
}

export async function buildMirrorManifest(
	offlineRoot: string,
	options: Omit<MirrorManifest, 'version' | 'capturedAt' | 'files'>
): Promise<MirrorManifest> {
	const files: MirrorManifestFile[] = [];
	for (const relativePath of await listFiles(offlineRoot)) {
		if (relativePath === 'mirror-manifest.json') continue;
		const body = await fs.readFile(path.join(offlineRoot, relativePath));
		files.push({
			path: relativePath,
			bytes: body.length,
			sha256: createHash('sha256').update(body).digest('hex')
		});
	}
	files.sort((a, b) => a.path.localeCompare(b.path));
	return {
		version: MIRROR_MANIFEST_VERSION,
		capturedAt: new Date().toISOString(),
		files,
		...options
	};
}

export async function writeMirrorManifest(
	offlineRoot: string,
	options: Omit<MirrorManifest, 'version' | 'capturedAt' | 'files'>
): Promise<MirrorManifest> {
	const manifest = await buildMirrorManifest(offlineRoot, options);
	await fs.writeFile(
		path.join(offlineRoot, 'mirror-manifest.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
		'utf-8'
	);
	return manifest;
}
