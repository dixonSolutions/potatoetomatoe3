import { getContext, setContext } from 'svelte';
import type { SettingsSectionId } from '$lib/components/settings/settings-section-ids';

export const SETTINGS_UI_CONTEXT = Symbol('potato-tomato-settings-ui');

/** Open Settings at a section, with a setting brought into view (search-hit style). */
export type SettingsTarget = { section: SettingsSectionId; targetId: string };

export type SettingsUiApi = {
	openSettings: (target?: SettingsTarget) => void;
};

export function setSettingsUiContext(api: SettingsUiApi): void {
	setContext(SETTINGS_UI_CONTEXT, api);
}

export function getSettingsUiContext(): SettingsUiApi | undefined {
	return getContext<SettingsUiApi | undefined>(SETTINGS_UI_CONTEXT);
}
