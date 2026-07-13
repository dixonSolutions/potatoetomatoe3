/**
 * Catalog thumbnail storage budget.
 *
 * Prefer local `online/assets/*` covers while total image bytes stay under the budget.
 * Once over budget (or a single cover is too large), store the remote URL in `thumbnail`
 * instead of downloading.
 */

import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '../data');
export const GAMES_ROOT = join(__dirname, '../../static/games');
export const LEDGER_PATH = join(DATA_DIR, 'thumb-budget.json');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg']);

/** Default total budget for local catalog thumbnails (online/assets images). */
export const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024; // 64 MiB

/** Prefer remote URL when a single cover would exceed this size. */
export const DEFAULT_MAX_SINGLE_BYTES = 256 * 1024; // 256 KiB

/**
 * @param {{ budgetBytes?: number, maxSingleBytes?: number }} [opts]
 */
export function getThumbBudgetConfig(opts = {}) {
	const envBudget = Number(process.env.CATALOG_THUMB_BUDGET_MB);
	const envSingle = Number(process.env.CATALOG_THUMB_MAX_SINGLE_KB);
	return {
		budgetBytes:
			opts.budgetBytes ??
			(Number.isFinite(envBudget) && envBudget > 0
				? Math.floor(envBudget * 1024 * 1024)
				: DEFAULT_BUDGET_BYTES),
		maxSingleBytes:
			opts.maxSingleBytes ??
			(Number.isFinite(envSingle) && envSingle > 0
				? Math.floor(envSingle * 1024)
				: DEFAULT_MAX_SINGLE_BYTES)
	};
}

function isImageFile(name) {
	return IMAGE_EXT.has(extname(name).toLowerCase());
}

/** Sum bytes of image files under each game online/assets directory. */
export function measureLocalThumbBytes(gamesRoot = GAMES_ROOT) {
	let total = 0;
	let files = 0;
	if (!existsSync(gamesRoot)) return { totalBytes: 0, files: 0 };
	for (const ent of readdirSync(gamesRoot, { withFileTypes: true })) {
		if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
		const assets = join(gamesRoot, ent.name, 'online', 'assets');
		if (!existsSync(assets)) continue;
		for (const f of readdirSync(assets, { withFileTypes: true })) {
			if (!f.isFile() || !isImageFile(f.name)) continue;
			try {
				total += statSync(join(assets, f.name)).size;
				files++;
			} catch {
				/* ignore */
			}
		}
	}
	return { totalBytes: total, files };
}

export function writeThumbBudgetLedger(extra = {}) {
	const { totalBytes, files } = measureLocalThumbBytes();
	const cfg = getThumbBudgetConfig();
	const payload = {
		updatedAt: new Date().toISOString(),
		budgetBytes: cfg.budgetBytes,
		maxSingleBytes: cfg.maxSingleBytes,
		usedBytes: totalBytes,
		files,
		overBudget: totalBytes >= cfg.budgetBytes,
		...extra
	};
	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(LEDGER_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
	return payload;
}

/**
 * @param {number} [additionalBytes] bytes we are about to add
 * @param {{ budgetBytes?: number, maxSingleBytes?: number }} [opts]
 */
export function shouldDownloadThumbnail(additionalBytes = 0, opts = {}) {
	const cfg = getThumbBudgetConfig(opts);
	if (additionalBytes > 0 && additionalBytes > cfg.maxSingleBytes) {
		return { download: false, reason: 'single-too-large', ...cfg, usedBytes: measureLocalThumbBytes().totalBytes };
	}
	const { totalBytes } = measureLocalThumbBytes();
	if (totalBytes + Math.max(0, additionalBytes) > cfg.budgetBytes) {
		return { download: false, reason: 'over-budget', ...cfg, usedBytes: totalBytes };
	}
	return { download: true, reason: 'ok', ...cfg, usedBytes: totalBytes };
}

/**
 * After a local download, if the file is oversized, delete it and signal remote fallback.
 * @param {string} filePath
 * @param {{ maxSingleBytes?: number }} [opts]
 */
export function enforceMaxSingleThumb(filePath, opts = {}) {
	const cfg = getThumbBudgetConfig(opts);
	if (!existsSync(filePath)) return { kept: false, size: 0 };
	const size = statSync(filePath).size;
	if (size > cfg.maxSingleBytes) {
		try {
			unlinkSync(filePath);
		} catch {
			/* ignore */
		}
		return { kept: false, size, reason: 'single-too-large' };
	}
	return { kept: true, size };
}

/**
 * Convert local thumbs to remote URL refs until under budget.
 * Only converts entries that already have `thumbnailRemote` in metadata.
 *
 * @param {{ dryRun?: boolean, budgetBytes?: number }} [opts]
 */
export function pruneLocalThumbsToBudget(opts = {}) {
	const cfg = getThumbBudgetConfig(opts);
	const dryRun = Boolean(opts.dryRun);
	const candidates = [];

	if (!existsSync(GAMES_ROOT)) return { removed: 0, freedBytes: 0, remainingBytes: 0 };

	for (const ent of readdirSync(GAMES_ROOT, { withFileTypes: true })) {
		if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
		const metaPath = join(GAMES_ROOT, ent.name, 'online', 'metadata.json');
		if (!existsSync(metaPath)) continue;
		let meta;
		try {
			meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
		} catch {
			continue;
		}
		const remote = typeof meta.thumbnailRemote === 'string' ? meta.thumbnailRemote.trim() : '';
		if (!/^https?:\/\//i.test(remote)) continue;

		const assets = join(GAMES_ROOT, ent.name, 'online', 'assets');
		if (!existsSync(assets)) continue;
		for (const f of readdirSync(assets, { withFileTypes: true })) {
			if (!f.isFile() || !isImageFile(f.name)) continue;
			const abs = join(assets, f.name);
			let size = 0;
			try {
				size = statSync(abs).size;
			} catch {
				continue;
			}
			candidates.push({ id: ent.name, metaPath, meta, abs, size, remote });
		}
	}

	candidates.sort((a, b) => b.size - a.size);
	let { totalBytes } = measureLocalThumbBytes();
	let removed = 0;
	let freedBytes = 0;

	for (const c of candidates) {
		if (totalBytes <= cfg.budgetBytes) break;
		if (!dryRun) {
			try {
				unlinkSync(c.abs);
			} catch {
				continue;
			}
			c.meta.thumbnail = c.remote;
			c.meta.thumbnailRemote = c.remote;
			c.meta.thumbnailStored = 'remote';
			writeFileSync(c.metaPath, `${JSON.stringify(c.meta, null, 2)}\n`, 'utf-8');
		}
		totalBytes -= c.size;
		freedBytes += c.size;
		removed++;
	}

	const ledger = writeThumbBudgetLedger({
		lastPruneAt: new Date().toISOString(),
		lastPruneRemoved: removed,
		lastPruneFreedBytes: freedBytes,
		dryRun
	});

	return {
		removed,
		freedBytes,
		remainingBytes: ledger.usedBytes,
		budgetBytes: cfg.budgetBytes,
		dryRun
	};
}
