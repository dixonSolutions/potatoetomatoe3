#!/usr/bin/env node

/**
 * Downscale locally stored game covers to tile size.
 *
 * The importers saved whatever the portal served. That left covers up to 1920x1080 in
 * `static/games/<id>/online/assets/`, which the browse grids render into ~107 CSS px
 * tiles. Measured on a Galaxy Tab Active3, eight such covers alone accounted for 11 of
 * the 18.6 megapixels decoded on one Home screen — more than every remote cover combined
 * — and they ship inside the Android APK as well.
 *
 * Remote covers are sized at request time instead (`src/lib/utils/thumbnail-size.ts`);
 * local ones have no CDN to ask, so they are resized in place.
 *
 * 512px matches DEFAULT_TARGET_PX there: a square tile crops a 16:9 cover to its centre,
 * so the short side is what must cover the tile, and 512x288 clears a 138 CSS px tile at
 * devicePixelRatio 2 with no visible upscale.
 *
 * Needs ImageMagick (`magick`). Only files wider than the cap are touched, so re-running
 * is a no-op.
 *
 * Usage:
 *   node scripts/shrink-game-thumbnails.mjs           # report only
 *   node scripts/shrink-game-thumbnails.mjs --write
 *   node scripts/shrink-game-thumbnails.mjs --write --max 640
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DEFAULT_MAX_WIDTH = 512;

function parseArgs() {
	const args = process.argv.slice(2);
	const maxIdx = args.indexOf('--max');
	return {
		write: args.includes('--write'),
		maxWidth: maxIdx > -1 ? Number(args[maxIdx + 1]) || DEFAULT_MAX_WIDTH : DEFAULT_MAX_WIDTH
	};
}

function listCovers() {
	const out = [];
	if (!existsSync(GAMES_ROOT)) return out;
	for (const entry of readdirSync(GAMES_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
		const assets = join(GAMES_ROOT, entry.name, 'online', 'assets');
		if (!existsSync(assets)) continue;
		for (const file of readdirSync(assets)) {
			if (IMAGE_EXT.has(extname(file).toLowerCase())) out.push(join(assets, file));
		}
	}
	return out;
}

/**
 * Read dimensions *and* the real encoding.
 *
 * The importers saved whatever bytes the portal returned under a `.png` name, so most of
 * these files are actually JPEG. Re-encoding by filename extension turns a 380 KB JPEG
 * into a 700 KB true PNG — a first pass at this script grew the tree from 47 MB to
 * 103 MB. Always write back in the format the file already is.
 */
function identify(path) {
	try {
		const out = execFileSync('magick', ['identify', '-format', '%w %h %m', `${path}[0]`], {
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'ignore']
		});
		const [w, h, format] = out.trim().split(/\s+/);
		return Number.isFinite(Number(w)) && Number.isFinite(Number(h)) && format
			? { w: Number(w), h: Number(h), format: format.toLowerCase() }
			: null;
	} catch {
		return null;
	}
}

function main() {
	const { write, maxWidth } = parseArgs();
	const covers = listCovers();

	let oversized = 0;
	let bytesBefore = 0;
	let bytesAfter = 0;
	let pixelsSaved = 0;
	let failed = 0;
	let skippedLarger = 0;

	for (const path of covers) {
		const dim = identify(path);
		if (!dim || dim.w <= maxWidth) continue;
		oversized++;
		const before = statSync(path).size;
		bytesBefore += before;
		const scaled = Math.round(dim.h * (maxWidth / dim.w));
		pixelsSaved += dim.w * dim.h - maxWidth * scaled;

		if (!write) {
			bytesAfter += before;
			continue;
		}
		try {
			/*
			 * `format:path` pins the encoder to what the file already is, ignoring the
			 * extension. `-strip` drops portal EXIF/ICC; these are decorative covers.
			 */
			execFileSync(
				'magick',
				[path, '-resize', `${maxWidth}x`, '-strip', '-quality', '82', `${dim.format}:${path}`],
				{ stdio: ['ignore', 'ignore', 'pipe'] }
			);
			const after = statSync(path).size;
			/* Never trade bytes for pixels: keep the original when re-encoding made it worse. */
			if (after >= before) {
				execFileSync('git', ['checkout', '--', path], {
					cwd: join(__dirname, '..'),
					stdio: 'ignore'
				});
				skippedLarger++;
				bytesAfter += before;
			} else {
				bytesAfter += after;
			}
		} catch {
			failed++;
			bytesAfter += before;
		}
	}

	const mb = (n) => (n / 1048576).toFixed(1);
	console.log(`[shrink-thumbnails] scanned ${covers.length} covers, cap ${maxWidth}px`);
	console.log(
		`[shrink-thumbnails] ${oversized} oversized, ${(pixelsSaved / 1e6).toFixed(0)} MP saved`
	);
	console.log(`[shrink-thumbnails] ${mb(bytesBefore)} MB -> ${mb(bytesAfter)} MB`);
	if (skippedLarger)
		console.log(`[shrink-thumbnails] ${skippedLarger} re-encoded larger and were restored`);
	if (failed) console.log(`[shrink-thumbnails] ${failed} failed to re-encode and were left alone`);
	if (!write) console.log('[shrink-thumbnails] report only — pass --write to apply');
}

main();
