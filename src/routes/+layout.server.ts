import type { LayoutServerLoad } from './$types';
import {
	DECOY_TITLES,
	PRIVACY_UNLOCK_COOKIE_NAME,
	isDocsDecoyTitleAllowed
} from '$lib/utils/privacy-mode';
import { SITE_SETTINGS_COOKIE, type PrivacyDisguiseMode } from '$lib/utils/site-settings';

/**
 * Read settings cookie on the server so the first HTML paint can match tab branding.
 * When privacy is on and disguise is not "off", we SSR the Docs title so the bundled Google Docs SVG
 * favicon applies immediately (session unlock / tab focus is client-only, so the client may swap back).
 */
export const load: LayoutServerLoad = async ({ cookies }) => {
	const raw = cookies.get(SITE_SETTINGS_COOKIE);
	const privacySessionUnlocked = cookies.get(PRIVACY_UNLOCK_COOKIE_NAME) === '1';
	let privacyModeEnabled = false;
	let storedDecoyTitle: string | null = null;
	let disguiseMode: PrivacyDisguiseMode = 'focus_loss';
	if (raw) {
		try {
			const parsed = JSON.parse(decodeURIComponent(raw)) as {
				privacyModeEnabled?: boolean;
				privacyDecoyTitle?: string | null;
				privacyDisguiseMode?: PrivacyDisguiseMode;
			};
			if (parsed && typeof parsed === 'object') {
				privacyModeEnabled = parsed.privacyModeEnabled === true;
				storedDecoyTitle =
					typeof parsed.privacyDecoyTitle === 'string' ? parsed.privacyDecoyTitle : null;
				const m = parsed.privacyDisguiseMode;
				if (m === 'off' || m === 'focus_loss' || m === 'always') {
					disguiseMode = m;
				}
			}
		} catch {
			/* ignore */
		}
	}

	let decoyTitle: string | null = null;
	if (privacyModeEnabled && disguiseMode !== 'off') {
		const pickDecoy =
			storedDecoyTitle && isDocsDecoyTitleAllowed(storedDecoyTitle) ? storedDecoyTitle : DECOY_TITLES[0];
		/* focus_loss: real title while unlocked + tab assumed visible on first paint; always: always decoy */
		if (disguiseMode === 'always' || !privacySessionUnlocked) {
			decoyTitle = pickDecoy;
		}
	}

	return {
		ssrPrivacyHead: {
			privacyModeEnabled,
			decoyTitle,
			privacySessionUnlocked
		}
	};
};
