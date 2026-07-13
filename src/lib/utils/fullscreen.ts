/** Cross-browser Fullscreen API helpers with CSS pseudo-fullscreen fallback (iOS Safari). */

export const PSEUDO_FULLSCREEN_CLASS = 'pseudo-fullscreen';

type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitFullscreenEnabled?: boolean;
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

export function isPseudoFullscreen(el: Element | null | undefined): boolean {
	return Boolean(el?.classList.contains(PSEUDO_FULLSCREEN_CLASS));
}

/** True when the element is in native fullscreen or CSS pseudo-fullscreen. */
export function isImmersiveElement(el: Element | null | undefined): boolean {
	return isFullscreenElement(el) || isPseudoFullscreen(el);
}

export function enterPseudoFullscreen(el: Element): void {
	el.classList.add(PSEUDO_FULLSCREEN_CLASS);
}

export function exitPseudoFullscreen(el: Element): void {
	el.classList.remove(PSEUDO_FULLSCREEN_CLASS);
}

function isNativeFullscreenAvailable(): boolean {
	if (typeof document === 'undefined') return false;
	const doc = document as FullscreenDocument;
	if (typeof doc.fullscreenEnabled === 'boolean') return doc.fullscreenEnabled;
	if (typeof doc.webkitFullscreenEnabled === 'boolean') return doc.webkitFullscreenEnabled;
	return typeof Element !== 'undefined' && 'requestFullscreen' in Element.prototype;
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

/**
 * Toggle immersive game view: try the real Fullscreen API first, fall back to a
 * fixed `100dvh` CSS class when the API is missing or rejects (iPhone Safari).
 */
export async function toggleFullscreen(el: Element): Promise<boolean> {
	if (isPseudoFullscreen(el)) {
		exitPseudoFullscreen(el);
		return false;
	}
	if (isFullscreenElement(el)) {
		await exitFullscreen();
		return false;
	}

	try {
		if (!isNativeFullscreenAvailable()) throw new Error('unsupported');
		await requestFullscreen(el);
		return true;
	} catch {
		enterPseudoFullscreen(el);
		return true;
	}
}
