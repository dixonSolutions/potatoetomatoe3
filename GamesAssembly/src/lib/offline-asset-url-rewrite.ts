import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const SCAN_EXT = /\.(html?|js|mjs|cjs|css|json|svg|xml|txt|map)$/i;

/**
 * Minified games often use `file.js?hash` or even `file.js%3Fhash` (query folded into the path after
 * encodeURIComponent). Mirroring stores bodies keyed by pathname only, so static servers must be
 * asked for `file.js` — rewrite references to match on-disk files.
 */
const ENCODED_QUERY_IN_PATH =
	/([a-zA-Z0-9][a-zA-Z0-9/._-]*\.(?:js|mjs|cjs|css|json|wasm|unityweb|png|jpe?g|gif|webp|svg|mp3|ogg|woff2?|ttf|bin|mem|data|symbols|atlas|fnt|ico|map|txt|xml))(?:%253[Ff]|%3[Ff])([a-zA-Z0-9_.-]{1,96})/g;

/** Double-quoted asset paths with a cache-busting query only (common in HTML + bundles). */
const DOUBLE_QUOTED_ASSET_QUERY =
	/"([^"]+\.(?:js|mjs|cjs|css|json|png|jpe?g|gif|webp|svg|woff2?|wasm|unityweb|mp3|ogg|ico))(\?[^"]*)"/g;

/** Single-quoted variant */
const SINGLE_QUOTED_ASSET_QUERY =
	/'([^']+\.(?:js|mjs|cjs|css|json|png|jpe?g|gif|webp|svg|woff2?|wasm|unityweb|mp3|ogg|ico))(\?[^']*)'/g;

function walkFiles(dir: string, out: string[] = []): string[] {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
			walkFiles(p, out);
		} else if (e.isFile() && SCAN_EXT.test(e.name)) {
			out.push(p);
		}
	}
	return out;
}

function unsafePathSegment(ref: string): boolean {
	if (!ref || ref.includes('..')) return true;
	const n = ref.replace(/\\/g, '/');
	if (n.startsWith('/') || n.startsWith('//')) return true;
	return false;
}

function fileExistsAsMirrorAsset(offlineRoot: string, fromFile: string, relPath: string): boolean {
	if (unsafePathSegment(relPath)) return false;
	const candidates = [join(offlineRoot, relPath), join(dirname(fromFile), relPath)];
	for (const c of candidates) {
		try {
			if (!existsSync(c)) continue;
			const st = statSync(c);
			if (st.isFile() && st.size > 0) return true;
		} catch {
			/* ignore */
		}
	}
	return false;
}

function rewriteEncodedQueryInPath(content: string, offlineRoot: string, fromFile: string): string {
	return content.replace(ENCODED_QUERY_IN_PATH, (full, pathPart: string) => {
		if (unsafePathSegment(pathPart)) return full;
		const rel = pathPart.replace(/^\//, '');
		if (fileExistsAsMirrorAsset(offlineRoot, fromFile, rel)) return pathPart;
		return full;
	});
}

function rewriteQuotedAssetQueries(content: string, offlineRoot: string, fromFile: string): string {
	let out = content.replace(DOUBLE_QUOTED_ASSET_QUERY, (full, base: string, q: string) => {
		if (!q || q.length <= 1) return full;
		if (unsafePathSegment(base)) return full;
		if (fileExistsAsMirrorAsset(offlineRoot, fromFile, base)) return `"${base}"`;
		return full;
	});
	out = out.replace(SINGLE_QUOTED_ASSET_QUERY, (full, base: string, q: string) => {
		if (!q || q.length <= 1) return full;
		if (unsafePathSegment(base)) return full;
		if (fileExistsAsMirrorAsset(offlineRoot, fromFile, base)) return `'${base}'`;
		return full;
	});
	return out;
}

export type RewriteOfflineMirrorResult = { filesModified: number; filesScanned: number };

export type RewriteAllOfflineSummary = {
	/** `static/games/<id>/offline` exists */
	gamesWithOffline: number;
	/** At least one text file was rewritten */
	gamesTouched: number;
	filesModified: number;
	filesScanned: number;
};

export type OnRewriteGameProgress = (info: {
	gameId: string;
	index: number;
	total: number;
	result: RewriteOfflineMirrorResult;
}) => void;

/**
 * Rewrite HTML/JS/CSS/JSON under one game's `offline/` tree so local requests hit mirrored files
 * (strip `?cache` and `%3Fcache` path bugs when the basename file exists).
 */
export function rewriteOfflineMirrorAssetUrls(offlineDir: string): RewriteOfflineMirrorResult {
	if (!existsSync(offlineDir)) return { filesModified: 0, filesScanned: 0 };

	const files = walkFiles(offlineDir);
	let filesModified = 0;

	for (const abs of files) {
		let st: ReturnType<typeof statSync>;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		if (st.size === 0 || st.size > MAX_FILE_BYTES) continue;

		let content: string;
		try {
			content = readFileSync(abs, 'utf8');
		} catch {
			continue;
		}

		let next = rewriteEncodedQueryInPath(content, offlineDir, abs);
		next = rewriteQuotedAssetQueries(next, offlineDir, abs);

		if (next !== content) {
			writeFileSync(abs, next, 'utf8');
			filesModified++;
		}
	}

	return { filesModified, filesScanned: files.length };
}

/**
 * Run {@link rewriteOfflineMirrorAssetUrls} for every `static/games/<id>/offline` folder that exists.
 * Pass `onGame` for progress (large trees can take minutes).
 */
export function rewriteAllOfflineMirrorsUnder(
	gamesRoot: string,
	opts?: { onGame?: OnRewriteGameProgress }
): RewriteAllOfflineSummary {
	let filesModified = 0;
	let filesScanned = 0;
	let gamesTouched = 0;
	let entries;
	try {
		entries = readdirSync(gamesRoot, { withFileTypes: true });
	} catch {
		return { gamesWithOffline: 0, gamesTouched: 0, filesModified: 0, filesScanned: 0 };
	}

	const ids: string[] = [];
	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith('.')) continue;
		const offline = join(gamesRoot, e.name, 'offline');
		if (!existsSync(offline)) continue;
		ids.push(e.name);
	}

	const total = ids.length;
	for (let i = 0; i < ids.length; i++) {
		const gameId = ids[i];
		const offline = join(gamesRoot, gameId, 'offline');
		const r = rewriteOfflineMirrorAssetUrls(offline);
		if (r.filesModified > 0) gamesTouched++;
		filesModified += r.filesModified;
		filesScanned += r.filesScanned;
		opts?.onGame?.({ gameId, index: i + 1, total, result: r });
	}

	return { gamesWithOffline: total, gamesTouched, filesModified, filesScanned };
}
