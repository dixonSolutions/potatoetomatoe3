/**
 * Schema-driven allowlisted commands for console-test / puller-test.
 * No eval, no arbitrary shell, no free-form HTTP.
 */

export type ConsoleCommandName =
	| 'probe'
	| 'reload'
	| 'down'
	| 'up'
	| 'tap'
	| 'joystick'
	| 'releaseAll'
	| 'pause'
	| 'resume'
	| 'unlockAudio'
	| 'mute'
	| 'unmute';

export type PullerCommandName =
	| 'health'
	| 'jobs'
	| 'status'
	| 'download'
	| 'progress'
	| 'cancel'
	| 'delete'
	| 'verify'
	| 'playOnline'
	| 'playOffline';

export interface ParsedConsoleCommand {
	name: ConsoleCommandName;
	args: string[];
}

export interface ParsedPullerCommand {
	name: PullerCommandName;
	args: string[];
}

const CONSOLE_COMMANDS = new Set<ConsoleCommandName>([
	'probe',
	'reload',
	'down',
	'up',
	'tap',
	'joystick',
	'releaseAll',
	'pause',
	'resume',
	'unlockAudio',
	'mute',
	'unmute'
]);

const PULLER_COMMANDS = new Set<PullerCommandName>([
	'health',
	'jobs',
	'status',
	'download',
	'progress',
	'cancel',
	'delete',
	'verify',
	'playOnline',
	'playOffline'
]);

const KEY_CODE_PATTERN = /^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Enter|Escape|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Tab|Backspace|Key[A-Z]|Digit[0-9])$/;

export function isAllowedKeyCode(code: string): boolean {
	return KEY_CODE_PATTERN.test(code);
}

function tokenize(input: string): string[] {
	return input
		.trim()
		.split(/\s+/)
		.filter(Boolean);
}

export function parseConsoleCommand(input: string): ParsedConsoleCommand | { error: string } {
	const tokens = tokenize(input);
	if (tokens.length === 0) return { error: 'Empty command' };
	const name = tokens[0] as ConsoleCommandName;
	if (!CONSOLE_COMMANDS.has(name)) {
		return {
			error: `Unknown command "${tokens[0]}". Allowed: ${[...CONSOLE_COMMANDS].join(', ')}`
		};
	}
	const args = tokens.slice(1);
	if ((name === 'down' || name === 'up' || name === 'tap') && args.length === 0) {
		return { error: `${name} requires at least one KeyboardEvent.code` };
	}
	if (name === 'down' || name === 'up' || name === 'tap') {
		for (const code of args) {
			if (!isAllowedKeyCode(code)) {
				return { error: `Disallowed key code: ${code}` };
			}
		}
	}
	if (name === 'joystick') {
		if (args.length !== 2) {
			return { error: 'joystick requires two numbers: <x> <y> in [-1,1]' };
		}
		const x = Number(args[0]);
		const y = Number(args[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1 || Math.abs(y) > 1) {
			return { error: 'joystick x/y must be finite numbers in [-1,1]' };
		}
	}
	return { name, args };
}

export function parsePullerCommand(input: string): ParsedPullerCommand | { error: string } {
	const tokens = tokenize(input);
	if (tokens.length === 0) return { error: 'Empty command' };
	const name = tokens[0] as PullerCommandName;
	if (!PULLER_COMMANDS.has(name)) {
		return {
			error: `Unknown command "${tokens[0]}". Allowed: ${[...PULLER_COMMANDS].join(', ')}`
		};
	}
	return { name, args: tokens.slice(1) };
}

export const CONSOLE_COMMAND_HELP: Record<ConsoleCommandName, string> = {
	probe: 'Probe injectability / bridge path',
	reload: 'Reload the game iframe',
	down: 'down <KeyCode…> — keydown',
	up: 'up <KeyCode…> — keyup',
	tap: 'tap <KeyCode…> — down then up',
	joystick: 'joystick <x> <y> — set direction vector',
	releaseAll: 'Release all held keys',
	pause: 'Send game pause=true',
	resume: 'Send game pause=false',
	unlockAudio: 'Unlock iframe audio',
	mute: 'Mute game audio output',
	unmute: 'Unmute game audio output'
};

export const PULLER_COMMAND_HELP: Record<PullerCommandName, string> = {
	health: 'GET /api/offline/health',
	jobs: 'GET /api/offline/jobs',
	status: 'GET status for selected game',
	download: 'POST download for selected game',
	progress: 'GET download progress',
	cancel: 'POST cancel (discard cache)',
	delete: 'DELETE offline copy',
	verify: 'Verify offline entry + status',
	playOnline: 'Resolve online proxy play URL',
	playOffline: 'Resolve offline play URL'
};
