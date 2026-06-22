<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import Badge from '$lib/components/ui/badge/badge.svelte';
	import Progress from '$lib/components/ui/progress/progress.svelte';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { Download, Trash2, HardDrive, Wifi, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import {
		type GameOfflineStatus,
		type DownloadProgress,
		type OfflineBackend,
		getOfflineBackend,
		fetchGameOfflineStatus,
		startGameDownload,
		deleteOfflineCopy,
		pollDownloadUntilDone,
		invalidateOfflineStatusCache
	} from '$lib/utils/offline-downloader';
	import {
		getGamePlayMode,
		saveGamePlayMode,
		type GamePlayMode,
		GAME_PLAY_MODE_CHANGED
	} from '$lib/utils/game-play-mode';
	import { onMount } from 'svelte';

	let {
		gameId,
		onPlayUrlChange
	}: {
		gameId: string;
		onPlayUrlChange?: () => void;
	} = $props();

	let offlineBackend = $state<OfflineBackend>('none');
	let status = $state<GameOfflineStatus | null>(null);
	let playMode = $state<GamePlayMode>('offline');
	let downloading = $state(false);
	let progress = $state<DownloadProgress>({ state: 'idle', progress: 0, message: '' });
	let deleting = $state(false);

	let offlineReady = $derived(offlineBackend !== 'none');

	async function refreshStatus() {
		offlineBackend = await getOfflineBackend(true);
		if (offlineReady) {
			status = await fetchGameOfflineStatus(gameId);
		} else {
			status = null;
		}
	}

	onMount(() => {
		playMode = getGamePlayMode(gameId);
		void refreshStatus();

		const onModeChange = (e: Event) => {
			const d = (e as CustomEvent<{ gameId: string; mode: GamePlayMode }>).detail;
			if (d?.gameId === gameId) playMode = d.mode;
		};
		window.addEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
		return () => window.removeEventListener(GAME_PLAY_MODE_CHANGED, onModeChange);
	});

	$effect(() => {
		gameId;
		playMode = getGamePlayMode(gameId);
		void refreshStatus();
	});

	function setPlayMode(mode: GamePlayMode) {
		if (mode !== 'online' && mode !== 'offline') return;
		playMode = mode;
		saveGamePlayMode(gameId, mode);
		onPlayUrlChange?.();
	}

	async function handleDownload() {
		if (!offlineReady || downloading) return;
		downloading = true;
		progress = { state: 'pending', progress: 0, message: 'Starting…' };
		try {
			await startGameDownload(gameId);
			const final = await pollDownloadUntilDone(gameId, (p) => {
				progress = p;
			});
			if (final.state === 'done') {
				toast.success('Game downloaded for offline play');
				await refreshStatus();
				onPlayUrlChange?.();
			} else if (final.state === 'error') {
				toast.error(final.error ?? 'Download failed');
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Download failed');
		} finally {
			downloading = false;
			invalidateOfflineStatusCache();
		}
	}

	async function handleDelete() {
		if (!offlineReady || deleting) return;
		if (!confirm('Delete the offline copy of this game?')) return;
		deleting = true;
		try {
			await deleteOfflineCopy(gameId);
			toast.success('Offline copy deleted');
			await refreshStatus();
			if (playMode === 'offline') {
				setPlayMode('online');
			}
			onPlayUrlChange?.();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Delete failed');
		} finally {
			deleting = false;
		}
	}

	let showVersionToggle = $derived(Boolean(status?.online && status?.offline && !downloading));
</script>

<div class="mt-4 space-y-3 rounded-lg border bg-muted/30 p-4">
	<div class="flex flex-wrap items-center gap-2">
		<span class="text-sm font-medium">Offline play</span>
		{#if !offlineReady}
			<Badge variant="secondary">Offline storage unavailable</Badge>
		{:else if offlineBackend === 'browser'}
			<Badge variant="outline" class="gap-1">
				<HardDrive class="h-3 w-3" />
				Browser storage
			</Badge>
		{/if}
		{#if offlineReady}
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
			{:else}
				<Badge variant="outline">Online only</Badge>
			{/if}
		{/if}
	</div>

	{#if offlineReady}
		<div class="flex flex-wrap gap-2">
			{#if !status?.offline && !downloading}
				<Button size="sm" onclick={handleDownload} disabled={downloading || !status?.online}>
					<Download class="mr-2 h-4 w-4" />
					Download for offline
				</Button>
			{/if}
			{#if status?.offline}
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

		{#if showVersionToggle}
			<div class="space-y-2">
				<p class="text-xs text-muted-foreground">Choose which version to play:</p>
				<ToggleGroup.Root
					type="single"
					value={playMode}
					onValueChange={(v) => {
						if (v === 'online' || v === 'offline') setPlayMode(v);
					}}
					class="justify-start"
				>
					<ToggleGroup.Item value="offline" aria-label="Play offline" class="gap-1.5">
						<HardDrive class="h-4 w-4" />
						Offline
					</ToggleGroup.Item>
					<ToggleGroup.Item value="online" aria-label="Play online" class="gap-1.5">
						<Wifi class="h-4 w-4" />
						Online
					</ToggleGroup.Item>
				</ToggleGroup.Root>
			</div>
		{/if}

		{#if offlineBackend === 'browser'}
			<p class="text-xs text-muted-foreground">
				Downloads are saved in this browser via IndexedDB. Same-origin game files work offline;
				games that load entirely from external sites may still need a network connection.
			</p>
		{/if}
	{:else}
		<p class="text-xs text-muted-foreground">
			Offline downloads need browser storage (IndexedDB) or the desktop app. You can still play online
			with the Play button above.
		</p>
	{/if}
</div>
