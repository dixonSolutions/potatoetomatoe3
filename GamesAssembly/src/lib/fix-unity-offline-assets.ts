/**
 * Post-process mirrored `static/games/<id>/offline/` trees so Unity WebGL loads don’t
 * hit the host app (HTML) instead of real assets — the usual cause of
 * `SyntaxError: expected expression, got '<'`.
 *
 * Fixes (idempotent):
 * 1. **Scheme-less absolute URLs** in JSON (`build.json`, etc.): strings like
 *    `tbg95.pages.dev/game/file.unityweb` become `https://tbg95.pages.dev/...`
 *    so the browser doesn’t resolve them under `/games/<id>/offline/...`.
 * 2. **Broken root loader paths** in HTML: `unityWebglLoaderUrl: '/UnityLoader.js'`
 *    → `'UnityLoader.js'` (relative to the offline shell) so the request isn’t
 *    `https://localhost/UnityLoader.js` (SPA HTML).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { GAMES_ROOT } from '../paths.js';

export type UnityFixReport = {
	gamesScanned: number;
	gamesTouched: number;
	filesModified: number;
	details: { relativePath: string; kinds: string[] }[];
};

export type UnityFixOptions = {
	/** When set, only walk these game ids (still under `gamesRoot/<id>/offline/`). */
	onlyGameIds?: ReadonlySet<string>;
};

/** True if the string looks like `hostname/path` and must be absolute with https. */
export function fixSchemelessAbsoluteUrl(s: string): string {
	const t = s.trim();
	if (!t) return s;
	if (
		t.includes('://') ||
		t.startsWith('//') ||
		t.startsWith('/') ||
		t.startsWith('./') ||
		t.startsWith('../') ||
		t.startsWith('data:') ||
		t.startsWith('blob:') ||
		t.startsWith('#') ||
		t.startsWith('mailto:')
	) {
		return s;
	}
	// `domain.tld/rest` or `host:port/rest` — not relative paths like `Build/file.json`
	if (/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*\.)+[a-zA-Z]{2,}\//.test(t)) {
		return `https://${t}`;
	}
	if (/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*\.)+[a-zA-Z]{2,}:\d+\//.test(t)) {
		return `https://${t}`;
	}
	return s;
}

function fixJsonStringsDeep(value: unknown): { next: unknown; changed: boolean } {
	let changed = false;
	if (typeof value === 'string') {
		const n = fixSchemelessAbsoluteUrl(value);
		if (n !== value) changed = true;
		return { next: n, changed };
	}
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const item of value) {
			const r = fixJsonStringsDeep(item);
			if (r.changed) changed = true;
			out.push(r.next);
		}
		return { next: out, changed };
	}
	if (value !== null && typeof value === 'object') {
		const o = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const k of Object.keys(o)) {
			const r = fixJsonStringsDeep(o[k]);
			if (r.changed) changed = true;
			out[k] = r.next;
		}
		return { next: out, changed };
	}
	return { next: value, changed: false };
}

/** Fix `unityWebglLoaderUrl: '/UnityLoader.js'` (and .2019 variants) in HTML/inline config. */
export function fixHtmlUnityRootLoaderPaths(html: string): { text: string; changed: boolean } {
	let text = html;
	let changed = false;
	// Root-only paths that break when the shell lives under /games/<id>/offline/
	const patterns: [RegExp, string][] = [
		[/unityWebglLoaderUrl\s*:\s*'\/UnityLoader\.js'/g, "unityWebglLoaderUrl: 'UnityLoader.js'"],
		[/unityWebglLoaderUrl\s*:\s*"\/UnityLoader\.js"/g, 'unityWebglLoaderUrl: "UnityLoader.js"'],
		[/unityWebglLoaderUrl\s*:\s*'\/UnityLoader\.2019\.1\.js'/g, "unityWebglLoaderUrl: 'UnityLoader.2019.1.js'"],
		[/unityWebglLoaderUrl\s*:\s*"\/UnityLoader\.2019\.1\.js"/g, 'unityWebglLoaderUrl: "UnityLoader.2019.1.js"'],
		[/unityWebglLoaderUrl\s*:\s*'\/UnityLoader\.2019\.2\.js'/g, "unityWebglLoaderUrl: 'UnityLoader.2019.2.js'"],
		[/unityWebglLoaderUrl\s*:\s*"\/UnityLoader\.2019\.2\.js"/g, 'unityWebglLoaderUrl: "UnityLoader.2019.2.js"']
	];
	for (const [re, rep] of patterns) {
		const n = text.replace(re, rep);
		if (n !== text) {
			text = n;
			changed = true;
		}
	}
	return { text, changed };
}

function jsonFileWouldNeedUnityFix(absPath: string): boolean {
	const raw = readFileSync(absPath, 'utf8');
	let data: unknown;
	try {
		data = JSON.parse(raw) as unknown;
	} catch {
		return false;
	}
	return fixJsonStringsDeep(data).changed;
}

function htmlFileWouldNeedUnityFix(absPath: string): boolean {
	const raw = readFileSync(absPath, 'utf8');
	return fixHtmlUnityRootLoaderPaths(raw).changed;
}

function processJsonFile(absPath: string): { modified: boolean; kinds: string[] } {
	const raw = readFileSync(absPath, 'utf8');
	let data: unknown;
	try {
		data = JSON.parse(raw) as unknown;
	} catch {
		return { modified: false, kinds: [] };
	}
	const { next, changed } = fixJsonStringsDeep(data);
	if (!changed) return { modified: false, kinds: [] };
	const out = JSON.stringify(next, null, 2) + '\n';
	try {
		writeFileSync(absPath, out, 'utf8');
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.warn(`[fix-unity-offline] skip (not writable): ${absPath} (${msg})`);
		return { modified: false, kinds: [] };
	}
	return { modified: true, kinds: ['json:schemeless-url→https'] };
}

function processHtmlFile(absPath: string): { modified: boolean; kinds: string[] } {
	const raw = readFileSync(absPath, 'utf8');
	const kinds: string[] = [];
	let text = raw;

	const loader = fixHtmlUnityRootLoaderPaths(text);
	if (loader.changed) {
		text = loader.text;
		kinds.push('html:root-UnityLoader-path');
	}

	if (kinds.length === 0) return { modified: false, kinds: [] };
	try {
		writeFileSync(absPath, text, 'utf8');
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.warn(`[fix-unity-offline] skip (not writable): ${absPath} (${msg})`);
		return { modified: false, kinds: [] };
	}
	return { modified: true, kinds };
}

function listGameIds(gamesRoot: string): string[] {
	if (!existsSync(gamesRoot)) return [];
	return readdirSync(gamesRoot).filter((id) => {
		const p = join(gamesRoot, id);
		try {
			return statSync(p).isDirectory();
		} catch {
			return false;
		}
	});
}

function walkOfflineJsonHtml(
	offlineRoot: string,
	cb: (abs: string, ext: string) => void
): void {
	if (!existsSync(offlineRoot)) return;
	function walk(dir: string): void {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(p);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				walk(p);
				continue;
			}
			const ext = extname(name).toLowerCase();
			if (ext === '.json' || ext === '.html') cb(p, ext);
		}
	}
	walk(offlineRoot);
}

/**
 * Read-only: true if walking `offlineRoot` would change any `.json`/`.html` the same way as
 * {@link runUnityOfflineFixes} (scheme-less URLs, root UnityLoader paths).
 */
export function offlineDirWouldNeedUnityFix(offlineRoot: string): boolean {
	if (!existsSync(offlineRoot)) return false;
	let needs = false;
	walkOfflineJsonHtml(offlineRoot, (abs, ext) => {
		if (needs) return;
		if (ext === '.json') {
			if (jsonFileWouldNeedUnityFix(abs)) needs = true;
		} else if (ext === '.html') {
			if (htmlFileWouldNeedUnityFix(abs)) needs = true;
		}
	});
	return needs;
}

/**
 * Walk `gamesRoot/<id>/offline/` for every game and apply Unity-oriented fixes.
 * Default `gamesRoot` is repo `static/games`.
 */
export function runUnityOfflineFixes(
	gamesRoot: string = GAMES_ROOT,
	options: UnityFixOptions = {}
): UnityFixReport {
	const only = options.onlyGameIds;
	const details: UnityFixReport['details'] = [];
	let gamesScanned = 0;
	let gamesTouched = new Set<string>();
	let filesModified = 0;

	for (const gameId of listGameIds(gamesRoot)) {
		if (only && !only.has(gameId)) continue;
		const offlineRoot = join(gamesRoot, gameId, 'offline');
		if (!existsSync(offlineRoot)) continue;
		gamesScanned++;

		walkOfflineJsonHtml(offlineRoot, (abs, ext) => {
			const rel = relative(gamesRoot, abs);
			if (ext === '.json') {
				const r = processJsonFile(abs);
				if (r.modified) {
					filesModified++;
					gamesTouched.add(gameId);
					details.push({ relativePath: rel, kinds: r.kinds });
				}
			} else if (ext === '.html') {
				const r = processHtmlFile(abs);
				if (r.modified) {
					filesModified++;
					gamesTouched.add(gameId);
					details.push({ relativePath: rel, kinds: r.kinds });
				}
			}
		});
	}

	return {
		gamesScanned,
		gamesTouched: gamesTouched.size,
		filesModified,
		details: details.slice(0, 80)
	};
}
