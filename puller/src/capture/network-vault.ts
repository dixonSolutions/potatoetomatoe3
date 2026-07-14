import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Page, Response } from 'playwright';
import { isCapturableUrl, localPathForUrl } from './rewrite.js';

export interface VaultEntry {
	url: string;
	status: number;
	contentType: string;
	headers: Record<string, string>;
	initiatorUrl?: string;
	body: Buffer;
}

export interface NetworkVault {
	/** Absolute URLs captured during the session. */
	entries: Map<string, VaultEntry>;
	attach(page: Page): void;
	detach(page: Page): void;
	waitForIdle(): Promise<void>;
	/** Persist all entries under outDir using baseUrl for path layout. */
	flush(outDir: string, baseUrl: string): Promise<string[]>;
}

const SKIP_CONTENT_TYPES = /(?:text\/event-stream|application\/octet-stream;\s*charset=binary)/i;

function shouldSkipUrl(url: string): boolean {
	if (!isCapturableUrl(url)) return true;
	try {
		const u = new URL(url);
		// Analytics / ad beacons — skip bodies we do not need for play
		if (
			/\b(doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.com\/tr)\b/i.test(
				u.hostname
			)
		) {
			return true;
		}
	} catch {
		return true;
	}
	return false;
}

/**
 * Collect every successful HTTP response body while a Playwright page loads.
 */
export function createNetworkVault(): NetworkVault {
	const entries = new Map<string, VaultEntry>();
	const handlers = new WeakMap<Page, (response: Response) => void>();
	const pending = new Set<Promise<void>>();

	async function ingest(response: Response): Promise<void> {
		const url = response.url();
		if (shouldSkipUrl(url)) return;
		if (!isCapturableUrl(url)) return;
		if (entries.has(url)) return;

		const status = response.status();
		if (status < 200 || status >= 400) return;

		const contentType = response.headers()['content-type'] ?? '';
		if (SKIP_CONTENT_TYPES.test(contentType) && contentType.includes('event-stream')) return;

		try {
			const body = Buffer.from(await response.body());
			if (body.length === 0) return;
			entries.set(url, {
				url,
				status,
				contentType,
				headers: response.headers(),
				initiatorUrl: response.request().frame()?.url(),
				body
			});
		} catch {
			// Body unavailable (redirect, opaque, cancelled)
		}
	}

	return {
		entries,
		attach(page: Page) {
			const handler = (response: Response) => {
				const task = ingest(response);
				pending.add(task);
				void task.finally(() => pending.delete(task));
			};
			handlers.set(page, handler);
			page.on('response', handler);
		},
		detach(page: Page) {
			const handler = handlers.get(page);
			if (handler) {
				page.off('response', handler);
				handlers.delete(page);
			}
		},
		async waitForIdle() {
			while (pending.size > 0) {
				await Promise.all([...pending]);
			}
		},
		async flush(outDir: string, baseUrl: string): Promise<string[]> {
			await this.waitForIdle();
			const written: string[] = [];
			for (const entry of entries.values()) {
				const dest = localPathForUrl(baseUrl, entry.url, outDir);
				await fs.mkdir(path.dirname(dest), { recursive: true });
				await fs.writeFile(dest, entry.body);
				written.push(dest);
			}
			const manifest = [...entries.values()].map((entry) => ({
				url: entry.url,
				path: path
					.relative(outDir, localPathForUrl(baseUrl, entry.url, outDir))
					.split(path.sep)
					.join('/'),
				status: entry.status,
				contentType: entry.contentType,
				headers: entry.headers,
				initiatorUrl: entry.initiatorUrl,
				bytes: entry.body.length,
				sha256: createHash('sha256').update(entry.body).digest('hex')
			}));
			await fs.writeFile(
				path.join(outDir, 'capture-manifest.json'),
				`${JSON.stringify({ version: 1, baseUrl, capturedAt: new Date().toISOString(), entries: manifest }, null, 2)}\n`,
				'utf-8'
			);
			return written;
		}
	};
}
