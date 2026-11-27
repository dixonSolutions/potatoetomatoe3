/** Shapes shared by the offline download backends (desktop disk copies, browser storage). */

export interface GameOfflineStatus {
	online: boolean;
	offline: boolean;
	downloading: boolean;
	partialCache?: boolean;
	cacheFileCount?: number;
	/** Relative path under offline/ for a cached cover. */
	offlineThumbnail?: string;
}

export interface DownloadProgress {
	state: 'idle' | 'pending' | 'running' | 'done' | 'error' | 'cancelled';
	progress: number;
	message: string;
	error?: string;
}
