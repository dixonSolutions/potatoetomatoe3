import type { LayoutServerLoad } from './$types';
import { PRIVACY_UNLOCK_COOKIE_NAME } from '$lib/utils/privacy-mode';
import {
	getDecoyFaviconUrl,
	isDecoyTitleForService,
	pickDecoyTitleForService,
	resolveDisguiseService
} from '$lib/utils/privacy-disguise-registry';
import { SITE_SETTINGS_COOKIE, type PrivacyDisguiseMode } from '$lib/utils/site-settings';

/**
 * Read settings cookie on the server so the first HTML paint can match tab branding.
 * When privacy is on and disguise is not "off", we SSR the decoy title/favicon for the selected service.
 */
export const load: LayoutServerLoad = async ({ cookies }) => {
	const raw = cookies.get(SITE_SETTINGS_COOKIE);
	const privacySessionUnlocked = cookies.get(PRIVACY_UNLOCK_COOKIE_NAME) === '1';
	let privacyModeEnabled = false;
	let storedDecoyTitle: string | null = null;
	let disguiseMode: PrivacyDisguiseMode = 'focus_loss';
	let disguiseProvider: 'google' | 'microsoft' = 'google';
	let disguiseService = 'docs';
	if (raw) {
		try {
			const parsed = JSON.parse(decodeURIComponent(raw)) as {
				privacyModeEnabled?: boolean;
				privacyDecoyTitle?: string | null;
				privacyDisguiseMode?: PrivacyDisguiseMode;
				privacyDisguiseProvider?: 'google' | 'microsoft';
				privacyDisguiseService?: string;
			};
			if (parsed && typeof parsed === 'object') {
				privacyModeEnabled = parsed.privacyModeEnabled === true;
				storedDecoyTitle =
					typeof parsed.privacyDecoyTitle === 'string' ? parsed.privacyDecoyTitle : null;
				const m = parsed.privacyDisguiseMode;
				if (m === 'off' || m === 'focus_loss' || m === 'always') {
					disguiseMode = m;
				}
				if (parsed.privacyDisguiseProvider === 'microsoft') {
					disguiseProvider = 'microsoft';
				}
				if (typeof parsed.privacyDisguiseService === 'string' && parsed.privacyDisguiseService) {
					disguiseService = parsed.privacyDisguiseService;
				}
			}
		} catch {
			/* ignore */
		}
	}

	const service = resolveDisguiseService(disguiseProvider, disguiseService);

	let decoyTitle: string | null = null;
	let decoyFavicon: string | null = null;
	if (privacyModeEnabled && disguiseMode !== 'off') {
		const pickDecoy =
			storedDecoyTitle && isDecoyTitleForService(service, storedDecoyTitle)
				? storedDecoyTitle
				: pickDecoyTitleForService(service);
		if (disguiseMode === 'always' || !privacySessionUnlocked) {
			decoyTitle = pickDecoy;
			decoyFavicon = getDecoyFaviconUrl(disguiseProvider, service.id);
		}
	}

	return {
		ssrPrivacyHead: {
			privacyModeEnabled,
			decoyTitle,
			decoyFavicon,
			privacySessionUnlocked
		}
	};
};
