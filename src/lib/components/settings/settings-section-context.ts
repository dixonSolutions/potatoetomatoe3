import { getContext, onDestroy, setContext } from 'svelte';

const SETTINGS_SHELL_CONTEXT = Symbol('potato-tomato-settings-shell');

/**
 * What a section with a Save button hands the shell. Sections that apply each change
 * as it is made (Playing, App) never register one, so the shell shows no save bar.
 */
export type SettingsSectionDraft = {
	/** Unsaved edits in the section; 0 hides the save bar. */
	readonly pending: number;
	/** Persist the edits. Resolve to a message to keep them unsaved and say why. */
	save: () => string | null | Promise<string | null>;
	/** Drop the edits and reload what is stored. */
	discard: () => void;
};

export type SettingsShellContext = {
	/** Anchor a search hit asked to show; a collapsed group holding it opens itself. */
	readonly revealId: string | null;
	registerDraft: (draft: SettingsSectionDraft) => () => void;
	/** A saved value changed: privacy timers, the play-limit lock and media volume re-read. */
	applied: () => void;
	/** Close the dialog, e.g. before following a link to another page. */
	close: () => void;
};

export function setSettingsShellContext(ctx: SettingsShellContext): void {
	setContext(SETTINGS_SHELL_CONTEXT, ctx);
}

export function getSettingsShellContext(): SettingsShellContext | undefined {
	return getContext<SettingsShellContext | undefined>(SETTINGS_SHELL_CONTEXT);
}

/** Call during component init: the shell's save bar follows this draft while it is mounted. */
export function useSettingsDraft(draft: SettingsSectionDraft): void {
	const shell = getSettingsShellContext();
	if (!shell) return;
	const unregister = shell.registerDraft(draft);
	onDestroy(unregister);
}
