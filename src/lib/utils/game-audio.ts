/**
 * Helpers for game iframe audio: Web Audio unlock + focus-loss mute decisions.
 */

import { isAppWindowFocused } from '$lib/utils/app-window-focus';

/**
 * Whether mute-on-focus-loss should silence media.
 * Uses real app-window focus (Tauri / tracked browser state): other window → mute,
 * in-app including game iframe → keep sound.
 */
export function shouldMuteForFocusLoss(doc: Document = document): boolean {
	if (doc.visibilityState === 'hidden') return true;
	return !isAppWindowFocused();
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(win: Window): AudioContextCtor | null {
	const w = win as Window & {
		AudioContext?: AudioContextCtor;
		webkitAudioContext?: AudioContextCtor;
	};
	return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Resume suspended AudioContexts in a same-origin document tree. */
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

/** Notify same-origin frames to suspend/resume Web Audio (HTML mute cannot reach Unity). */
export function broadcastGameAudioOutput(muted: boolean, root: Document = document): void {
	const msg = { type: 'potato-tomato-audio-output', muted };
	for (const frame of root.querySelectorAll('iframe')) {
		if (!(frame instanceof HTMLIFrameElement)) continue;
		try {
			frame.contentWindow?.postMessage(msg, '*');
		} catch {
			/* ignore */
		}
		try {
			const child = frame.contentDocument;
			if (child) broadcastGameAudioOutput(muted, child);
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
