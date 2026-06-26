import fs from 'node:fs/promises';
import path from 'node:path';

export interface MergeResult {
	relativePath: string;
	size: number;
	partCount: number;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const PART_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Concatenate split .partN files into a single merged file.
 * Part files are kept for WebKit/Tauri, which fails on single 60MB+ HTTP downloads.
 */
async function mergeParts(outDir: string, baseName: string): Promise<MergeResult | null> {
	const buildDir = path.join(outDir, 'Build');
	const entries = await fs.readdir(buildDir);
	const partPattern = new RegExp(`^${baseName}\\.part(\\d+)$`);
	const parts = entries
		.map((name) => {
			const match = name.match(partPattern);
			return match ? { name, index: Number.parseInt(match[1], 10) } : null;
		})
		.filter((p): p is { name: string; index: number } => p !== null)
		.sort((a, b) => a.index - b.index);

	if (parts.length === 0) return null;

	const buffers: Buffer[] = [];
	for (const part of parts) {
		buffers.push(await fs.readFile(path.join(buildDir, part.name)));
	}

	const merged = Buffer.concat(buffers);
	const mergedPath = path.join(buildDir, baseName);
	await fs.writeFile(mergedPath, merged);

	console.log(
		`[merge] ${baseName}: ${parts.length} parts -> ${formatBytes(merged.length)} (parts kept for WebKit)`
	);

	return {
		relativePath: `Build/${baseName}`,
		size: merged.length,
		partCount: parts.length
	};
}

/**
 * Re-create .partN files from a merged build when only the merged copy exists.
 */
export async function ensureServeParts(outDir: string): Promise<void> {
	for (const baseName of ['Shrek2.data.br', 'Shrek2.wasm.br']) {
		const buildDir = path.join(outDir, 'Build');
		const mergedPath = path.join(buildDir, baseName);
		const partPattern = new RegExp(`^${baseName.replace('.', '\\.')}\\.part\\d+$`);

		try {
			await fs.access(mergedPath);
		} catch {
			continue;
		}

		const entries = await fs.readdir(buildDir);
		if (entries.some((name) => partPattern.test(name))) continue;

		const merged = await fs.readFile(mergedPath);
		let partIndex = 0;
		for (let offset = 0; offset < merged.length; offset += PART_CHUNK_BYTES) {
			const chunk = merged.subarray(offset, offset + PART_CHUNK_BYTES);
			await fs.writeFile(path.join(buildDir, `${baseName}.part${partIndex}`), chunk);
			partIndex++;
		}

		console.log(`[merge] split ${baseName} -> ${partIndex} serve part(s)`);
	}
}

/**
 * Merge data and wasm split files, keeping part files for chunked WebKit loading.
 */
export async function mergeSplitFiles(outDir: string): Promise<MergeResult[]> {
	const results: MergeResult[] = [];

	const dataResult = await mergeParts(outDir, 'Shrek2.data.br');
	if (dataResult) {
		results.push(dataResult);
		const alias = await linkBrotliAlias(outDir, dataResult);
		if (alias) results.push(alias);
	}

	const wasmResult = await mergeParts(outDir, 'Shrek2.wasm.br');
	if (wasmResult) {
		results.push(wasmResult);
		const alias = await linkBrotliAlias(outDir, wasmResult);
		if (alias) results.push(alias);
	}

	await ensureServeParts(outDir);

	return results;
}

/**
 * Hardlink `Shrek2.wasm.br` → `Shrek2.wasm` (and same for data).
 * Dev servers (Vite/sirv) attach Content-Encoding: br to *.br paths, which
 * breaks Unity's client-side Brotli decompression. Extensionless aliases are raw bytes.
 */
async function linkBrotliAlias(outDir: string, merged: MergeResult): Promise<MergeResult | null> {
	if (!merged.relativePath.endsWith('.br')) return null;

	const brPath = path.join(outDir, merged.relativePath);
	const aliasRelative = merged.relativePath.replace(/\.br$/, '');
	const aliasPath = path.join(outDir, aliasRelative);

	await fs.unlink(aliasPath).catch(() => {});
	try {
		await fs.link(brPath, aliasPath);
	} catch {
		await fs.copyFile(brPath, aliasPath);
	}

	console.log(`[merge] alias ${aliasRelative} -> ${merged.relativePath}`);

	return {
		relativePath: aliasRelative,
		size: merged.size,
		partCount: 0
	};
}
