/** Browser network connectivity (navigator.onLine + online/offline events). */

export const NETWORK_STATUS_CHANGED = 'potato-tomato-network-status-changed';

export function isNetworkOnline(): boolean {
	if (typeof navigator === 'undefined') return true;
	return navigator.onLine;
}

export function dispatchNetworkStatusChanged(online: boolean): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent(NETWORK_STATUS_CHANGED, { detail: { online } satisfies { online: boolean } })
	);
}

/** Subscribe to online/offline changes. Returns an unsubscribe function. */
export function subscribeNetworkStatus(onChange: (online: boolean) => void): () => void {
	if (typeof window === 'undefined') return () => {};

	const notify = () => onChange(navigator.onLine);

	window.addEventListener('online', notify);
	window.addEventListener('offline', notify);

	return () => {
		window.removeEventListener('online', notify);
		window.removeEventListener('offline', notify);
	};
}

/** Call once in the app shell to rebroadcast network changes (optional). */
export function attachNetworkStatusBroadcast(): () => void {
	return subscribeNetworkStatus((online) => dispatchNetworkStatusChanged(online));
}
