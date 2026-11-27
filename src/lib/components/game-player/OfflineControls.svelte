<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import { Download, Trash2, HardDrive, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		type GameOfflineStatus,
		type OfflineBackend,
		type OfflineStatusChangedDetail,
		getOfflineBackend,
		isLocalAppDeployment,
		refreshGameOfflineState,
		deleteOfflineCopy,
		dispatchOfflineStatusChanged,
		OFFLINE_STATUS_CHANGED,
		isBundledOfflineGame
	} from '$lib/utils/offline-downloader';
	import { cancelDownload, downloadState, startDownload } from '$lib/utils/download-manager.svelte';
	import { getGameMeta } from '$lib/utils/browser-offline-storage';
	import { onlineShellHasExternalIframe } from '$lib/utils/browser-offline-download';
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

	/**
	 * Download / progress / cancel / remove for one game. The download itself runs in the
	 * download manager, so it carries on when you leave this page and shows its progress
	 * again when you come back.
	 */
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
	let deleting = $state(false);
	let networkOnline = $state(true);
	let externalEmbedOnly = $state(false);
	let statusReady = $state(false);

	let managed = $derived(downloadState(gameId));
	let downloading = $derived(
		Boolean(managed && (managed.state === 'pending' || managed.state === 'running'))
	);
	let bundled = $derived(isBundledOfflineGame(gameId));
	let offlineReady = $derived(offlineBackend !== 'none');
	let hasPartialCache = $derived(Boolean(status?.partialCache && (status.cacheFileCount ?? 0) > 0));
	let canDownload = $derived(
		networkOnline &&
			offlineReady &&
			!bundled &&
			!status?.offline &&
			!downloading &&
			onlineAvailable &&
			statusReady
	);
	let blockedReason = $derived.by(() => {
		if (canDownload || downloading || status?.offline || bundled || !statusReady) return '';
		if (!networkOnline) return 'Connect to download';
		if (!offlineReady) return 'Downloads unavailable here';
		if (!onlineAvailable) return 'Nothing to download';
		return '';
	});
	let canDelete = $derived(
		offlineReady && !bundled && !downloading && (Boolean(status?.offline) || hasPartialCache)
	);
	let percent = $derived(Math.round(managed?.progress ?? 0));

	async function refreshStatus() {
		try {
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
			const meta = await getGameMeta(gameId);
			externalEmbedOnly =
				backend === 'browser' &&
				(Boolean(meta?.externalIframe) || (await onlineShellHasExternalIframe(gameId)));
		} finally {
			statusReady = true;
		}
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
			if (detail?.gameId && detail.gameId !== gameId) return;
			void refreshStatus().then(() => {
				if (detail?.reason === 'download-done') onPlayUrlChange?.();
			});
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
		void gameId;
		void metadata;
		const nextMode = getGamePlayMode(gameId);
		if (playMode !== nextMode) playMode = nextMode;
		void refreshStatus();
	});

	function handleDownload() {
		if (!canDownload) return;
		void startDownload(gameId, metadata?.name ?? gameId);
	}

	async function handleDelete() {
		if (!canDelete || deleting) return;
		deleting = true;
		try {
			await deleteOfflineCopy(gameId);
			status = {
				online: onlineAvailable || Boolean(status?.online),
				offline: false,
				downloading: false,
				partialCache: false,
				cacheFileCount: undefined,
				offlineThumbnail: undefined
			};
			dispatchOfflineStatusChanged(gameId, 'delete');
			if (playMode === 'offline') saveGamePlayMode(gameId, 'online');
			onPlayUrlChange?.();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not remove the download', {
				closeButton: true
			});
			await refreshStatus();
		} finally {
			deleting = false;
		}
	}

	/* A running download always shows its progress, even before the status checks finish. */
	let showSection = $derived(
		downloading ||
			(!bundled &&
				(offlineReady || isLocalAppDeployment()) &&
				(onlineAvailable || Boolean(status?.offline) || downloading || hasPartialCache))
	);
</script>

{#if showSection}
	<div class="mt-3 flex flex-wrap items-center gap-2" data-testid="offline-controls">
		{#if downloading}
			<div class="flex min-w-48 flex-1 items-center gap-2" role="status" aria-live="polite">
				<Progress value={percent} max={100} class="h-2 flex-1" />
				<span class="w-10 text-right text-xs text-muted-foreground tabular-nums">{percent}%</span>
				<Button
					size="sm"
					variant="ghost"
					onclick={() => void cancelDownload(gameId)}
					aria-label="Cancel download"
				>
					<X class="h-4 w-4" />
					Cancel
				</Button>
			</div>
		{:else if status?.offline}
			<span class="inline-flex items-center gap-1 text-sm text-muted-foreground">
				<HardDrive class="h-4 w-4" />
				Downloaded
			</span>
		{:else if canDownload}
			<Button size="sm" variant="outline" onclick={handleDownload}>
				<Download class="h-4 w-4" />
				{hasPartialCache ? 'Resume download' : 'Download'}
			</Button>
		{:else if blockedReason}
			<Button size="sm" variant="outline" disabled title={blockedReason}>
				<Download class="h-4 w-4" />
				Download
			</Button>
			<span class="text-xs text-muted-foreground">{blockedReason}</span>
		{/if}
		{#if canDelete}
			<Button
				size="sm"
				variant="ghost"
				onclick={handleDelete}
				disabled={deleting}
				aria-label="Remove download"
			>
				<Trash2 class="h-4 w-4" />
				Remove
			</Button>
		{/if}
		{#if externalEmbedOnly && !status?.offline}
			<span class="w-full text-xs text-muted-foreground">
				Hosted on another site: in the browser this one plays online only.
			</span>
		{/if}
	</div>
{/if}
