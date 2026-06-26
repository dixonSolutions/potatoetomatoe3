import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const GAME_SHELL_MARKERS =
	/c2runtime|cr_createRuntime|lime\.embed|UnityLoader|createUnityInstance|openfl-content|Construct 2|openfl-content/i;

export function mirroredIndexCandidates(out: string, iframeUrl: string): string[] {
	const parsed = new URL(iframeUrl);
	const parts = parsed.pathname.split('/').filter(Boolean);
	const hostDir = path.join(out, parsed.hostname);
	const candidates = [path.join(out, 'index.html'), path.join(hostDir, 'index.html')];

	if (parts.length === 0) return candidates;

	const last = parts[parts.length - 1];
	candidates.push(path.join(hostDir, ...parts, 'index.html'));
	candidates.push(path.join(hostDir, ...parts.slice(0, -1), `${last}.html`));
	candidates.push(path.join(hostDir, ...parts, `${last}.html`));

	return candidates;
}

async function collectHtmlFiles(dir: string, acc: string[] = []): Promise<string[]> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
		else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== '_external') {
			await collectHtmlFiles(full, acc);
		}
	}
	return acc;
}

function scoreEntryHtml(filePath: string, content: string, iframeSrc: string): number {
	let score = 0;
	const name = path.basename(filePath).toLowerCase();
	const urlParts = new URL(iframeSrc).pathname.split('/').filter(Boolean);
	const last = urlParts[urlParts.length - 1]?.toLowerCase();

	if (name === 'index.html') score += 100;
	else if (name === 'index.htm') score += 90;
	if (last && name === `${last}.html`) score += 85;
	if (last && name.replace(/\.html?$/, '') === last) score += 70;
	if (GAME_SHELL_MARKERS.test(content)) score += 60;
	if (/<script\b/i.test(content)) score += 15;
	if (content.length >= 500) score += 10;
	if (content.length >= 2000) score += 5;

	return score;
}

/** Pick the best mirrored HTML entry (not always index.html). */
export async function resolveMirroredEntryHtml(
	out: string,
	iframeSrc: string
): Promise<string> {
	for (const candidate of mirroredIndexCandidates(out, iframeSrc)) {
		if (!existsSync(candidate)) continue;
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile() && stat.size >= 64) return candidate;
		} catch {
			// try next
		}
	}

	const htmlFiles = await collectHtmlFiles(out);
	if (htmlFiles.length === 0) {
		throw new Error('Mirror completed but no playable HTML entry point found');
	}

	let best = htmlFiles[0];
	let bestScore = -1;

	for (const filePath of htmlFiles) {
		try {
			const stat = await fs.stat(filePath);
			if (!stat.isFile() || stat.size < 64) continue;
			const content = await fs.readFile(filePath, 'utf-8');
			const score = scoreEntryHtml(filePath, content, iframeSrc);
			if (score > bestScore) {
				bestScore = score;
				best = filePath;
			}
		} catch {
			// skip unreadable
		}
	}

	if (bestScore < 0) {
		throw new Error('Mirror completed but no playable HTML entry point found');
	}

	return best;
}
