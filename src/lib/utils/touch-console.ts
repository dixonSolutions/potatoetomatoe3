/**
 * Universal touch console preferences: global defaults + sparse per-game overrides.
 * Positions are stored as viewport percentages so layouts survive screen size and orientation.
 */

import { canUseLocalStorage } from '$lib/utils/browser-storage';
import { isLocalAppDeployment } from './offline-deployment';

export type TouchOrientation = 'landscape' | 'portrait';

export type TouchAvailability = 'auto' | 'always' | 'off';

/** A keyboard code (KeyboardEvent.code) the console can emit. */
export type TouchKeyCode = string;

export type TouchControlPosition = {
	/** 0–1 fraction of the overlay viewport width (left edge of control). */
	xPct: number;
	/** 0–1 fraction of the overlay viewport height (top edge of control). */
	yPct: number;
	/** Control diameter / width in CSS pixels (scaled by global scale at render). */
	size: number;
};

export type TouchButtonDef = TouchControlPosition & {
	id: string;
	label: string;
	/** KeyboardEvent.code values fired while pressed (e.g. ['Space']). */
	codes: TouchKeyCode[];
};

export type TouchJoystickDef = TouchControlPosition & {
	/** Deadzone as a fraction of the stick radius (0–1). */
	deadzone: number;
};

export type TouchConsolePanel = {
	/** Top-left of the compact console rectangle as viewport fractions. */
	xPct: number;
	yPct: number;
	/** Panel width as a fraction of viewport width. */
	widthPct: number;
	/** Panel height as a fraction of viewport height. */
	heightPct: number;
};

export type TouchLayout = {
	console: TouchConsolePanel;
	joystick: TouchJoystickDef;
	buttons: TouchButtonDef[];
};

/** Translate the entire control cluster by viewport-relative deltas. */
export function translateTouchLayout(layout: TouchLayout, dxPct: number, dyPct: number): TouchLayout {
	const translate = <T extends { xPct: number; yPct: number }>(control: T): T => ({
		...control,
		xPct: clamp01(control.xPct + dxPct),
		yPct: clamp01(control.yPct + dyPct)
	});
	return {
		...layout,
		console: {
			...layout.console,
			xPct: clamp01(layout.console.xPct + dxPct),
			yPct: clamp01(layout.console.yPct + dyPct)
		},
		joystick: translate(layout.joystick),
		buttons: layout.buttons.map((button) => translate(button))
	};
}

export type TouchDirection = 'up' | 'down' | 'left' | 'right';

/** Joystick stick only — exclusive arrow keys or WASD (not both). */
export type TouchJoystickScheme = 'arrows' | 'wasd';

export type TouchKeyMapping = {
	/** Direction → KeyboardEvent.code values (driven by joystickScheme). */
	directions: Record<TouchDirection, TouchKeyCode[]>;
	/** Button id → KeyboardEvent.code values (overrides button.codes when set). */
	buttons: Record<string, TouchKeyCode[]>;
};

export type TouchConsoleSettings = {
	version: 1;
	enabled: boolean;
	availability: TouchAvailability;
	/** 0–1 visual opacity of the glass controls. */
	opacity: number;
	/** Multiplier applied to control sizes (0.6–1.6). */
	scale: number;
	haptics: boolean;
	/** Automatically open controls on touch-first devices without a reliable keyboard. */
	autoEnableOnTouchOnly: boolean;
	/** Joystick emits Arrow keys or WASD (Space / face buttons unchanged). */
	joystickScheme: TouchJoystickScheme;
	layouts: Record<TouchOrientation, TouchLayout>;
	mapping: TouchKeyMapping;
};

export type TouchConsoleGameOverride = {
	version: 1;
	layouts?: Partial<Record<TouchOrientation, TouchLayout>>;
	mapping?: Partial<TouchKeyMapping>;
};

export type EffectiveTouchConfig = {
	enabled: boolean;
	availability: TouchAvailability;
	opacity: number;
	scale: number;
	haptics: boolean;
	autoEnableOnTouchOnly: boolean;
	joystickScheme: TouchJoystickScheme;
	layout: TouchLayout;
	mapping: TouchKeyMapping;
	hasGameOverride: boolean;
};

export const TOUCH_CONSOLE_CHANGED = 'potato-tomato-touch-console-changed';

const GLOBAL_KEY = 'potato-tomato-touch-console-v1';
const GAME_PREFIX = 'potato-tomato-touch-console-game-';
/** Session preference: toolbar Console · ON for a game (survives soft reloads / remounts). */
const CONSOLE_VISIBLE_PREFIX = 'potato-tomato-console-visible:';

export function readConsoleVisiblePref(gameId: string): boolean {
	if (typeof sessionStorage === 'undefined' || !gameId) return false;
	try {
		return sessionStorage.getItem(CONSOLE_VISIBLE_PREFIX + gameId) === '1';
	} catch {
		return false;
	}
}

export function writeConsoleVisiblePref(gameId: string, on: boolean): void {
	if (typeof sessionStorage === 'undefined' || !gameId) return;
	try {
		if (on) sessionStorage.setItem(CONSOLE_VISIBLE_PREFIX + gameId, '1');
		else sessionStorage.removeItem(CONSOLE_VISIBLE_PREFIX + gameId);
	} catch {
		/* private mode / quota */
	}
}

const DEFAULT_LANDSCAPE: TouchLayout = {
	console: { xPct: 0.04, yPct: 0.56, widthPct: 0.5, heightPct: 0.4 },
	joystick: { xPct: 0.06, yPct: 0.64, size: 112, deadzone: 0.18 },
	buttons: [
		{ id: 'a', label: 'A', codes: ['KeyZ'], xPct: 0.34, yPct: 0.64, size: 48 },
		{ id: 'b', label: 'B', codes: ['Enter'], xPct: 0.42, yPct: 0.72, size: 48 },
		{ id: 'x', label: 'X', codes: ['ShiftLeft'], xPct: 0.34, yPct: 0.8, size: 44 },
		{ id: 'y', label: 'Y', codes: ['Escape'], xPct: 0.44, yPct: 0.6, size: 44 },
		{ id: 'space', label: 'Space', codes: ['Space'], xPct: 0.3, yPct: 0.88, size: 56 }
	]
};

const DEFAULT_PORTRAIT: TouchLayout = {
	console: { xPct: 0.04, yPct: 0.66, widthPct: 0.92, heightPct: 0.3 },
	joystick: { xPct: 0.08, yPct: 0.72, size: 100, deadzone: 0.18 },
	buttons: [
		{ id: 'a', label: 'A', codes: ['KeyZ'], xPct: 0.58, yPct: 0.7, size: 48 },
		{ id: 'b', label: 'B', codes: ['Enter'], xPct: 0.74, yPct: 0.76, size: 48 },
		{ id: 'x', label: 'X', codes: ['ShiftLeft'], xPct: 0.58, yPct: 0.84, size: 44 },
		{ id: 'y', label: 'Y', codes: ['Escape'], xPct: 0.78, yPct: 0.66, size: 44 },
		{ id: 'space', label: 'Space', codes: ['Space'], xPct: 0.36, yPct: 0.88, size: 56 }
	]
};

export function getDefaultTouchLayout(orientation: TouchOrientation): TouchLayout {
	return structuredClone(orientation === 'portrait' ? DEFAULT_PORTRAIT : DEFAULT_LANDSCAPE);
}

export const JOYSTICK_SCHEME_ARROWS: Record<TouchDirection, TouchKeyCode[]> = {
	up: ['ArrowUp'],
	down: ['ArrowDown'],
	left: ['ArrowLeft'],
	right: ['ArrowRight']
};

export const JOYSTICK_SCHEME_WASD: Record<TouchDirection, TouchKeyCode[]> = {
	up: ['KeyW'],
	down: ['KeyS'],
	left: ['KeyA'],
	right: ['KeyD']
};

export function directionsForJoystickScheme(
	scheme: TouchJoystickScheme
): Record<TouchDirection, TouchKeyCode[]> {
	return structuredClone(scheme === 'wasd' ? JOYSTICK_SCHEME_WASD : JOYSTICK_SCHEME_ARROWS);
}

export function normalizeJoystickScheme(raw: unknown): TouchJoystickScheme {
	return raw === 'wasd' ? 'wasd' : 'arrows';
}

export const DEFAULT_TOUCH_MAPPING: TouchKeyMapping = {
	directions: directionsForJoystickScheme('arrows'),
	buttons: {
		a: ['KeyZ'],
		b: ['Enter'],
		x: ['ShiftLeft'],
		y: ['Escape'],
		space: ['Space']
	}
};

export const DEFAULT_TOUCH_SETTINGS: TouchConsoleSettings = {
	version: 1,
	enabled: true,
	/** Public site stays auto; native/local-app forces always via getEffectiveTouchConfig. */
	availability: 'auto',
	opacity: 0.72,
	scale: 1,
	haptics: true,
	autoEnableOnTouchOnly: true,
	joystickScheme: 'arrows',
	layouts: {
		landscape: structuredClone(DEFAULT_LANDSCAPE),
		portrait: structuredClone(DEFAULT_PORTRAIT)
	},
	mapping: structuredClone(DEFAULT_TOUCH_MAPPING)
};

function clamp01(n: number): number {
	if (typeof n !== 'number' || Number.isNaN(n)) return 0;
	return Math.max(0, Math.min(1, n));
}

function clamp(n: number, min: number, max: number): number {
	if (typeof n !== 'number' || Number.isNaN(n)) return min;
	return Math.max(min, Math.min(max, n));
}

function normalizePosition(raw: Partial<TouchControlPosition> | undefined, fallback: TouchControlPosition): TouchControlPosition {
	return {
		xPct: clamp01(typeof raw?.xPct === 'number' ? raw.xPct : fallback.xPct),
		yPct: clamp01(typeof raw?.yPct === 'number' ? raw.yPct : fallback.yPct),
		size: clamp(typeof raw?.size === 'number' ? raw.size : fallback.size, 32, 200)
	};
}

function normalizeButton(raw: Partial<TouchButtonDef> | undefined, fallback: TouchButtonDef): TouchButtonDef {
	const pos = normalizePosition(raw, fallback);
	const codes = Array.isArray(raw?.codes) && raw.codes.every((c) => typeof c === 'string')
		? (raw.codes as TouchKeyCode[])
		: fallback.codes;
	return {
		id: typeof raw?.id === 'string' && raw.id ? raw.id : fallback.id,
		label: typeof raw?.label === 'string' && raw.label ? raw.label : fallback.label,
		codes: codes.length ? codes : fallback.codes,
		...pos
	};
}

function normalizeLayout(raw: Partial<TouchLayout> | undefined, fallback: TouchLayout): TouchLayout {
	const consolePanel = raw?.console ?? fallback.console;
	const joy = raw?.joystick ?? fallback.joystick;
	const buttonsRaw = Array.isArray(raw?.buttons) ? raw.buttons : fallback.buttons;
	const byId = new Map(buttonsRaw.map((b) => [b.id, b]));
	return {
		console: {
			xPct: clamp01(typeof consolePanel.xPct === 'number' ? consolePanel.xPct : fallback.console.xPct),
			yPct: clamp01(typeof consolePanel.yPct === 'number' ? consolePanel.yPct : fallback.console.yPct),
			widthPct: clamp(
				typeof consolePanel.widthPct === 'number' ? consolePanel.widthPct : fallback.console.widthPct,
				0.2,
				1
			),
			heightPct: clamp(
				typeof consolePanel.heightPct === 'number' ? consolePanel.heightPct : fallback.console.heightPct,
				0.15,
				1
			)
		},
		joystick: {
			...normalizePosition(joy, fallback.joystick),
			deadzone: clamp(typeof joy.deadzone === 'number' ? joy.deadzone : fallback.joystick.deadzone, 0, 0.5)
		},
		buttons: fallback.buttons.map((fb) => normalizeButton(byId.get(fb.id) ?? fb, fb))
	};
}

function normalizeMapping(
	raw: Partial<TouchKeyMapping> | undefined,
	scheme: TouchJoystickScheme = 'arrows'
): TouchKeyMapping {
	const buttons: Partial<Record<string, TouchKeyCode[]>> = raw?.buttons ?? {};
	/* Joystick directions always follow the scheme select — not free-form remap. */
	const directions = directionsForJoystickScheme(scheme);
	const buttonMap: Record<string, TouchKeyCode[]> = { ...DEFAULT_TOUCH_MAPPING.buttons };
	for (const [id, codes] of Object.entries(buttons)) {
		if (Array.isArray(codes) && codes.every((c) => typeof c === 'string') && codes.length) {
			buttonMap[id] = codes;
		}
	}
	if (!buttonMap.space?.length) buttonMap.space = ['Space'];
	return { directions, buttons: buttonMap };
}

function normalizeSettings(raw: Partial<TouchConsoleSettings> | null | undefined): TouchConsoleSettings {
	const availability =
		raw?.availability === 'auto' || raw?.availability === 'always' || raw?.availability === 'off'
			? raw.availability
			: DEFAULT_TOUCH_SETTINGS.availability;
	const joystickScheme = normalizeJoystickScheme(raw?.joystickScheme);
	return {
		version: 1,
		enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_TOUCH_SETTINGS.enabled,
		availability,
		opacity: clamp(typeof raw?.opacity === 'number' ? raw.opacity : DEFAULT_TOUCH_SETTINGS.opacity, 0.2, 1),
		scale: clamp(typeof raw?.scale === 'number' ? raw.scale : DEFAULT_TOUCH_SETTINGS.scale, 0.6, 1.6),
		haptics: typeof raw?.haptics === 'boolean' ? raw.haptics : DEFAULT_TOUCH_SETTINGS.haptics,
		autoEnableOnTouchOnly:
			typeof raw?.autoEnableOnTouchOnly === 'boolean'
				? raw.autoEnableOnTouchOnly
				: DEFAULT_TOUCH_SETTINGS.autoEnableOnTouchOnly,
		joystickScheme,
		layouts: {
			landscape: normalizeLayout(raw?.layouts?.landscape, DEFAULT_LANDSCAPE),
			portrait: normalizeLayout(raw?.layouts?.portrait, DEFAULT_PORTRAIT)
		},
		mapping: normalizeMapping(raw?.mapping, joystickScheme)
	};
}

function emitChanged(detail: { gameId?: string | null } = {}): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(TOUCH_CONSOLE_CHANGED, { detail }));
}

export function loadTouchConsoleSettings(): TouchConsoleSettings {
	if (!canUseLocalStorage()) return structuredClone(DEFAULT_TOUCH_SETTINGS);
	try {
		const raw = localStorage.getItem(GLOBAL_KEY);
		if (!raw) return structuredClone(DEFAULT_TOUCH_SETTINGS);
		return normalizeSettings(JSON.parse(raw) as Partial<TouchConsoleSettings>);
	} catch {
		return structuredClone(DEFAULT_TOUCH_SETTINGS);
	}
}

export function saveTouchConsoleSettings(settings: TouchConsoleSettings): TouchConsoleSettings {
	const next = normalizeSettings(settings);
	if (canUseLocalStorage()) {
		try {
			localStorage.setItem(GLOBAL_KEY, JSON.stringify(next));
		} catch (e) {
			console.error('Failed to save touch console settings:', e);
		}
	}
	emitChanged({});
	return next;
}

export function patchTouchConsoleSettings(
	patch: Partial<Omit<TouchConsoleSettings, 'version' | 'layouts' | 'mapping'>> & {
		layouts?: Partial<Record<TouchOrientation, TouchLayout>>;
		mapping?: Partial<TouchKeyMapping>;
		joystickScheme?: TouchJoystickScheme;
	}
): TouchConsoleSettings {
	const current = loadTouchConsoleSettings();
	const joystickScheme = normalizeJoystickScheme(
		patch.joystickScheme !== undefined ? patch.joystickScheme : current.joystickScheme
	);
	const mergedMapping = patch.mapping
		? { ...current.mapping, ...patch.mapping, buttons: { ...current.mapping.buttons, ...(patch.mapping.buttons ?? {}) } }
		: current.mapping;
	const next: TouchConsoleSettings = {
		...current,
		...patch,
		version: 1,
		joystickScheme,
		layouts: {
			landscape: patch.layouts?.landscape
				? normalizeLayout(patch.layouts.landscape, current.layouts.landscape)
				: current.layouts.landscape,
			portrait: patch.layouts?.portrait
				? normalizeLayout(patch.layouts.portrait, current.layouts.portrait)
				: current.layouts.portrait
		},
		mapping: normalizeMapping(mergedMapping, joystickScheme)
	};
	return saveTouchConsoleSettings(next);
}

/** Persist joystick arrows/WASD scheme in touch settings (updates direction mapping). */
export function setJoystickScheme(scheme: TouchJoystickScheme): void {
	patchTouchConsoleSettings({ joystickScheme: normalizeJoystickScheme(scheme) });
}

export function loadGameTouchOverride(gameId: string): TouchConsoleGameOverride | null {
	if (!gameId || !canUseLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(GAME_PREFIX + gameId);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as TouchConsoleGameOverride;
		if (!parsed || typeof parsed !== 'object') return null;
		return {
			version: 1,
			layouts: parsed.layouts,
			mapping: parsed.mapping
		};
	} catch {
		return null;
	}
}

export function saveGameTouchOverride(gameId: string, override: TouchConsoleGameOverride | null): void {
	if (!gameId || !canUseLocalStorage()) return;
	try {
		if (!override || (!override.layouts && !override.mapping)) {
			localStorage.removeItem(GAME_PREFIX + gameId);
		} else {
			localStorage.setItem(
				GAME_PREFIX + gameId,
				JSON.stringify({ version: 1 as const, layouts: override.layouts, mapping: override.mapping })
			);
		}
		emitChanged({ gameId });
	} catch (e) {
		console.error('Failed to save per-game touch override:', e);
	}
}

export function clearGameTouchOverride(gameId: string): void {
	saveGameTouchOverride(gameId, null);
}

export function getEffectiveConfig(gameId: string | null | undefined, orientation: TouchOrientation): EffectiveTouchConfig {
	const global = loadTouchConsoleSettings();
	const override = gameId ? loadGameTouchOverride(gameId) : null;
	const layout =
		override?.layouts?.[orientation]
			? normalizeLayout(override.layouts[orientation], global.layouts[orientation])
			: global.layouts[orientation];
	const mapping = override?.mapping
		? normalizeMapping({
				directions: { ...global.mapping.directions, ...(override.mapping.directions ?? {}) },
				buttons: { ...global.mapping.buttons, ...(override.mapping.buttons ?? {}) }
			})
		: global.mapping;

	let enabled = global.enabled;
	let availability = global.availability;
	/* Native / local-app: puller + touch proxy stay on — keep console available. */
	if (isLocalAppDeployment()) {
		enabled = true;
		if (availability === 'off' || availability === 'auto') availability = 'always';
	}

	return {
		enabled,
		availability,
		opacity: global.opacity,
		scale: global.scale,
		haptics: global.haptics,
		autoEnableOnTouchOnly: global.autoEnableOnTouchOnly,
		joystickScheme: global.joystickScheme,
		layout,
		mapping: normalizeMapping(mapping, global.joystickScheme),
		hasGameOverride: Boolean(override)
	};
}

export function saveLayout(
	orientation: TouchOrientation,
	layout: TouchLayout,
	gameId?: string | null
): void {
	const normalized = normalizeLayout(layout, orientation === 'portrait' ? DEFAULT_PORTRAIT : DEFAULT_LANDSCAPE);
	if (gameId) {
		const existing = loadGameTouchOverride(gameId) ?? { version: 1 as const };
		saveGameTouchOverride(gameId, {
			version: 1,
			layouts: { ...(existing.layouts ?? {}), [orientation]: normalized },
			mapping: existing.mapping
		});
		return;
	}
	patchTouchConsoleSettings({ layouts: { [orientation]: normalized } });
}

export function getMapping(gameId?: string | null): TouchKeyMapping {
	return getEffectiveConfig(gameId, 'landscape').mapping;
}

export function saveMapping(mapping: TouchKeyMapping, gameId?: string | null): void {
	const scheme = loadTouchConsoleSettings().joystickScheme;
	const normalized = normalizeMapping(mapping, scheme);
	if (gameId) {
		const existing = loadGameTouchOverride(gameId) ?? { version: 1 as const };
		saveGameTouchOverride(gameId, {
			version: 1,
			layouts: existing.layouts,
			mapping: normalized
		});
		return;
	}
	patchTouchConsoleSettings({ mapping: normalized });
}

export function resetLayout(orientation?: TouchOrientation, gameId?: string | null): void {
	if (gameId) {
		const existing = loadGameTouchOverride(gameId);
		if (!existing) return;
		if (!orientation) {
			clearGameTouchOverride(gameId);
			return;
		}
		const layouts = { ...(existing.layouts ?? {}) };
		delete layouts[orientation];
		saveGameTouchOverride(gameId, {
			version: 1,
			layouts: Object.keys(layouts).length ? layouts : undefined,
			mapping: existing.mapping
		});
		return;
	}
	if (!orientation) {
		saveTouchConsoleSettings({
			...loadTouchConsoleSettings(),
			layouts: {
				landscape: structuredClone(DEFAULT_LANDSCAPE),
				portrait: structuredClone(DEFAULT_PORTRAIT)
			}
		});
		return;
	}
	const fallback = orientation === 'portrait' ? DEFAULT_PORTRAIT : DEFAULT_LANDSCAPE;
	patchTouchConsoleSettings({ layouts: { [orientation]: structuredClone(fallback) } });
}

export function copyLandscapeToPortrait(gameId?: string | null): void {
	const cfg = getEffectiveConfig(gameId, 'landscape');
	const copied = structuredClone(cfg.layout);
	// Nudge portrait defaults slightly lower for thumb reach while keeping relative spacing.
	copied.console.yPct = clamp01(Math.max(copied.console.yPct, 0.62));
	saveLayout('portrait', copied, gameId);
}

export function resetMapping(gameId?: string | null): void {
	if (gameId) {
		const existing = loadGameTouchOverride(gameId);
		if (!existing) return;
		saveGameTouchOverride(gameId, {
			version: 1,
			layouts: existing.layouts,
			mapping: undefined
		});
		return;
	}
	patchTouchConsoleSettings({
		joystickScheme: 'arrows',
		mapping: structuredClone(DEFAULT_TOUCH_MAPPING)
	});
}

/** Human-readable label for a KeyboardEvent.code. */
export function formatTouchKeyCode(code: string): string {
	if (code === 'Space') return 'Space';
	if (code === 'Enter') return 'Enter';
	if (code === 'Escape') return 'Esc';
	if (code.startsWith('Arrow')) return code.replace('Arrow', '');
	if (code.startsWith('Key')) return code.slice(3);
	if (code.startsWith('Digit')) return code.slice(5);
	if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
	if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
	if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
	return code;
}

export function codesToLabel(codes: TouchKeyCode[]): string {
	return codes.map(formatTouchKeyCode).join(' + ');
}
