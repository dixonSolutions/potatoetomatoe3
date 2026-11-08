import { writable } from 'svelte/store';

export interface AndyStatus {
	state?: string;
	runningVersion?: string;
	release?: string;
	percent?: number;
}
interface Bridge {
	postMessage(message: string): void;
	onmessage: ((event: MessageEvent<string>) => void) | null;
}
declare global {
	interface Window {
		AndySU?: Bridge;
	}
}
const bridge = () => (typeof window === 'undefined' ? undefined : window.AndySU);
let sdk = 0;
let mode = 'auto';
let modeChanged = false;
let connectedBridge: Bridge | undefined;
let modeListener: ((mode: string) => void) | undefined;
function send(action: string, extra: Record<string, string> = {}): void {
	try {
		bridge()?.postMessage(JSON.stringify({ action, ...extra }));
	} catch {
		/* Bridge unavailable. */
	}
}
function connect(): void {
	const current = bridge();
	if (!current || current === connectedBridge) return;
	connectedBridge = current;
	current.onmessage = (event) => {
		try {
			const message = JSON.parse(event.data);
			if (message.type === 'init') {
				sdk = typeof message.sdk === 'number' ? message.sdk : 0;
				if (!modeChanged) mode = message.mode === 'off' ? 'off' : 'auto';
				modeListener?.(mode);
			}
			if ((message.type === 'init' || message.type === 'status') && message.status)
				andysuStatus.set(message.status as AndyStatus);
		} catch {
			/* Ignore malformed messages. */
		}
	};
	send('init');
}
export function andysuAvailable(): boolean {
	try {
		connect();
		return typeof bridge()?.postMessage === 'function';
	} catch {
		return false;
	}
}
export function androidSdk(): number {
	connect();
	return sdk;
}
export function statusText(s: AndyStatus): string {
	if (
		s.state === 'up_to_date' ||
		(s.state === 'staged' && s.release && s.release === s.runningVersion)
	)
		return `Up to date · version ${s.runningVersion ?? 'unknown'}`;
	switch (s.state) {
		case 'checking':
			return 'Checking…';
		case 'downloading':
			return `Downloading update${typeof s.percent === 'number' ? ` · ${Math.max(0, Math.min(100, Math.round(s.percent)))}%` : '…'}`;
		case 'staged':
			return 'Update ready · applies next time you open the app';
		case 'applying':
			return 'Applying update…';
		case 'shell_update':
			return 'Update needs a new app install';
		case 'error':
			return 'Couldn’t check for updates · will try again';
		case 'deferred':
			return 'Update check deferred · will try again';
		case 'available':
			return 'Update available';
		default:
			return 'Updates haven’t been checked yet';
	}
}
export const andysuStatus = writable<AndyStatus>({});
export function refreshAndySU(): void {
	connect();
	send('status');
}
export function initAndySU(onMode?: (mode: string) => void): () => void {
	modeListener = onMode;
	connect();
	refreshAndySU();
	return () => {
		if (modeListener === onMode) modeListener = undefined;
	};
}
export function andysuMode(): string {
	connect();
	return mode;
}
export function setAndySUMode(value: 'auto' | 'off'): void {
	modeChanged = true;
	mode = value;
	send('setMode', { mode: value });
}
export function checkAndySU(): void {
	send('checkNow');
}
export function applyAndySU(): void {
	send('applyNow');
}
