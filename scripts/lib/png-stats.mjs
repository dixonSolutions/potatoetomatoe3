/**
 * Minimal PNG reader plus the handful of pixel statistics the desktop field tests need.
 *
 * Deliberately dependency-free: the screenshots come from the GNOME desktop daemon as
 * plain 8-bit RGB/RGBA PNGs, and pulling in an image library for "how bright is this
 * rectangle" would be the heaviest part of the test. Handles non-interlaced 8-bit
 * truecolour (with or without alpha) and greyscale, which is everything a compositor
 * screenshot is ever encoded as.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {{ width: number, height: number, rgb: Uint8Array }} Image
 *   `rgb` is packed RGB, three bytes per pixel, row-major.
 */

/** @param {Buffer} buf @returns {Image} */
export function decodePng(buf) {
	if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
	let offset = 8;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colorType = 0;
	let interlace = 0;
	const idat = [];
	while (offset < buf.length) {
		const length = buf.readUInt32BE(offset);
		const type = buf.toString('latin1', offset + 4, offset + 8);
		const data = buf.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
			interlace = data[12];
		} else if (type === 'IDAT') {
			idat.push(data);
		} else if (type === 'IEND') {
			break;
		}
		offset += 12 + length;
	}
	if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
	if (interlace !== 0) throw new Error('interlaced PNG not supported');
	const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const rgb = new Uint8Array(width * height * 3);
	let prev = new Uint8Array(stride);
	let pos = 0;
	for (let y = 0; y < height; y++) {
		const filter = raw[pos++];
		const line = new Uint8Array(raw.buffer, raw.byteOffset + pos, stride);
		pos += stride;
		const cur = new Uint8Array(stride);
		for (let i = 0; i < stride; i++) {
			const a = i >= channels ? cur[i - channels] : 0;
			const b = prev[i];
			const c = i >= channels ? prev[i - channels] : 0;
			let value = line[i];
			switch (filter) {
				case 1:
					value += a;
					break;
				case 2:
					value += b;
					break;
				case 3:
					value += (a + b) >> 1;
					break;
				case 4: {
					const p = a + b - c;
					const pa = Math.abs(p - a);
					const pb = Math.abs(p - b);
					const pc = Math.abs(p - c);
					value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
					break;
				}
			}
			cur[i] = value & 0xff;
		}
		let out = y * width * 3;
		for (let x = 0; x < width; x++) {
			const px = x * channels;
			if (channels >= 3) {
				rgb[out++] = cur[px];
				rgb[out++] = cur[px + 1];
				rgb[out++] = cur[px + 2];
			} else {
				rgb[out++] = cur[px];
				rgb[out++] = cur[px];
				rgb[out++] = cur[px];
			}
		}
		prev = cur;
	}
	return { width, height, rgb };
}

/** Relative luminance on a 0..1 scale, from sRGB bytes (no gamma; a threshold test). */
export function luminance(r, g, b) {
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 */

/**
 * Mean colour and luminance inside a rectangle, plus how much of it reads as light
 * versus dark. `lightFraction` is what a theme test actually wants: a dark page with a
 * white strip along one edge still has a low mean but a telling fraction.
 *
 * @param {Image} img @param {Rect} rect @param {{ step?: number, lightAbove?: number, darkBelow?: number }} [opts]
 */
export function rectStats(img, rect, opts = {}) {
	const step = opts.step ?? 2;
	const lightAbove = opts.lightAbove ?? 0.6;
	const darkBelow = opts.darkBelow ?? 0.35;
	const x0 = Math.max(0, Math.floor(rect.x));
	const y0 = Math.max(0, Math.floor(rect.y));
	const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
	const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
	let n = 0;
	let r = 0;
	let g = 0;
	let b = 0;
	let light = 0;
	let dark = 0;
	for (let y = y0; y < y1; y += step) {
		for (let x = x0; x < x1; x += step) {
			const i = (y * img.width + x) * 3;
			const pr = img.rgb[i];
			const pg = img.rgb[i + 1];
			const pb = img.rgb[i + 2];
			r += pr;
			g += pg;
			b += pb;
			const l = luminance(pr, pg, pb);
			if (l >= lightAbove) light++;
			else if (l <= darkBelow) dark++;
			n++;
		}
	}
	if (n === 0)
		return { samples: 0, mean: [0, 0, 0], luminance: 0, lightFraction: 0, darkFraction: 0 };
	return {
		samples: n,
		mean: [Math.round(r / n), Math.round(g / n), Math.round(b / n)],
		luminance: Number(luminance(r / n, g / n, b / n).toFixed(3)),
		lightFraction: Number((light / n).toFixed(4)),
		darkFraction: Number((dark / n).toFixed(4))
	};
}

/**
 * Where two same-sized frames differ, as blobs of coarse cells.
 *
 * Used to find a window that has just appeared: everything that changed against the
 * pre-launch desktop, grouped into connected regions. A second region of window-like
 * size is exactly what a "ghost window" would look like from the outside.
 *
 * @param {Image} before @param {Image} after
 * @param {{ cell?: number, threshold?: number, ignoreTop?: number, minCells?: number }} [opts]
 * @returns {{ blobs: Rect[], changedCells: number }}
 */
export function diffBlobs(before, after, opts = {}) {
	const cell = opts.cell ?? 16;
	const threshold = opts.threshold ?? 24;
	const ignoreTop = opts.ignoreTop ?? 0;
	const minCells = opts.minCells ?? 4;
	if (before.width !== after.width || before.height !== after.height) {
		throw new Error('frames differ in size');
	}
	const cols = Math.ceil(before.width / cell);
	const rows = Math.ceil(before.height / cell);
	const changed = new Uint8Array(cols * rows);
	let changedCells = 0;
	for (let cy = 0; cy < rows; cy++) {
		for (let cx = 0; cx < cols; cx++) {
			const x0 = cx * cell;
			const y0 = cy * cell;
			if (y0 + cell <= ignoreTop) continue;
			let hits = 0;
			let samples = 0;
			for (let y = y0; y < Math.min(y0 + cell, before.height); y += 4) {
				for (let x = x0; x < Math.min(x0 + cell, before.width); x += 4) {
					const i = (y * before.width + x) * 3;
					const d =
						Math.abs(before.rgb[i] - after.rgb[i]) +
						Math.abs(before.rgb[i + 1] - after.rgb[i + 1]) +
						Math.abs(before.rgb[i + 2] - after.rgb[i + 2]);
					if (d > threshold) hits++;
					samples++;
				}
			}
			if (samples && hits / samples > 0.25) {
				changed[cy * cols + cx] = 1;
				changedCells++;
			}
		}
	}
	// Flood-fill the changed cells into blobs.
	const seen = new Uint8Array(cols * rows);
	const blobs = [];
	for (let start = 0; start < changed.length; start++) {
		if (!changed[start] || seen[start]) continue;
		const stack = [start];
		seen[start] = 1;
		let minX = cols;
		let minY = rows;
		let maxX = -1;
		let maxY = -1;
		let count = 0;
		while (stack.length) {
			const idx = stack.pop();
			const cx = idx % cols;
			const cy = (idx - cx) / cols;
			count++;
			if (cx < minX) minX = cx;
			if (cx > maxX) maxX = cx;
			if (cy < minY) minY = cy;
			if (cy > maxY) maxY = cy;
			const neighbours = [
				[cx - 1, cy],
				[cx + 1, cy],
				[cx, cy - 1],
				[cx, cy + 1]
			];
			for (const [nx, ny] of neighbours) {
				if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
				const n = ny * cols + nx;
				if (changed[n] && !seen[n]) {
					seen[n] = 1;
					stack.push(n);
				}
			}
		}
		if (count >= minCells) {
			blobs.push({
				x: minX * cell,
				y: minY * cell,
				width: (maxX - minX + 1) * cell,
				height: (maxY - minY + 1) * cell,
				cells: count
			});
		}
	}
	blobs.sort((a, b) => b.cells - a.cells);
	return { blobs, changedCells };
}

/**
 * Fraction of a rectangle whose brightness class disagrees with `expectDark`, and the
 * bounding box of the disagreeing area. This is the "ghost" measure: on a dark page,
 * any sizeable light patch is content that should not be there (or the reverse).
 *
 * @param {Image} img @param {Rect} rect @param {boolean} expectDark
 */
export function mismatchRegion(img, rect, expectDark, opts = {}) {
	const step = opts.step ?? 2;
	const x0 = Math.max(0, Math.floor(rect.x));
	const y0 = Math.max(0, Math.floor(rect.y));
	const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
	const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
	let n = 0;
	let bad = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -1;
	let maxY = -1;
	for (let y = y0; y < y1; y += step) {
		for (let x = x0; x < x1; x += step) {
			const i = (y * img.width + x) * 3;
			const l = luminance(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]);
			const isLight = l >= 0.6;
			const isDark = l <= 0.35;
			const wrong = expectDark ? isLight : isDark;
			n++;
			if (wrong) {
				bad++;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	return {
		fraction: n ? Number((bad / n).toFixed(4)) : 0,
		box: bad ? { x: minX, y: minY, width: maxX - minX + step, height: maxY - minY + step } : null
	};
}

/* ------------------------------------------------------------------ writing */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c;
});

function crc32(buf) {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function chunk(type, data) {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, 'latin1');
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/**
 * Encode packed RGB as an 8-bit truecolour PNG, Paeth-filtered rows, maximum deflate.
 * Only used to write the crops that go into a report — UI screenshots are mostly flat
 * colour and long gradients, and the Paeth predictor is what keeps those committed
 * frames in the tens of kilobytes rather than the hundreds.
 *
 * @param {Image} img
 */
export function encodePng(img) {
	const stride = img.width * 3;
	const raw = Buffer.alloc((stride + 1) * img.height);
	let prev = new Uint8Array(stride);
	for (let y = 0; y < img.height; y++) {
		const cur = img.rgb.subarray(y * stride, (y + 1) * stride);
		const out = y * (stride + 1);
		raw[out] = 4;
		for (let i = 0; i < stride; i++) {
			const a = i >= 3 ? cur[i - 3] : 0;
			const b = prev[i];
			const c = i >= 3 ? prev[i - 3] : 0;
			const p = a + b - c;
			const pa = Math.abs(p - a);
			const pb = Math.abs(p - b);
			const pc = Math.abs(p - c);
			const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			raw[out + 1 + i] = (cur[i] - pred) & 0xff;
		}
		prev = cur;
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(img.width, 0);
	ihdr.writeUInt32BE(img.height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/**
 * A rectangle cut out of an image, clamped to its bounds.
 *
 * @param {Image} img @param {Rect} rect @returns {Image}
 */
export function crop(img, rect) {
	const x0 = Math.max(0, Math.floor(rect.x));
	const y0 = Math.max(0, Math.floor(rect.y));
	const x1 = Math.min(img.width, Math.ceil(rect.x + rect.width));
	const y1 = Math.min(img.height, Math.ceil(rect.y + rect.height));
	const width = Math.max(0, x1 - x0);
	const height = Math.max(0, y1 - y0);
	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		rgb.set(
			img.rgb.subarray(((y0 + y) * img.width + x0) * 3, ((y0 + y) * img.width + x1) * 3),
			y * width * 3
		);
	}
	return { width, height, rgb };
}

/**
 * Half-size copy (2×2 box filter). Report frames are evidence of colour and layout,
 * not of pixel detail, and at half size a full-window crop is a quarter of the bytes.
 *
 * @param {Image} img @returns {Image}
 */
export function halve(img) {
	const width = Math.floor(img.width / 2);
	const height = Math.floor(img.height / 2);
	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const a = (y * 2 * img.width + x * 2) * 3;
			const b = a + 3;
			const c = a + img.width * 3;
			const d = c + 3;
			const o = (y * width + x) * 3;
			rgb[o] = (img.rgb[a] + img.rgb[b] + img.rgb[c] + img.rgb[d]) >> 2;
			rgb[o + 1] = (img.rgb[a + 1] + img.rgb[b + 1] + img.rgb[c + 1] + img.rgb[d + 1]) >> 2;
			rgb[o + 2] = (img.rgb[a + 2] + img.rgb[b + 2] + img.rgb[c + 2] + img.rgb[d + 2]) >> 2;
		}
	}
	return { width, height, rgb };
}
