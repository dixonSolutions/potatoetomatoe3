/**
 * The Linux desktop app's WebKitGTK tunings for games, as Settings sees them.
 *
 * Both run natively (`src-tauri/src/power_profile.rs`, `display_scale.rs`,
 * `game_frame_tuning.rs`); the switches live in the player settings
 * (`game-player-settings.ts`) and travel with each launch's frame context. Settings only
 * needs to know whether they apply on this platform, what state they are in this session,
 * and to tell the app when the power-saver switch changes, since the app reads that one
 * at startup, before any page exists.
 */

import { nativeGameFramesSupported } from './native-game-frames';

export type FullSpeedState =
	| 'active'
	| 'off-setting'
	| 'off-crash'
	| 'off-env'
	| 'unavailable'
	| 'unsupported';

export interface FullSpeedStatus {
	state: FullSpeedState;
	detail: string | null;
}

export interface DisplayScaleStatus {
	/** The monitor's real scale, when it could be read (1.25 at 125 %). */
	scale: number | null;
	/** The scale WebKit renders at (GTK's whole-number scale). */
	webkitScale: number | null;
	/** What game frames are capped at: set only when it is below WebKit's scale. */
	cap: number | null;
	detail: string | null;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
	return tauriInvoke<T>(command, args);
}

/** The platforms with these tunings: the Linux desktop app (WebKitGTK). */
export function webkitTuningSupported(): Promise<boolean> {
	return nativeGameFramesSupported();
}

export async function fetchFullSpeedStatus(): Promise<FullSpeedStatus | null> {
	if (!(await webkitTuningSupported())) return null;
	try {
		return await invoke<FullSpeedStatus>('full_speed_status');
	} catch {
		return null;
	}
}

export async function fetchDisplayScaleStatus(): Promise<DisplayScaleStatus | null> {
	if (!(await webkitTuningSupported())) return null;
	try {
		return await invoke<DisplayScaleStatus>('display_scale_status');
	} catch {
		return null;
	}
}

/** The app reads the power-saver switch at its next start: tell it now. */
export async function syncFullSpeedSetting(enabled: boolean): Promise<void> {
	if (!(await webkitTuningSupported())) return;
	try {
		await invoke('set_full_speed_setting', { enabled });
	} catch {
		/* the next game launch carries the setting too */
	}
}

/**
 * The hint under the power-saver switch: what it does, and what is true this session when
 * that differs from the switch.
 */
export function fullSpeedHint(enabled: boolean, status: FullSpeedStatus | null): string {
	const base =
		'Power saver otherwise halves games to 30 fps. Only while a game is open. Applies the next time the app starts.';
	if (!status) return base;
	if (status.state === 'off-crash' && enabled) {
		return 'Turned itself off after the game engine crashed with it on. Switch it off and on to try again at the next start.';
	}
	if (status.state === 'unavailable' && enabled) {
		return 'Not available in this build of the app.';
	}
	if (status.state === 'active' && !enabled) {
		return 'Off from the next game, and no longer loaded the next time the app starts.';
	}
	if (status.state === 'off-setting' && enabled) {
		return 'On from the next time the app starts.';
	}
	return base;
}

/** The hint under the display-scale switch. */
export function displayScaleHint(status: DisplayScaleStatus | null): string {
	const base =
		'On fractional scaling such as 125 %, games draw the pixels your screen shows instead of up to 2.5 times as many. Much faster, slightly softer. From the next game.';
	if (!status || status.scale == null || status.webkitScale == null) return base;
	const pct = Math.round(status.scale * 100);
	if (status.cap != null) {
		return `Your display is at ${pct} %; without this, games draw at ${status.webkitScale * 100} %. Much faster, slightly softer. From the next game.`;
	}
	return `Your display is at ${pct} %, so games already draw at its scale.`;
}
