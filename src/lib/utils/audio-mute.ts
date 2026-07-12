/**
 * Global mute + master volume for HTML media on this origin.
 * Cross-origin iframes cannot be controlled from the parent page — blank them on privacy lock.
 *
 * Important: never pause() game media on transient focus changes — that permanently silenced
 * in-app play when focus moved into the game iframe (play() on unmute is often blocked).
 */

import { loadSiteSettings, patchSiteSettings, type MuteAudioScope } from '$lib/utils/site-settings';
import { shouldMuteForFocusLoss, broadcastGameAudioOutput } from '$lib/utils/game-audio';
import { APP_WINDOW_FOCUS_CHANGED } from '$lib/utils/app-window-focus';

export type { MuteAudioScope };

export const PRIVACY_LOCKED_EVENT = 'potato-tomato-privacy-locked';

export function getMuteAudioScope(): MuteAudioScope {
	const s = loadSiteSettings().muteAudioScope;
	if (s === 'off' || s === 'focus_loss' || s === 'always') return s;
	return 'off';
}

export function saveMuteAudioScope(scope: MuteAudioScope): void {
	patchSiteSettings({ muteAudioScope: scope });
}

export function getMasterVolume(): number {
	const v = loadSiteSettings().masterVolume;
	if (typeof v !== 'number' || Number.isNaN(v)) return 1;
	return Math.max(0, Math.min(1, v));
}

export function saveMasterVolume(volume: number): void {
	patchSiteSettings({ masterVolume: Math.max(0, Math.min(1, volume)) });
}

export function isPrivacyOutputLocked(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.hasAttribute('data-privacy-locked');
}

/**
 * Whether HTML media should be muted right now from mute-scope rules (not counting master volume).
 */
export function shouldForceMuteFromScope(): boolean {
	if (isPrivacyOutputLocked()) return true;
	const scope = getMuteAudioScope();
	if (scope === 'off') return false;
	if (scope === 'always') return true;
	return shouldMuteForFocusLoss(document);
}

/** Combined mute flag + volume level to apply to each HTMLMediaElement. */
export function getMediaOutputState(): { muted: boolean; volume: number } {
	const master = getMasterVolume();
	/* Privacy lock screen must never leak game/app audio (disguise). */
	if (isPrivacyOutputLocked()) {
		return { muted: true, volume: 0 };
	}
	const scope = getMuteAudioScope();
	if (scope === 'off') {
		return { muted: false, volume: master };
	}
	if (scope === 'always') {
		return { muted: true, volume: master };
	}
	return { muted: shouldMuteForFocusLoss(document), volume: master };
}

/**
 * Apply mute/volume without pausing. Pausing on focus-loss made in-app audio stay dead
 * after focus entered the game iframe (autoplay blocks resume).
 */
function applyToMediaElement(el: HTMLMediaElement, muted: boolean, volume: number): void {
	el.volume = muted ? 0 : volume;
	el.muted = muted;
}

/**
 * Keeps `muted` + `volume` in sync for all current and future media nodes in `root` (and same-origin iframe documents).
 * Re-reads settings when `potato-tomato-privacy-settings-applied` fires.
 * Always silences on privacy lock (`data-privacy-locked` / privacy-locked event).
 */
export function attachGlobalMediaMute(root: Document): () => void {
	const wiredIframes = new WeakSet<HTMLIFrameElement>();
	let scheduled = false;
	let lastBroadcastMuted: boolean | null = null;

	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			run();
		});
	};

	function applyToRoot(doc: Document, muted: boolean, volume: number): void {
		for (const el of doc.querySelectorAll('audio, video')) {
			if (el instanceof HTMLMediaElement) {
				applyToMediaElement(el, muted, volume);
			}
		}
		for (const frame of doc.querySelectorAll('iframe')) {
			if (!(frame instanceof HTMLIFrameElement)) continue;
			if (!wiredIframes.has(frame)) {
				wiredIframes.add(frame);
				frame.addEventListener('load', schedule);
			}
			try {
				const idoc = frame.contentDocument;
				if (idoc) applyToRoot(idoc, muted, volume);
			} catch {
				/* cross-origin */
			}
		}
	}

	function run() {
		const { muted, volume } = getMediaOutputState();
		applyToRoot(root, muted, volume);
		if (lastBroadcastMuted !== muted) {
			lastBroadcastMuted = muted;
			broadcastGameAudioOutput(muted, root);
		}
	}

	run();

	const observer = new MutationObserver(() => schedule());
	observer.observe(root.documentElement, { childList: true, subtree: true });

	const onSettingsApplied = () => schedule();
	window.addEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);

	const onFocusVisibility = () => schedule();
	document.addEventListener('visibilitychange', onFocusVisibility);
	window.addEventListener('focus', onFocusVisibility);
	window.addEventListener('blur', onFocusVisibility);
	document.addEventListener('focusin', onFocusVisibility);
	window.addEventListener(PRIVACY_LOCKED_EVENT, onFocusVisibility);
	window.addEventListener(APP_WINDOW_FOCUS_CHANGED, onFocusVisibility);

	return () => {
		observer.disconnect();
		window.removeEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
		document.removeEventListener('visibilitychange', onFocusVisibility);
		window.removeEventListener('focus', onFocusVisibility);
		window.removeEventListener('blur', onFocusVisibility);
		document.removeEventListener('focusin', onFocusVisibility);
		window.removeEventListener(PRIVACY_LOCKED_EVENT, onFocusVisibility);
		window.removeEventListener(APP_WINDOW_FOCUS_CHANGED, onFocusVisibility);
	};
}
