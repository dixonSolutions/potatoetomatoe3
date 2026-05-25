import { getContext, setContext } from 'svelte';

export const SETTINGS_UI_CONTEXT = Symbol('potato-tomato-settings-ui');

export type SettingsUiApi = {
	openSettings: () => void;
};

export function setSettingsUiContext(api: SettingsUiApi): void {
	setContext(SETTINGS_UI_CONTEXT, api);
}

export function getSettingsUiContext(): SettingsUiApi | undefined {
	return getContext<SettingsUiApi | undefined>(SETTINGS_UI_CONTEXT);
}
