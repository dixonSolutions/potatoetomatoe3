/**
 * Routing tests for `static/offline-sw.js`.
 *
 * The worker is plain ES5-ish script rather than a module, so it is evaluated in a vm
 * sandbox with the handful of globals a service worker gets. That is enough to assert
 * which branch a request takes, which is the part that has actually gone wrong: an
 * iframe load is a `navigate` request too, so an app-shell branch keyed on mode alone
 * swallowed same-origin game documents.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const SW_SOURCE = readFileSync(
	fileURLToPath(new URL('../../../static/offline-sw.js', import.meta.url)),
	'utf8'
);

const ORIGIN = 'https://dixonsolutions.github.io';
const SCOPE = `${ORIGIN}/potatoetomatoe3/`;

type FakeRequest = {
	url: string;
	method: string;
	mode: string;
	destination: string;
	headers: { get: () => null };
};

function request(
	url: string,
	overrides: Partial<Pick<FakeRequest, 'method' | 'mode' | 'destination'>> = {}
): FakeRequest {
	return {
		url,
		method: 'GET',
		mode: 'no-cors',
		destination: '',
		headers: { get: () => null },
		...overrides
	};
}

/** Load the worker and hand back its fetch listener plus a log of what it did. */
function loadWorker() {
	const cachePuts: Array<{ cache: string; key: string }> = [];
	const networkFetches: string[] = [];

	const openCache = (name: string) => ({
		put: (key: unknown) => {
			cachePuts.push({ cache: name, key: typeof key === 'string' ? key : String(key) });
			return Promise.resolve();
		},
		add: () => Promise.resolve(),
		match: () => Promise.resolve(undefined),
		keys: () => Promise.resolve([]),
		delete: () => Promise.resolve(true)
	});

	const listeners: Record<string, (event: unknown) => void> = {};
	const sandbox: Record<string, unknown> = {
		self: {
			addEventListener: (type: string, fn: (event: unknown) => void) => {
				listeners[type] = fn;
			},
			skipWaiting: () => {},
			clients: { claim: () => Promise.resolve() },
			registration: { scope: SCOPE },
			location: { origin: ORIGIN, hostname: 'dixonsolutions.github.io' }
		},
		caches: {
			open: (name: string) => Promise.resolve(openCache(name)),
			keys: () => Promise.resolve([]),
			match: () => Promise.resolve(undefined),
			delete: () => Promise.resolve(true)
		},
		fetch: (input: unknown) => {
			const url = typeof input === 'string' ? input : (input as FakeRequest).url;
			networkFetches.push(url);
			return Promise.resolve({
				ok: true,
				status: 200,
				statusText: 'OK',
				type: 'basic',
				url,
				clone() {
					return this;
				},
				text: () => Promise.resolve('<html><head></head><body></body></html>'),
				headers: { get: () => 'text/html; charset=utf-8' }
			});
		},
		Request: class {
			url: string;
			constructor(url: string) {
				this.url = url;
			}
		},
		Response: class {
			constructor(
				public body: unknown,
				public init?: unknown
			) {}
			static error() {
				return new this(null);
			}
		},
		URL,
		TextDecoder,
		TextEncoder,
		indexedDB: { open: () => ({}) },
		console
	};
	sandbox.globalThis = sandbox;
	runInContext(SW_SOURCE, createContext(sandbox));

	function dispatchFetch(req: FakeRequest) {
		let responded: unknown;
		listeners.fetch?.({
			request: req,
			respondWith: (value: unknown) => {
				responded = value;
			},
			waitUntil: () => {}
		});
		return { handled: responded !== undefined, response: responded };
	}

	return { dispatchFetch, cachePuts, networkFetches };
}

describe('offline-sw routing', () => {
	let worker: ReturnType<typeof loadWorker>;

	beforeEach(() => {
		worker = loadWorker();
	});

	it('treats a top-level app navigation as the shell', async () => {
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/staccato`, {
				mode: 'navigate',
				destination: 'document'
			})
		);
		expect(result.handled).toBe(true);
		await result.response;
		expect(worker.cachePuts).toEqual([{ cache: 'pt-app-shell-v1', key: SCOPE }]);
	});

	it('never caches a game iframe document as the app shell', async () => {
		/*
		 * Regression: iframe loads are `mode: navigate` as well, so a mode-only check
		 * stored the game's HTML under the shell key and an offline reload could serve
		 * the game in place of the app.
		 */
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/staccato/online/index.html`, {
				mode: 'navigate',
				destination: 'iframe'
			})
		);
		expect(result.handled).toBe(true);
		await result.response;
		expect(worker.cachePuts).toEqual([]);
	});

	it('still injects the storage bridge into a same-origin game shell', async () => {
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/staccato/online/index.html`, {
				mode: 'navigate',
				destination: 'iframe'
			})
		);
		const response = (await result.response) as { body: string };
		expect(response.body).toContain('game-storage-bridge.child.js');
	});

	it('does not claim a game document opened directly in a tab', async () => {
		/* Destination is legitimately `document` here, so the path is what rules it out. */
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/shrek-escape/offline/index.html`, {
				mode: 'navigate',
				destination: 'document'
			})
		);
		await result.response;
		expect(worker.cachePuts).toEqual([]);
	});

	it('keys route data by path so the sveltekit invalidation query cannot miss', async () => {
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/staccato/__data.json?x-sveltekit-invalidated=01`)
		);
		expect(result.handled).toBe(true);
		await result.response;
		expect(worker.cachePuts).toEqual([
			{ cache: 'pt-app-data-v1', key: `${ORIGIN}/potatoetomatoe3/games/staccato/__data.json` }
		]);
	});

	it('leaves game payload json to the game routes, not the data cache', async () => {
		const result = worker.dispatchFetch(
			request(`${ORIGIN}/potatoetomatoe3/games/staccato/offline/Build/build.json`)
		);
		expect(result.handled).toBe(false);
		expect(worker.cachePuts).toEqual([]);
	});
});
