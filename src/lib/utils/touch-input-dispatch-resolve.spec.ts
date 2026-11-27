import { describe, expect, it } from 'vitest';
import { resolveInjectable } from './touch-input-dispatch';

/* Minimal fake documents: enough of Document / HTMLIFrameElement for resolveInjectable. */
type FakeEl = { tagName: string; id?: string };
type FakeFrame = {
	contentWindow: object | null;
	contentDocument: FakeDoc | null;
	crossOrigin?: boolean;
};

class FakeDoc {
	constructor(
		public URL: string,
		private els: FakeEl[] = [],
		private frames: FakeFrame[] = []
	) {}
	querySelector(sel: string) {
		return this.querySelectorAll(sel)[0] ?? null;
	}
	querySelectorAll(sel: string): unknown[] {
		if (sel === 'iframe') return this.frames.map(asFrame);
		const ids = [...sel.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
		return this.els.filter(
			(e) => (sel === 'canvas' && e.tagName === 'CANVAS') || (e.id && ids.includes(e.id))
		);
	}
}

/* A cross-origin frame throws on contentDocument, like a browser. */
function asFrame(f: FakeFrame) {
	return {
		contentWindow: f.contentWindow,
		get contentDocument() {
			if (f.crossOrigin) throw new DOMException('cross-origin', 'SecurityError');
			return f.contentDocument;
		}
	};
}

const top = (doc: FakeDoc) =>
	asFrame({ contentWindow: {}, contentDocument: doc }) as unknown as HTMLIFrameElement;

describe('resolveInjectable', () => {
	it('a same-origin game with a canvas is injectable', () => {
		const doc = new FakeDoc('http://app/games/x/', [{ tagName: 'CANVAS' }]);
		expect(resolveInjectable(top(doc))?.doc).toBe(doc);
	});

	it('Unity player.html wrapping a cross-origin #game iframe is not', () => {
		const doc = new FakeDoc(
			'http://app/unity/player.html?src=https://cdn/x',
			[{ tagName: 'IFRAME', id: 'game' }],
			[{ contentWindow: {}, contentDocument: null, crossOrigin: true }]
		);
		expect(resolveInjectable(top(doc))).toBeNull();
	});

	it('a wrapper whose child is still on about:blank is not', () => {
		const blank = new FakeDoc('about:blank');
		const doc = new FakeDoc(
			'http://app/unity/player.html',
			[{ tagName: 'IFRAME', id: 'game' }],
			[{ contentWindow: {}, contentDocument: blank }]
		);
		expect(resolveInjectable(top(doc))).toBeNull();
	});

	it('a shell with a same-origin game frame resolves to that frame', () => {
		const inner = new FakeDoc('http://app/games/x/inner.html', [{ tagName: 'CANVAS' }]);
		const doc = new FakeDoc(
			'http://app/games/x/',
			[],
			[{ contentWindow: {}, contentDocument: inner }]
		);
		expect(resolveInjectable(top(doc))?.doc).toBe(inner);
	});
});
