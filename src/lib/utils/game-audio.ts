/**
 * Helpers for game iframe audio: Web Audio unlock + focus detection used by mute scope.
 */

/** True when focus is inside an embedded frame (playing a game), not another OS window. */
export function isFocusInsideEmbeddedFrame(doc: Document = document): boolean {
	const active = doc.activeElement;
	if (active && active.tagName === 'IFRAME') return true;

	for (const frame of doc.querySelectorAll('iframe')) {
		if (frame.tagName !== 'IFRAME') continue;
		const iframe = frame as HTMLIFrameElement;
		try {
			const child = iframe.contentDocument;
			if (child?.hasFocus()) return true;
			if (child && isFocusInsideEmbeddedFrame(child)) return true;
		} catch {
			/* cross-origin nested frame — outer iframe still counts as in-app play */
			if (active === frame) return true;
		}
	}
	return false;
}

/**
 * Whether mute-on-focus-loss should silence media.
 * Tab hidden → mute. Focus in a game iframe → keep sound. True OS/window blur → mute.
 */
export function shouldMuteForFocusLoss(doc: Document = document): boolean {
	if (doc.visibilityState === 'hidden') return true;
	if (doc.hasFocus()) return false;
	if (isFocusInsideEmbeddedFrame(doc)) return false;
	return true;
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(win: Window): AudioContextCtor | null {
	const w = win as Window & {
		AudioContext?: AudioContextCtor;
		webkitAudioContext?: AudioContextCtor;
	};
	return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Resume suspended AudioContexts and HTMLMediaElements in a same-origin document tree. */
export function unlockDocumentAudio(doc: Document): void {
	const win = doc.defaultView;
	if (!win) return;

	const AC = getAudioContextCtor(win);
	if (AC) {
		try {
			const w = win as Window & { __ptSharedAudioCtx?: AudioContext };
			const ctx = w.__ptSharedAudioCtx ?? new AC();
			w.__ptSharedAudioCtx = ctx;
			if (ctx.state === 'suspended') void ctx.resume();
		} catch {
			/* ignore */
		}
	}

	for (const el of doc.querySelectorAll('audio, video')) {
		if (!(el instanceof HTMLMediaElement)) continue;
		try {
			if (el.paused && el.getAttribute('data-pt-was-playing') === '1') {
				void el.play().catch(() => {});
			}
		} catch {
			/* ignore */
		}
	}

	for (const frame of doc.querySelectorAll('iframe')) {
		if (!(frame instanceof HTMLIFrameElement)) continue;
		try {
			const child = frame.contentDocument;
			if (child) unlockDocumentAudio(child);
		} catch {
			/* cross-origin */
		}
	}
}

/** Best-effort unlock after the user clicks Play (gesture may not reach the iframe). */
export function unlockGameIframeAudio(iframe: HTMLIFrameElement | null | undefined): void {
	if (!iframe || iframe.tagName !== 'IFRAME') return;
	try {
		iframe.contentWindow?.postMessage({ type: 'potato-tomato-unlock-audio' }, '*');
	} catch {
		/* ignore */
	}
	try {
		const doc = iframe.contentDocument;
		if (doc) unlockDocumentAudio(doc);
	} catch {
		/* cross-origin — rely on allow=autoplay + in-frame listeners */
	}
}
