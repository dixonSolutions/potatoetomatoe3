/**
 * Global mute + master volume for HTML media on this origin.
 * Cross-origin iframes cannot be controlled from the parent page.
 */

import { loadSiteSettings, patchSiteSettings, type MuteAudioScope } from '$lib/utils/site-settings';

export type { MuteAudioScope };

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

/**
 * Whether HTML media should be muted right now from mute-scope rules (not counting master volume).
 */
export function shouldForceMuteFromScope(): boolean {
	const scope = getMuteAudioScope();
	if (scope === 'off') return false;
	if (scope === 'always') return true;
	return document.visibilityState === 'hidden' || !document.hasFocus();
}

/** Combined mute flag + volume level to apply to each HTMLMediaElement. */
export function getMediaOutputState(): { muted: boolean; volume: number } {
	const scope = getMuteAudioScope();
	const master = getMasterVolume();
	if (scope === 'off') {
		return { muted: false, volume: master };
	}
	if (scope === 'always') {
		return { muted: true, volume: master };
	}
	const force = document.visibilityState === 'hidden' || !document.hasFocus();
	return { muted: force, volume: master };
}

function applyToMediaElement(el: HTMLMediaElement, muted: boolean, volume: number): void {
	el.volume = volume;
	el.muted = muted;
}

/**
 * Keeps `muted` + `volume` in sync for all current and future media nodes in `root` (and same-origin iframe documents).
 * Re-reads settings when `potato-tomato-privacy-settings-applied` fires.
 */
export function attachGlobalMediaMute(root: Document): () => void {
	const wiredIframes = new WeakSet<HTMLIFrameElement>();
	let scheduled = false;

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

	return () => {
		observer.disconnect();
		window.removeEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
		document.removeEventListener('visibilitychange', onFocusVisibility);
		window.removeEventListener('focus', onFocusVisibility);
		window.removeEventListener('blur', onFocusVisibility);
	};
}
