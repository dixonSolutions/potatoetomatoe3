/** Per-game abort signals for in-flight download jobs. */

const controllers = new Map<string, AbortController>();

export class DownloadCancelledError extends Error {
	constructor(message = 'Download cancelled') {
		super(message);
		this.name = 'DownloadCancelledError';
	}
}

export function beginDownloadAbort(gameId: string): AbortSignal {
	cancelDownloadAbort(gameId);
	const controller = new AbortController();
	controllers.set(gameId, controller);
	return controller.signal;
}

export function cancelDownloadAbort(gameId: string): void {
	controllers.get(gameId)?.abort();
}

export function clearDownloadAbort(gameId: string): void {
	controllers.delete(gameId);
}

export function getDownloadAbortSignal(gameId: string): AbortSignal | undefined {
	return controllers.get(gameId)?.signal;
}

export function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new DownloadCancelledError();
	}
}
