<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import { Download, Trash2, HardDrive, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		type GameOfflineStatus,
		type DownloadProgress,
		type OfflineBackend,
		type OfflineStatusChangedDetail,
		getOfflineBackend,
		describeOfflineBackend,
		isLocalAppDeployment,
		refreshGameOfflineState,
		startGameDownload,
		deleteOfflineCopy,
		pollDownloadUntilDone,
		dispatchOfflineStatusChanged,
		OFFLINE_STATUS_CHANGED,
		isBundledOfflineGame
	} from '$lib/utils/offline-downloader';
	import {
		getGamePlayMode,
		saveGamePlayMode,
		type GamePlayMode,
		GAME_PLAY_MODE_CHANGED
	} from '$lib/utils/game-play-mode';
	import { getGameAvailability } from '$lib/utils/game-availability';
	import type { GameMetadata } from '$lib/utils/games';
	import { onMount } from 'svelte';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';

	let {
		gameId,
		metadata = null,
		onPlayUrlChange
	}: {
		gameId: string;
		metadata?: GameMetadata | null;
		onPlayUrlChange?: () => void;
	} = $props();

	let offlineBackend = $state<OfflineBackend>('none');
	let status = $state<GameOfflineStatus | null>(null);
	let onlineAvailable = $state(false);
	let playMode = $state<GamePlayMode>('online');
	let downloading = $state(false);
	let progress = $state<DownloadProgress>({ state: 'idle', progress: 0, message: '' });
	let deleting = $state(false);
	let networkOnline = $state(true);

	let bundled = $derived(isBundledOfflineGame(gameId));
	let offlineReady = $derived(offlineBackend !== 'none');
	let backendLabel = $derived(describeOfflineBackend(offlineBackend));
	let pullerMissingHint = $derived(isLocalAppDeployment() && offlineBackend === 'browser');
	let canDownload = $derived(
		networkOnline &&
			offlineReady &&
			!bundled &&
			!status?.offline &&
			!downloading &&
			onlineAvailable
	);
	let canDelete = $derived(offlineReady && !bundled && Boolean(status?.offline));

	async function refreshStatus() {
		const backend = await getOfflineBackend(true);
		offlineBackend = backend;
		const availability = await getGameAvailability(gameId, metadata, true);
		onlineAvailable = availability.online;
		if (backend === 'none') {
			status = null;
			return;
		}
		status = await refreshGameOfflineState(gameId);
		if (status && !status.online && availability.online) {
			status = { ...status, online: true };
		}
	}

	function shouldRefreshForEvent(detail: OfflineStatusChangedDetail | undefined): boolean {
		if (!detail?.gameId) return true;
		return detail.gameId === gameId;
	}

	onMount(() => {
		networkOnline = isNetworkOnline();
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
		});

		playMode = getGamePlayMode(gameId);
		void refreshStatus();

		const onModeChange = (e: Event) => {
			const d = (e as CustomEvent<{ gameId: string; mode: GamePlayMode }>).detail;
			if (d?.gameId === gameId) playMode = d.mode;
		};
		const onOfflineStatusChanged = (e: Event) => {
			const detail = (e as CustomEvent<OfflineStatusChangedDetail>).detail;
			if (!shouldRefreshForEvent(detail)) return;
			void refreshStatus();
		};

		window.addEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			detachNetwork();
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	$effect(() => {
		gameId;
		metadata;
		playMode = getGamePlayMode(gameId);
		void refreshStatus();
	});

	async function handleDownload() {
		if (!canDownload || downloading) return;
		downloading = true;
		progress = { state: 'pending', progress: 0, message: 'Starting…' };
		dispatchOfflineStatusChanged(gameId, 'download-start');
		try {
			await startGameDownload(gameId);
			const final = await pollDownloadUntilDone(gameId, (p) => {
				progress = p;
			});
			if (final.state === 'done') {
				toast.success('Game downloaded for offline play');
				status = await refreshGameOfflineState(gameId);
				dispatchOfflineStatusChanged(gameId, 'download-done');
				onPlayUrlChange?.();
			} else if (final.state === 'error') {
				toast.error(final.error ?? 'Download failed');
				dispatchOfflineStatusChanged(gameId, 'download-error');
				await refreshStatus();
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Download failed');
			dispatchOfflineStatusChanged(gameId, 'download-error');
			await refreshStatus();
		} finally {
			downloading = false;
		}
	}

	async function handleDelete() {
		if (!canDelete || deleting) return;
		if (!confirm('Delete the offline copy of this game?')) return;
		deleting = true;
		try {
			await deleteOfflineCopy(gameId);
			toast.success('Offline copy deleted');
			status = await refreshGameOfflineState(gameId);
			dispatchOfflineStatusChanged(gameId, 'delete');
			if (playMode === 'offline') {
				saveGamePlayMode(gameId, 'online');
				onPlayUrlChange?.();
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Delete failed');
		} finally {
			deleting = false;
		}
	}

	let showDownloadSection = $derived(
		offlineReady && !bundled && (onlineAvailable || Boolean(status?.offline) || downloading)
	);
</script>

{#if bundled}
	<div class="mt-3 flex flex-wrap items-center gap-2">
		<Badge variant="default" class="gap-1">
			<HardDrive class="h-3 w-3" />
			Bundled offline copy included
		</Badge>
	</div>
{:else if showDownloadSection}
	<div class="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-sm font-medium">Offline download</span>
			<Badge variant="outline" class="gap-1 text-[11px]">{backendLabel}</Badge>
			{#if status?.offline}
				<Badge variant="default" class="gap-1">
					<HardDrive class="h-3 w-3" />
					Downloaded
				</Badge>
			{:else if downloading || status?.downloading}
				<Badge variant="outline" class="gap-1">
					<Loader2 class="h-3 w-3 animate-spin" />
					Downloading
				</Badge>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2">
			{#if canDownload}
				<Button size="sm" onclick={handleDownload} disabled={downloading}>
					<Download class="mr-2 h-4 w-4" />
					Download for offline
				</Button>
			{/if}
			{#if canDelete}
				<Button
					size="sm"
					variant="destructive"
					onclick={handleDelete}
					disabled={deleting || downloading}
				>
					<Trash2 class="mr-2 h-4 w-4" />
					Delete offline copy
				</Button>
			{/if}
		</div>

		{#if downloading && progress.state !== 'idle'}
			<div class="space-y-1">
				<Progress value={progress.progress} max={100} />
				<p class="text-xs text-muted-foreground">{progress.message}</p>
			</div>
		{/if}

		{#if pullerMissingHint}
			<p class="text-xs text-muted-foreground">
				Run <code class="rounded bg-muted px-1">pnpm dev</code> to start the puller for full game
				file downloads on disk.
			</p>
		{:else if offlineBackend === 'browser'}
			<p class="text-xs text-muted-foreground">
				Downloads are saved in this browser via IndexedDB. Same-origin game files work offline.
			</p>
		{:else if offlineBackend === 'puller'}
			<p class="text-xs text-muted-foreground">
				Downloads are saved as game files on disk via the local puller service.
			</p>
		{/if}
	</div>
{/if}
