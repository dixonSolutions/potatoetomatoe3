import type { Frame, Page } from 'playwright';

const FILE_URL_REGEX = /const\s+FILE_URL\s*=\s*['"]([^'"]+)['"]/;

export function parseEmbedFileUrl(html: string): string | null {
	const match = html.match(FILE_URL_REGEX);
	return match?.[1] ?? null;
}

export function extractIframeSrc(html: string): string | null {
	const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i, /<iframe[^>]+src=([^\s>]+)/i];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const src = m[1].replace(/&amp;/g, '&').trim();
			if (src.startsWith('http')) return src;
		}
	}
	return null;
}

/**
 * Collect HTML from the main document and reachable same-origin frames.
 */
export async function collectFrameHtml(page: Page): Promise<string[]> {
	const candidates: string[] = [];
	try {
		candidates.push(await page.content());
	} catch {
		// page may have navigated away
	}

	for (const frame of page.frames()) {
		try {
			candidates.push(await frame.content());
		} catch {
			// Cross-origin frames block content access
		}
	}
	return candidates;
}

/**
 * Find FILE_URL launcher markup (Google Sites / similar embed shells).
 */
export async function findEmbedFileUrl(page: Page): Promise<string | null> {
	for (const html of await collectFrameHtml(page)) {
		const url = parseEmbedFileUrl(html);
		if (url) return url;
	}
	return null;
}

/**
 * Nested iframe src attributes visible from same-origin frames.
 */
export async function listNestedIframeSrcs(page: Page): Promise<string[]> {
	const found = new Set<string>();
	for (const html of await collectFrameHtml(page)) {
		const src = extractIframeSrc(html);
		if (src) found.add(src);
	}

	for (const frame of page.frames()) {
		try {
			const srcs = await frame.$$eval('iframe[src]', (nodes) =>
				nodes
					.map((n) => (n as HTMLIFrameElement).src)
					.filter((s) => typeof s === 'string' && s.startsWith('http'))
			);
			for (const s of srcs) found.add(s);
		} catch {
			// ignore
		}
	}
	return [...found];
}

export function frameLooksLikeGame(html: string): boolean {
	return (
		/createUnityInstance|UnityLoader|DATA_PARTS|WASM_PARTS|c2runtime|lime\.embed|PokiSDK|YaGames/i.test(
			html
		) || html.length > 2_000
	);
}

/**
 * Wait until the page (or a child frame) looks like a game shell, or timeout.
 */
export async function waitForGameShell(page: Page, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const frame of page.frames()) {
			try {
				const html = await frame.content();
				if (frameLooksLikeGame(html)) return true;
			} catch {
				// cross-origin
			}
		}
		await page.waitForTimeout(400);
	}
	return false;
}

export type { Frame };
