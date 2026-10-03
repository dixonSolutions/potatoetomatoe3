import { afterEach, describe, expect, it, vi } from 'vitest';

/* Which frame hosts which game, as game-storage-bridge.ts would say. */
const hosting = vi.hoisted(() => new Map<unknown, string>());
vi.mock('./game-storage-bridge', () => ({
	mayTouchGameSaves: (source: unknown, gameId: string) => hosting.get(source) === gameId
}));

const {
	SHELL_FRAME_SANDBOX,
	buildShellHtml,
	buildShellLoader,
	createRemoteShell,
	frameLoadsPerStart,
	frameSandboxFor,
	insertFirstInHead,
	isShellBlobUrl,
	looksLikeHtml,
	releaseOnlineShells,
	shellDocumentFor,
	shellFrameSrcFor
} = await import('./online-play-routing-shell');

const bridgeSource = '/* bridge */ window.__ptBridge = 1;';

describe('buildShellHtml', () => {
	it('puts the base, the saves slot and the bridge ahead of everything in <head>', () => {
		const out = buildShellHtml(
			'<!DOCTYPE html><html lang="en"><head><script src="game.js"></script></head></html>',
			{ gameId: 'g-1', baseHref: 'https://cdn.jsdelivr.net/gh/u/r@1/index.html', bridgeSource }
		);
		const base = out.indexOf('<base href="https://cdn.jsdelivr.net/gh/u/r@1/index.html">');
		const slot = out.indexOf('<!--pt-shell-profile-->');
		const bridgeAt = out.indexOf('<script>window.__ptGameId="g-1";/* bridge */');
		expect(out.indexOf('<head>')).toBeLessThan(base);
		expect(base).toBeLessThan(slot);
		expect(slot).toBeLessThan(bridgeAt);
		expect(bridgeAt).toBeLessThan(out.indexOf('game.js'));
	});

	it('keeps a page’s own <base> (Drive U 7 embed.html brings one)', () => {
		const html = '<html><head><base href="https://cdn.jsdelivr.net/gh/x/y@main/a/"></head></html>';
		const out = buildShellHtml(html, { gameId: 'g', baseHref: 'https://other/', bridgeSource });
		expect(out).not.toContain('https://other/');
		expect(out).toContain('window.__ptGameId="g"');
	});

	it('drops a bridge tag written for the page’s own URL, which the shell’s base would break', () => {
		/* The dev server injects this into catalog HTML; under a jsDelivr <base> it would 404. */
		const html =
			'<head><script src="/game-storage-bridge.child.js"></script><base href="https://cdn.x/"></head>';
		const out = buildShellHtml(html, { gameId: 'g', bridgeSource });
		expect(out).not.toContain('game-storage-bridge.child.js');
		expect(out.match(/window\.__ptGameId/g)).toHaveLength(1);
	});

	it('escapes what it writes into attributes and scripts', () => {
		const out = buildShellHtml('<head></head>', {
			gameId: 'a"</script><b>',
			baseHref: 'https://h/?q="x"',
			bridgeSource: 'var s = "</script>";'
		});
		expect(out).toContain('href="https://h/?q=&quot;x&quot;"');
		/* Only the bridge's own closing tag: neither the id nor the source can end it early. */
		expect(out.match(/<\/script>/g)).toHaveLength(1);
		expect(out).toContain('window.__ptGameId="a\\"\\u003c/script>\\u003cb>"');
	});
});

describe('buildShellLoader', () => {
	it('is a small document of its own, whatever the game', () => {
		const out = buildShellLoader('g-1', 'blob:http://app/1', 'https://cdn.example');
		expect(out.startsWith('<!doctype html>')).toBe(true);
		expect(out.match(/<script>/g)).toHaveLength(1);
		expect(out.match(/<\/script>/g)).toHaveLength(1);
		expect(out.length).toBeLessThan(4096);
	});

	function runLoader() {
		const posted: Array<{ action?: string; type?: string }> = [];
		const written: string[] = [];
		const listeners: Record<string, ((e: unknown) => void)[]> = {};
		const app = { postMessage: (msg: { action?: string }) => posted.push(msg) };
		const fakeWindow = {
			top: app,
			addEventListener: (type: string, fn: (e: unknown) => void) =>
				(listeners[type] ??= []).push(fn)
		};
		const fakeDocument = {
			readyState: 'loading',
			open: () => {},
			write: (html: string) => written.push(html),
			close: () => {}
		};
		const html = buildShellLoader('g-1', 'blob:http://app/1', 'https://cdn.example');
		const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
		new Function('window', 'document', 'setTimeout', script)(
			fakeWindow,
			fakeDocument,
			(fn: () => void, ms: number) => (ms === 0 ? fn() : undefined)
		);
		const send = (source: unknown, data: unknown) =>
			listeners.message.forEach((fn) => fn({ source, data }));
		const load = () => listeners.load.forEach((fn) => fn({}));
		return { app, posted, written, send, load, fakeWindow };
	}

	it('asks the app for the game and its saves, and writes the game in once it has both', () => {
		const { app, posted, written, send, load } = runLoader();
		expect(posted).toEqual([
			{
				type: 'potato-tomato-game-shell',
				action: 'document',
				gameId: 'g-1',
				shell: 'blob:http://app/1'
			},
			{ type: 'potato-tomato-game-storage', action: 'pull', gameId: 'g-1' }
		]);
		const game = '<html><head><!--pt-shell-profile--><script>bridge()</script></head></html>';
		const document = {
			type: 'potato-tomato-game-shell',
			action: 'document',
			gameId: 'g-1',
			shell: 'blob:http://app/1',
			html: game
		};
		const profile = { schemaVersion: 1, updatedAt: 1, profile: { Default: {} } };
		const hydrate = {
			type: 'potato-tomato-game-storage',
			action: 'hydrate',
			gameId: 'g-1',
			data: profile
		};
		/* Something other than the app answering is ignored. */
		send({}, document);
		send({}, hydrate);
		send(app, document);
		send(app, hydrate);
		/* Not before the loader's own load: the frame fires `load` once for each document. */
		expect(written).toEqual([]);
		load();
		expect(written).toHaveLength(1);
		const page = written[0];
		expect(page.indexOf('window.__ptShell=')).toBeLessThan(page.indexOf('bridge()'));
		expect(page).toContain('"profile":{"schemaVersion":1');
		expect(page).toContain('"origin":"https://cdn.example"');
		expect(page).not.toContain('<!--pt-shell-profile-->');
	});

	it('never writes in a document another shell was sent', () => {
		const { app, written, send, load } = runLoader();
		send(app, {
			type: 'potato-tomato-game-shell',
			action: 'document',
			gameId: 'g-1',
			shell: 'blob:http://app/other',
			html: '<p>other</p>'
		});
		send(app, { type: 'potato-tomato-game-storage', action: 'hydrate', gameId: 'g-1', data: null });
		load();
		expect(written).toEqual([]);
	});
});

describe('shells for a visit', () => {
	afterEach(() => {
		releaseOnlineShells();
		vi.unstubAllGlobals();
	});

	function stubFetch(pages: Record<string, string>) {
		const calls: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string) => {
				const url = String(input);
				calls.push(url);
				if (url.endsWith('game-storage-bridge.child.js')) return new Response('/* bridge */');
				const body = pages[url];
				return body === undefined ? new Response('', { status: 404 }) : new Response(body);
			})
		);
		return calls;
	}

	it('makes one shell per game and page, and hands the same URL back until the visit ends', async () => {
		const page = 'https://cdn.jsdelivr.net/gh/u/r@1/index.html';
		const calls = stubFetch({ [page]: '<!doctype html><html><head></head></html>' });
		const [a, b] = await Promise.all([createRemoteShell('g', page), createRemoteShell('g', page)]);
		expect(a).toMatch(/^blob:/);
		expect(b).toBe(a);
		expect(await createRemoteShell('g', page)).toBe(a);
		expect(calls.filter((u) => u === page)).toHaveLength(1);
		expect(isShellBlobUrl(a)).toBe(true);
		expect(frameSandboxFor(a)).toBe(SHELL_FRAME_SANDBOX);
		expect(frameLoadsPerStart(a)).toBe(2);
		/* The URL names the shell; the frame loads its loader, which files saves under the host. */
		const src = shellFrameSrcFor(a) ?? '';
		expect(src.startsWith('data:text/html;charset=utf-8,')).toBe(true);
		expect(decodeURIComponent(src)).toContain('"https://cdn.jsdelivr.net"');
		expect(shellDocumentFor(a)).toContain('/* bridge */');
		releaseOnlineShells('g');
		expect(shellFrameSrcFor(a)).toBeUndefined();
		const c = await createRemoteShell('g', page);
		expect(c).not.toBe(a);
		/* A revoked shell stays known as one: a frame still pointing at it keeps its sandbox. */
		expect(frameSandboxFor(a)).toBe(SHELL_FRAME_SANDBOX);
	});

	it('never gives a shell the app origin', () => {
		expect(SHELL_FRAME_SANDBOX.split(' ')).not.toContain('allow-same-origin');
		expect(SHELL_FRAME_SANDBOX.split(' ')).not.toContain('allow-top-navigation');
		expect(frameSandboxFor('https://example.com/game.html')).toBeUndefined();
		expect(frameSandboxFor('blob:http://app/unrelated')).toBeUndefined();
		expect(frameLoadsPerStart('https://example.com/game.html')).toBe(1);
	});

	it('makes no shell of a page that is not HTML', async () => {
		const page = 'https://cdn.jsdelivr.net/gh/u/r@1/game.json';
		stubFetch({ [page]: '{"not":"html"}' });
		expect(await createRemoteShell('g', page)).toBeNull();
	});

	it("hands a game's document only to the frame hosting that game", async () => {
		const listeners: Array<(e: MessageEvent) => void> = [];
		vi.stubGlobal('window', {
			location: { origin: 'http://app' },
			addEventListener: (_type: string, fn: (e: MessageEvent) => void) => listeners.push(fn)
		});
		const page = 'https://cdn.jsdelivr.net/gh/u/r@1/index.html';
		stubFetch({ [page]: '<!doctype html><html><head></head></html>' });
		const url = (await createRemoteShell('hosted', page)) as string;
		const hosted = { postMessage: vi.fn() };
		const stranger = { postMessage: vi.fn() };
		hosting.set(hosted, 'hosted');
		const ask = (source: unknown, gameId: string) =>
			listeners.forEach((fn) =>
				fn({
					source,
					data: { type: 'potato-tomato-game-shell', action: 'document', gameId, shell: url }
				} as unknown as MessageEvent)
			);
		ask(stranger, 'hosted');
		ask(hosted, 'someone-else');
		expect(stranger.postMessage).not.toHaveBeenCalled();
		expect(hosted.postMessage).not.toHaveBeenCalled();
		ask(hosted, 'hosted');
		expect(hosted.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'document', shell: url, html: shellDocumentFor(url) }),
			'*'
		);
	});
});

describe('insertFirstInHead', () => {
	it('falls back to <html>, then to the very start', () => {
		expect(insertFirstInHead('<html><body></body></html>', 'X')).toBe(
			'<html>X<body></body></html>'
		);
		expect(insertFirstInHead('<p>bare</p>', 'X')).toBe('X<p>bare</p>');
		expect(insertFirstInHead('<header>not head</header>', 'X')).toBe('X<header>not head</header>');
	});
});

describe('looksLikeHtml', () => {
	it('recognises HTML served as text/plain and rejects other text', () => {
		expect(looksLikeHtml('\uFEFF  <!DOCTYPE html><html>')).toBe(true);
		expect(looksLikeHtml('<html lang="en">')).toBe(true);
		expect(looksLikeHtml('{"not":"html"}')).toBe(false);
		expect(looksLikeHtml('console.log(1)')).toBe(false);
	});
});
