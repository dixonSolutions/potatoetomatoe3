<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { buttonVariants } from '$lib/components/ui/button/button.svelte';
	import { cn } from '$lib/utils';
	import { Download, Trash2, HardDrive, Loader2, RefreshCw, X } from 'lucide-svelte';
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
		cancelGameDownload,
		deleteOfflineCopy,
		pollDownloadUntilDone,
		dispatchOfflineStatusChanged,
		OFFLINE_STATUS_CHANGED,
		isBundledOfflineGame,
		describePullerDownloadError
	} from '$lib/utils/offline-downloader';
	import { invalidateOfflineBackendCache } from '$lib/utils/offline-runtime';
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
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
	import {
		invalidatePullerAvailabilityCache,
		isPullerAvailable,
		syncPullerBaseUrlFromTauri,
		waitForPuller
	} from '$lib/utils/offline-downloader-puller';

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
	let externalEmbedOnly = $state(false);
	let cancelDialogOpen = $state(false);
	let cancelling = $state(false);
	let pollGeneration = $state(0);

	let statusReady = $state(false);
	let pullerStartupSettled = $state(!isLocalAppDeployment());
	let retryingPuller = $state(false);
	let bundled = $derived(isBundledOfflineGame(gameId));
	let offlineReady = $derived(offlineBackend !== 'none');
	let backendLabel = $derived(describeOfflineBackend(offlineBackend));
	let waitingForPuller = $derived(
		isLocalAppDeployment() && !pullerStartupSettled && offlineBackend !== 'puller'
	);
	let pullerMissingHint = $derived(
		isLocalAppDeployment() && pullerStartupSettled && offlineBackend === 'browser'
	);
	let canDownload = $derived(
		networkOnline &&
			offlineReady &&
			!bundled &&
			!status?.offline &&
			!downloading &&
			onlineAvailable &&
			statusReady &&
			!waitingForPuller
	);
	let downloadBlockedReason = $derived.by(() => {
		if (canDownload || downloading || status?.offline || bundled) return '';
		if (!networkOnline) return 'Connect to the internet to download this game.';
		if (!offlineReady) return 'Offline downloads are unavailable in this environment.';
		if (!onlineAvailable) return 'This game has no online shell the puller can capture.';
		return '';
	});
	let hasPartialCache = $derived(Boolean(status?.partialCache && (status.cacheFileCount ?? 0) > 0));
	let canCancel = $derived(downloading || Boolean(status?.downloading));
	let canDelete = $derived(
		offlineReady && !bundled && (Boolean(status?.offline) || hasPartialCache)
	);

	async function refreshStatus() {
		try {
			const backend = await getOfflineBackend(true);
			offlineBackend = backend;
			if (backend === 'puller') pullerStartupSettled = true;
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
				Boolean(meta?.externalIframe) || (await onlineShellHasExternalIframe(gameId));
		} finally {
			statusReady = true;
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

		let pullerStartupTimer: ReturnType<typeof setTimeout> | undefined;
		let pullerRecoveryTimer: ReturnType<typeof setInterval> | undefined;
		if (isLocalAppDeployment()) {
			void waitForPuller(15_000).then(async (available) => {
				pullerStartupSettled = true;
				if (!available) return;
				await refreshStatus();
				onPlayUrlChange?.();
			});
			pullerStartupTimer = setTimeout(() => {
				pullerStartupSettled = true;
			}, 8000);
			/* Puller can come back after a port fight or sidecar restart — recover without reload. */
			pullerRecoveryTimer = setInterval(() => {
				if (offlineBackend === 'puller' || retryingPuller) return;
				void retryPullerConnection({ silent: true });
			}, 12_000);
		}

		const onModeChange = (e: Event) => {
			const d = (e as CustomEvent<{ gameId: string; mode: GamePlayMode }>).detail;
			if (d?.gameId === gameId) playMode = d.mode;
		};
		const onOfflineStatusChanged = (e: Event) => {
			const detail = (e as CustomEvent<OfflineStatusChangedDetail>).detail;
			if (!shouldRefreshForEvent(detail)) return;
			void refreshStatus().then(() => {
				if (isLocalAppDeployment() && !detail?.gameId) {
					pullerStartupSettled = true;
					if (pullerStartupTimer) clearTimeout(pullerStartupTimer);
				}
			});
		};

		window.addEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			if (pullerStartupTimer) clearTimeout(pullerStartupTimer);
			if (pullerRecoveryTimer) clearInterval(pullerRecoveryTimer);
			detachNetwork();
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	async function retryPullerConnection(opts?: { silent?: boolean }) {
		if (!isLocalAppDeployment() || retryingPuller) return;
		retryingPuller = true;
		try {
			/* Ask the native shell to respawn a dead puller (Vite proxy → :18787). */
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke<string>('ensure_puller');
			} catch {
				/* Browser / command unavailable — fall through to health wait. */
			}
			await syncPullerBaseUrlFromTauri();
			invalidatePullerAvailabilityCache();
			invalidateOfflineBackendCache();
			const available = opts?.silent
				? await isPullerAvailable(true, { ignoreDeploymentGate: true })
				: await waitForPuller(12_000);
			pullerStartupSettled = true;
			if (!available && opts?.silent) return;
			await refreshStatus();
			if (available) {
				dispatchOfflineStatusChanged();
				onPlayUrlChange?.();
				if (!opts?.silent) {
					toast.success('Local puller connected');
				}
			} else if (!opts?.silent) {
				toast.error('Puller still unavailable', {
					description:
						'You are in the desktop app, but the local puller process is down. Click Retry again, or run pnpm puller:start.'
				});
			}
		} finally {
			retryingPuller = false;
		}
	}

	$effect(() => {
		void gameId;
		void metadata;
		const nextMode = getGamePlayMode(gameId);
		if (playMode !== nextMode) playMode = nextMode;
		void refreshStatus();
	});

	async function handleDownload() {
		if (!canDownload || downloading) return;
		downloading = true;
		const generation = ++pollGeneration;
		progress = { state: 'pending', progress: 0, message: 'Starting…' };
		appendPlayLog(
			'info',
			'download',
			`Starting offline download`,
			`game=${gameId} backend=${offlineBackend}`
		);
		dispatchOfflineStatusChanged(gameId, 'download-start');
		try {
			const start = await startGameDownload(gameId);
			if (!start.started) {
				appendPlayLog(
					'warn',
					'download',
					'Download not started',
					`game=${gameId} ${start.message}`
				);
				toast.error(start.message);
				progress = { state: 'error', progress: 0, message: start.message, error: start.message };
				dispatchOfflineStatusChanged(gameId, 'download-error');
				await refreshStatus();
				return;
			}
			const final = await pollDownloadUntilDone(gameId, (p) => {
				if (generation === pollGeneration) progress = p;
			});
			if (generation !== pollGeneration) return;
			if (final.state === 'done') {
				appendPlayLog('info', 'download', 'Download finished', `game=${gameId}`);
				toast.success('Game downloaded for offline play');
				status = await refreshGameOfflineState(gameId);
				dispatchOfflineStatusChanged(gameId, 'download-done');
				onPlayUrlChange?.();
			} else if (final.state === 'cancelled') {
				appendPlayLog(
					'warn',
					'download',
					'Download cancelled',
					`game=${gameId} ${final.message ?? ''}`.trim()
				);
				toast.message(final.message || 'Download cancelled');
				status = await refreshGameOfflineState(gameId);
				dispatchOfflineStatusChanged(gameId, 'download-cancel');
			} else if (final.state === 'error') {
				const msg = await describePullerDownloadError(final.error);
				appendPlayLog('error', 'download', 'Download failed', `game=${gameId} ${msg}`);
				toast.error(msg);
				dispatchOfflineStatusChanged(gameId, 'download-error');
				await refreshStatus();
			}
		} catch (e) {
			if (generation !== pollGeneration) return;
			const raw = e instanceof Error ? e.message : 'Download failed';
			const msg = await describePullerDownloadError(raw);
			appendPlayLog('error', 'download', 'Download threw', `game=${gameId} ${msg}`);
			toast.error(msg);
			dispatchOfflineStatusChanged(gameId, 'download-error');
			await refreshStatus();
		} finally {
			if (generation === pollGeneration) downloading = false;
		}
	}

	async function confirmCancelDownload(discardCache: boolean) {
		cancelDialogOpen = false;
		cancelling = true;
		pollGeneration++;
		try {
			await cancelGameDownload(gameId, discardCache);
			progress = {
				state: 'cancelled',
				progress: 0,
				message: discardCache ? 'Cancelled — cache discarded' : 'Cancelled — partial cache kept'
			};
			toast.message(
				discardCache
					? 'Download cancelled and partial files removed'
					: 'Download cancelled — saved progress kept for next time'
			);
			status = await refreshGameOfflineState(gameId);
			dispatchOfflineStatusChanged(gameId, 'download-cancel');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Cancel failed');
		} finally {
			downloading = false;
			cancelling = false;
		}
	}

	async function handleDelete() {
		if (!canDelete || deleting) return;
		if (!confirm('Delete the offline copy of this game?')) return;
		deleting = true;
		try {
			await deleteOfflineCopy(gameId);
			/* Clear badges immediately so the UI does not wait on a slow status round-trip. */
			status = {
				online: onlineAvailable || Boolean(status?.online),
				offline: false,
				downloading: false,
				partialCache: false,
				cacheFileCount: undefined,
				offlineThumbnail: undefined
			};
			dispatchOfflineStatusChanged(gameId, 'delete');
			toast.success('Offline copy deleted');
			status = (await refreshGameOfflineState(gameId)) ?? status;
			if (playMode === 'offline') {
				saveGamePlayMode(gameId, 'online');
			}
			onPlayUrlChange?.();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Delete failed');
			await refreshStatus();
		} finally {
			deleting = false;
		}
	}

	let showDownloadSection = $derived(
		!bundled &&
			(offlineReady || isLocalAppDeployment()) &&
			(onlineAvailable ||
				Boolean(status?.offline) ||
				downloading ||
				hasPartialCache ||
				waitingForPuller ||
				Boolean(downloadBlockedReason))
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
			{:else if waitingForPuller}
				<Badge variant="outline" class="gap-1">
					<Loader2 class="h-3 w-3 animate-spin" />
					Starting puller
				</Badge>
			{:else if hasPartialCache}
				<Badge variant="secondary" class="gap-1">
					<HardDrive class="h-3 w-3" />
					Partial cache ({status?.cacheFileCount ?? 0} files)
				</Badge>
			{/if}
		</div>

		<div class="flex flex-wrap gap-2">
			{#if canDownload}
				<Button size="sm" onclick={handleDownload} disabled={downloading || cancelling}>
					<Download class="mr-2 h-4 w-4" />
					{hasPartialCache ? 'Resume download' : 'Download for offline'}
				</Button>
			{:else if downloadBlockedReason && !status?.offline}
				<Button size="sm" disabled title={downloadBlockedReason}>
					<Download class="mr-2 h-4 w-4" />
					{hasPartialCache ? 'Resume download' : 'Download for offline'}
				</Button>
			{/if}
			{#if pullerMissingHint}
				<Button
					size="sm"
					variant="outline"
					onclick={() => void retryPullerConnection()}
					disabled={retryingPuller}
				>
					{#if retryingPuller}
						<Loader2 class="mr-2 h-4 w-4 animate-spin" />
						Retrying…
					{:else}
						<RefreshCw class="mr-2 h-4 w-4" />
						Retry puller
					{/if}
				</Button>
			{/if}
			{#if canCancel}
				<Button
					size="sm"
					variant="outline"
					onclick={() => {
						cancelDialogOpen = true;
					}}
					disabled={cancelling}
				>
					<X class="mr-2 h-4 w-4" />
					Cancel download
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
					{hasPartialCache && !status?.offline ? 'Discard partial cache' : 'Delete offline copy'}
				</Button>
			{/if}
		</div>

		{#if downloading && progress.state !== 'idle'}
			<div class="space-y-1">
				<Progress value={progress.progress} max={100} />
				<p class="text-xs text-muted-foreground">{progress.message}</p>
			</div>
		{/if}

		{#if downloadBlockedReason && !status?.offline && !downloading}
			<p class="text-xs text-muted-foreground">{downloadBlockedReason}</p>
		{/if}

		{#if hasPartialCache && !downloading}
			<p class="text-xs text-muted-foreground">
				Partial download saved in this browser. Resume to continue where you left off, or delete the
				offline copy to start fresh.
			</p>
		{/if}

		{#if waitingForPuller}
			<p class="text-xs text-muted-foreground">
				Connecting to the local puller for Playwright capture and offline mirrors…
			</p>
		{:else if pullerMissingHint}
			<p class="text-xs text-muted-foreground">
				The local puller is unavailable right now. Use <span class="font-medium">Retry puller</span>,
				restart the desktop app sidecar, or run
				<code class="rounded bg-muted px-1">pnpm puller:start</code> for full game file downloads on
				disk. Console, pause inject, and offline mirrors need the puller.
			</p>
			{#if externalEmbedOnly}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					This title loads Unity (or another host) inside a nested cross-origin iframe. Without the
					puller, play falls back to that shell and usually fails with a Unity
					<span class="font-medium">Script error</span>. Retry the puller before launching.
				</p>
			{/if}
		{:else if offlineBackend === 'browser'}
			<p class="text-xs text-muted-foreground">
				Downloads are saved in this browser via IndexedDB. Same-origin game files work offline.
			</p>
			{#if externalEmbedOnly}
				<p class="text-xs text-amber-600 dark:text-amber-400">
					This game embeds a third-party host. Full offline requires the desktop app or a running
					local puller (<code class="rounded bg-muted px-1">pnpm puller:start</code>) so the iframe
					and all assets can be scraped — browser storage alone cannot mirror cross-origin hosts.
				</p>
			{/if}
		{:else if offlineBackend === 'puller'}
			<p class="text-xs text-muted-foreground">
				Downloads are saved as game files on disk via the local puller (Playwright capture, ads
				stripped).
			</p>
		{/if}
	</div>
{/if}

<AlertDialog.Root bind:open={cancelDialogOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Cancel download?</AlertDialog.Title>
			<AlertDialog.Description>
				You can discard everything downloaded so far, or keep the partial cache in this browser so
				the next download can resume from saved files.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer class="flex-col gap-2 sm:flex-row sm:justify-end">
			<AlertDialog.Cancel>Keep downloading</AlertDialog.Cancel>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'secondary' }))}
				onclick={() => void confirmCancelDownload(false)}
			>
				Keep partial cache
			</AlertDialog.Action>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'destructive' }))}
				onclick={() => void confirmCancelDownload(true)}
			>
				Discard partial cache
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
