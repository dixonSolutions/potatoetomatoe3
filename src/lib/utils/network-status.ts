/**
 * One calm network detector for the whole app. `navigator.onLine` and its events flap on
 * weak Wi-Fi and school networks, so a change only counts once it has held for a moment:
 * going offline must last OFFLINE_SETTLE_MS, coming back ONLINE_SETTLE_MS. Every subscriber
 * shares one pair of window listeners and hears each settled change once.
 */

export const NETWORK_STATUS_CHANGED = 'potato-tomato-network-status-changed';
export const OFFLINE_SETTLE_MS = 1500;
export const ONLINE_SETTLE_MS = 500;

type Listener = (online: boolean) => void;

const listeners = new Set<Listener>();
let settled: boolean | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let detach: (() => void) | null = null;

function raw(): boolean {
	return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function settle(online: boolean) {
	if (settled === online) return;
	settled = online;
	for (const l of [...listeners]) l(online);
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(NETWORK_STATUS_CHANGED, { detail: { online } }));
	}
}

function onRawChange() {
	clearTimeout(timer);
	const online = raw();
	if (online === settled) return;
	timer = setTimeout(
		() => {
			if (raw() === online) settle(online);
		},
		online ? ONLINE_SETTLE_MS : OFFLINE_SETTLE_MS
	);
}

function attach() {
	if (detach || typeof window === 'undefined') return;
	window.addEventListener('online', onRawChange);
	window.addEventListener('offline', onRawChange);
	detach = () => {
		window.removeEventListener('online', onRawChange);
		window.removeEventListener('offline', onRawChange);
		clearTimeout(timer);
		detach = null;
	};
}

/** The settled state (the raw state until the first change has settled). */
export function isNetworkOnline(): boolean {
	settled ??= raw();
	return settled;
}

/** Hear settled online/offline changes. Returns an unsubscribe function. */
export function subscribeNetworkStatus(onChange: Listener): () => void {
	if (typeof window === 'undefined') return () => {};
	isNetworkOnline();
	listeners.add(onChange);
	attach();
	return () => {
		listeners.delete(onChange);
		if (listeners.size === 0) detach?.();
	};
}

/** Tests only. */
export function resetNetworkStatusForTests(): void {
	detach?.();
	listeners.clear();
	settled = null;
}
