/** Cross-browser Fullscreen API helpers (desktop + mobile WebKit). */

type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = Element & {
	webkitRequestFullscreen?: () => Promise<void> | void;
};

export function getFullscreenElement(): Element | null {
	if (typeof document === 'undefined') return null;
	const doc = document as FullscreenDocument;
	return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isFullscreenElement(el: Element | null | undefined): boolean {
	if (!el) return false;
	return getFullscreenElement() === el;
}

export async function requestFullscreen(el: Element): Promise<void> {
	const target = el as FullscreenElement;
	const request = target.requestFullscreen?.bind(target) ?? target.webkitRequestFullscreen?.bind(target);
	if (!request) throw new Error('Fullscreen not supported');
	await request();
}

export async function exitFullscreen(): Promise<void> {
	const doc = document as FullscreenDocument;
	const exit = doc.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(document);
	if (!exit) return;
	await exit();
}

export async function toggleFullscreen(el: Element): Promise<boolean> {
	if (isFullscreenElement(el)) {
		await exitFullscreen();
		return false;
	}
	await requestFullscreen(el);
	return true;
}
