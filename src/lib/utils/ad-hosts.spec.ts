import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { AD_HOSTS, isAdHost } from './ad-hosts';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** The AD_HOSTS array literal in a static script. */
function listIn(source: string): string[] {
	const m = source.match(/AD_HOSTS = \[([^\]]*)\]/);
	if (!m) throw new Error('AD_HOSTS not found');
	return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** The blocker block of the bridge, as source. */
function blockerSource(): string {
	const src = read('static/game-storage-bridge.child.js');
	const start = src.indexOf('(function () {\n\tif (window.top === window || window.__ptAdBlock)');
	const end = src.indexOf('\n})();', start);
	if (start < 0 || end < 0) throw new Error('blocker block not found');
	return src.slice(start, end + 6);
}

describe('ad host list', () => {
	it('bridge and service worker carry the same list as ad-hosts.ts', () => {
		expect(listIn(read('static/game-storage-bridge.child.js'))).toEqual([...AD_HOSTS]);
		expect(listIn(read('static/offline-sw.js'))).toEqual([...AD_HOSTS]);
	});

	it.each([
		['doubleclick.net', true],
		['securepubads.g.doubleclick.net', true],
		['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', true],
		['https://imasdk.googleapis.com/js/sdkloader/ima3.js', true],
		['fonts.googleapis.com', false],
		['https://cdn.example-game.com/game.js', false],
		['notdoubleclick.net', false],
		['', false]
	])('%s → %s', (host, expected) => {
		expect(isAdHost(host)).toBe(expected);
	});
});

/* ---------- the bridge block against a fake frame ---------- */

function fakeFrame() {
	const posted: unknown[] = [];
	const fetched: string[] = [];
	const beacons: string[] = [];
	class FakeEvent {
		constructor(public type: string) {}
	}
	class El {
		tagName = '';
		type = '';
		events: string[] = [];
		attrs: Record<string, string> = {};
		dispatchEvent(e: FakeEvent) {
			this.events.push(e.type);
		}
		setAttribute(name: string, value: string) {
			this.attrs[name] = value;
		}
	}
	/* Like browsers: src is an accessor on HTMLScriptElement.prototype itself. */
	class Script extends El {
		tagName = 'SCRIPT';
		private _src = '';
		get src() {
			return this._src;
		}
		set src(v: string) {
			this._src = v;
		}
	}
	class Xhr {
		url = '';
		sent = false;
		events: string[] = [];
		open(_m: string, url: string) {
			this.url = url;
		}
		send() {
			this.sent = true;
		}
		dispatchEvent(e: FakeEvent) {
			this.events.push(e.type);
		}
	}
	const win: Record<string, unknown> = {
		location: { href: 'https://game.example/index.html' },
		parent: { postMessage: (m: unknown) => posted.push(m) },
		fetch: (url: string) => {
			fetched.push(String(url));
			return Promise.resolve('ok');
		},
		XMLHttpRequest: Xhr,
		navigator: {
			sendBeacon: (url: string) => {
				beacons.push(url);
				return true;
			}
		},
		HTMLScriptElement: Script,
		Element: El,
		Event: FakeEvent,
		URL,
		Promise,
		TypeError,
		Object,
		String,
		setTimeout: (fn: () => void) => {
			fn();
			return 1;
		}
	};
	win.window = win;
	win.top = {};
	vm.runInNewContext(blockerSource(), win);
	return { win, posted, fetched, beacons, Script, Xhr };
}

describe('bridge ad blocker', () => {
	it('rejects fetches to ad hosts and lets the game through', async () => {
		const f = fakeFrame();
		const fetch = f.win.fetch as (u: string) => Promise<unknown>;
		await expect(fetch('https://www.google-analytics.com/collect')).rejects.toThrow();
		await expect(fetch('https://game.example/level1.json')).resolves.toBe('ok');
		expect(f.fetched).toEqual(['https://game.example/level1.json']);
		expect((f.win.__ptAdBlock as { blocked: number }).blocked).toBe(1);
		expect(f.posted).toEqual([{ type: 'potato-tomato-ads-blocked', blocked: 1 }]);
	});

	it('never gives an ad script its src, and fires error so the game moves on', () => {
		const f = fakeFrame();
		const s = new f.Script();
		s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
		expect(s.src).toBe('');
		expect(s.type).toBe('javascript/blocked');
		expect(s.events).toEqual(['error']);
		const ok = new f.Script();
		ok.src = 'https://game.example/game.js';
		expect(ok.src).toBe('https://game.example/game.js');
	});

	it('blocks setAttribute(src), XHR and sendBeacon to ad hosts', () => {
		const f = fakeFrame();
		const s = new f.Script();
		s.setAttribute('src', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js');
		expect(s.attrs.src).toBeUndefined();
		const x = new f.Xhr();
		x.open('GET', 'https://c.amazon-adsystem.com/aax2/apstag.js');
		x.send();
		expect(x.sent).toBe(false);
		expect(x.events).toEqual(['error']);
		const send = (f.win.navigator as { sendBeacon: (u: string) => boolean }).sendBeacon;
		expect(send('https://www.clarity.ms/collect')).toBe(true);
		expect(f.beacons).toEqual([]);
		expect((f.win.__ptAdBlock as { blocked: number }).blocked).toBe(3);
	});
});
