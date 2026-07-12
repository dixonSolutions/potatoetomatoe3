/**
 * Download the catalog cover image into the offline mirror so UI cards work without network.
 */
import fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { CATALOG_DIR } from './config.js';
import { offlineDir, readGameMetadata } from './catalog.js';
import { readOfflineManifestFromDir, writeOfflineManifest } from './offline-manifest.js';

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extensionFromUrlOrType(url: string, contentType: string | null): string {
	const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
	if (type === 'image/jpeg' || type === 'image/jpg') return '.jpg';
	if (type === 'image/png') return '.png';
	if (type === 'image/webp') return '.webp';
	if (type === 'image/gif') return '.gif';
	if (type === 'image/svg+xml') return '.svg';
	try {
		const pathname = new URL(url).pathname;
		const m = pathname.match(/\.(jpe?g|png|webp|gif|svg)$/i);
		if (m) return `.${m[1].toLowerCase().replace('jpeg', 'jpg')}`;
	} catch {
		/* ignore */
	}
	return '.jpg';
}

async function patchManifestThumbnail(
	offlineRoot: string,
	thumbnailRel: string,
	entry: string
): Promise<void> {
	const prev = await readOfflineManifestFromDir(offlineRoot);
	await writeOfflineManifest(offlineRoot, {
		entry: prev?.entry ?? entry,
		mirroredFrom: prev?.mirroredFrom,
		thumbnail: thumbnailRel
	});
}

/** Relative path under offline/ for a cached cover, or null if none / failed. */
export async function ensureOfflineThumbnail(gameId: string): Promise<string | null> {
	const meta = await readGameMetadata(gameId);
	const thumb = typeof meta?.thumbnail === 'string' ? meta.thumbnail.trim() : '';
	if (!thumb) return null;

	const outRoot = offlineDir(gameId);
	await fs.mkdir(outRoot, { recursive: true });

	const existing = await readOfflineManifestFromDir(outRoot);
	if (existing?.thumbnail) {
		const abs = path.join(outRoot, existing.thumbnail);
		if (existsSync(abs)) return existing.thumbnail;
	}

	/* Local catalog path e.g. /games/<id>/online/assets/foo.png */
	if (thumb.startsWith('/')) {
		const relFromGames = thumb.replace(/^\/games\//, '');
		const candidates = [
			path.join(CATALOG_DIR, relFromGames),
			path.join(outRoot, '..', 'online', 'assets', path.basename(thumb))
		];
		for (const src of candidates) {
			try {
				const st = await fs.stat(src);
				if (!st.isFile() || st.size < 32) continue;
				const ext = path.extname(src) || '.png';
				const rel = `assets/thumbnail${ext}`;
				const dest = path.join(outRoot, rel);
				await fs.mkdir(path.dirname(dest), { recursive: true });
				await fs.copyFile(src, dest);
				await patchManifestThumbnail(outRoot, rel, existing?.entry ?? 'index.html');
				return rel;
			} catch {
				/* try next */
			}
		}
		return null;
	}

	if (!/^https?:\/\//i.test(thumb)) return null;

	try {
		const res = await fetch(thumb, {
			headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
			redirect: 'follow',
			signal: AbortSignal.timeout(60_000)
		});
		if (!res.ok || !res.body) return null;
		const ext = extensionFromUrlOrType(thumb, res.headers.get('content-type'));
		const rel = `assets/thumbnail${ext}`;
		const dest = path.join(outRoot, rel);
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
		await patchManifestThumbnail(outRoot, rel, existing?.entry ?? 'index.html');
		return rel;
	} catch {
		return null;
	}
}

/** Read cached offline thumbnail relative path if the file exists. */
export async function readOfflineThumbnailRel(gameId: string): Promise<string | null> {
	const outRoot = offlineDir(gameId);
	const manifest = await readOfflineManifestFromDir(outRoot);
	if (manifest?.thumbnail) {
		const abs = path.join(outRoot, manifest.thumbnail);
		if (existsSync(abs)) return manifest.thumbnail;
	}
	for (const name of [
		'assets/thumbnail.jpg',
		'assets/thumbnail.jpeg',
		'assets/thumbnail.png',
		'assets/thumbnail.webp',
		'assets/thumbnail.gif'
	]) {
		if (existsSync(path.join(outRoot, name))) return name;
	}
	return null;
}
